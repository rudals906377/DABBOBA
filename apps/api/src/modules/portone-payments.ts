import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { lockLinkedKujiRoomForOrder, withTransaction } from "@dabboba/db";
import { adminMutationHeaders, writeAdminAudit } from "../lib/audit.js";
import { AppError, badRequest, conflict, notFound, unauthorized } from "../lib/errors.js";
import { requireLiveCommerce } from "../lib/commerce-mode.js";
import {
  createPortOneV2Adapter,
  PortOneV2Error,
  type PortOneCardPayment,
} from "../lib/portone-v2.js";
import {
  PortOneWebhookError,
  verifyPortOnePaymentWebhook,
} from "../lib/portone-webhook.js";
import { requestHash } from "../lib/idempotency.js";
import { objectInput, stringInput, uuidInput } from "../lib/input.js";
import { numberValue } from "../lib/rows.js";
import type { ApiContext } from "../types.js";

const PORTONE_PROVIDER = "PORTONE_V2_INICIS";

type LocalPayment = {
  id: string;
  order_id: string;
  amount: number;
};

type LateRefundCandidate = {
  id: string;
  order_id: string;
  provider: string;
  status: string;
  order_status: string;
  order_kind: string;
  order_total: number | string;
  cancelled_at: Date | null;
  shipping_request_id: string | null;
  shipping_status: string | null;
  shipping_owner_matches: boolean | null;
  shipping_item_count: number | string;
  amount: number;
  point_total: number;
  paid_ledger: number | string;
  refund_ledger: number | string;
  line_count: number | string;
  inventory_count: number | string;
  entitlement_count: number | string;
  active_reservation_count: number | string;
};

export type NormalDrawRefundCandidate = LateRefundCandidate & {
  draw_line_count: number | string;
  expected_draw_units: number | string;
  available_entitlement_count: number | string;
  draw_result_count: number | string;
};

type RefundAttempt = {
  payment_id: string;
  admin_id: string;
  idempotency_key: string;
  request_hash: string;
  status: string;
  provider_cancellation_id: string | null;
  provider_status: string | null;
  last_error_code: string | null;
  created_at: Date;
  updated_at: Date;
};

export function lateRefundBlocker(row: LateRefundCandidate): string | null {
  if (row.provider !== PORTONE_PROVIDER || row.status !== "REFUND_REVIEW" || row.order_status !== "REFUND_REVIEW") return "결제와 주문이 모두 환불 검토 상태여야 합니다.";
  if (!row.cancelled_at) return "결제 지연으로 취소된 주문만 처리할 수 있습니다.";
  if (row.order_kind === "PRODUCT") {
    if (numberValue(row.line_count) < 1 || row.shipping_request_id) return "미발급 상품 주문만 처리할 수 있습니다.";
  } else if (row.order_kind === "SHIPPING_FEE") {
    if (row.shipping_status !== "CANCELLED" || !row.shipping_request_id
      || row.shipping_owner_matches !== true || numberValue(row.shipping_item_count) < 1
      || numberValue(row.line_count) !== 0) {
      return "취소된 배송비 주문만 처리할 수 있습니다.";
    }
  } else {
    return "지원하지 않는 주문 유형입니다.";
  }
  if (numberValue(row.amount) <= 0 || numberValue(row.point_total) !== 0) return "유료 카드 결제이며 포인트가 없는 주문만 처리할 수 있습니다.";
  if (numberValue(row.order_total) !== numberValue(row.amount)) return "카드 결제 금액과 주문 금액을 먼저 대사해야 합니다.";
  if (numberValue(row.paid_ledger) !== numberValue(row.amount) || numberValue(row.refund_ledger) !== 0) return "결제 원장 금액을 먼저 대사해야 합니다.";
  if (numberValue(row.inventory_count) !== 0 || numberValue(row.entitlement_count) !== 0 || numberValue(row.active_reservation_count) !== 0) return "상품·뽑기권 또는 재고 예약이 남아 있어 자동 취소할 수 없습니다.";
  return null;
}

export function normalDrawRefundBlocker(
  row: NormalDrawRefundCandidate,
  expectedStatus: "PAID" | "REFUND_REVIEW",
): string | null {
  if (row.provider !== PORTONE_PROVIDER || row.status !== expectedStatus || row.order_status !== expectedStatus) {
    return "결제와 주문 상태가 전액 환불 요청 조건에 맞지 않습니다.";
  }
  if (row.order_kind !== "PRODUCT" || row.cancelled_at) return "취소되지 않은 상품 주문만 환불할 수 있습니다.";
  if (numberValue(row.amount) <= 0 || numberValue(row.order_total) !== numberValue(row.amount)) {
    return "카드 결제 금액과 주문 금액을 먼저 대사해야 합니다.";
  }
  if (numberValue(row.paid_ledger) !== numberValue(row.amount) || numberValue(row.refund_ledger) !== 0) {
    return "결제·환불 원장 금액을 먼저 대사해야 합니다.";
  }
  const lineCount = numberValue(row.line_count);
  const expectedDrawUnits = numberValue(row.expected_draw_units);
  if (lineCount < 1 || numberValue(row.draw_line_count) !== lineCount || expectedDrawUnits < 1) {
    return "가챠·쿠지만 포함된 유료 주문을 전액 환불할 수 있습니다.";
  }
  if (
    numberValue(row.entitlement_count) !== expectedDrawUnits
    || numberValue(row.available_entitlement_count) !== expectedDrawUnits
    || numberValue(row.draw_result_count) !== 0
    || numberValue(row.inventory_count) !== 0
    || numberValue(row.active_reservation_count) !== 0
  ) {
    return "이미 사용한 추첨권이나 이동한 상품이 있어 자동 전액 환불할 수 없습니다.";
  }
  return null;
}

