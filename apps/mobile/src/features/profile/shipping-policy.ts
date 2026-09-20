type ShippingPolicyItem = {
  sourceType: "PURCHASE" | "GACHA" | "KUJI" | "ADMIN_ADJUSTMENT";
  price: number;
};

export const GACHA_ONLY_FREE_SHIPPING_THRESHOLD = 24_900;
export const KUJI_INCLUDED_FREE_SHIPPING_THRESHOLD = 54_900;
export const STANDARD_SHIPPING_FEE = 3_000;

export type ShippingPolicy = {
  hasSelection: boolean;
  hasKuji: boolean;
  subtotal: number;
  threshold: number;
  qualifiesForFreeShipping: boolean;
  remainingForFreeShipping: number;
  shippingFee: number;
};

export function calculateShippingPolicy(
  items: readonly ShippingPolicyItem[],
): ShippingPolicy {
  const hasSelection = items.length > 0;
  const hasKuji = items.some((item) => item.sourceType === "KUJI");
  const subtotal = items.reduce((sum, item) => sum + item.price, 0);
  const threshold = hasKuji
    ? KUJI_INCLUDED_FREE_SHIPPING_THRESHOLD
    : GACHA_ONLY_FREE_SHIPPING_THRESHOLD;

  const qualifiesForFreeShipping = hasSelection && subtotal >= threshold;

  return {
    hasSelection,
    hasKuji,
    subtotal,
    threshold,
    qualifiesForFreeShipping,
    remainingForFreeShipping: hasSelection ? Math.max(threshold - subtotal, 0) : 0,
    shippingFee: hasSelection && !qualifiesForFreeShipping ? STANDARD_SHIPPING_FEE : 0,
  };
}
