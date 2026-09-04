import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("native login exposes exactly Kakao, Naver, and Korean phone authentication", () => {
  const route = "apps/mobile/app/auth/login.tsx";
  assert.equal(existsSync(path.join(root, route)), true);

  const screen = read("apps/mobile/src/features/auth/LoginScreen.tsx");
  assert.match(screen, /카카오로 계속하기/);
  assert.match(screen, /네이버로 계속하기/);
  assert.match(screen, /휴대폰번호로 로그인/);
  assert.doesNotMatch(screen, /Google|구글|이메일로 로그인/);
  assert.match(screen, /exchangeBrokerSession/);
  assert.match(screen, /resolveAfterLoginPath/);
});

test("native test login is visible only in development and uses the non-production API session", () => {
  const screen = read("apps/mobile/src/features/auth/LoginScreen.tsx");
  const developmentSession = read("apps/mobile/src/lib/development-session.ts");
  const apiAuth = read("apps/api/src/modules/auth.ts");

  assert.match(screen, /__DEV__\s*\?/);
  assert.match(screen, /테스트 계정으로 로그인/);
  assert.match(screen, /ensureDevelopmentAuthSession\(runtime\.apiBaseUrl\)/);
  assert.match(developmentSession, /mobile-test@dabboba\.local/);
  assert.match(developmentSession, /\/v1\/auth\/dev-session/);
  assert.match(apiAuth, /developmentSessionEnabled\(\{/);
  assert.match(apiAuth, /DABBOBA_ENABLE_DEV_SESSION/);
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
  assert.match(api, /\/v1\/auth\/exchange/);
  assert.match(api, /requestId:\s*randomUUID/);
  assert.match(api, /writeAuthTokens/);
  assert.match(environment, /EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=/);
  assert.doesNotMatch(environment, /EXPO_PUBLIC_SUPABASE_SERVICE/);
});

test("phone login normalizes only Korean 010 mobile numbers before OTP", () => {
  const broker = read("apps/mobile/src/features/auth/supabase-broker.ts");
  assert.match(broker, /\^010\\d\{8\}\$/);
  assert.match(broker, /\^\\\+8210\\d\{8\}\$/);
  assert.match(broker, /signInWithOtp/);
  assert.match(broker, /verifyOtp/);
});

test("expired DABBOBA sessions are cleared before the profile retries as a guest", () => {
  const profileApi = read("apps/mobile/src/features/profile/profile-api.ts");
  const profileHook = read("apps/mobile/src/features/profile/use-profile-snapshot.ts");
  assert.match(profileApi, /class ProfileApiError/);
  assert.match(profileHook, /error\.status !== 401/);
  assert.match(profileHook, /clearAuthTokens\(\)/);
  assert.match(profileHook, /fetchProfileSnapshot\(runtime\.apiBaseUrl\)/);
});

test("mobile feature clients clear expired sessions and product detail observes the cleared state", () => {
  const wrapper = read("apps/mobile/src/lib/mobile-api-client.ts");
  assert.match(wrapper, /onUnauthorized:\s*clearExpiredCustomerSession/);
  assert.match(wrapper, /request\.headers\.get\("authorization"\)/);
  assert.match(wrapper, /current\?\.accessToken === failedAccessToken/);
  assert.match(wrapper, /clearAuthTokens\(\)/);
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
