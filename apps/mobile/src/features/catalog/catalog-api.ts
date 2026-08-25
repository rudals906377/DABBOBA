import { randomUUID } from "expo-crypto";
import { createDabbobaClient, errorMessage } from "@dabboba/api-client";
import type { CatalogIp, CatalogProduct } from "@dabboba/contracts";

export type HomeCatalogSnapshot = {
  ips: CatalogIp[];
  products: CatalogProduct[];
  fetchedAt: string;
};

export async function fetchHomeCatalog(apiBaseUrl: string): Promise<HomeCatalogSnapshot> {
  const client = createDabbobaClient({
    baseUrl: apiBaseUrl,
    requestId: randomUUID,
  });
  const [ipResult, productResult] = await Promise.all([
    client.GET("/v1/catalog/ips", { params: { query: { limit: 8 } } }),
    client.GET("/v1/catalog/products", { params: { query: { limit: 12 } } }),
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
    fetchedAt: new Date().toISOString(),
  };
}
