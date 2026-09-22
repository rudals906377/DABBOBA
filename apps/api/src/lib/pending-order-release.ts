import type { DatabaseClient } from "@dabboba/db";
import { numberValue } from "./rows.js";

export type PendingOrderReleaseRow = {
  id: string;
  user_id: string;
  point_total: number;
  order_kind?: "PRODUCT" | "SHIPPING_FEE";
  shipping_request_id?: string | null;
};

export async function releasePendingOrder(
  client: DatabaseClient,
  order: PendingOrderReleaseRow,
  reason: string,
): Promise<void> {
  if (order.order_kind === "SHIPPING_FEE" && order.shipping_request_id) {
    const shippingRequest = await client.query<{ status: string }>(
      "SELECT status FROM shipping_requests WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [order.shipping_request_id, order.user_id],
    );
    if (shippingRequest.rows[0]?.status === "PAYMENT_PENDING") {
      const releasedInventory = await client.query(
        `UPDATE inventory_units inventory
            SET status='OWNED'
           FROM shipping_request_items item
          WHERE item.shipping_request_id=$1
            AND item.inventory_unit_id=inventory.id
            AND inventory.owner_id=$2
            AND inventory.status='SHIPPING'
          RETURNING inventory.id`,
        [order.shipping_request_id, order.user_id],
      );
      const expectedInventory = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM shipping_request_items WHERE shipping_request_id=$1",
        [order.shipping_request_id],
      );
      if (releasedInventory.rowCount !== Number(expectedInventory.rows[0]?.count ?? 0)) {
        throw new Error(`Shipping inventory release invariant failed for ${order.shipping_request_id}`);
      }
      await client.query(
        `UPDATE shipping_requests
            SET status='CANCELLED',version=version+1
          WHERE id=$1 AND user_id=$2 AND status='PAYMENT_PENDING'`,
        [order.shipping_request_id, order.user_id],
      );
    }
  }

  const reservations = await client.query<{ id: string; product_id: string; quantity: number }>(
    `SELECT id,product_id,quantity
       FROM stock_reservations
      WHERE order_id=$1 AND status='ACTIVE'
      ORDER BY product_id,id
      FOR UPDATE`,
    [order.id],
  );
  for (const reservation of reservations.rows) {
    const released = await client.query(
      `UPDATE product_stock
          SET reserved=reserved-$2,version=version+1
        WHERE product_id=$1 AND reserved>=$2
        RETURNING product_id`,
      [reservation.product_id, reservation.quantity],
    );
    if (!released.rowCount) {
      throw new Error(`Reservation stock invariant failed for ${reservation.id}`);
    }
  }
  if (reservations.rowCount) {
    await client.query(
      `UPDATE stock_reservations
          SET status='RELEASED',resolved_at=now()
        WHERE id=ANY($1::uuid[]) AND status='ACTIVE'`,
      [reservations.rows.map((reservation) => reservation.id)],
    );
  }

  const coupon = await client.query<{ coupon_id: string }>(
    `UPDATE coupon_redemptions
        SET status='RELEASED'
      WHERE order_id=$1 AND status='RESERVED'
      RETURNING coupon_id`,
    [order.id],
  );
  if (coupon.rowCount) {
    await client.query("UPDATE coupons SET used_count=GREATEST(0,used_count-1) WHERE id=$1", [
      coupon.rows[0]!.coupon_id,
    ]);
  }

  if (numberValue(order.point_total) > 0) {
    const ledger = await client.query(
      `INSERT INTO point_ledger_entries(
         user_id,entry_type,amount,reference_type,reference_id,reason
       ) VALUES($1,'REFUND',$2,'ORDER',$3,$4)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [order.user_id, order.point_total, order.id, reason],
    );
    if (ledger.rowCount) {
      await client.query(
        "UPDATE point_accounts SET balance=balance+$2,version=version+1 WHERE user_id=$1",
        [order.user_id, order.point_total],
      );
    }
  }
}
