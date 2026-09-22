import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { isCommittedDrawSequenceConsumed } from "../apps/mobile/src/features/draw/draw-reveal-sequence.ts";
import { assertPaidGachaDrawCompletion } from "../apps/mobile/src/features/draw/gacha-completion-state.ts";
import {
  attachOrderToGachaCheckoutIntent,
  createGachaCheckoutOrderIntent,
  paidGachaOrderEntitlementIdsForIntent,
} from "../apps/mobile/src/features/checkout/gacha-checkout-intent.ts";

const screen = readFileSync(new URL("../apps/mobile/src/features/draw/DrawRevealScreen.tsx", import.meta.url), "utf8");
const returnHandlerStart = screen.indexOf("  const returnToSourceProduct = async () => {");
const returnHandlerEnd = [
  screen.indexOf("  const openAllProducts = async () => {", returnHandlerStart),
  screen.indexOf("  const openProduct = async () => {", returnHandlerStart),
].filter((index) => index > returnHandlerStart).sort((left, right) => left - right)[0];
const returnBody = screen.slice(
  returnHandlerStart,
  returnHandlerEnd,
).replace("  const returnToSourceProduct = ", "").trim().replace(/;$/, "").replace(/ as Href/g, "");
assert.ok(returnBody.startsWith("async () => {"), "execute the real screen completion handler");
const ownerRenderBody = screen.slice(
  screen.indexOf("  const requestMountedRef = useRef(true);") + "  const requestMountedRef = useRef(true);".length,
  screen.indexOf("  const isCurrentRequest = useCallback("),
);
assert.match(ownerRenderBody, /activeRouteKeyRef\.current = routeKey/, "execute the real synchronous route-owner update");
const actorId = "10000000-0000-4000-8000-000000000001";
const orderId = "20000000-0000-4000-8000-000000000001";
const ids = ["30000000-0000-4000-8000-000000000001", "30000000-0000-4000-8000-000000000002"];

function completionProof() {
  return {
    orderId, userId: actorId, productId: "gacha-a", probabilityVersion: 1,
    serverNow: "2026-09-06T00:00:05.000Z",
    results: ids.map((entitlementId, index) => ({
      entitlementId, resultId: `60000000-0000-4000-8000-00000000000${index + 1}`,
      committedAt: `2026-09-06T00:00:0${index + 2}.000Z`,
    })),
  };
}

function harness() {
  const calls = [];
  const committedResult = {
    id: "60000000-0000-4000-8000-000000000002",
    entitlementId: ids[1],
    productId: "gacha-a",
    probabilityVersion: 1,
  };
  const intent = attachOrderToGachaCheckoutIntent(createGachaCheckoutOrderIntent(actorId, {
    productId: "gacha-a", quantity: 2, expectedDrawVersion: 1, pointAmount: 1000,
  }, "gacha-order-40000000-0000-4000-8000-000000000001", "2026-09-06T00:00:00.000Z"),
  { id: orderId, status: "PAID" }, "2026-09-06T00:00:01.000Z");
  const order = {
    id: orderId, userId: actorId, status: "PAID", subtotal: 2000, discountTotal: 0,
    pointTotal: 1000, total: 1000,
    lines: [{ productId: "gacha-a", category: "gacha", unitPrice: 1000, quantity: 2, lineTotal: 2000 }],
    drawEntitlementIds: ids,
  };
  const scope = {
    returningRef: { current: false }, routeKey: "current-route",
    completionFocusRef: { current: true }, completionGenerationRef: { current: 0 },
    requestMountedRef: { current: true }, activeRouteKeyRef: { current: "current-route" },
    preview: false, sourceCategory: "gacha", routeOrderId: orderId,
    result: committedResult, settledCommittedResult: committedResult,
    committedBatchComplete: false, revealSettled: true,
    committedSequence: { nextEntitlementId: null, entitlementIds: ids }, completionScope: "order-product-sequence",
    consumedSequenceRef: { current: { scope: "order-product-sequence", ids: new Set(ids) } },
    runtime: { apiBaseUrl: "https://example.invalid" }, db: {}, productId: "gacha-a", sourceProductId: "gacha-a",
    readAuthTokens: async () => ({ accessToken: "test-only" }),
    fetchCheckoutActorId: async () => { calls.push("actor"); return actorId; },
    readPendingGachaCheckoutOrderIntent: async (_db, input) => {
      assert.equal(input.actorId, actorId);
      assert.equal(input.productId, "gacha-a");
      return intent;
    },
    fetchCheckoutOrder: async (_base, _token, id) => { assert.equal(id, orderId); calls.push("order"); return order; },
    fetchPaidGachaDrawCompletion: async () => {
      calls.push("proof");
      throw new Error("whole-order completion has not been confirmed");
    },
    paidGachaOrderEntitlementIds: paidGachaOrderEntitlementIdsForIntent,
    isCommittedDrawSequenceConsumed,
    assertPaidGachaDrawCompletion,
    clearPendingGachaCheckoutOrderIntent: async (_db, saved, isCurrent) => {
      assert.equal(saved, intent);
      if (isCurrent()) calls.push("clear");
    },
    Alert: { alert: () => calls.push("alert") },
    router: { dismissTo: (path) => calls.push(path), replace: (path) => calls.push(path) },
  };
  return { scope, calls, order, intent, run: runInNewContext(`(${returnBody})`, scope) };
}

