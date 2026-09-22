import type { CatalogIp, CatalogProduct, components } from "@dabboba/contracts";

type Notice = components["schemas"]["Notice"];
type HomeIp = Pick<CatalogIp, "id" | "nameKo"> & { isActive?: boolean };
type HomeProduct = Pick<CatalogProduct, "id" | "ipId" | "category" | "name" | "isActive" | "isPrizeOnly">;
type HomeNotice = Pick<Notice, "title" | "isPinned" | "isPublished" | "status">;

export const DEFAULT_HOME_COLLECTION_IP_IDS = ["demon-slayer", "pokemon"] as const;
export const HOME_GACHA_PRODUCT_CARD_WIDTH = 172;
export const HOME_KUJI_PRODUCT_CARD_WIDTH = 228;
export const HOME_FEATURED_PRODUCT_LIMIT = 2;
export const HOME_SECTION_PRODUCT_LIMIT = 20;
export const HOME_GACHA_PRODUCT_MEDIA_ASPECT_RATIO = 7 / 5;
export const HOME_KUJI_PRODUCT_MEDIA_ASPECT_RATIO = 7 / 4;
export const HOME_NEW_PRODUCT_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;
export const HOME_RECENT_DRAW_INLINE_MAX_FONT_SCALE = 1.3;
export const HOME_SECTION_SOURCE_KINDS = ["MANUAL", "IP", "NEW", "POPULAR"] as const;

export type HomeSectionLayoutKind = "gacha" | "kuji";
export type HomeSectionSourceKind = typeof HOME_SECTION_SOURCE_KINDS[number];

export function shouldExpandHomeHero(fontScale: number): boolean {
  return Number.isFinite(fontScale) && fontScale > HOME_RECENT_DRAW_INLINE_MAX_FONT_SCALE;
}

export function shouldExpandHomeRecentDraw(fontScale: number): boolean {
  return Number.isFinite(fontScale) && fontScale > HOME_RECENT_DRAW_INLINE_MAX_FONT_SCALE;
}

export type HomeProductBadge = "BEST" | "NEW" | null;

type PopularIpArtworkSource = {
  imageUrl: string | null;
  version: number;
};

type PopularIpProductArtworkSource = PopularIpArtworkSource & {
  storefrontImageUrl?: string | null;
};

type PopularIpProductCandidate = PopularIpProductArtworkSource & {
  ipId: string;
};

export type PopularIpArtwork = {
  imageUrl: string | null;
  imageVersion: number;
  resizeMode: "cover" | "contain";
  fallbackArtwork: Array<{
    imageUrl: string;
    imageVersion: number;
    resizeMode: "contain";
  }>;
};

