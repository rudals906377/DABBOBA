import type { HomeCatalogSnapshot } from "@/features/catalog/catalog-api";

export function mergeFreshHomeCatalogWithCachedSections(
  fresh: HomeCatalogSnapshot,
  cached: HomeCatalogSnapshot,
): HomeCatalogSnapshot {
  if (fresh.homeSections !== null || cached.homeSections === null) return fresh;

  const freshIpById = new Map(fresh.ips.map((ip) => [ip.id, ip]));
  const freshProductById = new Map(fresh.products.map((product) => [product.id, product]));
  const items = cached.homeSections.items.flatMap((section) => {
    const currentIp = section.ip ? freshIpById.get(section.ip.id) ?? null : null;
    if (section.ip && (!currentIp || currentIp.isActive === false)) return [];

    const products = section.products.flatMap((cachedProduct) => {
      const currentProduct = freshProductById.get(cachedProduct.id);
      if (!currentProduct) return [];
      if (!currentProduct.isActive || currentProduct.isPrizeOnly) return [];
      if (currentIp && currentProduct.ipId !== currentIp.id) return [];
      if (currentProduct.category !== section.layoutKind) return [];
      return [currentProduct];
    });

    return [{ ...section, ip: currentIp, products }];
  });
  const cachedBestProductId = cached.homeSections.bestProductId;
  const bestProductId = cachedBestProductId && items.some((section) => (
    section.products.some((product) => product.id === cachedBestProductId)
  ))
    ? cachedBestProductId
    : null;
  const homeProductBadges = {
    bestProductId,
    evaluatedAt: cached.homeSections.evaluatedAt,
  };

  return {
    ...fresh,
    homeSections: {
      ...cached.homeSections,
      items,
      bestProductId,
    },
    homeProductBadges,
  };
}
