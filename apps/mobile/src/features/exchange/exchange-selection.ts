export const EXCHANGE_BUNDLE_MAX_ITEMS = 2;

export function toggleExchangeInventorySelection(
  selectedIds: readonly string[],
  inventoryId: string,
  maximum = EXCHANGE_BUNDLE_MAX_ITEMS,
): string[] {
  if (selectedIds.includes(inventoryId)) {
    return selectedIds.filter((id) => id !== inventoryId);
  }
  if (selectedIds.length >= maximum) return [...selectedIds];
  return [...selectedIds, inventoryId];
}
