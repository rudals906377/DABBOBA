const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_DRAW_SEQUENCE_SIZE = 20;

export type CommittedDrawSequence = {
  entitlementIds: string[];
  activeIndex: number;
  activeEntitlementId: string | null;
  nextEntitlementId: string | null;
  total: number;
};

type CommittedDrawResultIdentity = {
  entitlementId: string;
  productId: string;
  kujiSlotNumber?: number;
};

type ExpectedDrawResultIdentity = {
  entitlementId: string;
  productId?: string;
  kujiSlotNumber?: number;
};

export function resolveCommittedDrawSequence(
  pathEntitlementId: string | undefined,
  encodedEntitlementIds: string | undefined,
): CommittedDrawSequence {
  const pathId = pathEntitlementId?.trim() ?? "";
  if (!UUID_PATTERN.test(pathId)) return emptySequence();

  const parsedIds = parseEntitlementIds(encodedEntitlementIds);
  const activeIndex = parsedIds.findIndex((id) => sameUuid(id, pathId));
  const entitlementIds = parsedIds.length > 0 && activeIndex >= 0
    ? parsedIds
    : [pathId];
  const safeActiveIndex = entitlementIds.findIndex((id) => sameUuid(id, pathId));

  return {
    entitlementIds,
    activeIndex: safeActiveIndex,
    activeEntitlementId: entitlementIds[safeActiveIndex] ?? null,
    nextEntitlementId: entitlementIds[safeActiveIndex + 1] ?? null,
    total: entitlementIds.length,
  };
}

export function assertCommittedDrawResultMatchesRoute(
  result: CommittedDrawResultIdentity,
  expected: ExpectedDrawResultIdentity,
): void {
  if (!sameUuid(result.entitlementId, expected.entitlementId)) {
    throw new Error("서버에서 확정한 추첨권 결과가 요청한 추첨권과 일치하지 않습니다.");
  }
  if (expected.productId && result.productId !== expected.productId) {
    throw new Error("서버에서 확정한 상품 결과가 선택한 상품과 일치하지 않습니다.");
  }
  if (
    expected.kujiSlotNumber !== undefined
    && result.kujiSlotNumber !== expected.kujiSlotNumber
  ) {
    throw new Error("서버에서 확정한 쿠지 번호가 선택한 번호와 일치하지 않습니다.");
  }
}

/** Expected IDs must come from the authenticated order, never just route params. */
export function isCommittedDrawSequenceConsumed(
  expectedEntitlementIds: readonly string[],
  consumedEntitlementIds: Iterable<string>,
): boolean {
  const expected = expectedEntitlementIds.map((id) => id.toLowerCase());
  if (
    expected.length < 1
    || expected.length > MAX_DRAW_SEQUENCE_SIZE
    || expected.some((id) => !UUID_PATTERN.test(id))
    || new Set(expected).size !== expected.length
  ) return false;
  const consumed = new Set(Array.from(consumedEntitlementIds, (id) => id.toLowerCase()));
  return expected.every((id) => consumed.has(id));
}

function parseEntitlementIds(value: string | undefined): string[] {
  if (!value) return [];
  const ids = value.split(",").map((id) => id.trim()).filter(Boolean);
  const normalizedIds = ids.map((id) => id.toLowerCase());
  if (
    ids.length < 1
    || ids.length > MAX_DRAW_SEQUENCE_SIZE
    || ids.some((id) => !UUID_PATTERN.test(id))
    || new Set(normalizedIds).size !== ids.length
  ) {
    return [];
  }
  return ids;
}

function sameUuid(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function emptySequence(): CommittedDrawSequence {
  return {
    entitlementIds: [],
    activeIndex: -1,
    activeEntitlementId: null,
    nextEntitlementId: null,
    total: 0,
  };
}
