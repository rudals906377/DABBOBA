import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");
const requireFromMobile = createRequire(path.join(root, "apps/mobile/package.json"));
const ts = requireFromMobile("typescript");

function loadPureTypeScriptModule(relativePath) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: relativePath,
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    URL,
    URLSearchParams,
    JSON,
    Error,
  });
  return module.exports;
}

test("native login exposes Kakao, Naver, Google, Apple, and email OTP without phone login", () => {
  const route = "apps/mobile/app/auth/login.tsx";
  assert.equal(existsSync(path.join(root, route)), true);

  const screen = read("apps/mobile/src/features/auth/LoginScreen.tsx");
  assert.match(screen, /카카오로 계속하기/);
  assert.match(screen, /네이버로 계속하기/);
  assert.match(screen, /구글로 계속하기/);
  assert.match(screen, /애플로 계속하기/);
  assert.match(screen, /이메일로 로그인/);
  assert.match(screen, /logo-google/);
  assert.match(screen, /logo-apple/);
  assert.doesNotMatch(screen, /휴대폰번호|문자 인증번호|loginPhone|requestPhoneOtp/);
  assert.match(screen, /exchangeBrokerSession/);
  assert.match(screen, /resolveAfterLoginPath/);
  assert.match(screen, /enabledProviders/);
  assert.match(screen, /providerAvailable/);
  assert.match(screen, /termsAccepted/);
  assert.match(screen, /privacyAccepted/);
  assert.match(screen, /requiredPolicyVersions/);
  assert.match(screen, /accessibilityRole="checkbox"/);
});

test("development restores one customer session without exposing a test-account login", () => {
  const screen = read("apps/mobile/src/features/auth/LoginScreen.tsx");
  const demoApi = read("apps/mobile/src/features/demo/demo-api.ts");
  const layout = read("apps/mobile/app/_layout.tsx");
  const legacyDevelopmentSession = read("apps/mobile/src/lib/development-session.ts");

  assert.match(screen, /__DEV__ && internalSessionState === "failed"/);
  assert.match(screen, /로그인 다시 시도/);
  assert.doesNotMatch(screen, /테스트 계정|데모 계정|DemoAccountSwitcher|ensureDevelopmentAuthSession/);
  assert.match(layout, /InternalCustomerSessionBootstrap enabled=\{__DEV__\}/);
  assert.match(layout, /ensureInternalCustomerSession/);
  assert.match(demoApi, /\/v1\/demo\/session/);
  assert.doesNotMatch(demoApi, /\/v1\/auth\/dev-session|mobile-test@dabboba\.local/);
  assert.match(legacyDevelopmentSession, /ensureInternalCustomerSession/);
  assert.doesNotMatch(legacyDevelopmentSession, /\/v1\/auth\/dev-session|mobile-test@dabboba\.local/);
});

test("protected customer actions can open login and return to one bounded internal route", () => {
  const navigation = read("apps/mobile/src/features/auth/login-navigation.ts");
  const product = read("apps/mobile/src/features/shop/ProductDetailScreen.tsx");
  const exchange = read("apps/mobile/src/features/exchange/ExchangeRoomScreen.tsx");
  assert.match(navigation, /pathname:\s*"\/auth\/login"/);
  assert.match(navigation, /candidate\.startsWith\("\/\/"\)/);
  assert.match(navigation, /candidate\.startsWith\("\/auth\/"\)/);
  assert.match(product, /openCustomerLogin/);
  assert.match(exchange, /openCustomerLogin/);
});

