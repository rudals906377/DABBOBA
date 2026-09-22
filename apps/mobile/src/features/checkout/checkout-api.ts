import { randomUUID } from "expo-crypto";
import type { SQLiteDatabase } from "expo-sqlite";
import { errorMessage } from "@dabboba/api-client";
import type { components } from "@dabboba/contracts";
import {
  attachOrderToGachaCheckoutIntent,
  matchesGachaCheckoutOrderIntent,
  paidGachaOrderEntitlementIdsForIntent,
  parseGachaCheckoutOrderIntent,
  resolveGachaCheckoutOrderIntent,
  serializeGachaCheckoutOrderIntent,
  type GachaCheckoutIntentResolution,
  type GachaCheckoutOrderIntent,
  type GachaCheckoutOrderPayload,
} from "@/features/checkout/gacha-checkout-intent";
import { createMobileDabbobaClient as createDabbobaClient } from "@/lib/mobile-api-client";

export type CheckoutOrder = components["schemas"]["Order"];

export type CreateKujiCheckoutOrderInput = {
  productId: string;
  quantity: number;
  expectedDrawVersion: number;
  pointAmount: number;
  kujiRoomEntryId: string;
};

export type CreateGachaCheckoutOrderInput = GachaCheckoutOrderPayload & {
  idempotencyKey: string;
};

const GACHA_CHECKOUT_INTENT_PREFERENCE_PREFIX = "checkout.gacha.pending-order.v1";

export class CheckoutOrderApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "CheckoutOrderApiError";
    this.status = status;
    this.code = code;
  }
}

export async function fetchCheckoutActorId(
  apiBaseUrl: string,
  accessToken: string,
): Promise<string> {
  const client = authorizedCheckoutClient(apiBaseUrl, accessToken);
  const result = await client.GET("/v1/account/profile");
  if (!result.data) {
    throw new CheckoutOrderApiError(
      errorMessage(result.error, "로그인 계정을 확인하지 못했습니다."),
      result.response.status,
      apiErrorCode(result.error),
    );
  }
  return result.data.id;
}

export async function fetchCheckoutPointBalance(
  apiBaseUrl: string,
  accessToken: string,
): Promise<number> {
  const client = authorizedCheckoutClient(apiBaseUrl, accessToken);
  const result = await client.GET("/v1/account/points", {
    params: { query: { limit: 1 } },
  });
  if (!result.data) {
    throw new Error(errorMessage(result.error, "포인트 정보를 불러오지 못했습니다."));
  }
  return Math.max(0, result.data.balance);
}

export async function createGachaCheckoutOrder(
  apiBaseUrl: string,
  accessToken: string,
  input: CreateGachaCheckoutOrderInput,
): Promise<CheckoutOrder> {
  const client = authorizedCheckoutClient(apiBaseUrl, accessToken);
  const result = await client.POST("/v1/orders", {
    params: { header: { "Idempotency-Key": input.idempotencyKey } },
    body: {
      items: [{
        productId: input.productId,
        quantity: input.quantity,
        expectedDrawVersion: input.expectedDrawVersion,
      }],
      pointAmount: input.pointAmount,
    },
  });
  if (!result.data) {
    throw new CheckoutOrderApiError(
      errorMessage(result.error, "가챠 주문을 접수하지 못했습니다."),
      result.response.status,
      apiErrorCode(result.error),
    );
  }
  return result.data;
}

export async function fetchCheckoutOrder(
  apiBaseUrl: string,
  accessToken: string,
  orderId: string,
): Promise<CheckoutOrder> {
  const client = authorizedCheckoutClient(apiBaseUrl, accessToken);
  const result = await client.GET("/v1/orders/{orderId}", {
    params: { path: { orderId } },
  });
  if (!result.data) {
    throw new CheckoutOrderApiError(
      errorMessage(result.error, "이전 가챠 주문 상태를 확인하지 못했습니다."),
      result.response.status,
      apiErrorCode(result.error),
    );
  }
  return result.data;
}

