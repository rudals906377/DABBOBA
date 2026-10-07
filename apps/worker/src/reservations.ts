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
  order_kind: "PRODUCT" | "SHIPPING_FEE";
  shipping_request_id: string | null;
  created_at: Date;
  provider_observed_settled: boolean;
  /** Set once the customer opened the PortOne window for this payment. */
  pg_attempt_started_at: Date | null;
  /** A worker reconciliation of this payment version verified no charge. */
  provider_verified_no_charge: boolean;
};

type ReservationRow = {
  id: string;
  product_id: string;
  quantity: number;
  expires_at: Date;
};

export type ReconciliationReason =
  | "EXPIRED_ACTIVE_RESERVATION"
  | "PROVIDER_OBSERVED_SETTLED"
  | "OPEN_PAYMENT_WINDOW_UNVERIFIED";

/**
 * How long a claimed PortOne window is left alone before the sweep demands a
 * verified provider read: the worker's default window validity plus a margin
 * for its own schedule.
 */
export const OPEN_PAYMENT_WINDOW_WAIT_MINUTES = 35;

export type PaymentWindowState = {
  startedAt: Date | null;
  verifiedNoCharge: boolean;
  now: Date;
  waitMinutes?: number;
};

export type ExpiryOutcome =
  | { status: "missing" | "not_due" | "already_resolved"; released: 0 }
  | { status: "requires_reconciliation"; released: 0; reason: ReconciliationReason }
  | { status: "expired"; released: number };

/** Provider states that mean money may already have moved for this payment. */
export const PROVIDER_SETTLED_OBSERVATIONS = ["PAID", "AUTHORIZED", "REFUNDED"] as const;

/**
 * Decide the expiry action for a locked order. A locally PENDING payment whose
 * latest worker reconciliation of the same payment version observed the
 * provider as PAID/AUTHORIZED must never be cancelled: the canonical transition
 * has not landed yet (or failed verification), so releasing stock and refunding
 * points would strand a captured payment. Raise the durable alert instead.
 */
