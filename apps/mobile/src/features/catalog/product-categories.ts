import type { CatalogProduct, StorefrontCategorySetting } from "@dabboba/contracts";

export type ProductCategory = CatalogProduct["category"];
export type CustomerVisibleProductCategory = Extract<ProductCategory, "gacha" | "kuji">;
export type CustomerCategoryAvailability = "active" | "coming-soon" | "hidden";
export type CustomerCategorySurface = "home" | "catalog" | "exchange" | "wanted";

export type StorefrontCategoryPresentation = Pick<
  StorefrontCategorySetting,
  | "category"
  | "label"
  | "sortOrder"
  | "availability"
  | "showOnHome"
  | "showOnCatalog"
  | "showOnExchange"
  | "showOnWanted"
  | "description"
  | "imageUrl"
  | "iconKey"
  | "version"
>;

const DEFAULT_STORE_CATEGORY_SETTINGS: readonly StorefrontCategoryPresentation[] = [
  { category: "gacha", label: "가챠", sortOrder: 10, availability: "active", showOnHome: true, showOnCatalog: true, showOnExchange: true, showOnWanted: true, description: "캡슐을 열어 상품을 확인해요.", imageUrl: null, iconKey: "capsule", version: 1 },
  { category: "kuji", label: "쿠지", sortOrder: 20, availability: "active", showOnHome: true, showOnCatalog: true, showOnExchange: true, showOnWanted: true, description: "번호를 선택해 쿠지 상품을 확인해요.", imageUrl: null, iconKey: "ticket", version: 1 },
  { category: "figure", label: "피규어", sortOrder: 30, availability: "hidden", showOnHome: false, showOnCatalog: false, showOnExchange: false, showOnWanted: false, description: "피규어 상품은 추후 운영 설정에서 다시 공개할 수 있어요.", imageUrl: null, iconKey: "figure", version: 1 },
  { category: "tcg", label: "카드", sortOrder: 40, availability: "hidden", showOnHome: false, showOnCatalog: false, showOnExchange: false, showOnWanted: false, description: "카드 상품을 준비하고 있어요.", imageUrl: null, iconKey: "cards", version: 1 },
] as const;

const PRODUCT_CATEGORIES: readonly ProductCategory[] = ["gacha", "figure", "kuji", "tcg"];
let runtimeSettings = [...DEFAULT_STORE_CATEGORY_SETTINGS];
let runtimeRevision = "defaults";

export type ProductCategoryLabel = string;

export const DEFAULT_CUSTOMER_CATEGORY_AVAILABILITY = Object.freeze(
  Object.fromEntries(DEFAULT_STORE_CATEGORY_SETTINGS.map((item) => [item.category, item.availability])),
) as Readonly<Record<ProductCategory, CustomerCategoryAvailability>>;

export const PRODUCT_CATEGORY_OPTIONS = DEFAULT_STORE_CATEGORY_SETTINGS
  .filter((item): item is StorefrontCategoryPresentation & { category: CustomerVisibleProductCategory } => isSupportedCustomerCategory(item.category))
  .map((item) => ({ value: item.category, label: item.label, availability: item.availability }));

export const PRODUCT_CATEGORY_VALUES: readonly CustomerVisibleProductCategory[] = PRODUCT_CATEGORY_OPTIONS.map(
  ({ value }) => value,
);

export function applyStorefrontCategorySettings(items: readonly StorefrontCategorySetting[]): string {
  const byCategory = new Map(items.map((item) => [item.category, item]));
  if (PRODUCT_CATEGORIES.some((category) => !byCategory.has(category))) return runtimeRevision;
  runtimeSettings = PRODUCT_CATEGORIES.map((category) => {
    const item = byCategory.get(category)!;
    return {
      category: item.category,
      label: item.label,
      sortOrder: item.sortOrder,
      availability: item.availability,
      showOnHome: item.showOnHome,
      showOnCatalog: item.showOnCatalog,
      showOnExchange: item.showOnExchange,
      showOnWanted: item.showOnWanted,
      description: item.description,
      imageUrl: item.imageUrl,
      iconKey: item.iconKey,
      version: item.version,
    };
  });
  runtimeRevision = runtimeSettings.map((item) => `${item.category}:${item.version}`).join("|");
  return runtimeRevision;
}

export function storefrontCategorySettingsRevision(): string {
  return runtimeRevision;
}

export function storefrontCategorySettings(): readonly StorefrontCategoryPresentation[] {
  return [...runtimeSettings].sort((left, right) => left.sortOrder - right.sortOrder || left.category.localeCompare(right.category));
}

export function storefrontCategorySetting(category: ProductCategory): StorefrontCategoryPresentation {
  return runtimeSettings.find((item) => item.category === category)
    ?? DEFAULT_STORE_CATEGORY_SETTINGS.find((item) => item.category === category)!;
}

function surfaceEnabled(setting: StorefrontCategoryPresentation, surface: CustomerCategorySurface): boolean {
  if (surface === "home") return setting.showOnHome;
  if (surface === "catalog") return setting.showOnCatalog;
  if (surface === "exchange") return setting.showOnExchange;
  return setting.showOnWanted;
}

export function storefrontCategoryOptions(surface: CustomerCategorySurface): Array<{
  value: CustomerVisibleProductCategory;
  label: string;
  availability: CustomerCategoryAvailability;
}> {
  return storefrontCategorySettings()
    .filter((item): item is StorefrontCategoryPresentation & { category: CustomerVisibleProductCategory } => isSupportedCustomerCategory(item.category))
    .filter((item) => item.availability !== "hidden" && surfaceEnabled(item, surface))
    .map((item) => ({ value: item.category, label: item.label, availability: item.availability }));
}

export function customerProductCategoryValues(surface: CustomerCategorySurface): CustomerVisibleProductCategory[] {
  return storefrontCategoryOptions(surface).map((item) => item.value);
}

export function isCustomerProductCategoryEnabledOn(category: ProductCategory, surface: CustomerCategorySurface): boolean {
  if (!isSupportedCustomerCategory(category)) return false;
  const setting = storefrontCategorySetting(category);
  return setting.availability === "active" && surfaceEnabled(setting, surface);
}

export function isCustomerVisibleProductCategory(category: ProductCategory): category is CustomerVisibleProductCategory {
  return isSupportedCustomerCategory(category) && storefrontCategorySetting(category).availability !== "hidden";
}

export function isCustomerBrowsableCatalogCategory(category: ProductCategory): category is CustomerVisibleProductCategory {
  return isSupportedCustomerCategory(category) && isCustomerProductCategoryEnabledOn(category, "catalog");
}

export function customerProductCategoryAvailability(category: ProductCategory): CustomerCategoryAvailability {
  return storefrontCategorySetting(category).availability;
}

export function isCustomerProductCategoryComingSoon(
  category: ProductCategory | undefined,
): category is ProductCategory {
  return category !== undefined && customerProductCategoryAvailability(category) === "coming-soon";
}

export function productCategoryLabel(category: ProductCategory): ProductCategoryLabel {
  return storefrontCategorySetting(category).label;
}

export function productCategoryDescription(category: ProductCategory): string {
  return storefrontCategorySetting(category).description;
}

function isSupportedCustomerCategory(category: ProductCategory): category is CustomerVisibleProductCategory {
  return category === "gacha" || category === "kuji";
}
