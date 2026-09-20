import assert from "node:assert/strict";
import test from "node:test";
import {
  INICIS_INQUIRY_MAX_RESPONSE_BYTES,
  InicisInquiryError,
  InicisInquiryPaymentProvider,
  type InicisInquiryFetch,
} from "./inicis-inquiry.js";
import type { PaymentRecord } from "./payments.js";

const inquiryConfig = {
  environment: "TEST" as const,
  mid: "INIpayTest",
  iniApiKey: "fixture-inicis-api-key",
  clientIp: "127.0.0.1",
};
const fixedNow = new Date("2026-09-09T03:00:00.000Z");
const tid = "StdpayCARD202609091234567890";

function payment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: "payment-fixture",
    orderId: "order-fixture",
    provider: "KG_INICIS",
    providerPaymentId: tid,
    status: "PENDING",
    amount: 12_300,
    currency: "KRW",
    updatedAt: "2026-09-08T00:00:00.000Z",
    ...overrides,
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json;charset=utf-8" },
  });
}

test("KG INICIS V1 inquiry posts the fixed KST, form, hash, and exact TID without OID", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const provider = new InicisInquiryPaymentProvider(inquiryConfig, {
    now: () => fixedNow,
    async fetch(input, init) {
      requestUrl = String(input);
      requestInit = init;
      return jsonResponse({ resultCode: "00", tid, price: "12300", status: "0" });
    },
  });

  const result = await provider.observe(payment());

  assert.deepEqual(result, { state: "PAID", observedAt: fixedNow.toISOString() });
  assert.equal("providerEventId" in result, false);
  assert.equal(requestUrl, "https://stginiapi.inicis.com/api/v1/extra");
  assert.equal(requestInit?.method, "POST");
  assert.equal(requestInit?.redirect, "error");
  assert.equal(requestInit?.headers && new Headers(requestInit.headers).get("content-type"),
    "application/x-www-form-urlencoded;charset=utf-8");
  const form = new URLSearchParams(String(requestInit?.body));
  assert.deepEqual(Object.fromEntries(form), {
    type: "Extra",
    paymethod: "Inquiry",
    timestamp: "20260909120000",
    clientIp: "127.0.0.1",
    mid: "INIpayTest",
    originalTid: tid,
    hashData: "a485509f6dcb9fa5aa27159e5823470472423b7306b3de41fb8b36fd77b6ee05ddbb5387cc9d8fea65b409b25cc098db91c907d77c3f52fa0e2ea639cf61c0cc",
  });
  assert.equal(form.has("oid"), false);
});

test("KG INICIS inquiry maps only documented read-only states", async () => {
  const cases = [
    ["0", "PAID"],
    ["Y", "PAID"],
    ["N", "PENDING"],
    ["1", "CANCELLED"],
    ["C", "CANCELLED"],
    ["future-status", "UNKNOWN"],
  ] as const;
  for (const [status, expected] of cases) {
    let requests = 0;
    const provider = new InicisInquiryPaymentProvider(inquiryConfig, {
      now: () => fixedNow,
      async fetch() {
        requests += 1;
        return jsonResponse({ resultCode: "00", tid, price: 12_300, status });
      },
    });
    const result = await provider.observe(payment());
    assert.equal(result.state, expected);
    assert.equal(requests, 1);
    assert.equal("providerEventId" in result, false);
  }

  const absent = new InicisInquiryPaymentProvider(inquiryConfig, {
    now: () => fixedNow,
    fetch: async () => jsonResponse({ resultCode: "00", status: "9", tid: null, price: null }),
  });
  assert.deepEqual(await absent.observe(payment()), {
    state: "UNKNOWN",
    observedAt: fixedNow.toISOString(),
  });
});

test("non-canonical or TID-less payments remain unknown without provider contact", async () => {
  let requests = 0;
  const provider = new InicisInquiryPaymentProvider(inquiryConfig, {
    now: () => fixedNow,
    async fetch() {
      requests += 1;
      throw new Error("unexpected provider contact");
    },
  });
  const cases = [
    payment({ provider: "OTHER" }),
    payment({ currency: "USD" }),
    payment({ amount: 12.5 }),
    payment({ providerPaymentId: null }),
  ];
  for (const candidate of cases) {
    assert.equal((await provider.observe(candidate)).state, "UNKNOWN");
  }
  assert.equal(requests, 0);
});

