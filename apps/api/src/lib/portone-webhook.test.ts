import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  PortOneWebhookError,
  verifyPortOnePaymentWebhook,
} from "./portone-webhook.js";

const secretBytes = Buffer.from("synthetic-portone-webhook-secret");
const webhookSecret = `whsec_${secretBytes.toString("base64")}`;
const storeId = "store-test";
const paymentId = "6f1d8a52-3b7e-4c1a-9f0e-2d4b5c6a7e81";

function signedWebhook(
  body: Record<string, unknown>,
  options: { eventId?: string; signedAt?: number } = {},
) {
  const rawBody = JSON.stringify(body);
  const eventId = options.eventId ?? "event-test";
  const signedAt = String(options.signedAt ?? Math.floor(Date.now() / 1_000));
  const signature = createHmac("sha256", secretBytes)
    .update(`${eventId}.${signedAt}.${rawBody}`)
    .digest("base64");
  return {
    rawBody,
    headers: {
      "webhook-id": eventId,
      "webhook-timestamp": signedAt,
      "webhook-signature": `v1,${signature}`,
    },
  };
}

function transaction(type = "Transaction.Paid", changes: Record<string, unknown> = {}) {
  return {
    type,
    timestamp: "2026-09-09T00:00:00.000Z",
    data: {
      paymentId,
      storeId,
      transactionId: "portone-transaction-test",
      customer: { email: "must-not-escape@example.com" },
      ...changes,
    },
  };
}

function webhookError(code: PortOneWebhookError["code"]) {
  return (error: unknown) => error instanceof PortOneWebhookError && error.code === code;
}

test("official SDK verification yields only a fresh-lookup trigger", async () => {
  const request = signedWebhook(transaction());
  const trigger = await verifyPortOnePaymentWebhook({
    webhookSecret,
    expectedStoreId: storeId,
    ...request,
  });

  assert.deepEqual(trigger, {
    requiresFreshPaymentLookup: true,
    eventId: "event-test",
    notificationType: "Transaction.Paid",
    occurredAt: "2026-09-09T00:00:00.000Z",
    paymentId,
    storeId: "store-test",
    portOneTransactionId: "portone-transaction-test",
    cancellationId: null,
  });
  assert.equal(JSON.stringify(trigger).includes("must-not-escape"), false);
  assert.equal("paymentStatus" in trigger, false);
});

test("cancel-pending remains a lookup trigger rather than a successful refund", async () => {
  const request = signedWebhook(transaction("Transaction.CancelPending", {
    cancellationId: "cancellation-test",
  }));
  const trigger = await verifyPortOnePaymentWebhook({
    webhookSecret,
    expectedStoreId: storeId,
    ...request,
  });

  assert.equal(trigger.notificationType, "Transaction.CancelPending");
  assert.equal(trigger.cancellationId, "cancellation-test");
  assert.equal(trigger.requiresFreshPaymentLookup, true);
  assert.equal("outcome" in trigger, false);
});

test("tampering, stale signatures, duplicate headers, and store mismatches fail closed", async () => {
  const valid = signedWebhook(transaction());
  await assert.rejects(
    verifyPortOnePaymentWebhook({
      webhookSecret,
      expectedStoreId: storeId,
      headers: valid.headers,
      rawBody: `${valid.rawBody} `,
    }),
    webhookError("INVALID_WEBHOOK"),
  );

  const stale = signedWebhook(transaction(), { signedAt: Math.floor(Date.now() / 1_000) - 301 });
  await assert.rejects(
    verifyPortOnePaymentWebhook({ webhookSecret, expectedStoreId: storeId, ...stale }),
    webhookError("INVALID_WEBHOOK"),
  );

  const malformedTimestamp = signedWebhook(transaction());
  await assert.rejects(
    verifyPortOnePaymentWebhook({
      webhookSecret,
      expectedStoreId: storeId,
      rawBody: malformedTimestamp.rawBody,
      headers: {
        ...malformedTimestamp.headers,
        "webhook-timestamp": `${malformedTimestamp.headers["webhook-timestamp"]}suffix`,
      },
    }),
    webhookError("INVALID_WEBHOOK"),
  );

  await assert.rejects(
    verifyPortOnePaymentWebhook({
      webhookSecret,
      expectedStoreId: storeId,
      rawBody: valid.rawBody,
      headers: {
        ...valid.headers,
        "Webhook-Id": "duplicate-event-id",
      },
    }),
    webhookError("INVALID_WEBHOOK"),
  );

  const otherStore = signedWebhook(transaction("Transaction.Failed", { storeId: "another-store" }));
  await assert.rejects(
    verifyPortOnePaymentWebhook({ webhookSecret, expectedStoreId: storeId, ...otherStore }),
    webhookError("WEBHOOK_CONTRACT_MISMATCH"),
  );

  // A foreign (non-DABBOBA) payment ID on the same store is a contract
  // mismatch, never a uuid database error.
  for (const foreignPaymentId of ["payment-test", "order-123", `${paymentId}x`]) {
    const foreign = signedWebhook(transaction("Transaction.Paid", { paymentId: foreignPaymentId }));
    await assert.rejects(
      verifyPortOnePaymentWebhook({ webhookSecret, expectedStoreId: storeId, ...foreign }),
      webhookError("WEBHOOK_CONTRACT_MISMATCH"),
    );
  }
});

test("billing-key and oversized payloads cannot trigger payment lookup", async () => {
  const billingKey = signedWebhook({
    type: "BillingKey.Issued",
    timestamp: "2026-09-09T00:00:00.000Z",
    data: { storeId, billingKey: "billing-key-test" },
  });
  await assert.rejects(
    verifyPortOnePaymentWebhook({ webhookSecret, expectedStoreId: storeId, ...billingKey }),
    webhookError("UNSUPPORTED_WEBHOOK"),
  );

  const unknownTransaction = signedWebhook(transaction("Transaction.FutureStatus"));
  await assert.rejects(
    verifyPortOnePaymentWebhook({
      webhookSecret,
      expectedStoreId: storeId,
      ...unknownTransaction,
    }),
    webhookError("UNSUPPORTED_WEBHOOK"),
  );

  const valid = signedWebhook(transaction());
  await assert.rejects(
    verifyPortOnePaymentWebhook({
      webhookSecret,
      expectedStoreId: storeId,
      headers: valid.headers,
      rawBody: "x".repeat(65_537),
    }),
    webhookError("WEBHOOK_TOO_LARGE"),
  );
});