export const REFUND_CANDIDATE_LOOKUP_SQL = `SELECT p.id,p.order_id,p.provider,p.status,p.amount,o.status AS order_status,
  o.order_kind,o.cancelled_at,o.point_total,o.total AS order_total,o.shipping_request_id,
  shipping.status AS shipping_status,
  (shipping.user_id=o.user_id) AS shipping_owner_matches,
  (SELECT count(*) FROM shipping_request_items item WHERE item.shipping_request_id=shipping.id) AS shipping_item_count,
  COALESCE((SELECT sum(l.amount) FROM payment_ledger_entries l WHERE l.payment_id=p.id AND l.entry_type='PAYMENT'),0) AS paid_ledger,
  COALESCE((SELECT sum(l.amount) FROM payment_ledger_entries l WHERE l.payment_id=p.id AND l.entry_type='REFUND'),0) AS refund_ledger,
  (SELECT count(*) FROM order_lines line WHERE line.order_id=o.id) AS line_count,
  (SELECT count(*) FROM order_lines line WHERE line.order_id=o.id AND line.category_snapshot IN ('gacha','kuji')) AS draw_line_count,
  COALESCE((SELECT sum(line.quantity) FROM order_lines line WHERE line.order_id=o.id AND line.category_snapshot IN ('gacha','kuji')),0) AS expected_draw_units,
  (SELECT count(*) FROM inventory_units i JOIN order_lines line ON line.id=i.source_id WHERE line.order_id=o.id AND i.source_type='PURCHASE') AS inventory_count,
  (SELECT count(*) FROM draw_entitlements e JOIN order_lines line ON line.id=e.order_line_id WHERE line.order_id=o.id) AS entitlement_count,
  (SELECT count(*) FROM draw_entitlements e JOIN order_lines line ON line.id=e.order_line_id WHERE line.order_id=o.id AND e.status='AVAILABLE') AS available_entitlement_count,
  (SELECT count(*) FROM draw_results result JOIN draw_entitlements e ON e.id=result.entitlement_id JOIN order_lines line ON line.id=e.order_line_id WHERE line.order_id=o.id) AS draw_result_count,
  (SELECT count(*) FROM stock_reservations r WHERE r.order_id=o.id AND r.status='ACTIVE') AS active_reservation_count
  FROM payments p JOIN orders o ON o.id=p.order_id
  LEFT JOIN shipping_requests shipping ON shipping.id=o.shipping_request_id WHERE p.id=$1`;
const REFUND_CANDIDATE_SQL = `${REFUND_CANDIDATE_LOOKUP_SQL} FOR UPDATE OF p,o`;