test("full server-consumed sequence clears only its verified order before returning to product", async () => {
  const h = harness();
  await h.run();
  assert.deepEqual(h.calls, ["actor", "order", "clear", "/product/gacha-a"]);
  assert.equal(h.scope.returningRef.current, false);
});

test("remaining-only recovery retires the original intent only with exact whole-order committed-result proof", async () => {
  const h = harness();
  h.scope.committedSequence.entitlementIds = [ids[1]];
  h.scope.consumedSequenceRef.current.ids = new Set([ids[1]]);
  h.scope.fetchPaidGachaDrawCompletion = async () => {
    h.calls.push("proof");
    return completionProof();
  };
  await h.run();
  assert.deepEqual(h.calls, ["actor", "order", "proof", "clear", "/product/gacha-a"]);
});

test("remaining-only URLs keep recovery on incomplete or mismatched immutable-result proof", async () => {
  const changes = [
    (proof) => { proof.orderId = ids[0]; },
    (proof) => { proof.userId = ids[0]; },
    (proof) => { proof.productId = "other-gacha"; },
    (proof) => { proof.probabilityVersion = 2; },
    (proof) => { proof.results = proof.results.slice(1); },
    (proof) => { proof.results[0].entitlementId = ids[1]; },
    (proof) => { proof.results[0].entitlementId = orderId; },
    (proof) => { proof.results[0].resultId = ""; },
    (proof) => { proof.results[0].resultId = proof.results[1].resultId; },
    (proof) => { proof.results[1].resultId = actorId; },
    (proof) => { proof.results[0].committedAt = "invalid"; },
    (proof) => { proof.results[0].committedAt = "2026-09-07T00:00:00Z"; },
  ];
  for (const change of changes) {
    const h = harness();
    h.scope.committedSequence.entitlementIds = [ids[1]];
    h.scope.consumedSequenceRef.current.ids = new Set([ids[1]]);
    h.scope.fetchPaidGachaDrawCompletion = async () => {
      const proof = completionProof();
      change(proof);
      return proof;
    };
    await h.run();
    assert.ok(!h.calls.includes("clear"));
    assert.deepEqual(h.calls, ["actor", "order", "alert", "/product/gacha-a"]);
  }
});

