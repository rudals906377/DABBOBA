import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  paidKujiRoomEntryFromRecovery,
  paidProductDrawFromOrder,
} from "../apps/mobile/src/features/checkout/paid-order-draw-continuation.ts";

const actorId = "10000000-0000-4000-8000-000000000001";
const orderId = "20000000-0000-4000-8000-000000000001";
const paymentId = "30000000-0000-4000-8000-000000000001";
const entitlementIds = [1, 2].map((number) => `40000000-0000-4000-8000-${String(number).padStart(12, "0")}`);
const order = (category = "gacha", overrides = {}) => ({
  id: orderId,
  userId: actorId,
  orderKind: "PRODUCT",
  shippingRequestId: null,
  status: "PAID",
  paymentId,
  lines: [{ productId: "paid-product", category, quantity: 2 }],
  drawEntitlementIds: entitlementIds,
  ...overrides,
});
const recovery = (overrides = {}) => ({
  orderId,
  userId: actorId,
  productId: "paid-product",
  roomEntryId: "50000000-0000-4000-8000-000000000001",
  roomState: "DRAWING",
  entitlementIds,
  bindings: [],
  ...overrides,
});

test("cold-start payment return derives gacha product and draw count from the paid server order", () => {
  assert.deepEqual(paidProductDrawFromOrder(order(), orderId), {
    category: "gacha",
    productId: "paid-product",
    quantity: 2,
    entitlementIds,
  });
});

test("pending, refunded, unrelated and malformed orders never enter the draw", () => {
  for (const status of ["PENDING_PAYMENT", "CANCELLED", "REFUND_REVIEW", "REFUNDED"]) {
    assert.throws(() => paidProductDrawFromOrder(order("gacha", { status }), orderId), /추첨권/);
  }
  assert.throws(() => paidProductDrawFromOrder(order(), "another-order"), /추첨권/);
  assert.throws(() => paidProductDrawFromOrder(order("gacha", { orderKind: "SHIPPING_FEE" }), orderId), /추첨권/);
  assert.throws(() => paidProductDrawFromOrder(order("figure"), orderId), /추첨권/);
  assert.throws(() => paidProductDrawFromOrder(order("gacha", { lines: [] }), orderId), /추첨권/);
  assert.throws(() => paidProductDrawFromOrder(order("gacha", { drawEntitlementIds: [entitlementIds[0]] }), orderId), /추첨권/);
  assert.throws(() => paidProductDrawFromOrder(order("gacha", { drawEntitlementIds: [entitlementIds[0], entitlementIds[0]] }), orderId), /추첨권/);
});

test("kuji room is taken from owned recovery, not redirect parameters", () => {
  const paidOrder = order("kuji");
  const draw = paidProductDrawFromOrder(paidOrder, orderId);
  assert.equal(paidKujiRoomEntryFromRecovery(recovery(), paidOrder, draw), recovery().roomEntryId);
  assert.throws(() => paidKujiRoomEntryFromRecovery(recovery({ orderId: "other" }), paidOrder, draw), /쿠지 방/);
  assert.throws(() => paidKujiRoomEntryFromRecovery(recovery({ userId: "other" }), paidOrder, draw), /쿠지 방/);
  assert.throws(() => paidKujiRoomEntryFromRecovery(recovery({ productId: "other" }), paidOrder, draw), /쿠지 방/);
  assert.throws(() => paidKujiRoomEntryFromRecovery(recovery({ roomState: "COMPLETED" }), paidOrder, draw), /쿠지 방/);
  assert.throws(() => paidKujiRoomEntryFromRecovery(recovery({ entitlementIds: entitlementIds.slice(1) }), paidOrder, draw), /쿠지 방/);
  assert.throws(() => paidKujiRoomEntryFromRecovery(recovery({ bindings: [{ entitlementId: entitlementIds[0], slotNumber: 1 }] }), paidOrder, draw), /쿠지 방/);
});

test("payment return does not remount the PG before checking the redirect and never trusts route product fields", async () => {
  const screen = await readFile(new URL("../apps/mobile/src/features/checkout/PortOnePaymentScreen.tsx", import.meta.url), "utf8");
  assert.match(screen, /if \(redirectPaymentId\) \{\s*await confirmPayment\(nextOrder\);\s*return;/);
  assert.match(screen, /confirmation\.orderId !== paymentOrder\.id \|\| confirmation\.paymentId !== paymentOrder\.paymentId/);
  assert.match(screen, /paidProductDrawFromOrder\(paidOrder, orderId\)/);
  assert.match(screen, /fetchPaidKujiDrawRecovery\(runtime\.apiBaseUrl, currentToken, paidOrder\.id\)/);
  assert.doesNotMatch(screen, /requestedCategory|requestedQuantity|const productId = firstParam\(params\.productId\)/);
});

test("app resume leaves an active PortOne checkout mounted while it reads the server order", async () => {
  const screen = await readFile(new URL("../apps/mobile/src/features/checkout/PortOnePaymentScreen.tsx", import.meta.url), "utf8");
  const appStateEffect = screen.match(/AppState\.addEventListener\("change", \(state\) => \{([\s\S]*?)\}\);/);
  assert.ok(appStateEffect, "AppState resume handler must exist");
  assert.match(appStateEffect[1], /phase === "paying"[\s\S]*refreshOrderOnResume\(order\)/);
  assert.doesNotMatch(appStateEffect[1], /if \(phase === "paying"\)\s*void confirmPayment\(order\)/);
});
