export const SOCIAL_LOGIN_ATTEMPT_TTL_MS = 10 * 60_000;
export const SOCIAL_LOGIN_CALLBACK_BASE_URL = "dabboba://auth/callback";

export type PendingSocialLogin = {
  version: 2;
  provider: "KAKAO" | "NAVER" | "GOOGLE" | "APPLE";
  returnTo: string;
  state: string;
  flowId: string;
  pkceVerifierKey: string;
  redirectTo: string;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
  acceptedPolicies: {
    terms: string;
    privacy: string;
  };
};

export type ValidatedSocialLoginCallback = {
  code: string;
  state: string;
  flowId: string;
  fingerprint: string;
};

export class SocialLoginCallbackError extends Error {
  readonly cleanupAttempt: boolean;

  constructor(message: string, cleanupAttempt: boolean) {
    super(message);
    this.name = "SocialLoginCallbackError";
    this.cleanupAttempt = cleanupAttempt;
  }
}

export function createPendingSocialLogin(input: {
  provider: PendingSocialLogin["provider"];
  returnTo: string;
  state: string;
  flowId: string;
  pkceVerifierKey: string;
  redirectTo: string;
  acceptedPolicies: PendingSocialLogin["acceptedPolicies"];
  nowMs: number;
}): PendingSocialLogin {
  return {
    version: 2,
    provider: input.provider,
    returnTo: input.returnTo,
    state: input.state,
    flowId: input.flowId,
    pkceVerifierKey: input.pkceVerifierKey,
    redirectTo: input.redirectTo,
    createdAt: input.nowMs,
    expiresAt: input.nowMs + SOCIAL_LOGIN_ATTEMPT_TTL_MS,
    consumedAt: null,
    acceptedPolicies: input.acceptedPolicies,
  };
}

export function parsePendingSocialLogin(raw: string | null): PendingSocialLogin | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (
    value.version !== 2
    || !isSocialProvider(value.provider)
    || !isBoundedString(value.returnTo, 1, 300)
    || !isBoundedString(value.state, 16, 128)
    || !isBoundedString(value.flowId, 16, 128)
    || !isBoundedString(value.pkceVerifierKey, 16, 300)
    || !isBoundedString(value.redirectTo, 1, 1_024)
    || !isSafeTimestamp(value.createdAt)
    || !isSafeTimestamp(value.expiresAt)
    || value.expiresAt <= value.createdAt
    || value.expiresAt - value.createdAt > SOCIAL_LOGIN_ATTEMPT_TTL_MS
    || (value.consumedAt !== null && !isSafeTimestamp(value.consumedAt))
    || !isAcceptedPolicies(value.acceptedPolicies)
  ) {
    return null;
  }
  return value as PendingSocialLogin;
}

export function validateSocialLoginCallback(
  resultUrl: string,
  pending: PendingSocialLogin,
  nowMs: number,
): ValidatedSocialLoginCallback {
  if (pending.expiresAt <= nowMs) {
    throw new SocialLoginCallbackError("로그인 요청 시간이 만료되었습니다. 다시 시도해 주세요.", true);
  }
  if (pending.consumedAt !== null) {
    throw new SocialLoginCallbackError("로그인 요청이 이미 사용되었습니다. 다시 시도해 주세요.", true);
  }

  const callback = parseCallbackUrl(resultUrl);
  const expected = parseCallbackUrl(pending.redirectTo);
  if (
    callback.protocol !== expected.protocol
    || callback.host !== expected.host
    || callback.pathname !== expected.pathname
    || callback.hash
  ) {
    throw new SocialLoginCallbackError("로그인 응답 주소를 확인하지 못했습니다.", false);
  }

  const callbackState = readSingleParameter(callback, "state", 128);
  if (callbackState !== pending.state) {
    throw new SocialLoginCallbackError("로그인 요청 확인값이 일치하지 않습니다.", false);
  }
  const callbackFlowId = readSingleParameter(callback, "sb_flow_id", 128);
  if (callbackFlowId !== pending.flowId) {
    throw new SocialLoginCallbackError("로그인 보안 정보를 확인하지 못했습니다.", false);
  }

  const callbackErrors = [
    ...callback.searchParams.getAll("error"),
    ...callback.searchParams.getAll("error_description"),
  ];
  if (callbackErrors.length > 0) {
    throw new SocialLoginCallbackError("로그인을 완료하지 못했습니다.", true);
  }

  const code = readSingleParameter(callback, "code", 2_048);
  return {
    code,
    state: callbackState,
    flowId: callbackFlowId,
    fingerprint: `${callbackState}:${callbackFlowId}:${code}`,
  };
}

export function socialLoginCallbackFingerprint(resultUrl: string): string {
  const callback = parseCallbackUrl(resultUrl);
  const state = readSingleParameter(callback, "state", 128);
  const flowId = readSingleParameter(callback, "sb_flow_id", 128);
  const codes = callback.searchParams.getAll("code");
  const errors = callback.searchParams.getAll("error");
  const value = codes.length === 1 && codes[0]
    ? `code:${codes[0]}`
    : errors.length === 1 && errors[0]
      ? `error:${errors[0]}`
      : "invalid";
  return `${state}:${flowId}:${value}`;
}

export function buildSocialLoginCallbackUrl(
  params: Record<string, string | string[] | undefined>,
): string {
  const query = new URLSearchParams();
  for (const key of ["code", "state", "sb_flow_id", "error", "error_description"] as const) {
    const values = Array.isArray(params[key]) ? params[key] : [params[key]];
    for (const value of values) {
      if (typeof value === "string") query.append(key, value);
    }
  }
  const serialized = query.toString();
  return serialized ? `${SOCIAL_LOGIN_CALLBACK_BASE_URL}?${serialized}` : SOCIAL_LOGIN_CALLBACK_BASE_URL;
}

function parseCallbackUrl(value: string): URL {
  if (typeof value !== "string" || value.length > 4_096) {
    throw new SocialLoginCallbackError("로그인 응답 주소를 확인하지 못했습니다.", false);
  }
  try {
    return new URL(value);
  } catch {
    throw new SocialLoginCallbackError("로그인 응답 주소를 확인하지 못했습니다.", false);
  }
}

function readSingleParameter(url: URL, key: string, maxLength: number): string {
  const values = url.searchParams.getAll(key);
  if (values.length !== 1 || !values[0] || values[0].length > maxLength) {
    throw new SocialLoginCallbackError("로그인 응답 정보를 확인하지 못했습니다.", false);
  }
  return values[0];
}

function isSocialProvider(value: unknown): value is PendingSocialLogin["provider"] {
  return value === "KAKAO" || value === "NAVER" || value === "GOOGLE" || value === "APPLE";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.length >= min && value.length <= max;
}

function isSafeTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isAcceptedPolicies(value: unknown): value is PendingSocialLogin["acceptedPolicies"] {
  if (!isRecord(value)) return false;
  return isBoundedString(value.terms, 1, 100) && isBoundedString(value.privacy, 1, 100);
}
