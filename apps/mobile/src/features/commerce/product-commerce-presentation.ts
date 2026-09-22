import type { CatalogProduct } from "@dabboba/contracts";

type CommerceProduct = Pick<CatalogProduct, "price"> & {
  saleStatus?: "DRAFT" | "COMING_SOON" | "ON_SALE" | "PAUSED";
  purchasable?: boolean;
  blockedReason?: string | null;
};

export function productPriceLabel(
  product: CommerceProduct,
  commerceEnabled: boolean,
): string {
  const candidate = product as CommerceProduct;
  if (typeof product.price !== "number" || !Number.isFinite(product.price) || product.price <= 0) {
    return "가격 공개 예정";
  }
  if (!commerceEnabled || candidate.saleStatus !== undefined && candidate.saleStatus !== "ON_SALE") {
    return `오픈 예정가 ${product.price.toLocaleString("ko-KR")}원`;
  }
  return `${product.price.toLocaleString("ko-KR")}원`;
}

export function isProductPurchasable(
  product: CommerceProduct & Pick<CatalogProduct, "availableQuantity">,
  commerceEnabled: boolean,
): boolean {
  if (
    !commerceEnabled
    || typeof product.price !== "number"
    || !Number.isFinite(product.price)
    || product.price <= 0
    || product.availableQuantity <= 0
  ) return false;
  const candidate = product as CommerceProduct;
  if (candidate.purchasable !== undefined) return candidate.purchasable;
  if (candidate.saleStatus !== undefined) return candidate.saleStatus === "ON_SALE";
  return true;
}

export function catalogPriceLabel(price: number | null | undefined): string {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    return "가격 공개 예정";
  }
  return `${price.toLocaleString("ko-KR")}원`;
}
