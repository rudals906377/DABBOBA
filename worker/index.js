export default {
  async fetch(request, env) {
    const requestUrl = new URL(request.url);
    if (requestUrl.hostname === "www.dabboba.com") {
      requestUrl.hostname = "dabboba.com";
      return Response.redirect(requestUrl.toString(), 308);
    }

    const accountDeletionResponse = await handleAccountDeletionService(request, env);
    if (accountDeletionResponse) return accountDeletionResponse;

    const policyRoutes = new Map([
      ["/", "/legal/index.html"],
      ["/index.html", "/legal/index.html"],
      ["/privacy", "/legal/privacy/index.html"],
      ["/privacy/", "/legal/privacy/index.html"],
      ["/terms", "/legal/terms/index.html"],
      ["/terms/", "/legal/terms/index.html"],
      ["/support", "/legal/support/index.html"],
      ["/support/", "/legal/support/index.html"],
      ["/account-deletion", "/legal/account-deletion/index.html"],
      ["/account-deletion/", "/legal/account-deletion/index.html"],
      ["/account-deletion/auth/social/callback", "/legal/account-deletion/social-callback.html"],
      ["/community-operations", "/legal/community-operations/index.html"],
      ["/community-operations/", "/legal/community-operations/index.html"],
    ]);
    const policyAssetPath = policyRoutes.get(requestUrl.pathname);
    if (policyAssetPath && ["GET", "HEAD"].includes(request.method)) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = policyAssetPath;
      assetUrl.search = "";
      const assetResponse = await env.ASSETS.fetch(new Request(assetUrl, request));
      return withPublicPageHeaders(assetResponse);
    }

    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");

    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) {
      return response;
    }

    const indexUrl = new URL(request.url);
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    return env.ASSETS.fetch(new Request(indexUrl, request));
  },
};

function withPublicPageHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self' mailto:; frame-ancestors 'none'");
  headers.set("cross-origin-resource-policy", "same-origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const ACCOUNT_DELETION_ROUTES = new Set([
  "/account-deletion/runtime-config.json",
  "/account-deletion/auth/email-otp",
  "/account-deletion/auth/verify",
  "/account-deletion/auth/social/start",
  "/account-deletion/auth/social/verify",
  "/account-deletion/auth/logout",
  "/account-deletion/service/preview",
  "/account-deletion/service/request",
  "/account-deletion/service/status",
]);

const EMAIL_OTP_RESPONSE = Object.freeze({
  accepted: true,
  message: "입력한 이메일이 가입 계정과 일치하면 인증번호를 보냈습니다.",
  resendAfterSeconds: 60,
  expiresAfterSeconds: 600,
});

const JSON_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-type": "application/json; charset=UTF-8",
  "cross-origin-resource-policy": "same-origin",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
});

export async function handleAccountDeletionService(
  request,
  env,
  externalFetch = globalThis.fetch,
) {
  const url = new URL(request.url);
  if (!ACCOUNT_DELETION_ROUTES.has(url.pathname)) return null;
  if (url.origin !== "https://dabboba.com") return accountDeletionUnavailable();

  const expectedMethod = url.pathname === "/account-deletion/runtime-config.json"
    || url.pathname === "/account-deletion/service/preview"
    ? "GET"
    : "POST";
  if (request.method !== expectedMethod) {
    return jsonResponse(
      { error: { code: "METHOD_NOT_ALLOWED", message: "지원하지 않는 요청입니다." } },
      405,
      { allow: expectedMethod },
    );
  }

  if (url.pathname === "/account-deletion/service/status") {
    return handleDeletionStatus(request, env, externalFetch);
  }
  if (url.pathname === "/account-deletion/auth/logout") {
    return handleAccountDeletionLogout(request, env, externalFetch);
  }

  const runtime = readAccountDeletionRuntime(env);
  if (!runtime) return accountDeletionUnavailable();

  if (url.pathname === "/account-deletion/runtime-config.json") {
    return handleRuntimeConfig(runtime, externalFetch);
  }
  if (url.pathname === "/account-deletion/auth/email-otp") {
    return handleEmailOtp(request, runtime, externalFetch);
  }
  if (url.pathname === "/account-deletion/auth/verify") {
    return handleEmailOtpVerification(request, runtime, externalFetch);
  }
  if (url.pathname === "/account-deletion/auth/social/start") {
    return handleSocialLoginStart(request, runtime, externalFetch);
  }
  if (url.pathname === "/account-deletion/auth/social/verify") {
    return handleSocialLoginVerification(request, runtime, externalFetch);
  }
  if (url.pathname === "/account-deletion/service/preview") {
    return handleDeletionPreview(request, runtime, externalFetch);
  }
  if (url.pathname === "/account-deletion/service/request") {
    return handleDeletionRequest(request, runtime, externalFetch);
  }
  return null;
}

