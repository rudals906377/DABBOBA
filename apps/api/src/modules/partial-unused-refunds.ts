import type { FastifyInstance } from "fastify";
import { lockLinkedKujiRoomForOrder, withTransaction, type DatabaseClient, type Queryable } from "@dabboba/db";
import { adminMutationHeaders, writeAdminAudit } from "../lib/audit.js";
import { requireLiveCommerce } from "../lib/commerce-mode.js";
import { conflict, notFound } from "../lib/errors.js";
import { requestHash } from "../lib/idempotency.js";
import { objectInput, stringInput, uuidInput } from "../lib/input.js";
import { boundPaymentAdapterOptions, isPortOneCardProvider } from "../lib/portone-channel-binding.js";
import { createPortOneV2Adapter, type PortOneCardPayment } from "../lib/portone-v2.js";
import { nullableIso, numberValue } from "../lib/rows.js";
import type { ApiContext } from "../types.js";
import {
  applyPlannedPartialUnusedRefund,
  PARTIAL_REFUND_OPEN_STATUSES,
  partialUnusedRefundAmounts,
  type PartialUnusedRefundRow,
} from "./partial-unused-refund-apply.js";
import { POINT_ORDER_PAYMENT_PROVIDER } from "./point-order-refunds.js";
import {
  configuredContext,
  drawRefundOrderBlocker,
  portOnePaymentFullyCancellable,
  providerError,
  reconcilePayment,
  REFUND_CANDIDATE_LOOKUP_SQL,
  type NormalDrawRefundCandidate,
} from "./portone-payments.js";

export type PartialUnusedRefundCandidate = NormalDrawRefundCandidate & {
  user_id: string;
  gacha_line_count: number | string;
};

const PARTIAL_CANDIDATE_SQL = `SELECT candidate.*,o.user_id,
  (SELECT count(*) FROM order_lines line WHERE line.order_id=candidate.order_id AND line.category_snapshot='gacha') AS gacha_line_count
  FROM (${REFUND_CANDIDATE_LOOKUP_SQL}) candidate JOIN orders o ON o.id=candidate.order_id`;

async function loadCandidate(queryable: Queryable, paymentId: string, lock: boolean) {
  if (lock) {
    // Lock the payment and order rows first, then read every count in a new
    // statement so draws committed while this request waited are included.
    await queryable.query("SELECT p.id FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=$1 FOR UPDATE OF p,o", [paymentId]);
  }
  const result = await queryable.query<PartialUnusedRefundCandidate>(PARTIAL_CANDIDATE_SQL, [paymentId]);
  return result.rows[0] ?? null;
}

/**
 * A partial refund covers a PAID gacha order with at least one used and one
 * unused draw. An entirely unused order uses the full refund instead. Kuji
 * orders are excluded: their tickets are bound to sealed slots and kuji is not
 * part of the first launch.
 */
