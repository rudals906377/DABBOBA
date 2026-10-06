import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { lockLinkedKujiRoomForOrder, releaseLockedKujiOrderRoom, withTransaction } from "@dabboba/db";
import { adminIdempotentMutation, sendAdminMutation } from "../lib/admin-idempotency.js";
import { adminMutationHeaders, writeAdminAudit, writeOutbox } from "../lib/audit.js";
import { AppError, badRequest, conflict, notFound, unauthorized } from "../lib/errors.js";
import { requireLiveCommerce } from "../lib/commerce-mode.js";
import {
  createPortOneV2Adapter,
  isPortOnePaymentNotFound,
  isPortOneUnsubmittedReady,
  isPortOneUnsubmittedFailure,
  PortOneV2Error,
  type PortOneCardPayment,
} from "../lib/portone-v2.js";
import {
  PortOneWebhookError,
  verifyPortOnePaymentWebhook,
} from "../lib/portone-webhook.js";
import { beginIdempotency, completeIdempotency, idempotencyKey, requestHash } from "../lib/idempotency.js";
import { objectInput, stringInput, uuidInput } from "../lib/input.js";
import { releasePendingOrder } from "../lib/pending-order-release.js";
import { numberValue } from "../lib/rows.js";
import type { ApiContext } from "../types.js";
import { applyCanonicalPaymentEvent, parseCanonicalPaymentEvent } from "./commerce.js";
import { boundPaymentAdapterOptions, isPortOneCardProvider, PORTONE_CARD_PROVIDERS } from "../lib/portone-channel-binding.js";

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
  if (!isPortOneCardProvider(row.provider) || row.status !== "REFUND_REVIEW" || row.order_status !== "REFUND_REVIEW") return "결제와 주문이 모두 환불 검토 상태여야 합니다.";
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
  if (!isPortOneCardProvider(row.provider) || row.status !== expectedStatus || row.order_status !== expectedStatus) {
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

const PRECHECK_STALE_MS = 30_000;
// Review codes where no provider cancellation can be in flight or have moved
// money: the local state changed before CALLING, the provider state did not
// match before CALLING, the provider itself reported the cancellation FAILED,
// or an operator aborted the attempt.
const RESUMABLE_REVIEW_CODES = new Set([
  "LOCAL_STATE_CHANGED",
  "PROVIDER_STATE_MISMATCH",
  "PROVIDER_CANCEL_FAILED",
]);

/**
 * Whether a later request may reuse this payment's single attempt row after a
 * fresh provider read and full local recheck. CALLING, PROVIDER_PENDING,
 * INDETERMINATE and RECONCILED are never resumable: a cancellation may be in
 * flight or already applied.
 */
export function refundAttemptResumable(
  attempt: Pick<RefundAttempt, "status" | "last_error_code" | "updated_at">,
  now = Date.now(),
): boolean {
  if (attempt.status === "PRECHECK") return now - attempt.updated_at.getTime() >= PRECHECK_STALE_MS;
  if (attempt.status === "PRECHECK_FAILED") return true;
  return attempt.status === "REVIEW_REQUIRED" && RESUMABLE_REVIEW_CODES.has(attempt.last_error_code ?? "");
}

/** Aborting is resumable-state only, and not already aborted. */
export function refundAttemptAbortable(
  attempt: Pick<RefundAttempt, "status" | "last_error_code" | "updated_at">,
  now = Date.now(),
): boolean {
  return attempt.status !== "PRECHECK_FAILED" && refundAttemptResumable(attempt, now);
}

export function refundCandidateEligibility(
  candidate: NormalDrawRefundCandidate,
  resuming: boolean,
): { blocker: string | null; normalDraw: boolean; freeze: boolean } {
  if (candidate.status === "PAID" && candidate.order_status === "PAID") {
    return { blocker: normalDrawRefundBlocker(candidate, "PAID"), normalDraw: true, freeze: true };
  }
  // A resumed normal-draw attempt finds the order still frozen by the first.
  if (resuming && !candidate.cancelled_at
    && candidate.status === "REFUND_REVIEW" && candidate.order_status === "REFUND_REVIEW") {
    return { blocker: normalDrawRefundBlocker(candidate, "REFUND_REVIEW"), normalDraw: true, freeze: false };
  }
  return { blocker: lateRefundBlocker(candidate), normalDraw: false, freeze: false };
}

/** The provider holds exactly the full paid amount with no cancellation of any kind. */
export function portOnePaymentFullyCancellable(payment: PortOneCardPayment, expectedAmount: number): boolean {
  return payment.status === "PAID"
    && payment.amount.paid === expectedAmount
    && payment.amount.cancelled === 0
    && payment.cancellations.every((cancellation) => cancellation.outcome === "FAILED");
}

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

const CONFIRM_RATE_LIMIT_PER_MINUTE = 6;
const ABANDON_IDEMPOTENCY_SCOPE = "ABANDON_PAYMENT_WINDOW";

/**
 * Provider-equivalent status for a local payment that no customer confirm can
 * change. A cancellation after the PG window was claimed stays open: PortOne
 * may still report a late charge that needs refund review.
 */
export function settledLocalPaymentProviderStatus(
  localStatus: string,
  pgAttemptStartedAt: Date | null,
): PortOneCardPayment["status"] | null {
  if (localStatus === "PAID") return "PAID";
  if (localStatus === "FAILED") return "FAILED";
  if (localStatus === "REFUNDED") return "CANCELLED";
  if (localStatus === "CANCELLED" && !pgAttemptStartedAt) return "CANCELLED";
  return null;
}

/**
 * NONE only when PortOne holds no money and no approval is in flight. READY
 * (window opened, nothing submitted) and terminal no-charge FAILED/CANCELLED
 * qualify; PAY_PENDING, virtual accounts, any paid/cancelled amount, or any
 * cancellation record are evidence that the order must not be released. The
 * exact unsubmitted KG READY amount projection is not settlement evidence.
 */
export function portOnePaymentEvidence(payment: PortOneCardPayment): "NONE" | "PRESENT" {
  // Zero money is not proof of no charge when an authenticated approval
  // timestamp or PG transaction contradicts it. Card selection alone is not
  // approval evidence: it may precede submission to the PG.
  if (payment.paidAt !== null || payment.pgTransactionId !== null) return "PRESENT";
  if (isPortOneUnsubmittedReady(payment) || isPortOneUnsubmittedFailure(payment)) return "NONE";
  const noMoney = payment.amount.paid === 0 && payment.amount.cancelled === 0 && payment.cancellations.length === 0;
  if (!noMoney) return "PRESENT";
  return payment.status === "READY" || payment.status === "FAILED" || payment.status === "CANCELLED"
    ? "NONE"
    : "PRESENT";
}

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
    const status = error.code === "WEBHOOK_TOO_LARGE"
      ? 413
      : error.code === "WEBHOOK_CONTRACT_MISMATCH" ? 422 : 401;
    return new AppError(status, error.code, "포트원 웹훅을 검증하지 못했습니다.");
  }
  return new AppError(502, "PAYMENT_PROVIDER_UNAVAILABLE", "결제사 상태를 확인하지 못했습니다.");
}