async function handleRuntimeConfig(runtime, externalFetch) {
  try {
    const [providers, publicConfig] = await Promise.all([
      fetchJson(externalFetch, `${runtime.apiOrigin}/v1/auth/providers`, {
        headers: { accept: "application/json" },
        signal: requestTimeoutSignal(),
      }),
      fetchJson(externalFetch, `${runtime.apiOrigin}/v1/public/config`, {
        headers: { accept: "application/json" },
        signal: requestTimeoutSignal(),
      }),
    ]);
    const providerBody = providers.body;
    const publicBody = publicConfig.body;
    const providerVersions = requiredPolicyVersions(providerBody?.requiredPolicyVersions);
    const publicVersions = requiredPolicyVersions(publicBody?.requiredPolicyVersions);
    if (
      !providers.response.ok
      || !publicConfig.response.ok
      || providerBody?.brokerExchangeConfigured !== true
      || !Array.isArray(providerBody?.methods)
      || !providerBody.methods.includes("EMAIL")
      || !providerVersions
      || !publicVersions
      || providerVersions.terms !== publicVersions.terms
      || providerVersions.privacy !== publicVersions.privacy
    ) {
      return accountDeletionUnavailable();
    }
    return jsonResponse({
      ready: true,
      authMethod: "EMAIL_OTP",
      socialMethods: providerBody.methods.filter((method) => ["KAKAO", "NAVER", "GOOGLE", "APPLE"].includes(method)),
      requiredPolicyVersions: publicVersions,
      resendAfterSeconds: EMAIL_OTP_RESPONSE.resendAfterSeconds,
      expiresAfterSeconds: EMAIL_OTP_RESPONSE.expiresAfterSeconds,
    });
  } catch {
    return accountDeletionUnavailable();
  }
}

const SOCIAL_PROVIDER_IDS = Object.freeze({
  KAKAO: "kakao",
  NAVER: "custom:naver",
  GOOGLE: "google",
  APPLE: "apple",
});
const SOCIAL_OAUTH_COOKIE = "__Host-dabboba_deletion_oauth";
const PKCE_VALUE = /^[A-Za-z0-9_-]{43,128}$/;

async function handleSocialLoginStart(request, runtime, externalFetch) {
  const input = await readJsonObject(request);
  const provider = typeof input?.provider === "string" && Object.hasOwn(SOCIAL_PROVIDER_IDS, input.provider)
    ? input.provider
    : null;
  const codeChallenge = typeof input?.codeChallenge === "string" && PKCE_VALUE.test(input.codeChallenge)
    ? input.codeChallenge
    : null;
  const acceptedPolicies = requiredPolicyVersions(input?.acceptedPolicies);
  if (!provider || !codeChallenge || !acceptedPolicies) {
    return jsonResponse({ error: { code: "INVALID_REQUEST", message: "로그인 요청을 다시 시작해 주세요." } }, 400);
  }

  try {
    const providers = await fetchJson(externalFetch, `${runtime.apiOrigin}/v1/auth/providers`, {
      headers: { accept: "application/json" },
      signal: requestTimeoutSignal(),
    });
    const currentVersions = requiredPolicyVersions(providers.body?.requiredPolicyVersions);
    if (
      !providers.response.ok
      || providers.body?.brokerExchangeConfigured !== true
      || !Array.isArray(providers.body?.methods)
      || !providers.body.methods.includes(provider)
      || !currentVersions
      || currentVersions.terms !== acceptedPolicies.terms
      || currentVersions.privacy !== acceptedPolicies.privacy
    ) {
      return accountDeletionUnavailable();
    }

    const state = randomBase64Url(32);
    const redirectUrl = new URL("https://dabboba.com/account-deletion/auth/social/callback");
    redirectUrl.searchParams.set("state", state);
    const authorizeUrl = new URL(`${runtime.supabaseOrigin}/auth/v1/authorize`);
    authorizeUrl.searchParams.set("provider", SOCIAL_PROVIDER_IDS[provider]);
    authorizeUrl.searchParams.set("redirect_to", redirectUrl.toString());
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "s256");
    const cookieValue = encodeURIComponent(JSON.stringify({
      state,
      provider,
      codeChallenge,
      acceptedPolicies,
      expiresAt: Date.now() + 10 * 60_000,
    }));
    return jsonResponse({ authorizationUrl: authorizeUrl.toString(), state }, 201, {
      "set-cookie": `${SOCIAL_OAUTH_COOKIE}=${cookieValue}; Max-Age=600; Path=/account-deletion/auth; HttpOnly; Secure; SameSite=Lax`,
    });
  } catch {
    return accountDeletionUnavailable();
  }
}