function nonBlankImageUrl(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function resolvePopularIpArtwork(
  ip: PopularIpArtworkSource,
  product?: PopularIpProductArtworkSource,
): PopularIpArtwork {
  const ipImageUrl = nonBlankImageUrl(ip.imageUrl);
  const storefrontImageUrl = nonBlankImageUrl(product?.storefrontImageUrl);
  const primaryImageUrl = nonBlankImageUrl(product?.imageUrl);
  const productFallbackArtwork = [storefrontImageUrl, primaryImageUrl]
    .filter((imageUrl, index, imageUrls): imageUrl is string => Boolean(imageUrl) && imageUrls.indexOf(imageUrl) === index)
    .map((imageUrl) => ({
      imageUrl,
      imageVersion: product?.version ?? ip.version,
      resizeMode: "contain" as const,
    }));
  if (ipImageUrl) {
    return {
      imageUrl: ipImageUrl,
      imageVersion: ip.version,
      resizeMode: "cover",
      fallbackArtwork: productFallbackArtwork,
    };
  }

  const [primaryArtwork, ...fallbackArtwork] = productFallbackArtwork;

  return {
    imageUrl: primaryArtwork?.imageUrl ?? null,
    imageVersion: primaryArtwork?.imageVersion ?? ip.version,
    resizeMode: "contain",
    fallbackArtwork,
  };
}

export function buildPopularIpCoverProductByIpId<Product extends PopularIpProductCandidate>(
  products: readonly Product[],
): Map<string, Product> {
  const coverProductByIpId = new Map<string, Product>();

  for (const product of products) {
    const hasStorefrontImage = Boolean(nonBlankImageUrl(product.storefrontImageUrl));
    const hasPrimaryImage = Boolean(nonBlankImageUrl(product.imageUrl));
    if (!hasStorefrontImage && !hasPrimaryImage) continue;

    const current = coverProductByIpId.get(product.ipId);
    const currentHasStorefrontImage = Boolean(nonBlankImageUrl(current?.storefrontImageUrl));
    if (!current || (hasStorefrontImage && !currentHasStorefrontImage)) {
      coverProductByIpId.set(product.ipId, product);
    }
  }

  return coverProductByIpId;
}

export function resolveHomeProductImageUrl(
  product: Pick<CatalogProduct, "category" | "imageUrl"> & { storefrontImageUrl?: string | null },
): string | null {
  return nonBlankImageUrl(product.storefrontImageUrl) ?? nonBlankImageUrl(product.imageUrl);
}

export type RecentDrawReelWindow<Activity> = {
  previous: Activity | null;
  current: Activity | null;
  next: Activity | null;
};

export function getRecentDrawReelWindow<Activity>(
  activity: readonly Activity[],
  activeIndex: number,
): RecentDrawReelWindow<Activity> {
  if (!activity.length) return { previous: null, current: null, next: null };
  const normalizedIndex = ((Math.trunc(activeIndex) % activity.length) + activity.length) % activity.length;
  const current = activity[normalizedIndex] ?? null;
  if (activity.length === 1) return { previous: null, current, next: null };
  if (activity.length === 2) {
    return normalizedIndex === 0
      ? { previous: null, current, next: activity[1] ?? null }
      : { previous: activity[0] ?? null, current, next: null };
  }
  return {
    previous: activity[(normalizedIndex - 1 + activity.length) % activity.length] ?? null,
    current,
    next: activity[(normalizedIndex + 1) % activity.length] ?? null,
  };
}

export function buildHomeFeaturedProducts<Product extends HomeProduct>(
  products: readonly Product[],
  bestProductId: string | null,
  limit = HOME_FEATURED_PRODUCT_LIMIT,
): Product[] {
  const safeLimit = Math.max(0, Math.floor(limit));
  return products
    .filter((product) => (
      product.isActive
      && !product.isPrizeOnly
      && (product.category === "gacha" || product.category === "kuji")
    ))
    .map((product, index) => ({ product, index }))
    .sort((left, right) => {
      const leftIsBest = left.product.id === bestProductId;
      const rightIsBest = right.product.id === bestProductId;
      if (leftIsBest !== rightIsBest) return leftIsBest ? -1 : 1;
      return left.index - right.index;
    })
    .slice(0, safeLimit)
    .map(({ product }) => product);
}

export function resolveHomeProductBadge(
  product: Pick<CatalogProduct, "id" | "createdAt">,
  bestProductId: string | null,
  evaluatedAt: string,
): HomeProductBadge {
  if (product.id === bestProductId) return "BEST";
  const createdAtMs = Date.parse(product.createdAt);
  const evaluatedAtMs = Date.parse(evaluatedAt);
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(evaluatedAtMs)) return null;
  const ageMs = evaluatedAtMs - createdAtMs;
  return ageMs >= 0 && ageMs <= HOME_NEW_PRODUCT_WINDOW_MS ? "NEW" : null;
}

export type HomeCollection<Ip extends HomeIp = CatalogIp, Product extends HomeProduct = CatalogProduct> = {
  id: string;
  title: string;
  ip: Ip;
  products: Product[];
};

export type TodayDrawGroup<Product extends HomeProduct = CatalogProduct> = {
  category: "gacha" | "kuji";
  label: string;
  products: Product[];
};

const TODAY_DRAW_CATEGORIES = [
  { category: "gacha", label: "가챠" },
  { category: "kuji", label: "쿠지" },
] as const;

type ConfiguredHomeSection<Ip extends HomeIp, Product extends HomeProduct> = {
  id: string;
  title: string;
  subtitle: string | null;
  sortOrder: number;
  isActive: boolean;
  layoutKind: HomeSectionLayoutKind;
  sourceKind: HomeSectionSourceKind;
  visibleLimit: number;
  ip: Ip | null;
  products: readonly Product[];
};

