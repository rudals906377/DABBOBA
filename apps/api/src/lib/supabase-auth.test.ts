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
  verifySupabaseCustomerAccessToken,
} from "./supabase-auth.js";

const issuer = "https://project.supabase.co/auth/v1";
const supabaseUrl = "https://project.supabase.co";
const audience = "authenticated";

function rejectsUnauthorized(work: () => Promise<unknown> | unknown) {
  return assert.rejects(async () => work(), (error: unknown) => {
    return error instanceof AppError && error.statusCode === 401;
  });
}

test("claim mapping authenticates the broker subject without treating app metadata as the current provider", () => {
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
  });

  const staleMetadata = mapSupabaseCustomerClaims({
    iss: issuer,
    sub: "social-only",
    role: "authenticated",
    app_metadata: { provider: "phone", providers: ["phone", "unsupported"] },
  });
  assert.equal(staleMetadata.subject, "social-only");
});

test("claim mapping rejects anonymous and unauthenticated broker subjects", async () => {
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
    role: "anon",
  }));
});

test("live Auth user verification accepts linked approved identities and ignores legacy phone identity", async () => {
  const signing = await generateKeyPair("ES256");
  const publicJwk = await exportJWK(signing.publicKey);
  publicJwk.kid = "live-user-key";
  publicJwk.alg = "ES256";
  const keyResolver = createLocalJWKSet({ keys: [publicJwk] });
  const now = Math.floor(Date.now() / 1_000);
  const subject = "f7257404-6ce4-4db6-a753-71848e7f6338";
  const token = await new SignJWT({
    role: "authenticated",
    app_metadata: { provider: "kakao", providers: ["kakao"] },
  })
    .setProtectedHeader({ alg: "ES256", kid: "live-user-key" })
    .setIssuer(issuer)
    .setSubject(subject)
    .setAudience(audience)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(signing.privateKey);
  const captured: Array<{ url: string; authorization: string | null; apikey: string | null }> = [];
  const verified = await verifySupabaseCustomerAccessToken(token, {
    supabaseUrl,
    audience,
    publishableKey: "sb_publishable_fixture_public_key",
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      captured.push({
        url: String(input),
        authorization: headers.get("authorization"),
        apikey: headers.get("apikey"),
      });
      return Response.json({
        id: subject,
        role: "authenticated",
        is_anonymous: false,
        email: " Customer@Example.com ",
        email_confirmed_at: new Date(Date.now() - 1_000).toISOString(),
        identities: [
          { identity_id: "kakao-one", user_id: subject, provider: "kakao" },
          { identity_id: "google-one", user_id: subject, provider: "google" },
          { identity_id: "google-two", user_id: subject, provider: "google" },
          { identity_id: "email-one", user_id: subject, provider: "email" },
          { identity_id: "legacy-phone", user_id: subject, provider: "phone" },
        ],
      });
    },
  }, keyResolver);
  assert.deepEqual(verified.providers, ["KAKAO", "GOOGLE", "EMAIL"]);
  assert.equal(verified.email, "customer@example.com");
  assert.deepEqual(captured, [{
    url: `${supabaseUrl}/auth/v1/user`,
    authorization: `Bearer ${token}`,
    apikey: "sb_publishable_fixture_public_key",
  }]);
});

test("live Auth user verification rejects a mismatched subject, phone-only user, unconfirmed email, and raw provider errors", async () => {
  const signing = await generateKeyPair("ES256");
  const publicJwk = await exportJWK(signing.publicKey);
  publicJwk.kid = "live-reject-key";
  publicJwk.alg = "ES256";
  const keyResolver = createLocalJWKSet({ keys: [publicJwk] });
  const now = Math.floor(Date.now() / 1_000);
  const subject = "5a6ed09a-da32-4305-9c60-da106c110b06";
  const token = await new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "ES256", kid: "live-reject-key" })
    .setIssuer(issuer).setSubject(subject).setAudience(audience).setIssuedAt(now).setExpirationTime(now + 300)
    .sign(signing.privateKey);
  const verifyWith = (body: unknown) => verifySupabaseCustomerAccessToken(token, {
    supabaseUrl,
    audience,
    publishableKey: "sb_publishable_fixture_public_key",
    fetch: async () => Response.json(body),
  }, keyResolver);
  await rejectsUnauthorized(() => verifyWith({
    id: "different-subject", role: "authenticated", is_anonymous: false,
    identities: [{ identity_id: "google", provider: "google" }],
  }));
  await rejectsUnauthorized(() => verifyWith({
    id: subject, role: "authenticated", is_anonymous: false,
    identities: [{ identity_id: "phone", provider: "phone" }],
  }));
  await rejectsUnauthorized(() => verifyWith({
    id: subject, role: "authenticated", is_anonymous: false,
    email: "customer@example.com", email_confirmed_at: "",
    identities: [{ identity_id: "email", provider: "email" }],
  }));
  await rejectsUnauthorized(() => verifySupabaseCustomerAccessToken(token, {
    supabaseUrl,
    audience,
    publishableKey: "sb_publishable_fixture_public_key",
    fetch: async () => { throw new Error("secret provider response"); },
  }, keyResolver));
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
