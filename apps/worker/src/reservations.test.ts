import assert from "node:assert/strict";
import test from "node:test";
import type { DatabasePool } from "@dabboba/db";
import type { Logger } from "./logger.js";
import {
  expireReservationBatch,
  guardedExpiryAction,
  PROVIDER_SETTLED_OBSERVATIONS,
  reservationExpiryAction,
} from "./reservations.js";

test("only unpaid pending or already-cancelled orders release expired reservations", () => {
  assert.equal(reservationExpiryAction("PENDING_PAYMENT", "PENDING", true), "release");
  assert.equal(reservationExpiryAction("CANCELLED", "FAILED", true), "release");
  assert.equal(reservationExpiryAction("PENDING_PAYMENT", "PENDING", false), "wait");
});

test("authorized or paid reservations are never released by the expiry sweeper", () => {
  assert.equal(reservationExpiryAction("PENDING_PAYMENT", "AUTHORIZED", true), "reconcile");
  assert.equal(reservationExpiryAction("PAID", "PAID", true), "reconcile");
  assert.equal(reservationExpiryAction("REFUND_REVIEW", "REFUND_REVIEW", true), "reconcile");
});

test("a provider-settled observation turns a would-be release into a reconciliation alert", () => {
  assert.deepEqual(guardedExpiryAction("PENDING_PAYMENT", "PENDING", true, true), {
    action: "reconcile",
    reason: "PROVIDER_OBSERVED_SETTLED",
  });
  assert.deepEqual(guardedExpiryAction("PENDING_PAYMENT", "PENDING", true, false), { action: "release" });
  assert.deepEqual(guardedExpiryAction("PENDING_PAYMENT", "PENDING", false, true), { action: "wait" });
  assert.deepEqual(guardedExpiryAction("PENDING_PAYMENT", "AUTHORIZED", true, false), {
    action: "reconcile",
    reason: "EXPIRED_ACTIVE_RESERVATION",
  });
  assert.deepEqual([...PROVIDER_SETTLED_OBSERVATIONS], ["PAID", "AUTHORIZED", "REFUNDED"]);
});

test("an opened PortOne window waits for a verified no-charge read before its reservation is released", () => {
  const now = new Date("2026-10-07T00:40:00.000Z");
  const window = (minutesAgo: number, verifiedNoCharge: boolean) => ({
    startedAt: new Date(now.getTime() - minutesAgo * 60_000), verifiedNoCharge, now,
  });
  // Inside the window validity the sweep leaves the order alone.
  assert.deepEqual(guardedExpiryAction("PENDING_PAYMENT", "PENDING", true, false, window(10, false)), { action: "wait" });
  // Past it, an unverified window becomes a durable alert, never a release.
  assert.deepEqual(guardedExpiryAction("PENDING_PAYMENT", "PENDING", true, false, window(40, false)), {
    action: "reconcile",
    reason: "OPEN_PAYMENT_WINDOW_UNVERIFIED",
  });
  // The worker's RECONCILED read of this payment version proves no charge.
  assert.deepEqual(guardedExpiryAction("PENDING_PAYMENT", "PENDING", true, false, window(10, true)), { action: "release" });
  // A window that was never opened releases as before.
  assert.deepEqual(guardedExpiryAction("PENDING_PAYMENT", "PENDING", true, false, { startedAt: null, verifiedNoCharge: false, now }), { action: "release" });
  // A settled observation still wins over the window rule.
  assert.deepEqual(guardedExpiryAction("PENDING_PAYMENT", "PENDING", true, true, window(10, false)), {
    action: "reconcile",
    reason: "PROVIDER_OBSERVED_SETTLED",
  });
  // A payment the provider already failed or cancelled never waits on the window.
  assert.deepEqual(guardedExpiryAction("PENDING_PAYMENT", "FAILED", true, false, window(1, false)), { action: "release" });
});

test("the sweep candidate query narrows shipping-fee orders and skips already-alerted settled observations", async () => {
  const queries: string[] = [];
  const pool = {
    async query(sql: string) {
      queries.push(sql);
      return { rowCount: 0, rows: [] };
    },
  } as unknown as DatabasePool;
  const logger = { debug() {}, info() {}, warn() {}, error() {} } as Logger;
  const summary = await expireReservationBatch(pool, 10, logger, new Date("2026-09-30T00:00:00.000Z"));
  assert.deepEqual(summary, { examined: 0, expired: 0, released: 0, reconciliation: 0 });
  const sql = queries[0] ?? "";
  assert.match(
    sql,
    /o\.order_kind='SHIPPING_FEE'\s+AND o\.status='PENDING_PAYMENT'\s+AND o\.created_at <= \$1 - interval '15 minutes'\s+AND EXISTS \(\s*SELECT 1 FROM shipping_requests s\s+WHERE s\.id=o\.shipping_request_id AND s\.status='PAYMENT_PENDING'/,
  );
  assert.match(
    sql,
    /worker_payment_reconciliations r\s+WHERE r\.payment_id=p\.id AND r\.payment_version=p\.version\s+AND r\.last_observed_state IN \('PAID','AUTHORIZED','REFUNDED'\)/,
  );
});
