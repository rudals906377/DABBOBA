const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{16,200}$/;

export const GACHA_CHECKOUT_INTENT_SCHEMA_VERSION = 1 as const;
export const GACHA_CHECKOUT_IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1_000;

export type GachaCheckoutOrderStatus =
  | "PENDING_PAYMENT"
  | "PAID"
  | "FULFILLED"
  | "CANCELLED"
  | "REFUND_REVIEW"
  | "REFUNDED";

export type GachaCheckoutOrderPayload = {
  productId: string;
  quantity: number;
  expectedDrawVersion: number;
  pointAmount: number;
};

export type GachaCheckoutOrderIntent = {
  schemaVersion: typeof GACHA_CHECKOUT_INTENT_SCHEMA_VERSION;
  actorId: string;
  idempotencyKey: string;
  payload: GachaCheckoutOrderPayload;
  orderId: string | null;
  orderStatus: GachaCheckoutOrderStatus | null;
  createdAt: string;
  updatedAt: string;
};

export type GachaCheckoutOrderSnapshot = {
  id: string;
  userId: string;
  status: GachaCheckoutOrderStatus;
  subtotal: number;
  discountTotal: number;
  pointTotal: number;
  total: number;
  lines: Array<{
    productId: string;
    category: string;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }>;
  drawEntitlementIds?: string[];
};

export type GachaCheckoutIntentResolution = {
  kind: "created" | "reused" | "payload-conflict";
  intent: GachaCheckoutOrderIntent;
};

const ORDER_STATUSES = new Set<GachaCheckoutOrderStatus>([
  "PENDING_PAYMENT",
  "PAID",
  "FULFILLED",
  "CANCELLED",
  "REFUND_REVIEW",
  "REFUNDED",
]);

export function createGachaCheckoutOrderIntent(
  actorId: string,
  payload: GachaCheckoutOrderPayload,
  idempotencyKey: string,
  nowIso: string,
): GachaCheckoutOrderIntent {
  const canonicalActorId = validUuid(actorId, "actorId");
  const canonicalPayload = canonicalGachaCheckoutOrderPayload(payload);
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new Error("가챠 주문 요청 키를 확인할 수 없어요.");
  }
  const timestamp = validIsoTimestamp(nowIso, "createdAt");
  return {
    schemaVersion: GACHA_CHECKOUT_INTENT_SCHEMA_VERSION,
    actorId: canonicalActorId,
    idempotencyKey,
    payload: canonicalPayload,
    orderId: null,
    orderStatus: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function resolveGachaCheckoutOrderIntent(
  existing: GachaCheckoutOrderIntent | null,
  input: {
    actorId: string;
    payload: GachaCheckoutOrderPayload;
    createIdempotencyKey: () => string;
    nowIso: string;
  },
): GachaCheckoutIntentResolution {
  const actorId = validUuid(input.actorId, "actorId");
  const payload = canonicalGachaCheckoutOrderPayload(input.payload);
  if (!existing) {
    return {
      kind: "created",
      intent: createGachaCheckoutOrderIntent(
        actorId,
        payload,
        input.createIdempotencyKey(),
        input.nowIso,
      ),
    };
  }
  if (existing.actorId !== actorId || existing.payload.productId !== payload.productId) {
    throw new Error("다른 계정이나 상품의 가챠 주문 요청은 재사용할 수 없어요.");
  }
  return {
    kind: sameGachaCheckoutOrderPayload(existing.payload, payload)
      ? "reused"
      : "payload-conflict",
    intent: existing,
  };
}

export function attachOrderToGachaCheckoutIntent(
  intent: GachaCheckoutOrderIntent,
  order: { id: string; status: GachaCheckoutOrderStatus },
  nowIso: string,
): GachaCheckoutOrderIntent {
  return {
    ...intent,
    orderId: validUuid(order.id, "orderId"),
    orderStatus: validOrderStatus(order.status),
    updatedAt: validIsoTimestamp(nowIso, "updatedAt"),
  };
}

export function parseGachaCheckoutOrderIntent(value: string): GachaCheckoutOrderIntent | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (parsed.schemaVersion !== GACHA_CHECKOUT_INTENT_SCHEMA_VERSION) return null;
    if (typeof parsed.actorId !== "string" || typeof parsed.idempotencyKey !== "string") return null;
    if (!isRecord(parsed.payload)) return null;
    const orderId = parsed.orderId;
    const orderStatus = parsed.orderStatus;
    if (!(orderId === null || typeof orderId === "string")) return null;
    if (!(orderStatus === null || typeof orderStatus === "string")) return null;
    if (typeof parsed.createdAt !== "string" || typeof parsed.updatedAt !== "string") return null;

    const intent = createGachaCheckoutOrderIntent(
      parsed.actorId,
      {
        productId: parsed.payload.productId as string,
        quantity: parsed.payload.quantity as number,
        expectedDrawVersion: parsed.payload.expectedDrawVersion as number,
        pointAmount: parsed.payload.pointAmount as number,
      },
      parsed.idempotencyKey,
      parsed.createdAt,
    );
    return {
      ...intent,
      orderId: orderId === null ? null : validUuid(orderId, "orderId"),
      orderStatus: orderStatus === null ? null : validOrderStatus(orderStatus),
      updatedAt: validIsoTimestamp(parsed.updatedAt, "updatedAt"),
    };
  } catch {
    return null;
  }
}

export function serializeGachaCheckoutOrderIntent(intent: GachaCheckoutOrderIntent): string {
  return JSON.stringify(intent);
}