async function handleSocialLoginVerification(request, runtime, externalFetch) {
  const input = await readJsonObject(request);
  const state = typeof input?.state === "string" && /^[A-Za-z0-9_-]{43}$/.test(input.state) ? input.state : null;
  const authCode = typeof input?.code === "string" && input.code.length >= 16 && input.code.length <= 8_192
    && !/[\s\u0000-\u001f\u007f]/.test(input.code) ? input.code : null;
  const codeVerifier = typeof input?.codeVerifier === "string" && PKCE_VALUE.test(input.codeVerifier)
    ? input.codeVerifier
    : null;
  const oauth = readSocialOAuthCookie(request.headers.get("cookie"));
  const clearCookie = `${SOCIAL_OAUTH_COOKIE}=; Max-Age=0; Path=/account-deletion/auth; HttpOnly; Secure; SameSite=Lax`;
  if (
    !state
    || !authCode
    || !codeVerifier
    || !oauth
    || oauth.state !== state
    || oauth.expiresAt <= Date.now()
    || await pkceChallenge(codeVerifier) !== oauth.codeChallenge
  ) {
    return jsonResponse({
      error: { code: "IDENTITY_VERIFICATION_FAILED", message: "본인 확인을 완료하지 못했습니다." },
    }, 401, { "set-cookie": clearCookie });
  }

  let supabaseAccessToken = null;
  try {
    const token = await fetchJson(
      externalFetch,
      `${runtime.supabaseOrigin}/auth/v1/token?grant_type=pkce`,
      {
        method: "POST",
        headers: supabaseHeaders(runtime.supabasePublishableKey),
        body: JSON.stringify({ auth_code: authCode, code_verifier: codeVerifier }),
        signal: requestTimeoutSignal(),
      },
    );
    if (token.response.status >= 500) throw new Error("broker unavailable");
    supabaseAccessToken = typeof token.body?.access_token === "string"
      && token.body.access_token.length >= 64
      && token.body.access_token.length <= 16_384
      ? token.body.access_token
      : null;
    if (!token.response.ok || !supabaseAccessToken) {
      return jsonResponse({
        error: { code: "IDENTITY_VERIFICATION_FAILED", message: "본인 확인을 완료하지 못했습니다." },
      }, 401, { "set-cookie": clearCookie });
    }

    const providerRefreshToken = typeof token.body?.provider_refresh_token === "string"
      && token.body.provider_refresh_token.length >= 32
      && token.body.provider_refresh_token.length <= 16_384
      && !/[\s\u0000-\u001f\u007f]/.test(token.body.provider_refresh_token)
      ? token.body.provider_refresh_token
      : null;
    const exchanged = await fetchJson(
      externalFetch,
      `${runtime.apiOrigin}/v1/auth/account-deletion-exchange`,
      {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          accessToken: supabaseAccessToken,
          loginProvider: oauth.provider,
          acceptedPolicies: oauth.acceptedPolicies,
          ...(oauth.provider === "APPLE" && providerRefreshToken
            ? { appleRefreshToken: providerRefreshToken }
            : {}),
        }),
        signal: requestTimeoutSignal(),
      },
    );
    if (!exchanged.response.ok) {
      if (exchanged.response.status >= 500) throw new Error("api unavailable");
      return jsonResponse({
        error: { code: "IDENTITY_VERIFICATION_FAILED", message: "본인 확인을 완료하지 못했습니다." },
      }, exchanged.response.status === 429 ? 429 : 401, { "set-cookie": clearCookie });
    }
    const sessionToken = typeof exchanged.body?.token === "string"
      && /^[A-Za-z0-9_-]{43}$/.test(exchanged.body.token)
      ? exchanged.body.token
      : null;
    const expiresAt = typeof exchanged.body?.expiresAt === "string"
      && Number.isFinite(Date.parse(exchanged.body.expiresAt))
      ? exchanged.body.expiresAt
      : null;
    if (!sessionToken || !expiresAt) throw new Error("invalid api session");
    return jsonResponse({ verified: true, sessionToken, expiresAt }, 201, { "set-cookie": clearCookie });
  } catch {
    return jsonResponse({
      ready: false,
      error: { code: "ACCOUNT_DELETION_UNAVAILABLE", message: "현재 웹 탈퇴 요청을 사용할 수 없습니다." },
    }, 503, { "set-cookie": clearCookie });
  } finally {
    if (supabaseAccessToken) {
      await revokeTransientSupabaseSession(runtime, supabaseAccessToken, externalFetch);
    }
  }
}

