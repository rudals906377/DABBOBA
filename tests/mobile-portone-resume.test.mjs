import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PaymentResumeIdentityMismatchError,
  reconcileOwnedPaymentOnResume,
} from "../apps/mobile/src/features/checkout/payment-resume.ts";

const original = {
  id: "order-1", paymentId: "payment-1", userId: "user-1", status: "PENDING_PAYMENT",
};

test("native payment errors trigger the same server requery as completion", () => {
  const source = readFileSync(new URL(
    "../apps/mobile/src/features/checkout/PortOnePaymentScreen.tsx", import.meta.url,
  ), "utf8");
  const errorCallback = source.split("onError={")[1]?.split("style={styles.payment}")[0] ?? "";
  assert.match(errorCallback, /confirmPayment\(order\)/);
  assert.doesNotMatch(errorCallback, /setMessage\(error\.message/);
});

test("app resume re-queries PortOne only while the owned order is still pending", async () => {
  const calls = [];
  const order = await reconcileOwnedPaymentOnResume(
    original,
    async () => {
      calls.push("read");
      return { ...original, status: calls.length === 1 ? "PENDING_PAYMENT" : "PAID" };
    },
    async (paymentId) => {
      calls.push(`confirm:${paymentId}`);
      return { orderId: original.id, paymentId: original.paymentId };
    },
  );
  assert.equal(order.status, "PAID");
  assert.deepEqual(calls, ["read", "confirm:payment-1", "read"]);
});

test("already settled orders never make a second provider request", async () => {
  let providerCalls = 0;
  const settled = { ...original, status: "PAID" };
  const result = await reconcileOwnedPaymentOnResume(original, async () => settled, async () => {
    providerCalls += 1;
    throw new Error("provider must not be called");
  });
  assert.deepEqual(result, settled);
  assert.equal(providerCalls, 0);
});

test("provider still pending leaves the order pending and never invents draw access", async () => {
  let reads = 0;
  const result = await reconcileOwnedPaymentOnResume(original, async () => {
    reads += 1;
    return original;
  }, async () => ({ orderId: original.id, paymentId: original.paymentId }));
  assert.equal(result.status, "PENDING_PAYMENT");
  assert.equal(reads, 2);
});

test("foreign or inconsistent orders and payment confirmations fail closed", async () => {
  for (const changed of [
    { ...original, id: "other-order" },
    { ...original, paymentId: "other-payment" },
    { ...original, userId: "other-user" },
  ]) {
    let providerCalls = 0;
    await assert.rejects(
      reconcileOwnedPaymentOnResume(original, async () => changed, async () => {
        providerCalls += 1;
        return { orderId: original.id, paymentId: original.paymentId };
      }),
      PaymentResumeIdentityMismatchError,
    );
    assert.equal(providerCalls, 0);
  }
  await assert.rejects(
    reconcileOwnedPaymentOnResume(original, async () => original, async () => ({
      orderId: "other-order", paymentId: original.paymentId,
    })),
    PaymentResumeIdentityMismatchError,
  );
  let reads = 0;
  await assert.rejects(
    reconcileOwnedPaymentOnResume(original, async () => {
      reads += 1;
      return reads === 1 ? original : { ...original, userId: "other-user", status: "PAID" };
    }, async () => ({ orderId: original.id, paymentId: original.paymentId })),
    PaymentResumeIdentityMismatchError,
  );
});

test("provider outage propagates without treating the payment as failed", async () => {
  await assert.rejects(
    reconcileOwnedPaymentOnResume(original, async () => original, async () => {
      throw new Error("provider unavailable");
    }),
    /provider unavailable/,
  );
});
