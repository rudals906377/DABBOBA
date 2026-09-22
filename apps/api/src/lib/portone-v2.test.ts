import assert from "node:assert/strict";
import test from "node:test";
import {
  createPortOneV2Adapter,
  PortOneV2Error,
  type PortOneFetch,
} from "./portone-v2.js";

const contract = {
  apiSecret: "synthetic-portone-secret",
  merchantId: "merchant-test",
  storeId: "store-test",
  channelKey: "channel-key-test",
  channelEnvironment: "TEST" as const,
};

function payment(overrides: Record<string, unknown> = {}) {
  return {
    status: "PAID",
    id: "payment-test",
    transactionId: "portone-transaction-test",
    pgTxId: "kg-pg-transaction-test",
    merchantId: contract.merchantId,
    storeId: contract.storeId,
    version: "V2",
    channel: {
      key: contract.channelKey,
      type: contract.channelEnvironment,
      pgProvider: "INICIS_V2",
      pgMerchantId: "kg-merchant-test",
    },
    method: {
      type: "PaymentMethodCard",
      card: { number: "411111******1111" },
      approvalNumber: "sensitive-approval-number",
    },
    amount: {
      total: 12_000,
      paid: 12_000,
      cancelled: 0,
      taxFree: 0,
      discount: 0,
      cancelledTaxFree: 0,
    },
    currency: "KRW",
    requestedAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:02.000Z",
    statusChangedAt: "2026-09-09T00:00:02.000Z",
    paidAt: "2026-09-09T00:00:02.000Z",
    customer: { email: "must-not-escape@example.com" },
    pgResponse: "must-not-escape",
    receiptUrl: "https://example.invalid/must-not-escape",
    customData: "must-not-escape",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorCode(code: PortOneV2Error["code"], indeterminate = false) {
  return (error: unknown) => error instanceof PortOneV2Error
    && error.code === code
    && error.indeterminate === indeterminate;
}

test("payment lookup uses the fixed PortOne endpoint and returns only ledger-safe card fields", async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl: PortOneFetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return jsonResponse(payment());
  };
  const adapter = createPortOneV2Adapter({ ...contract, fetchImpl });

  const result = await adapter.getPayment({ paymentId: "payment-test", expectedTotalAmount: 12_000 });

  assert.deepEqual(result, {
    paymentId: "payment-test",
    portOneTransactionId: "portone-transaction-test",
    pgTransactionId: "kg-pg-transaction-test",
    status: "PAID",
    version: "V2",
    merchantId: "merchant-test",
    storeId: "store-test",
    channel: {
      key: "channel-key-test",
      environment: "TEST",
      pgProvider: "INICIS_V2",
    },
    method: "CARD",
    amount: { total: 12_000, paid: 12_000, cancelled: 0 },
    currency: "KRW",
    requestedAt: "2026-09-09T00:00:00.000Z",
    statusChangedAt: "2026-09-09T00:00:02.000Z",
    paidAt: "2026-09-09T00:00:02.000Z",
    failedAt: null,
    cancelledAt: null,
    cancellations: [],
  });
  assert.equal(JSON.stringify(result).includes("must-not-escape"), false);
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0]!.url,
    "https://api.portone.io/payments/payment-test?storeId=store-test",
  );
  assert.equal(requests[0]!.init?.method, "GET");
  assert.equal(requests[0]!.init?.redirect, "error");
  assert.ok(requests[0]!.init?.signal instanceof AbortSignal);
  assert.equal(new Headers(requests[0]!.init?.headers).get("authorization"), "PortOne synthetic-portone-secret");
});

test("payment lookup fails closed on identity, environment, provider, method, currency, or amount mismatch", async () => {
  const mismatches: unknown[] = [
    payment({ id: "another-payment" }),
    payment({ version: "V1" }),
    payment({ merchantId: "another-merchant" }),
    payment({ storeId: "another-store" }),
    payment({ channel: { ...payment().channel, key: "another-channel" } }),
    payment({ channel: { ...payment().channel, type: "LIVE" } }),
    payment({ channel: { ...payment().channel, pgProvider: "HTML5_INICIS" } }),
    payment({ method: { type: "PaymentMethodEasyPay" } }),
    payment({ currency: "USD" }),
    payment({ amount: { ...payment().amount, total: 12_001 } }),
  ];

  for (const response of mismatches) {
    const adapter = createPortOneV2Adapter({ ...contract, fetchImpl: async () => jsonResponse(response) });
    await assert.rejects(
      adapter.getPayment({ paymentId: "payment-test", expectedTotalAmount: 12_000 }),
      errorCode("PAYMENT_CONTRACT_MISMATCH"),
    );
  }
});

