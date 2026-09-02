import { randomUUID } from "expo-crypto";
import { errorMessage } from "@dabboba/api-client";
import type { CatalogProduct, ExchangeListing, ExchangeOffer, InventoryUnit } from "@dabboba/contracts";
import { PRODUCT_CATEGORY_VALUES } from "@/features/catalog/product-categories";
import { createMobileDabbobaClient as createDabbobaClient } from "@/lib/mobile-api-client";

export type ExchangeCategory = CatalogProduct["category"];

export type ExchangeCardItem = {
  id: string;
  isExample: boolean;
  title: string;
  details: string;
  product: CatalogProduct;
  authorNickname: string;
  offerCount: number;
};

export type ExchangeRoomSnapshot = {
  items: ExchangeCardItem[];
  ipNames: Record<string, string>;
  ipSearchTerms: Record<string, string>;
  fetchedAt: string;
};

export type ExchangeProposalItem = {
  id: string;
  isExample: boolean;
  proposerId: string;
  proposerNickname: string;
  product: CatalogProduct;
  status: ExchangeOffer["status"];
};

export type ExchangeOfferInventorySnapshot = {
  items: InventoryUnit[];
  ipNames: Record<string, string>;
};

export type ExchangeListingInventorySnapshot = ExchangeOfferInventorySnapshot;

export type ExchangeDetailSnapshot = {
  item: ExchangeCardItem;
  ipName: string | null;
  ipNames: Record<string, string>;
  proposals: ExchangeProposalItem[];
  viewerRole: "AUTHOR" | "VISITOR";
  listingStatus: ExchangeListing["status"];
};

const EXAMPLE_PREFIX = "example__";
const EXAMPLE_AUTHORS = ["모찌수집가", "럭키캡슐", "피규어정원", "카드한장"] as const;
const EXAMPLE_PROPOSERS = ["애니콜렉터", "럭키덕후", "카드여행자", "쿠지마스터"] as const;

export async function fetchExchangeRoom(
  apiBaseUrl: string,
  category?: ExchangeCategory,
  query?: string,
  includePreview = false,
): Promise<ExchangeRoomSnapshot> {
  const search = query?.trim() || undefined;
  const client = createDabbobaClient({ baseUrl: apiBaseUrl, requestId: randomUUID });
  const [listingResult, ipResult] = await Promise.all([
    client.GET("/v1/exchange/listings", {
      params: { query: { limit: 30, category, q: search } },
    }),
    client.GET("/v1/catalog/ips", {
      params: { query: { limit: 100 } },
    }),
  ]);

  if (!listingResult.data) {
    throw new Error(errorMessage(listingResult.error, "교환 글을 불러오지 못했습니다."));
  }
  if (!ipResult.data) {
    throw new Error(errorMessage(ipResult.error, "작품 정보를 불러오지 못했습니다."));
  }

  const ipNames = Object.fromEntries(ipResult.data.items.map((ip) => [ip.id, ip.nameKo]));
  const ipSearchTerms = Object.fromEntries(ipResult.data.items.map((ip) => [
    ip.id,
    [ip.nameKo, ip.nameEn, ip.nameJa ?? "", ...ip.aliases].join(" "),
  ]));
  let items = listingResult.data.items
    .filter((listing) => listing.offeredInventory.sourceType === "GACHA")
    .map(toCardItem);

  if (items.length === 0 && includePreview) {
    const productResult = await client.GET("/v1/catalog/products", {
      params: { query: { limit: 100, category } },
    });
    if (!productResult.data) {
      throw new Error(errorMessage(productResult.error, "상품 정보를 불러오지 못했습니다."));
    }
    items = createExampleItems(productResult.data.items, category, search, ipSearchTerms);
  }

  return { items, ipNames, ipSearchTerms, fetchedAt: new Date().toISOString() };
}

