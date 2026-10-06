import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { lockLinkedKujiRoomForOrder, type DatabaseClient } from "@dabboba/db";
import { adminIdempotentMutation, sendAdminMutation } from "../lib/admin-idempotency.js";
import { writeAdminAudit } from "../lib/audit.js";
import { requireLiveCommerce } from "../lib/commerce-mode.js";
import { conflict, notFound } from "../lib/errors.js";
import { objectInput, stringInput, uuidInput } from "../lib/input.js";
import { nullableIso, numberValue } from "../lib/rows.js";
import type { ApiContext } from "../types.js";
import { applyCanonicalPaymentEventInTransaction, parseCanonicalPaymentEvent } from "./commerce.js";
import {
  drawRefundOrderBlocker,
  REFUND_CANDIDATE_LOOKUP_SQL,
  unusedDrawAssetsBlocker,
  type NormalDrawRefundCandidate,
} from "./portone-payments.js";

/**
 * An order whose whole total was covered by points and/or a coupon is paid at
 * checkout through this zero-amount provider. No card or PG transaction exists,
 * so its refund is applied locally instead of through a provider cancellation.
 */
export const POINT_ORDER_PAYMENT_PROVIDER = "INTERNAL_ZERO";

/**
 * The single operator-authorized internal refund event of a point order. The
 * deterministic ID makes payment_provider_events' (provider, event ID)
 * uniqueness allow at most one such refund per payment.
 */
export function pointOrderRefundEventId(paymentId: string): string {
  return `internal-zero-refund:${paymentId}`;
}

/**
 * The same "nothing was used" conditions as the card refund
 * (normalDrawRefundBlocker), for a PAID order with no external payment.
 */
export function pointOrderRefundBlocker(row: NormalDrawRefundCandidate): string | null {
  if (row.provider !== POINT_ORDER_PAYMENT_PROVIDER || row.status !== "PAID" || row.order_status !== "PAID") {
    return "결제와 주문 상태가 포인트 주문 환불 조건에 맞지 않습니다.";
  }
  const orderBlocker = drawRefundOrderBlocker(row);
  if (orderBlocker) return orderBlocker;
  if (numberValue(row.amount) !== 0 || numberValue(row.order_total) !== 0) {
    return "카드 결제 금액이 없는 포인트 주문만 포인트로 환불할 수 있습니다.";
  }
  if (numberValue(row.paid_ledger) !== 0 || numberValue(row.refund_ledger) !== 0) {
    return "결제·환불 원장 금액을 먼저 대사해야 합니다.";
  }
  return unusedDrawAssetsBlocker(row);
}

type PointOrderRefundRow = {
  payment_id: string;
  order_id: string;
  payment_status: string;
  order_status: string;
  refunded_at: Date | null;
  point_total: number | string;
  restored_points: number | string;
  cancelled_entitlements: number | string;
};

async function pointOrderRefundView(client: DatabaseClient, paymentId: string, alreadyRefunded: boolean) {
  const result = await client.query<PointOrderRefundRow>(
    `SELECT p.id AS payment_id,p.order_id,p.status AS payment_status,o.status AS order_status,p.refunded_at,o.point_total,
       COALESCE((SELECT sum(l.amount) FROM point_ledger_entries l
         WHERE l.user_id=o.user_id AND l.entry_type='REFUND' AND l.reference_type='ORDER' AND l.reference_id=o.id::text),0) AS restored_points,
       (SELECT count(*) FROM draw_entitlements e JOIN order_lines line ON line.id=e.order_line_id
         WHERE line.order_id=o.id AND e.status='CANCELLED') AS cancelled_entitlements
     FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=$1`,
    [paymentId],
  );
  const row = result.rows[0]!;
  return {
    paymentId: row.payment_id,
    orderId: row.order_id,
    paymentStatus: row.payment_status,
    orderStatus: row.order_status,
    pointTotal: numberValue(row.point_total),
    restoredPoints: numberValue(row.restored_points),
    cancelledEntitlements: numberValue(row.cancelled_entitlements),
    refundedAt: nullableIso(row.refunded_at),
    alreadyRefunded,
  };
}

/**
 * Refunds one PAID, entirely unused point order inside the caller's
 * transaction. No external call exists between the eligibility check and the
 * refund, so both run under the same row locks instead of a separate
 * REFUND_REVIEW freeze: a draw that committed first is seen by the check, and
 * a draw that waits for the order lock afterwards finds the order REFUNDED.
 */
