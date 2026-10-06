import assert from "node:assert/strict";
import test from "node:test";
import { normalDrawRefundBlocker, type NormalDrawRefundCandidate } from "./portone-payments.js";
import { pointOrderRefundBlocker, pointOrderRefundEventId } from "./point-order-refunds.js";

const pointOrder: NormalDrawRefundCandidate = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  order_id: "550e8400-e29b-41d4-a716-446655440001",
  provider: "INTERNAL_ZERO",
  status: "PAID",
  order_status: "PAID",
  order_kind: "PRODUCT",
  order_total: 0,
  cancelled_at: null,
  shipping_request_id: null,
  shipping_status: null,
  shipping_owner_matches: null,
  shipping_item_count: 0,
  amount: 0,
  point_total: 10_000,
  paid_ledger: 0,
  refund_ledger: 0,
  line_count: 1,
  inventory_count: 0,
  entitlement_count: 2,
  active_reservation_count: 0,
  draw_line_count: 1,
  expected_draw_units: 2,
  available_entitlement_count: 2,
  draw_result_count: 0,
};

test("point-order refund accepts only an entirely unused PAID points-only draw order", () => {
  assert.equal(pointOrderRefundBlocker(pointOrder), null);
  // A coupon may cover part of the total; only the external amount must be zero.
  assert.equal(pointOrderRefundBlocker({ ...pointOrder, point_total: 0 }), null);
  for (const change of [
    { provider: "PORTONE_V2_INICIS" },
    { provider: "TEST_PG" },
    { status: "REFUND_REVIEW" },
    { status: "REFUNDED", order_status: "REFUNDED" },
    { order_status: "FULFILLED" },
    { order_kind: "SHIPPING_FEE" },
    { cancelled_at: new Date() },
    { amount: 1_000 },
    { order_total: 1_000 },
    { paid_ledger: 1_000 },
    { refund_ledger: -1_000 },
    { line_count: 0, draw_line_count: 0 },
    { line_count: 2 },
    { expected_draw_units: 0 },
    { entitlement_count: 1 },
    { available_entitlement_count: 1 },
    { draw_result_count: 1 },
    { inventory_count: 1 },
    { active_reservation_count: 1 },
  ]) {
    assert.notEqual(pointOrderRefundBlocker({ ...pointOrder, ...change }), null, JSON.stringify(change));
  }
});

test("card and point-order refunds never accept each other's payments", () => {
  assert.notEqual(normalDrawRefundBlocker(pointOrder, "PAID"), null);
  const cardOrder = { ...pointOrder, provider: "PORTONE_V2_INICIS", amount: 9_000, order_total: 9_000, paid_ledger: 9_000, point_total: 1_000 };
  assert.equal(normalDrawRefundBlocker(cardOrder, "PAID"), null);
  assert.notEqual(pointOrderRefundBlocker(cardOrder), null);
});

test("each payment has exactly one deterministic internal refund event id", () => {
  assert.equal(
    pointOrderRefundEventId("550e8400-e29b-41d4-a716-446655440000"),
    "internal-zero-refund:550e8400-e29b-41d4-a716-446655440000",
  );
  assert.ok(pointOrderRefundEventId("550e8400-e29b-41d4-a716-446655440000").length <= 200);
});
