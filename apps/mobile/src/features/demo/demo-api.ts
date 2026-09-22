import type { components } from "@dabboba/contracts";
import {
  clearAuthTokens,
  readAuthTokens,
  type StoredAuthTokens,
  writeAuthTokens,
} from "@/lib/session-store";

export type DemoPaymentAction = "approve" | "fail" | "cancel" | "refund";
export type DemoCapabilities = {
  enabled: true;
  profile: "supabase-demo";
  paymentProvider: "TEST_PG";
  actions: ["approve", "fail", "cancel", "refund"];
};
export type InternalCustomerSession = {
  token: string;
  expiresAt: string;
  actor: {
    userId: string;
    email: string;
    nickname: string;
    role: string;
    status: string;
    sessionId: string;
  };
};

type CheckoutOrder = components["schemas"]["Order"];

const INTERNAL_CUSTOMER_ID = "da000000-0000-4000-8000-00000000000a";

export class TemporaryDemoCapabilityError extends Error {
  constructor() {
    super("테스트 기능 연결 상태를 확인하지 못했습니다.");
    this.name = "TemporaryDemoCapabilityError";
  }
}

export async function fetchDemoCapabilities(apiBaseUrl: string): Promise<DemoCapabilities | null> {
  let response: Response;
  try {
    response = await fetch(apiUrl(apiBaseUrl, "/v1/demo/capabilities"), {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new TemporaryDemoCapabilityError();
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    if (response.status === 429 || response.status >= 500) {
      throw new TemporaryDemoCapabilityError();
    }
    throw new Error("테스트 기능을 사용할 수 없는 서버입니다.");
  }
  return parseDemoCapabilities(await response.json());
}

export async function ensureInternalCustomerSession(
  apiBaseUrl: string,
  isCurrent: () => boolean = () => true,
): Promise<StoredAuthTokens | null> {
  if (!__DEV__) return null;
  const capabilities = await fetchDemoCapabilities(apiBaseUrl);
  if (!capabilities) return null;

  const stored = await readAuthTokens();
  if (stored) {
    const storedSessionState = await readStoredInternalCustomerSession(
      apiBaseUrl,
      stored.accessToken,
    );
    if (!isCurrent()) throw new Error("로그인 화면이 변경되었습니다.");
    if (storedSessionState === "current") return stored;
    await clearAuthTokens();
    if (!isCurrent()) throw new Error("로그인 화면이 변경되었습니다.");
  }

  if (!isCurrent()) throw new Error("로그인 화면이 변경되었습니다.");
  const response = await fetch(apiUrl(apiBaseUrl, "/v1/demo/session"), {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(await responseMessage(response, "로그인 정보를 불러오지 못했습니다."));
  }
  const session = parseInternalCustomerSession(await response.json());
  if (!isCurrent()) throw new Error("로그인 화면이 변경되었습니다.");
  const tokens = {
    accessToken: session.token,
    refreshToken: session.token,
    expiresAt: session.expiresAt,
  };
  await writeAuthTokens(tokens);
  return tokens;
}

export async function transitionDemoPayment(
  apiBaseUrl: string,
  accessToken: string,
  orderId: string,
  action: DemoPaymentAction,
): Promise<CheckoutOrder> {
  await requireDemoCapabilities(apiBaseUrl);
  const response = await fetch(
    apiUrl(apiBaseUrl, `/v1/demo/payments/${encodeURIComponent(orderId)}/transition`),
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Idempotency-Key": demoPaymentTransitionIdempotencyKey(orderId, action),
      },
      body: JSON.stringify({ action }),
    },
  );
  if (!response.ok) throw new Error(await responseMessage(response, "테스트 결제 상태를 바꾸지 못했습니다."));
  return parseCheckoutOrder(await response.json(), orderId);
}

async function requireDemoCapabilities(apiBaseUrl: string): Promise<DemoCapabilities> {
  if (!__DEV__) throw new Error("테스트 기능은 개발 빌드에서만 사용할 수 있습니다.");
  const capabilities = await fetchDemoCapabilities(apiBaseUrl);
  if (!capabilities) throw new Error("테스트 기능을 사용할 수 없는 서버입니다.");
  return capabilities;
}

export async function sessionStillCurrent(accessToken: string): Promise<boolean> {
  return (await readAuthTokens())?.accessToken === accessToken;
}

export function demoPaymentTransitionIdempotencyKey(
  orderId: string,
  action: DemoPaymentAction,
): string {
  return `demo-payment-${action}-${orderId}`;
}

export function demoPaymentActionsForStatus(status: string): DemoPaymentAction[] {
  if (status === "PENDING_PAYMENT") return ["approve", "fail", "cancel"];
  if (status === "PAID") return ["refund"];
  return [];
}

function parseDemoCapabilities(value: unknown): DemoCapabilities {
  if (!isRecord(value)) throw new Error("테스트 기능 응답 형식이 올바르지 않습니다.");
  if (
    value.enabled !== true
    || value.profile !== "supabase-demo"
    || value.paymentProvider !== "TEST_PG"
    || "accounts" in value
    || !isExactArray(value.actions, ["approve", "fail", "cancel", "refund"])
  ) {
    throw new Error("테스트 기능 응답 형식이 올바르지 않습니다.");
  }
  return value as DemoCapabilities;
}

function parseInternalCustomerSession(value: unknown): InternalCustomerSession {
  if (!isRecord(value) || !isRecord(value.actor)) {
    throw new Error("로그인 응답 형식이 올바르지 않습니다.");
  }
  const actor = value.actor;
  for (const field of ["token", "expiresAt"] as const) {
    if (typeof value[field] !== "string" || !value[field]) {
      throw new Error("로그인 응답 형식이 올바르지 않습니다.");
    }
  }
  for (const field of ["userId", "email", "nickname", "role", "status", "sessionId"] as const) {
    if (typeof actor[field] !== "string" || !actor[field]) {
      throw new Error("로그인 응답 형식이 올바르지 않습니다.");
    }
  }
  const expiresAt = value.expiresAt;
  if (typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))) {
    throw new Error("로그인 만료 시간을 확인할 수 없습니다.");
  }
  if (
    actor.userId !== INTERNAL_CUSTOMER_ID
    || !isNonBlankString(actor.email)
    || !isNonBlankString(actor.nickname)
    || actor.role !== "USER"
    || actor.status !== "ACTIVE"
  ) {
    throw new Error("고객 로그인 응답을 안전하게 확인하지 못했습니다.");
  }
  return value as InternalCustomerSession;
}

