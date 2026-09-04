import type { CatalogProduct, InventoryUnit } from "@dabboba/contracts";

type ExchangeProductCategory = Pick<CatalogProduct, "category">;
type ExchangeInventoryProduct = Pick<InventoryUnit, "product" | "sourceType">;
type ExchangeInventorySelection = Pick<InventoryUnit, "product" | "sourceType" | "status">;

export function areCustomerVisibleExchangeProducts(
  products: readonly ExchangeProductCategory[],
): boolean {
  return products.length > 0 && products.every((product) => product.category !== "tcg");
}

export function isCustomerVisibleExchangeBundle(
  items: readonly ExchangeInventoryProduct[],
): boolean {
  return items.length > 0
    && items.every((item) => (
      item.sourceType === "GACHA"
      && item.product.category !== "tcg"
    ));
}

export function isCustomerEligibleExchangeInventory(
  item: ExchangeInventorySelection,
): boolean {
  return item.status === "OWNED"
    && item.sourceType === "GACHA"
    && item.product.category !== "tcg";
}
