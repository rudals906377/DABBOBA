import rawCatalog from "../fixtures/ip-seed.json";
import rawProducts from "../fixtures/product-seed.json";
import type { IpRecord, ProductCategoryId, ProductRecord } from "../domain/catalog";

const categoryMap = new Map<string, ProductCategoryId[]>();

for (const product of rawProducts as ProductRecord[]) {
  const current = categoryMap.get(product.ipId) ?? [];
  if (!current.includes(product.categoryId)) current.push(product.categoryId);
  categoryMap.set(product.ipId, current);
}

export const IP_CATALOG = (rawCatalog as IpRecord[])
  .filter((ip) => ip.isActive)
  .map((ip) => ({
    ...ip,
    availableCategories: categoryMap.get(ip.id) ?? [],
  }));

export const FEATURED_IPS = IP_CATALOG.filter((ip) => ip.featured);