async function handleEmailOtp(request, runtime, externalFetch) {
  const input = await readJsonObject(request);
  const email = normalizeEmail(input?.email);
  if (!email) return jsonResponse(EMAIL_OTP_RESPONSE, 202, { "retry-after": "60" });

  try {
    const result = await fetchJson(externalFetch, `${runtime.supabaseOrigin}/auth/v1/otp`, {
      method: "POST",
      headers: supabaseHeaders(runtime.supabasePublishableKey),
      body: JSON.stringify({ email, create_user: false }),
      signal: requestTimeoutSignal(),
    });
    if (result.response.status >= 500) return accountDeletionUnavailable();
  } catch {
    return accountDeletionUnavailable();
  }

  // Supabase may distinguish an unknown account upstream. The public response
  // deliberately stays byte-for-byte identical for every non-server outcome.
  return jsonResponse(EMAIL_OTP_RESPONSE, 202, { "retry-after": "60" });
}

async function handleEmailOtpVerification(request, runtime, externalFetch) {
  const input = await readJsonObject(request);
  const email = normalizeEmail(input?.email);
  const token = typeof input?.token === "string" && /^\d{6}$/.test(input.token)
    ? input.token
    : null;
  const acceptedPolicies = requiredPolicyVersions(input?.acceptedPolicies);
  if (!acceptedPolicies) {
    return jsonResponse({
      error: { code: "LEGAL_ACCEPTANCE_REQUIRED", message: "필수 약관을 확인해 주세요." },
    }, 428);
  }
  if (!email || !token) return invalidOtpResponse();

  let supabaseAccessToken;
  try {
    const verified = await fetchJson(externalFetch, `${runtime.supabaseOrigin}/auth/v1/verify`, {
      method: "POST",
      headers: supabaseHeaders(runtime.supabasePublishableKey),
      body: JSON.stringify({ email, token, type: "email" }),
      signal: requestTimeoutSignal(),
    });
    if (verified.response.status >= 500) return accountDeletionUnavailable();
    supabaseAccessToken = typeof verified.body?.access_token === "string"
      && verified.body.access_token.length >= 64
      && verified.body.access_token.length <= 16_384
      ? verified.body.access_token
      : null;
    if (!verified.response.ok || !supabaseAccessToken) return invalidOtpResponse();
  } catch {
    return accountDeletionUnavailable();
  }

  try {
    const exchanged = await fetchJson(externalFetch, `${runtime.apiOrigin}/v1/auth/exchange`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        accessToken: supabaseAccessToken,
        acceptedPolicies,
        loginProvider: "EMAIL",
      }),
      signal: requestTimeoutSignal(),
    });
    if (!exchanged.response.ok) {
      if (exchanged.response.status === 428) {
        return jsonResponse({
          error: {
            code: "LEGAL_ACCEPTANCE_REQUIRED",
            message: "약관 버전이 변경되었습니다. 페이지를 새로고침해 주세요.",
          },
        }, 428);
      }
      if (exchanged.response.status >= 500) return accountDeletionUnavailable();
      return jsonResponse({
        error: { code: "IDENTITY_VERIFICATION_FAILED", message: "본인 확인을 완료하지 못했습니다." },
      }, exchanged.response.status === 429 ? 429 : 401);
    }

    const sessionToken = typeof exchanged.body?.token === "string"
      && /^[A-Za-z0-9_-]{43}$/.test(exchanged.body.token)
      ? exchanged.body.token
      : null;
    const expiresAt = typeof exchanged.body?.expiresAt === "string"
      && Number.isFinite(Date.parse(exchanged.body.expiresAt))
      ? exchanged.body.expiresAt
      : null;
    if (!sessionToken || !expiresAt) return accountDeletionUnavailable();

    await revokeTransientSupabaseSession(runtime, supabaseAccessToken, externalFetch);
    return jsonResponse({ verified: true, sessionToken, expiresAt }, 201);
  } catch {
    return accountDeletionUnavailable();
  }
}

