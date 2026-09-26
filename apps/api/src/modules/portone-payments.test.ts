import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { PortOneCardPayment } from "../lib/portone-v2.js";
import { lateRefundBlocker, normalDrawRefundBlocker, normalizedPortOneEventForPayment } from "./portone-payments.js";

function payment(
  status: PortOneCardPayment["status"],
  amount: PortOneCardPayment["amount"] = { total: 12_000, paid: 12_000, cancelled: 0 },
): PortOneCardPayment {
  return {
    paymentId: "550e8400-e29b-41d4-a716-446655440000",
    portOneTransactionId: "txn-portone",
    pgTransactionId: "txn-inicis",
    status,
    version: "V2",
    merchantId: "merchant",
    storeId: "store",
    channel: { key: "channel", environment: "TEST", pgProvider: "INICIS_V2" },
    method: "CARD",
    amount,
    currency: "KRW",
    requestedAt: "2026-09-20T00:00:00.000Z",
    statusChangedAt: "2026-09-20T00:00:02.000Z",
    paidAt: status === "PAID" ? "2026-09-20T00:00:02.000Z" : null,
    failedAt: status === "FAILED" ? "2026-09-20T00:00:02.000Z" : null,
    cancelledAt: status.includes("CANCELLED") ? "2026-09-20T00:00:02.000Z" : null,
    cancellations: [],
  };
}

test("PortOne pending states do not mutate the local order", () => {
  assert.equal(normalizedPortOneEventForPayment(payment("READY", { total: 12_000, paid: 0, cancelled: 0 })), null);
  assert.equal(normalizedPortOneEventForPayment(payment("PAY_PENDING", { total: 12_000, paid: 0, cancelled: 0 })), null);
  assert.equal(normalizedPortOneEventForPayment(payment("VIRTUAL_ACCOUNT_ISSUED", { total: 12_000, paid: 0, cancelled: 0 })), null);
  assert.equal(normalizedPortOneEventForPayment({
    ...payment("READY", { total: 12_000, paid: 0, cancelled: 0 }),
    channel: null,
    method: null,
  }), null);
  assert.equal(normalizedPortOneEventForPayment({
    ...payment("PAY_PENDING", { total: 12_000, paid: 0, cancelled: 0 }),
    method: null,
  }), null);
});

test("contradictory provider status and money amounts require review, not fulfillment or cancellation", () => {
  const scenarios = [
    payment("READY", { total: 12_000, paid: 12_000, cancelled: 0 }),
    payment("PAY_PENDING", { total: 12_000, paid: 1_000, cancelled: 0 }),
    payment("FAILED", { total: 12_000, paid: 12_000, cancelled: 0 }),
    payment("PAID", { total: 12_000, paid: 12_000, cancelled: 2_000 }),
  ];
  for (const providerPayment of scenarios) {
    const event = normalizedPortOneEventForPayment(providerPayment);
    assert.equal(event?.eventType, "PAYMENT_STATE_ANOMALY", providerPayment.status);
    assert.equal(event?.paymentId, providerPayment.paymentId);
  }
});

test("PortOne paid, failed, and pre-payment cancelled states map to canonical events", () => {
  assert.equal(normalizedPortOneEventForPayment(payment("PAID"))?.eventType, "PAYMENT_SUCCEEDED");
  assert.equal(normalizedPortOneEventForPayment(payment("FAILED", { total: 12_000, paid: 0, cancelled: 0 }))?.eventType, "PAYMENT_FAILED");
  assert.equal(
    normalizedPortOneEventForPayment(payment("CANCELLED", { total: 12_000, paid: 0, cancelled: 0 }))?.eventType,
    "PAYMENT_CANCELLED",
  );
});

test("a paid provider status never substitutes the requested total for the amount actually paid", () => {
  const inconsistentPaid = normalizedPortOneEventForPayment(
    payment("PAID", { total: 12_000, paid: 9_000, cancelled: 0 }),
  );
  assert.equal(inconsistentPaid?.eventType, "PAYMENT_SUCCEEDED");
  assert.equal(inconsistentPaid?.amount, 9_000);
});

test("a cancelled provider status carries the observed refund amount, not the requested total", () => {
  const inconsistentRefund = normalizedPortOneEventForPayment(
    payment("CANCELLED", { total: 12_000, paid: 9_000, cancelled: 9_000 }),
  );
  assert.equal(inconsistentRefund?.eventType, "REFUND_SUCCEEDED");
  assert.equal(inconsistentRefund?.amount, 9_000);
});

test("full cancellation maps to refund while every partial-cancellation amount requires review", () => {
  const full = normalizedPortOneEventForPayment(
    payment("CANCELLED", { total: 12_000, paid: 12_000, cancelled: 12_000 }),
  );
  assert.equal(full?.eventType, "REFUND_SUCCEEDED");
  assert.equal(full?.amount, 12_000);

  const partial = normalizedPortOneEventForPayment(
    payment("PARTIAL_CANCELLED", { total: 12_000, paid: 12_000, cancelled: 3_000 }),
  );
  assert.equal(partial?.eventType, "REFUND_PARTIAL");
  assert.equal(partial?.amount, 3_000);
  for (const cancelled of [0, 12_000]) {
    const contradictory = normalizedPortOneEventForPayment(
      payment("PARTIAL_CANCELLED", { total: 12_000, paid: 12_000, cancelled }),
    );
    assert.equal(contradictory?.eventType, "REFUND_PARTIAL");
    assert.equal(contradictory?.amount, cancelled);
  }
});