test("payment lookup aborts the request and rejects oversized streamed responses", async () => {
  let observedAbort = false;
  const hangingFetch: PortOneFetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      observedAbort = true;
      reject(new DOMException("aborted", "AbortError"));
    }, { once: true });
  });
  const timed = createPortOneV2Adapter({ ...contract, fetchImpl: hangingFetch, timeoutMs: 5 });
  await assert.rejects(
    timed.getPayment({ paymentId: "payment-test", expectedTotalAmount: 12_000 }),
    errorCode("UPSTREAM_UNAVAILABLE"),
  );
  assert.equal(observedAbort, true);

  const oversized = createPortOneV2Adapter({
    ...contract,
    maxResponseBytes: 1_024,
    fetchImpl: async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(700));
        controller.enqueue(new Uint8Array(700));
        controller.close();
      },
    })),
  });
  await assert.rejects(
    oversized.getPayment({ paymentId: "payment-test", expectedTotalAmount: 12_000 }),
    errorCode("UNEXPECTED_RESPONSE"),
  );

  let declaredBodyCancelled = false;
  const declaredOversized = createPortOneV2Adapter({
    ...contract,
    maxResponseBytes: 1_024,
    fetchImpl: async () => new Response(new ReadableStream<Uint8Array>({
      cancel() {
        declaredBodyCancelled = true;
      },
    }), { headers: { "content-length": "2048" } }),
  });
  await assert.rejects(
    declaredOversized.getPayment({ paymentId: "payment-test", expectedTotalAmount: 12_000 }),
    errorCode("UNEXPECTED_RESPONSE"),
  );
  assert.equal(declaredBodyCancelled, true);
});

test("payment lookup normalizes provider errors without exposing upstream messages", async () => {
  const adapter = createPortOneV2Adapter({
    ...contract,
    fetchImpl: async () => jsonResponse({
      type: "PAYMENT_NOT_FOUND",
      message: "must-not-escape",
    }, 404),
  });

  await assert.rejects(
    adapter.getPayment({ paymentId: "payment-test", expectedTotalAmount: 12_000 }),
    (error: unknown) => error instanceof PortOneV2Error
      && error.code === "UPSTREAM_REJECTED"
      && error.httpStatus === 404
      && error.providerErrorType === "PAYMENT_NOT_FOUND"
      && !error.message.includes("must-not-escape"),
  );
});

test("full and partial cancellations send the expected balance guard exactly once", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const responses = [
    {
      cancellation: {
        status: "REQUESTED",
        id: "cancel-pending",
        totalAmount: 12_000,
        taxFreeAmount: 0,
        vatAmount: 1_091,
        reason: "customer request",
        requestedAt: "2026-09-09T00:01:00.000Z",
      },
    },
    {
      cancellation: {
        status: "SUCCEEDED",
        id: "cancel-succeeded",
        pgCancellationId: "kg-cancel-test",
        totalAmount: 4_000,
        taxFreeAmount: 0,
        vatAmount: 364,
        reason: "admin request",
        requestedAt: "2026-09-09T00:02:00.000Z",
        cancelledAt: "2026-09-09T00:02:01.000Z",
        receiptUrl: "https://example.invalid/must-not-escape",
      },
    },
  ];
  const fetchImpl: PortOneFetch = async (input, init) => {
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return jsonResponse(responses.shift());
  };
  const adapter = createPortOneV2Adapter({ ...contract, fetchImpl });

  const full = await adapter.cancelPayment({
    paymentId: "payment-test",
    currentCancellableAmount: 12_000,
    reason: "customer request",
    requester: "CUSTOMER",
  });
  const partial = await adapter.cancelPayment({
    paymentId: "payment-test",
    amount: 4_000,
    currentCancellableAmount: 12_000,
    reason: "admin request",
    requester: "ADMIN",
  });

  assert.equal(full.outcome, "PENDING");
  assert.equal(partial.outcome, "SUCCEEDED");
  assert.equal(JSON.stringify(partial).includes("must-not-escape"), false);
  assert.deepEqual(requests, [
    {
      url: "https://api.portone.io/payments/payment-test/cancel",
      body: {
        storeId: "store-test",
        currentCancellableAmount: 12_000,
        reason: "customer request",
        requester: "CUSTOMER",
      },
    },
    {
      url: "https://api.portone.io/payments/payment-test/cancel",
      body: {
        storeId: "store-test",
        amount: 4_000,
        currentCancellableAmount: 12_000,
        reason: "admin request",
        requester: "ADMIN",
      },
    },
  ]);
});

test("cancel uses one authenticated POST with a bounded, delayed response stream", async () => {
  let capturedInit: RequestInit | undefined;
  const adapter = createPortOneV2Adapter({
    ...contract,
    timeoutMs: 100,
    fetchImpl: async (_input, init) => {
      capturedInit = init;
      const body = JSON.stringify({
        cancellation: {
          status: "FAILED",
          id: "cancel-failed",
          totalAmount: 12_000,
          taxFreeAmount: 0,
          vatAmount: 1_091,
          reason: "provider rejection",
          requestedAt: "2026-09-09T00:03:00.000Z",
        },
      });
      const encoded = new TextEncoder().encode(body);
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoded.subarray(0, 20));
          setTimeout(() => {
            controller.enqueue(encoded.subarray(20));
            controller.close();
          }, 5);
        },
      }), { headers: { "content-type": "application/json" } });
    },
  });

  const result = await adapter.cancelPayment({
    paymentId: "payment-test",
    currentCancellableAmount: 12_000,
    reason: "provider rejection",
    requester: "ADMIN",
  });

  assert.equal(result.outcome, "FAILED");
  assert.equal(capturedInit?.method, "POST");
  assert.equal(capturedInit?.redirect, "error");
  assert.ok(capturedInit?.signal instanceof AbortSignal);
  const headers = new Headers(capturedInit?.headers);
  assert.equal(headers.get("authorization"), "PortOne synthetic-portone-secret");
  assert.equal(headers.get("content-type"), "application/json");
});