export async function fetchExchangeDetail(
  apiBaseUrl: string,
  itemId: string,
  accessToken?: string,
): Promise<ExchangeDetailSnapshot> {
  const client = createDabbobaClient({
    baseUrl: apiBaseUrl,
    requestId: randomUUID,
    ...(accessToken ? { token: () => accessToken } : {}),
  });
  const ipResult = await client.GET("/v1/catalog/ips", {
    params: { query: { limit: 100 } },
  });
  if (!ipResult.data) {
    throw new Error(errorMessage(ipResult.error, "작품 정보를 불러오지 못했습니다."));
  }

  const ipNames = Object.fromEntries(ipResult.data.items.map((ip) => [ip.id, ip.nameKo]));
  if (itemId.startsWith(EXAMPLE_PREFIX)) {
    const productId = itemId.slice(EXAMPLE_PREFIX.length);
    const productResult = await client.GET("/v1/catalog/products", {
      params: { query: { limit: 100 } },
    });
    if (!productResult.data) {
      throw new Error(errorMessage(productResult.error, "상품 정보를 불러오지 못했습니다."));
    }
    const item = createExampleItems(productResult.data.items).find(
      (candidate) => candidate.product.id === productId,
    );
    if (!item) throw new Error("교환 글을 찾을 수 없습니다.");
    return {
      item,
      ipName: ipNames[item.product.ipId] ?? null,
      ipNames,
      proposals: createExampleProposals(productResult.data.items, item.product.id),
      viewerRole: "AUTHOR",
      listingStatus: "OPEN",
    };
  }

  const [listingResult, meResult] = await Promise.all([
    client.GET("/v1/exchange/listings/{listingId}", {
      params: { path: { listingId: itemId } },
    }),
    accessToken
      ? client.GET("/v1/auth/me")
      : Promise.resolve({ data: undefined }),
  ]);
  if (!listingResult.data) {
    throw new Error(errorMessage(listingResult.error, "교환 글을 불러오지 못했습니다."));
  }

  const listing = listingResult.data;
  if (listing.offeredInventory.sourceType !== "GACHA") {
    throw new Error("가챠로 뽑은 상품만 교환할 수 있어요.");
  }
  const item = toCardItem(listing);
  return {
    item,
    ipName: ipNames[item.product.ipId] ?? null,
    ipNames,
    proposals: (listing.offers ?? [])
      .filter((offer) => offer.offeredInventory.sourceType === "GACHA")
      .map(toProposalItem),
    viewerRole: meResult.data?.actor.userId === listing.authorId ? "AUTHOR" : "VISITOR",
    listingStatus: listing.status,
  };
}

export async function decideExchangeOffer(
  apiBaseUrl: string,
  accessToken: string,
  listingId: string,
  offerId: string,
  decision: "ACCEPTED" | "REJECTED",
): Promise<ExchangeOffer> {
  const client = createDabbobaClient({
    baseUrl: apiBaseUrl,
    token: () => accessToken,
    requestId: randomUUID,
  });
  const result = await client.POST("/v1/exchange/listings/{listingId}/offers/{offerId}/decision", {
    params: {
      path: { listingId, offerId },
      header: { "Idempotency-Key": randomUUID() },
    },
    body: { decision },
  });
  if (!result.data) {
    throw new Error(errorMessage(result.error, "교환 제안을 처리하지 못했습니다."));
  }
  return result.data;
}

export async function fetchExchangeOfferInventory(
  apiBaseUrl: string,
  accessToken: string,
): Promise<ExchangeOfferInventorySnapshot> {
  const snapshot = await fetchExchangeInventory(apiBaseUrl, accessToken);
  return {
    ...snapshot,
    items: snapshot.items.filter(isDrawnExchangeInventory),
  };
}

export async function fetchExchangeListingInventory(
  apiBaseUrl: string,
  accessToken: string,
): Promise<ExchangeListingInventorySnapshot> {
  const snapshot = await fetchExchangeInventory(apiBaseUrl, accessToken);
  return {
    ...snapshot,
    items: snapshot.items.filter(isDrawnExchangeInventory),
  };
}

async function fetchExchangeInventory(
  apiBaseUrl: string,
  accessToken: string,
): Promise<ExchangeListingInventorySnapshot> {
  const client = createDabbobaClient({
    baseUrl: apiBaseUrl,
    token: () => accessToken,
    requestId: randomUUID,
  });
  const [inventoryResult, ipResult] = await Promise.all([
    client.GET("/v1/exchange/inventory", { params: { query: { limit: 100 } } }),
    client.GET("/v1/catalog/ips", { params: { query: { limit: 100 } } }),
  ]);
  if (!inventoryResult.data) {
    throw new Error(errorMessage(inventoryResult.error, "보관함 상품을 불러오지 못했습니다."));
  }
  if (!ipResult.data) {
    throw new Error(errorMessage(ipResult.error, "작품 정보를 불러오지 못했습니다."));
  }
  return {
    items: inventoryResult.data.items,
    ipNames: Object.fromEntries(ipResult.data.items.map((ip) => [ip.id, ip.nameKo])),
  };
}

export function isDrawnExchangeInventory(item: InventoryUnit): boolean {
  return item.status === "OWNED" && item.sourceType === "GACHA";
}

export async function createExchangeListing(
  apiBaseUrl: string,
  accessToken: string,
  input: {
    title: string;
    details: string;
    offeredInventoryUnitId: string;
  },
): Promise<ExchangeListing> {
  const client = createDabbobaClient({
    baseUrl: apiBaseUrl,
    token: () => accessToken,
    requestId: randomUUID,
  });
  const result = await client.POST("/v1/exchange/listings", {
    params: { header: { "Idempotency-Key": randomUUID() } },
    body: input,
  });
  if (!result.data) {
    throw new Error(errorMessage(result.error, "교환 상품을 올리지 못했습니다."));
  }
  return result.data;
}