test("normalized event id is deterministic for the same provider state", () => {
  const first = normalizedPortOneEventForPayment(payment("PAID"));
  const second = normalizedPortOneEventForPayment(payment("PAID"));
  assert.equal(first?.eventId, second?.eventId);
  assert.equal(first?.providerPaymentId, "txn-inicis");
});

const lateRefund = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  order_id: "550e8400-e29b-41d4-a716-446655440001",
  provider: "PORTONE_V2_INICIS",
  status: "REFUND_REVIEW",
  order_status: "REFUND_REVIEW",
  order_kind: "PRODUCT",
  order_total: 10_000,
  cancelled_at: new Date("2026-09-20T00:00:00.000Z"),
  shipping_request_id: null,
  shipping_status: null,
  shipping_owner_matches: null,
  shipping_item_count: 0,
  amount: 10_000,
  point_total: 0,
  paid_ledger: 10_000,
  refund_ledger: 0,
  line_count: 1,
  inventory_count: 0,
  entitlement_count: 0,
  active_reservation_count: 0,
};

test("provider cancellation only permits a fully paid late order with no customer asset", () => {
  assert.equal(lateRefundBlocker(lateRefund), null);
  for (const change of [
    { status: "PAID" },
    { order_kind: "SHIPPING_FEE" },
    { cancelled_at: null },
    { amount: 0 },
    { order_total: 9_000 },
    { point_total: 500 },
    { paid_ledger: 9_000 },
    { refund_ledger: -10_000 },
    { line_count: 0 },
    { inventory_count: 1 },
    { entitlement_count: 1 },
    { active_reservation_count: 1 },
  ]) {
    assert.notEqual(lateRefundBlocker({ ...lateRefund, ...change }), null, JSON.stringify(change));
  }
});

test("late shipping-fee refund requires a cancelled, owned request with items and no order lines", () => {
  const shipping = {
    ...lateRefund,
    order_kind: "SHIPPING_FEE",
    shipping_request_id: "550e8400-e29b-41d4-a716-446655440002",
    shipping_status: "CANCELLED",
    shipping_owner_matches: true,
    shipping_item_count: 1,
    amount: 3_000,
    order_total: 3_000,
    paid_ledger: 3_000,
    line_count: 0,
  };
  assert.equal(lateRefundBlocker(shipping), null);
  for (const change of [
    { shipping_request_id: null },
    { shipping_status: "PAYMENT_PENDING" },
    { shipping_status: "REQUESTED" },
    { shipping_status: "SHIPPED" },
    { shipping_owner_matches: false },
    { shipping_item_count: 0 },
    { line_count: 1 },
    { cancelled_at: null },
    { order_total: 2_000 },
  ]) {
    assert.notEqual(lateRefundBlocker({ ...shipping, ...change }), null, JSON.stringify(change));
  }
});

const normalDrawRefund = {
  ...lateRefund,
  status: "PAID",
  order_status: "PAID",
  cancelled_at: null,
  point_total: 2_000,
  order_total: 10_000,
  draw_line_count: 1,
  expected_draw_units: 1,
  entitlement_count: 1,
  available_entitlement_count: 1,
  draw_result_count: 0,
};

test("normal full refund accepts only an entirely unconsumed paid draw order", () => {
  assert.equal(normalDrawRefundBlocker(normalDrawRefund, "PAID"), null);
  assert.equal(normalDrawRefundBlocker({ ...normalDrawRefund, status: "REFUND_REVIEW", order_status: "REFUND_REVIEW" }, "REFUND_REVIEW"), null);
  for (const change of [
    { status: "FAILED" },
    { order_status: "FULFILLED" },
    { order_kind: "SHIPPING_FEE" },
    { cancelled_at: new Date() },
    { order_total: 9_000 },
    { line_count: 2 },
    { expected_draw_units: 0 },
    { available_entitlement_count: 0 },
    { entitlement_count: 0 },
    { draw_result_count: 1 },
    { inventory_count: 1 },
    { active_reservation_count: 1 },
    { paid_ledger: 9_000 },
    { refund_ledger: -10_000 },
  ]) {
    assert.notEqual(normalDrawRefundBlocker({ ...normalDrawRefund, ...change }, "PAID"), null, JSON.stringify(change));
  }
});

test("provider cancellation migration is durable, super-admin only, and backend-only", async () => {
  const sql = await readFile(
    new URL("../../../../packages/db/migrations/0069_portone_refund_cancellation_attempts.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /payment_id uuid PRIMARY KEY/);
  assert.match(sql, /'CALLING','PROVIDER_PENDING','INDETERMINATE'/);
  assert.match(sql, /'SUPER_ADMIN', 'refunds\.cancel'/);
  assert.doesNotMatch(sql, /'ADMIN', 'refunds\.cancel'/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE .*dabboba_runtime/);
});