export function guardedExpiryAction(
  orderStatus: string,
  paymentStatus: string,
  hasExpiredReservation: boolean,
  providerObservedSettled: boolean,
  paymentWindow: PaymentWindowState | null = null,
): { action: "release" | "wait" } | { action: "reconcile"; reason: ReconciliationReason } {
  const action = reservationExpiryAction(orderStatus, paymentStatus, hasExpiredReservation);
  if (action === "reconcile") return { action, reason: "EXPIRED_ACTIVE_RESERVATION" };
  if (action === "release" && providerObservedSettled) {
    return { action: "reconcile", reason: "PROVIDER_OBSERVED_SETTLED" };
  }
  // A locally PENDING payment whose PortOne window was opened may still be
  // approved after the reservation deadline. Cancelling it here would leave a
  // charge without an order, so the release waits for the worker's verified
  // no-charge read; past the window validity it raises the durable alert.
  if (action === "release" && paymentStatus === "PENDING"
    && paymentWindow?.startedAt && !paymentWindow.verifiedNoCharge) {
    const waitMs = (paymentWindow.waitMinutes ?? OPEN_PAYMENT_WINDOW_WAIT_MINUTES) * 60_000;
    if (paymentWindow.now.getTime() - paymentWindow.startedAt.getTime() < waitMs) return { action: "wait" };
    return { action: "reconcile", reason: "OPEN_PAYMENT_WINDOW_UNVERIFIED" };
  }
  return { action };
}

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
  const ledger = await client.query<{ inserted: number }>(
    `INSERT INTO point_ledger_entries(user_id,entry_type,amount,reference_type,reference_id,reason)
     VALUES($1,'REFUND',$2,'ORDER',$3,'Payment reservation expired')
     ON CONFLICT DO NOTHING
     RETURNING 1 AS inserted`,
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
  shouldContinue: () => boolean,
): Promise<ExpiryOutcome> {
  if (order.order_kind === "SHIPPING_FEE") {
    const due = order.created_at.getTime() + 15 * 60_000 <= now.getTime();
    const decision = guardedExpiryAction(
      order.status,
      order.payment_status,
      due,
      order.provider_observed_settled,
      { startedAt: order.pg_attempt_started_at, verifiedNoCharge: order.provider_verified_no_charge, now },
    );
    if (decision.action === "wait") return { status: "not_due", released: 0 };
    if (decision.action === "reconcile") {
      return { status: "requires_reconciliation", released: 0, reason: decision.reason };
    }
    if (!order.shipping_request_id) throw new Error(`Shipping payment order ${order.id} has no shipping request`);
    const shipping = await client.query<{ status: string }>(
      "SELECT status FROM shipping_requests WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [order.shipping_request_id, order.user_id],
    );
    if (shipping.rows[0]?.status !== "PAYMENT_PENDING") {
      return { status: "already_resolved", released: 0 };
    }
    const expected = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM shipping_request_items WHERE shipping_request_id=$1",
      [order.shipping_request_id],
    );
    const released = await client.query(
      `UPDATE inventory_units inventory SET status='OWNED'
        FROM shipping_request_items item
        WHERE item.shipping_request_id=$1 AND item.inventory_unit_id=inventory.id
          AND inventory.owner_id=$2 AND inventory.status='SHIPPING'
        RETURNING inventory.id`,
      [order.shipping_request_id, order.user_id],
    );
    if (released.rowCount !== Number(expected.rows[0]?.count ?? 0)) {
      throw new Error(`Shipping inventory release invariant failed for ${order.shipping_request_id}`);
    }
    await client.query(
      "UPDATE shipping_requests SET status='CANCELLED',version=version+1 WHERE id=$1 AND status='PAYMENT_PENDING'",
      [order.shipping_request_id],
    );
    await client.query(
      "UPDATE payments SET status='CANCELLED',version=version+1 WHERE id=$1 AND status='PENDING'",
      [order.payment_id],
    );
    const transitioned = await client.query<{ id: string }>(
      "UPDATE orders SET status='CANCELLED',cancelled_at=$2,version=version+1 WHERE id=$1 AND status='PENDING_PAYMENT' RETURNING id",
      [order.id, now],
    );
    if (transitioned.rowCount) await writeCancellationOutbox(client, order);
    return { status: "expired", released: released.rowCount ?? 0 };
  }

  if (!shouldContinue()) throw new Error("Worker run deadline reached before reservation lock");
  const reservations = await client.query<ReservationRow>(
    `SELECT id,product_id,quantity,expires_at
      FROM stock_reservations
      WHERE order_id=$1 AND status='ACTIVE'
      ORDER BY product_id,id
      LIMIT 21
      FOR UPDATE`,
    [order.id],
  );
  if (reservations.rows.length > 20) {
    throw new Error(`Order ${order.id} exceeds the checkout reservation limit`);
  }
  if (!reservations.rowCount) return { status: "already_resolved", released: 0 };
  const hasExpired = reservations.rows.some((reservation) => reservation.expires_at.getTime() <= now.getTime());
  const decision = guardedExpiryAction(
    order.status,
    order.payment_status,
    hasExpired,
    order.provider_observed_settled,
    { startedAt: order.pg_attempt_started_at, verifiedNoCharge: order.provider_verified_no_charge, now },
  );
  if (decision.action === "wait") return { status: "not_due", released: 0 };
  if (decision.action === "reconcile") {
    return { status: "requires_reconciliation", released: 0, reason: decision.reason };
  }

  if (!shouldContinue()) throw new Error("Worker run deadline reached before stock release");
  const requiredByProduct = new Map<string, number>();
  for (const reservation of reservations.rows) {
    requiredByProduct.set(
      reservation.product_id,
      (requiredByProduct.get(reservation.product_id) ?? 0) + Number(reservation.quantity),
    );
  }
  const stock = await client.query<{ product_id: string }>(
    `UPDATE product_stock AS stock
        SET reserved=stock.reserved-required.quantity,version=stock.version+1
       FROM unnest($1::text[], $2::integer[]) AS required(product_id,quantity)
      WHERE stock.product_id=required.product_id AND stock.reserved >= required.quantity
      RETURNING stock.product_id`,
    [[...requiredByProduct.keys()], [...requiredByProduct.values()]],
  );
  if (stock.rowCount !== requiredByProduct.size) {
    throw new Error(`Reservation stock invariant failed for order ${order.id}`);
  }

  if (!shouldContinue()) throw new Error("Worker run deadline reached after stock release");
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

