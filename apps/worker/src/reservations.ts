import type { DatabaseClient, DatabasePool } from "@dabboba/db";
import {
  lockLinkedKujiRoomForOrder,
  releaseLockedKujiOrderRoom,
  withTransaction,
} from "@dabboba/db";
import type { Logger } from "./logger.js";

type OrderPaymentRow = {
  id: string;
  user_id: string;
  status: string;
  point_total: number;
  payment_id: string;
  payment_status: string;
};

type ReservationRow = {
  id: string;
  product_id: string;
  quantity: number;
  expires_at: Date;
};

export type ExpiryOutcome =
  | { status: "missing" | "not_due" | "already_resolved" | "requires_reconciliation"; released: 0 }
  | { status: "expired"; released: number };

export function reservationExpiryAction(
  orderStatus: string,
  paymentStatus: string,
  hasExpiredReservation: boolean,
): "release" | "wait" | "reconcile" {
  if (!hasExpiredReservation) return "wait";
  if (paymentStatus === "AUTHORIZED" || paymentStatus === "PAID" || paymentStatus === "REFUND_REVIEW" || paymentStatus === "REFUNDED") {
    return "reconcile";
  }
  if ((orderStatus === "PENDING_PAYMENT" || orderStatus === "CANCELLED") && ["PENDING", "FAILED", "CANCELLED"].includes(paymentStatus)) {
    return "release";
  }
  return "wait";
}

async function refundReservedPoints(client: DatabaseClient, order: OrderPaymentRow) {
  if (Number(order.point_total) <= 0) return;
  const ledger = await client.query<{ id: string }>(
    `INSERT INTO point_ledger_entries(user_id,entry_type,amount,reference_type,reference_id,reason)
     VALUES($1,'REFUND',$2,'ORDER',$3,'Payment reservation expired')
     ON CONFLICT (user_id,entry_type,reference_type,reference_id) DO NOTHING
     RETURNING id`,
    [order.user_id, Number(order.point_total), order.id],
  );
  if (ledger.rowCount) {
    await client.query(
      "UPDATE point_accounts SET balance=balance+$2,version=version+1 WHERE user_id=$1",
      [order.user_id, Number(order.point_total)],
    );
  }
}

async function releaseCoupon(client: DatabaseClient, orderId: string) {
  const redemption = await client.query<{ coupon_id: string }>(
    "UPDATE coupon_redemptions SET status='RELEASED' WHERE order_id=$1 AND status='RESERVED' RETURNING coupon_id",
    [orderId],
  );
  if (redemption.rowCount) {
    await client.query("UPDATE coupons SET used_count=GREATEST(0,used_count-1) WHERE id=$1", [redemption.rows[0]!.coupon_id]);
  }
}

async function writeCancellationOutbox(client: DatabaseClient, order: OrderPaymentRow) {
  await client.query(
    `INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload,correlation_id)
     SELECT 'ORDER',$1,'order.cancelled',$2,$3
      WHERE NOT EXISTS (
        SELECT 1 FROM outbox_events
         WHERE aggregate_type='ORDER' AND aggregate_id=$1 AND event_type='order.cancelled'
           AND payload->>'reason'='RESERVATION_EXPIRED'
      )`,
    [
      order.id,
      JSON.stringify({ orderId: order.id, userId: order.user_id, reason: "RESERVATION_EXPIRED" }),
      `worker-reservation-expiry-${order.id}`,
    ],
  );
}

