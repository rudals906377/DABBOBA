import type { PaidKujiDrawRecovery, components } from "@dabboba/contracts";

export type AvailableDrawEntitlement = components["schemas"]["AccountDrawEntitlement"];
export type DrawEntitlementPage = components["schemas"]["AccountDrawEntitlementPage"];
type Order = components["schemas"]["Order"];

export type PaidDrawRecoveryGroup = {
  key: string;
  orderId: string;
  product: AvailableDrawEntitlement["product"];
  createdAt: string;
  entitlementIds: string[];
};

export type PaidDrawRecoverySource = {
  fetchActorId: () => Promise<string>;
  fetchOrder: (orderId: string) => Promise<Order>;
  fetchPage: (cursor?: string) => Promise<DrawEntitlementPage>;
  fetchKujiRecovery: (orderId: string) => Promise<PaidKujiDrawRecovery>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function groupAvailableDrawEntitlements(items: readonly AvailableDrawEntitlement[]): PaidDrawRecoveryGroup[] {
  const groups = new Map<string, PaidDrawRecoveryGroup>();
  const seen = new Set<string>();
  for (const item of items) {
    if (item.status !== "AVAILABLE" || (item.product.category !== "gacha" && item.product.category !== "kuji")) continue;
    const identity = item.id.toLowerCase();
    if (seen.has(identity)) continue;
    seen.add(identity);
    const key = `${item.orderId}:${item.product.id}`;
    const group = groups.get(key) ?? {
      key, orderId: item.orderId, product: item.product, createdAt: item.createdAt, entitlementIds: [],
    };
    group.entitlementIds.push(item.id);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Complete the account cursor scan before deciding which purchased rights remain. */
export async function collectAvailableDrawEntitlements(
  fetchPage: PaidDrawRecoverySource["fetchPage"],
  signal?: AbortSignal,
): Promise<AvailableDrawEntitlement[]> {
  const items: AvailableDrawEntitlement[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  do {
    assertRecoveryActive(signal);
    const page = await fetchPage(cursor);
    assertRecoveryActive(signal);
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
    if (cursor && seenCursors.has(cursor)) throw new Error("남은 추첨권 목록을 끝까지 확인하지 못했습니다.");
    if (cursor) seenCursors.add(cursor);
  } while (cursor);
  return items;
}

/** Only called by the explicit resume action; never purchases or consumes a right. */
export async function preparePaidDrawRecovery(
  requested: PaidDrawRecoveryGroup,
  expectedActorId: string,
  source: PaidDrawRecoverySource,
  signal?: AbortSignal,
): Promise<string> {
  assertRecoveryActive(signal);
  const actorId = await source.fetchActorId();
  assertRecoveryActive(signal);
  if (actorId !== expectedActorId) throw new Error("로그인 계정이 변경되었습니다. 구매 내역을 다시 불러와 주세요.");
  const order = await source.fetchOrder(requested.orderId);
  assertRecoveryActive(signal);
  if (order.id !== requested.orderId || order.userId !== actorId) throw new Error("본인 계정의 주문 정보를 확인하지 못했습니다.");
  if (order.status !== "PAID" && order.status !== "FULFILLED") throw new Error("결제 완료된 주문만 이어 뽑을 수 있습니다.");
  const lines = order.lines.filter((line) => line.productId === requested.product.id && line.category === requested.product.category);
  if (lines.length !== 1 || !Number.isSafeInteger(lines[0]!.quantity) || lines[0]!.quantity < 1) {
    throw new Error("구매한 상품과 추첨권 정보가 일치하지 않습니다.");
  }
  const freshItems = await collectAvailableDrawEntitlements(source.fetchPage, signal);
  const fresh = groupAvailableDrawEntitlements(freshItems).find((group) => group.key === requested.key);
  if (!fresh) throw new Error("이 주문에 남아 있는 추첨권이 없습니다. 구매 내역을 새로 확인해 주세요.");
  const orderIds = order.drawEntitlementIds ?? [];
  const expectedIds = new Set(orderIds.map((id) => id.toLowerCase()));
  if (
    fresh.product.category !== requested.product.category
    || fresh.entitlementIds.length > lines[0]!.quantity
    || fresh.entitlementIds.length > 20
    || orderIds.some((id) => !UUID_PATTERN.test(id))
    || expectedIds.size !== orderIds.length
    || fresh.entitlementIds.some((id) => !UUID_PATTERN.test(id) || !expectedIds.has(id.toLowerCase()))
  ) throw new Error("서버 주문과 남은 추첨권 정보가 일치하지 않습니다.");
  if (fresh.product.category === "kuji") {
    assertRecoveryActive(signal);
    const recovery = await source.fetchKujiRecovery(order.id);
    assertRecoveryActive(signal);
    const versions = new Set(freshItems.filter((item) => (
      item.status === "AVAILABLE" && item.orderId === order.id && item.product.id === requested.product.id
    )).map((item) => item.probabilityVersion));
    return kujiRecoveryRoute(fresh, recovery, actorId, lines[0]!.quantity, versions);
  }
  // Preserve the server order, including when the account page is newest-first.
  const remaining = new Set(fresh.entitlementIds.map((id) => id.toLowerCase()));
  const entitlementIds = orderIds.filter((id) => remaining.has(id.toLowerCase()));
  return revealRoute(requested, entitlementIds);
}

function revealRoute(group: PaidDrawRecoveryGroup, entitlementIds: string[]): string {
  const query = new URLSearchParams({
    productId: group.product.id,
    category: group.product.category,
    orderId: group.orderId,
    entitlementIds: entitlementIds.join(","),
  });
  return `/draw/reveal/${encodeURIComponent(entitlementIds[0]!)}?${query.toString()}`;
}

function kujiRecoveryRoute(
  group: PaidDrawRecoveryGroup,
  recovery: PaidKujiDrawRecovery,
  actorId: string,
  purchasedCount: number,
  probabilityVersions: Set<number>,
): string {
  const ids = recovery.entitlementIds;
  const identities = ids.map((id) => id.toLowerCase());
  const available = new Set(group.entitlementIds.map((id) => id.toLowerCase()));
  if (
    recovery.userId !== actorId
    || recovery.orderId !== group.orderId
    || recovery.productId !== group.product.id
    || !UUID_PATTERN.test(recovery.roomEntryId)
    || !Number.isFinite(Date.parse(recovery.serverNow))
    || !Number.isFinite(Date.parse(recovery.drawingExpiresAt))
    || !Number.isSafeInteger(recovery.totalSlots) || recovery.totalSlots < 1
    || probabilityVersions.size !== 1 || !probabilityVersions.has(recovery.probabilityVersion)
    || ids.length > purchasedCount || ids.length > 20
    || ids.some((id) => !UUID_PATTERN.test(id) || !available.has(id.toLowerCase()))
    || new Set(identities).size !== ids.length
  ) throw new Error("서버 주문과 쿠지 복구 정보가 일치하지 않습니다.");
  if (!ids.length) throw new Error("이 주문에 남아 있는 추첨권이 없습니다. 구매 내역을 새로 확인해 주세요.");
  // The server preserves paid rights after the original draw lease expires.
  // EXPIRED never creates or resets a timer; existing bind/consume owns access.
  if (recovery.roomState !== "DRAWING" && recovery.roomState !== "EXPIRED") {
    throw new Error("쿠지 뽑기방 상태를 다시 확인해 주세요.");
  }
  const query = new URLSearchParams({
    productId: group.product.id,
    orderId: group.orderId,
    kujiEntryId: recovery.roomEntryId,
    entitlementIds: ids.join(","),
  });
  if (!recovery.bindings.length) {
    if (ids.length !== purchasedCount) throw new Error("남은 쿠지 번호의 연결 정보를 확인하지 못했습니다.");
    query.set("count", String(ids.length));
    return `/kuji/draw/${encodeURIComponent(group.product.id)}?${query.toString()}`;
  }
  const bindings = new Map(recovery.bindings.map((binding) => [binding.entitlementId.toLowerCase(), binding]));
  const slotNumbers = new Set(recovery.bindings.map((binding) => binding.slotNumber));
  if (
    recovery.bindings.length !== ids.length
    || bindings.size !== ids.length || slotNumbers.size !== ids.length
    || identities.some((id) => !bindings.has(id))
    || recovery.bindings.some((binding) => (
      binding.state !== "RESERVED"
      || !Number.isSafeInteger(binding.slotNumber)
      || binding.slotNumber < 1 || binding.slotNumber > recovery.totalSlots
    ))
  ) throw new Error("남은 추첨권과 선택한 쿠지 번호가 일치하지 않습니다.");
  query.set("category", "kuji");
  query.set("tickets", identities.map((id) => (
    String(bindings.get(id)!.slotNumber).padStart(Math.max(2, String(recovery.totalSlots).length), "0")
  )).join(","));
  return `/draw/reveal/${encodeURIComponent(ids[0]!)}?${query.toString()}`;
}

function assertRecoveryActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("추첨권 복구 요청이 취소되었습니다.");
}
