import type { CatalogProduct } from "@dabboba/contracts";

export type ProductCategory = CatalogProduct["category"];

const PRODUCT_CATEGORY_LABELS = {
  gacha: "가챠",
  kuji: "쿠지",
  figure: "피규어",
  tcg: "카드",
} as const satisfies Record<ProductCategory, string>;

export type ProductCategoryLabel = (typeof PRODUCT_CATEGORY_LABELS)[ProductCategory];
export type CustomerVisibleProductCategory = Exclude<ProductCategory, "tcg">;

export const PRODUCT_CATEGORY_OPTIONS = [
  { value: "gacha", label: "가챠" },
  { value: "kuji", label: "쿠지" },
  { value: "figure", label: "피규어" },
] as const satisfies ReadonlyArray<{
  value: CustomerVisibleProductCategory;
  label: ProductCategoryLabel;
}>;

export const PRODUCT_CATEGORY_VALUES: readonly CustomerVisibleProductCategory[] = PRODUCT_CATEGORY_OPTIONS.map(
  ({ value }) => value,
);

export function isCustomerVisibleProductCategory(
  category: ProductCategory,
): category is CustomerVisibleProductCategory {
  return category !== "tcg";
}

export function isCustomerBrowsableCatalogCategory(
  category: ProductCategory,
): category is Extract<ProductCategory, "gacha" | "kuji"> {
  return category === "gacha" || category === "kuji";
}

export function productCategoryLabel(category: ProductCategory): ProductCategoryLabel {
  return PRODUCT_CATEGORY_LABELS[category];
}
