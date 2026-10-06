import type { DatabaseClient } from "@dabboba/db";
import { writeOutbox } from "../lib/audit.js";
import { numberValue } from "../lib/rows.js";

/**
 * Owner decision 2026-10-06 for refunding the unused draws of a partly used
 * gacha order. The refund value is the paid amount (card plus points; a coupon
 * discount is not returned) per draw times the unused draws, rounded down to
 * the won. The card part is the card amount on the same ratio, rounded down,
 * and the remainder is returned as points, so the two parts always add up to
 * the refund value and never exceed what was paid in each.
 */
export function partialUnusedRefundAmounts(input: {
  paidCardAmount: number;
  paidPointAmount: number;
  totalDrawUnits: number;
  unusedDrawUnits: number;
}) {
  const { paidCardAmount, paidPointAmount, totalDrawUnits, unusedDrawUnits } = input;
  if (
    !Number.isSafeInteger(totalDrawUnits) || !Number.isSafeInteger(unusedDrawUnits)
    || unusedDrawUnits < 1 || unusedDrawUnits >= totalDrawUnits
  ) {
    throw new Error("A partial refund needs at least one used and one unused draw");
  }
  const refundValue = Math.floor(((paidCardAmount + paidPointAmount) * unusedDrawUnits) / totalDrawUnits);
  const cardRefundAmount = Math.min(paidCardAmount, Math.floor((paidCardAmount * unusedDrawUnits) / totalDrawUnits));
  const pointRefundAmount = Math.min(paidPointAmount, refundValue - cardRefundAmount);
  return { refundValue: cardRefundAmount + pointRefundAmount, cardRefundAmount, pointRefundAmount };
}

