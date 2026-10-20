import type { DatabaseClient } from "@dabboba/db";
import { conflict } from "./errors.js";

/**
 * SQL predicate on the `iu` alias: the unit's own draw order is settled. A
 * prize whose purchase is frozen for a refund review (or already refunded)
 * must not be shipped, exchanged or returned for points while the operator
 * decides, because the refund may take that prize back.
 */
const INVENTORY_SOURCE_ORDER_UNSETTLED_EXISTS_SQL = `(EXISTS (
  SELECT 1
    FROM draw_results source_draw
    JOIN draw_entitlements source_entitlement ON source_entitlement.id=source_draw.entitlement_id
    JOIN order_lines source_line ON source_line.id=source_entitlement.order_line_id
    JOIN orders source_order ON source_order.id=source_line.order_id
   WHERE source_draw.prize_inventory_unit_id=iu.id
     AND source_order.status NOT IN ('PAID','FULFILLED')
 ) OR (iu.source_type='PURCHASE' AND NOT EXISTS (
  SELECT 1 FROM order_lines purchase_line
  JOIN orders purchase_order ON purchase_order.id=purchase_line.order_id
  JOIN payments purchase_payment ON purchase_payment.order_id=purchase_order.id
  WHERE purchase_line.id=iu.source_id AND purchase_line.product_id=iu.product_id
    AND purchase_order.status IN ('PAID','FULFILLED') AND purchase_payment.status='PAID'
)))`;

export const INVENTORY_SOURCE_ORDER_SETTLED_SQL = `NOT ${INVENTORY_SOURCE_ORDER_UNSETTLED_EXISTS_SQL}`;

export const INVENTORY_SOURCE_ORDER_UNSETTLED_MESSAGE =
  "결제 확인이 진행 중인 주문의 상품은 배송·교환을 신청할 수 없어요.";

/** Fails closed with one clear message when any selected unit's draw order is unsettled. */
export async function assertInventorySourceOrdersSettled(
  client: DatabaseClient,
  inventoryUnitIds: readonly string[],
): Promise<void> {
  if (!inventoryUnitIds.length) return;
  const held = await client.query<{ id: string }>(
    `SELECT iu.id FROM inventory_units iu
      WHERE iu.id=ANY($1::uuid[]) AND ${INVENTORY_SOURCE_ORDER_UNSETTLED_EXISTS_SQL}
      LIMIT 1`,
    [inventoryUnitIds],
  );
  if (held.rowCount) {
    throw conflict(INVENTORY_SOURCE_ORDER_UNSETTLED_MESSAGE, { inventoryUnitId: held.rows[0]!.id });
  }
}
