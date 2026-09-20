import "react-native-url-polyfill/auto";

import * as AuthSession from "expo-auth-session";
import * as ExpoCrypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import {
  createClient,
  type Provider,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { resolveAfterLoginPath } from "@/features/auth/login-navigation";
import {
  createPendingSocialLogin,
  parsePendingSocialLogin,
  SOCIAL_LOGIN_ATTEMPT_TTL_MS,
  SocialLoginCallbackError,
  validateSocialLoginCallback,
  type PendingSocialLogin,
} from "@/features/auth/social-login-state";
import type { AcceptedPolicyVersions } from "@/features/auth/auth-api";

WebBrowser.maybeCompleteAuthSession();

const BROKER_STORAGE_KEY = "dabboba.auth.broker";
const PENDING_SOCIAL_LOGIN_KEY = "dabboba.auth.social-login.v1";
const PENDING_EMAIL_OTP_KEY = "dabboba.auth.email-otp.v1";
export const EMAIL_OTP_TTL_MS = 10 * 60_000;
export const EMAIL_OTP_RESEND_COOLDOWN_MS = 60_000;

export type DabbobaLoginProvider = "KAKAO" | "NAVER" | "GOOGLE" | "APPLE" | "EMAIL";
export type DabbobaSocialLoginProvider = Exclude<DabbobaLoginProvider, "EMAIL">;

export type SupabaseBrokerConfig = {
  url: string;
  publishableKey: string;
};

export type PendingEmailOtp = {
  email: string;
  requestedAt: number;
  expiresAt: number;
  resendAvailableAt: number;
};

let brokerClient: SupabaseClient | null = null;
let brokerClientKey = "";

export function resolveSupabaseBrokerConfig(): SupabaseBrokerConfig | null {
  const rawUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!rawUrl || !publishableKey) return null;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Supabase 로그인 주소 형식을 확인해 주세요.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Supabase 로그인 주소는 HTTPS origin만 사용할 수 있어요.");
  }
  if (publishableKey.length < 20) {
    throw new Error("Supabase publishable key를 확인해 주세요.");
  }
  if (/^sb_secret_/i.test(publishableKey) || legacyJwtRole(publishableKey) === "service_role") {
    throw new Error("앱에는 Supabase publishable key만 사용할 수 있어요.");
  }
  return { url: url.toString().replace(/\/$/, ""), publishableKey };
}

function legacyJwtRole(value: string): string | null {
  const payload = value.split(".")[1];
  if (!payload) return null;
  try {
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const decoded = JSON.parse(globalThis.atob(padded)) as { role?: unknown };
    return typeof decoded.role === "string" ? decoded.role : null;
  } catch {
    return null;
  }
}

export function normalizeEmailAddress(value: string): string {
  const email = value.trim().toLocaleLowerCase("en-US");
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("이메일 주소를 확인해 주세요.");
  }
  return email;
}

export type CompletedBrokerSocialLogin = {
  accessToken: string;
  provider: DabbobaSocialLoginProvider;
  appleRefreshToken?: string;
  returnTo: string;
  acceptedPolicies: AcceptedPolicyVersions;
};