export type PartialUnusedRefundRow = {
  payment_id: string;
  order_id: string;
  admin_id: string;
  idempotency_key: string;
  request_hash: string;
  reason: string;
  status: "CALLING" | "PROVIDER_PENDING" | "INDETERMINATE" | "REVIEW_REQUIRED" | "APPLIED" | "RELEASED";
  total_draw_units: number;
  unused_draw_units: number;
  entitlement_ids: string[];
  paid_card_amount: number;
  paid_point_amount: number;
  card_refund_amount: number;
  point_refund_amount: number;
  provider_cancellation_id: string | null;
  provider_status: string | null;
  last_error_code: string | null;
  applied_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

/** States in which the planned entitlements are frozen and may still be applied. */
export const PARTIAL_REFUND_OPEN_STATUSES = ["CALLING", "PROVIDER_PENDING", "INDETERMINATE", "REVIEW_REQUIRED"] as const;

type DrawLine = { id: string; product_id: string; probability_version_id: string | null };

/**
 * Applies the recorded partial refund of one payment inside the caller's
 * transaction. `providerCancelledAmount` is the total PortOne reports as
 * cancelled; it must equal the planned card part exactly. `null` means no card
 * cancellation exists (points-only plan) and the plan is applied locally.
 *
 * Returns "processed" when this call applied it, "ignored" when the same
 * cancellation was already applied, and null when no matching open plan
 * exists, so the caller keeps its existing review handling.
 */
export async function applyPlannedPartialUnusedRefund(
  client: DatabaseClient,
  input: {
    paymentId: string;
    orderId: string;
    userId: string;
    paymentStatus: string;
    orderStatus: string;
    providerCancelledAmount: number | null;
    ledgerReference: string;
    providerPaymentId: string | null;
    providerStatus: string | null;
    correlationId: string;
  },
): Promise<"processed" | "ignored" | null> {
  const found = await client.query<PartialUnusedRefundRow>(
    "SELECT * FROM partial_unused_draw_refunds WHERE payment_id=$1 FOR UPDATE",
    [input.paymentId],
  );
  const plan = found.rows[0];
  if (!plan || plan.order_id !== input.orderId) return null;
  const cardRefund = numberValue(plan.card_refund_amount);
  const pointRefund = numberValue(plan.point_refund_amount);
  if (input.providerCancelledAmount === null ? cardRefund !== 0 : input.providerCancelledAmount !== cardRefund) {
    return null;
  }
  if (plan.status === "APPLIED") return "ignored";
  if (!(PARTIAL_REFUND_OPEN_STATUSES as readonly string[]).includes(plan.status)) return null;
  // The request froze the order before any provider call; anything else means
  // the order moved and must stay with the operator.
  if (input.paymentStatus !== "REFUND_REVIEW" || input.orderStatus !== "REFUND_REVIEW") return null;

  // Same lock order as the full refund: lines, products and stock, draw
  // versions with their capacity locks, then the entitlements.
  const lines = await client.query<DrawLine>(
    "SELECT id,product_id,probability_version_id FROM order_lines WHERE order_id=$1 ORDER BY product_id,id FOR UPDATE",
    [input.orderId],
  );
  const productIds = [...new Set(lines.rows.map((line) => line.product_id))].sort();
  if (productIds.length) {
    await client.query(
      "SELECT p.id FROM catalog_products p JOIN product_stock s ON s.product_id=p.id WHERE p.id=ANY($1::text[]) ORDER BY p.id FOR UPDATE OF p,s",
      [productIds],
    );
  }
  const refundedVersionIds = [...new Set(lines.rows.map((line) => line.probability_version_id).filter((id): id is string => id !== null))].sort();
  const versions = productIds.length
    ? await client.query<{ id: string; product_id: string; status: string }>(
      `SELECT id,product_id,status FROM draw_probability_versions
        WHERE id=ANY($1::uuid[]) OR (product_id=ANY($2::text[]) AND status='ACTIVE') ORDER BY id FOR UPDATE`,
      [refundedVersionIds, productIds],
    )
    : { rows: [] };
  for (const versionId of [...new Set(versions.rows.map((version) => version.id))].sort()) {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))", [`draw-capacity:${versionId}`]);
  }
  const activeVersionByProduct = new Map<string, string>();
  for (const version of versions.rows) if (version.status === "ACTIVE") activeVersionByProduct.set(version.product_id, version.id);

  const entitlements = await client.query<{ id: string; order_line_id: string; status: string }>(
    "SELECT id,order_line_id,status FROM draw_entitlements WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
    [plan.entitlement_ids],
  );
  const lineIds = new Set(lines.rows.map((line) => line.id));
  if (
    entitlements.rows.length !== numberValue(plan.unused_draw_units)
    || entitlements.rows.some((entitlement) => entitlement.status !== "AVAILABLE" || !lineIds.has(entitlement.order_line_id))
  ) {
    return null;
  }
  const cancelled = await client.query(
    "UPDATE draw_entitlements SET status='CANCELLED' WHERE id=ANY($1::uuid[]) AND status='AVAILABLE'",
    [plan.entitlement_ids],
  );
  if (cancelled.rowCount !== entitlements.rows.length) throw new Error("Partial refund entitlements changed while locked");

  const unitsByLine = new Map<string, number>();
  for (const entitlement of entitlements.rows) {
    unitsByLine.set(entitlement.order_line_id, (unitsByLine.get(entitlement.order_line_id) ?? 0) + 1);
  }
  for (const line of lines.rows) {
    const units = unitsByLine.get(line.id);
    if (!units) continue;
    // Only stock of the draw version that is still active returns to sale
    // (same rule as the full refund's shouldRelistRefundedDrawStock).
    const activeVersionId = activeVersionByProduct.get(line.product_id) ?? null;
    if (activeVersionId !== null && line.probability_version_id !== activeVersionId) {
      await writeOutbox(client, input.correlationId, {
        aggregateType: "ORDER", aggregateId: input.orderId, eventType: "draw.refund_stock_not_relisted",
        payload: {
          orderId: input.orderId, orderLineId: line.id, productId: line.product_id, quantity: units,
          refundedVersionId: line.probability_version_id, activeVersionId,
        },
      });
      continue;
    }
    await client.query(
      "UPDATE product_stock SET on_hand=on_hand+$2,version=version+1 WHERE product_id=$1",
      [line.product_id, units],
    );
  }

  if (pointRefund > 0) {
    await client.query("INSERT INTO point_accounts(user_id,balance) VALUES($1,0) ON CONFLICT DO NOTHING", [input.userId]);
    const ledger = await client.query(
      `INSERT INTO point_ledger_entries(user_id,entry_type,amount,reference_type,reference_id,reason)
       VALUES($1,'REFUND',$2,'ORDER_PARTIAL_REFUND',$3,'Unused draws partially refunded')
       ON CONFLICT DO NOTHING RETURNING id`,
      [input.userId, pointRefund, input.orderId],
    );
    if (ledger.rowCount) {
      await client.query(
        "UPDATE point_accounts SET balance=balance+$2,version=version+1 WHERE user_id=$1",
        [input.userId, pointRefund],
      );
    }
  }
  if (cardRefund > 0) {
    await client.query(
      `INSERT INTO payment_ledger_entries(payment_id,order_id,entry_type,amount,reference_id,reason)
       VALUES($1,$2,'REFUND',$3,$4,'Verified partial refund of unused draws')`,
      [input.paymentId, input.orderId, -cardRefund, input.ledgerReference],
    );
  }
  // The used draws stay with the customer, so the order and payment return to PAID.
  await client.query(
    "UPDATE payments SET status='PAID',provider_payment_id=COALESCE($2,provider_payment_id),version=version+1 WHERE id=$1 AND status='REFUND_REVIEW'",
    [input.paymentId, input.providerPaymentId],
  );
  await client.query("UPDATE orders SET status='PAID',version=version+1 WHERE id=$1 AND status='REFUND_REVIEW'", [input.orderId]);
  await client.query(
    `UPDATE partial_unused_draw_refunds
        SET status='APPLIED',applied_at=now(),provider_status=COALESCE($2,provider_status),last_error_code=NULL
      WHERE payment_id=$1`,
    [input.paymentId, input.providerStatus],
  );
  await writeOutbox(client, input.correlationId, {
    aggregateType: "ORDER", aggregateId: input.orderId, eventType: "order.partially_refunded",
    payload: {
      orderId: input.orderId, userId: input.userId, paymentId: input.paymentId,
      cardRefundAmount: cardRefund, pointRefundAmount: pointRefund,
      unusedDrawUnits: numberValue(plan.unused_draw_units),
    },
  });
  return "processed";
}
