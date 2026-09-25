import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerCustomerAuthRoutes } from "./customer-auth.js";
import type { ApiContext } from "../types.js";

test("the token exchange rejects a login provider absent from public discovery", async () => {
  const app = Fastify({ logger: false });
  let verifiedAccessToken = false;
  const context = {
    config: {
      supabaseUrl: "https://project.supabase.co",
      supabasePublishableKey: "sb_publishable_customer_auth_fixture",
      customerLoginProviders: ["KAKAO"],
    },
    pool: {
      query: async () => ({ rows: [
        { policy_key: "PRIVACY", policy_version: "2026-09-22", content_sha256: "a".repeat(64) },
        { policy_key: "TERMS", policy_version: "2026-09-22", content_sha256: "b".repeat(64) },
      ] }),
    },
  } as unknown as ApiContext;
  await registerCustomerAuthRoutes(app, context, {
    verifyAccessToken: async () => {
      verifiedAccessToken = true;
      throw new Error("disabled login must stop before token verification");
    },
  });
  await app.ready();
  try {
    const discovery = await app.inject({ method: "GET", url: "/v1/auth/providers" });
    assert.equal(discovery.statusCode, 200);
    assert.deepEqual(discovery.json().methods, ["KAKAO"]);

    const exchange = await app.inject({
      method: "POST",
      url: "/v1/auth/exchange",
      payload: {
        accessToken: "x".repeat(80),
        loginProvider: "PHONE",
        acceptedPolicies: { terms: "2026-09-22", privacy: "2026-09-22" },
      },
    });
    assert.equal(exchange.statusCode, 503);
    assert.equal(verifiedAccessToken, false);
  } finally {
    await app.close();
  }
});

test("phone exchange refuses a provider claim without a live verified phone", async () => {
  const app = Fastify({ logger: false });
  const context = {
    config: {
      supabaseUrl: "https://project.supabase.co",
      supabasePublishableKey: "sb_publishable_customer_auth_fixture",
      customerLoginProviders: ["PHONE"],
    },
    pool: {
      query: async () => ({ rows: [
        { policy_key: "PRIVACY", policy_version: "2026-09-22", content_sha256: "a".repeat(64) },
        { policy_key: "TERMS", policy_version: "2026-09-22", content_sha256: "b".repeat(64) },
      ] }),
    },
  } as unknown as ApiContext;
  await registerCustomerAuthRoutes(app, context, {
    verifyAccessToken: async () => ({
      issuer: "https://project.supabase.co/auth/v1",
      subject: "customer",
      canonicalSubject: "https://project.supabase.co/auth/v1#customer",
      providers: ["PHONE"],
      email: null,
      phone: null,
    }),
  });
  await app.ready();
  try {
    const exchange = await app.inject({
      method: "POST",
      url: "/v1/auth/exchange",
      payload: {
        accessToken: "x".repeat(80),
        loginProvider: "PHONE",
        acceptedPolicies: { terms: "2026-09-22", privacy: "2026-09-22" },
      },
    });
    assert.equal(exchange.statusCode, 403);
  } finally {
    await app.close();
  }
});
