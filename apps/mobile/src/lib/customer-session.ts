import {
  clearAuthTokensIfCurrent,
  readAuthTokens,
  replaceAuthTokensIfCurrent,
  type StoredAuthTokens,
} from "@/lib/session-store";

export const SESSION_REFRESH_LEEWAY_MS = 5 * 60_000;
const SESSION_VALIDATION_INTERVAL_MS = 5 * 60_000;
const SESSION_REQUEST_TIMEOUT_MS = 8_000;

type CustomerSessionOptions = {
  forceValidation?: boolean;
  nowMs?: number;
};

type SessionPayload = {
  expiresAt: string;
};

type RefreshPayload = SessionPayload & {
  token: string;
};

export class CustomerSessionTemporarilyUnavailableError extends Error {
  constructor(message = "로그인 상태를 확인하지 못했습니다.") {
    super(message);
    this.name = "CustomerSessionTemporarilyUnavailableError";
  }
}

const customerSessionFlights = new Map<string, Promise<StoredAuthTokens | null>>();
let lastValidatedAccessToken: string | null = null;
let lastValidatedAt = 0;

export async function restoreCustomerSession(apiBaseUrl: string): Promise<StoredAuthTokens | null> {
  return ensureCustomerSession(apiBaseUrl, { forceValidation: true });
}

export async function ensureCustomerSessionForUse(apiBaseUrl: string): Promise<StoredAuthTokens | null> {
  const stored = await readAuthTokens();
  if (!stored) return null;
  try {
    return await ensureCustomerSession(apiBaseUrl);
  } catch (error) {
    if (error instanceof CustomerSessionTemporarilyUnavailableError) {
      // Preserve a still-current session during a temporary network failure.
      // The feature request that follows remains the source of truth and can
      // render its ordinary retryable error rather than silently signing out.
      const current = await readAuthTokens();
      return current?.accessToken === stored.accessToken ? current : null;
    }
    throw error;
  }
}

export function forgetCustomerSessionValidation(accessToken?: string): void {
  if (accessToken && accessToken !== lastValidatedAccessToken) return;
  lastValidatedAccessToken = null;
  lastValidatedAt = 0;
}

async function ensureCustomerSession(
  apiBaseUrl: string,
  options: CustomerSessionOptions = {},
): Promise<StoredAuthTokens | null> {
  const snapshot = await readAuthTokens();
  if (!snapshot) return null;

  const existing = customerSessionFlights.get(snapshot.accessToken);
  if (existing) return existing;

  const flight = validateOrRotateSession(apiBaseUrl, snapshot, options)
    .finally(() => {
      if (customerSessionFlights.get(snapshot.accessToken) === flight) {
        customerSessionFlights.delete(snapshot.accessToken);
      }
    });
  customerSessionFlights.set(snapshot.accessToken, flight);
  return flight;
}

async function validateOrRotateSession(
  apiBaseUrl: string,
  snapshot: StoredAuthTokens,
  options: CustomerSessionOptions,
): Promise<StoredAuthTokens | null> {
  const nowMs = options.nowMs ?? Date.now();
  const expiresAtMs = parseExpiry(snapshot.expiresAt);
  if (expiresAtMs !== null && expiresAtMs <= nowMs) {
    await clearAuthTokensIfCurrent(snapshot);
    forgetCustomerSessionValidation(snapshot.accessToken);
    return null;
  }

  if (expiresAtMs !== null && expiresAtMs - nowMs <= SESSION_REFRESH_LEEWAY_MS) {
    return rotateCustomerSession(apiBaseUrl, snapshot);
  }

  const validatedRecently = lastValidatedAccessToken === snapshot.accessToken
    && nowMs - lastValidatedAt < SESSION_VALIDATION_INTERVAL_MS;
  if (!options.forceValidation && validatedRecently && expiresAtMs !== null) {
    return snapshot;
  }

  return validateCustomerSession(apiBaseUrl, snapshot, nowMs);
}

async function validateCustomerSession(
  apiBaseUrl: string,
  snapshot: StoredAuthTokens,
  nowMs: number,
): Promise<StoredAuthTokens | null> {
  const response = await sessionRequest(apiBaseUrl, "/v1/auth/me", "GET", snapshot.accessToken);
  if (response.status === 401) {
    await clearAuthTokensIfCurrent(snapshot);
    forgetCustomerSessionValidation(snapshot.accessToken);
    return null;
  }
  if (!response.ok) throw new CustomerSessionTemporarilyUnavailableError();

  const body = await safeJson(response);
  const payload = parseMePayload(body);
  const next: StoredAuthTokens = { ...snapshot, expiresAt: payload.expiresAt };
  const stored = await replaceAuthTokensIfCurrent(snapshot, next);
  if (stored?.accessToken === snapshot.accessToken) {
    lastValidatedAccessToken = snapshot.accessToken;
    lastValidatedAt = nowMs;
  }
  return stored;
}

async function rotateCustomerSession(
  apiBaseUrl: string,
  snapshot: StoredAuthTokens,
): Promise<StoredAuthTokens | null> {
  const response = await sessionRequest(apiBaseUrl, "/v1/auth/refresh", "POST", snapshot.refreshToken);
  if (response.status === 401) {
    await clearAuthTokensIfCurrent(snapshot);
    forgetCustomerSessionValidation(snapshot.accessToken);
    return null;
  }
  if (!response.ok) throw new CustomerSessionTemporarilyUnavailableError("로그인 갱신 상태를 확인하지 못했습니다.");

  const payload = parseRefreshPayload(await safeJson(response));
  const next: StoredAuthTokens = {
    accessToken: payload.token,
    refreshToken: payload.token,
    expiresAt: payload.expiresAt,
  };
  const stored = await replaceAuthTokensIfCurrent(snapshot, next);
  if (stored?.accessToken === payload.token) {
    lastValidatedAccessToken = payload.token;
    lastValidatedAt = Date.now();
  }
  return stored;
}

async function sessionRequest(
  apiBaseUrl: string,
  path: "/v1/auth/me" | "/v1/auth/refresh",
  method: "GET" | "POST",
  token: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SESSION_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${apiBaseUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });
  } catch {
    throw new CustomerSessionTemporarilyUnavailableError();
  } finally {
    clearTimeout(timeout);
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new CustomerSessionTemporarilyUnavailableError("로그인 응답을 확인하지 못했습니다.");
  }
}

function parseMePayload(value: unknown): SessionPayload {
  if (!isRecord(value) || !isRecord(value.session) || !validExpiry(value.session.expiresAt)) {
    throw new CustomerSessionTemporarilyUnavailableError("로그인 응답을 확인하지 못했습니다.");
  }
  return { expiresAt: value.session.expiresAt };
}

function parseRefreshPayload(value: unknown): RefreshPayload {
  if (!isRecord(value) || !validToken(value.token) || !validExpiry(value.expiresAt)) {
    throw new CustomerSessionTemporarilyUnavailableError("로그인 갱신 응답을 확인하지 못했습니다.");
  }
  return { token: value.token, expiresAt: value.expiresAt };
}

function parseExpiry(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validExpiry(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function validToken(value: unknown): value is string {
  return typeof value === "string" && value.length >= 16 && value.length <= 4_096;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
