import { randomUUID } from "expo-crypto";
import { errorMessage } from "@dabboba/api-client";
import type {
  CatalogIp,
  CatalogProduct,
  HomeCatalogSectionList,
  HomeRecentDrawActivity,
  components,
} from "@dabboba/contracts";
import { isCustomerProductCategoryEnabledOn } from "@/features/catalog/product-categories";
import { createMobileDabbobaClient as createDabbobaClient } from "@/lib/mobile-api-client";
import { readAuthTokens } from "@/lib/session-store";

type Notice = components["schemas"]["Notice"];
export type HomeProductBadgeState = components["schemas"]["HomeProductBadgeState"];

export type HomeCatalogSnapshot = {
  ips: CatalogIp[];
  products: CatalogProduct[];
  notices: Notice[];
  homeSections: HomeCatalogSectionList | null;
  homeProductBadges: HomeProductBadgeState;
  recentDrawActivity: HomeRecentDrawActivity[] | null;
  fetchedAt: string;
};

export async function fetchHomeRecentDrawActivity(
  apiBaseUrl: string,
): Promise<HomeRecentDrawActivity[]> {
  const client = createDabbobaClient({
    baseUrl: apiBaseUrl,
    requestId: randomUUID,
  });
  const result = await client.GET("/v1/catalog/recent-draws");
  if (!result.data) {
    throw new Error(errorMessage(result.error, "최근 당첨 기록을 불러오지 못했습니다."));
  }
  return result.data.items.slice(0, 2);
}

export async function fetchHomeCatalog(apiBaseUrl: string): Promise<HomeCatalogSnapshot> {
  const client = createDabbobaClient({
    baseUrl: apiBaseUrl,
    requestId: randomUUID,
  });
  const homeSectionRequest = client.GET("/v1/catalog/home-sections").catch(() => null);
  const [ipResult, productResult, noticeResult, homeSectionResult] = await Promise.all([
    client.GET("/v1/catalog/ips", { params: { query: { limit: 30 } } }),
    client.GET("/v1/catalog/products", { params: { query: { limit: 50 } } }),
    client.GET("/v1/notices", { params: { query: { limit: 12 } } }),
    homeSectionRequest,
  ]);

  if (!ipResult.data) {
    throw new Error(errorMessage(ipResult.error, "IP 목록을 불러오지 못했습니다."));
  }
  if (!productResult.data) {
    throw new Error(errorMessage(productResult.error, "상품 목록을 불러오지 못했습니다."));
  }

  const fetchedAt = new Date().toISOString();
  return {
    ips: ipResult.data.items,
    products: productResult.data.items.filter((product) => (
      isCustomerProductCategoryEnabledOn(product.category, "home")
    )),
    notices: noticeResult.data?.items ?? [],
    homeSections: homeSectionResult?.data ?? null,
    homeProductBadges: homeSectionResult?.data
      ? {
          bestProductId: homeSectionResult.data.bestProductId,
          evaluatedAt: homeSectionResult.data.evaluatedAt,
        }
      : { bestProductId: null, evaluatedAt: fetchedAt },
    recentDrawActivity: null,
    fetchedAt,
  };
}

export async function recordHomeProductClick(
  apiBaseUrl: string,
  productId: string,
): Promise<HomeProductBadgeState> {
  const tokens = await readAuthTokens();
  const client = createDabbobaClient({
    baseUrl: apiBaseUrl,
    token: () => tokens?.accessToken ?? null,
    requestId: randomUUID,
  });
  const result = await client.POST("/v1/catalog/home-product-clicks/{productId}", {
    params: { path: { productId } },
    body: { eventId: randomUUID() },
  });
  if (!result.data) {
    throw new Error(errorMessage(result.error, "상품 인기도를 반영하지 못했습니다."));
  }
  return result.data;
}