export async function expireOrderReservations(
  pool: DatabasePool,
  orderId: string,
  now = new Date(),
  shouldContinue: () => boolean = () => true,
): Promise<ExpiryOutcome> {
  return withTransaction(pool, async (client) => {
    // Match the API lock order: linked kuji room, payment, order, then stock.
    // The initial linkage lookup is non-locking; order_id becomes immutable once set.
    if (!shouldContinue()) throw new Error("Worker run deadline reached before reservation transaction");
    const linkedKujiRoom = await lockLinkedKujiRoomForOrder(client, orderId);
    if (!shouldContinue()) throw new Error("Worker run deadline reached after kuji room lock");
    const payment = await client.query<{ id: string; status: string; version: number; pg_attempt_started_at: Date | null }>(
      "SELECT id,status,version,pg_attempt_started_at FROM payments WHERE order_id=$1 FOR UPDATE",
      [orderId],
    );
    if (!payment.rowCount) return { status: "missing", released: 0 };
    // The payment row is locked, so its version cannot advance underneath this
    // check; a reconciliation recorded for an older version is stale evidence.
    // RECONCILED on the current version is the worker's verified no-charge
    // read of an opened window (expired or never submitted).
    const observation = await client.query<{ settled: boolean; verified_no_charge: boolean }>(
      `SELECT last_observed_state = ANY($3::text[]) AS settled,
              last_outcome='RECONCILED' AS verified_no_charge
         FROM worker_payment_reconciliations
        WHERE payment_id=$1 AND payment_version=$2`,
      [payment.rows[0]!.id, payment.rows[0]!.version, [...PROVIDER_SETTLED_OBSERVATIONS]],
    );
    const order = await client.query<{ id: string; user_id: string; status: string; point_total: number; order_kind: "PRODUCT" | "SHIPPING_FEE"; shipping_request_id: string | null; created_at: Date }>(
      "SELECT id,user_id,status,point_total,order_kind,shipping_request_id,created_at FROM orders WHERE id=$1 FOR UPDATE",
      [orderId],
    );
    if (!order.rowCount) return { status: "missing", released: 0 };
    const outcome = await expireLockedOrder(client, {
      ...order.rows[0]!,
      payment_id: payment.rows[0]!.id,
      payment_status: payment.rows[0]!.status,
      provider_observed_settled: observation.rows[0]?.settled === true,
      pg_attempt_started_at: payment.rows[0]!.pg_attempt_started_at,
      provider_verified_no_charge: observation.rows[0]?.verified_no_charge === true,
    }, now, shouldContinue);
    if (outcome.status === "expired" && linkedKujiRoom) {
      if (!shouldContinue()) throw new Error("Worker run deadline reached before kuji room release");
      await releaseLockedKujiOrderRoom(client, {
        orderId,
        serverNow: now,
        terminalState: "EXPIRED",
      });
      if (!shouldContinue()) throw new Error("Worker run deadline reached after kuji room release");
    }
    return outcome;
  });
}

