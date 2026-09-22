import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEMO,
  assertDemoCapabilities,
  assertFixedDemoProduct,
  assertLoopbackApiBaseUrl,
  assertSafeRequestTarget,
  parseCliArgs,
  runDemoCommerce,
  safeSummary,
} from "../scripts/verify-demo-commerce.mjs";

test("the persistent demo exercise requires an explicit run flag before fetch", async () => {
  let calls = 0;
  await assert.rejects(
    runDemoCommerce({
      argv: [],
      fetchImpl: async () => {
        calls += 1;
        throw new Error("must not be called");
      },
      stdout: { write() {} },
    }),
    (error) => error?.code === "RUN_FLAG_REQUIRED",
  );
  assert.equal(calls, 0);
});

test("only an explicit loopback API on port 8788 is accepted", () => {
  assert.deepEqual(parseCliArgs(["--run"]), { baseUrl: DEMO.baseUrl });
  assert.equal(assertLoopbackApiBaseUrl("http://localhost:8788"), "http://localhost:8788");
  assert.equal(assertLoopbackApiBaseUrl("http://[::1]:8788"), "http://[::1]:8788");
  for (const unsafe of [
    "https://127.0.0.1:8788",
    "http://127.0.0.1:8789",
    "http://example.test:8788",
    "http://user:secret@127.0.0.1:8788",
    "http://127.0.0.1:8788/v1",
  ]) {
    assert.throws(() => assertLoopbackApiBaseUrl(unsafe), (error) => error?.code === "UNSAFE_BASE_URL");
  }
});

test("capability mismatch stops before sessions or commerce mutations", async () => {
  const calls = [];
  await assert.rejects(
    runDemoCommerce({
      argv: ["--run"],
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), method: init.method, bounded: init.signal instanceof AbortSignal });
        return new Response(JSON.stringify({ ...DEMO.capabilities, paymentProvider: "PORTONE_V2" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      stdout: { write() {} },
    }),
    (error) => error?.code === "CAPABILITY_MISMATCH",
  );
  assert.deepEqual(calls, [{ url: `${DEMO.baseUrl}/v1/demo/capabilities`, method: "GET", bounded: true }]);
});

test("the exact capability contract and only fixed sellable demo products pass", () => {
  assert.equal(assertDemoCapabilities({
    enabled: true,
    profile: "supabase-demo",
    paymentProvider: "TEST_PG",
    actions: ["approve", "fail", "cancel", "refund"],
  }).enabled, true);
  assert.throws(
    () => assertDemoCapabilities({ ...DEMO.capabilities, extra: true }),
    (error) => error?.code === "INVALID_RESPONSE",
  );

  const product = {
    ...DEMO.gacha,
    ipId: "demo-test-ip",
    isActive: true,
    isPrizeOnly: false,
    metadata: { dabbobaFixture: "supabase-demo-v1" },
    availableQuantity: 20,
  };
  assert.equal(assertFixedDemoProduct(product, DEMO.gacha).id, DEMO.gacha.id);
  assert.throws(
    () => assertFixedDemoProduct({ ...product, id: "arbitrary-product" }, DEMO.gacha),
    (error) => error?.code === "FIXTURE_MISMATCH",
  );
});

test("request safety rejects destructive, admin, webhook, and arbitrary routes", () => {
  assert.equal(assertSafeRequestTarget("POST", "/v1/orders"), "/v1/orders");
  assert.equal(assertSafeRequestTarget("GET", "/v1/account/inventory?limit=100"), "/v1/account/inventory");
  assert.equal(
    assertSafeRequestTarget("GET", "/v1/orders/00000000-0000-4000-8000-000000000000/draw-completion"),
    "/v1/orders/00000000-0000-4000-8000-000000000000/draw-completion",
  );
  for (const [method, path] of [
    ["DELETE", "/v1/orders/00000000-0000-4000-8000-000000000000"],
    ["PATCH", "/v1/account/profile"],
    ["POST", "/v1/admin/commerce/orders"],
    ["POST", "/v1/payments/webhooks/TEST_PG"],
    ["POST", "/v1/catalog/requests"],
    ["POST", "/v1/exchange/listings/00000000-0000-4000-8000-000000000000/completion-confirmation"],
    ["GET", "https://example.test/v1/demo/capabilities"],
  ]) {
    assert.throws(() => assertSafeRequestTarget(method, path), (error) => error?.code === "UNSAFE_REQUEST");
  }
});

test("safe output cannot include session tokens, addresses, or secrets", () => {
  const output = safeSummary({
    requestCount: 4,
    scenarios: ["bounded-test"],
    token: "secret-token-value",
    address: "real-address-value",
  });
  assert.deepEqual(JSON.parse(output), {
    verifier: "demo-commerce",
    fixture: "supabase-demo-v1",
    profile: "supabase-demo",
    paymentProvider: "TEST_PG",
    requestCount: 4,
    scenarios: ["bounded-test"],
    persistent: true,
    realMoney: false,
    externalWorkersRun: false,
  });
  assert.doesNotMatch(output, /secret-token-value|real-address-value/);
  assert.throws(
    () => parseCliArgs(["--secret-token-value"]),
    (error) => error?.code === "USAGE" && !error.message.includes("secret-token-value"),
  );
});

test("the standalone verifier has no environment-secret, destructive SQL, or destructive HTTP path", async () => {
  const source = await readFile(new URL("../scripts/verify-demo-commerce.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /process\.env|\bTRUNCATE\b|\bDROP\b/);
  assert.doesNotMatch(source, /\["DELETE"|\["PATCH"|\["PUT"/);
});
