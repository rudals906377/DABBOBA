import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  consumeDrawsSequentially,
  drawEntitlementCountFromPath,
  resolveDrawOpenMode,
  resolveDrawOpenModeDecision,
  verifyCommittedDrawBatch,
  withDrawOpenMode,
} from "../apps/mobile/src/features/draw/draw-open-mode.ts";

const IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];

function order(overrides = {}) {
  return {
    id: "order-1",
    status: "PAID",
    lines: [{ productId: "product-1", category: "gacha", quantity: 3 }],
    drawEntitlementIds: IDS,
    ...overrides,
  };
}

test("one result goes straight to single mode while two or more require a choice", () => {
  assert.deepEqual(resolveDrawOpenModeDecision(1), { kind: "direct", mode: "single" });
  assert.deepEqual(resolveDrawOpenModeDecision(2), { kind: "choose", count: 2 });
  assert.equal(resolveDrawOpenMode("all", 1), "single");
  assert.equal(resolveDrawOpenMode("all", 3), "all");
  assert.equal(resolveDrawOpenMode("anything-else", 3), "single");
});

test("the shared customer prompt exposes exactly the two requested choices", async () => {
  const prompt = await readFile(
    new URL("../apps/mobile/src/features/draw/draw-open-mode-prompt.ts", import.meta.url),
    "utf8",
  );
  assert.match(prompt, /"뽑기 방식 선택"/);
  assert.match(prompt, /"하나씩 뽑기"/);
  assert.match(prompt, /"한 번에 뽑기"/);
  assert.match(prompt, /\{ cancelable: false \}/);
});

test("the selected presentation mode is carried on the reveal route", () => {
  const route = withDrawOpenMode("/draw/reveal/one?orderId=order-1&mode=single", "all");
  assert.equal(route, "/draw/reveal/one?orderId=order-1&mode=all");
  const paidRoute = `/draw/reveal/${IDS[0]}?entitlementIds=${IDS.join(",")}`;
  assert.equal(drawEntitlementCountFromPath(paidRoute), 3);
  assert.equal(drawEntitlementCountFromPath("/draw/reveal/not-authoritative?entitlementIds=bad,bad"), 0);
});

test("batch reveal accepts only an ordered subset of the authenticated paid order", () => {
  assert.deepEqual(verifyCommittedDrawBatch(order(), {
    orderId: "order-1",
    productId: "product-1",
    category: "gacha",
    entitlementIds: IDS,
  }), { entitlementIds: IDS, category: "gacha" });

  assert.deepEqual(verifyCommittedDrawBatch(order(), {
    orderId: "order-1",
    productId: "product-1",
    category: "gacha",
    entitlementIds: IDS.slice(1),
  }), { entitlementIds: IDS.slice(1), category: "gacha" });

  assert.throws(() => verifyCommittedDrawBatch(order(), {
    orderId: "order-1",
    productId: "product-1",
    category: "gacha",
    entitlementIds: [IDS[2], IDS[1]],
  }), /순서/);
  assert.throws(() => verifyCommittedDrawBatch(order({ status: "PENDING_PAYMENT" }), {
    orderId: "order-1",
    productId: "product-1",
    category: "gacha",
    entitlementIds: IDS,
  }), /결제한 주문/);
  assert.throws(() => verifyCommittedDrawBatch(order(), {
    orderId: "another-order",
    productId: "product-1",
    category: "gacha",
    entitlementIds: IDS,
  }), /결제한 주문/);
});

test("batch consumption is sequential and returns committed results on a partial failure", async () => {
  const calls = [];
  let active = 0;
  let maximumActive = 0;
  const failure = new Error("temporary failure");
  const outcome = await consumeDrawsSequentially(IDS, async (id, index) => {
    calls.push(id);
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await Promise.resolve();
    active -= 1;
    if (index === 1) throw failure;
    return { entitlementId: id };
  });

  assert.deepEqual(calls, IDS.slice(0, 2));
  assert.equal(maximumActive, 1);
  assert.deepEqual(outcome.results, [{ entitlementId: IDS[0] }]);
  assert.deepEqual(outcome.remainingEntitlementIds, IDS.slice(1));
  assert.equal(outcome.error, failure);
});

test("a successful batch returns every result in entitlement order", async () => {
  const outcome = await consumeDrawsSequentially(IDS, async (id) => id);
  assert.deepEqual(outcome, { results: IDS, remainingEntitlementIds: [], error: null });
});
