import assert from "node:assert/strict";
import test from "node:test";
import {
  KujiPaymentLeaseExpiredError,
  KujiPaymentLeaseMismatchError,
  assertKujiPaymentLease,
} from "../apps/mobile/src/features/checkout/kuji-payment-lease.ts";

const productId = "kuji-product";
const entryId = "entry-1";
const order = {
  id: "order-1",
  status: "PENDING_PAYMENT",
  kujiRoomEntryId: entryId,
  lines: [{ category: "kuji", productId }],
};
const room = {
  productId,
  serverNow: "2026-09-26T00:00:00.000Z",
  viewer: {
    entryId,
    state: "CHECKOUT_PENDING",
    checkoutExpiresAt: "2026-09-26T00:03:00.000Z",
  },
};

test("a server-owned matching kuji room permits a fresh payment only before its original deadline", () => {
  assert.doesNotThrow(() => assertKujiPaymentLease(order, room));
  assert.throws(
    () => assertKujiPaymentLease(order, { ...room, serverNow: "2026-09-26T00:03:00.000Z" }),
    KujiPaymentLeaseExpiredError,
  );
});

test("the server snapshot cannot extend an expired lease", () => {
  assert.throws(
    () => assertKujiPaymentLease(order, { ...room, serverNow: "2026-09-26T00:03:01.000Z" }),
    KujiPaymentLeaseExpiredError,
  );
});

test("an ahead device clock cannot expire a fresh server-owned checkout lease", (t) => {
  t.mock.method(Date, "now", () => Date.parse("2026-09-26T02:00:00.000Z"));
  assert.doesNotThrow(() => assertKujiPaymentLease(order, room));
});

test("foreign, missing, or retargeted room identity fails closed", () => {
  for (const changed of [
    { ...order, kujiRoomEntryId: null },
    { ...order, kujiRoomEntryId: "entry-2" },
    { ...order, lines: [{ category: "kuji", productId: "other-product" }] },
  ]) {
    assert.throws(() => assertKujiPaymentLease(changed, room), KujiPaymentLeaseMismatchError);
  }
  assert.throws(() => assertKujiPaymentLease(order, { ...room, productId: "other-product" }), KujiPaymentLeaseMismatchError);
});

test("cancelled, drawing, malformed and already expired room states cannot open a new PG window", () => {
  for (const changed of [
    { ...room, viewer: { ...room.viewer, state: "EXPIRED" } },
    { ...room, viewer: { ...room.viewer, state: "DRAWING" } },
    { ...room, viewer: { ...room.viewer, checkoutExpiresAt: null } },
    { ...room, viewer: { ...room.viewer, checkoutExpiresAt: "invalid" } },
    { ...room, serverNow: "invalid" },
  ]) {
    assert.throws(() => assertKujiPaymentLease(order, changed), KujiPaymentLeaseExpiredError);
  }
});