async function readStoredInternalCustomerSession(
  apiBaseUrl: string,
  accessToken: string,
): Promise<"current" | "replace"> {
  const response = await fetch(apiUrl(apiBaseUrl, "/v1/auth/me"), {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (response.status === 401) return "replace";
  if (!response.ok) throw new Error("로그인 상태를 확인하지 못했습니다.");
  const body = await response.json() as unknown;
  if (!isRecord(body) || !isRecord(body.actor)) {
    throw new Error("로그인 상태 응답 형식이 올바르지 않습니다.");
  }
  const actor = body.actor;
  if (
    actor.userId === INTERNAL_CUSTOMER_ID
    && isNonBlankString(actor.email)
    && isNonBlankString(actor.nickname)
    && actor.role === "USER"
    && actor.status === "ACTIVE"
  ) {
    return "current";
  }
  return "replace";
}

function parseCheckoutOrder(value: unknown, orderId: string): CheckoutOrder {
  if (!isRecord(value) || value.id !== orderId || typeof value.status !== "string") {
    throw new Error("테스트 주문 응답 형식이 올바르지 않습니다.");
  }
  return value as CheckoutOrder;
}

function apiUrl(apiBaseUrl: string, path: string): string {
  return `${apiBaseUrl.replace(/\/+$/, "")}${path}`;
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as unknown;
    if (isRecord(body) && typeof body.message === "string" && body.message.trim()) {
      return body.message;
    }
  } catch {
    // The fallback is intentionally generic; server bodies are not trusted UI.
  }
  return fallback;
}

function isExactArray(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((item, index) => item === expected[index]);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