export function gachaCheckoutOrderPayloadFingerprint(payload: GachaCheckoutOrderPayload): string {
  const canonical = canonicalGachaCheckoutOrderPayload(payload);
  return JSON.stringify([
    canonical.productId,
    canonical.quantity,
    canonical.expectedDrawVersion,
    canonical.pointAmount,
  ]);
}

export function sameGachaCheckoutOrderPayload(
  left: GachaCheckoutOrderPayload,
  right: GachaCheckoutOrderPayload,
): boolean {
  return gachaCheckoutOrderPayloadFingerprint(left) === gachaCheckoutOrderPayloadFingerprint(right);
}

export function canAutomaticallyReplayGachaOrderCreation(
  intent: GachaCheckoutOrderIntent,
  nowMs: number,
): boolean {
  if (intent.orderId) return false;
  const createdAtMs = Date.parse(intent.createdAt);
  const ageMs = nowMs - createdAtMs;
  return Number.isFinite(nowMs)
    && Number.isFinite(createdAtMs)
    && ageMs >= 0
    && ageMs < GACHA_CHECKOUT_IDEMPOTENCY_WINDOW_MS;
}

export function canRetireGachaCheckoutIntentForOrderStatus(
  status: GachaCheckoutOrderStatus,
): boolean {
  return status === "CANCELLED" || status === "REFUNDED";
}

/**
 * Fail closed before an order response is attached to a durable local intent.
 * The current Order response does not expose its immutable draw version, so
 * expectedDrawVersion remains protected by the original idempotent POST body
 * and the server's version check rather than a client-side response comparison.
 */
export function matchesGachaCheckoutOrderIntent(
  order: GachaCheckoutOrderSnapshot,
  intent: GachaCheckoutOrderIntent,
): boolean {
  if (!UUID_PATTERN.test(order.id) || !UUID_PATTERN.test(order.userId)) return false;
  if (order.userId.toLowerCase() !== intent.actorId) return false;
  if (intent.orderId && order.id.toLowerCase() !== intent.orderId) return false;
  if (!ORDER_STATUSES.has(order.status)) return false;
  if (!Array.isArray(order.lines) || order.lines.length !== 1) return false;

  const line = order.lines[0];
  if (
    !line
    || line.productId !== intent.payload.productId
    || line.category !== "gacha"
    || line.quantity !== intent.payload.quantity
    || order.pointTotal !== intent.payload.pointAmount
  ) {
    return false;
  }
  if (
    !isNonNegativeSafeInteger(line.unitPrice)
    || !isNonNegativeSafeInteger(line.lineTotal)
    || !isNonNegativeSafeInteger(order.subtotal)
    || !isNonNegativeSafeInteger(order.discountTotal)
    || !isNonNegativeSafeInteger(order.pointTotal)
    || !isNonNegativeSafeInteger(order.total)
  ) {
    return false;
  }
  return line.lineTotal === line.unitPrice * line.quantity
    && order.subtotal === line.lineTotal
    && order.discountTotal === 0
    && order.total === order.subtotal - order.pointTotal;
}

export function paidGachaOrderEntitlementIdsForIntent(
  order: GachaCheckoutOrderSnapshot,
  intent: GachaCheckoutOrderIntent,
): string[] | null {
  if (!matchesGachaCheckoutOrderIntent(order, intent)) return null;
  if (order.status !== "PAID" && order.status !== "FULFILLED") return null;
  const entitlementIds = order.drawEntitlementIds ?? [];
  if (
    !Array.isArray(entitlementIds)
    || entitlementIds.length !== intent.payload.quantity
    || new Set(entitlementIds.map((id) => id.toLowerCase())).size !== entitlementIds.length
    || entitlementIds.some((id) => !UUID_PATTERN.test(id))
  ) {
    return null;
  }
  return entitlementIds.map((id) => id.toLowerCase());
}

function canonicalGachaCheckoutOrderPayload(
  payload: GachaCheckoutOrderPayload,
): GachaCheckoutOrderPayload {
  if (!payload || typeof payload.productId !== "string") {
    throw new Error("가챠 주문 상품을 확인할 수 없어요.");
  }
  const productId = payload.productId.trim();
  if (!productId || productId.length > 120) {
    throw new Error("가챠 주문 상품을 확인할 수 없어요.");
  }
  if (!Number.isInteger(payload.quantity) || payload.quantity < 1 || payload.quantity > 20) {
    throw new Error("가챠 주문 수량을 확인할 수 없어요.");
  }
  if (!Number.isInteger(payload.expectedDrawVersion) || payload.expectedDrawVersion < 1) {
    throw new Error("가챠 구성 버전을 확인할 수 없어요.");
  }
  if (!Number.isInteger(payload.pointAmount) || payload.pointAmount < 0) {
    throw new Error("가챠 주문 포인트를 확인할 수 없어요.");
  }
  return {
    productId,
    quantity: payload.quantity,
    expectedDrawVersion: payload.expectedDrawVersion,
    pointAmount: payload.pointAmount,
  };
}

function validUuid(value: string, field: string): string {
  if (!UUID_PATTERN.test(value)) throw new Error(`가챠 주문 ${field} 값을 확인할 수 없어요.`);
  return value.toLowerCase();
}

function validIsoTimestamp(value: string, field: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) {
    throw new Error(`가챠 주문 ${field} 시간을 확인할 수 없어요.`);
  }
  return value;
}

function validOrderStatus(value: string): GachaCheckoutOrderStatus {
  if (!ORDER_STATUSES.has(value as GachaCheckoutOrderStatus)) {
    throw new Error("가챠 주문 상태를 확인할 수 없어요.");
  }
  return value as GachaCheckoutOrderStatus;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