async function handleDeletionPreview(request, runtime, externalFetch) {
  const sessionToken = bearerToken(request);
  if (!sessionToken) return authenticationRequired();
  try {
    const result = await fetchJson(externalFetch, `${runtime.apiOrigin}/v1/account/deletion-preview`, {
      headers: apiAuthorizationHeaders(sessionToken),
      signal: requestTimeoutSignal(),
    });
    if (!result.response.ok) return accountApiError(result.response.status);
    if (!isDeletionPreview(result.body)) return accountDeletionUnavailable();
    return jsonResponse(result.body);
  } catch {
    return accountDeletionUnavailable();
  }
}

async function handleDeletionRequest(request, runtime, externalFetch) {
  const sessionToken = bearerToken(request);
  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!sessionToken) return authenticationRequired();
  if (!idempotencyKey || idempotencyKey.length > 200 || /[\u0000-\u001f\u007f]/.test(idempotencyKey)) {
    return jsonResponse({ error: { code: "INVALID_REQUEST", message: "요청 정보를 확인해 주세요." } }, 400);
  }
  try {
    const result = await fetchJson(externalFetch, `${runtime.apiOrigin}/v1/account/deletion-request`, {
      method: "POST",
      headers: {
        ...apiAuthorizationHeaders(sessionToken),
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: "{}",
      signal: requestTimeoutSignal(),
    });
    if (!result.response.ok) return accountApiError(result.response.status);
    if (!isDeletionReceipt(result.body)) return accountDeletionUnavailable();
    await revokeDabbobaSession(runtime.apiOrigin, sessionToken, externalFetch);
    return jsonResponse(result.body, 202);
  } catch {
    return accountDeletionUnavailable();
  }
}

async function handleAccountDeletionLogout(request, env, externalFetch) {
  const apiOrigin = exactHttpsOrigin(env?.DABBOBA_PUBLIC_API_ORIGIN);
  const sessionToken = bearerToken(request);
  if (!apiOrigin || !sessionToken) return authenticationRequired();
  const revoked = await revokeDabbobaSession(apiOrigin, sessionToken, externalFetch);
  return revoked
    ? new Response(null, { status: 204, headers: JSON_HEADERS })
    : accountDeletionUnavailable();
}

async function handleDeletionStatus(request, env, externalFetch) {
  const apiOrigin = exactHttpsOrigin(env?.DABBOBA_PUBLIC_API_ORIGIN);
  if (!apiOrigin) return accountDeletionUnavailable();
  const input = await readJsonObject(request);
  const requestId = typeof input?.requestId === "string" && UUID.test(input.requestId)
    ? input.requestId
    : null;
  const statusToken = typeof input?.statusToken === "string" && /^[A-Za-z0-9_-]{43}$/.test(input.statusToken)
    ? input.statusToken
    : null;
  if (!requestId || !statusToken) {
    return jsonResponse({ error: { code: "RECEIPT_NOT_FOUND", message: "접수 정보를 확인할 수 없습니다." } }, 404);
  }
  try {
    const result = await fetchJson(
      externalFetch,
      `${apiOrigin}/v1/account/deletion-requests/${encodeURIComponent(requestId)}/status`,
      {
        headers: { accept: "application/json", "x-deletion-status-token": statusToken },
        signal: requestTimeoutSignal(),
      },
    );
    if (!result.response.ok) {
      return jsonResponse({ error: { code: "RECEIPT_NOT_FOUND", message: "접수 정보를 확인할 수 없습니다." } }, result.response.status === 429 ? 429 : 404);
    }
    if (!isDeletionRequest(result.body)) return accountDeletionUnavailable();
    return jsonResponse(result.body);
  } catch {
    return accountDeletionUnavailable();
  }
}