export type ConfiguredHomeCollection<
  Ip extends HomeIp = CatalogIp,
  Product extends HomeProduct = CatalogProduct,
> = Omit<HomeCollection<Ip, Product>, "ip"> & {
  subtitle: string | null;
  layoutKind: HomeSectionLayoutKind;
  sourceKind: HomeSectionSourceKind;
  visibleLimit: number;
  ip: Ip | null;
};

export function buildTodayDrawGroups<Product extends HomeProduct>(
  products: readonly Product[],
  limitPerCategory = 4,
  excludedProductIds: readonly string[] = [],
): TodayDrawGroup<Product>[] {
  const limit = Math.max(0, Math.floor(limitPerCategory));
  const excludedIds = new Set(excludedProductIds);
  return TODAY_DRAW_CATEGORIES.map(({ category, label }) => ({
    category,
    label,
    products: products
      .filter((product) => (
        product.category === category
        && product.isActive
        && !product.isPrizeOnly
        && !excludedIds.has(product.id)
      ))
      .slice(0, limit),
  }));
}

export function buildHomeCollections<Ip extends HomeIp, Product extends HomeProduct>(
  ips: readonly Ip[],
  products: readonly Product[],
  orderedIpIds: readonly string[],
): HomeCollection<Ip, Product>[] {
  const ipById = new Map(ips.map((ip) => [ip.id, ip]));

  return orderedIpIds.flatMap((ipId) => {
    const ip = ipById.get(ipId);
    if (!ip) return [];
    const collectionProducts = products.filter(
      (product) => product.ipId === ipId
        && product.isActive
        && !product.isPrizeOnly
        && (product.category === "gacha" || product.category === "kuji"),
    );
    if (!collectionProducts.length) return [];
    return [{ id: ip.id, title: `${ip.nameKo} 컬렉션`, ip, products: collectionProducts }];
  });
}

export function buildConfiguredHomeCollections<Ip extends HomeIp, Product extends HomeProduct>(
  sections: readonly ConfiguredHomeSection<Ip, Product>[],
): ConfiguredHomeCollection<Ip, Product>[] {
  return [...sections]
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
    .flatMap((section) => {
      if (section.layoutKind !== "gacha" && section.layoutKind !== "kuji") return [];
      if (!section.isActive || section.ip?.isActive === false) return [];
      const visibleLimit = Number.isFinite(section.visibleLimit)
        ? Math.min(HOME_SECTION_PRODUCT_LIMIT, Math.max(1, Math.floor(section.visibleLimit)))
        : HOME_SECTION_PRODUCT_LIMIT;
      const sourceKind = HOME_SECTION_SOURCE_KINDS.includes(section.sourceKind)
        ? section.sourceKind
        : "IP";
      const products = section.products.filter(
        (product) => product.isActive
          && !product.isPrizeOnly
          && product.category === section.layoutKind,
      ).slice(0, visibleLimit);
      return [{
        id: section.id,
        title: section.title,
        subtitle: section.subtitle?.trim() || null,
        layoutKind: section.layoutKind,
        sourceKind,
        visibleLimit,
        ip: section.ip,
        products,
      }];
    });
}

export function homeAnnouncementMessages(notices: readonly HomeNotice[]): string[] {
  return notices
    .filter((notice) => notice.isPinned && notice.isPublished && notice.status === "ACTIVE")
    .map((notice) => notice.title.trim())
    .filter(Boolean);
}

export function getTickerOverflowDistance(viewportWidth: number, textWidth: number): number {
  if (viewportWidth <= 0 || textWidth <= viewportWidth) return 0;
  return textWidth - viewportWidth;
}

export function getHomeProductCardWidth(
  layoutKind: HomeSectionLayoutKind,
): number {
  return layoutKind === "kuji" ? HOME_KUJI_PRODUCT_CARD_WIDTH : HOME_GACHA_PRODUCT_CARD_WIDTH;
}

export function getHomeProductMediaAspectRatio(
  layoutKind: HomeSectionLayoutKind,
): number {
  return layoutKind === "kuji"
    ? HOME_KUJI_PRODUCT_MEDIA_ASPECT_RATIO
    : HOME_GACHA_PRODUCT_MEDIA_ASPECT_RATIO;
}
