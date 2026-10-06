import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { ApiContext } from "../types.js";
import { registerCustomerAuthRoutes } from "./customer-auth.js";
import { registerErrorHandler } from "../lib/errors.js";
import { PAYMENT_REVIEW_CLIENT_IP_HEADERS, paymentReviewClientIpSignature, rateLimitKey } from "../lib/rate-limit-key.js";

const email = "review@example.invalid";
const subject = "00000000-0000-4000-8000-000000000001";
const issuer = "https://lyzcyrdiazorjaqlgblr.supabase.co/auth/v1";
const customer = { id: "00000000-0000-4000-8000-000000000002", email, nickname: "심사 회원", role: "USER", status: "ACTIVE", phone_e164: null };
const policies = { terms: "2026-09-30", privacy: "2026-09-30" };
const proxySecret = "synthetic-review-proxy-secret-with-32-bytes-or-more";

async function setup(production = false, wrongPassword = false) {
  const queries: string[] = [];
  const sessionInserts: unknown[][] = [];
  let requests = 0;
  const client = {
    release() {},
    async query(sql: string, params: unknown[] = []) {
      queries.push(sql);
      // Real transactions take time between login checks and session insert.
      if (sql.includes("INSERT INTO auth_identities")) await new Promise((resolve) => setTimeout(resolve, 5));
      if (sql.includes("INSERT INTO sessions")) sessionInserts.push(params);
      if (sql.includes("legal_document_versions")) return { rows: [
        { policy_key: "PRIVACY", policy_version: policies.privacy, content_sha256: "a".repeat(64) },
        { policy_key: "TERMS", policy_version: policies.terms, content_sha256: "b".repeat(64) },
      ], rowCount: 2 };
      if (sql.includes("INSERT INTO users") || sql.includes("SELECT id,email::text,nickname")) return { rows: [customer], rowCount: 1 };
      if (sql.includes("INSERT INTO auth_identities")) return { rows: [{ provider: "EMAIL" }], rowCount: 1 };
      if (sql.includes("INSERT INTO sessions")) return { rows: [{ id: "00000000-0000-4000-8000-000000000003" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };
  const context = {
    config: {
      environmentTier: production ? "PRODUCTION" : "STAGING",
      databaseUrl: "postgres://runtime.lyzcyrdiazorjaqlgblr:synthetic@aws-0-ap-northeast-2.pooler.supabase.com/postgres",
      supabaseUrl: issuer.replace("/auth/v1", ""), supabasePublishableKey: "sb_publishable_synthetic",
      portOne: { channelEnvironment: "TEST" }, customerLoginProviders: [],
      paymentReviewLogin: { subject, email, expiresAt: new Date(Date.now() + 2 * 3_600_000).toISOString() },
      sessionTtlDays: 30, sessionTokenPepper: "synthetic-review-session-pepper",
      paymentReviewProxySecret: proxySecret,
    },
    pool: { ...client, connect: async () => client },
  } as unknown as ApiContext;
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(rateLimit, { max: 240, keyGenerator: request => rateLimitKey(request, context.config) });
  await registerCustomerAuthRoutes(app, context, {
    reviewAuthFetch: async () => { requests += 1; return new Response(JSON.stringify({ access_token: "synthetic-token" }), { status: wrongPassword ? 400 : 200 }); },
    verifyAccessToken: async () => ({ issuer, subject, canonicalSubject: `${issuer}#${subject}`, providers: ["EMAIL"], email }),
  });
  await app.ready();
  return { app, context, queries, sessionInserts, requests: () => requests };
}

test("review login creates only a normal customer session capped to the review deadline", async () => {
  const { app, context, queries, sessionInserts } = await setup();
  try {
    const normal = await app.inject({ method: "GET", url: "/v1/auth/providers" });
    assert.deepEqual(normal.json().methods, []);
    const discovery = await app.inject({ method: "GET", url: "/v1/auth/payment-review" });
    assert.equal(discovery.json().enabled, true);
    assert.equal(discovery.headers["cache-control"], "no-store");
    assert.ok(!discovery.body.includes(email));
    const result = await app.inject({ method: "POST", url: "/v1/auth/payment-review", payload: { email, password: "synthetic-password", acceptedPolicies: policies } });
    assert.equal(result.statusCode, 201, result.body);
    assert.equal(result.json().actor.role, "USER");
    assert.match(result.json().token, /^[A-Za-z0-9_-]{43}$/);
    const deadline = Date.parse(context.config.paymentReviewLogin!.expiresAt);
    assert.ok(Date.parse(result.json().expiresAt) <= deadline);
    assert.equal(sessionInserts.length, 1);
    assert.ok((sessionInserts[0]![6] as Date).getTime() <= deadline, "stored expiry never passes the review deadline");
    assert.equal((sessionInserts[0]![7] as Date).getTime(), deadline, "the review deadline is stored on the session");
    assert.equal(result.headers["cache-control"], "no-store");
    assert.ok(queries.some(sql => sql.includes("INSERT INTO sessions")));
    assert.ok(queries.includes("COMMIT"));
    assert.doesNotMatch(result.body, /synthetic-password|synthetic-token/);
  } finally { await app.close(); }
});

test("production and unaccepted policies stop before password authentication", async () => {
  for (const production of [false, true]) {
    const { app, requests, queries } = await setup(production);
    try {
      const result = await app.inject({ method: "POST", url: "/v1/auth/payment-review", payload: { email, password: "synthetic" } });
      assert.equal(result.statusCode, production ? 404 : 428);
      assert.equal(requests(), 0);
      assert.ok(!queries.some(sql => sql.includes("INSERT INTO users")));
      if (production) assert.equal((await app.inject({ method: "GET", url: "/v1/auth/payment-review" })).json().enabled, false);
    } finally { await app.close(); }
  }
});

test("wrong password never writes a customer; fabricated bearer headers cannot bypass attempt limit", async () => {
  const { app, requests, queries } = await setup(false, true);
  try {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const result = await app.inject({ method: "POST", url: "/v1/auth/payment-review",
        headers: { authorization: `Bearer ${String(attempt).repeat(43)}` },
        payload: { email, password: "synthetic-wrong", acceptedPolicies: policies } });
      assert.equal(result.statusCode, attempt === 5 ? 429 : 401);
    }
    assert.equal(requests(), 5);
    assert.ok(!queries.some(sql => sql.includes("INSERT INTO users") || sql.includes("INSERT INTO sessions")));
  } finally { await app.close(); }
});

test("one reviewer's failed attempts behind the shared site worker never lock out another reviewer", async () => {
  const { app } = await setup(false, true);
  const viaWorker = (ip: string) => {
    const time = String(Math.floor(Date.now() / 1_000));
    return {
      [PAYMENT_REVIEW_CLIENT_IP_HEADERS.ip]: ip,
      [PAYMENT_REVIEW_CLIENT_IP_HEADERS.time]: time,
      [PAYMENT_REVIEW_CLIENT_IP_HEADERS.signature]: paymentReviewClientIpSignature(proxySecret, time, ip),
    };
  };
  const attempt = (headers: Record<string, string>) => app.inject({ method: "POST", url: "/v1/auth/payment-review",
    headers, payload: { email, password: "synthetic-wrong", acceptedPolicies: policies } });
  try {
    for (let index = 0; index < 5; index += 1) assert.equal((await attempt(viaWorker("203.0.113.20"))).statusCode, 401);
    assert.equal((await attempt(viaWorker("203.0.113.20"))).statusCode, 429);
    assert.equal((await attempt(viaWorker("203.0.113.21"))).statusCode, 401, "a different reviewer keeps its own budget");
    // Unsigned or forged client IPs stay on the shared socket-address bucket.
    assert.equal((await attempt({ [PAYMENT_REVIEW_CLIENT_IP_HEADERS.ip]: "203.0.113.22" })).statusCode, 401);
  } finally { await app.close(); }
});