function readAccountDeletionRuntime(env) {
  const apiOrigin = exactHttpsOrigin(env?.DABBOBA_PUBLIC_API_ORIGIN);
  const supabaseOrigin = exactHttpsOrigin(env?.SUPABASE_URL);
  const supabasePublishableKey = publicSupabaseKey(env?.SUPABASE_PUBLISHABLE_KEY);
  if (!apiOrigin || !supabaseOrigin || !supabasePublishableKey) return null;
  return { apiOrigin, supabaseOrigin, supabasePublishableKey };
}

function exactHttpsOrigin(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (
      parsed.protocol !== "https:"
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
      || parsed.pathname !== "/"
    ) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function publicSupabaseKey(value) {
  if (typeof value !== "string") return null;
  const key = value.trim();
  if (key.length < 20 || /^sb_secret_/i.test(key) || legacyJwtRole(key) === "service_role") return null;
  return key;
}

function legacyJwtRole(value) {
  const payload = value.split(".")[1];
  if (!payload) return null;
  try {
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const decoded = JSON.parse(globalThis.atob(padded));
    return typeof decoded?.role === "string" ? decoded.role : null;
  } catch {
    return null;
  }
}

function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLocaleLowerCase("en-US");
  return email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
}

function randomBase64Url(byteLength) {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function pkceChallenge(verifier) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function readSocialOAuthCookie(rawCookie) {
  if (typeof rawCookie !== "string" || rawCookie.length > 8_192) return null;
  const pair = rawCookie.split(";").map((value) => value.trim()).find((value) => value.startsWith(`${SOCIAL_OAUTH_COOKIE}=`));
  if (!pair) return null;
  try {
    const value = JSON.parse(decodeURIComponent(pair.slice(SOCIAL_OAUTH_COOKIE.length + 1)));
    const acceptedPolicies = requiredPolicyVersions(value?.acceptedPolicies);
    if (
      !value
      || typeof value !== "object"
      || typeof value.state !== "string"
      || !/^[A-Za-z0-9_-]{43}$/.test(value.state)
      || typeof value.provider !== "string"
      || !Object.hasOwn(SOCIAL_PROVIDER_IDS, value.provider)
      || typeof value.codeChallenge !== "string"
      || !PKCE_VALUE.test(value.codeChallenge)
      || !acceptedPolicies
      || !Number.isSafeInteger(value.expiresAt)
    ) return null;
    return {
      state: value.state,
      provider: value.provider,
      codeChallenge: value.codeChallenge,
      acceptedPolicies,
      expiresAt: value.expiresAt,
    };
  } catch {
    return null;
  }
}

function requiredPolicyVersions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Object.keys(value).length !== 2) return null;
  const version = /^\d{4}-\d{2}-\d{2}$/;
  return typeof value.terms === "string"
    && typeof value.privacy === "string"
    && version.test(value.terms)
    && version.test(value.privacy)
    ? { terms: value.terms, privacy: value.privacy }
    : null;
}

function supabaseHeaders(key) {
  return {
    accept: "application/json",
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
  };
}

function apiAuthorizationHeaders(token) {
  return { accept: "application/json", authorization: `Bearer ${token}` };
}

function bearerToken(request) {
  const value = request.headers.get("authorization")?.trim() || "";
  const matched = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(value);
  return matched?.[1] || null;
}