export async function confirmPortOnePayment(
  apiBaseUrl: string,
  accessToken: string,
  paymentId: string,
): Promise<{ accepted: boolean; paymentId: string; orderId: string; providerStatus: string; outcome: string }> {
  const response = await fetch(
    `${apiBaseUrl.replace(/\/$/, "")}/v1/payments/${encodeURIComponent(paymentId)}/confirm`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "x-request-id": randomUUID(),
      },
      body: "{}",
    },
  );
  const body = await response.json().catch(() => null) as {
    accepted?: unknown;
    paymentId?: unknown;
    orderId?: unknown;
    providerStatus?: unknown;
    outcome?: unknown;
    error?: { code?: unknown; message?: unknown };
  } | null;
  if (!response.ok || !body || body.accepted !== true) {
    throw new CheckoutOrderApiError(
      typeof body?.error?.message === "string"
        ? body.error.message
        : "결제 승인 상태를 확인하지 못했습니다.",
      response.status,
      typeof body?.error?.code === "string" ? body.error.code : null,
    );
  }
  if (
    typeof body.paymentId !== "string"
    || typeof body.orderId !== "string"
    || typeof body.providerStatus !== "string"
    || typeof body.outcome !== "string"
  ) {
    throw new CheckoutOrderApiError("결제 승인 응답 형식을 확인하지 못했습니다.", 502);
  }
  return {
    accepted: true,
    paymentId: body.paymentId,
    orderId: body.orderId,
    providerStatus: body.providerStatus,
    outcome: body.outcome,
  };
}

export async function createKujiCheckoutOrder(
  apiBaseUrl: string,
  accessToken: string,
  input: CreateKujiCheckoutOrderInput,
): Promise<CheckoutOrder> {
  const client = createDabbobaClient({
    baseUrl: apiBaseUrl,
    token: () => accessToken,
    requestId: randomUUID,
  });
  const result = await client.POST("/v1/orders", {
    params: {
      header: {
        "Idempotency-Key": kujiCheckoutOrderIdempotencyKey(input.kujiRoomEntryId),
      },
    },
    body: {
      items: [{
        productId: input.productId,
        quantity: input.quantity,
        expectedDrawVersion: input.expectedDrawVersion,
      }],
      pointAmount: input.pointAmount,
      kujiRoomEntryId: input.kujiRoomEntryId,
    },
  });
  if (!result.data) {
    throw new CheckoutOrderApiError(
      errorMessage(result.error, "쿠지 주문을 접수하지 못했습니다."),
      result.response.status,
    );
  }
  return result.data;
}

export async function claimPendingGachaCheckoutOrderIntent(
  db: SQLiteDatabase,
  input: {
    actorId: string;
    payload: GachaCheckoutOrderPayload;
  },
): Promise<GachaCheckoutIntentResolution> {
  const preferenceKey = gachaCheckoutIntentPreferenceKey(input.actorId, input.payload.productId);
  let resolution: GachaCheckoutIntentResolution | null = null;
  await db.withExclusiveTransactionAsync(async (transaction) => {
    const row = await transaction.getFirstAsync<{ preference_value: string }>(
      "SELECT preference_value FROM app_preferences WHERE preference_key = ?",
      preferenceKey,
    );
    const existing = row ? parseGachaCheckoutOrderIntent(row.preference_value) : null;
    if (row && !existing) {
      throw new Error("저장된 가챠 주문 요청을 안전하게 확인할 수 없습니다.");
    }
    assertGachaIntentScope(existing, input.actorId, input.payload.productId);
    resolution = resolveGachaCheckoutOrderIntent(existing, {
      actorId: input.actorId,
      payload: input.payload,
      createIdempotencyKey: () => `gacha-order-${randomUUID()}`,
      nowIso: new Date().toISOString(),
    });
    if (resolution.kind === "created") {
      await transaction.runAsync(
        `INSERT INTO app_preferences (preference_key, preference_value, updated_at)
         VALUES (?, ?, ?)`,
        preferenceKey,
        serializeGachaCheckoutOrderIntent(resolution.intent),
        resolution.intent.updatedAt,
      );
    }
  });
  if (!resolution) throw new Error("가챠 주문 요청을 저장하지 못했습니다.");
  return resolution;
}

export async function readPendingGachaCheckoutOrderIntent(
  db: SQLiteDatabase,
  input: { actorId: string; productId: string },
): Promise<GachaCheckoutOrderIntent | null> {
  const preferenceKey = gachaCheckoutIntentPreferenceKey(input.actorId, input.productId);
  const row = await db.getFirstAsync<{ preference_value: string }>(
    "SELECT preference_value FROM app_preferences WHERE preference_key = ?",
    preferenceKey,
  );
  if (!row) return null;
  const intent = parseGachaCheckoutOrderIntent(row.preference_value);
  if (!intent) {
    throw new Error("저장된 가챠 주문 요청을 안전하게 확인할 수 없습니다.");
  }
  assertGachaIntentScope(intent, input.actorId, input.productId);
  return intent;
}

