import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";
import { AppError, unauthorized } from "./errors.js";

// EMAIL remains recognizable for existing linked identities, but is not a new login option.
export const CUSTOMER_AUTH_PROVIDERS = ["PHONE", "KAKAO", "NAVER", "GOOGLE", "APPLE", "EMAIL"] as const;
export const CUSTOMER_SUBJECT_LOOKUP_PROVIDERS = CUSTOMER_AUTH_PROVIDERS;

export type CustomerAuthProvider = (typeof CUSTOMER_AUTH_PROVIDERS)[number];

export type SupabaseCustomerClaims = {
  issuer: string;
  subject: string;
  canonicalSubject: string;
};

export type VerifiedSupabaseCustomer = SupabaseCustomerClaims & {
  providers: CustomerAuthProvider[];
  email: string | null;
  phone?: string | null;
  /** When the broker created this user, if the live record says so. */
  createdAt?: Date | null;
};

export type SupabaseJwtVerificationOptions = {
  supabaseUrl: string;
  audience: string;
};

export type SupabaseCustomerVerificationOptions = SupabaseJwtVerificationOptions & {
  publishableKey: string;
  fetch?: typeof globalThis.fetch;
};

const remoteKeySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function mappedProvider(value: string): CustomerAuthProvider | null {
  switch (value.toLocaleLowerCase("en-US")) {
    case "kakao": return "KAKAO";
    case "custom:naver": return "NAVER";
    case "google": return "GOOGLE";
    case "apple": return "APPLE";
    case "email": return "EMAIL";
    default: return null;
  }
}

function mappedLiveProvider(value: string): CustomerAuthProvider | null {
  if (value.toLocaleLowerCase("en-US") === "phone") return "PHONE";
  return mappedProvider(value);
}

function normalizedPhone(value: unknown): string | null {
  return typeof value === "string" && /^\+[1-9]\d{6,14}$/.test(value) ? value : null;
}

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLocaleLowerCase("en-US");
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  return email;
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

  return {
    issuer: payload.iss,
    subject: payload.sub,
    canonicalSubject: canonicalSubject(payload.iss, payload.sub),
  };
}

export async function readBoundedAuthJson(response: Response): Promise<unknown> {
  const limit = 65_536;
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw unauthorized("로그인 인증 정보를 확인해 주세요.");
  if (!response.body) throw unauthorized("로그인 인증 정보를 확인해 주세요.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw unauthorized("로그인 인증 정보를 확인해 주세요.");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw unauthorized("로그인 인증 정보를 확인해 주세요.");
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw unauthorized("로그인 인증 정보를 확인해 주세요.");
  }
  return value as Record<string, unknown>;
}

async function fetchLiveCustomer(
  accessToken: string,
  claims: SupabaseCustomerClaims,
  options: SupabaseCustomerVerificationOptions,
): Promise<VerifiedSupabaseCustomer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const request = options.fetch || globalThis.fetch;
    const response = await request(`${options.supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
      method: "GET",
      headers: {
        apikey: options.publishableKey,
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
      },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw unauthorized("로그인 인증 정보가 만료되었거나 유효하지 않습니다.");
    const user = objectValue(await readBoundedAuthJson(response));
    if (
      user.id !== claims.subject
      || user.role !== "authenticated"
      || user.is_anonymous === true
      || !Array.isArray(user.identities)
      || user.identities.length < 1
      || user.identities.length > 20
    ) {
      throw unauthorized("로그인 인증 정보를 확인해 주세요.");
    }

    const providerSet = new Set<CustomerAuthProvider>();
    for (const rawIdentity of user.identities) {
      const identity = objectValue(rawIdentity);
      const identityId = identity.identity_id;
      const provider = typeof identity.provider === "string" ? mappedLiveProvider(identity.provider) : null;
      if (
        typeof identityId !== "string"
        || identityId.length < 1
        || identityId.length > 512
        || (identity.user_id !== undefined && identity.user_id !== claims.subject)
        || !provider
      ) {
        throw unauthorized("지원하지 않는 로그인 방식이 연결되어 있습니다.");
      }
      providerSet.add(provider);
    }
    const providers = CUSTOMER_AUTH_PROVIDERS.filter((provider) => providerSet.has(provider));
    if (providers.length < 1) throw unauthorized("지원하는 로그인 방식을 확인해 주세요.");
    const emailConfirmedAt = typeof user.email_confirmed_at === "string"
      ? Date.parse(user.email_confirmed_at)
      : Number.NaN;
    const email = Number.isFinite(emailConfirmedAt) && emailConfirmedAt <= Date.now()
      ? normalizedEmail(user.email)
      : null;
    if (providers.includes("EMAIL") && !email) {
      throw unauthorized("이메일 인증 정보를 확인해 주세요.");
    }
    const phoneConfirmedAt = typeof user.phone_confirmed_at === "string"
      ? Date.parse(user.phone_confirmed_at)
      : Number.NaN;
    const phone = Number.isFinite(phoneConfirmedAt) && phoneConfirmedAt <= Date.now()
      ? normalizedPhone(user.phone)
      : null;
    if (providers.includes("PHONE") && !phone) {
      throw unauthorized("휴대폰 인증 정보를 확인해 주세요.");
    }
    const createdAtMs = typeof user.created_at === "string" ? Date.parse(user.created_at) : Number.NaN;
    const createdAt = Number.isFinite(createdAtMs) ? new Date(createdAtMs) : null;
    return { ...claims, providers, email, phone, createdAt };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw unauthorized("로그인 인증 정보를 확인하지 못했습니다.");
  } finally {
    clearTimeout(timeout);
  }
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

export async function verifySupabaseCustomerAccessToken(
  accessToken: string,
  options: SupabaseCustomerVerificationOptions,
  keyResolver?: JWTVerifyGetKey,
): Promise<VerifiedSupabaseCustomer> {
  const claims = await verifySupabaseAccessToken(accessToken, options, keyResolver);
  return fetchLiveCustomer(accessToken, claims, options);
}
