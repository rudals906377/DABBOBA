export const PRODUCT_CATEGORIES = [
  { id: "gacha", label: "가챠" },
  { id: "figure", label: "피규어" },
  { id: "kuji", label: "쿠지" },
  { id: "tcg", label: "카드" },
] as const;

export type ProductCategoryId = (typeof PRODUCT_CATEGORIES)[number]["id"];
export type ProductCategoryLabel = (typeof PRODUCT_CATEGORIES)[number]["label"];
export type CustomerVisibleProductCategoryId = Exclude<ProductCategoryId, "tcg">;
export type CustomerVisibleProductCategory = Exclude<(typeof PRODUCT_CATEGORIES)[number], { id: "tcg" }>;
export type CustomerBrowsableProductCategoryId = Extract<ProductCategoryId, "gacha" | "kuji">;
export type CustomerBrowsableProductCategory = Extract<
  (typeof PRODUCT_CATEGORIES)[number],
  { id: CustomerBrowsableProductCategoryId }
>;
export type CommerceMode = "draw" | "purchase";
export type RandomDrawCategoryId = Extract<ProductCategoryId, "gacha" | "kuji">;
export type DirectPurchaseCategoryId = Extract<ProductCategoryId, "figure" | "tcg">;

export type IpRecord = {
  id: string;
  slug: string;
  nameKo: string;
  nameEn: string;
  nameJa: string;
  aliases: string[];
  image: string;
  description: string;
  featured: boolean;
  isActive: boolean;
  availableCategories: ProductCategoryId[];
  characters: string[];
  sourceMediaId: string;
  sourcePage: string;
};

export type ProductRecord = {
  id: string;
  ipId: string;
  categoryId: ProductCategoryId;
  line: string;
  title: string;
  description: string;
  price: number;
  stock: number;
  totalQuantity?: number | null;
  openedQuantity?: number | null;
  asset: string;
  edition: string;
  reward: string;
  sourcePage: string;
};

export const PRODUCT_CATEGORY_LABELS = PRODUCT_CATEGORIES.map((category) => category.label);

// Keep the complete category model above so TCG data can be restored without a
// migration, while exposing only categories that are open to customers today.
export const CUSTOMER_VISIBLE_PRODUCT_CATEGORIES = PRODUCT_CATEGORIES.filter(
  (category): category is CustomerVisibleProductCategory => category.id !== "tcg",
);
export const CUSTOMER_VISIBLE_PRODUCT_CATEGORY_LABELS = CUSTOMER_VISIBLE_PRODUCT_CATEGORIES.map(
  (category) => category.label,
);
export const CUSTOMER_BROWSABLE_PRODUCT_CATEGORIES = PRODUCT_CATEGORIES.filter(
  (category): category is CustomerBrowsableProductCategory => category.id === "gacha" || category.id === "kuji",
);

export function isCustomerVisibleProductCategory(
  categoryId: ProductCategoryId,
): categoryId is CustomerVisibleProductCategoryId {
  return categoryId !== "tcg";
}

export function isCustomerBrowsableProductCategory(
  categoryId: ProductCategoryId,
): categoryId is CustomerBrowsableProductCategoryId {
  return categoryId === "gacha" || categoryId === "kuji";
}

export function categoryLabel(categoryId: ProductCategoryId) {
  return PRODUCT_CATEGORIES.find((category) => category.id === categoryId)?.label ?? categoryId;
}

export function commerceModeForCategory(categoryId: ProductCategoryId): CommerceMode {
  return categoryId === "gacha" || categoryId === "kuji" ? "draw" : "purchase";
}

export function isRandomDrawCategory(categoryId: ProductCategoryId): categoryId is RandomDrawCategoryId {
  return commerceModeForCategory(categoryId) === "draw";
}

export function normalizeCatalogSearch(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function matchesIpSearch(ip: IpRecord, query: string) {
  const normalizedQuery = normalizeCatalogSearch(query);
  if (!normalizedQuery) return true;

  return [ip.nameKo, ip.nameEn, ip.nameJa, ...ip.aliases]
    .map(normalizeCatalogSearch)
    .some((candidate) => candidate.includes(normalizedQuery));
}