export function partialUnusedRefundPlan(row: PartialUnusedRefundCandidate):
  { blocker: string; plan: null } | { blocker: null; plan: ReturnType<typeof partialUnusedRefundAmounts> & {
    totalDrawUnits: number; unusedDrawUnits: number; paidCardAmount: number; paidPointAmount: number;
  } } {
  const blocked = (blocker: string) => ({ blocker, plan: null });
  if (row.status !== "PAID" || row.order_status !== "PAID") return blocked("결제와 주문이 결제 완료 상태일 때만 부분 환불할 수 있습니다.");
  if (!isPortOneCardProvider(row.provider) && row.provider !== POINT_ORDER_PAYMENT_PROVIDER) {
    return blocked("카드 또는 포인트로 결제한 주문만 부분 환불할 수 있습니다.");
  }
  const orderBlocker = drawRefundOrderBlocker(row);
  if (orderBlocker) return blocked(orderBlocker);
  const lineCount = numberValue(row.line_count);
  if (lineCount < 1 || numberValue(row.gacha_line_count) !== lineCount) {
    return blocked("가챠만 포함된 주문만 부분 환불할 수 있습니다. 쿠지 주문은 지원하지 않습니다.");
  }
  const paidCardAmount = numberValue(row.amount);
  if (paidCardAmount !== numberValue(row.order_total)
    || numberValue(row.paid_ledger) !== paidCardAmount
    || numberValue(row.refund_ledger) !== 0) {
    return blocked("결제·환불 원장 금액을 먼저 대사해야 합니다.");
  }
  const totalDrawUnits = numberValue(row.expected_draw_units);
  const unusedDrawUnits = numberValue(row.available_entitlement_count);
  if (numberValue(row.entitlement_count) !== totalDrawUnits || totalDrawUnits < 2) {
    return blocked("뽑기권 수가 주문 수량과 다릅니다. 먼저 대사해 주세요.");
  }
  if (unusedDrawUnits < 1) return blocked("사용하지 않은 뽑기권이 없습니다.");
  if (unusedDrawUnits >= totalDrawUnits) return blocked("사용한 뽑기가 없는 주문은 전액 환불을 사용해 주세요.");
  if (numberValue(row.draw_result_count) !== totalDrawUnits - unusedDrawUnits
    || numberValue(row.inventory_count) !== 0
    || numberValue(row.active_reservation_count) !== 0) {
    return blocked("뽑기권과 결과 상태가 맞지 않습니다. 먼저 대사해 주세요.");
  }
  const paidPointAmount = numberValue(row.point_total);
  const amounts = partialUnusedRefundAmounts({ paidCardAmount, paidPointAmount, totalDrawUnits, unusedDrawUnits });
  if (amounts.refundValue < 1) return blocked("돌려드릴 결제 금액이 없습니다.");
  return { blocker: null, plan: { ...amounts, totalDrawUnits, unusedDrawUnits, paidCardAmount, paidPointAmount } };
}

