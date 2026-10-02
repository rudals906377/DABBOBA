import assert from "node:assert/strict";
import test from "node:test";
import { loadPaymentReviewLogin, type ApiConfig } from "@dabboba/config";
import { activePaymentReviewLogin, authenticatePaymentReviewer } from "./payment-review-auth.js";
import { AppError } from "./errors.js";

const subject = "00000000-0000-4000-8000-000000000001";
const email = "review@example.invalid";
const base = {
  environmentTier: "STAGING", databaseUrl: "postgres://runtime.lyzcyrdiazorjaqlgblr:synthetic@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres",
  supabaseUrl: "https://lyzcyrdiazorjaqlgblr.supabase.co", supabasePublishableKey: "sb_publishable_test_only_key",
  portOne: { channelEnvironment: "TEST" },
} as ApiConfig;
const config = { ...base, paymentReviewLogin: { subject, email, expiresAt: new Date(Date.now() + 86_400_000).toISOString() } };
const claims = { subject, email, issuer: `${base.supabaseUrl}/auth/v1`, canonicalSubject: `${base.supabaseUrl}/auth/v1#${subject}`, providers: ["EMAIL" as const] };

test("review credentials cannot be configured in production, another database, another broker or LIVE", () => {
  const env = { PAYMENT_REVIEW_LOGIN_ENABLED: "true", PAYMENT_REVIEW_LOGIN_EMAIL: email,
    PAYMENT_REVIEW_LOGIN_SUBJECT: subject, PAYMENT_REVIEW_LOGIN_EXPIRES_AT: config.paymentReviewLogin.expiresAt };
  assert.equal(loadPaymentReviewLogin({}, base), null);
  assert.equal(loadPaymentReviewLogin(env, base)?.subject, subject);
  for (const other of [
    { ...base, environmentTier: "PRODUCTION" as const },
    { ...base, databaseUrl: "postgres://runtime.production:synthetic@aws-0-ap-northeast-2.pooler.supabase.com/postgres" },
    { ...base, supabaseUrl: "https://rconfxsykttfvznakile.supabase.co" },
    { ...base, portOne: { ...base.portOne!, channelEnvironment: "LIVE" as const } },
  ]) {
    assert.throws(() => loadPaymentReviewLogin(env, other));
    assert.equal(activePaymentReviewLogin({ ...other, paymentReviewLogin: config.paymentReviewLogin }), null);
  }
  assert.throws(() => loadPaymentReviewLogin({ ...env, PAYMENT_REVIEW_LOGIN_SUBJECT: "client-supplied-identity" }, base));
  assert.throws(() => loadPaymentReviewLogin({ ...env, PAYMENT_REVIEW_LOGIN_EXPIRES_AT: new Date(Date.now() + 31 * 86_400_000).toISOString() }, base));
  assert.equal(activePaymentReviewLogin(config, Date.parse(config.paymentReviewLogin.expiresAt)), null);
});

test("review login uses the real password grant and verified pinned subject, not a development session", async () => {
  let verified = false;
  const result = await authenticatePaymentReviewer(config, email, "synthetic-password", {
    fetch: async (url, init) => {
      assert.equal(String(url), `${base.supabaseUrl}/auth/v1/token?grant_type=password`);
      assert.equal(init?.redirect, "error");
      assert.deepEqual(JSON.parse(init!.body as string), { email, password: "synthetic-password" });
      return new Response(JSON.stringify({ access_token: "synthetic-access-token" }), { status: 200 });
    },
    verifyAccessToken: async token => { assert.equal(token, "synthetic-access-token"); verified = true; return claims; },
  });
  assert.equal(verified, true);
  assert.deepEqual(result, claims);
});

test("wrong password, wrong subject/provider and foreign account never issue review identity", async () => {
  let requested = false;
  await assert.rejects(authenticatePaymentReviewer(config, "other@example.invalid", "synthetic", {
    fetch: async () => { requested = true; throw new Error("must not call"); },
  }), error => error instanceof AppError && error.statusCode === 401);
  assert.equal(requested, false);
  const goodFetch: typeof fetch = async () => new Response(JSON.stringify({ access_token: "synthetic-token" }));
  for (const other of [{ ...claims, subject: "another" }, { ...claims, email: "another@example.invalid" }, { ...claims, providers: ["GOOGLE" as const] }]) {
    await assert.rejects(authenticatePaymentReviewer(config, email, "synthetic", {
      fetch: goodFetch, verifyAccessToken: async () => other,
    }), error => error instanceof AppError && error.statusCode === 401);
  }
  for (const status of [400, 401, 429, 500]) {
    await assert.rejects(authenticatePaymentReviewer(config, email, "synthetic", {
      fetch: async () => new Response('{"error":"provider-private-error-must-not-leak"}', { status }),
    }), error => error instanceof AppError && !error.message.includes("provider-private-error"));
  }
});

test("short pg login maps only to the configured reviewer and still verifies its password", async () => {
  for (const login of ["pg", " PG "]) {
    const result = await authenticatePaymentReviewer(config, login, "synthetic-password", {
      fetch: async (_url, init) => {
        assert.deepEqual(JSON.parse(init!.body as string), { email, password: "synthetic-password" });
        return new Response(JSON.stringify({ access_token: "synthetic-token" }));
      },
      verifyAccessToken: async () => claims,
    });
    assert.equal(result.subject, subject);
  }
  await assert.rejects(authenticatePaymentReviewer(config, "pg", "wrong-password", {
    fetch: async () => new Response("{}", { status: 400 }),
  }), error => error instanceof AppError && error.statusCode === 401);
  await assert.rejects(authenticatePaymentReviewer({ ...config, environmentTier: "PRODUCTION" }, "pg", "synthetic-password"),
    error => error instanceof AppError && error.statusCode === 404);
});
