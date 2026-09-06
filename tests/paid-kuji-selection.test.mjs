import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { preparePaidKujiSelection } from "../apps/mobile/src/features/kuji/paid-kuji-selection-state.ts";
import { createKujiSelectionRequestScope } from "../apps/mobile/src/features/kuji/kuji-selection-request-scope.ts";

const orderId = "11111111-1111-4111-8111-111111111111";
const roomEntryId = "22222222-2222-4222-8222-222222222222";
const ids = ["33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"];
const expected = { orderId, roomEntryId, productId: "historical-kuji", entitlementIds: ids };

function snapshot() {
  const serverNow = "2026-09-06T00:00:00.000Z";
  return {
    recovery: {
      orderId, productId: expected.productId, roomEntryId,
      userId: "55555555-5555-4555-8555-555555555555", roomState: "EXPIRED",
      serverNow, drawingExpiresAt: "2026-09-05T00:05:00.000Z",
      probabilityVersion: 3, totalSlots: 4, entitlementIds: [...ids], bindings: [],
    },
    product: { name: "구매 당시 쿠지", category: "kuji", unitPrice: 9900, currentImageUrl: null, currentIpName: null },
    board: {
      productId: expected.productId, probabilityVersion: 3, snapshotVersion: 8, totalSlots: 4,
      publishedAt: "2026-09-01T00:00:00.000Z", calculatedAt: serverNow,
      slots: [true, false, true, true].map((available, index) => ({ slotNumber: index + 1, available })),
      tiers: [{ tierCode: "A", tierRank: 0, label: "A상", initialQuantity: 4, remainingQuantity: 4 }],
    },
  };
}

test("a paid unbound kuji uses its original board even without public catalog data and keeps an elapsed lease", () => {
  const value = snapshot();
  const before = structuredClone(value);
  const prepared = preparePaidKujiSelection(value, expected);
  assert.equal(prepared.kind, "SELECT");
  assert.equal(prepared.board.probabilityVersion, 3);
  assert.equal(prepared.snapshot.product.name, "구매 당시 쿠지");
  assert.equal(prepared.snapshot.product.unitPrice, 9900);
  assert.equal(prepared.snapshot.recovery.drawingExpiresAt, "2026-09-05T00:05:00.000Z");
  assert.deepEqual(value, before);
});

test("a lost bind response recovers stored slot mapping and partially consumed orders only open remaining rights", () => {
  const value = snapshot();
  value.board = null;
  value.recovery.bindings = [
    { entitlementId: ids[1], slotNumber: 4, state: "RESERVED" },
    { entitlementId: ids[0], slotNumber: 1, state: "RESERVED" },
  ];
  const result = preparePaidKujiSelection(value, expected);
  assert.equal(result.kind, "REVEAL");
  const url = new URL(result.path, "https://example.test");
  assert.equal(url.pathname, `/draw/reveal/${ids[0]}`);
  assert.equal(url.searchParams.get("tickets"), "01,04");
  assert.equal(url.searchParams.get("entitlementIds"), ids.join(","));
  value.recovery.entitlementIds = [ids[1]];
  value.recovery.bindings = [value.recovery.bindings[0]];
  const partial = preparePaidKujiSelection(value, expected);
  assert.equal(partial.kind, "REVEAL");
  assert.equal(new URL(partial.path, "https://example.test").searchParams.get("tickets"), "04");
});

test("a completed order cannot create a new board or reuse a consumed right", () => {
  const value = snapshot();
  value.recovery.entitlementIds = [];
  value.recovery.roomState = "COMPLETED";
  value.board = null;
  assert.deepEqual(preparePaidKujiSelection(value, expected), { kind: "DONE" });
});

test("wrong actor shape, route identity, deck version, mixed binding and malformed availability fail closed", () => {
  const changes = [
    (value) => { value.recovery.userId = ""; },
    (value) => { value.recovery.orderId = ids[0]; },
    (value) => { value.recovery.roomEntryId = ids[0]; },
    (value) => { value.recovery.productId = "other"; },
    (value) => { value.recovery.entitlementIds = [ids[0], orderId]; },
    (value) => { value.recovery.entitlementIds = [ids[0]]; },
    (value) => { value.board.probabilityVersion = 4; },
    (value) => { value.board.calculatedAt = "2026-09-07T00:00:00.000Z"; },
    (value) => { value.board.slots[0].slotNumber = 2; },
    (value) => { value.board.slots[0].available = false; value.board.slots[2].available = false; },
    (value) => { value.board.tiers[0].initialQuantity = 10; },
    (value) => { value.product.unitPrice = -1; },
    (value) => { value.recovery.bindings = [{ entitlementId: ids[0], slotNumber: 1, state: "RESERVED" }]; value.board = null; },
  ];
  for (const change of changes) {
    const value = snapshot();
    change(value);
    assert.throws(() => preparePaidKujiSelection(value, expected));
  }
});

test("the selection screen fetches only its owned paid snapshot and suppresses stale callbacks", async () => {
  const screen = await readFile(new URL("../apps/mobile/src/features/kuji/KujiDrawScreen.tsx", import.meta.url), "utf8");
  const api = await readFile(new URL("../apps/mobile/src/features/kuji/kuji-slot-api.ts", import.meta.url), "utf8");
  assert.doesNotMatch(screen, /fetchProductDetail|fetchKujiSlotBoard|fetchKujiRoom|\/v1\/orders["']/);
  assert.match(screen, /preparePaidKujiSelection/);
  assert.match(screen, /if \(!current\(\)\) return/);
  assert.match(screen, /latestTokens\?\.accessToken !== tokens\.accessToken/);
  assert.match(screen, /prepared\.kind === "REVEAL"/);
  assert.match(screen, /useFocusEffect\(useCallback/);
  assert.match(screen, /requestScope\.setOwner\(JSON\.stringify\(\[productId, paidDrawRoute\]\)\)/);
  assert.match(screen, /const goBack = \(\) => \{\s*requestScope\.invalidate\(\)/);
  assert.match(screen, /bindingRef\.current === bindingRequest/);
  assert.match(api, /result\.data\.recovery\.userId !== actor\.data\.actor\?\.userId/);
});

test("a mounted route that loses focus never applies late load or bind responses, including after re-entry", async () => {
  const scope = createKujiSelectionRequestScope();
  scope.setOwner("original-paid-order");
  scope.focus();
  const currentLoad = scope.beginRequest();
  const currentBind = scope.captureCurrentRequest();
  let resolveResponse;
  const response = new Promise((resolve) => { resolveResponse = resolve; });
  const navigation = [];
  const pending = response.then(() => {
    if (currentLoad()) navigation.push("old-load-reveal");
    if (currentBind()) navigation.push("old-bind-reveal");
  });
  scope.invalidate(); // A push blurs this route without unmounting it.
  scope.focus();
  const newLoad = scope.beginRequest();
  resolveResponse();
  await pending;
  assert.deepEqual(navigation, []);
  assert.equal(newLoad(), true);
});

test("route parameter changes and local back invalidate synchronously before effects or navigation commit", () => {
  const scope = createKujiSelectionRequestScope();
  scope.setOwner("order-a");
  scope.focus();
  const previous = scope.beginRequest();
  scope.setOwner("order-b");
  assert.equal(previous(), false);
  assert.equal(scope.isFocused(), false);
  scope.focus();
  const current = scope.beginRequest();
  scope.setOwner("order-b"); // An ordinary render retains this request's ownership.
  assert.equal(current(), true);
  scope.invalidate(); // Back must invalidate before the queued router action.
  assert.equal(current(), false);
});