export async function beginSocialLogin(
  provider: DabbobaSocialLoginProvider,
  returnTo: string,
  acceptedPolicies: AcceptedPolicyVersions,
): Promise<string> {
  await clearBrokerSession();
  const client = requireBrokerClient();
  const state = ExpoCrypto.randomUUID();
  const redirectTo = appendRedirectState(
    AuthSession.makeRedirectUri({ scheme: "dabboba", path: "auth/callback" }),
    state,
  );
  const providerMap: Record<DabbobaSocialLoginProvider, Provider> = {
    KAKAO: "kakao",
    NAVER: "custom:naver",
    GOOGLE: "google",
    APPLE: "apple",
  };
  const { data, error } = await withSecurePkceRuntime(() => client.auth.signInWithOAuth({
    provider: providerMap[provider],
    options: { redirectTo, skipBrowserRedirect: true },
  }));
  if (error || !data.url || !data.flowId) {
    await clearBrokerSession();
    throw new Error(error?.message || "로그인 페이지를 열지 못했습니다.");
  }

  const pkceVerifierKey = `${BROKER_STORAGE_KEY}-flow-${data.flowId}-code-verifier`;
  if (!await brokerSecureStorage.getItem(pkceVerifierKey)) {
    await clearBrokerSession();
    throw new Error("로그인 보안 정보를 저장하지 못했습니다.");
  }
  const pending = createPendingSocialLogin({
    provider,
    returnTo: String(resolveAfterLoginPath(returnTo)),
    state,
    flowId: data.flowId,
    pkceVerifierKey,
    redirectTo,
    acceptedPolicies,
    nowMs: Date.now(),
  });
  await SecureStore.setItemAsync(PENDING_SOCIAL_LOGIN_KEY, JSON.stringify(pending));

  let result: WebBrowser.WebBrowserAuthSessionResult;
  try {
    result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  } catch {
    await clearPendingSocialLogin(pending);
    throw new Error("로그인 페이지를 열지 못했습니다.");
  }
  if (result.type !== "success") {
    await clearPendingSocialLogin(pending);
    throw new Error(result.type === "cancel" || result.type === "dismiss"
      ? "로그인이 취소되었습니다."
      : "로그인 응답을 확인하지 못했습니다.");
  }
  return result.url;
}

export async function completeBrokerSocialLoginCallback(
  resultUrl: string,
): Promise<CompletedBrokerSocialLogin> {
  const rawPending = await SecureStore.getItemAsync(PENDING_SOCIAL_LOGIN_KEY);
  const pending = parsePendingSocialLogin(rawPending);
  if (!pending) {
    if (rawPending) await SecureStore.deleteItemAsync(PENDING_SOCIAL_LOGIN_KEY);
    throw new Error("로그인 요청을 찾지 못했습니다. 다시 시도해 주세요.");
  }

  let callback: ReturnType<typeof validateSocialLoginCallback>;
  try {
    callback = validateSocialLoginCallback(resultUrl, pending, Date.now());
  } catch (error) {
    if (error instanceof SocialLoginCallbackError && error.cleanupAttempt) {
      await clearPendingSocialLogin(pending);
    }
    throw error;
  }

  if (!await brokerSecureStorage.getItem(pending.pkceVerifierKey)) {
    await clearPendingSocialLogin(pending);
    throw new Error("로그인 보안 정보가 만료되었습니다. 다시 시도해 주세요.");
  }
  await SecureStore.setItemAsync(PENDING_SOCIAL_LOGIN_KEY, JSON.stringify({
    ...pending,
    consumedAt: Date.now(),
  } satisfies PendingSocialLogin));

  const client = requireBrokerClient();
  try {
    const exchanged = await client.auth.exchangeCodeForSession(callback.code, { flowId: callback.flowId });
    if (exchanged.error || !exchanged.data.session?.access_token) {
      throw new Error(exchanged.error?.message || "로그인 세션을 확인하지 못했습니다.");
    }
    const appleRefreshToken = pending.provider === "APPLE"
      ? exchanged.data.session.provider_refresh_token
      : undefined;
    if (pending.provider === "APPLE" && !appleRefreshToken) {
      throw new Error("Apple 계정 삭제 보호 정보를 받지 못했습니다. Apple 로그인을 다시 시도해 주세요.");
    }
    return {
      accessToken: exchanged.data.session.access_token,
      provider: pending.provider,
      ...(appleRefreshToken ? { appleRefreshToken } : {}),
      returnTo: pending.returnTo,
      acceptedPolicies: pending.acceptedPolicies,
    };
  } finally {
    await clearPendingSocialLogin(pending);
  }
}

