import assert from "node:assert/strict";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import {
  INTERNAL_CUSTOMER_ACCOUNT,
  DEMO_FIXTURE_TAG,
  DEMO_GACHA_PRODUCT_ID,
  DEMO_CATALOG_KUJI_PRODUCT_IDS,
  DEMO_PROFILE,
  assertDemoActor,
  assertDemoLoopbackRequest,
  assertDemoOrderProducts,
  demoPaymentEventId,
  demoRuntimeFromEnvironment,
} from "./demo-testing.js";

function config(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return {
    environment: "test",
    environmentTier: "TEST",
    host: "127.0.0.1",
    port: 8788,
    databaseUrl: "postgresql://dabboba_runtime:fixture@127.0.0.1:55441/dabboba_edge_test",
    redisUrl: "redis://127.0.0.1:56380",
    webOrigins: ["http://127.0.0.1:4174"],
    adminOrigins: ["http://127.0.0.1:4180"],
    sessionTokenPepper: "demo-testing-session-pepper-at-least-32-bytes",
    adminProxyIdentitySecret: null,
    sessionTtlDays: 1,
    paymentProvider: "TEST_PG",
    paymentWebhookSecret: "demo-testing-webhook-secret-at-least-32-bytes",
    gcsBucket: null,
    gcsProjectId: null,
    logLevel: "silent",
    ...overrides,
  };
}

const env = {
  DABBOBA_BACKEND_PROFILE: DEMO_PROFILE,
  DABBOBA_ENABLE_DEMO_TESTING: "true",
  DABBOBA_DEMO_FIXTURE_TAG: DEMO_FIXTURE_TAG,
};

test("demo runtime accepts only the approved remote staging role or a loopback TEST database", () => {
  assert.deepEqual(demoRuntimeFromEnvironment(env, config()), { enabled: true });
  assert.deepEqual(demoRuntimeFromEnvironment(env, config({
    environment: "production",
    environmentTier: "STAGING",
    databaseUrl: "postgresql://dabboba_runtime.yxkmvgfruphgghowzvmo:fixture@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres",
  })), { enabled: true });
  for (const invalid of [
    config({ environment: "production", environmentTier: "PRODUCTION" }),
    config({ environment: "production", environmentTier: "STAGING", databaseUrl: "postgresql://dabboba_runtime.otherprojectref123:fixture@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres" }),
    config({ databaseUrl: "postgresql://dabboba_runtime:fixture@127.0.0.1:55441/dabboba_edge_test?sslmode=disable" }),
    config({ databaseUrl: "postgresql://dabboba_runtime@127.0.0.1:55441/dabboba_edge_test" }),
  ]) assert.throws(() => demoRuntimeFromEnvironment(env, invalid));
  assert.deepEqual(demoRuntimeFromEnvironment({}, config()), { enabled: false });
});

test("demo requests require direct loopback access without forwarded identity headers", () => {
  const request = { ip: "127.0.0.1", headers: {} };
  assert.doesNotThrow(() => assertDemoLoopbackRequest(request as never, { enabled: true }));
  assert.throws(() => assertDemoLoopbackRequest({ ...request, ip: "10.0.0.5" } as never, { enabled: true }));
  assert.throws(() => assertDemoLoopbackRequest({ ...request, headers: { "x-forwarded-for": "127.0.0.1" } } as never, { enabled: true }));
  assert.throws(() => assertDemoLoopbackRequest(request as never, { enabled: false }));
});

test("demo actor and order guards admit only the fixed customer and seller products", () => {
  assert.doesNotThrow(() => assertDemoActor({ userId: INTERNAL_CUSTOMER_ACCOUNT.id, email: INTERNAL_CUSTOMER_ACCOUNT.email }));
  assert.throws(() => assertDemoActor({ userId: INTERNAL_CUSTOMER_ACCOUNT.id, email: "other@dabboba.local" }));
  assert.throws(() => assertDemoActor({ userId: "da000000-0000-4000-8000-00000000000b", email: "demo-b@dabboba.test" }));
  assert.doesNotThrow(() => assertDemoOrderProducts([DEMO_GACHA_PRODUCT_ID]));
  assert.doesNotThrow(() => assertDemoOrderProducts([DEMO_CATALOG_KUJI_PRODUCT_IDS[0]!]));
  assert.throws(() => assertDemoOrderProducts([]));
  assert.throws(() => assertDemoOrderProducts(["original-product"]));
});

test("payment event identity is stable per actor and idempotency key", () => {
  const first = demoPaymentEventId(INTERNAL_CUSTOMER_ACCOUNT.id, "demo-transition-key-0001");
  assert.equal(first, demoPaymentEventId(INTERNAL_CUSTOMER_ACCOUNT.id, "demo-transition-key-0001"));
  assert.notEqual(first, demoPaymentEventId(INTERNAL_CUSTOMER_ACCOUNT.id, "demo-transition-key-0002"));
  assert.notEqual(first, demoPaymentEventId("da000000-0000-4000-8000-00000000000b", "demo-transition-key-0001"));
});