test("mobile auth keeps provider credentials public-only and stores only the DABBOBA session", () => {
  const broker = read("apps/mobile/src/features/auth/supabase-broker.ts");
  const api = read("apps/mobile/src/features/auth/auth-api.ts");
  const environment = read(".env.example");

  assert.match(broker, /EXPO_PUBLIC_SUPABASE_URL/);
  assert.match(broker, /EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(broker, /process\.env\.(?:SUPABASE_SERVICE|EXPO_PUBLIC_SUPABASE_SECRET)/i);
  assert.match(broker, /service_role/);
  assert.match(broker, /flowType:\s*"pkce"/);
  assert.match(broker, /withSecurePkceRuntime/);
  assert.match(broker, /ExpoCrypto\.getRandomValues/);
  assert.match(broker, /CryptoDigestAlgorithm\.SHA256/);
  assert.match(broker, /persistSession:\s*false/);
  assert.match(broker, /sb_secret_/);
  assert.match(broker, /dabboba["],\s*path:\s*"auth\/callback"/);
  assert.match(broker, /callback\.protocol !== expected\.protocol/);
  assert.match(broker, /callback\.host !== expected\.host/);
  assert.match(broker, /callback\.pathname !== expected\.pathname/);
  assert.match(broker, /callback\.hash/);
  assert.match(broker, /getAll\("code"\)/);
  assert.match(api, /\/v1\/auth\/exchange/);
  assert.match(api, /acceptedPolicies:\s*AcceptedPolicyVersions/);
  assert.match(api, /acceptedPolicies,\s*\n/);
  assert.match(api, /requestId:\s*randomUUID/);
  assert.match(api, /writeAuthTokens/);
  assert.match(environment, /EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=/);
  assert.doesNotMatch(environment, /EXPO_PUBLIC_SUPABASE_SERVICE/);
});

test("social PKCE login survives a cold-start callback without accepting a replay", () => {
  const callbackRoute = "apps/mobile/app/auth/callback.tsx";
  assert.equal(existsSync(path.join(root, callbackRoute)), true);

  const broker = read("apps/mobile/src/features/auth/supabase-broker.ts");
  const callbackState = read("apps/mobile/src/features/auth/social-login-state.ts");
  const authApi = read("apps/mobile/src/features/auth/auth-api.ts");

  assert.match(broker, /storage:\s*brokerSecureStorage/);
  assert.match(broker, /appendPkceFlowIdToRedirects:\s*true/);
  assert.match(broker, /SOCIAL_LOGIN_ATTEMPT_TTL_MS/);
  assert.match(broker, /SecureStore\.setItemAsync/);
  assert.match(broker, /pkceVerifierKey/);
  assert.match(broker, /consumedAt/);
  assert.match(callbackState, /callbackState !== pending\.state/);
  assert.match(callbackState, /callbackFlowId !== pending\.flowId/);
  assert.match(callbackState, /pending\.expiresAt <= nowMs/);
  assert.match(callbackState, /로그인 요청이 이미 사용되었습니다/);
  assert.match(authApi, /socialLoginCompletionFlights/);
  assert.match(authApi, /completeSocialCustomerLogin/);
});

test("social callback state accepts one fresh matching code and rejects mismatch, expiry, and reuse", () => {
  const state = loadPureTypeScriptModule("apps/mobile/src/features/auth/social-login-state.ts");
  const now = 1_800_000_000_000;
  const pending = state.createPendingSocialLogin({
    provider: "KAKAO",
    returnTo: "/product/item-1",
    state: "12345678-1234-4234-8234-123456789abc",
    flowId: "0123456789abcdef0123456789abcdef",
    pkceVerifierKey: "dabboba.auth.broker-flow-0123456789abcdef0123456789abcdef-code-verifier",
    redirectTo: "dabboba://auth/callback?state=12345678-1234-4234-8234-123456789abc",
    nowMs: now,
  });
  const callback = "dabboba://auth/callback?state=12345678-1234-4234-8234-123456789abc&sb_flow_id=0123456789abcdef0123456789abcdef&code=one-time-code";
  const validated = state.validateSocialLoginCallback(callback, pending, now + 1_000);
  assert.equal(validated.code, "one-time-code");
  assert.equal(validated.flowId, pending.flowId);

  assert.throws(
    () => state.validateSocialLoginCallback(callback.replace(pending.state, "ffffffff-ffff-4fff-8fff-ffffffffffff"), pending, now + 1_000),
    (error) => error.cleanupAttempt === false,
  );
  assert.throws(
    () => state.validateSocialLoginCallback(callback, pending, pending.expiresAt),
    (error) => error.cleanupAttempt === true && /만료/.test(error.message),
  );
  assert.throws(
    () => state.validateSocialLoginCallback(callback, { ...pending, consumedAt: now + 500 }, now + 1_000),
    (error) => error.cleanupAttempt === true && /이미 사용/.test(error.message),
  );
});

test("email OTP uses the broker email flow and never enables phone login", () => {
  const broker = read("apps/mobile/src/features/auth/supabase-broker.ts");
  const supabaseConfig = read("supabase/config.toml");
  const confirmationTemplate = read("supabase/templates/confirmation.html");
  const magicLinkTemplate = read("supabase/templates/magic-link.html");
  assert.match(broker, /normalizeEmailAddress/);
  assert.match(broker, /signInWithOtp/);
  assert.match(broker, /verifyOtp/);
  assert.match(broker, /shouldCreateUser:\s*true/);
  assert.match(broker, /type:\s*"email"/);
  assert.match(broker, /EMAIL_OTP_TTL_MS\s*=\s*10 \* 60_000/);
  assert.match(broker, /EMAIL_OTP_RESEND_COOLDOWN_MS\s*=\s*60_000/);
  assert.match(broker, /SecureStore\.setItemAsync\(PENDING_EMAIL_OTP_KEY/);
  assert.match(broker, /readPendingEmailOtp/);
  assert.doesNotMatch(broker, /type:\s*"sms"|channel:\s*"sms"|normalizeKoreanMobileNumber/);
  assert.match(supabaseConfig, /\[auth\.email\][\s\S]*?otp_length\s*=\s*6/);
  assert.match(supabaseConfig, /\[auth\.email\][\s\S]*?otp_expiry\s*=\s*600/);
  assert.match(supabaseConfig, /\[auth\.email\][\s\S]*?max_frequency\s*=\s*"60s"/);
  assert.match(supabaseConfig, /\[auth\.email\.template\.confirmation\]/);
  assert.match(supabaseConfig, /\[auth\.email\.template\.magic_link\]/);
  for (const template of [confirmationTemplate, magicLinkTemplate]) {
    assert.match(template, /\{\{ \.Token \}\}/);
    assert.doesNotMatch(template, /ConfirmationURL|TokenHash/);
  }
});

test("expired DABBOBA sessions rely on token-matched cleanup and become an explicit re-login state", () => {
  const profileApi = read("apps/mobile/src/features/profile/profile-api.ts");
  const profileHook = read("apps/mobile/src/features/profile/use-profile-snapshot.ts");
  assert.match(profileApi, /class ProfileApiError/);
  assert.match(profileHook, /error instanceof ProfileApiError && error\.status === 401/);
  assert.doesNotMatch(profileHook, /clearAuthTokens\(\)/);
  assert.match(profileHook, /expiredProfileSession/);
  assert.match(profileHook, /currentTokens\.accessToken !== tokens\.accessToken/);
  assert.match(profileHook, /loadGeneration\.current/);
  assert.match(profileHook, /fetchProfileSnapshot\(runtime\.apiBaseUrl, undefined, \{ scope \}\)/);
});

test("mobile feature clients clear expired sessions and product detail observes the cleared state", () => {
  const wrapper = read("apps/mobile/src/lib/mobile-api-client.ts");
  assert.match(wrapper, /onUnauthorized:\s*clearExpiredCustomerSession/);
  assert.match(wrapper, /request\.headers\.get\("authorization"\)/);
  assert.match(wrapper, /current\?\.accessToken !== failedAccessToken/);
  assert.match(wrapper, /clearAuthTokensIfCurrent\(current\)/);
  assert.match(wrapper, /unauthorizedCleanup/);

  const featureApiFiles = [
    "apps/mobile/src/features/catalog/catalog-api.ts",
    "apps/mobile/src/features/checkout/checkout-api.ts",
    "apps/mobile/src/features/draw/draw-reveal-api.ts",
    "apps/mobile/src/features/dukroom/dukroom-api.ts",
    "apps/mobile/src/features/exchange/exchange-api.ts",
    "apps/mobile/src/features/notifications/notifications-api.ts",
    "apps/mobile/src/features/profile/account-detail-api.ts",
    "apps/mobile/src/features/profile/inquiry-api.ts",
    "apps/mobile/src/features/profile/profile-api.ts",
    "apps/mobile/src/features/profile/profile-detail-api.ts",
    "apps/mobile/src/features/profile/wanted-request-api.ts",
    "apps/mobile/src/features/shop/shop-api.ts",
  ];
  for (const file of featureApiFiles) {
    assert.match(read(file), /createMobileDabbobaClient/);
  }

  const authApi = read("apps/mobile/src/features/auth/auth-api.ts");
  const developmentSession = read("apps/mobile/src/lib/development-session.ts");
  assert.doesNotMatch(authApi, /createMobileDabbobaClient/);
  assert.doesNotMatch(developmentSession, /createMobileDabbobaClient/);

  const product = read("apps/mobile/src/features/shop/ProductDetailScreen.tsx");
  const fetchIndex = product.indexOf("await fetchProductDetail");
  const rereadIndex = product.indexOf("const currentTokens = await readAuthTokens()", fetchIndex);
  const stateIndex = product.indexOf("setAccessToken(currentTokens?.accessToken ?? null)", rereadIndex);
  assert.ok(fetchIndex >= 0 && rereadIndex > fetchIndex && stateIndex > rereadIndex);
});

test("customer sessions restore with expiry-aware single-flight rotation", () => {
  const store = read("apps/mobile/src/lib/session-store.ts");
  const lifecycle = read("apps/mobile/src/lib/customer-session.ts");
  const wrapper = read("apps/mobile/src/lib/mobile-api-client.ts");
  const layout = read("apps/mobile/app/_layout.tsx");
  const authApi = read("apps/mobile/src/features/auth/auth-api.ts");
  const demoApi = read("apps/mobile/src/features/demo/demo-api.ts");

  assert.match(store, /SESSION_RECORD_KEY/);
  assert.match(store, /expiresAt\?: string/);
  assert.match(store, /replaceAuthTokensIfCurrent/);
  assert.match(store, /clearAuthTokensIfCurrent/);
  assert.match(authApi, /expiresAt:\s*result\.data\.expiresAt/);
  assert.match(demoApi, /expiresAt:\s*session\.expiresAt/);
  assert.match(lifecycle, /customerSessionFlights/);
  assert.match(lifecycle, /\/v1\/auth\/me/);
  assert.match(lifecycle, /\/v1\/auth\/refresh/);
  assert.match(lifecycle, /SESSION_REFRESH_LEEWAY_MS/);
  assert.match(lifecycle, /replaceAuthTokensIfCurrent/);
  assert.match(wrapper, /ensureCustomerSessionForUse/);
  assert.match(layout, /CustomerSessionBootstrap/);
  assert.match(layout, /AppState\.addEventListener/);
  const customerBootstrapIndex = layout.indexOf("function CustomerSessionBootstrap");
  const customerBootstrapReturnIndex = layout.indexOf("return children;", customerBootstrapIndex);
  const internalBootstrapIndex = layout.indexOf("function InternalCustomerSessionBootstrap");
  assert.ok(customerBootstrapIndex >= 0);
  assert.ok(customerBootstrapReturnIndex > customerBootstrapIndex);
  assert.ok(internalBootstrapIndex > customerBootstrapReturnIndex);
});
