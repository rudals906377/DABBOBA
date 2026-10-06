import assert from "node:assert/strict";
import test from "node:test";
import { partialUnusedRefundAmounts } from "./partial-unused-refund-apply.js";
import { partialUnusedRefundPlan, type PartialUnusedRefundCandidate } from "./partial-unused-refunds.js";

test("partial refund amounts follow the owner rule and never exceed what was paid", () => {
  // 3 draws for 9,000원 on the card, 2 unused: floor(9,000 x 2 / 3).
  assert.deepEqual(
    partialUnusedRefundAmounts({ paidCardAmount: 9_000, paidPointAmount: 0, totalDrawUnits: 3, unusedDrawUnits: 2 }),
    { refundValue: 6_000, cardRefundAmount: 6_000, pointRefundAmount: 0 },
  );
  // 8,000원 card + 1,000P: total floor(9,000 x 2 / 3) = 6,000; card floor(8,000 x 2 / 3) = 5,333.
  assert.deepEqual(
    partialUnusedRefundAmounts({ paidCardAmount: 8_000, paidPointAmount: 1_000, totalDrawUnits: 3, unusedDrawUnits: 2 }),
    { refundValue: 6_000, cardRefundAmount: 5_333, pointRefundAmount: 667 },
  );
  // Points only.
  assert.deepEqual(
    partialUnusedRefundAmounts({ paidCardAmount: 0, paidPointAmount: 5_000, totalDrawUnits: 4, unusedDrawUnits: 3 }),
    { refundValue: 3_750, cardRefundAmount: 0, pointRefundAmount: 3_750 },
  );
  // Rounding down to the won.
  assert.deepEqual(
    partialUnusedRefundAmounts({ paidCardAmount: 1_000, paidPointAmount: 0, totalDrawUnits: 3, unusedDrawUnits: 1 }),
    { refundValue: 333, cardRefundAmount: 333, pointRefundAmount: 0 },
  );
  for (let card = 0; card <= 50; card += 7) {
    for (let points = 0; points <= 50; points += 5) {
      for (let total = 2; total <= 6; total += 1) {
        for (let unused = 1; unused < total; unused += 1) {
          const amounts = partialUnusedRefundAmounts({ paidCardAmount: card, paidPointAmount: points, totalDrawUnits: total, unusedDrawUnits: unused });
          assert.equal(amounts.refundValue, Math.floor(((card + points) * unused) / total));
          assert.ok(amounts.cardRefundAmount <= card && amounts.pointRefundAmount <= points);
          assert.equal(amounts.cardRefundAmount + amounts.pointRefundAmount, amounts.refundValue);
        }
      }
    }
  }
  assert.throws(() => partialUnusedRefundAmounts({ paidCardAmount: 1, paidPointAmount: 0, totalDrawUnits: 2, unusedDrawUnits: 2 }));
  assert.throws(() => partialUnusedRefundAmounts({ paidCardAmount: 1, paidPointAmount: 0, totalDrawUnits: 2, unusedDrawUnits: 0 }));
});

function candidate(overrides: Partial<PartialUnusedRefundCandidate> = {}): PartialUnusedRefundCandidate {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    order_id: "22222222-2222-4222-8222-222222222222",
    user_id: "33333333-3333-4333-8333-333333333333",
    provider: "PORTONE_V2_INICIS",
    status: "PAID",
    order_status: "PAID",
    order_kind: "PRODUCT",
    order_total: 8_000,
    cancelled_at: null,
    shipping_request_id: null,
    shipping_status: null,
    shipping_owner_matches: null,
    shipping_item_count: 0,
    amount: 8_000,
    point_total: 1_000,
    paid_ledger: 8_000,
    refund_ledger: 0,
    line_count: 1,
    gacha_line_count: 1,
    draw_line_count: 1,
    expected_draw_units: 3,
    inventory_count: 0,
    entitlement_count: 3,
    available_entitlement_count: 2,
    draw_result_count: 1,
    active_reservation_count: 0,
    ...overrides,
  };
}

test("partial refund plans only partly used, reconciled gacha orders", () => {
  const plan = partialUnusedRefundPlan(candidate());
  assert.equal(plan.blocker, null);
  assert.deepEqual(plan.plan, {
    refundValue: 6_000, cardRefundAmount: 5_333, pointRefundAmount: 667,
    totalDrawUnits: 3, unusedDrawUnits: 2, paidCardAmount: 8_000, paidPointAmount: 1_000,
  });
  assert.equal(partialUnusedRefundPlan(candidate({ provider: "INTERNAL_ZERO", amount: 0, order_total: 0, paid_ledger: 0, point_total: 6_000 })).plan?.pointRefundAmount, 4_000);

  const blockers: Array<[Partial<PartialUnusedRefundCandidate>, RegExp]> = [
    [{ available_entitlement_count: 3, draw_result_count: 0 }, /전액 환불/],
    [{ available_entitlement_count: 0, draw_result_count: 3 }, /사용하지 않은 뽑기권이 없습니다/],
    [{ gacha_line_count: 0 }, /쿠지 주문은 지원하지 않습니다/],
    [{ status: "REFUND_REVIEW", order_status: "REFUND_REVIEW" }, /결제 완료 상태/],
    [{ refund_ledger: -100 }, /원장/],
    [{ paid_ledger: 0 }, /원장/],
    [{ draw_result_count: 0 }, /대사/],
    [{ active_reservation_count: 1 }, /대사/],
    [{ cancelled_at: new Date() }, /취소되지 않은 상품 주문/],
    [{ provider: "TEST_PG" }, /카드 또는 포인트/],
    [{ amount: 0, order_total: 0, paid_ledger: 0, point_total: 0, provider: "INTERNAL_ZERO" }, /돌려드릴 결제 금액이 없습니다/],
  ];
  for (const [override, message] of blockers) {
    const result = partialUnusedRefundPlan(candidate(override));
    assert.match(result.blocker ?? "", message, JSON.stringify(override));
    assert.equal(result.plan, null);
  }
});
