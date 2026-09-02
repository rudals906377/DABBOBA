import { randomUUID } from "expo-crypto";
import { errorMessage } from "@dabboba/api-client";
import type { CatalogIp, CatalogProduct, components } from "@dabboba/contracts";
import { createMobileDabbobaClient as createDabbobaClient } from "@/lib/mobile-api-client";

type Notice = components["schemas"]["Notice"];

export type HomeCatalogSnapshot = {
  ips: CatalogIp[];
  products: CatalogProduct[];
  notices: Notice[];
  fetchedAt: string;
};

export async function fetchHomeCatalog(apiBaseUrl: string): Promise<HomeCatalogSnapshot> {
  const client = createDabbobaClient({
    baseUrl: apiBaseUrl,
    requestId: randomUUID,
  });
  const [ipResult, productResult, noticeResult] = await Promise.all([
    client.GET("/v1/catalog/ips", { params: { query: { limit: 30 } } }),
    client.GET("/v1/catalog/products", { params: { query: { limit: 50 } } }),
    client.GET("/v1/notices", { params: { query: { limit: 12 } } }),
  ]);

  if (!ipResult.data) {
    throw new Error(errorMessage(ipResult.error, "IP 목록을 불러오지 못했습니다."));
  }
  if (!productResult.data) {
    throw new Error(errorMessage(productResult.error, "상품 목록을 불러오지 못했습니다."));
  }

  return {
    ips: ipResult.data.items,
    products: productResult.data.items,
    notices: noticeResult.data?.items ?? [],
    fetchedAt: new Date().toISOString(),
  };
}
