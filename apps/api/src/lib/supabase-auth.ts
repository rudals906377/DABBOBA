import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";
import { AppError, unauthorized } from "./errors.js";

export const CUSTOMER_AUTH_PROVIDERS = ["KAKAO", "NAVER", "PHONE"] as const;

export type CustomerAuthProvider = (typeof CUSTOMER_AUTH_PROVIDERS)[number];

export type SupabaseCustomerClaims = {
  issuer: string;
  subject: string;
  canonicalSubject: string;
  loginProvider: CustomerAuthProvider;
  providers: CustomerAuthProvider[];
  email: string | null;
  phoneE164: string | null;
};

export type SupabaseJwtVerificationOptions = {
  supabaseUrl: string;
  audience: string;
};

const remoteKeySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function metadataObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function mappedProvider(value: string): CustomerAuthProvider | null {
  switch (value.toLocaleLowerCase("en-US")) {
    case "kakao": return "KAKAO";
    case "custom:naver": return "NAVER";
    case "phone": return "PHONE";
    default: return null;
  }
}

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLocaleLowerCase("en-US");
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  return email;
}

function normalizedPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const phone = value.trim();
  return /^\+[1-9][0-9]{7,14}$/.test(phone) ? phone : null;
}

function canonicalSubject(issuer: string, subject: string): string {
  return `${issuer}#${subject}`;
}

export function mapSupabaseCustomerClaims(payload: JWTPayload): SupabaseCustomerClaims {
  if (
    typeof payload.iss !== "string"
    || payload.iss.length > 500
    || typeof payload.sub !== "string"
    || payload.sub.length < 1
    || payload.sub.length > 512
    || /[\u0000-\u001f\u007f]/.test(payload.sub)
  ) {
    throw unauthorized("로그인 인증 정보를 확인해 주세요.");
  }
  if (payload.role !== "authenticated" || payload.is_anonymous === true) {
    throw unauthorized("익명 또는 인증되지 않은 계정은 사용할 수 없습니다.");
  }

  const appMetadata = metadataObject(payload.app_metadata);
  const loginProvider = typeof appMetadata.provider === "string"
    ? mappedProvider(appMetadata.provider)
    : null;
  if (!loginProvider) {
    throw unauthorized("지원하지 않는 로그인 방식입니다.");
  }
  const rawProviders = [
    appMetadata.provider as string,
    ...(Array.isArray(appMetadata.providers)
      ? appMetadata.providers.filter((value): value is string => typeof value === "string")
      : []),
  ];
  const mappedProviders = rawProviders.map(mappedProvider);
  if (mappedProviders.some((provider) => provider === null)) {
    throw unauthorized("지원하지 않는 로그인 방식이 연결되어 있습니다.");
  }
  const providerSet = new Set(mappedProviders as CustomerAuthProvider[]);
  const providers = CUSTOMER_AUTH_PROVIDERS.filter((provider) => providerSet.has(provider));
  if (providers.length !== 1 || providers[0] !== loginProvider) {
    throw unauthorized("로그인 수단을 자동으로 합칠 수 없습니다. 고객센터에 문의해 주세요.");
  }
  const rawPhone = typeof payload.phone === "string" ? payload.phone.trim() : null;
  const phoneE164 = providers.includes("PHONE") ? normalizedPhone(rawPhone) : null;
  if (loginProvider === "PHONE" && !phoneE164) {
    throw unauthorized("휴대폰 인증 정보를 확인해 주세요.");
  }

  return {
    issuer: payload.iss,
    subject: payload.sub,
    canonicalSubject: canonicalSubject(payload.iss, payload.sub),
    loginProvider,
    providers,
    email: normalizedEmail(payload.email),
    phoneE164,
  };
}

function remoteKeySet(jwksUrl: string): ReturnType<typeof createRemoteJWKSet> {
  const existing = remoteKeySets.get(jwksUrl);
  if (existing) return existing;
  const created = createRemoteJWKSet(new URL(jwksUrl));
  remoteKeySets.set(jwksUrl, created);
  return created;
}

export async function verifySupabaseAccessToken(
  accessToken: string,
  options: SupabaseJwtVerificationOptions,
  keyResolver?: JWTVerifyGetKey,
): Promise<SupabaseCustomerClaims> {
  const supabaseUrl = options.supabaseUrl.replace(/\/$/, "");
  const issuer = `${supabaseUrl}/auth/v1`;
  const jwksUrl = `${issuer}/.well-known/jwks.json`;
  try {
    const verified = await jwtVerify(
      accessToken,
      keyResolver || remoteKeySet(jwksUrl),
      {
        algorithms: ["ES256", "RS256"],
        issuer,
        audience: options.audience,
        requiredClaims: ["iss", "sub", "aud", "exp", "role"],
      },
    );
    if (
      verified.payload.iss !== issuer
      || verified.payload.aud !== options.audience
      || verified.payload.role !== "authenticated"
      || verified.payload.is_anonymous === true
      || typeof verified.payload.exp !== "number"
    ) {
      throw unauthorized("로그인 인증 정보를 확인해 주세요.");
    }
    return mapSupabaseCustomerClaims(verified.payload);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw unauthorized("로그인 인증 정보가 만료되었거나 유효하지 않습니다.");
  }
}
