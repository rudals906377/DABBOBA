import type { CatalogIp, CatalogProduct, components } from "@dabboba/contracts";

type Notice = components["schemas"]["Notice"];
type HomeIp = Pick<CatalogIp, "id" | "nameKo">;
type HomeProduct = Pick<CatalogProduct, "id" | "ipId" | "category" | "name" | "isActive" | "isPrizeOnly">;
type HomeNotice = Pick<Notice, "title" | "isPinned" | "isPublished" | "status">;

export const DEFAULT_HOME_COLLECTION_IP_IDS = ["demon-slayer", "pokemon"] as const;
export const HOME_PRODUCT_CARD_WIDTH = 164;
export const HOME_KUJI_CARD_MAX_WIDTH = 520;
export const HOME_ANNOUNCEMENT_FALLBACKS = [
  "가챠 상품만 배송하면 30,000원 이상 무료배송이에요.",
  "쿠지·피규어 등 일반 상품이 포함되면 50,000원 이상 무료배송이에요.",
] as const;

const DRAW_ACTIVITY_NAMES = ["모찌수집가", "캡슐헌터", "오늘도한번"] as const;

export type HomeCollection<Ip extends HomeIp = CatalogIp, Product extends HomeProduct = CatalogProduct> = {
  id: string;
  title: string;
  ip: Ip;
  products: Product[];
};

export type DrawActivityItem = {
  id: string;
  productId: string;
  personName: string;
  productName: string;
  objectParticle: "을" | "를";
  message: string;
  isExample: true;
};

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

export function homeAnnouncementMessages(notices: readonly HomeNotice[]): string[] {
  const pinned = notices
    .filter((notice) => notice.isPinned && notice.isPublished && notice.status === "ACTIVE")
    .map((notice) => notice.title.trim())
    .filter(Boolean);
  return pinned.length ? pinned : [...HOME_ANNOUNCEMENT_FALLBACKS];
}

export function getTickerOverflowDistance(viewportWidth: number, textWidth: number): number {
  if (viewportWidth <= 0 || textWidth <= viewportWidth) return 0;
  return textWidth - viewportWidth;
}

export function getHomeProductCardWidth(
  category: CatalogProduct["category"],
  viewportWidth: number,
  horizontalGutter: number,
): number {
  if (category !== "kuji") return HOME_PRODUCT_CARD_WIDTH;
  const availableWidth = Math.max(HOME_PRODUCT_CARD_WIDTH, viewportWidth - horizontalGutter * 2);
  return Math.min(HOME_KUJI_CARD_MAX_WIDTH, availableWidth);
}

export function buildDrawActivityTickerWindow<Item extends { id: string }>(
  items: readonly Item[],
  startIndex: number,
  visibleRows: number,
): Item[] {
  if (!items.length || visibleRows <= 0) return [];
  const visibleCount = Math.min(items.length, Math.max(1, Math.floor(visibleRows)));
  const windowLength = items.length > 1 ? visibleCount + 1 : visibleCount;
  const normalizedStart = ((startIndex % items.length) + items.length) % items.length;
  return Array.from(
    { length: windowLength },
    (_, offset) => items[(normalizedStart + offset) % items.length]!,
  );
}

export function buildDrawActivityExamples(
  products: readonly HomeProduct[],
  ips: readonly HomeIp[],
  productNameForActivity: (productName: string, ipName?: string | null) => string,
): DrawActivityItem[] {
  const ipNameById = new Map(ips.map((ip) => [ip.id, ip.nameKo]));
  return products
    .filter((product) => product.isActive && !product.isPrizeOnly && (product.category === "gacha" || product.category === "kuji"))
    .slice(0, DRAW_ACTIVITY_NAMES.length)
    .map((product, index) => {
      const personName = DRAW_ACTIVITY_NAMES[index] ?? "뽑기친구";
      const productName = productNameForActivity(product.name, ipNameById.get(product.ipId));
      const particle = objectParticle(productName);
      return {
        id: `draw-example-${product.id}`,
        productId: product.id,
        personName,
        productName,
        objectParticle: particle,
        message: `${personName}님이 ${productName}${particle} 뽑았어요`,
        isExample: true,
      };
    });
}

function objectParticle(value: string): "을" | "를" {
  const lastCharacter = [...value.trim()].at(-1);
  if (!lastCharacter) return "을";
  const codePoint = lastCharacter.codePointAt(0) ?? 0;
  if (codePoint >= 0xac00 && codePoint <= 0xd7a3) {
    return (codePoint - 0xac00) % 28 === 0 ? "를" : "을";
  }
  return /[013678]$/.test(lastCharacter) ? "을" : "를";
}
