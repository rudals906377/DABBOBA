import assert from "node:assert/strict";
import test from "node:test";
import type { PortOneCardPayment } from "../lib/portone-v2.js";
import { normalizedPortOneEventForPayment } from "./portone-payments.js";

function payment(
  status: PortOneCardPayment["status"],
  amount: PortOneCardPayment["amount"] = { total: 12_000, paid: 12_000, cancelled: 0 },
): PortOneCardPayment {
  return {
    paymentId: "550e8400-e29b-41d4-a716-446655440000",
    portOneTransactionId: "txn-portone",
    pgTransactionId: "txn-inicis",
    status,
    version: "V2",
    merchantId: "merchant",
    storeId: "store",
    channel: { key: "channel", environment: "TEST", pgProvider: "INICIS_V2" },
    method: "CARD",
    amount,
    currency: "KRW",
    requestedAt: "2026-09-20T00:00:00.000Z",
    statusChangedAt: "2026-09-20T00:00:02.000Z",
    paidAt: status === "PAID" ? "2026-09-20T00:00:02.000Z" : null,
    failedAt: status === "FAILED" ? "2026-09-20T00:00:02.000Z" : null,
    cancelledAt: status.includes("CANCELLED") ? "2026-09-20T00:00:02.000Z" : null,
    cancellations: [],
  };
}

test("PortOne pending states do not mutate the local order", () => {
  assert.equal(normalizedPortOneEventForPayment(payment("READY")), null);
  assert.equal(normalizedPortOneEventForPayment(payment("PAY_PENDING")), null);
  assert.equal(normalizedPortOneEventForPayment(payment("VIRTUAL_ACCOUNT_ISSUED")), null);
});

test("PortOne paid, failed, and pre-payment cancelled states map to canonical events", () => {
  assert.equal(normalizedPortOneEventForPayment(payment("PAID"))?.eventType, "PAYMENT_SUCCEEDED");
  assert.equal(normalizedPortOneEventForPayment(payment("FAILED"))?.eventType, "PAYMENT_FAILED");
  assert.equal(
    normalizedPortOneEventForPayment(payment("CANCELLED", { total: 12_000, paid: 0, cancelled: 0 }))?.eventType,
    "PAYMENT_CANCELLED",
  );
});

test("full cancellation maps to refund while partial cancellation forces amount review", () => {
  const full = normalizedPortOneEventForPayment(
    payment("CANCELLED", { total: 12_000, paid: 12_000, cancelled: 12_000 }),
  );
  assert.equal(full?.eventType, "REFUND_SUCCEEDED");
  assert.equal(full?.amount, 12_000);

  const partial = normalizedPortOneEventForPayment(
    payment("PARTIAL_CANCELLED", { total: 12_000, paid: 12_000, cancelled: 3_000 }),
  );
  assert.equal(partial?.eventType, "REFUND_SUCCEEDED");
  assert.equal(partial?.amount, 9_000);
});

test("normalized event id is deterministic for the same provider state", () => {
  const first = normalizedPortOneEventForPayment(payment("PAID"));
  const second = normalizedPortOneEventForPayment(payment("PAID"));
  assert.equal(first?.eventId, second?.eventId);
  assert.equal(first?.providerPaymentId, "txn-inicis");
});
