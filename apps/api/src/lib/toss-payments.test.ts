import assert from "node:assert/strict";
import test from "node:test";
import { createTossPaymentsAdapter, verifiedTossPayment } from "./toss-payments.js";
const orderId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const payment = { paymentKey: "test_payment_key_123", orderId, mId: "test_mid", currency: "KRW", type: "NORMAL", method: "카드",
  status: "DONE", totalAmount: 7000, balanceAmount: 7000, approvedAt: "2026-10-13T10:00:00+09:00",
  requestedAt: "2026-10-13T09:59:00+09:00", lastTransactionKey: "transaction_123" };
test("Toss verifies order, amount, currency, MID and settlement before dropping private fields", () => {
  const expected = { orderId, amount: 7000, merchantId: "test_mid" };
  assert.equal(verifiedTossPayment({ ...payment, card: { number: "must-not-retain" } }, expected).status, "DONE");
  assert.doesNotMatch(JSON.stringify(verifiedTossPayment(payment, expected)), /card/);
  for (const override of [{ orderId: "another" }, { totalAmount: 1 }, { mId: "foreign" }, { currency: "USD" },
    { status: "DONE", approvedAt: null }, { balanceAmount: 6000 }, { method: "가상계좌" }]) {
    assert.throws(() => verifiedTossPayment({ ...payment, ...override }, expected));
  }
});
test("Toss calls its own API with Basic auth and a stable confirmation idempotency key", async () => {
  const adapter = createTossPaymentsAdapter({ secretKey: "test_sk_synthetic_value_12345", merchantId: "test_mid",
    fetch: async (url, init) => {
      assert.equal(String(url), "https://api.tosspayments.com/v1/payments/confirm");
      assert.equal(init?.redirect, "manual");
      assert.equal(new Headers(init?.headers).get("authorization"), `Basic ${Buffer.from("test_sk_synthetic_value_12345:").toString("base64")}`);
      assert.equal(new Headers(init?.headers).get("Idempotency-Key"), `confirm:${orderId}`);
      assert.deepEqual(JSON.parse(String(init?.body)), { orderId, paymentKey: payment.paymentKey, amount: 7000 });
      return Response.json(payment);
    } });
  assert.equal((await adapter.confirm(orderId, payment.paymentKey, 7000)).status, "DONE");
});
test("Toss rejects LIVE keys, redirects, wrong responses and unknown network outcomes", async () => {
  assert.throws(() => createTossPaymentsAdapter({ secretKey: "live_sk_not_allowed", merchantId: "test_mid" }));
  for (const response of [new Response(null, { status: 302 }), Response.json({ ...payment, mId: "foreign" })]) {
    const adapter = createTossPaymentsAdapter({ secretKey: "test_sk_synthetic_value_12345", merchantId: "test_mid", fetch: async () => response });
    await assert.rejects(adapter.lookup(orderId, 7000));
  }
});
test("Toss cancellation observations require a real cancellation timestamp, not the approval timestamp", () => {
  const raw = { ...payment, status: "CANCELED", balanceAmount: 0 };
  const expected = { orderId, amount: 7000, merchantId: "test_mid" };
  assert.throws(() => verifiedTossPayment(raw, expected));
  assert.equal(verifiedTossPayment({ ...raw, cancels: [{ canceledAt: "2026-10-13T11:00:00+09:00" }] }, expected).cancelledAt,
    "2026-10-13T11:00:00+09:00");
});
test("Toss keeps network failure unknown and never substitutes a payment-not-found response", async () => {
  const adapter = createTossPaymentsAdapter({ secretKey: "test_sk_synthetic_value_12345", merchantId: "test_mid",
    fetch: async () => { throw new Error("synthetic network failure"); } });
  await assert.rejects(adapter.lookup(orderId, 7000), (error: unknown) =>
    error instanceof Error && "code" in error && error.code === "TOSS_UPSTREAM_UNAVAILABLE");
});
