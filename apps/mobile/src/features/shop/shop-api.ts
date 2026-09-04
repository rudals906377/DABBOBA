import { randomUUID } from "expo-crypto";
import { errorMessage } from "@dabboba/api-client";
import type { CatalogIp, CatalogProduct, components } from "@dabboba/contracts";
import { isCustomerBrowsableCatalogCategory } from "@/features/catalog/product-categories";
import { createMobileDabbobaClient as createDabbobaClient } from "@/lib/mobile-api-client";

export type ProductCategory = CatalogProduct["category"];
export type PublicDrawOdds = components["schemas"]["PublicDrawOdds"];

export type ShopSnapshot = {
  products: CatalogProduct[];
  ips: CatalogIp[];
  fetchedAt: string;
};

export type ProductDetailSnapshot = {
  product: CatalogProduct;
  ip: CatalogIp | null;
  wishedByViewer: boolean;
  drawOdds: PublicDrawOdds | null;
};

export async function fetchShopSnapshot(apiBaseUrl: string): Promise<ShopSnapshot> {
  const client = createDabbobaClient({ baseUrl: apiBaseUrl, requestId: randomUUID });
  const [productResult, ipResult] = await Promise.all([
    client.GET("/v1/catalog/products", { params: { query: { limit: 100 } } }),
    client.GET("/v1/catalog/ips", { params: { query: { limit: 100 } } }),
  ]);

  if (!productResult.data) {
    throw new Error(errorMessage(productResult.error, "상품을 불러오지 못했습니다."));
  }
  if (!ipResult.data) {
    throw new Error(errorMessage(ipResult.error, "작품 정보를 불러오지 못했습니다."));
  }

  return {
    products: productResult.data.items.filter((product) => (
      isCustomerBrowsableCatalogCategory(product.category)
    )),
    ips: ipResult.data.items,
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchProductDetail(
  apiBaseUrl: string,
  productId: string,
  accessToken?: string,
): Promise<ProductDetailSnapshot> {
  const client = createDabbobaClient({
    baseUrl: apiBaseUrl,
    requestId: randomUUID,
    ...(accessToken ? { token: () => accessToken } : {}),
  });
  const [productResult, ipResult, wishlistResult] = await Promise.all([
    client.GET("/v1/catalog/products", { params: { query: { limit: 100 } } }),
    client.GET("/v1/catalog/ips", { params: { query: { limit: 100 } } }),
    accessToken
      ? client.GET("/v1/account/wishlist", { params: { query: { limit: 100 } } })
      : Promise.resolve({ data: undefined }),
  ]);

  if (!productResult.data) {
    throw new Error(errorMessage(productResult.error, "상품 정보를 불러오지 못했습니다."));
  }
  const product = productResult.data.items.find((item) => (
    item.id === productId && isCustomerBrowsableCatalogCategory(item.category)
  ));
  if (!product) throw new Error("상품을 찾을 수 없습니다.");

  let drawOdds: PublicDrawOdds | null = null;
  if (isDrawCategory(product.category)) {
    const oddsResult = await client.GET("/v1/catalog/products/{productId}/draw-odds", {
      params: { path: { productId } },
    });
    drawOdds = oddsResult.data ?? null;
  }

  return {
    product,
    ip: ipResult.data?.items.find((item) => item.id === product.ipId) ?? null,
    wishedByViewer: wishlistResult.data?.items.some((item) => item.product.id === productId) ?? false,
    drawOdds,
  };
}

export async function setProductWishlist(
  apiBaseUrl: string,
  accessToken: string,
  productId: string,
  wished: boolean,
): Promise<boolean> {
  const client = createDabbobaClient({
    baseUrl: apiBaseUrl,
    token: () => accessToken,
    requestId: randomUUID,
  });
  const params = {
    path: { productId },
    header: { "Idempotency-Key": randomUUID() },
  };
  if (wished) {
    const result = await client.POST("/v1/account/wishlist/{productId}", { params });
    if (!result.data) throw new Error(errorMessage(result.error, "찜을 저장하지 못했습니다."));
  } else {
    const result = await client.DELETE("/v1/account/wishlist/{productId}", { params });
    if (!result.data) throw new Error(errorMessage(result.error, "찜을 해제하지 못했습니다."));
  }
  return wished;
}

export function categoryLabel(category: ProductCategory): string {
  if (category === "gacha") return "가챠";
  if (category === "figure") return "피규어";
  if (category === "kuji") return "쿠지";
  return "카드";
}

export function isDrawCategory(category: ProductCategory): boolean {
  return category === "gacha" || category === "kuji";
}

export function productMetadataText(product: CatalogProduct, key: string): string | null {
  const value = product.metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
