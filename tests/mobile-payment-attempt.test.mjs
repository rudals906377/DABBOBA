import assert from "node:assert/strict";
import test from "node:test";
import {
  PaymentAttemptMismatchError,
  paymentAttemptState,
  preparePaymentAttempt,
  hasStartedPaymentAttempt,
  markPaymentAttemptStarted,
  clearPaymentAttempt,
} from "../apps/mobile/src/features/checkout/payment-attempt.ts";

const order = {
  id: "order-1", paymentId: "payment-1", userId: "user-1", status: "PENDING_PAYMENT",
};

function memoryStorage() {
  const values = new Map();
  return {
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => { values.set(key, value); },
    deleteItemAsync: async (key) => { values.delete(key); },
    values,
  };
}

test("a payment attempt survives a screen remount and is scoped to its order", async () => {
  const storage = memoryStorage();
  assert.equal(await hasStartedPaymentAttempt(storage, order), false);
  await markPaymentAttemptStarted(storage, order);
  assert.equal(await hasStartedPaymentAttempt(storage, { ...order }), true);
  assert.equal(await hasStartedPaymentAttempt(storage, { ...order, id: "order-2" }), false);
  await clearPaymentAttempt(storage, order);
  assert.equal(await hasStartedPaymentAttempt(storage, order), false);
});

test("a prepared but unclaimed attempt can resume only after the server still reports no window claim", async () => {
  const storage = memoryStorage();
  assert.equal(await paymentAttemptState(storage, order), "none");
  await preparePaymentAttempt(storage, order);
  assert.equal(await paymentAttemptState(storage, order), "preparing");
  assert.equal(await hasStartedPaymentAttempt(storage, order), false);
  await markPaymentAttemptStarted(storage, order);
  assert.equal(await paymentAttemptState(storage, order), "started");
  assert.equal(await hasStartedPaymentAttempt(storage, order), true);
});

test("legacy v1 markers remain started rather than opening a second PG window", async () => {
  const storage = memoryStorage();
  await storage.setItemAsync(`dabboba.payment-attempt.v1.${order.id}`, JSON.stringify({
    version: 1, orderId: order.id, paymentId: order.paymentId, userId: order.userId,
  }));
  assert.equal(await paymentAttemptState(storage, order), "started");
});

test("a marker for a different payment or customer fails closed", async () => {
  const storage = memoryStorage();
  await markPaymentAttemptStarted(storage, order);
  await assert.rejects(
    hasStartedPaymentAttempt(storage, { ...order, paymentId: "payment-2" }),
    PaymentAttemptMismatchError,
  );
  await assert.rejects(
    hasStartedPaymentAttempt(storage, { ...order, userId: "user-2" }),
    PaymentAttemptMismatchError,
  );
});

test("corrupt or inaccessible attempt storage never means a fresh safe payment", async () => {
  const storage = memoryStorage();
  await markPaymentAttemptStarted(storage, order);
  const [key] = storage.values.keys();
  storage.values.set(key, "not-json");
  await assert.rejects(hasStartedPaymentAttempt(storage, order), PaymentAttemptMismatchError);
  await assert.rejects(
    hasStartedPaymentAttempt({ ...storage, getItemAsync: async () => { throw new Error("storage unavailable"); } }, order),
    /storage unavailable/,
  );
  await assert.rejects(
    markPaymentAttemptStarted({ ...memoryStorage(), setItemAsync: async () => { throw new Error("write failed"); } }, order),
    /write failed/,
  );
});