export async function expireReservationBatch(
  pool: DatabasePool,
  batchSize: number,
  logger: Logger,
  now = new Date(),
  shouldContinue: () => boolean = () => true,
): Promise<{ examined: number; expired: number; released: number; reconciliation: number }> {
  if (!shouldContinue()) return { examined: 0, expired: 0, released: 0, reconciliation: 0 };
  const candidates = await pool.query<{ order_id: string; payment_id: string }>(
    `SELECT o.id AS order_id,p.id AS payment_id
       FROM orders o
       JOIN payments p ON p.order_id=o.id
      WHERE o.status IN ('PENDING_PAYMENT','CANCELLED')
        AND (
          (o.order_kind='PRODUCT' AND EXISTS (
            SELECT 1 FROM stock_reservations sr
             WHERE sr.order_id=o.id AND sr.status='ACTIVE' AND sr.expires_at <= $1
          ))
          OR
          (o.order_kind='SHIPPING_FEE'
            AND o.status='PENDING_PAYMENT'
            AND o.created_at <= $1 - interval '15 minutes'
            AND EXISTS (
              SELECT 1 FROM shipping_requests s
               WHERE s.id=o.shipping_request_id AND s.status='PAYMENT_PENDING'
            ))
        )
        AND (
          (
            p.status IN ('PENDING','FAILED','CANCELLED')
            -- A PENDING payment with an opened PortOne window is released only
            -- after the worker verified no charge for this payment version.
            -- Until then it waits; once alerted it stops being re-examined.
            AND NOT (
              p.status='PENDING' AND p.pg_attempt_started_at IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM worker_payment_reconciliations r
                 WHERE r.payment_id=p.id AND r.payment_version=p.version
                   AND r.last_outcome='RECONCILED'
              )
              AND (
                p.pg_attempt_started_at > $1 - ($3::integer * interval '1 minute')
                OR EXISTS (
                  SELECT 1 FROM outbox_events event
                   WHERE event.aggregate_type='PAYMENT'
                     AND event.aggregate_id=p.id::text
                     AND event.event_type='payment.reservation_expired_requires_reconciliation'
                )
              )
            )
            -- A releasable row whose provider was already observed settled has
            -- been turned into one durable alert; stop re-examining it until
            -- the payment version changes.
            AND NOT (
              EXISTS (
                SELECT 1 FROM worker_payment_reconciliations r
                 WHERE r.payment_id=p.id AND r.payment_version=p.version
                   AND r.last_observed_state IN ('PAID','AUTHORIZED','REFUNDED')
              )
              AND EXISTS (
                SELECT 1 FROM outbox_events event
                 WHERE event.aggregate_type='PAYMENT'
                   AND event.aggregate_id=p.id::text
                   AND event.event_type='payment.reservation_expired_requires_reconciliation'
              )
            )
          )
          OR (
            p.status IN ('AUTHORIZED','PAID','REFUND_REVIEW','REFUNDED')
            AND NOT EXISTS (
              SELECT 1 FROM outbox_events event
               WHERE event.aggregate_type='PAYMENT'
                 AND event.aggregate_id=p.id::text
                 AND event.event_type='payment.reservation_expired_requires_reconciliation'
            )
          )
        )
      ORDER BY
        CASE WHEN p.status IN ('PENDING','FAILED','CANCELLED') THEN 0 ELSE 1 END,
        o.id
      LIMIT $2`,
    [now, batchSize, OPEN_PAYMENT_WINDOW_WAIT_MINUTES],
  );

  const summary = { examined: 0, expired: 0, released: 0, reconciliation: 0 };
  for (const candidate of candidates.rows) {
    if (!shouldContinue()) break;
    summary.examined += 1;
    const outcome = await expireOrderReservations(pool, candidate.order_id, now, shouldContinue);
    if (outcome.status === "expired") {
      summary.expired += 1;
      summary.released += outcome.released;
    } else if (outcome.status === "requires_reconciliation") {
      if (!shouldContinue()) break;
      const event = await pool.query(
        `INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload,correlation_id)
         VALUES('PAYMENT',$1,'payment.reservation_expired_requires_reconciliation',$2,$3)
         ON CONFLICT DO NOTHING`,
        [
          candidate.payment_id,
          JSON.stringify({
            paymentId: candidate.payment_id,
            orderId: candidate.order_id,
            reason: outcome.reason,
          }),
          `worker-reservation-reconciliation-${candidate.order_id}`,
        ],
      );
      const recorded = Boolean(event.rowCount);
      summary.reconciliation += 1;
      logger.warn(
        {
          orderId: candidate.order_id,
          paymentId: candidate.payment_id,
          reason: outcome.reason,
          durableAlertRecorded: recorded,
        },
        "Expired reservation is payment-authorized and requires reconciliation",
      );
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