export function readOAuthCallbackCode(resultUrl: string, redirectTo: string): string {
  let callback: URL;
  let expected: URL;
  try {
    callback = new URL(resultUrl);
    expected = new URL(redirectTo);
  } catch {
    throw new Error("로그인 응답 주소를 확인하지 못했습니다.");
  }
  if (
    callback.protocol !== expected.protocol
    || callback.host !== expected.host
    || callback.pathname !== expected.pathname
    || callback.hash
  ) {
    throw new Error("로그인 응답 주소를 확인하지 못했습니다.");
  }
  const errors = [...callback.searchParams.getAll("error"), ...callback.searchParams.getAll("error_description")];
  const codes = callback.searchParams.getAll("code");
  if (errors.length || codes.length !== 1 || !codes[0] || codes[0].length > 2_048) {
    throw new Error(errors.length ? "로그인을 완료하지 못했습니다." : "로그인 인증 코드를 확인하지 못했습니다.");
  }
  return codes[0];
}

export async function requestEmailOtp(value: string, nowMs = Date.now()): Promise<PendingEmailOtp> {
  const email = normalizeEmailAddress(value);
  const pending = await readPendingEmailOtp(nowMs);
  if (pending?.email === email && pending.resendAvailableAt > nowMs) {
    const seconds = Math.ceil((pending.resendAvailableAt - nowMs) / 1_000);
    throw new Error(`${seconds}초 후 인증번호를 다시 받을 수 있어요.`);
  }
  const client = requireBrokerClient();
  const result = await client.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (result.error) throw new Error(result.error.message);
  const next: PendingEmailOtp = {
    email,
    requestedAt: nowMs,
    expiresAt: nowMs + EMAIL_OTP_TTL_MS,
    resendAvailableAt: nowMs + EMAIL_OTP_RESEND_COOLDOWN_MS,
  };
  await SecureStore.setItemAsync(PENDING_EMAIL_OTP_KEY, JSON.stringify(next));
  return next;
}

export async function verifyEmailOtp(email: string, token: string): Promise<string> {
  if (!/^\d{6}$/.test(token)) throw new Error("인증번호 6자리를 입력해 주세요.");
  const client = requireBrokerClient();
  const result = await client.auth.verifyOtp({ email, token, type: "email" });
  if (result.error || !result.data.session?.access_token) {
    throw new Error(result.error?.message || "인증번호를 확인하지 못했습니다.");
  }
  await SecureStore.deleteItemAsync(PENDING_EMAIL_OTP_KEY).catch(() => undefined);
  return result.data.session.access_token;
}

export async function readPendingEmailOtp(nowMs = Date.now()): Promise<PendingEmailOtp | null> {
  const raw = await SecureStore.getItemAsync(PENDING_EMAIL_OTP_KEY);
  const pending = parsePendingEmailOtp(raw);
  if (!pending || pending.expiresAt <= nowMs) {
    if (raw) await SecureStore.deleteItemAsync(PENDING_EMAIL_OTP_KEY).catch(() => undefined);
    return null;
  }
  return pending;
}

export async function clearPendingEmailOtp(): Promise<void> {
  await SecureStore.deleteItemAsync(PENDING_EMAIL_OTP_KEY).catch(() => undefined);
}

export async function clearBrokerSession(): Promise<void> {
  const pending = parsePendingSocialLogin(await SecureStore.getItemAsync(PENDING_SOCIAL_LOGIN_KEY));
  if (pending) await brokerSecureStorage.removeItem(pending.pkceVerifierKey).catch(() => undefined);
  await SecureStore.deleteItemAsync(PENDING_SOCIAL_LOGIN_KEY).catch(() => undefined);
  await clearPendingEmailOtp();
  if (brokerClient) await brokerClient.auth.signOut({ scope: "local" }).catch(() => undefined);
}

export async function clearExpiredSocialLoginAttempt(nowMs = Date.now()): Promise<void> {
  const raw = await SecureStore.getItemAsync(PENDING_SOCIAL_LOGIN_KEY);
  if (!raw) return;
  const pending = parsePendingSocialLogin(raw);
  if (pending && pending.expiresAt > nowMs && pending.consumedAt === null) return;
  if (pending) await brokerSecureStorage.removeItem(pending.pkceVerifierKey).catch(() => undefined);
  await SecureStore.deleteItemAsync(PENDING_SOCIAL_LOGIN_KEY).catch(() => undefined);
  if (brokerClient) await brokerClient.auth.signOut({ scope: "local" }).catch(() => undefined);
}

