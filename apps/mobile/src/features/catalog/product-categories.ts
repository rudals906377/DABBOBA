import type { CatalogProduct } from "@dabboba/contracts";

export type ProductCategory = CatalogProduct["category"];

export const PRODUCT_CATEGORY_OPTIONS = [
  { value: "gacha", label: "가챠" },
  { value: "kuji", label: "쿠지" },
  { value: "figure", label: "피규어" },
  { value: "tcg", label: "카드" },
] as const satisfies ReadonlyArray<{ value: ProductCategory; label: string }>;

export type ProductCategoryLabel = (typeof PRODUCT_CATEGORY_OPTIONS)[number]["label"];

export const PRODUCT_CATEGORY_VALUES: readonly ProductCategory[] = PRODUCT_CATEGORY_OPTIONS.map(
  ({ value }) => value,
);

export function productCategoryLabel(category: ProductCategory): ProductCategoryLabel {
  const option = PRODUCT_CATEGORY_OPTIONS.find(({ value }) => value === category);
  if (!option) throw new Error(`지원하지 않는 상품 카테고리입니다: ${category}`);
  return option.label;
}
