import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createKujiDrawLeaseClock,
  formatKujiDrawLeaseRemainingTime,
  kujiDrawLeaseRemainingSeconds,
} from "../apps/mobile/src/features/kuji/kuji-draw-lease-state.ts";
import {
  formatKujiSlotNumber,
  parseKujiPaidDrawRoute,
  validateKujiSlotBinding,
} from "../apps/mobile/src/features/kuji/kuji-slot-state.ts";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const ROOM_ENTRY_ID = "22222222-2222-4222-8222-222222222222";
const ENTITLEMENT_IDS = [
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
];

test("paid kuji draw route requires one order, room entry, and exact entitlement count", () => {
  assert.deepEqual(parseKujiPaidDrawRoute({
    orderId: ORDER_ID,
    roomEntryId: ROOM_ENTRY_ID,
    entitlementIds: ENTITLEMENT_IDS.join(","),
    requestedCount: "2",
  }), {
    orderId: ORDER_ID,
    roomEntryId: ROOM_ENTRY_ID,
    entitlementIds: ENTITLEMENT_IDS,
  });
  assert.equal(parseKujiPaidDrawRoute({
    orderId: ORDER_ID,
    roomEntryId: ROOM_ENTRY_ID,
    entitlementIds: ENTITLEMENT_IDS.join(","),
    requestedCount: "1",
  }), null);
  assert.equal(parseKujiPaidDrawRoute({
    orderId: "not-an-order",
    roomEntryId: ROOM_ENTRY_ID,
    entitlementIds: ENTITLEMENT_IDS.join(","),
    requestedCount: "2",
  }), null);
});

test("binding validation keeps the checkout entitlements paired with the chosen server slots", () => {
  const result = {
    productId: "evangelion-kuji",
    roomEntryId: ROOM_ENTRY_ID,
    probabilityVersion: 2,
    bindings: [
      { entitlementId: ENTITLEMENT_IDS[0], slotNumber: 3, state: "RESERVED" },
      { entitlementId: ENTITLEMENT_IDS[1], slotNumber: 12, state: "RESERVED" },
    ],
  };
  assert.deepEqual(validateKujiSlotBinding(result, {
    productId: "evangelion-kuji",
    roomEntryId: ROOM_ENTRY_ID,
    probabilityVersion: 2,
    entitlementIds: ENTITLEMENT_IDS,
    slotNumbers: [12, 3],
  }), result.bindings);
  assert.throws(() => validateKujiSlotBinding({
    ...result,
    bindings: [{ ...result.bindings[0], entitlementId: ENTITLEMENT_IDS[1] }, result.bindings[1]],
  }, {
    productId: "evangelion-kuji",
    roomEntryId: ROOM_ENTRY_ID,
    probabilityVersion: 2,
    entitlementIds: ENTITLEMENT_IDS,
    slotNumbers: [3, 12],
  }), /일치하지 않습니다/);
  assert.equal(formatKujiSlotNumber(3, 50), "03");
  assert.equal(formatKujiSlotNumber(3, 120), "003");
});

test("draw-room countdown uses the absolute server deadline and survives a remount", () => {
  const clientNow = Date.parse("2026-09-05T03:00:00.000Z");
  const serverNow = Date.parse("2026-09-05T03:02:00.000Z");
  const deadline = new Date(serverNow + 300_000).toISOString();
  const first = createKujiDrawLeaseClock(
    deadline,
    new Date(serverNow).toISOString(),
    "DRAWING",
    clientNow,
  );
  const reloaded = createKujiDrawLeaseClock(
    deadline,
    new Date(serverNow + 90_000).toISOString(),
    "DRAWING",
    clientNow + 90_000,
  );
  assert.equal(kujiDrawLeaseRemainingSeconds(first, clientNow), 300);
  assert.equal(kujiDrawLeaseRemainingSeconds(first, clientNow + 90_000), 210);
  assert.equal(kujiDrawLeaseRemainingSeconds(reloaded, clientNow + 90_000), 210);
  assert.equal(formatKujiDrawLeaseRemainingTime(210), "03:30");

  const expired = createKujiDrawLeaseClock(
    deadline,
    new Date(serverNow + 301_000).toISOString(),
    "EXPIRED",
    clientNow + 301_000,
  );
  assert.equal(kujiDrawLeaseRemainingSeconds(expired, clientNow + 301_000), 0);
});

test("native kuji binds the live board before entering the real committed reveal", async () => {
  const [checkout, drawRoute, drawScreen, slotApi, roomApi, apiRoom, openapi] = await Promise.all([
    readFile(new URL("../apps/mobile/src/features/checkout/CheckoutScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../apps/mobile/app/kuji/draw/[productId].tsx", import.meta.url), "utf8"),
    readFile(new URL("../apps/mobile/src/features/kuji/KujiDrawScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../apps/mobile/src/features/kuji/kuji-slot-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../apps/mobile/src/features/kuji/kuji-room-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../apps/api/src/modules/kuji-rooms.ts", import.meta.url), "utf8"),
    readFile(new URL("../packages/contracts/openapi/dabboba.openapi.yaml", import.meta.url), "utf8"),
  ]);

  assert.match(checkout, /kujiEntryId,/);
  assert.match(checkout, /orderId: order\.id/);
  assert.match(checkout, /entitlementIds: entitlementIds\.join\(","\)/);
  assert.doesNotMatch(drawRoute, /Redirect|__DEV__/);
  assert.match(drawScreen, /fetchPaidKujiSelection/);
  assert.doesNotMatch(drawScreen, /fetchKujiSlotBoard|fetchKujiRoom|fetchProductDetail/);
  assert.match(drawScreen, /next\.recovery\.drawingExpiresAt/);
  assert.match(drawScreen, /bindPaidKujiSlots/);
  assert.match(drawScreen, /validateKujiSlotBinding/);
  assert.match(drawScreen, /slot\.available/);
  assert.match(drawScreen, /paidKujiRevealPath/);
  assert.doesNotMatch(drawScreen, /\/draw\/preview/);
  assert.match(slotApi, /GET\("\/v1\/catalog\/products\/\{productId\}\/kuji-slots"/);
  assert.match(slotApi, /GET\("\/v1\/orders\/\{orderId\}\/kuji-selection"/);
  assert.match(slotApi, /POST\("\/v1\/kuji\/rooms\/\{productId\}\/entries\/\{entryId\}\/slots"/);
  assert.match(slotApi, /kuji-slot-binding-\$\{orderId\}/);
  assert.match(roomApi, /drawingExpiresAt/);
  assert.match(apiRoom, /\["DRAWING", "EXPIRED"\]\.includes\(viewerRow\.state\)/);
  assert.match(openapi, /required: \[entryId, state, position, peopleAhead, checkoutExpiresAt, drawingExpiresAt\]/);
});