export async function applyPointOrderRefund(
  client: DatabaseClient,
  request: FastifyRequest,
  input: { paymentId: string; reason: string },
) {
  const { paymentId, reason } = input;
  const lookup = await client.query<{ order_id: string }>("SELECT order_id FROM payments WHERE id=$1", [paymentId]);
  if (!lookup.rowCount) throw notFound("결제 정보를 찾을 수 없습니다.");
  const orderId = lookup.rows[0]!.order_id;
  // Same lock order as draw consumption and the canonical payment handler:
  // the linked kuji room first, then the payment and order rows.
  await lockLinkedKujiRoomForOrder(client, orderId);
  const locked = await client.query<{ order_id: string }>(
    "SELECT p.order_id FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=$1 FOR UPDATE OF p,o",
    [paymentId],
  );
  if (locked.rows[0]?.order_id !== orderId) throw conflict("결제 정보가 변경되었습니다. 다시 조회해 주세요.");
  // A new statement after the locks are granted, so its counts include every
  // draw that committed while this request waited for them.
  const candidate = (await client.query<NormalDrawRefundCandidate>(REFUND_CANDIDATE_LOOKUP_SQL, [paymentId])).rows[0]!;
  const eventId = pointOrderRefundEventId(paymentId);

  if (candidate.provider === POINT_ORDER_PAYMENT_PROVIDER
    && candidate.status === "REFUNDED" && candidate.order_status === "REFUNDED") {
    const prior = await client.query(
      "SELECT 1 FROM payment_provider_events WHERE provider=$1 AND provider_event_id=$2 AND payment_id=$3",
      [POINT_ORDER_PAYMENT_PROVIDER, eventId, paymentId],
    );
    // A repeated request (any idempotency key) after success reports the
    // committed refund; it never credits the points a second time.
    if (prior.rowCount) {
      return { statusCode: 200, body: await pointOrderRefundView(client, paymentId, true), resourceType: "PAYMENT", resourceId: paymentId };
    }
  }
  const blocker = pointOrderRefundBlocker(candidate);
  if (blocker) throw conflict(blocker);

  // An operator-authorized internal event, applied by the same canonical
  // refund as a verified provider refund: AVAILABLE entitlements cancelled,
  // stock relisted, kuji room released, order points returned once through the
  // order's unique REFUND point-ledger row, coupon redemption released, and
  // payment/order REFUNDED with the order.refunded outbox event. The digest
  // uses the same internal format as in-process PortOne events.
  const serverTime = await client.query<{ server_now: Date }>("SELECT clock_timestamp() AS server_now");
  const rawBody = JSON.stringify({
    eventId,
    eventType: "REFUND_SUCCEEDED",
    paymentId,
    providerPaymentId: null,
    occurredAt: serverTime.rows[0]!.server_now.toISOString(),
    amount: 0,
    authorization: { kind: "ADMIN_POINT_ORDER_REFUND", adminId: request.actor!.userId, requestId: request.id },
  });
  const signatureDigest = createHash("sha256").update(`internal:${POINT_ORDER_PAYMENT_PROVIDER}:${rawBody}`).digest("hex");
  const outcome = await applyCanonicalPaymentEventInTransaction(
    client,
    parseCanonicalPaymentEvent(POINT_ORDER_PAYMENT_PROVIDER, JSON.parse(rawBody) as Record<string, unknown>, signatureDigest),
    request.id,
  );
  // Anything but a complete refund rolls the whole request back, including a
  // review state the canonical handler may have set.
  if (outcome !== "processed") throw conflict("주문 상태가 변경되어 포인트 주문 환불을 완료하지 못했습니다. 다시 조회해 주세요.");
  const body = await pointOrderRefundView(client, paymentId, false);
  if (body.paymentStatus !== "REFUNDED" || body.orderStatus !== "REFUNDED") {
    throw new Error(`Point order refund did not settle payment ${paymentId}`);
  }
  await writeAdminAudit(client, request, request.actor!, {
    action: "POINT_ORDER_REFUNDED",
    targetType: "PAYMENT",
    targetId: paymentId,
    reason,
    before: { paymentStatus: candidate.status, orderStatus: candidate.order_status },
    after: { paymentStatus: body.paymentStatus, orderStatus: body.orderStatus },
    metadata: {
      orderId,
      providerEventId: eventId,
      pointTotal: numberValue(candidate.point_total),
      restoredPoints: body.restoredPoints,
      cancelledEntitlements: body.cancelledEntitlements,
    },
  });
  return { statusCode: 200, body, resourceType: "PAYMENT", resourceId: paymentId };
}

export async function registerPointOrderRefundRoutes(app: FastifyInstance, context: ApiContext) {
  app.post(
    "/v1/admin/commerce/payments/:paymentId/point-refund",
    { preHandler: [requireLiveCommerce(context), context.auth.requirePermission("refunds.cancel")] },
    async (request, reply) => {
      const paymentId = uuidInput((request.params as Record<string, unknown>).paymentId, "paymentId");
      const body = objectInput(request.body);
      const reason = stringInput(body, "reason", { min: 2, max: 500 })!;
      const result = await adminIdempotentMutation(context, request, {
        target: { type: "POINT_ORDER_REFUND", paymentId },
        bodyReason: reason,
        work: (client) => applyPointOrderRefund(client, request, { paymentId, reason }),
      });
      return sendAdminMutation(reply, result);
    },
  );
}