test("failed result codes stay unknown while exact TID or amount mismatches fail safely", async () => {
  const failed = new InicisInquiryPaymentProvider(inquiryConfig, {
    now: () => fixedNow,
    fetch: async () => jsonResponse({ resultCode: "01", resultMsg: "untrusted" }),
  });
  assert.equal((await failed.observe(payment())).state, "UNKNOWN");

  for (const response of [
    { resultCode: "00", tid: "DifferentTid", price: "12300", status: "0" },
    { resultCode: "00", tid, price: "12301", status: "0" },
  ]) {
    const provider = new InicisInquiryPaymentProvider(inquiryConfig, {
      now: () => fixedNow,
      fetch: async () => jsonResponse(response),
    });
    await assert.rejects(
      () => provider.observe(payment()),
      (error) => error instanceof InicisInquiryError
        && error.code === "PAYMENT_MISMATCH"
        && !error.message.includes(tid)
        && !error.message.includes(inquiryConfig.iniApiKey),
    );
  }
});

test("transport, malformed, oversized, and stalled responses fail with bounded safe errors", async () => {
  const rawFailure = "upstream included customer and credential material";
  const cases: Array<{ fetch: InicisInquiryFetch; timeoutMs?: number; code: InicisInquiryError["code"] }> = [
    { fetch: async () => { throw new Error(rawFailure); }, code: "REQUEST_FAILED" },
    { fetch: async () => jsonResponse({ error: rawFailure }, 502), code: "REQUEST_FAILED" },
    { fetch: async () => new Response("not-json", { headers: { "content-type": "application/json" } }), code: "INVALID_RESPONSE" },
    {
      fetch: async () => new Response("x".repeat(INICIS_INQUIRY_MAX_RESPONSE_BYTES + 1), {
        headers: { "content-type": "application/json" },
      }),
      code: "INVALID_RESPONSE",
    },
    {
      fetch: async () => await new Promise<Response>(() => undefined),
      timeoutMs: 5,
      code: "REQUEST_FAILED",
    },
  ];

  for (const candidate of cases) {
    const provider = new InicisInquiryPaymentProvider(inquiryConfig, {
      now: () => fixedNow,
      fetch: candidate.fetch,
      ...(candidate.timeoutMs ? { timeoutMs: candidate.timeoutMs } : {}),
    });
    await assert.rejects(
      () => provider.observe(payment()),
      (error) => error instanceof InicisInquiryError
        && error.code === candidate.code
        && !error.message.includes(rawFailure)
        && !error.message.includes(inquiryConfig.iniApiKey),
    );
  }
});

test("the same deadline aborts a response body that starts but never finishes", async () => {
  let requestSignal: AbortSignal | undefined;
  const provider = new InicisInquiryPaymentProvider(inquiryConfig, {
    now: () => fixedNow,
    timeoutMs: 5,
    async fetch(_input, init) {
      requestSignal = init?.signal ?? undefined;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("{"));
          requestSignal?.addEventListener("abort", () => {
            controller.error(new DOMException("aborted", "AbortError"));
          }, { once: true });
        },
      });
      return new Response(stream, { headers: { "content-type": "application/json" } });
    },
  });

  await assert.rejects(
    () => provider.observe(payment()),
    (error) => error instanceof InicisInquiryError && error.code === "REQUEST_FAILED",
  );
  assert.equal(requestSignal?.aborted, true);
});

test("KG INICIS inquiry configuration validates MID, secret syntax, IPv4, and LIVE endpoint", async () => {
  for (const invalid of [
    { ...inquiryConfig, mid: "short" },
    { ...inquiryConfig, iniApiKey: "line\nbreak" },
    { ...inquiryConfig, clientIp: "2001:db8::1" },
    { ...inquiryConfig, clientIp: "127.00.0.1" },
  ]) {
    assert.throws(() => new InicisInquiryPaymentProvider(invalid), /configuration is invalid/);
  }

  let url = "";
  const provider = new InicisInquiryPaymentProvider({ ...inquiryConfig, environment: "LIVE" }, {
    now: () => fixedNow,
    async fetch(input) {
      url = String(input);
      return jsonResponse({ resultCode: "00", tid, price: "12300", status: "9" });
    },
  });
  await provider.observe(payment());
  assert.equal(url, "https://iniapi.inicis.com/api/v1/extra");
});
