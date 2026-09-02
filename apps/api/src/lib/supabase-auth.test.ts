import assert from "node:assert/strict";
import test from "node:test";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTPayload,
} from "jose";
import { AppError } from "./errors.js";
import {
  mapSupabaseCustomerClaims,
  verifySupabaseAccessToken,
} from "./supabase-auth.js";

const issuer = "https://project.supabase.co/auth/v1";
const supabaseUrl = "https://project.supabase.co";
const audience = "authenticated";

function rejectsUnauthorized(work: () => Promise<unknown> | unknown) {
  return assert.rejects(async () => work(), (error: unknown) => {
    return error instanceof AppError && error.statusCode === 401;
  });
}

test("claim mapping accepts one approved provider without inferring other identities", () => {
  const claims = mapSupabaseCustomerClaims({
    iss: issuer,
    sub: "7aa68a27-b48f-4ad9-bfac-5cf8b1ae8077",
    role: "authenticated",
    email: " Customer@Example.com ",
    phone: "+821012345678",
    app_metadata: {
      provider: "kakao",
      providers: ["kakao"],
    },
  });

  assert.deepEqual(claims, {
    issuer,
    subject: "7aa68a27-b48f-4ad9-bfac-5cf8b1ae8077",
    canonicalSubject: `${issuer}#7aa68a27-b48f-4ad9-bfac-5cf8b1ae8077`,
    loginProvider: "KAKAO",
    providers: ["KAKAO"],
    email: "customer@example.com",
    phoneE164: null,
  });

  const socialOnly = mapSupabaseCustomerClaims({
    iss: issuer,
    sub: "social-only",
    role: "authenticated",
    phone: "+821012345678",
    app_metadata: { provider: "kakao", providers: ["kakao"] },
  });
  assert.equal(socialOnly.phoneE164, null);

});

test("claim mapping rejects anonymous, unsupported, or malformed phone identities", async () => {
  const base: JWTPayload = {
    iss: issuer,
    sub: "customer-subject",
    role: "authenticated",
  };
  await rejectsUnauthorized(() => mapSupabaseCustomerClaims({
    ...base,
    is_anonymous: true,
    app_metadata: { provider: "kakao" },
  }));
  await rejectsUnauthorized(() => mapSupabaseCustomerClaims({
    ...base,
    app_metadata: { provider: "google", providers: ["email", "google"] },
  }));
  await rejectsUnauthorized(() => mapSupabaseCustomerClaims({
    ...base,
    app_metadata: { provider: "email", providers: ["email", "kakao"] },
  }));
  await rejectsUnauthorized(() => mapSupabaseCustomerClaims({
    ...base,
    app_metadata: { provider: "kakao", providers: ["kakao", "custom:naver"] },
  }));
  await rejectsUnauthorized(() => mapSupabaseCustomerClaims({
    ...base,
    app_metadata: { provider: "phone" },
  }));
  await rejectsUnauthorized(() => mapSupabaseCustomerClaims({
    ...base,
    phone: "010-1234-5678",
    app_metadata: { provider: "phone" },
  }));
});

test("JWT verification requires the configured issuer, exact audience, expiry, role, and signature", async () => {
  const signing = await generateKeyPair("ES256");
  const publicJwk = await exportJWK(signing.publicKey);
  publicJwk.kid = "dabboba-test-key";
  publicJwk.alg = "ES256";
  publicJwk.use = "sig";
  const keyResolver = createLocalJWKSet({ keys: [publicJwk] });
  const now = Math.floor(Date.now() / 1_000);
  const token = async (changes: {
    issuer?: string;
    audience?: string | string[];
    role?: string;
    anonymous?: boolean;
    expiration?: number;
    privateKey?: CryptoKey;
  } = {}) => new SignJWT({
    role: changes.role || "authenticated",
    is_anonymous: changes.anonymous || false,
    email: "customer@example.com",
    app_metadata: { provider: "kakao", providers: ["kakao"] },
  })
    .setProtectedHeader({ alg: "ES256", kid: "dabboba-test-key", typ: "JWT" })
    .setIssuer(changes.issuer || issuer)
    .setSubject("8b31c37d-67e3-41fc-bdcf-bbb4aa957f16")
    .setAudience(changes.audience || audience)
    .setIssuedAt(now)
    .setExpirationTime(changes.expiration ?? now + 300)
    .sign(changes.privateKey || signing.privateKey);

  const verified = await verifySupabaseAccessToken(
    await token(),
    { supabaseUrl, audience },
    keyResolver,
  );
  assert.equal(verified.canonicalSubject, `${issuer}#8b31c37d-67e3-41fc-bdcf-bbb4aa957f16`);
  assert.deepEqual(verified.providers, ["KAKAO"]);

  await rejectsUnauthorized(async () => verifySupabaseAccessToken(
    await token({ issuer: "https://other.supabase.co/auth/v1" }),
    { supabaseUrl, audience },
    keyResolver,
  ));
  await rejectsUnauthorized(async () => verifySupabaseAccessToken(
    await token({ audience: [audience] }),
    { supabaseUrl, audience },
    keyResolver,
  ));
  await rejectsUnauthorized(async () => verifySupabaseAccessToken(
    await token({ expiration: now - 1 }),
    { supabaseUrl, audience },
    keyResolver,
  ));
  await rejectsUnauthorized(async () => verifySupabaseAccessToken(
    await token({ role: "anon" }),
    { supabaseUrl, audience },
    keyResolver,
  ));
  await rejectsUnauthorized(async () => verifySupabaseAccessToken(
    await token({ anonymous: true }),
    { supabaseUrl, audience },
    keyResolver,
  ));

  const untrusted = await generateKeyPair("ES256");
  await rejectsUnauthorized(async () => verifySupabaseAccessToken(
    await token({ privateKey: untrusted.privateKey }),
    { supabaseUrl, audience },
    keyResolver,
  ));
});
