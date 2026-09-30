import { randomUUID } from "expo-crypto";
import { errorMessage } from "@dabboba/api-client";
import type { CatalogIp, CatalogProduct, components } from "@dabboba/contracts";
import {
  isCustomerBrowsableCatalogCategory,
  isCustomerVisibleProductCategory,
  productCategoryLabel,
} from "@/features/catalog/product-categories";
import { catalogQuantityLabel } from "@/features/catalog/remaining-inventory";
import { createMobileDabbobaClient as createDabbobaClient } from "@/lib/mobile-api-client";

export type ProductCategory = CatalogProduct["category"];
export type PublicDrawOdds = components["schemas"]["PublicDrawOdds"];
export type PublicPrizeLineup = components["schemas"]["PublicPrizeLineup"];

export type ShopSnapshot = {
  products: CatalogProduct[];
  ips: CatalogIp[];
  fetchedAt: string;
};

export type ShopSort = "latest" | "popular" | "price-high" | "price-low";

export type ShopProductPage = {
  products: CatalogProduct[];
  nextCursor: string | null;
  fetchedAt: string;
};

export type CatalogProductPageInput = {
  category?: Extract<ProductCategory, "gacha" | "kuji">;
  query?: string;
  ipId?: string;
  sort?: ShopSort;
  excludeSoldOut?: boolean;
  cursor?: string;
  limit?: number;
};

export type ShopProductPageInput = CatalogProductPageInput & {
  category: Extract<ProductCategory, "gacha" | "kuji">;
};

const CATALOG_PAGE_TIMEOUT_MS = 8_000;

export type ProductDetailSnapshot = {
  product: CatalogProduct;
  ip: CatalogIp | null;
  wishedByViewer: boolean;
  drawOdds: PublicDrawOdds | null;
  /** Prizes and their composition quantities, used when odds are not disclosed (before LIVE). */
  prizeLineup: PublicPrizeLineup | null;
  ownedCollectible: boolean;
  exchangeReference: boolean;
};

