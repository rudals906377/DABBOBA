import "react-native-url-polyfill/auto";

import * as AuthSession from "expo-auth-session";
import * as ExpoCrypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import {
  createClient,
  type Provider,
  type SupabaseClient,
} from "@supabase/supabase-js";

WebBrowser.maybeCompleteAuthSession();

const BROKER_STORAGE_KEY = "dabboba.auth.broker";

export type DabbobaLoginProvider = "KAKAO" | "NAVER" | "PHONE";

export type SupabaseBrokerConfig = {
  url: string;
  publishableKey: string;
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

export function normalizeKoreanMobileNumber(value: string): string {
  const compact = value.replace(/[\s()-]/g, "");
  if (/^010\d{8}$/.test(compact)) return `+82${compact.slice(1)}`;
  if (/^\+8210\d{8}$/.test(compact)) return compact;
  throw new Error("010으로 시작하는 휴대폰번호 11자리를 입력해 주세요.");
}

export async function beginSocialLogin(provider: Exclude<DabbobaLoginProvider, "PHONE">): Promise<string> {
  const client = requireBrokerClient();
  const redirectTo = AuthSession.makeRedirectUri({ scheme: "dabboba", path: "auth/callback" });
  const supabaseProvider: Provider = provider === "KAKAO" ? "kakao" : "custom:naver";
  const { data, error } = await withSecurePkceRuntime(() => client.auth.signInWithOAuth({
    provider: supabaseProvider,
    options: { redirectTo, skipBrowserRedirect: true },
  }));
  if (error || !data.url) throw new Error(error?.message || "로그인 페이지를 열지 못했습니다.");

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== "success") {
    throw new Error(result.type === "cancel" || result.type === "dismiss"
      ? "로그인이 취소되었습니다."
      : "로그인 응답을 확인하지 못했습니다.");
  }

  const callback = new URL(result.url);
  const providerError = callback.searchParams.get("error_description") || callback.searchParams.get("error");
  if (providerError) throw new Error(providerError);
  const code = callback.searchParams.get("code");
  if (!code) throw new Error("로그인 인증 코드를 확인하지 못했습니다.");

  const exchanged = await client.auth.exchangeCodeForSession(code);
  if (exchanged.error || !exchanged.data.session?.access_token) {
    throw new Error(exchanged.error?.message || "로그인 세션을 확인하지 못했습니다.");
  }
  return exchanged.data.session.access_token;
}

export async function requestPhoneOtp(value: string): Promise<string> {
  const phone = normalizeKoreanMobileNumber(value);
  const client = requireBrokerClient();
  const result = await client.auth.signInWithOtp({
    phone,
    options: { channel: "sms", shouldCreateUser: true },
  });
  if (result.error) throw new Error(result.error.message);
  return phone;
}

export async function verifyPhoneOtp(phone: string, token: string): Promise<string> {
  if (!/^\d{6}$/.test(token)) throw new Error("인증번호 6자리를 입력해 주세요.");
  const client = requireBrokerClient();
  const result = await client.auth.verifyOtp({ phone, token, type: "sms" });
  if (result.error || !result.data.session?.access_token) {
    throw new Error(result.error?.message || "인증번호를 확인하지 못했습니다.");
  }
  return result.data.session.access_token;
}

export async function clearBrokerSession(): Promise<void> {
  if (!brokerClient) return;
  await brokerClient.auth.signOut({ scope: "local" }).catch(() => undefined);
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
        flowType: "pkce",
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
    brokerClientKey = key;
  }
  return brokerClient;
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