test("timeout after headers cancels a stalled response body", async () => {
  let bodyCancelled = false;
  const adapter = createPortOneV2Adapter({
    ...contract,
    timeoutMs: 5,
    fetchImpl: async () => new Response(new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => undefined);
      },
      cancel() {
        bodyCancelled = true;
      },
    })),
  });

  await assert.rejects(
    adapter.getPayment({ paymentId: "payment-test", expectedTotalAmount: 12_000 }),
    errorCode("UPSTREAM_UNAVAILABLE"),
  );
  assert.equal(bodyCancelled, true);
});

test("valid JSON without stream EOF still times out for lookup and cancellation", async () => {
  let cancelledBodies = 0;
  const stalledResponse = (body: unknown) => {
    const encoded = new TextEncoder().encode(JSON.stringify(body));
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded);
      },
      pull() {
        return new Promise<void>(() => undefined);
      },
      cancel() {
        cancelledBodies += 1;
      },
    }));
  };
  const lookup = createPortOneV2Adapter({
    ...contract,
    timeoutMs: 5,
    fetchImpl: async () => stalledResponse(payment()),
  });
  await assert.rejects(
    lookup.getPayment({ paymentId: "payment-test", expectedTotalAmount: 12_000 }),
    errorCode("UPSTREAM_UNAVAILABLE"),
  );

  const cancellation = createPortOneV2Adapter({
    ...contract,
    timeoutMs: 5,
    fetchImpl: async () => stalledResponse({
      cancellation: {
        status: "SUCCEEDED",
        id: "cancel-must-not-complete",
        totalAmount: 12_000,
        requestedAt: "2026-09-09T00:05:00.000Z",
        cancelledAt: "2026-09-09T00:05:01.000Z",
      },
    }),
  });
  await assert.rejects(
    cancellation.cancelPayment({
      paymentId: "payment-test",
      currentCancellableAmount: 12_000,
      reason: "stream did not finish",
      requester: "ADMIN",
    }),
    errorCode("CANCELLATION_INDETERMINATE", true),
  );
  assert.equal(cancelledBodies, 2);
});

test("cancel never retries and treats timeout, non-2xx, and unknown success bodies as indeterminate", async () => {
  const scenarios: PortOneFetch[] = [
    async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true },
      );
    }),
    async () => jsonResponse({ type: "INTERNAL" }, 503),
    async () => jsonResponse({ type: "INVALID_REQUEST" }, 400),
    async () => jsonResponse({ cancellation: { status: "UNKNOWN" } }),
    async () => jsonResponse({
      cancellation: {
        status: "SUCCEEDED",
        id: "cancel-wrong-amount",
        totalAmount: 11_999,
        requestedAt: "2026-09-09T00:04:00.000Z",
        cancelledAt: "2026-09-09T00:04:01.000Z",
      },
    }),
  ];

  for (const fetchScenario of scenarios) {
    let calls = 0;
    const adapter = createPortOneV2Adapter({
      ...contract,
      timeoutMs: 5,
      fetchImpl: async (input, init) => {
        calls += 1;
        return fetchScenario(input, init);
      },
    });
    await assert.rejects(
      adapter.cancelPayment({
        paymentId: "payment-test",
        currentCancellableAmount: 12_000,
        reason: "safe reconciliation required",
        requester: "ADMIN",
      }),
      errorCode("CANCELLATION_INDETERMINATE", true),
    );
    assert.equal(calls, 1);
  }
});

test("cancel validates the expected balance before sending", async () => {
  let calls = 0;
  const adapter = createPortOneV2Adapter({
    ...contract,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({});
    },
  });
  await assert.rejects(
    adapter.cancelPayment({
      paymentId: "payment-test",
      amount: 12_001,
      currentCancellableAmount: 12_000,
      reason: "invalid partial cancellation",
      requester: "ADMIN",
    }),
    errorCode("INVALID_REQUEST"),
  );
  await assert.rejects(
    adapter.cancelPayment({
      paymentId: "..",
      currentCancellableAmount: 12_000,
      reason: "path traversal must not be normalized",
      requester: "ADMIN",
    }),
    errorCode("INVALID_REQUEST"),
  );
  await assert.rejects(
    adapter.getPayment({ paymentId: ".", expectedTotalAmount: 12_000 }),
    errorCode("INVALID_REQUEST"),
  );
  assert.equal(calls, 0);
});