function parsePendingEmailOtp(raw: string | null): PendingEmailOtp | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingEmailOtp>;
    if (
      typeof value.email !== "string"
      || typeof value.requestedAt !== "number"
      || typeof value.expiresAt !== "number"
      || typeof value.resendAvailableAt !== "number"
      || !Number.isSafeInteger(value.requestedAt)
      || !Number.isSafeInteger(value.expiresAt)
      || !Number.isSafeInteger(value.resendAvailableAt)
      || value.requestedAt <= 0
      || value.expiresAt <= value.requestedAt
      || value.expiresAt - value.requestedAt > EMAIL_OTP_TTL_MS
      || value.resendAvailableAt < value.requestedAt
      || value.resendAvailableAt - value.requestedAt > EMAIL_OTP_RESEND_COOLDOWN_MS
      || normalizeEmailAddress(value.email) !== value.email
    ) return null;
    return value as PendingEmailOtp;
  } catch {
    return null;
  }
}

function requireBrokerClient(): SupabaseClient {
  const config = resolveSupabaseBrokerConfig();
  if (!config) {
    throw new Error("로그인 서비스 연결 정보가 아직 설정되지 않았습니다.");
  }
  const key = `${config.url}|${config.publishableKey}`;
  if (!brokerClient || brokerClientKey !== key) {
    brokerClient = createClient(config.url, config.publishableKey, {
      auth: {
        storageKey: BROKER_STORAGE_KEY,
        storage: brokerSecureStorage,
        flowType: "pkce",
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
        experimental: { appendPkceFlowIdToRedirects: true },
      },
    });
    brokerClientKey = key;
  }
  return brokerClient;
}

const brokerSecureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

async function clearPendingSocialLogin(pending: PendingSocialLogin): Promise<void> {
  const current = parsePendingSocialLogin(await SecureStore.getItemAsync(PENDING_SOCIAL_LOGIN_KEY));
  if (current?.state === pending.state) {
    await SecureStore.deleteItemAsync(PENDING_SOCIAL_LOGIN_KEY).catch(() => undefined);
  }
  await brokerSecureStorage.removeItem(pending.pkceVerifierKey).catch(() => undefined);
  if (brokerClient) await brokerClient.auth.signOut({ scope: "local" }).catch(() => undefined);
}

function appendRedirectState(redirectTo: string, state: string): string {
  const url = new URL(redirectTo);
  url.searchParams.set("state", state);
  return url.toString();
}

async function withSecurePkceRuntime<T>(operation: () => Promise<T>): Promise<T> {
  const current = globalThis.crypto;
  if (typeof current?.getRandomValues === "function" && typeof current.subtle?.digest === "function") {
    return operation();
  }

  const previous = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const expoCrypto = {
    ...(current || {}),
    getRandomValues: ExpoCrypto.getRandomValues,
    randomUUID: ExpoCrypto.randomUUID,
    subtle: {
      ...(current?.subtle || {}),
      async digest(algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> {
        const name = typeof algorithm === "string" ? algorithm : algorithm.name;
        if (name.toUpperCase() !== "SHA-256") {
          throw new Error("지원하지 않는 PKCE 해시 알고리즘입니다.");
        }
        return ExpoCrypto.digest(ExpoCrypto.CryptoDigestAlgorithm.SHA256, data);
      },
    },
  } as Crypto;

  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    enumerable: previous?.enumerable ?? false,
    writable: true,
    value: expoCrypto,
  });
  try {
    return await operation();
  } finally {
    if (previous) Object.defineProperty(globalThis, "crypto", previous);
    else Reflect.deleteProperty(globalThis, "crypto");
  }
}
