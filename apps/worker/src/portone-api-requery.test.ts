import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { PortOneApiReconciliationProvider } from "./portone-api-requery.js";

const payment = {
  id: "11111111-1111-4111-8111-111111111111",
  orderId: "22222222-2222-4222-8222-222222222222",
  provider: "PORTONE_V2_INICIS",
  providerPaymentId: null,
  status: "PENDING",
  amount: 10_000,
  currency: "KRW",
  updatedAt: "2026-09-20T00:00:00.000Z",
};

test("worker signs one bounded canonical API requery, not a payment mutation", async () => {
  const secret = "separate-worker-requery-secret-for-tests";
  const now = new Date("2026-09-26T08:00:00.000Z");
  const path = `/v1/internal/payments/${payment.id}/reconcile`;
  const provider = new PortOneApiReconciliationProvider({
    apiBaseUrl: "https://api.example.test/functions/v1/dabboba-api",
    secret,
  }, {
    now: () => now,
    async fetch(input, init) {
      assert.equal(String(input), `https://api.example.test/functions/v1/dabboba-api${path}`);
      assert.equal(init?.method, "POST");
      const headers = new Headers(init?.headers);
      const timestamp = String(Math.floor(now.getTime() / 1000));
      assert.equal(headers.get("x-dabboba-worker-timestamp"), timestamp);
      assert.equal(headers.get("x-dabboba-worker-signature"), `sha256=${createHmac("sha256", secret).update(`POST\n${path}\n${timestamp}`).digest("hex")}`);
      assert.equal(init?.body, undefined);
      return new Response(JSON.stringify({
        accepted: true, paymentId: payment.id, orderId: payment.orderId,
        providerStatus: "PAID", outcome: "processed", localStatus: "PAID",
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.deepEqual(await provider.observe(payment), {
    state: "PAID", observedAt: now.toISOString(), canonicalStatus: "PAID", providerStatus: "PAID",
  });
});

function providerReturning(body: Record<string, unknown>) {
  return new PortOneApiReconciliationProvider({
    apiBaseUrl: "https://api.example.test/functions/v1/dabboba-api",
    secret: "separate-worker-requery-secret-for-tests",
  }, {
    now: () => new Date("2026-09-26T08:00:00.000Z"),
    async fetch() {
      return new Response(JSON.stringify({
        accepted: true, paymentId: payment.id, orderId: payment.orderId, ...body,
      }), { status: 200 });
    },
  });
}

test("an authoritative PortOne not-found is a no-payment observation, never a mutation", async () => {
  assert.deepEqual(await providerReturning({
    providerStatus: null, outcome: "provider_not_found", localStatus: "PENDING",
  }).observe(payment), {
    state: "PENDING", observedAt: "2026-09-26T08:00:00.000Z", canonicalStatus: "PENDING",
    providerStatus: "PAYMENT_NOT_FOUND",
  });
  // A not-found outcome must not carry a provider status.
  await assert.rejects(providerReturning({
    providerStatus: "READY", outcome: "provider_not_found", localStatus: "PENDING",
  }).observe(payment), /invalid canonical response/i);
  // An already settled response keeps no provider status.
  assert.deepEqual(await providerReturning({
    providerStatus: null, outcome: "already_settled", localStatus: "PAID",
  }).observe(payment), {
    state: "UNKNOWN", observedAt: "2026-09-26T08:00:00.000Z", canonicalStatus: "PAID",
  });
});

test("worker rejects an API response for another order without accepting a result", async () => {
  const provider = new PortOneApiReconciliationProvider({
    apiBaseUrl: "https://api.example.test/functions/v1/dabboba-api",
    secret: "separate-worker-requery-secret-for-tests",
  }, { async fetch() {
    return new Response(JSON.stringify({
      accepted: true, paymentId: payment.id, orderId: "33333333-3333-4333-8333-333333333333",
      providerStatus: "PAID", outcome: "processed", localStatus: "PAID",
    }), { status: 200 });
  } });
  await assert.rejects(provider.observe(payment), /invalid canonical response/i);
});
