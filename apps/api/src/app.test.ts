import assert from "node:assert/strict";
import test from "node:test";
import type { ApiConfig, ApiSurface } from "@dabboba/config";
import type { DatabasePool } from "@dabboba/db";
import { buildApp } from "./app.js";

function testConfig(surface: ApiSurface): ApiConfig {
  return {
    environment: "test",
    surface,
    host: "127.0.0.1",
    port: 8788,
    databaseUrl: "postgresql://unused",
    redisUrl: null,
    webOrigins: ["http://127.0.0.1:4174"],
    adminOrigins: ["http://127.0.0.1:4180"],
    sessionTokenPepper: "app-surface-test-pepper",
    adminProxyIdentitySecret: null,
    supabaseUrl: null,
    supabaseJwtAudience: null,
    sessionTtlDays: 30,
    paymentProvider: "UNCONFIGURED",
    paymentWebhookSecret: null,
    gcsBucket: null,
    gcsProjectId: null,
    logLevel: "silent",
  };
}

const unusedPool = {
  query: async () => ({ rows: [], rowCount: 0 }),
} as unknown as DatabasePool;

test("API surface registration keeps customer and admin routes out of each other's process", async () => {
  for (const surface of ["customer", "admin", "all"] as const) {
    const { app, context } = await buildApp({ config: testConfig(surface), pool: unusedPool });
    try {
      assert.equal(context.redis, null);
      assert.equal(app.hasRoute({ method: "GET", url: "/healthz" }), true);
      assert.equal(
        app.hasRoute({ method: "GET", url: "/v1/catalog/products" }),
        surface !== "admin",
      );
      assert.equal(
        app.hasRoute({ method: "GET", url: "/v1/catalog/home-sections" }),
        surface !== "admin",
      );
      assert.equal(
        app.hasRoute({ method: "GET", url: "/v1/catalog/category-settings" }),
        surface !== "admin",
      );
      assert.equal(
        app.hasRoute({ method: "GET", url: "/v1/catalog/products/:productId/kuji-slots" }),
        surface !== "admin",
      );
      assert.equal(
        app.hasRoute({ method: "GET", url: "/v1/admin/home-sections" }),
        surface !== "customer",
      );
      assert.equal(
        app.hasRoute({ method: "GET", url: "/v1/admin/category-settings" }),
        surface !== "customer",
      );
      assert.equal(
        app.hasRoute({ method: "GET", url: "/v1/admin/dashboard" }),
        surface !== "customer",
      );
      assert.equal(
        app.hasRoute({ method: "POST", url: "/v1/admin/auth/login" }),
        surface !== "customer",
      );
    } finally {
      await app.close();
    }
  }
});

test("production admin surface keeps notice and moderation routes when public community is disabled", async () => {
  const config = { ...testConfig("admin"), environment: "production" as const, communityEnabled: false };
  const { app } = await buildApp({ config, pool: unusedPool });
  try {
    for (const path of ["/v1/admin/notices", "/v1/admin/posts", "/v1/admin/comments", "/v1/admin/reports"]) {
      assert.equal(app.hasRoute({ method: "GET", url: path }), true, path);
    }
    assert.equal(app.hasRoute({ method: "GET", url: "/v1/notices" }), false);
    assert.equal(app.hasRoute({ method: "GET", url: "/v1/posts" }), false);
  } finally {
    await app.close();
  }
});

test("Cloud Run health endpoints are not consumed by the global request limiter", async () => {
  const { app } = await buildApp({ config: testConfig("customer"), pool: unusedPool });
  try {
    for (let request = 0; request < 250; request += 1) {
      const [liveness, readiness] = await Promise.all([
        app.inject({ method: "GET", url: "/healthz" }),
        app.inject({ method: "GET", url: "/readyz" }),
      ]);
      assert.equal(liveness.statusCode, 200);
      assert.equal(readiness.statusCode, 200);
    }
  } finally {
    await app.close();
  }
});

test("malformed JSON is rejected as a client request error", async () => {
  const { app } = await buildApp({ config: testConfig("all"), pool: unusedPool });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/auth/login",
      headers: { "content-type": "application/json" },
      payload: "{\"email\":",
    });
    assert.equal(response.statusCode, 400, response.body);
    assert.deepEqual(response.json().error, {
      code: "INVALID_REQUEST",
      message: "요청 값을 확인해 주세요.",
      requestId: response.json().error.requestId,
    });
  } finally {
    await app.close();
  }
});

