import type { CatalogProduct } from "@dabboba/contracts";

export const SHOP_SORT_OPTIONS = [
  { value: "latest", label: "최신순" },
  { value: "popular", label: "인기순" },
  { value: "price-high", label: "가격 높은순" },
  { value: "price-low", label: "가격 낮은순" },
] as const;

export type ShopSortOption = (typeof SHOP_SORT_OPTIONS)[number]["value"];

type SortableShopProduct = Pick<
  CatalogProduct,
  "id" | "price" | "availableQuantity" | "metadata" | "createdAt"
>;

export function filterSoldOutProducts<Product extends SortableShopProduct>(
  products: readonly Product[],
  excludeSoldOut: boolean,
): Product[] {
  return excludeSoldOut ? products.filter((product) => product.availableQuantity > 0) : [...products];
}

export function sortShopProducts<Product extends SortableShopProduct>(
  products: readonly Product[],
  option: ShopSortOption,
): Product[] {
  return [...products].sort((left, right) => {
    if (option === "popular") {
      const popularityDifference = popularityScore(right) - popularityScore(left);
      if (popularityDifference) return popularityDifference;
    }
    if (option === "price-high") {
      const priceDifference = right.price - left.price;
      if (priceDifference) return priceDifference;
    }
    if (option === "price-low") {
      const priceDifference = left.price - right.price;
      if (priceDifference) return priceDifference;
    }
    const dateDifference = timestamp(right.createdAt) - timestamp(left.createdAt);
    return dateDifference || left.id.localeCompare(right.id);
  });
}

function popularityScore(product: SortableShopProduct): number {
  for (const key of ["popularityScore", "salesCount", "drawCount", "viewCount"] as const) {
    const raw = product.metadata[key];
    const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