type ProductDetailContext = {
  exchangeListingId?: string;
  signal?: AbortSignal;
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

export async function fetchShopIps(apiBaseUrl: string): Promise<CatalogIp[]> {
  const client = createDabbobaClient({ baseUrl: apiBaseUrl, requestId: randomUUID });
  const result = await client.GET("/v1/catalog/ips", { params: { query: { limit: 100 } } });
  if (!result.data) throw new Error(errorMessage(result.error, "작품 정보를 불러오지 못했습니다."));
  return result.data.items;
}

export async function fetchShopProductPage(
  apiBaseUrl: string,
  input: ShopProductPageInput,
): Promise<ShopProductPage> {
  const page = await fetchCatalogProductPage(apiBaseUrl, input);
  return {
    ...page,
    products: page.products.filter((product) => product.category === input.category),
  };
}

export async function fetchCatalogProductPage(
  apiBaseUrl: string,
  input: CatalogProductPageInput,
): Promise<ShopProductPage> {
  const client = createDabbobaClient({ baseUrl: apiBaseUrl, requestId: randomUUID });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CATALOG_PAGE_TIMEOUT_MS);
  try {
    const result = await client.GET("/v1/catalog/products", {
      params: {
        query: {
          limit: input.limit ?? 20,
          ...(input.cursor ? { cursor: input.cursor } : {}),
          ...(input.query?.trim() ? { q: input.query.trim() } : {}),
          ...(input.category ? { category: input.category } : {}),
          ...(input.ipId ? { ipId: input.ipId } : {}),
          sort: input.sort ?? "latest",
          excludeSoldOut: input.excludeSoldOut ?? false,
        },
      },
      signal: controller.signal,
    });
    if (controller.signal.aborted) throw new Error("상품 응답 시간이 초과됐습니다. 다시 시도해 주세요.");
    if (!result.data) throw new Error(errorMessage(result.error, "상품을 불러오지 못했습니다."));
    return {
      products: result.data.items.filter((product) => isCustomerBrowsableCatalogCategory(product.category)),
      nextCursor: result.data.nextCursor ?? null,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (controller.signal.aborted) throw new Error("상품 응답 시간이 초과됐습니다. 다시 시도해 주세요.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchProductDetail(
  apiBaseUrl: string,
  productId: string,
  accessToken?: string,
  context: ProductDetailContext = {},
): Promise<ProductDetailSnapshot> {
  const client = createDabbobaClient({
    baseUrl: apiBaseUrl,
    requestId: randomUUID,
    ...(accessToken ? { token: () => accessToken } : {}),
  });
  const [productResult, ipResult, wishlistResult] = await Promise.all([
    client.GET("/v1/catalog/products/{productId}", { params: { path: { productId } }, signal: context.signal }),
    client.GET("/v1/catalog/ips", { params: { query: { limit: 100 } }, signal: context.signal }),
    accessToken
      ? client.GET("/v1/account/wishlist", { params: { query: { limit: 100 } }, signal: context.signal })
      : Promise.resolve({ data: undefined }),
  ]);

  const publicProduct = productResult.data
    && isCustomerVisibleProductCategory(productResult.data.category)
    ? productResult.data
    : undefined;
  const ownedProductResult = !publicProduct && accessToken
    ? await client.GET("/v1/account/owned-products/{productId}", {
      params: { path: { productId } },
      signal: context.signal,
    })
    : null;
  const exchangeListingResult = !publicProduct
    && !ownedProductResult?.data
    && context.exchangeListingId
    ? await client.GET("/v1/exchange/listings/{listingId}", {
      params: { path: { listingId: context.exchangeListingId } },
      signal: context.signal,
    })
    : null;
  const exchangeProducts = exchangeListingResult?.data
    ? [
      ...exchangeListingResult.data.offeredInventories.map((inventory) => inventory.product),
      ...(exchangeListingResult.data.offers ?? []).flatMap((offer) => (
        offer.offeredInventories.map((inventory) => inventory.product)
      )),
    ]
    : [];
  const exchangeProduct = exchangeProducts.find((candidate) => candidate.id === productId);
  const product = publicProduct ?? ownedProductResult?.data ?? exchangeProduct;
  if (!product) throw new Error("상품을 찾을 수 없습니다.");
  const ownedCollectible = !publicProduct && Boolean(ownedProductResult?.data);
  const exchangeReference = !publicProduct && !ownedCollectible && Boolean(exchangeProduct);

  let drawOdds: PublicDrawOdds | null = null;
  let prizeLineup: PublicPrizeLineup | null = null;
  if (!ownedCollectible && !exchangeReference && isDrawCategory(product.category)) {
    const oddsResult = await client.GET("/v1/catalog/products/{productId}/draw-odds", {
      params: { path: { productId } },
      signal: context.signal,
    });
    drawOdds = oddsResult.data ?? null;
    if (!drawOdds) {
      // Before LIVE the server withholds odds; the lineup still shows what can be won.
      const lineupResult = await client.GET("/v1/catalog/products/{productId}/prize-lineup", {
        params: { path: { productId } },
        signal: context.signal,
      });
      prizeLineup = lineupResult.data ?? null;
    }
  }

  return {
    product,
    ip: ipResult.data?.items.find((item) => item.id === product.ipId) ?? null,
    wishedByViewer: !ownedCollectible
      && !exchangeReference
      && (wishlistResult.data?.items.some((item) => item.product.id === productId) ?? false),
    drawOdds,
    prizeLineup,
    ownedCollectible,
    exchangeReference,
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
  return productCategoryLabel(category);
}

export function isDrawCategory(category: ProductCategory): boolean {
  return category === "gacha" || category === "kuji";
}

export { catalogQuantityLabel };

export function productMetadataText(product: CatalogProduct, key: string): string | null {
  const value = product.metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
