import type { CatalogProduct } from "@dabboba/contracts";

export type RemainingInventory = Pick<
  CatalogProduct,
  "category" | "availableQuantity" | "totalQuantity"
>;

export const COMPACT_INVENTORY_INLINE_MAX_FONT_SCALE = 1.3;
export const COMPACT_INVENTORY_MAX_FONT_SIZE_MULTIPLIER = 2;

export function shouldStackCompactInventoryMeter(
  compact: boolean,
  fontScale: number,
): boolean {
  return compact
    && Number.isFinite(fontScale)
    && fontScale > COMPACT_INVENTORY_INLINE_MAX_FONT_SCALE;
}

export function remainingInventoryLabel(
  category: CatalogProduct["category"],
): string {
  if (category === "kuji") return "잔여 티켓";
  if (category === "gacha") return "잔여 상품";
  return "잔여 수량";
}

export function catalogQuantityLabel(
  inventory: Pick<CatalogProduct, "availableQuantity" | "totalQuantity">,
): string {
  return typeof inventory.totalQuantity === "number"
    ? `${inventory.availableQuantity}/${inventory.totalQuantity}`
    : `${inventory.availableQuantity}`;
}

export function visibleInventoryQuantityLabel(
  category: CatalogProduct["category"],
  inventory: Pick<CatalogProduct, "availableQuantity" | "totalQuantity">,
): string {
  const quantity = catalogQuantityLabel(inventory);
  if (typeof inventory.totalQuantity === "number") return quantity;
  return `${quantity}${category === "kuji" ? "장" : "개"} 남음`;
}

export function remainingInventoryRatio(
  inventory: Pick<CatalogProduct, "availableQuantity" | "totalQuantity">,
): number | null {
  if (typeof inventory.totalQuantity !== "number") return null;
  if (!Number.isFinite(inventory.totalQuantity) || inventory.totalQuantity <= 0) return 0;

  const availableQuantity = Number.isFinite(inventory.availableQuantity)
    ? inventory.availableQuantity
    : 0;
  return Math.min(1, Math.max(0, availableQuantity / inventory.totalQuantity));
}