export function normalizedPortOneEventForPayment(
  payment: PortOneCardPayment,
): NormalizedProviderEvent | null {
  if (isPortOneUnsubmittedReady(payment)) return null;
  let eventType: NormalizedEventType;
  let amount = payment.amount.total;
  const hasMoneyBeforeSettlement = ["READY", "PAY_PENDING", "VIRTUAL_ACCOUNT_ISSUED", "FAILED"].includes(payment.status)
    && (payment.amount.paid > 0 || payment.amount.cancelled > 0)
    && !isPortOneUnsubmittedFailure(payment);
  const paidWithCancellation = payment.status === "PAID" && payment.amount.cancelled > 0;
  const hasApprovalBeforeSettlement = (payment.paidAt !== null || payment.pgTransactionId !== null)
    && (["READY", "PAY_PENDING", "VIRTUAL_ACCOUNT_ISSUED", "FAILED"].includes(payment.status)
      || (payment.status === "CANCELLED" && payment.amount.paid === 0 && payment.amount.cancelled === 0));

  if (hasMoneyBeforeSettlement || paidWithCancellation || hasApprovalBeforeSettlement) {
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
    ...(hasApprovalBeforeSettlement ? {
      paidAt: payment.paidAt,
      pgTransactionId: payment.pgTransactionId,
    } : {}),
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
  context: ApiContext,
  event: NormalizedProviderEvent,
  correlationId: string,
) {
  // The event was derived from a fresh authenticated PortOne read, so it is
  // applied in-process. No shared-secret HTTP hop exists in PortOne mode.
  const rawBody = JSON.stringify(event);
  const payload = JSON.parse(rawBody) as Record<string, unknown>;
  const { provider } = await boundPaymentAdapterOptions(context.pool, context.config, event.paymentId);
  const digest = createHash("sha256").update(`internal:${provider}:${rawBody}`).digest("hex");
  return applyCanonicalPaymentEvent(
    context,
    parseCanonicalPaymentEvent(provider, payload, digest),
    correlationId,
  );
}

async function reconcilePayment(
  context: ApiContext,
  correlationId: string,
  localPayment: LocalPayment,
  {
    retryReviewedRefund = false,
    reportMissingProviderPayment = false,
  }: { retryReviewedRefund?: boolean; reportMissingProviderPayment?: boolean } = {},
) {
  const config = configuredContext(context);
  const bound = await boundPaymentAdapterOptions(context.pool, context.config, localPayment.id);
  const adapter = createPortOneV2Adapter(bound.options);
  let payment: PortOneCardPayment;
  try {
    payment = await adapter.getPayment({
      paymentId: localPayment.id,
      expectedTotalAmount: numberValue(localPayment.amount),
    });
  } catch (error) {
    // Only the worker requery reports an authoritative "no payment" result;
    // it never changes local state here.
    if (reportMissingProviderPayment && isPortOnePaymentNotFound(error)) {
      return { providerStatus: null, outcome: "provider_not_found" as const };
    }
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
  const outcome = await dispatchCanonicalEvent(context, event, correlationId);
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
        "SELECT id,order_id,amount,status,pg_attempt_started_at FROM payments WHERE id=$1 AND provider=ANY($2::text[])",
        [paymentId, [...PORTONE_CARD_PROVIDERS]],
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
      const result = await reconcilePayment(context, request.id, current, { reportMissingProviderPayment: true });
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
          WHERE p.id=$1 AND p.provider=ANY($2::text[])`,
        [paymentId, [...PORTONE_CARD_PROVIDERS]],
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
      const result = await reconcilePayment(context, request.id, current, {
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
      const observation = await reconcilePayment(context, request.id, {
        id: paymentId, order_id: current.order_id, amount: numberValue(current.amount),
      }, { retryReviewedRefund: localBefore.rows[0]?.status === "REFUND_REVIEW" });
      const local = await context.pool.query<{ status: string }>("SELECT status FROM payments WHERE id=$1", [paymentId]);
      const providerReview = observation.providerStatus === "PARTIAL_CANCELLED" || observation.outcome === "review";
      const status = observation.providerStatus === "CANCELLED" && local.rows[0]?.status === "REFUNDED"
        ? "RECONCILED"
        : providerReview
          ? "REVIEW_REQUIRED"
          : current.status === "INDETERMINATE" || current.status === "CALLING"
            ? "INDETERMINATE" : current.status;
      const recorded = await withTransaction(context.pool, async (client) => {
        const changed = await client.query<RefundAttempt>(
          `UPDATE portone_refund_cancellation_attempts
           SET status=$2,provider_status=$3,last_error_code=CASE
             WHEN $2='RECONCILED' THEN NULL
             WHEN $4::boolean THEN 'PROVIDER_REVIEW_REQUIRED'
             WHEN $2='REVIEW_REQUIRED' AND last_error_code IS NULL THEN 'PROVIDER_REVIEW_REQUIRED'
             ELSE last_error_code END
           WHERE payment_id=$1 RETURNING *`, [paymentId, status, observation.providerStatus, providerReview],
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
      // One durable attempt row per payment. A different request may resume it
      // only when no provider cancellation can be in flight (see
      // refundAttemptResumable); otherwise it stays an operator review item.
      let resuming = false;
      if (existingAttempt.rowCount) {
        const attempt = existingAttempt.rows[0]!;
        if (attempt.idempotency_key === headers.idempotencyKey && attempt.request_hash === hash) {
          reply.header("x-idempotent-replay", "true");
          return reply.code(202).send(refundAttemptView(attempt));
        }
        if (!refundAttemptResumable(attempt)) {
          throw conflict("이 결제에는 이미 취소 요청이 있습니다. 결과를 대사한 뒤 운영 검토해 주세요.");
        }
        resuming = true;
      }
      const candidateBeforeLookup = await context.pool.query<NormalDrawRefundCandidate>(
        REFUND_CANDIDATE_LOOKUP_SQL,
        [paymentId],
      );
      if (!candidateBeforeLookup.rowCount) throw notFound("결제 정보를 찾을 수 없습니다.");
      const preflight = candidateBeforeLookup.rows[0]!;
      const preflightBlocker = refundCandidateEligibility(preflight, resuming).blocker;
      if (preflightBlocker) throw conflict(preflightBlocker);

      // A provider read is safe before the order freeze: the locked transaction
      // below rechecks every asset before any cancellation can be sent. A failed
      // read must not strand a paid customer in REFUND_REVIEW with no retry path.
      const adapter = createPortOneV2Adapter((await boundPaymentAdapterOptions(context.pool, context.config, paymentId)).options);
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
        const previous = existing.rows[0] ?? null;
        if (previous) {
          if (previous.idempotency_key === headers.idempotencyKey && previous.request_hash === hash) {
            return { attempt: previous, replay: true };
          }
          if (!refundAttemptResumable(previous)) {
            throw conflict("이 결제에는 이미 취소 요청이 있습니다. 결과를 대사한 뒤 운영 검토해 주세요.");
          }
        }
        const candidate = payment.rows[0]!;
        const eligibility = refundCandidateEligibility(candidate, Boolean(previous));
        if (eligibility.blocker) throw conflict(eligibility.blocker);
        const attempt = previous
          ? await client.query<RefundAttempt>(
            `UPDATE portone_refund_cancellation_attempts
                SET admin_id=$2,idempotency_key=$3,request_hash=$4,reason=$5,status='PRECHECK',
                    provider_cancellation_id=NULL,provider_status=NULL,last_error_code=NULL
              WHERE payment_id=$1 AND idempotency_key=$6 AND status=$7 RETURNING *`,
            [paymentId, request.actor!.userId, headers.idempotencyKey, hash, reason,
              previous.idempotency_key, previous.status],
          )
          : await client.query<RefundAttempt>(
            `INSERT INTO portone_refund_cancellation_attempts(payment_id,admin_id,idempotency_key,request_hash,reason)
             VALUES($1,$2,$3,$4,$5) RETURNING *`,
            [paymentId, request.actor!.userId, headers.idempotencyKey, hash, reason],
          );
        if (!attempt.rowCount) throw conflict("취소 요청 상태가 변경되었습니다. 다시 조회해 주세요.");
        if (eligibility.freeze) {
          // The draw endpoint locks this order before consuming an entitlement.
          // Commit the freeze before making any external cancellation request.
          await client.query("UPDATE payments SET status='REFUND_REVIEW',version=version+1 WHERE id=$1", [paymentId]);
          await client.query("UPDATE orders SET status='REFUND_REVIEW',version=version+1 WHERE id=$1", [candidate.order_id]);
        }
        await writeAdminAudit(client, request, request.actor!, {
          action: previous
            ? "PORTONE_REFUND_ATTEMPT_RESUMED"
            : eligibility.normalDraw ? "PORTONE_DRAW_REFUND_PREPARED" : "PORTONE_LATE_REFUND_PREPARED",
          targetType: "PAYMENT", targetId: paymentId, reason,
          before: {
            paymentStatus: candidate.status, orderStatus: candidate.order_status,
            ...(previous ? {
              cancellationAttemptStatus: previous.status,
              lastErrorCode: previous.last_error_code,
              providerCancellationId: previous.provider_cancellation_id,
              providerStatus: previous.provider_status,
            } : {}),
          },
          after: { cancellationAttemptStatus: "PRECHECK" },
          metadata: {
            orderId: candidate.order_id, fullAmount: numberValue(candidate.amount),
            drawFrozen: eligibility.freeze, normalDraw: eligibility.normalDraw,
            freshProviderStatus: providerPayment.status,
          },
        });
        return { attempt: attempt.rows[0]!, replay: false };
      });
      if (prepared.replay) {
        reply.header("x-idempotent-replay", "true");
        return reply.code(202).send(refundAttemptView(prepared.attempt));
      }
      const ownKey = headers.idempotencyKey;

      const local = await context.pool.query<{ amount: number; order_id: string }>(
        "SELECT amount,order_id FROM payments WHERE id=$1", [paymentId],
      );
      const expectedAmount = numberValue(local.rows[0]!.amount);
      if (!portOnePaymentFullyCancellable(providerPayment, expectedAmount)) {
        const review = await context.pool.query<RefundAttempt>(
          `UPDATE portone_refund_cancellation_attempts SET status='REVIEW_REQUIRED',provider_status=$2,
             last_error_code='PROVIDER_STATE_MISMATCH'
           WHERE payment_id=$1 AND status='PRECHECK' AND idempotency_key=$3 RETURNING *`,
          [paymentId, providerPayment.status, ownKey],
        );
        if (!review.rowCount) throw conflict("취소 요청 상태가 변경되었습니다. 다시 조회해 주세요.");
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
             WHERE payment_id=$1 AND status='PRECHECK' AND idempotency_key=$2 RETURNING *`, [paymentId, ownKey],
          );
          if (!review.rowCount) throw conflict("취소 요청 상태가 변경되었습니다. 다시 조회해 주세요.");
          return { attempt: review.rows[0]!, execute: false };
        }
        // Scoping to this request's key means a stale request whose attempt
        // was resumed by another operator can never reach the provider call.
        const changed = await client.query<RefundAttempt>(
          `UPDATE portone_refund_cancellation_attempts SET status='CALLING',provider_status=$2
           WHERE payment_id=$1 AND status='PRECHECK' AND idempotency_key=$3 RETURNING *`,
          [paymentId, providerPayment.status, ownKey],
        );
        if (!changed.rowCount) throw conflict("취소 요청 상태가 변경되었습니다. 다시 조회해 주세요.");
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
        // INDETERMINATE is terminal for automation: it is never resumable.
        const unknown = await context.pool.query<RefundAttempt>(
          `UPDATE portone_refund_cancellation_attempts SET status='INDETERMINATE',last_error_code='CANCEL_OUTCOME_UNKNOWN'
           WHERE payment_id=$1 AND status='CALLING' AND idempotency_key=$2 RETURNING *`, [paymentId, ownKey],
        );
        return reply.code(202).send(refundAttemptView(unknown.rows[0]!));
      }
      let finalStatus = cancellationOutcome === "FAILED" ? "REVIEW_REQUIRED" : "PROVIDER_PENDING";
      let providerStatus: string | null = providerPayment.status;
      if (cancellationOutcome !== "FAILED") {
        try {
          const result = await reconcilePayment(context, request.id, {
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
      // A provider-reported FAILED cancellation moved no money, so it keeps a
      // distinct code that a later request may resume after a fresh read.
      const recorded = await context.pool.query<RefundAttempt>(
        `UPDATE portone_refund_cancellation_attempts
         SET status=$2,provider_cancellation_id=$3,provider_status=$4,
             last_error_code=CASE WHEN $2='INDETERMINATE' THEN 'REQUERY_FAILED'
               WHEN $2='REVIEW_REQUIRED' AND $6::boolean THEN 'PROVIDER_CANCEL_FAILED'
               WHEN $2='REVIEW_REQUIRED' THEN 'PROVIDER_REVIEW_REQUIRED' ELSE NULL END
         WHERE payment_id=$1 AND status='CALLING' AND idempotency_key=$5 RETURNING *`,
        [paymentId, finalStatus, cancellationId, providerStatus, ownKey, cancellationOutcome === "FAILED"],
      );
      return reply.code(202).send(refundAttemptView(recorded.rows[0]!));
  };
  const refundGuard = { preHandler: [requireLiveCommerce(context), context.auth.requirePermission("refunds.cancel")] };
  app.post("/v1/admin/commerce/refund-reviews/:paymentId/cancel", refundGuard, refundHandler);
  app.post("/v1/admin/commerce/payments/:paymentId/refund", refundGuard, refundHandler);

  app.post(
    "/v1/admin/commerce/refund-reviews/:paymentId/cancellation/abort",
    { preHandler: [requireLiveCommerce(context), context.auth.requirePermission("refunds.cancel")] },
    async (request, reply) => {
      const config = configuredContext(context);
      const paymentId = uuidInput((request.params as Record<string, unknown>).paymentId, "paymentId");
      const body = objectInput(request.body);
      const reason = stringInput(body, "reason", { min: 2, max: 500 })!;
      adminMutationHeaders(request, reason);
      const attempt = await context.pool.query<RefundAttempt & { amount: number }>(
        `SELECT a.*,p.amount FROM portone_refund_cancellation_attempts a
         JOIN payments p ON p.id=a.payment_id WHERE a.payment_id=$1`, [paymentId],
      );
      if (!attempt.rowCount) throw notFound("결제 취소 요청 내역을 찾을 수 없습니다.");
      const expectedAmount = numberValue(attempt.rows[0]!.amount);
      // Fresh authoritative read: aborting is allowed only while PortOne
      // confirms the full payment is intact and no cancellation exists.
      let providerPayment: PortOneCardPayment;
      try {
        providerPayment = await createPortOneV2Adapter((await boundPaymentAdapterOptions(context.pool, context.config, paymentId)).options).getPayment({ paymentId, expectedTotalAmount: expectedAmount });
      } catch (error) {
        throw providerError(error);
      }
      const result = await adminIdempotentMutation(context, request, {
        target: { type: "PORTONE_REFUND_ATTEMPT", paymentId },
        bodyReason: reason,
        work: async (client) => {
          const payment = await client.query<NormalDrawRefundCandidate>(REFUND_CANDIDATE_SQL, [paymentId]);
          if (!payment.rowCount) throw notFound("결제 정보를 찾을 수 없습니다.");
          const locked = await client.query<RefundAttempt>(
            "SELECT * FROM portone_refund_cancellation_attempts WHERE payment_id=$1 FOR UPDATE", [paymentId],
          );
          const current = locked.rows[0];
          if (!current) throw notFound("결제 취소 요청 내역을 찾을 수 없습니다.");
          if (!refundAttemptAbortable(current)) {
            throw conflict("결제사 취소 요청 이전 단계의 요청만 중단할 수 있습니다.");
          }
          if (!portOnePaymentFullyCancellable(providerPayment, expectedAmount)) {
            throw new AppError(409, "PROVIDER_STATE_MISMATCH", "결제사에서 취소 또는 금액 변경이 확인되어 중단할 수 없습니다. 결제 상태를 대사해 주세요.");
          }
          const candidate = payment.rows[0]!;
          // A normal draw refund froze PAID/PAID into REFUND_REVIEW before the
          // attempt. Restore exactly that paid state after rechecking every
          // local asset; any other state (e.g. a late-success review) stays.
          const frozenDraw = !candidate.cancelled_at
            && candidate.status === "REFUND_REVIEW" && candidate.order_status === "REFUND_REVIEW";
          if (frozenDraw) {
            const blocker = normalDrawRefundBlocker(candidate, "REFUND_REVIEW");
            if (blocker) throw conflict(blocker);
            const restoredPayment = await client.query(
              "UPDATE payments SET status='PAID',version=version+1 WHERE id=$1 AND status='REFUND_REVIEW' RETURNING id",
              [paymentId],
            );
            const restoredOrder = await client.query(
              "UPDATE orders SET status='PAID',version=version+1 WHERE id=$1 AND status='REFUND_REVIEW' RETURNING id",
              [candidate.order_id],
            );
            if (!restoredPayment.rowCount || !restoredOrder.rowCount) throw conflict("결제 상태가 변경되었습니다.");
          }
          const aborted = await client.query<RefundAttempt>(
            `UPDATE portone_refund_cancellation_attempts
                SET status='PRECHECK_FAILED',last_error_code='ABORTED_BY_ADMIN',provider_status=$2
              WHERE payment_id=$1 AND status=$3 AND idempotency_key=$4 RETURNING *`,
            [paymentId, providerPayment.status, current.status, current.idempotency_key],
          );
          if (!aborted.rowCount) throw conflict("취소 요청 상태가 변경되었습니다. 다시 조회해 주세요.");
          const after = await client.query<{ status: string; order_status: string }>(
            "SELECT p.status,o.status AS order_status FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=$1",
            [paymentId],
          );
          await writeAdminAudit(client, request, request.actor!, {
            action: "PORTONE_REFUND_ATTEMPT_ABORTED", targetType: "PAYMENT", targetId: paymentId, reason,
            before: {
              cancellationAttemptStatus: current.status, lastErrorCode: current.last_error_code,
              paymentStatus: candidate.status, orderStatus: candidate.order_status,
            },
            after: {
              cancellationAttemptStatus: "PRECHECK_FAILED",
              paymentStatus: after.rows[0]!.status, orderStatus: after.rows[0]!.order_status,
            },
            metadata: { orderId: candidate.order_id, unfrozen: frozenDraw, providerStatus: providerPayment.status },
          });
          await writeOutbox(client, request.id, {
            aggregateType: "PAYMENT", aggregateId: paymentId, eventType: "payment.refund_attempt_aborted",
            payload: { paymentId, orderId: candidate.order_id, unfrozen: frozenDraw },
          });
          return {
            statusCode: 200,
            body: refundAttemptView(aborted.rows[0]!, after.rows[0]!.status),
            resourceType: "PAYMENT",
            resourceId: paymentId,
          };
        },
      });
      return sendAdminMutation(reply, result);
    },
  );

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
        if (!isPortOneCardProvider(row.provider) || row.status !== "PENDING"
          || row.order_status !== "PENDING_PAYMENT" || numberValue(row.amount) <= 0
          || numberValue(row.amount) !== numberValue(row.total)) {
          throw conflict("이 주문은 카드 결제를 시작할 수 없습니다.");
        }
        if (row.pg_attempt_started_at) {
          throw new AppError(409, "PAYMENT_ATTEMPT_ALREADY_STARTED", "이미 결제창을 연 주문입니다. 결제사 상태를 다시 확인해 주세요.");
        }
        await boundPaymentAdapterOptions(client, context.config, paymentId);
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
    {
      preHandler: [requireLiveCommerce(context), context.auth.requireUser],
      // Every call is a live PortOne read. Bound it per client so a looping
      // client cannot exhaust the provider API quota for everyone.
      config: { rateLimit: { max: CONFIRM_RATE_LIMIT_PER_MINUTE, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      configuredContext(context);
      const paymentId = uuidInput(
        (request.params as Record<string, unknown>).paymentId,
        "paymentId",
      );
      const payment = await context.pool.query<LocalPayment & { status: string; pg_attempt_started_at: Date | null }>(
        `SELECT p.id,p.order_id,p.amount,p.status,p.pg_attempt_started_at
           FROM payments p
           JOIN orders o ON o.id=p.order_id
          WHERE p.id=$1 AND o.user_id=$2`,
        [paymentId, request.actor!.userId],
      );
      if (!payment.rowCount) throw notFound("결제 정보를 찾을 수 없습니다.");
      const current = payment.rows[0]!;
      const settledProviderStatus = settledLocalPaymentProviderStatus(current.status, current.pg_attempt_started_at);
      if (settledProviderStatus) {
        // A settled payment cannot change through a customer confirm. Late
        // provider changes still arrive through the PortOne webhook, the
        // worker requery, and the audited admin requery.
        return reply.code(200).send({
          accepted: true,
          paymentId,
          orderId: current.order_id,
          providerStatus: settledProviderStatus,
          outcome: "already_settled",
          localStatus: current.status,
        });
      }
      const result = await reconcilePayment(context, request.id, current);
      return reply.code(200).send({
        accepted: true,
        paymentId,
        orderId: current.order_id,
        ...result,
      });
    },
  );

  app.post(
    "/v1/payments/:paymentId/abandon",
    {
      preHandler: [requireLiveCommerce(context), context.auth.requireUser],
      config: { rateLimit: { max: CONFIRM_RATE_LIMIT_PER_MINUTE, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      const config = configuredContext(context);
      const paymentId = uuidInput((request.params as Record<string, unknown>).paymentId, "paymentId");
      const key = idempotencyKey(request.headers);
      const hash = requestHash({ paymentId });
      const actorId = request.actor!.userId;

      // Replays never repeat the provider read. The key row is only written by
      // the committing transaction below, so a crash cannot strand it.
      const prior = await context.pool.query<{
        request_hash: string; state: string; response_status: number | null; response_body: unknown;
      }>(
        `SELECT request_hash,state,response_status,response_body FROM idempotency_keys
          WHERE actor_id=$1 AND scope=$2 AND idempotency_key=$3 AND expires_at>now()`,
        [actorId, ABANDON_IDEMPOTENCY_SCOPE, key],
      );
      const priorRow = prior.rows[0];
      if (priorRow) {
        if (priorRow.request_hash !== hash) throw conflict("같은 Idempotency-Key를 다른 요청에 재사용할 수 없습니다.");
        if (priorRow.state === "COMPLETED" && priorRow.response_status && priorRow.response_body !== null) {
          reply.header("x-idempotent-replay", "true");
          return reply.code(priorRow.response_status).send(priorRow.response_body);
        }
      }

      const owned = await context.pool.query<LocalPayment & { provider: string }>(
        `SELECT p.id,p.order_id,p.amount,p.provider FROM payments p JOIN orders o ON o.id=p.order_id
          WHERE p.id=$1 AND o.user_id=$2`,
        [paymentId, actorId],
      );
      if (!owned.rowCount) throw notFound("결제 정보를 찾을 수 없습니다.");
      const local = owned.rows[0]!;
      if (!isPortOneCardProvider(local.provider)) throw conflict("카드 결제 주문이 아닙니다.");

      // Fresh authoritative read. Only "PortOne has no payment for this
      // window" may release the order; any money movement or in-flight
      // approval leaves every local record untouched.
      let providerStatus: "READY" | "PAYMENT_NOT_FOUND" | "FAILED" | "CANCELLED";
      let providerPayment: PortOneCardPayment | null = null;
      try {
        providerPayment = await createPortOneV2Adapter((await boundPaymentAdapterOptions(context.pool, context.config, paymentId)).options).getPayment({
          paymentId,
          expectedTotalAmount: numberValue(local.amount),
        });
      } catch (error) {
        if (!isPortOnePaymentNotFound(error)) throw providerError(error);
      }
      if (!providerPayment) {
        providerStatus = "PAYMENT_NOT_FOUND";
      } else {
        const evidence = portOnePaymentEvidence(providerPayment);
        if (evidence !== "NONE") {
          throw new AppError(
            409,
            "PAYMENT_EVIDENCE_PRESENT",
            "결제사에 결제 진행 기록이 있어 결제를 취소할 수 없습니다. 결제 상태를 다시 확인해 주세요.",
          );
        }
        providerStatus = providerPayment.status as typeof providerStatus;
        if (providerPayment.status !== "READY") {
          // PortOne already closed the window without money. Apply that
          // provider-authoritative terminal state through the canonical path.
          const event = normalizedPortOneEventForPayment(providerPayment);
          if (!event || (event.eventType !== "PAYMENT_FAILED" && event.eventType !== "PAYMENT_CANCELLED")) {
            throw new AppError(409, "PAYMENT_EVIDENCE_PRESENT", "결제사 상태를 다시 확인해 주세요.");
          }
          await dispatchCanonicalEvent(context, event, request.id);
        }
      }

      const result = await withTransaction(context.pool, async (client) => {
        const idem = await beginIdempotency(client, {
          actorId, scope: ABANDON_IDEMPOTENCY_SCOPE, key, hash,
        });
        if (!idem.fresh) return { replay: true, statusCode: idem.statusCode, body: idem.body };
        // Match the canonical webhook lock order: room, then payment/order.
        const room = await lockLinkedKujiRoomForOrder(client, local.order_id);
        const rows = await client.query<{
          payment_status: string; provider: string; order_id: string; user_id: string;
          order_status: string; point_total: number; order_kind: "PRODUCT" | "SHIPPING_FEE";
          shipping_request_id: string | null;
        }>(
          `SELECT p.status AS payment_status,p.provider,o.id AS order_id,o.user_id,o.status AS order_status,
                  o.point_total,o.order_kind,o.shipping_request_id
             FROM payments p JOIN orders o ON o.id=p.order_id
            WHERE p.id=$1 AND o.user_id=$2 FOR UPDATE OF p,o`,
          [paymentId, actorId],
        );
        if (!rows.rowCount) throw notFound("결제 정보를 찾을 수 없습니다.");
        const row = rows.rows[0]!;
        if (row.order_id !== local.order_id || row.provider !== local.provider || !isPortOneCardProvider(row.provider)) {
          throw conflict("결제 정보가 변경되었습니다.");
        }
        let outcome: "cancelled" | "already_closed";
        if (row.payment_status === "PENDING" && row.order_status === "PENDING_PAYMENT") {
          const serverNow = (await client.query<{ server_now: Date }>("SELECT clock_timestamp() AS server_now")).rows[0]!.server_now;
          await releasePendingOrder(client, {
            id: row.order_id, user_id: row.user_id, point_total: row.point_total,
            order_kind: row.order_kind, shipping_request_id: row.shipping_request_id,
          }, "PAYMENT_WINDOW_ABANDONED");
          await client.query(
            "UPDATE payments SET status='CANCELLED',version=version+1 WHERE id=$1 AND status='PENDING'",
            [paymentId],
          );
          await client.query(
            "UPDATE orders SET status='CANCELLED',cancelled_at=$2,version=version+1 WHERE id=$1 AND status='PENDING_PAYMENT'",
            [row.order_id, serverNow],
          );
          if (room) {
            await releaseLockedKujiOrderRoom(client, { orderId: row.order_id, serverNow, terminalState: "CANCELLED" });
          }
          await writeOutbox(client, request.id, {
            aggregateType: "ORDER", aggregateId: row.order_id, eventType: "order.cancelled",
            payload: { orderId: row.order_id, reason: "PAYMENT_WINDOW_ABANDONED" },
          });
          await writeOutbox(client, request.id, {
            aggregateType: "PAYMENT", aggregateId: paymentId, eventType: "payment.window_abandoned",
            payload: { paymentId, orderId: row.order_id, userId: actorId, providerStatus },
          });
          outcome = "cancelled";
        } else if (["CANCELLED", "FAILED"].includes(row.payment_status) && row.order_status === "CANCELLED") {
          outcome = "already_closed";
        } else {
          throw new AppError(
            409,
            "PAYMENT_EVIDENCE_PRESENT",
            "이미 결제 상태가 변경된 주문입니다. 결제 상태를 다시 확인해 주세요.",
          );
        }
        const status = await client.query<{ payment_status: string; order_status: string }>(
          `SELECT p.status AS payment_status,o.status AS order_status
             FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=$1`,
          [paymentId],
        );
        const body = {
          accepted: true,
          paymentId,
          orderId: row.order_id,
          outcome,
          providerStatus,
          localStatus: status.rows[0]!.payment_status,
          orderStatus: status.rows[0]!.order_status,
        };
        await completeIdempotency(client, idem.id, {
          statusCode: 200, body, resourceType: "PAYMENT", resourceId: paymentId,
        });
        return { replay: false, statusCode: 200, body };
      });
      if (result.replay) reply.header("x-idempotent-replay", "true");
      return reply.code(result.statusCode).send(result.body);
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
      "SELECT id,order_id,amount FROM payments WHERE id=$1 AND provider=ANY($2::text[])",
      [trigger.paymentId, [...PORTONE_CARD_PROVIDERS]],
    );
    if (!payment.rowCount) throw notFound("결제 정보를 찾을 수 없습니다.");
    const result = await reconcilePayment(context, request.id, payment.rows[0]!);
    return reply.code(202).send({ accepted: true, ...result });
  });
}