function refundAttemptView(row: RefundAttempt, localPaymentStatus?: string) {
  return {
    paymentId: row.payment_id,
    status: localPaymentStatus === "REFUNDED" ? "RECONCILED" : row.status,
    localPaymentStatus: localPaymentStatus ?? null,
    providerCancellationId: row.provider_cancellation_id,
    providerStatus: row.provider_status,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

type NormalizedEventType =
  | "PAYMENT_SUCCEEDED"
  | "PAYMENT_FAILED"
  | "PAYMENT_CANCELLED"
  | "PAYMENT_STATE_ANOMALY"
  | "REFUND_SUCCEEDED"
  | "REFUND_PARTIAL";

type NormalizedProviderEvent = {
  eventId: string;
  eventType: NormalizedEventType;
  paymentId: string;
  providerPaymentId: string;
  occurredAt: string;
  amount: number;
  providerObservation?: {
    status: PortOneCardPayment["status"];
    paidAmount: number;
    cancelledAmount: number;
  };
};

function configuredContext(context: ApiContext) {
  if (
    context.config.paymentProvider !== PORTONE_PROVIDER
    || !context.config.paymentWebhookSecret
    || !context.config.portOne
  ) {
    throw new AppError(503, "PAYMENT_NOT_CONFIGURED", "포트원 결제가 구성되지 않았습니다.");
  }
  return context.config.portOne;
}

function providerError(error: unknown): AppError {
  if (error instanceof PortOneV2Error) {
    const status = error.code === "PAYMENT_CONTRACT_MISMATCH" ? 409 : 502;
    return new AppError(
      status,
      error.code === "PAYMENT_CONTRACT_MISMATCH"
        ? "PAYMENT_CONTRACT_MISMATCH"
        : "PAYMENT_PROVIDER_UNAVAILABLE",
      error.code === "PAYMENT_CONTRACT_MISMATCH"
        ? "결제사 승인 정보와 주문 정보가 일치하지 않습니다."
        : "결제사 승인 상태를 확인하지 못했습니다.",
    );
  }
  if (error instanceof PortOneWebhookError) {
    const status = error.code === "WEBHOOK_TOO_LARGE" ? 413 : 401;
    return new AppError(status, error.code, "포트원 웹훅을 검증하지 못했습니다.");
  }
  return new AppError(502, "PAYMENT_PROVIDER_UNAVAILABLE", "결제사 상태를 확인하지 못했습니다.");
}

export function normalizedPortOneEventForPayment(
  payment: PortOneCardPayment,
): NormalizedProviderEvent | null {
  let eventType: NormalizedEventType;
  let amount = payment.amount.total;
  const hasMoneyBeforeSettlement = ["READY", "PAY_PENDING", "VIRTUAL_ACCOUNT_ISSUED", "FAILED"].includes(payment.status)
    && (payment.amount.paid > 0 || payment.amount.cancelled > 0);
  const paidWithCancellation = payment.status === "PAID" && payment.amount.cancelled > 0;

  if (hasMoneyBeforeSettlement || paidWithCancellation) {
    // The status and money fields contradict one another. Neither a draw nor
    // a terminal no-charge cancellation is safe without operator review.
    eventType = "PAYMENT_STATE_ANOMALY";
    amount = payment.amount.paid;
  } else switch (payment.status) {
    case "READY":
    case "PAY_PENDING":
    case "VIRTUAL_ACCOUNT_ISSUED":
      return null;
    case "PAID":
      eventType = "PAYMENT_SUCCEEDED";
      // The configured total is only the amount requested by the merchant.
      // The canonical ledger must compare the amount PortOne says was paid.
      amount = payment.amount.paid;
      break;
    case "FAILED":
      eventType = "PAYMENT_FAILED";
      break;
    case "CANCELLED":
      eventType = payment.amount.paid > 0 || payment.amount.cancelled > 0
        ? "REFUND_SUCCEEDED"
        : "PAYMENT_CANCELLED";
      if (eventType === "REFUND_SUCCEEDED") {
        // A full local refund requires both the paid and cancelled amounts to
        // equal the order total. Pass through the mismatching provider amount
        // so the canonical handler enters review instead of revoking assets.
        amount = payment.amount.paid !== payment.amount.total
          ? payment.amount.paid
          : payment.amount.cancelled;
      }
      break;
    case "PARTIAL_CANCELLED":
      // Status is authoritative here: even contradictory amount fields must
      // never turn a partial cancellation into a full local refund.
      eventType = "REFUND_PARTIAL";
      amount = payment.amount.cancelled;
      break;
  }

  const providerPaymentId = payment.pgTransactionId || payment.portOneTransactionId;
  const stateFingerprint = JSON.stringify({
    paymentId: payment.paymentId,
    transactionId: payment.portOneTransactionId,
    status: payment.status,
    statusChangedAt: payment.statusChangedAt,
    paid: payment.amount.paid,
    cancelled: payment.amount.cancelled,
  });
  return {
    eventId: `portone-${createHash("sha256").update(stateFingerprint).digest("hex")}`,
    eventType,
    paymentId: payment.paymentId,
    providerPaymentId,
    occurredAt: payment.statusChangedAt,
    amount,
    ...(eventType === "PAYMENT_STATE_ANOMALY" ? {
      providerObservation: {
        status: payment.status,
        paidAmount: payment.amount.paid,
        cancelledAmount: payment.amount.cancelled,
      },
    } : {}),
  };
}

async function dispatchCanonicalEvent(
  app: FastifyInstance,
  context: ApiContext,
  event: NormalizedProviderEvent,
) {
  const secret = context.config.paymentWebhookSecret!;
  const rawBody = JSON.stringify(event);
  const signature = createHmac("sha256", secret).update(rawBody).digest("hex");
  const response = await app.inject({
    method: "POST",
    url: `/v1/payments/webhooks/${PORTONE_PROVIDER}`,
    headers: {
      "content-type": "application/json",
      "x-dabboba-signature": `sha256=${signature}`,
    },
    payload: rawBody,
  });
  const body = response.json() as { outcome?: string; error?: { code?: string; message?: string } };
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new AppError(
      response.statusCode,
      body.error?.code || "PAYMENT_RECONCILIATION_FAILED",
      body.error?.message || "결제 승인 상태를 주문에 반영하지 못했습니다.",
    );
  }
  return body.outcome || "processed";
}

async function reconcilePayment(
  app: FastifyInstance,
  context: ApiContext,
  localPayment: LocalPayment,
  { retryReviewedRefund = false }: { retryReviewedRefund?: boolean } = {},
) {
  const config = configuredContext(context);
  const adapter = createPortOneV2Adapter(config);
  let payment: PortOneCardPayment;
  try {
    payment = await adapter.getPayment({
      paymentId: localPayment.id,
      expectedTotalAmount: numberValue(localPayment.amount),
    });
  } catch (error) {
    throw providerError(error);
  }
  const observedEvent = normalizedPortOneEventForPayment(payment);
  // PortOne's verified state fingerprint is intentionally stable. If a full
  // refund was already observed but local assets needed operator review, the
  // same fingerprint would otherwise deduplicate forever after the operator
  // fixes those assets. Only an audited admin requery may make a new canonical
  // processing attempt; provider observation and amount are still re-fetched.
  const event = observedEvent?.eventType === "REFUND_SUCCEEDED" && retryReviewedRefund
    ? { ...observedEvent, eventId: `${observedEvent.eventId}-review-${randomUUID()}` }
    : observedEvent;
  if (!event) {
    return { providerStatus: payment.status, outcome: "pending" as const };
  }
  const outcome = await dispatchCanonicalEvent(app, context, event);
  return { providerStatus: payment.status, outcome };
}

function assertWorkerReconciliationSignature(
  request: FastifyRequest,
  secret: string | null | undefined,
  paymentId: string,
): void {
  if (!secret) throw new AppError(503, "PAYMENT_RECONCILIATION_UNAVAILABLE", "결제 재조회가 구성되지 않았습니다.");
  const timestamp = request.headers["x-dabboba-worker-timestamp"];
  const signature = request.headers["x-dabboba-worker-signature"];
  if (typeof timestamp !== "string" || !/^[0-9]{10}$/.test(timestamp)
    || Math.abs(Date.now() - Number(timestamp) * 1_000) > 120_000
    || typeof signature !== "string" || !/^sha256=[a-f0-9]{64}$/.test(signature)) {
    throw unauthorized("결제 재조회 인증이 유효하지 않습니다.");
  }
  const path = `/v1/internal/payments/${paymentId}/reconcile`;
  const expected = createHmac("sha256", secret).update(`POST\n${path}\n${timestamp}`).digest();
  const provided = Buffer.from(signature.slice(7), "hex");
  if (!timingSafeEqual(expected, provided)) throw unauthorized("결제 재조회 인증이 유효하지 않습니다.");
}

export async function registerPortOnePaymentRoutes(
  app: FastifyInstance,
  context: ApiContext,
) {
  app.post(
    "/v1/internal/payments/:paymentId/reconcile",
    { preHandler: requireLiveCommerce(context) },
    async (request, reply) => {
      const paymentId = uuidInput((request.params as Record<string, unknown>).paymentId, "paymentId");
      assertWorkerReconciliationSignature(request, context.config.paymentReconciliationWorkerSecret, paymentId);
      configuredContext(context);
      const payment = await context.pool.query<LocalPayment & { status: string; pg_attempt_started_at: Date | null }>(
        "SELECT id,order_id,amount,status,pg_attempt_started_at FROM payments WHERE id=$1 AND provider=$2",
        [paymentId, PORTONE_PROVIDER],
      );
      if (!payment.rowCount) throw notFound("포트원 결제 정보를 찾을 수 없습니다.");
      const current = payment.rows[0]!;
      if (!["PENDING", "AUTHORIZED", "REFUND_REVIEW"].includes(current.status)
        && !(current.status === "CANCELLED" && current.pg_attempt_started_at)) {
        return reply.code(200).send({
          accepted: true, paymentId, orderId: current.order_id,
          providerStatus: null, outcome: "already_settled", localStatus: current.status,
        });
      }
      const result = await reconcilePayment(app, context, current);
      const updated = await context.pool.query<{ status: string }>("SELECT status FROM payments WHERE id=$1", [paymentId]);
      return reply.code(200).send({
        accepted: true, paymentId, orderId: current.order_id,
        ...result, localStatus: updated.rows[0]?.status ?? current.status,
      });
    },
  );

  app.post(
    "/v1/admin/commerce/payments/:paymentId/reconcile",
    { preHandler: [requireLiveCommerce(context), context.auth.requirePermission("payments.reconcile")] },
    async (request, reply) => {
      configuredContext(context);
      const paymentId = uuidInput((request.params as Record<string, unknown>).paymentId, "paymentId");
      const body = objectInput(request.body);
      const reason = stringInput(body, "reason", { min: 2, max: 500 })!;
      adminMutationHeaders(request, reason);
      const payment = await context.pool.query<LocalPayment & { status: string; order_status: string }>(
        `SELECT p.id,p.order_id,p.amount,p.status,o.status AS order_status
           FROM payments p JOIN orders o ON o.id=p.order_id
          WHERE p.id=$1 AND p.provider=$2`,
        [paymentId, PORTONE_PROVIDER],
      );
      if (!payment.rowCount) throw notFound("포트원 결제 정보를 찾을 수 없습니다.");
      const current = payment.rows[0]!;
      // Record the operator's attempt before the provider call: the canonical
      // handler may commit a paid order even if a later response is lost.
      await withTransaction(context.pool, async (client) => {
        await writeAdminAudit(client, request, request.actor!, {
          action: "PORTONE_PAYMENT_REQUERY_REQUESTED", targetType: "PAYMENT", targetId: paymentId, reason,
          before: { paymentStatus: current.status, orderStatus: current.order_status },
          metadata: { providerCancellationRequested: false },
        });
      });
      const result = await reconcilePayment(app, context, current, {
        retryReviewedRefund: current.status === "REFUND_REVIEW",
      });
      return reply.code(200).send({ accepted: true, paymentId, orderId: current.order_id, ...result });
    },
  );

  app.get(
    "/v1/admin/commerce/refund-reviews/:paymentId/cancellation",
    { preHandler: context.auth.requirePermission("refunds.read") },
    async (request) => {
      const paymentId = uuidInput((request.params as Record<string, unknown>).paymentId, "paymentId");
      const result = await context.pool.query<RefundAttempt & { local_payment_status: string }>(
        `SELECT a.*,p.status AS local_payment_status FROM portone_refund_cancellation_attempts a
         JOIN payments p ON p.id=a.payment_id WHERE a.payment_id=$1`,
        [paymentId],
      );
      if (!result.rowCount) throw notFound("결제 취소 요청 내역을 찾을 수 없습니다.");
      return refundAttemptView(result.rows[0]!, result.rows[0]!.local_payment_status);
    },
  );

  app.post(
    "/v1/admin/commerce/refund-reviews/:paymentId/cancellation/reconcile",
    { preHandler: [requireLiveCommerce(context), context.auth.requirePermission("refunds.cancel")] },
    async (request, reply) => {
      configuredContext(context);
      const paymentId = uuidInput((request.params as Record<string, unknown>).paymentId, "paymentId");
      const body = objectInput(request.body);
      const reason = stringInput(body, "reason", { min: 2, max: 500 })!;
      adminMutationHeaders(request, reason);
      const attempt = await context.pool.query<RefundAttempt & { amount: number; order_id: string }>(
        `SELECT a.*,p.amount,p.order_id FROM portone_refund_cancellation_attempts a
         JOIN payments p ON p.id=a.payment_id WHERE a.payment_id=$1`, [paymentId],
      );
      if (!attempt.rowCount) throw notFound("결제 취소 요청 내역을 찾을 수 없습니다.");
      const current = attempt.rows[0]!;
      if ((current.status === "PRECHECK" || current.status === "CALLING")
        && Date.now() - current.updated_at.getTime() < 30_000) {
        throw conflict("취소 요청 처리 중입니다. 잠시 후 다시 조회해 주세요.");
      }
      const localBefore = await context.pool.query<{ status: string }>(
        "SELECT status FROM payments WHERE id=$1", [paymentId],
      );
      const observation = await reconcilePayment(app, context, {
        id: paymentId, order_id: current.order_id, amount: numberValue(current.amount),
      }, { retryReviewedRefund: localBefore.rows[0]?.status === "REFUND_REVIEW" });
      const local = await context.pool.query<{ status: string }>("SELECT status FROM payments WHERE id=$1", [paymentId]);
      const status = observation.providerStatus === "CANCELLED" && local.rows[0]?.status === "REFUNDED"
        ? "RECONCILED"
        : observation.providerStatus === "PARTIAL_CANCELLED" || observation.outcome === "review"
          ? "REVIEW_REQUIRED"
          : current.status === "INDETERMINATE" || current.status === "CALLING"
            ? "INDETERMINATE" : current.status;
      const recorded = await withTransaction(context.pool, async (client) => {
        const changed = await client.query<RefundAttempt>(
          `UPDATE portone_refund_cancellation_attempts
           SET status=$2,provider_status=$3,last_error_code=CASE
             WHEN $2='RECONCILED' THEN NULL
             WHEN $2='REVIEW_REQUIRED' THEN 'PROVIDER_REVIEW_REQUIRED'
             ELSE last_error_code END
           WHERE payment_id=$1 RETURNING *`, [paymentId, status, observation.providerStatus],
        );
        await writeAdminAudit(client, request, request.actor!, {
          action: "PORTONE_REFUND_RECONCILED", targetType: "PAYMENT", targetId: paymentId, reason,
          before: { attemptStatus: current.status },
          after: { attemptStatus: status, providerStatus: observation.providerStatus, outcome: observation.outcome },
          metadata: { providerCancellationRetried: false },
        });
        return changed.rows[0]!;
      });
      return reply.code(200).send(refundAttemptView(recorded));
    },
  );

  const refundHandler = async (request: FastifyRequest, reply: FastifyReply) => {
      const config = configuredContext(context);
      const paymentId = uuidInput((request.params as Record<string, unknown>).paymentId, "paymentId");
      const body = objectInput(request.body);
      const reason = stringInput(body, "reason", { min: 2, max: 500 })!;
      const headers = adminMutationHeaders(request, reason);
      const hash = requestHash({ paymentId, reason });
      const existingAttempt = await context.pool.query<RefundAttempt>(
        "SELECT * FROM portone_refund_cancellation_attempts WHERE payment_id=$1",
        [paymentId],
      );
      if (existingAttempt.rowCount) {
        const attempt = existingAttempt.rows[0]!;
        if (attempt.idempotency_key !== headers.idempotencyKey || attempt.request_hash !== hash) {
          throw conflict("이 결제에는 이미 취소 요청이 있습니다. 결과를 대사한 뒤 운영 검토해 주세요.");
        }
        reply.header("x-idempotent-replay", "true");
        return reply.code(202).send(refundAttemptView(attempt));
      }
      const candidateBeforeLookup = await context.pool.query<NormalDrawRefundCandidate>(
        REFUND_CANDIDATE_LOOKUP_SQL,
        [paymentId],
      );
      if (!candidateBeforeLookup.rowCount) throw notFound("결제 정보를 찾을 수 없습니다.");
      const preflight = candidateBeforeLookup.rows[0]!;
      const preflightBlocker = preflight.status === "PAID" && preflight.order_status === "PAID"
        ? normalDrawRefundBlocker(preflight, "PAID")
        : lateRefundBlocker(preflight);
      if (preflightBlocker) throw conflict(preflightBlocker);

      // A provider read is safe before the order freeze: the locked transaction
      // below rechecks every asset before any cancellation can be sent. A failed
      // read must not strand a paid customer in REFUND_REVIEW with no retry path.
      const adapter = createPortOneV2Adapter(config);
      let providerPayment: PortOneCardPayment;
      try {
        providerPayment = await adapter.getPayment({
          paymentId,
          expectedTotalAmount: numberValue(preflight.amount),
        });
      } catch (error) {
        throw providerError(error);
      }
      const prepared = await withTransaction(context.pool, async (client) => {
        const payment = await client.query<NormalDrawRefundCandidate>(REFUND_CANDIDATE_SQL, [paymentId]);
        if (!payment.rowCount) throw notFound("결제 정보를 찾을 수 없습니다.");
        const existing = await client.query<RefundAttempt>(
          "SELECT * FROM portone_refund_cancellation_attempts WHERE payment_id=$1 FOR UPDATE",
          [paymentId],
        );
        if (existing.rowCount) {
          const attempt = existing.rows[0]!;
          if (attempt.idempotency_key !== headers.idempotencyKey || attempt.request_hash !== hash) {
            throw conflict("이 결제에는 이미 취소 요청이 있습니다. 결과를 대사한 뒤 운영 검토해 주세요.");
          }
          return { attempt, replay: true };
        }
        const candidate = payment.rows[0]!;
        const normalDraw = candidate.status === "PAID" && candidate.order_status === "PAID";
        const blocker = normalDraw
          ? normalDrawRefundBlocker(candidate, "PAID")
          : lateRefundBlocker(candidate);
        if (blocker) throw conflict(blocker);
        const inserted = await client.query<RefundAttempt>(
          `INSERT INTO portone_refund_cancellation_attempts(payment_id,admin_id,idempotency_key,request_hash,reason)
           VALUES($1,$2,$3,$4,$5) RETURNING *`,
          [paymentId, request.actor!.userId, headers.idempotencyKey, hash, reason],
        );
        if (normalDraw) {
          // The draw endpoint locks this order before consuming an entitlement.
          // Commit the freeze before making any external cancellation request.
          await client.query("UPDATE payments SET status='REFUND_REVIEW',version=version+1 WHERE id=$1", [paymentId]);
          await client.query("UPDATE orders SET status='REFUND_REVIEW',version=version+1 WHERE id=$1", [candidate.order_id]);
        }
        await writeAdminAudit(client, request, request.actor!, {
          action: normalDraw ? "PORTONE_DRAW_REFUND_PREPARED" : "PORTONE_LATE_REFUND_PREPARED",
          targetType: "PAYMENT", targetId: paymentId, reason,
          before: { paymentStatus: candidate.status, orderStatus: candidate.order_status },
          after: { cancellationAttemptStatus: "PRECHECK" },
          metadata: { orderId: candidate.order_id, fullAmount: numberValue(candidate.amount), drawFrozen: normalDraw },
        });
        return { attempt: inserted.rows[0]!, replay: false };
      });
      if (prepared.replay) {
        reply.header("x-idempotent-replay", "true");
        return reply.code(202).send(refundAttemptView(prepared.attempt));
      }

      const local = await context.pool.query<{ amount: number; order_id: string }>(
        "SELECT amount,order_id FROM payments WHERE id=$1", [paymentId],
      );
      const expectedAmount = numberValue(local.rows[0]!.amount);
      if (providerPayment.status !== "PAID" || providerPayment.amount.paid !== expectedAmount || providerPayment.amount.cancelled !== 0) {
        const review = await context.pool.query<RefundAttempt>(
          `UPDATE portone_refund_cancellation_attempts SET status='REVIEW_REQUIRED',provider_status=$2,
             last_error_code='PROVIDER_STATE_MISMATCH' WHERE payment_id=$1 AND status='PRECHECK' RETURNING *`,
          [paymentId, providerPayment.status],
        );
        // An already cancelled payment is reconciled by the verified webhook
        // or confirm path, never by sending another cancellation request.
        return reply.code(202).send(refundAttemptView(review.rows[0]!));
      }

      const calling = await withTransaction(context.pool, async (client) => {
        const payment = await client.query<NormalDrawRefundCandidate>(REFUND_CANDIDATE_SQL, [paymentId]);
        const blocker = !payment.rowCount
          ? "결제 정보를 찾을 수 없습니다."
          : payment.rows[0]!.cancelled_at
            ? lateRefundBlocker(payment.rows[0]!)
            : normalDrawRefundBlocker(payment.rows[0]!, "REFUND_REVIEW");
        if (blocker) {
          const review = await client.query<RefundAttempt>(
            `UPDATE portone_refund_cancellation_attempts SET status='REVIEW_REQUIRED',last_error_code='LOCAL_STATE_CHANGED'
             WHERE payment_id=$1 AND status='PRECHECK' RETURNING *`, [paymentId],
          );
          return { attempt: review.rows[0]!, execute: false };
        }
        const changed = await client.query<RefundAttempt>(
          `UPDATE portone_refund_cancellation_attempts SET status='CALLING',provider_status=$2
           WHERE payment_id=$1 AND status='PRECHECK' RETURNING *`, [paymentId, providerPayment.status],
        );
        return { attempt: changed.rows[0]!, execute: true };
      });
      if (!calling.execute) return reply.code(202).send(refundAttemptView(calling.attempt));

      let cancellationId: string | null = null;
      let cancellationOutcome: string | null = null;
      try {
        const cancellation = await adapter.cancelPayment({
          paymentId, currentCancellableAmount: expectedAmount, amount: expectedAmount,
          reason, requester: "ADMIN",
        });
        cancellationId = cancellation.cancellationId;
        cancellationOutcome = cancellation.outcome;
      } catch {
        const unknown = await context.pool.query<RefundAttempt>(
          `UPDATE portone_refund_cancellation_attempts SET status='INDETERMINATE',last_error_code='CANCEL_OUTCOME_UNKNOWN'
           WHERE payment_id=$1 AND status='CALLING' RETURNING *`, [paymentId],
        );
        return reply.code(202).send(refundAttemptView(unknown.rows[0]!));
      }
      let finalStatus = cancellationOutcome === "FAILED" ? "REVIEW_REQUIRED" : "PROVIDER_PENDING";
      let providerStatus: string = providerPayment.status;
      if (cancellationOutcome !== "FAILED") {
        try {
          const result = await reconcilePayment(app, context, {
            id: paymentId, order_id: local.rows[0]!.order_id, amount: expectedAmount,
          });
          providerStatus = result.providerStatus;
          const localState = await context.pool.query<{ status: string }>("SELECT status FROM payments WHERE id=$1", [paymentId]);
          if (result.providerStatus === "CANCELLED" && localState.rows[0]?.status === "REFUNDED") finalStatus = "RECONCILED";
          else if (result.providerStatus === "PARTIAL_CANCELLED" || result.outcome === "review") finalStatus = "REVIEW_REQUIRED";
        } catch {
          finalStatus = "INDETERMINATE";
        }
      }
      const recorded = await context.pool.query<RefundAttempt>(
        `UPDATE portone_refund_cancellation_attempts
         SET status=$2,provider_cancellation_id=$3,provider_status=$4,
             last_error_code=CASE WHEN $2='INDETERMINATE' THEN 'REQUERY_FAILED'
               WHEN $2='REVIEW_REQUIRED' THEN 'PROVIDER_REVIEW_REQUIRED' ELSE NULL END
         WHERE payment_id=$1 AND status='CALLING' RETURNING *`,
        [paymentId, finalStatus, cancellationId, providerStatus],
      );
      return reply.code(202).send(refundAttemptView(recorded.rows[0]!));
  };
  const refundGuard = { preHandler: [requireLiveCommerce(context), context.auth.requirePermission("refunds.cancel")] };
  app.post("/v1/admin/commerce/refund-reviews/:paymentId/cancel", refundGuard, refundHandler);
  app.post("/v1/admin/commerce/payments/:paymentId/refund", refundGuard, refundHandler);

  app.post(
    "/v1/payments/:paymentId/attempt",
    { preHandler: [requireLiveCommerce(context), context.auth.requireUser] },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      configuredContext(context);
      const paymentId = uuidInput((request.params as Record<string, unknown>).paymentId, "paymentId");
      const actorId = request.actor!.userId;
      const claimed = await withTransaction(context.pool, async (client) => {
        const owned = await client.query<{ order_id: string }>(
          `SELECT p.order_id FROM payments p JOIN orders o ON o.id=p.order_id
            WHERE p.id=$1 AND o.user_id=$2`, [paymentId, actorId],
        );
        if (!owned.rowCount) throw notFound("결제 정보를 찾을 수 없습니다.");
        // Match the canonical webhook lock order: room, then payment/order.
        const room = await lockLinkedKujiRoomForOrder(client, owned.rows[0]!.order_id);
        const rows = await client.query<{
          id: string; order_id: string; provider: string; status: string; amount: number;
          pg_attempt_started_at: Date | null; order_status: string; order_kind: string;
          total: number; shipping_request_id: string | null;
        }>(
          `SELECT p.id,p.order_id,p.provider,p.status,p.amount,p.pg_attempt_started_at,
                  o.status AS order_status,o.order_kind,o.total,o.shipping_request_id
             FROM payments p JOIN orders o ON o.id=p.order_id
            WHERE p.id=$1 AND o.user_id=$2 FOR UPDATE OF p,o`,
          [paymentId, actorId],
        );
        if (!rows.rowCount) throw notFound("결제 정보를 찾을 수 없습니다.");
        const row = rows.rows[0]!;
        if (row.provider !== PORTONE_PROVIDER || row.status !== "PENDING"
          || row.order_status !== "PENDING_PAYMENT" || numberValue(row.amount) <= 0
          || numberValue(row.amount) !== numberValue(row.total)) {
          throw conflict("이 주문은 카드 결제를 시작할 수 없습니다.");
        }
        if (row.pg_attempt_started_at) {
          throw new AppError(409, "PAYMENT_ATTEMPT_ALREADY_STARTED", "이미 결제창을 연 주문입니다. 결제사 상태를 다시 확인해 주세요.");
        }
        const now = (await client.query<{ server_now: Date }>("SELECT clock_timestamp() AS server_now")).rows[0]!.server_now;
        if (row.order_kind === "PRODUCT") {
          const reservations = await client.query<{ line_count: string; active_count: string; kuji_count: string }>(
            `SELECT (SELECT count(*) FROM order_lines WHERE order_id=$1) AS line_count,
                    (SELECT count(*) FROM stock_reservations
                      WHERE order_id=$1 AND status='ACTIVE' AND expires_at>$2) AS active_count,
                    (SELECT count(*) FROM order_lines
                      WHERE order_id=$1 AND category_snapshot='kuji') AS kuji_count`,
            [row.order_id, now],
          );
          const stock = reservations.rows[0]!;
          if (numberValue(stock.line_count) < 1
            || numberValue(stock.active_count) !== numberValue(stock.line_count)
            || (numberValue(stock.kuji_count) > 0) !== Boolean(room)) {
            throw conflict("재고 예약 또는 쿠지 결제방을 확인할 수 없습니다.");
          }
          if (room && (room.user_id !== actorId || room.state !== "CHECKOUT_PENDING"
            || room.checkout_expires_at === null || now >= room.checkout_expires_at)) {
            throw conflict("쿠지 결제 대기 시간이 만료되었거나 결제방이 변경되었습니다.");
          }
        } else if (row.order_kind === "SHIPPING_FEE") {
          if (room || !row.shipping_request_id) throw conflict("배송비 결제 신청을 확인할 수 없습니다.");
          const shipping = await client.query<{ status: string; shipping_fee: number }>(
            "SELECT status,shipping_fee FROM shipping_requests WHERE id=$1 AND user_id=$2",
            [row.shipping_request_id, actorId],
          );
          if (!shipping.rowCount || shipping.rows[0]!.status !== "PAYMENT_PENDING"
            || numberValue(shipping.rows[0]!.shipping_fee) !== numberValue(row.amount)) {
            throw conflict("배송비 결제 신청이 변경되었습니다.");
          }
        } else {
          throw conflict("지원하지 않는 결제 주문입니다.");
        }
        const updated = await client.query<{ pg_attempt_started_at: Date }>(
          `UPDATE payments SET pg_attempt_started_at=$2,version=version+1
            WHERE id=$1 AND pg_attempt_started_at IS NULL
           RETURNING pg_attempt_started_at`, [paymentId, now],
        );
        if (!updated.rowCount) throw conflict("이미 결제창을 연 주문입니다.");
        return { accepted: true, paymentId, orderId: row.order_id, startedAt: updated.rows[0]!.pg_attempt_started_at.toISOString() };
      });
      return reply.code(200).send(claimed);
    },
  );

  app.post(
    "/v1/payments/:paymentId/confirm",
    { preHandler: [requireLiveCommerce(context), context.auth.requireUser] },
    async (request, reply) => {
      configuredContext(context);
      const paymentId = uuidInput(
        (request.params as Record<string, unknown>).paymentId,
        "paymentId",
      );
      const payment = await context.pool.query<LocalPayment>(
        `SELECT p.id,p.order_id,p.amount
           FROM payments p
           JOIN orders o ON o.id=p.order_id
          WHERE p.id=$1 AND o.user_id=$2`,
        [paymentId, request.actor!.userId],
      );
      if (!payment.rowCount) throw notFound("결제 정보를 찾을 수 없습니다.");
      const result = await reconcilePayment(app, context, payment.rows[0]!);
      return reply.code(200).send({
        accepted: true,
        paymentId,
        orderId: payment.rows[0]!.order_id,
        ...result,
      });
    },
  );

  app.post("/v1/payments/webhooks/portone", { preHandler: requireLiveCommerce(context) }, async (request, reply) => {
    const config = configuredContext(context);
    if (!request.rawBody) throw badRequest("웹훅 원문이 없습니다.");
    let trigger;
    try {
      trigger = await verifyPortOnePaymentWebhook({
        webhookSecret: config.webhookSecret,
        rawBody: request.rawBody.toString("utf8"),
        headers: request.headers,
        expectedStoreId: config.storeId,
      });
    } catch (error) {
      throw providerError(error);
    }
    const payment = await context.pool.query<LocalPayment>(
      "SELECT id,order_id,amount FROM payments WHERE id=$1 AND provider=$2",
      [trigger.paymentId, PORTONE_PROVIDER],
    );
    if (!payment.rowCount) throw notFound("결제 정보를 찾을 수 없습니다.");
    const result = await reconcilePayment(app, context, payment.rows[0]!);
    return reply.code(202).send({ accepted: true, ...result });
  });
}
