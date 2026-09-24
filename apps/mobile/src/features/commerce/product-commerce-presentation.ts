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
  const { qualifier, amount } = productPriceParts(product, commerceEnabled);
  return qualifier ? `${qualifier} ${amount}` : amount;
}

export function productPriceParts(
  product: CommerceProduct,
  commerceEnabled: boolean,
): { qualifier: "오픈 예정가" | null; amount: string } {
  if (typeof product.price !== "number" || !Number.isFinite(product.price) || product.price <= 0) {
    return { qualifier: null, amount: "가격 공개 예정" };
  }
  const amount = `${product.price.toLocaleString("ko-KR")}원`;
  if (!commerceEnabled || product.saleStatus !== undefined && product.saleStatus !== "ON_SALE") {
    return { qualifier: "오픈 예정가", amount };
  }
  return { qualifier: null, amount };
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