test("failed whole-order reads and changed sessions retain the original intent without consuming any missing right", async () => {
  for (const scenario of ["offline", "partial", "session-change"]) {
    const h = harness();
    h.scope.committedSequence.entitlementIds = [ids[1]];
    h.scope.consumedSequenceRef.current.ids = new Set([ids[1]]);
    h.scope.fetchPaidGachaDrawCompletion = async () => {
      h.calls.push("proof");
      if (scenario !== "session-change") throw new Error(scenario);
      h.scope.readAuthTokens = async () => ({ accessToken: "different-session" });
      return completionProof();
    };
    await h.run();
    assert.deepEqual(h.calls, ["actor", "order", "proof", "alert", "/product/gacha-a"]);
  }
  assert.doesNotMatch(returnBody, /consumeDrawEntitlement|createGachaCheckoutOrder/);
});

test("blur, re-entry, parameter replacement or back during whole-order proof cannot clear or navigate", async () => {
  for (const invalidate of [
    (scope) => { scope.completionFocusRef.current = false; },
    (scope) => { scope.completionGenerationRef.current += 1; },
    (scope) => { scope.activeRouteKeyRef.current = "other-route"; },
    (scope) => { scope.requestMountedRef.current = false; },
  ]) {
    const h = harness();
    h.scope.committedSequence.entitlementIds = [ids[1]];
    h.scope.consumedSequenceRef.current.ids = new Set([ids[1]]);
    h.scope.fetchPaidGachaDrawCompletion = async () => {
      h.calls.push("proof");
      invalidate(h.scope);
      return completionProof();
    };
    await h.run();
    assert.deepEqual(h.calls, ["actor", "order", "proof"]);
  }
  assert.match(screen, /useFocusEffect\(useCallback[\s\S]*?completionFocusRef\.current = false;[\s\S]*?completionGenerationRef\.current \+= 1/);
  assert.match(screen, /const goBack = \(\) => \{\s*completionFocusRef\.current = false;\s*completionGenerationRef\.current \+= 1/);
});

test("a deferred whole-order proof stays stale after an in-place A to B to A route round-trip", async () => {
  const h = harness();
  h.scope.committedSequence.entitlementIds = [ids[1]];
  h.scope.consumedSequenceRef.current.ids = new Set([ids[1]]);
  let resolveProof;
  h.scope.fetchPaidGachaDrawCompletion = () => {
    h.calls.push("proof");
    return new Promise((resolve) => { resolveProof = resolve; });
  };
  const pending = h.run();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof resolveProof, "function");
  const renderOwner = runInNewContext(`(nextKey) => { routeKey = nextKey; ${ownerRenderBody} }`, h.scope);
  renderOwner("other-route");
  renderOwner("current-route");
  resolveProof(completionProof());
  await pending;
  assert.deepEqual(h.calls, ["actor", "order", "proof"]);
  assert.equal(h.scope.returningRef.current, false);
  const generation = h.scope.completionGenerationRef.current;
  renderOwner("current-route");
  assert.equal(h.scope.completionGenerationRef.current, generation, "an ordinary same-owner render does not invalidate a fresh request");
});

test("preview, kuji, unfinished animation, intermediate result and different sequence keep recovery", async () => {
  const cases = [
    { preview: true }, { sourceCategory: "kuji" },
    { result: null, settledCommittedResult: null }, { revealSettled: false },
    { routeOrderId: "" }, { committedSequence: { nextEntitlementId: ids[1] } },
    { consumedSequenceRef: { current: { scope: "other-sequence", ids: new Set(ids) } } },
  ];
  for (const input of cases) {
    const h = harness();
    Object.assign(h.scope, input);
    await h.run();
    assert.deepEqual(h.calls, ["/product/gacha-a"]);
  }
});

test("last URL alone or an unrelated consumed ticket cannot retire a partially opened order", async () => {
  for (const consumed of [[ids[1]], [ids[1], "50000000-0000-4000-8000-000000000001"]]) {
    const h = harness();
    h.scope.consumedSequenceRef.current.ids = new Set(consumed);
    await h.run();
    assert.deepEqual(h.calls, ["actor", "order", "/product/gacha-a"]);
  }
});

test("foreign, mismatched, cancelled and incomplete orders cannot retire recovery", async () => {
  for (const change of [
    { userId: "10000000-0000-4000-8000-000000000002" },
    ...["PENDING_PAYMENT", "CANCELLED", "REFUND_REVIEW", "REFUNDED"].map((status) => ({ status })),
    { id: "20000000-0000-4000-8000-000000000002" },
    { drawEntitlementIds: [ids[1]] }, { lines: [] },
  ]) {
    const h = harness();
    Object.assign(h.order, change);
    await h.run();
    assert.ok(!h.calls.includes("clear"));
    assert.equal(h.calls.at(-1), "/product/gacha-a");
  }
  const h = harness();
  h.intent.orderId = "20000000-0000-4000-8000-000000000002";
  await h.run();
  assert.deepEqual(h.calls, ["actor", "/product/gacha-a"]);
});

test("network failure retains recovery and returns without claiming a lost prize", async () => {
  const h = harness();
  h.scope.fetchCheckoutOrder = async () => { throw new Error("offline"); };
  await h.run();
  assert.deepEqual(h.calls, ["actor", "alert", "/product/gacha-a"]);
});

test("duplicate completion taps do not retire or navigate twice", async () => {
  const h = harness();
  let release;
  h.scope.fetchCheckoutOrder = () => new Promise((resolve) => { release = resolve; });
  const first = h.run();
  await h.run();
  await new Promise((resolve) => setImmediate(resolve));
  release(h.order);
  await first;
  await h.run(); // Navigation can be queued before the blur callback arrives.
  assert.deepEqual(h.calls, ["actor", "clear", "/product/gacha-a"]);
});

test("route changes or unmount while awaiting the server never clear or navigate stale results", async () => {
  for (const invalidate of [
    (s) => { s.activeRouteKeyRef.current = "new-route"; },
    (s) => { s.requestMountedRef.current = false; },
  ]) {
    const h = harness();
    h.scope.fetchCheckoutOrder = async () => { invalidate(h.scope); return h.order; };
    await h.run();
    assert.deepEqual(h.calls, ["actor"]);
  }
});

test("a route invalidated while SQLite is waiting also retains recovery", async () => {
  const h = harness();
  h.scope.clearPendingGachaCheckoutOrderIntent = async (_db, _intent, isCurrent) => {
    h.scope.activeRouteKeyRef.current = "new-route";
    assert.equal(isCurrent(), false);
  };
  await h.run();
  assert.deepEqual(h.calls, ["actor", "order"]);
  const api = readFileSync(new URL("../apps/mobile/src/features/checkout/checkout-api.ts", import.meta.url), "utf8");
  const clear = api.slice(api.indexOf("export async function clearPendingGachaCheckoutOrderIntent("), api.indexOf("export function kujiCheckoutOrderIdempotencyKey"));
  assert.match(clear, /await transaction\.getFirstAsync[\s\S]*?if \(!row \|\| !isCurrent\(\)\) return/);
  assert.match(clear, /current\.idempotencyKey !== intent\.idempotencyKey/);
  assert.match(clear, /current\.orderId !== intent\.orderId/);
});

test("consumption proof is recorded only after guarded server result identity verification", () => {
  const consume = screen.slice(screen.indexOf("  const openProduct = async () => {"), screen.indexOf("  const handleRevealSettled = () => {"));
  const proofIndex = consume.indexOf("consumedSequenceRef.current.ids.add");
  assert.ok(proofIndex > consume.indexOf("await consumeDrawEntitlement"));
  assert.ok(proofIndex > consume.lastIndexOf("assertCommittedDrawResultMatchesRoute"));
  assert.match(consume.slice(0, proofIndex), /if \(!isCurrentRequest\(generation, owner\)\) return/);
  assert.match(screen, /const completionScope = `\$\{routeOrderId\}:\$\{productId\}:\$\{committedSequence\.entitlementIds/);
});
