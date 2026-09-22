export const DRAW_PURCHASE_MAX_QUANTITY = 10;

export function normalizeDrawPurchaseCount(
  value: string | number | undefined,
  availableQuantity = DRAW_PURCHASE_MAX_QUANTITY,
): number {
  const parsed = Number(value);
  const available = Number.isFinite(availableQuantity)
    ? Math.max(0, Math.trunc(availableQuantity))
    : DRAW_PURCHASE_MAX_QUANTITY;
  const limit = Math.min(available, DRAW_PURCHASE_MAX_QUANTITY);

  if (limit === 0) return 0;
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(Math.trunc(parsed), limit));
}
