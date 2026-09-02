import type { DatabaseClient } from "@dabboba/db";
import { numberValue } from "./rows.js";

export type PendingOrderReleaseRow = {
  id: string;
  user_id: string;
  point_total: number;
};

export async function releasePendingOrder(
  client: DatabaseClient,
  order: PendingOrderReleaseRow,
  reason: string,
): Promise<void> {
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
