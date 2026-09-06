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
        app.hasRoute({ method: "GET", url: "/v1/catalog/products/:productId/kuji-slots" }),
        surface !== "admin",
      );
      assert.equal(
        app.hasRoute({ method: "GET", url: "/v1/admin/home-sections" }),
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
