const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_DRAW_SEQUENCE_SIZE = 20;

export type DrawOpenMode = "single" | "all";

export type DrawOpenModeDecision =
  | { kind: "direct"; mode: "single" }
  | { kind: "choose"; count: number };

type DrawOrderLine = {
  productId: string;
  category: string;
  quantity: number;
};

type DrawOrderSnapshot = {
  id: string;
  status: string;
  lines: readonly DrawOrderLine[];
  drawEntitlementIds?: readonly string[] | null;
};

export type VerifiedCommittedDrawBatch = {
  entitlementIds: string[];
  category: "gacha" | "kuji";
};

export type SequentialDrawOutcome<T> = {
  results: T[];
  remainingEntitlementIds: string[];
  error: unknown | null;
};

export function resolveDrawOpenModeDecision(count: number): DrawOpenModeDecision {
  const safeCount = Number.isSafeInteger(count) ? count : 0;
  return safeCount >= 2
    ? { kind: "choose", count: safeCount }
    : { kind: "direct", mode: "single" };
}

export function resolveDrawOpenMode(value: string | undefined, count: number): DrawOpenMode {
  return count >= 2 && value === "all" ? "all" : "single";
}

export function withDrawOpenMode(path: string, mode: DrawOpenMode): string {
  const [pathname, queryString = ""] = path.split("?", 2);
  const query = new URLSearchParams(queryString);
  query.set("mode", mode);
  return `${pathname}?${query.toString()}`;
}

export function drawEntitlementCountFromPath(path: string): number {
  const queryString = path.split("?", 2)[1] ?? "";
  const ids = new URLSearchParams(queryString).get("entitlementIds")
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean) ?? [];
  return ids.length <= MAX_DRAW_SEQUENCE_SIZE
    && ids.every((id) => UUID_PATTERN.test(id))
    && new Set(ids.map((id) => id.toLowerCase())).size === ids.length
    ? ids.length
    : 0;
}

/**
 * A route only expresses presentation intent. This check must succeed against the
 * authenticated order snapshot before a multi-result consume loop starts.
 */
export function verifyCommittedDrawBatch(
  order: DrawOrderSnapshot,
  expected: {
    orderId: string;
    productId: string;
    category?: "gacha" | "kuji";
    entitlementIds: readonly string[];
  },
): VerifiedCommittedDrawBatch {
  const routeIds = expected.entitlementIds.map((id) => id.trim());
  const routeIdentities = routeIds.map((id) => id.toLowerCase());
  const orderIds = order.drawEntitlementIds?.map((id) => id.trim()) ?? [];
  const orderIdentities = orderIds.map((id) => id.toLowerCase());
  const line = order.lines[0];
  if (
    order.id !== expected.orderId
    || (order.status !== "PAID" && order.status !== "FULFILLED")
    || order.lines.length !== 1
    || !line
    || line.productId !== expected.productId
    || (line.category !== "gacha" && line.category !== "kuji")
    || (expected.category !== undefined && line.category !== expected.category)
    || !Number.isSafeInteger(line.quantity)
    || line.quantity < 2
    || line.quantity > MAX_DRAW_SEQUENCE_SIZE
    || orderIds.length !== line.quantity
    || orderIds.some((id) => !UUID_PATTERN.test(id))
    || new Set(orderIdentities).size !== orderIds.length
    || routeIds.length < 2
    || routeIds.length > orderIds.length
    || routeIds.some((id) => !UUID_PATTERN.test(id))
    || new Set(routeIdentities).size !== routeIds.length
  ) {
    throw new Error("결제한 주문과 한 번에 열 추첨권 정보가 일치하지 않습니다.");
  }

  let previousIndex = -1;
  for (const identity of routeIdentities) {
    const index = orderIdentities.indexOf(identity);
    if (index <= previousIndex) {
      throw new Error("서버 주문의 추첨권 순서를 다시 확인해 주세요.");
    }
    previousIndex = index;
  }

  return { entitlementIds: routeIds, category: line.category };
}

/** Calls the existing idempotent single-entitlement endpoint strictly in order. */
export async function consumeDrawsSequentially<T>(
  entitlementIds: readonly string[],
  consume: (entitlementId: string, index: number) => Promise<T>,
): Promise<SequentialDrawOutcome<T>> {
  const results: T[] = [];
  for (const [index, entitlementId] of entitlementIds.entries()) {
    try {
      results.push(await consume(entitlementId, index));
    } catch (error) {
      return {
        results,
        remainingEntitlementIds: entitlementIds.slice(index),
        error,
      };
    }
  }
  return { results, remainingEntitlementIds: [], error: null };
}