export async function recordPendingGachaCheckoutOrder(
  db: SQLiteDatabase,
  intent: GachaCheckoutOrderIntent,
  order: CheckoutOrder,
): Promise<GachaCheckoutOrderIntent> {
  if (!matchesGachaCheckoutOrderIntent(order, intent)) {
    throw new Error("서버 주문이 현재 가챠 구매 요청과 일치하지 않습니다.");
  }
  const preferenceKey = gachaCheckoutIntentPreferenceKey(intent.actorId, intent.payload.productId);
  let recorded: GachaCheckoutOrderIntent | null = null;
  await db.withExclusiveTransactionAsync(async (transaction) => {
    const row = await transaction.getFirstAsync<{ preference_value: string }>(
      "SELECT preference_value FROM app_preferences WHERE preference_key = ?",
      preferenceKey,
    );
    const current = row ? parseGachaCheckoutOrderIntent(row.preference_value) : null;
    if (!current || current.idempotencyKey !== intent.idempotencyKey) {
      throw new Error("가챠 주문 응답을 현재 구매 요청에 연결하지 못했습니다.");
    }
    if (!matchesGachaCheckoutOrderIntent(order, current)) {
      throw new Error("서버 주문이 저장된 가챠 구매 요청과 일치하지 않습니다.");
    }
    recorded = attachOrderToGachaCheckoutIntent(
      current,
      { id: order.id, status: order.status },
      new Date().toISOString(),
    );
    await transaction.runAsync(
      `UPDATE app_preferences
          SET preference_value = ?, updated_at = ?
        WHERE preference_key = ?`,
      serializeGachaCheckoutOrderIntent(recorded),
      recorded.updatedAt,
      preferenceKey,
    );
  });
  if (!recorded) throw new Error("가챠 주문 응답을 저장하지 못했습니다.");
  return recorded;
}

export async function clearPendingGachaCheckoutOrderIntent(
  db: SQLiteDatabase,
  intent: GachaCheckoutOrderIntent,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const preferenceKey = gachaCheckoutIntentPreferenceKey(intent.actorId, intent.payload.productId);
  await db.withExclusiveTransactionAsync(async (transaction) => {
    const row = await transaction.getFirstAsync<{ preference_value: string }>(
      "SELECT preference_value FROM app_preferences WHERE preference_key = ?",
      preferenceKey,
    );
    if (!row || !isCurrent()) return;
    const current = parseGachaCheckoutOrderIntent(row.preference_value);
    if (
      !current
      || current.idempotencyKey !== intent.idempotencyKey
      || current.orderId !== intent.orderId
    ) {
      throw new Error("다른 가챠 주문 요청은 삭제할 수 없습니다.");
    }
    await transaction.runAsync(
      "DELETE FROM app_preferences WHERE preference_key = ?",
      preferenceKey,
    );
  });
}

/**
 * One room entry can create at most one kuji order. Keeping this key stable
 * makes a retry after a lost response replay the same server transaction.
 */
export function kujiCheckoutOrderIdempotencyKey(kujiRoomEntryId: string): string {
  return `kuji-order-${kujiRoomEntryId}`;
}

export function paidKujiOrderEntitlementIds(
  order: CheckoutOrder,
  expectedQuantity: number,
): string[] | null {
  if (order.status !== "PAID" && order.status !== "FULFILLED") return null;
  const entitlementIds = order.drawEntitlementIds ?? [];
  if (
    entitlementIds.length !== expectedQuantity
    || new Set(entitlementIds).size !== entitlementIds.length
    || entitlementIds.some((id) => !id.trim())
  ) {
    return null;
  }
  return entitlementIds;
}

export function paidGachaOrderEntitlementIds(
  order: CheckoutOrder,
  intent: GachaCheckoutOrderIntent,
): string[] | null {
  return paidGachaOrderEntitlementIdsForIntent(order, intent);
}

export function canRetireGachaIntentAfterCreateError(error: unknown): boolean {
  return error instanceof CheckoutOrderApiError
    && error.code === "PAYMENT_NOT_CONFIGURED";
}

function authorizedCheckoutClient(apiBaseUrl: string, accessToken: string) {
  return createDabbobaClient({
    baseUrl: apiBaseUrl,
    token: () => accessToken,
    requestId: randomUUID,
  });
}

function gachaCheckoutIntentPreferenceKey(actorId: string, productId: string): string {
  return `${GACHA_CHECKOUT_INTENT_PREFERENCE_PREFIX}.${actorId.toLowerCase()}.${encodeURIComponent(productId)}`;
}

function assertGachaIntentScope(
  intent: GachaCheckoutOrderIntent | null,
  actorId: string,
  productId: string,
): void {
  if (!intent) return;
  if (intent.actorId !== actorId.toLowerCase() || intent.payload.productId !== productId.trim()) {
    throw new Error("다른 계정이나 상품의 가챠 주문 요청은 재사용할 수 없습니다.");
  }
}

function apiErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const envelope = "error" in error ? (error as { error?: unknown }).error : null;
  if (!envelope || typeof envelope !== "object" || !("code" in envelope)) return null;
  const code = (envelope as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}
