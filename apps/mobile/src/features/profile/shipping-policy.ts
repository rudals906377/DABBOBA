import type { CatalogProduct } from "@dabboba/contracts";

type ShippingPolicyItem = Pick<CatalogProduct, "category" | "price">;

export const GACHA_ONLY_FREE_SHIPPING_THRESHOLD = 30_000;
export const MIXED_CATEGORY_FREE_SHIPPING_THRESHOLD = 50_000;

export type ShippingPolicy = {
  hasSelection: boolean;
  isGachaOnly: boolean;
  subtotal: number;
  threshold: number;
  qualifiesForFreeShipping: boolean;
  remainingForFreeShipping: number;
};

export function calculateShippingPolicy(
  items: readonly ShippingPolicyItem[],
): ShippingPolicy {
  const hasSelection = items.length > 0;
  const isGachaOnly = hasSelection && items.every((item) => item.category === "gacha");
  const subtotal = items.reduce((sum, item) => sum + item.price, 0);
  const threshold = isGachaOnly
    ? GACHA_ONLY_FREE_SHIPPING_THRESHOLD
    : MIXED_CATEGORY_FREE_SHIPPING_THRESHOLD;

  return {
    hasSelection,
    isGachaOnly,
    subtotal,
    threshold,
    qualifiesForFreeShipping: hasSelection && subtotal >= threshold,
    remainingForFreeShipping: hasSelection ? Math.max(threshold - subtotal, 0) : 0,
  };
}