test("untrusted error status codes are bounded and client errors stay generic", async () => {
  const { app } = await buildApp({ config: testConfig("all"), pool: unusedPool });
  app.get("/test-only/out-of-range-error", async () => {
    throw Object.assign(new Error("must-not-reach-the-response"), { statusCode: 799 });
  });
  app.get("/test-only/client-error", async () => {
    throw Object.assign(new Error("must-not-reach-the-response"), { statusCode: 422 });
  });
  try {
    const outOfRange = await app.inject({ method: "GET", url: "/test-only/out-of-range-error" });
    assert.equal(outOfRange.statusCode, 500, outOfRange.body);
    assert.equal(outOfRange.json().error.code, "INTERNAL_ERROR");
    assert.doesNotMatch(outOfRange.body, /must-not-reach-the-response/);

    const clientError = await app.inject({ method: "GET", url: "/test-only/client-error" });
    assert.equal(clientError.statusCode, 422, clientError.body);
    assert.equal(clientError.json().error.code, "INVALID_REQUEST");
    assert.doesNotMatch(clientError.body, /must-not-reach-the-response/);
  } finally {
    await app.close();
  }
});

test("PRELAUNCH rejects every customer commerce mutation before its handler can write", async () => {
  const observed: string[] = [];
  const pool = {
    async query(sql: string) {
      observed.push(sql);
      if (sql.includes("WITH active_session AS MATERIALIZED")) {
        return {
          rowCount: 1,
          rows: [{
            session_id: "10000000-0000-4000-8000-000000000001",
            session_kind: "USER",
            user_id: "20000000-0000-4000-8000-000000000001",
            email: "customer@example.test",
            nickname: "고객",
            role: "USER",
            status: "ACTIVE",
            suspended_until: null,
          }],
        };
      }
      if (sql.includes("FROM account_deletion_requests")) return { rowCount: 0, rows: [] };
      throw new Error(`commerce handler reached the database in PRELAUNCH: ${sql}`);
    },
  } as unknown as DatabasePool;
  const config = { ...testConfig("customer"), commerceMode: "PRELAUNCH" as const };
  const { app } = await buildApp({ config, pool, redis: null });
  const authorization = { authorization: `Bearer ${"x".repeat(40)}` };
  const guardedRequests = [
    { method: "POST", url: "/v1/orders" },
    { method: "POST", url: "/v1/payments/30000000-0000-4000-8000-000000000001/confirm" },
    { method: "POST", url: "/v1/payments/webhooks/provider" },
    { method: "POST", url: "/v1/payments/webhooks/portone" },
    { method: "POST", url: "/v1/draws/40000000-0000-4000-8000-000000000001/consume" },
    { method: "POST", url: "/v1/kuji/rooms/coming-soon-kuji/entries" },
    { method: "GET", url: "/v1/kuji/rooms/coming-soon-kuji/entries/50000000-0000-4000-8000-000000000001" },
    { method: "DELETE", url: "/v1/kuji/rooms/coming-soon-kuji/entries/50000000-0000-4000-8000-000000000001" },
    { method: "POST", url: "/v1/kuji/rooms/coming-soon-kuji/entries/50000000-0000-4000-8000-000000000001/slots" },
    { method: "POST", url: "/v1/account/point-returns" },
    { method: "POST", url: "/v1/account/shipping-quotes" },
    { method: "POST", url: "/v1/account/shipping-requests" },
    { method: "GET", url: "/v1/exchange/inventory" },
    { method: "GET", url: "/v1/exchange/listings" },
    { method: "GET", url: "/v1/exchange/activity" },
    { method: "GET", url: "/v1/exchange/listings/60000000-0000-4000-8000-000000000001" },
    { method: "POST", url: "/v1/exchange/listings" },
    { method: "POST", url: "/v1/exchange/listings/60000000-0000-4000-8000-000000000001/offers" },
    { method: "POST", url: "/v1/exchange/listings/60000000-0000-4000-8000-000000000001/offers/70000000-0000-4000-8000-000000000001/decision" },
    { method: "POST", url: "/v1/exchange/listings/60000000-0000-4000-8000-000000000001/cancel" },
    { method: "POST", url: "/v1/exchange/listings/60000000-0000-4000-8000-000000000001/offers/70000000-0000-4000-8000-000000000001/withdraw" },
    { method: "POST", url: "/v1/exchange/listings/60000000-0000-4000-8000-000000000001/completion-confirmation" },
  ] as const;
  try {
    for (const request of guardedRequests) {
      const response = await app.inject({ ...request, headers: authorization });
      assert.equal(response.statusCode, 503, `${request.method} ${request.url}: ${response.body}`);
      assert.equal(response.json().error.code, "COMMERCE_NOT_AVAILABLE");
    }
    const commerceHandlerQueries = observed.filter((sql) => (
      !sql.includes("WITH active_session AS MATERIALIZED")
      && !sql.includes("FROM account_deletion_requests")
    ));
    assert.deepEqual(commerceHandlerQueries, []);
  } finally {
    await app.close();
  }
});