async function expireLockedOrder(
  client: DatabaseClient,
  order: OrderPaymentRow,
  now: Date,
): Promise<ExpiryOutcome> {
  const reservations = await client.query<ReservationRow>(
    `SELECT id,product_id,quantity,expires_at
       FROM stock_reservations
      WHERE order_id=$1 AND status='ACTIVE'
      ORDER BY product_id,id
      FOR UPDATE`,
    [order.id],
  );
  if (!reservations.rowCount) return { status: "already_resolved", released: 0 };
  const hasExpired = reservations.rows.some((reservation) => reservation.expires_at.getTime() <= now.getTime());
  const action = reservationExpiryAction(order.status, order.payment_status, hasExpired);
  if (action === "wait") return { status: "not_due", released: 0 };
  if (action === "reconcile") return { status: "requires_reconciliation", released: 0 };

  for (const reservation of reservations.rows) {
    const stock = await client.query(
      `UPDATE product_stock
          SET reserved=reserved-$2,version=version+1
        WHERE product_id=$1 AND reserved >= $2
        RETURNING product_id`,
      [reservation.product_id, Number(reservation.quantity)],
    );
    if (!stock.rowCount) {
      throw new Error(`Reservation stock invariant failed for ${reservation.id}`);
    }
  }

  await client.query(
    "UPDATE stock_reservations SET status='EXPIRED',resolved_at=$2 WHERE id=ANY($1::uuid[]) AND status='ACTIVE'",
    [reservations.rows.map((reservation) => reservation.id), now],
  );
  await client.query(
    "UPDATE payments SET status='CANCELLED',version=version+1 WHERE id=$1 AND status='PENDING'",
    [order.payment_id],
  );
  const transitioned = await client.query<{ id: string }>(
    "UPDATE orders SET status='CANCELLED',cancelled_at=$2,version=version+1 WHERE id=$1 AND status='PENDING_PAYMENT' RETURNING id",
    [order.id, now],
  );
  await releaseCoupon(client, order.id);
  if (transitioned.rowCount) {
    await refundReservedPoints(client, order);
    await writeCancellationOutbox(client, order);
  }
  return { status: "expired", released: reservations.rowCount };
}

export async function expireOrderReservations(pool: DatabasePool, orderId: string, now = new Date()): Promise<ExpiryOutcome> {
  return withTransaction(pool, async (client) => {
    // Match the API lock order: linked kuji room, payment, order, then stock.
    // The initial linkage lookup is non-locking; order_id becomes immutable once set.
    const linkedKujiRoom = await lockLinkedKujiRoomForOrder(client, orderId);
    const payment = await client.query<{ id: string; status: string }>(
      "SELECT id,status FROM payments WHERE order_id=$1 FOR UPDATE",
      [orderId],
    );
    if (!payment.rowCount) return { status: "missing", released: 0 };
    const order = await client.query<{ id: string; user_id: string; status: string; point_total: number }>(
      "SELECT id,user_id,status,point_total FROM orders WHERE id=$1 FOR UPDATE",
      [orderId],
    );
    if (!order.rowCount) return { status: "missing", released: 0 };
    const outcome = await expireLockedOrder(client, {
      ...order.rows[0]!,
      payment_id: payment.rows[0]!.id,
      payment_status: payment.rows[0]!.status,
    }, now);
    if (outcome.status === "expired" && linkedKujiRoom) {
      await releaseLockedKujiOrderRoom(client, {
        orderId,
        serverNow: now,
        terminalState: "EXPIRED",
      });
    }
    return outcome;
  });
}

export async function expireReservationBatch(
  pool: DatabasePool,
  batchSize: number,
  logger: Logger,
  now = new Date(),
): Promise<{ examined: number; expired: number; released: number; reconciliation: number }> {
  const candidates = await pool.query<{ order_id: string }>(
    `SELECT DISTINCT sr.order_id
       FROM stock_reservations sr
       JOIN orders o ON o.id=sr.order_id
      WHERE sr.status='ACTIVE' AND sr.expires_at <= $1
        AND o.status IN ('PENDING_PAYMENT','CANCELLED')
      ORDER BY sr.order_id
      LIMIT $2`,
    [now, batchSize],
  );

  const summary = { examined: candidates.rows.length, expired: 0, released: 0, reconciliation: 0 };
  for (const candidate of candidates.rows) {
    const outcome = await expireOrderReservations(pool, candidate.order_id, now);
    if (outcome.status === "expired") {
      summary.expired += 1;
      summary.released += outcome.released;
    } else if (outcome.status === "requires_reconciliation") {
      summary.reconciliation += 1;
      logger.warn({ orderId: candidate.order_id }, "Expired reservation is payment-authorized and requires reconciliation");
    }
  }
  return summary;
}

export async function nextReservationExpiry(pool: DatabasePool, orderId: string): Promise<Date | null> {
  const result = await pool.query<{ expires_at: Date | null }>(
    "SELECT min(expires_at) AS expires_at FROM stock_reservations WHERE order_id=$1 AND status='ACTIVE'",
    [orderId],
  );
  return result.rows[0]?.expires_at || null;
}
