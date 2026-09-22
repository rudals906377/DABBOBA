import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("kuji checkout posts one room-bound order with the immutable draw contract", async () => {
  const api = await readFile(
    new URL("../apps/mobile/src/features/checkout/checkout-api.ts", import.meta.url),
    "utf8",
  );

  assert.match(api, /client\.POST\("\/v1\/orders"/);
  assert.match(api, /"Idempotency-Key": kujiCheckoutOrderIdempotencyKey\(input\.kujiRoomEntryId\)/);
  assert.match(api, /items: \[\{[\s\S]*?productId: input\.productId,[\s\S]*?quantity: input\.quantity,[\s\S]*?expectedDrawVersion: input\.expectedDrawVersion,[\s\S]*?\}\]/);
  assert.match(api, /pointAmount: input\.pointAmount/);
  assert.match(api, /kujiRoomEntryId: input\.kujiRoomEntryId/);
  assert.match(api, /return `kuji-order-\$\{kujiRoomEntryId\}`/);
});

test("checkout only accepts a fully paid order with the expected unique entitlements", async () => {
  const [api, screen] = await Promise.all([
    readFile(new URL("../apps/mobile/src/features/checkout/checkout-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../apps/mobile/src/features/checkout/CheckoutScreen.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(api, /order\.status !== "PAID" && order\.status !== "FULFILLED"/);
  assert.match(api, /entitlementIds\.length !== expectedQuantity/);
  assert.match(api, /new Set\(entitlementIds\)\.size !== entitlementIds\.length/);
  assert.match(screen, /const entitlementIds = paidKujiOrderEntitlementIds\(order, quantity\)/);
  assert.match(screen, /if \(!entitlementIds\)/);
  assert.match(screen, /order\.status === "PENDING_PAYMENT"/);
  assert.match(screen, /checkoutCompletedRef\.current = true;[\s\S]*?router\.replace/);
  assert.match(screen, /kujiRoomFixture === "development"[\s\S]*?실제 대기실 연결이 필요해요/);
  assert.doesNotMatch(screen, /product\.category === "kuji"[\s\S]{0,900}?\/draw\/preview/);
});