export function partialUnusedRefundView(row: PartialUnusedRefundRow) {
  return {
    paymentId: row.payment_id,
    orderId: row.order_id,
    status: row.status,
    totalDrawUnits: numberValue(row.total_draw_units),
    unusedDrawUnits: numberValue(row.unused_draw_units),
    cardRefundAmount: numberValue(row.card_refund_amount),
    pointRefundAmount: numberValue(row.point_refund_amount),
    providerStatus: row.provider_status,
    lastErrorCode: row.last_error_code,
    appliedAt: nullableIso(row.applied_at),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function readPlan(queryable: Queryable, paymentId: string) {
  const result = await queryable.query<PartialUnusedRefundRow>("SELECT * FROM partial_unused_draw_refunds WHERE payment_id=$1", [paymentId]);
  return result.rows[0] ?? null;
}

async function releaseFrozenPlan(
  client: DatabaseClient,
  paymentId: string,
  orderId: string,
  code: string,
  providerStatus: string | null,
) {
  // No money moved: the frozen order returns to PAID and its unused draws stay usable.
  await client.query("UPDATE payments SET status='PAID',version=version+1 WHERE id=$1 AND status='REFUND_REVIEW'", [paymentId]);
  await client.query("UPDATE orders SET status='PAID',version=version+1 WHERE id=$1 AND status='REFUND_REVIEW'", [orderId]);
  const released = await client.query<PartialUnusedRefundRow>(
    `UPDATE partial_unused_draw_refunds SET status='RELEASED',last_error_code=$2,provider_status=COALESCE($3,provider_status)
      WHERE payment_id=$1 AND status<>'APPLIED' RETURNING *`,
    [paymentId, code, providerStatus],
  );
  return released.rows[0]!;
}

export async function registerPartialUnusedRefundRoutes(app: FastifyInstance, context: ApiContext) {
  const guard = { preHandler: [requireLiveCommerce(context), context.auth.requirePermission("refunds.cancel")] };

  app.post("/v1/admin/commerce/payments/:paymentId/partial-refund", guard, async (request, reply) => {
    const paymentId = uuidInput((request.params as Record<string, unknown>).paymentId, "paymentId");
    const body = objectInput(request.body);
    const reason = stringInput(body, "reason", { min: 2, max: 500 })!;
    const headers = adminMutationHeaders(request, reason);
    const hash = requestHash({ operation: "PARTIAL_UNUSED_REFUND", paymentId, reason });
    reply.header("cache-control", "no-store");

    const existing = await readPlan(context.pool, paymentId);
    if (existing) {
      if (existing.idempotency_key === headers.idempotencyKey && existing.request_hash === hash) {
        reply.header("x-idempotent-replay", "true");
        return reply.code(202).send(partialUnusedRefundView(existing));
      }
      if (existing.status === "APPLIED") throw conflict("이 결제는 이미 부분 환불했습니다.");
      if (existing.status !== "RELEASED") throw conflict("진행 중인 부분 환불이 있습니다. 결제사 상태를 다시 확인해 주세요.");
    }
    const preflight = await loadCandidate(context.pool, paymentId, false);
    if (!preflight) throw notFound("결제 정보를 찾을 수 없습니다.");
    const preflightPlan = partialUnusedRefundPlan(preflight);
    if (preflightPlan.blocker) throw conflict(preflightPlan.blocker);
    const cardCall = preflightPlan.plan!.cardRefundAmount > 0;

    // The provider must still hold the whole card payment with no cancellation.
    let adapter: ReturnType<typeof createPortOneV2Adapter> | null = null;
    let providerPayment: PortOneCardPayment | null = null;
    if (cardCall) {
      configuredContext(context);
      adapter = createPortOneV2Adapter((await boundPaymentAdapterOptions(context.pool, context.config, paymentId)).options);
      try {
        providerPayment = await adapter.getPayment({ paymentId, expectedTotalAmount: preflightPlan.plan!.paidCardAmount });
      } catch (error) {
        throw providerError(error);
      }
      if (!portOnePaymentFullyCancellable(providerPayment, preflightPlan.plan!.paidCardAmount)) {
        throw conflict("결제사 결제 상태가 부분 환불 조건과 다릅니다. 결제를 먼저 대사해 주세요.");
      }
    }

    const prepared = await withTransaction(context.pool, async (client) => {
      await lockLinkedKujiRoomForOrder(client, preflight.order_id);
      const candidate = await loadCandidate(client, paymentId, true);
      if (!candidate) throw notFound("결제 정보를 찾을 수 없습니다.");
      const current = partialUnusedRefundPlan(candidate);
      if (current.blocker) throw conflict(current.blocker);
      const plan = current.plan!;
      if (plan.cardRefundAmount !== preflightPlan.plan!.cardRefundAmount
        || plan.pointRefundAmount !== preflightPlan.plan!.pointRefundAmount) {
        throw conflict("주문 상태가 바뀌어 환불 금액이 달라졌습니다. 다시 조회해 주세요.");
      }
      const entitlements = await client.query<{ id: string }>(
        `SELECT e.id FROM draw_entitlements e JOIN order_lines line ON line.id=e.order_line_id
          WHERE line.order_id=$1 AND e.status='AVAILABLE' ORDER BY e.id FOR UPDATE OF e`,
        [candidate.order_id],
      );
      if (entitlements.rows.length !== plan.unusedDrawUnits) throw conflict("뽑기권 상태가 바뀌었습니다. 다시 조회해 주세요.");
      const previous = await client.query<PartialUnusedRefundRow>(
        "SELECT * FROM partial_unused_draw_refunds WHERE payment_id=$1 FOR UPDATE", [paymentId],
      );
      if (previous.rows[0] && previous.rows[0].status !== "RELEASED") {
        throw conflict("진행 중인 부분 환불이 있습니다. 결제사 상태를 다시 확인해 주세요.");
      }
      const values = [
        paymentId, candidate.order_id, request.actor!.userId, headers.idempotencyKey, hash, reason,
        plan.totalDrawUnits, plan.unusedDrawUnits, entitlements.rows.map((row) => row.id),
        plan.paidCardAmount, plan.paidPointAmount, plan.cardRefundAmount, plan.pointRefundAmount,
      ];
      const recorded = previous.rows[0]
        ? await client.query<PartialUnusedRefundRow>(
          `UPDATE partial_unused_draw_refunds
              SET order_id=$2,admin_id=$3,idempotency_key=$4,request_hash=$5,reason=$6,status='CALLING',
                  total_draw_units=$7,unused_draw_units=$8,entitlement_ids=$9::uuid[],paid_card_amount=$10,
                  paid_point_amount=$11,card_refund_amount=$12,point_refund_amount=$13,
                  provider_cancellation_id=NULL,provider_status=NULL,last_error_code=NULL,applied_at=NULL
            WHERE payment_id=$1 AND status='RELEASED' RETURNING *`,
          values,
        )
        : await client.query<PartialUnusedRefundRow>(
          `INSERT INTO partial_unused_draw_refunds(payment_id,order_id,admin_id,idempotency_key,request_hash,reason,status,
             total_draw_units,unused_draw_units,entitlement_ids,paid_card_amount,paid_point_amount,card_refund_amount,point_refund_amount)
           VALUES($1,$2,$3,$4,$5,$6,'CALLING',$7,$8,$9::uuid[],$10,$11,$12,$13) RETURNING *`,
          values,
        );
      if (!recorded.rowCount) throw conflict("부분 환불 요청 상태가 바뀌었습니다. 다시 조회해 주세요.");
      // The draw endpoint locks this order before consuming an entitlement, so
      // the freeze is committed before any provider call.
      await client.query("UPDATE payments SET status='REFUND_REVIEW',version=version+1 WHERE id=$1", [paymentId]);
      await client.query("UPDATE orders SET status='REFUND_REVIEW',version=version+1 WHERE id=$1", [candidate.order_id]);
      await writeAdminAudit(client, request, request.actor!, {
        action: "PARTIAL_UNUSED_REFUND_PREPARED", targetType: "PAYMENT", targetId: paymentId, reason,
        before: { paymentStatus: candidate.status, orderStatus: candidate.order_status },
        after: { paymentStatus: "REFUND_REVIEW", orderStatus: "REFUND_REVIEW", partialRefundStatus: "CALLING" },
        metadata: {
          orderId: candidate.order_id, totalDrawUnits: plan.totalDrawUnits, unusedDrawUnits: plan.unusedDrawUnits,
          paidCardAmount: plan.paidCardAmount, paidPointAmount: plan.paidPointAmount,
          cardRefundAmount: plan.cardRefundAmount, pointRefundAmount: plan.pointRefundAmount,
        },
      });
      if (plan.cardRefundAmount > 0) return { row: recorded.rows[0]!, execute: true, candidate };
      // Nothing to cancel on a card: apply the point refund in this transaction.
      const outcome = await applyPlannedPartialUnusedRefund(client, {
        paymentId, orderId: candidate.order_id, userId: candidate.user_id,
        paymentStatus: "REFUND_REVIEW", orderStatus: "REFUND_REVIEW", providerCancelledAmount: null,
        ledgerReference: `partial-unused-refund:${paymentId}`, providerPaymentId: null, providerStatus: null,
        correlationId: request.id,
      });
      if (outcome !== "processed") throw new Error(`Point-only partial refund of ${paymentId} did not apply`);
      return { row: (await readPlan(client, paymentId))!, execute: false, candidate };
    });
    if (!prepared.execute) return reply.code(202).send(partialUnusedRefundView(prepared.row));

    const plan = prepared.row;
    const ownKey = headers.idempotencyKey;
    let cancellationId: string | null = null;
    let cancellationOutcome: string | null = null;
    try {
      const cancellation = await adapter!.cancelPayment({
        paymentId,
        amount: numberValue(plan.card_refund_amount),
        currentCancellableAmount: numberValue(plan.paid_card_amount),
        reason,
        requester: "ADMIN",
      });
      cancellationId = cancellation.cancellationId;
      cancellationOutcome = cancellation.outcome;
    } catch {
      // The outcome is unknown: keep the order frozen until a provider read
      // (the requery below or the worker reconciliation) settles it.
      const unknown = await context.pool.query<PartialUnusedRefundRow>(
        `UPDATE partial_unused_draw_refunds SET status='INDETERMINATE',last_error_code='CANCEL_OUTCOME_UNKNOWN'
          WHERE payment_id=$1 AND status='CALLING' AND idempotency_key=$2 RETURNING *`,
        [paymentId, ownKey],
      );
      return reply.code(202).send(partialUnusedRefundView(unknown.rows[0] ?? (await readPlan(context.pool, paymentId))!));
    }
    if (cancellationOutcome === "FAILED") {
      const released = await withTransaction(context.pool, async (client) => {
        const row = await releaseFrozenPlan(client, paymentId, plan.order_id, "PROVIDER_CANCEL_FAILED", providerPayment?.status ?? null);
        await client.query("UPDATE partial_unused_draw_refunds SET provider_cancellation_id=$2 WHERE payment_id=$1", [paymentId, cancellationId]);
        await writeAdminAudit(client, request, request.actor!, {
          action: "PARTIAL_UNUSED_REFUND_RELEASED", targetType: "PAYMENT", targetId: paymentId, reason,
          after: { partialRefundStatus: "RELEASED" }, metadata: { lastErrorCode: "PROVIDER_CANCEL_FAILED" },
        });
        return row;
      });
      return reply.code(202).send(partialUnusedRefundView(released));
    }
    await context.pool.query(
      "UPDATE partial_unused_draw_refunds SET provider_cancellation_id=$2 WHERE payment_id=$1 AND status='CALLING' AND idempotency_key=$3",
      [paymentId, cancellationId, ownKey],
    );
    let finalStatus: "PROVIDER_PENDING" | "INDETERMINATE" | "REVIEW_REQUIRED" = "PROVIDER_PENDING";
    let providerStatus: string | null = null;
    try {
      const result = await reconcilePayment(context, request.id, {
        id: paymentId, order_id: plan.order_id, amount: numberValue(plan.paid_card_amount),
      });
      providerStatus = result.providerStatus;
      if (result.outcome === "review") finalStatus = "REVIEW_REQUIRED";
    } catch {
      finalStatus = "INDETERMINATE";
    }
    // The canonical handler marks the plan APPLIED when the provider shows the
    // exact partial cancellation; only a still-open CALLING row is updated here.
    await context.pool.query(
      `UPDATE partial_unused_draw_refunds
          SET status=$2,provider_status=COALESCE($3,provider_status),
              last_error_code=CASE WHEN $2='INDETERMINATE' THEN 'REQUERY_FAILED'
                WHEN $2='REVIEW_REQUIRED' THEN 'PROVIDER_REVIEW_REQUIRED' ELSE NULL END
        WHERE payment_id=$1 AND status='CALLING' AND idempotency_key=$4`,
      [paymentId, finalStatus, providerStatus, ownKey],
    );
    return reply.code(202).send(partialUnusedRefundView((await readPlan(context.pool, paymentId))!));
  });

  app.post("/v1/admin/commerce/payments/:paymentId/partial-refund/reconcile", guard, async (request, reply) => {
    const paymentId = uuidInput((request.params as Record<string, unknown>).paymentId, "paymentId");
    const body = objectInput(request.body);
    const reason = stringInput(body, "reason", { min: 2, max: 500 })!;
    adminMutationHeaders(request, reason);
    reply.header("cache-control", "no-store");
    const plan = await readPlan(context.pool, paymentId);
    if (!plan) throw notFound("부분 환불 요청 내역을 찾을 수 없습니다.");
    if (!(PARTIAL_REFUND_OPEN_STATUSES as readonly string[]).includes(plan.status)) {
      return reply.code(200).send(partialUnusedRefundView(plan));
    }
    if (plan.status === "CALLING" && Date.now() - plan.updated_at.getTime() < 30_000) {
      throw conflict("부분 환불 요청을 처리하는 중입니다. 잠시 후 다시 확인해 주세요.");
    }
    configuredContext(context);
    const adapter = createPortOneV2Adapter((await boundPaymentAdapterOptions(context.pool, context.config, paymentId)).options);
    let providerPayment: PortOneCardPayment;
    try {
      providerPayment = await adapter.getPayment({ paymentId, expectedTotalAmount: numberValue(plan.paid_card_amount) });
    } catch (error) {
      throw providerError(error);
    }
    const cardRefund = numberValue(plan.card_refund_amount);
    if (providerPayment.status === "PARTIAL_CANCELLED" && providerPayment.amount.cancelled === cardRefund) {
      await reconcilePayment(context, request.id, {
        id: paymentId, order_id: plan.order_id, amount: numberValue(plan.paid_card_amount),
      }, { retryPartialRefund: true });
    }
    const after = await withTransaction(context.pool, async (client) => {
      const current = await client.query<PartialUnusedRefundRow>(
        "SELECT * FROM partial_unused_draw_refunds WHERE payment_id=$1 FOR UPDATE", [paymentId],
      );
      let row = current.rows[0]!;
      if ((PARTIAL_REFUND_OPEN_STATUSES as readonly string[]).includes(row.status)) {
        const cancellationPending = providerPayment.status === "PAID" && providerPayment.amount.cancelled === 0
          && providerPayment.cancellations.some((cancellation) => cancellation.outcome === "PENDING");
        if (portOnePaymentFullyCancellable(providerPayment, numberValue(plan.paid_card_amount))) {
          // The provider still holds the whole payment with no cancellation in flight.
          row = await releaseFrozenPlan(client, paymentId, plan.order_id, "PROVIDER_NOT_CANCELLED", providerPayment.status);
        } else if (cancellationPending) {
          const pending = await client.query<PartialUnusedRefundRow>(
            "UPDATE partial_unused_draw_refunds SET status='PROVIDER_PENDING',provider_status=$2 WHERE payment_id=$1 RETURNING *",
            [paymentId, providerPayment.status],
          );
          row = pending.rows[0]!;
        } else {
          const review = await client.query<PartialUnusedRefundRow>(
            `UPDATE partial_unused_draw_refunds SET status='REVIEW_REQUIRED',provider_status=$2,
               last_error_code='PROVIDER_STATE_MISMATCH' WHERE payment_id=$1 RETURNING *`,
            [paymentId, providerPayment.status],
          );
          row = review.rows[0]!;
        }
      }
      await writeAdminAudit(client, request, request.actor!, {
        action: "PARTIAL_UNUSED_REFUND_RECONCILED", targetType: "PAYMENT", targetId: paymentId, reason,
        before: { partialRefundStatus: plan.status },
        after: { partialRefundStatus: row.status, providerStatus: providerPayment.status },
        metadata: { providerCancelledAmount: providerPayment.amount.cancelled, plannedCardRefund: cardRefund },
      });
      return row;
    });
    return reply.code(200).send(partialUnusedRefundView(after));
  });
}

/** The admin payment detail's preview of the partial refund. */
export async function partialUnusedRefundDetail(
  queryable: Queryable,
  paymentId: string,
  enabled: boolean,
) {
  const attempt = await readPlan(queryable, paymentId);
  if (!enabled) {
    return { available: false, blocker: null, preview: null, attempt: attempt ? partialUnusedRefundView(attempt) : null };
  }
  const candidate = await loadCandidate(queryable, paymentId, false);
  const evaluated = candidate ? partialUnusedRefundPlan(candidate) : { blocker: "결제 정보를 찾을 수 없습니다.", plan: null };
  const blocker = evaluated.blocker
    ?? (attempt && attempt.status !== "RELEASED" ? "이미 부분 환불 요청이 있습니다." : null);
  return {
    available: blocker === null,
    blocker,
    preview: evaluated.plan ? {
      totalDrawUnits: evaluated.plan.totalDrawUnits,
      unusedDrawUnits: evaluated.plan.unusedDrawUnits,
      cardRefundAmount: evaluated.plan.cardRefundAmount,
      pointRefundAmount: evaluated.plan.pointRefundAmount,
    } : null,
    attempt: attempt ? partialUnusedRefundView(attempt) : null,
  };
}