export async function createExchangeOffer(
  apiBaseUrl: string,
  accessToken: string,
  listingId: string,
  offeredInventoryUnitId: string,
): Promise<ExchangeOffer> {
  const client = createDabbobaClient({
    baseUrl: apiBaseUrl,
    token: () => accessToken,
    requestId: randomUUID,
  });
  const result = await client.POST("/v1/exchange/listings/{listingId}/offers", {
    params: {
      path: { listingId },
      header: { "Idempotency-Key": randomUUID() },
    },
    body: { offeredInventoryUnitId },
  });
  if (!result.data) {
    throw new Error(errorMessage(result.error, "교환 신청을 보내지 못했습니다."));
  }
  return result.data;
}

function toCardItem(listing: ExchangeListing): ExchangeCardItem {
  return {
    id: listing.id,
    isExample: false,
    title: listing.title,
    details: listing.details,
    product: listing.offeredInventory.product,
    authorNickname: listing.authorNickname,
    offerCount: listing.offerCount,
  };
}

function toProposalItem(offer: ExchangeOffer): ExchangeProposalItem {
  return {
    id: offer.id,
    isExample: false,
    proposerId: offer.proposerId,
    proposerNickname: offer.proposerNickname,
    product: offer.offeredInventory.product,
    status: offer.status,
  };
}

function createExampleItems(
  products: CatalogProduct[],
  selectedCategory?: ExchangeCategory,
  search?: string,
  ipNames: Record<string, string> = {},
): ExchangeCardItem[] {
  const categories: ExchangeCategory[] = selectedCategory
    ? [selectedCategory]
    : [...PRODUCT_CATEGORY_VALUES];

  return categories.flatMap((category, categoryIndex) => {
    const categoryItems = products
      .filter((product) => product.category === category && product.imageUrl && product.isActive)
      .map((product, index) => ({
        id: `${EXAMPLE_PREFIX}${product.id}`,
        isExample: true,
        title: exampleTitle(category, index),
        details: "",
        product,
        authorNickname: EXAMPLE_AUTHORS[(categoryIndex + index) % EXAMPLE_AUTHORS.length] ?? "다뽑아회원",
        offerCount: 4,
      }));
    return (search ? filterExchangeItems(categoryItems, ipNames, search) : categoryItems).slice(0, 2);
  });
}

export function filterExchangeItems(
  items: ExchangeCardItem[],
  ipNames: Record<string, string>,
  query: string,
): ExchangeCardItem[] {
  const search = normalizeExchangeSearch(query);
  if (!search) return items;
  return items.filter((item) => normalizeExchangeSearch([
    item.title,
    item.details,
    item.product.name,
    item.product.sku,
    item.product.manufacturer ?? "",
    ipNames[item.product.ipId] ?? "",
  ].join(" ")).includes(search));
}

export function normalizeExchangeSearch(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ko-KR").replace(/\s+/g, " ");
}

function createExampleProposals(
  products: CatalogProduct[],
  listedProductId: string,
): ExchangeProposalItem[] {
  return products
    .filter((product) => (
      product.id !== listedProductId
      && (product.category === "gacha" || product.category === "kuji")
      && product.imageUrl
      && product.isActive
    ))
    .slice(0, 4)
    .map((product, index) => ({
      id: `example-offer__${product.id}`,
      isExample: true,
      proposerId: `example-proposer-${index + 1}`,
      proposerNickname: EXAMPLE_PROPOSERS[index] ?? `수집가${index + 1}`,
      product,
      status: "PENDING",
    }));
}

function exampleTitle(category: ExchangeCategory, index: number): string {
  const titles: Record<ExchangeCategory, readonly [string, string]> = {
    gacha: ["중복으로 나온 가챠 교환해요", "찾던 분과 캡슐 굿즈 교환 원해요"],
    figure: ["미개봉 피규어 교환합니다", "소장용 피규어 좋은 분께 교환해요"],
    kuji: ["중복 쿠지 경품 교환해요", "원하던 경품과 교환하고 싶어요"],
    tcg: ["카드 상품 서로 교환해요", "컬렉션 채우려고 카드 교환 구해요"],
  };
  return titles[category][index] ?? titles[category][0];
}

export function categoryLabel(category: ExchangeCategory): string {
  if (category === "gacha") return "가챠";
  if (category === "figure") return "피규어";
  if (category === "kuji") return "쿠지";
  return "카드";
}