async function readJsonObject(request) {
  const declaredLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > 20_000) return null;
  try {
    const text = await request.text();
    if (!text || text.length > 20_000) return null;
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

async function fetchJson(externalFetch, url, init) {
  const response = await externalFetch(url, { ...init, redirect: "error" });
  const text = await response.text();
  if (text.length > 200_000) throw new Error("External JSON response too large");
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { response, body };
}

async function revokeTransientSupabaseSession(runtime, accessToken, externalFetch) {
  try {
    await externalFetch(`${runtime.supabaseOrigin}/auth/v1/logout?scope=local`, {
      method: "POST",
      headers: {
        ...supabaseHeaders(runtime.supabasePublishableKey),
        authorization: `Bearer ${accessToken}`,
      },
      signal: requestTimeoutSignal(),
      redirect: "error",
    });
  } catch {
    // The access token never leaves this Worker response. A failed best-effort
    // refresh-token revocation must not discard a successfully verified login.
  }
}

async function revokeDabbobaSession(apiOrigin, sessionToken, externalFetch) {
  try {
    const response = await externalFetch(`${apiOrigin}/v1/auth/logout`, {
      method: "POST",
      headers: apiAuthorizationHeaders(sessionToken),
      signal: requestTimeoutSignal(),
      redirect: "error",
    });
    return response.ok || response.status === 401 || response.status === 404;
  } catch {
    // A web deletion session is intentionally ephemeral. The API logout route
    // is idempotent and an already-revoked/expired session is safe to ignore.
    return false;
  }
}

function requestTimeoutSignal() {
  return typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(8_000) : undefined;
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function accountDeletionUnavailable() {
  return jsonResponse({
    ready: false,
    error: { code: "ACCOUNT_DELETION_UNAVAILABLE", message: "현재 웹 탈퇴 요청을 사용할 수 없습니다." },
  }, 503);
}

function invalidOtpResponse() {
  return jsonResponse({
    error: { code: "IDENTITY_VERIFICATION_FAILED", message: "인증번호를 확인할 수 없습니다." },
  }, 401);
}

function authenticationRequired() {
  return jsonResponse({
    error: { code: "AUTHENTICATION_REQUIRED", message: "본인 확인을 다시 진행해 주세요." },
  }, 401);
}

function accountApiError(status) {
  if (status >= 500) return accountDeletionUnavailable();
  if (status === 401 || status === 403) return authenticationRequired();
  if (status === 409) {
    return jsonResponse({ error: { code: "ACCOUNT_DELETION_CONFLICT", message: "이미 탈퇴 처리가 진행 중입니다." } }, 409);
  }
  if (status === 429) {
    return jsonResponse({ error: { code: "RATE_LIMITED", message: "잠시 후 다시 시도해 주세요." } }, 429);
  }
  return jsonResponse({ error: { code: "INVALID_REQUEST", message: "요청 정보를 확인해 주세요." } }, 400);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DELETION_STATUSES = new Set([
  "PENDING_REVIEW",
  "BLOCKED",
  "PROCESSING",
  "APPROVED",
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
]);
const BLOCKER_KEYS = [
  "pointBalance",
  "activeOrderCount",
  "activePaymentCount",
  "availableDrawEntitlementCount",
  "activeInventoryCount",
  "activeShippingRequestCount",
  "activeExchangeListingCount",
  "activeExchangeOfferCount",
];

function isDeletionBlockers(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && BLOCKER_KEYS.every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0);
}

function isDeletionPreview(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && typeof value.canDeleteNow === "boolean"
    && isDeletionBlockers(value.blockers);
}

function isDeletionRequest(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && typeof value.id === "string"
    && UUID.test(value.id)
    && DELETION_STATUSES.has(value.status)
    && isDeletionBlockers(value.blockers)
    && Number.isSafeInteger(value.requestCount)
    && value.requestCount >= 1
    && value.hardDeletePerformed === false
    && value.policy === "AUTOMATED_SERVER_DELETION"
    && ["NOT_REQUIRED", "PENDING", "COMPLETED"].includes(value.authDeletionStatus)
    && validDateTime(value.requestedAt)
    && validDateTime(value.lastRequestedAt)
    && (value.completedAt === null || validDateTime(value.completedAt));
}

function isDeletionReceipt(value) {
  return isDeletionRequest(value)
    && typeof value.statusToken === "string"
    && /^[A-Za-z0-9_-]{43}$/.test(value.statusToken);
}

function validDateTime(value) {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}
