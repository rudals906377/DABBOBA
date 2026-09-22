import assert from "node:assert/strict";
import test from "node:test";

import { continuePendingDemoCheckout } from "../apps/mobile/src/features/demo/demo-checkout-continuation.ts";

const pendingOrder = { id: "order-1", status: "PENDING_PAYMENT" };
const paidOrder = {
  id: "order-1",
  status: "PAID",
  drawEntitlementIds: ["entitlement-1"],
};

test("demo checkout does not mutate a disabled or already-settled order", async () => {
  let approvals = 0;
  const approve = async () => {
    approvals += 1;
    return paidOrder;
  };

  assert.equal(await continuePendingDemoCheckout({
    enabled: false,
    order: pendingOrder,
    approve,
    isCurrent: () => true,
  }), pendingOrder);
  assert.equal(await continuePendingDemoCheckout({
    enabled: true,
    order: paidOrder,
    approve,
    isCurrent: () => true,
  }), paidOrder);
  assert.equal(approvals, 0);
});

test("disabled and already-settled orders never continue after checkout changes", async () => {
  const approve = async () => paidOrder;

  assert.equal(await continuePendingDemoCheckout({
    enabled: false,
    order: pendingOrder,
    approve,
    isCurrent: () => false,
  }), null);
  assert.equal(await continuePendingDemoCheckout({
    enabled: true,
    order: paidOrder,
    approve,
    isCurrent: () => false,
  }), null);
});

test("one explicit test payment returns the server-refreshed paid order", async () => {
  const calls = [];
  const result = await continuePendingDemoCheckout({
    enabled: true,
    order: pendingOrder,
    approve: async (orderId) => {
      calls.push(`approve:${orderId}`);
      return paidOrder;
    },
    isCurrent: () => {
      calls.push("current");
      return true;
    },
  });

  assert.equal(result, paidOrder);
  assert.deepEqual(calls, ["current", "approve:order-1", "current"]);
});

test("a completed transition never continues after checkout or session changes", async () => {
  assert.equal(await continuePendingDemoCheckout({
    enabled: true,
    order: pendingOrder,
    approve: async () => paidOrder,
    isCurrent: () => false,
  }), null);
});

test("a transition response for another order is rejected", async () => {
  await assert.rejects(
    continuePendingDemoCheckout({
      enabled: true,
      order: pendingOrder,
      approve: async () => ({ ...paidOrder, id: "order-2" }),
      isCurrent: () => true,
    }),
    /현재 주문을 안전하게 다시 확인하지 못했습니다/,
  );
});

test("transition failures propagate so the pending order can be retried", async () => {
  const failure = new Error("temporary TEST_PG failure");
  await assert.rejects(
    continuePendingDemoCheckout({
      enabled: true,
      order: pendingOrder,
      approve: async () => { throw failure; },
      isCurrent: () => true,
    }),
    failure,
  );
});
