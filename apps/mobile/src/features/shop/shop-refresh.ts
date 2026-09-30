/** A focused shop keeps its list when revisited within this window. */
export const SHOP_FOCUS_REFRESH_STALE_MS = 60_000;

export function shouldRefreshShopOnFocus(
  lastSuccessfulLoadAt: number | null,
  now: number,
  staleAfterMs = SHOP_FOCUS_REFRESH_STALE_MS,
): boolean {
  if (lastSuccessfulLoadAt === null) return false;
  return now - lastSuccessfulLoadAt >= staleAfterMs;
}

export type ShopListPage<T> = {
  items: readonly T[];
  nextCursor: string | null;
};

/**
 * Refreshes the first page in place: fresh first-page items replace the
 * previously loaded first page, and already loaded later pages stay mounted
 * (so the scroll position survives) with their existing continuation cursor.
 */
export function mergeRefreshedFirstPage<T extends { id: string }>(
  current: ShopListPage<T>,
  fresh: ShopListPage<T>,
  firstPageSize: number,
): { items: T[]; nextCursor: string | null } {
  if (current.items.length <= firstPageSize) {
    return { items: [...fresh.items], nextCursor: fresh.nextCursor };
  }
  const freshIds = new Set(fresh.items.map((item) => item.id));
  const tail = current.items.slice(firstPageSize).filter((item) => !freshIds.has(item.id));
  return { items: [...fresh.items, ...tail], nextCursor: current.nextCursor };
}
