import { randomUUID } from "expo-crypto";
import { errorMessage } from "@dabboba/api-client";
import type { CatalogProduct, ExchangeListing, ExchangeOffer, InventoryUnit } from "@dabboba/contracts";
import { customerProductCategoryValues, productCategoryLabel } from "@/features/catalog/product-categories";
import {
  areCustomerVisibleExchangeProducts,
  isCustomerEligibleExchangeInventory,
  isCustomerVisibleExchangeBundle,
} from "@/features/exchange/exchange-visibility";
import { createMobileDabbobaClient as createDabbobaClient } from "@/lib/mobile-api-client";
import { ProfileApiError } from "@/features/profile/profile-api";

export type ExchangeCategory = CatalogProduct["category"];

export type ExchangeCardItem = {
  id: string;
  isExample: boolean;
  authorId: string;
  title: string;
  details: string;
  product: CatalogProduct;
  products: CatalogProduct[];
  authorNickname: string;
  offerCount: number;
  status: ExchangeListing["status"];
  expiresAt: string;
  storageExpiresAt: string | null;
};

export type ExchangeRoomSnapshot = {
  items: ExchangeCardItem[];
  ipNames: Record<string, string>;
  ipSearchTerms: Record<string, string>;
  fetchedAt: string;
};

export type ExchangeActivitySnapshot = {
  authored: ExchangeCardItem[];
  applied: ExchangeCardItem[];
  ipNames: Record<string, string>;
};

export type ExchangeProposalItem = {
  id: string;
  isExample: boolean;
  proposerId: string;
  proposerNickname: string;
  product: CatalogProduct;
  products: CatalogProduct[];
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
const EXAMPLE_AUTHORS = ["모찌수집가", "럭키캡슐", "피규어정원", "굿즈한상자"] as const;
const EXAMPLE_PROPOSERS = ["애니콜렉터", "럭키덕후", "굿즈여행자", "쿠지마스터"] as const;

export async function fetchExchangeRoom(
  apiBaseUrl: string,
  category?: ExchangeCategory,
  query?: string,
  includePreview = false,
  accessToken?: string,
): Promise<ExchangeRoomSnapshot> {
  const search = query?.trim() || undefined;
  const client = createDabbobaClient({
    baseUrl: apiBaseUrl,
    requestId: randomUUID,
    ...(accessToken ? { token: () => accessToken } : {}),
  });
  const [listingResult, ipResult] = await Promise.all([
    client.GET("/v1/exchange/listings", {
      params: { query: { limit: 30, category, q: search } },
    }),
    client.GET("/v1/catalog/ips", {
      params: { query: { limit: 100 } },
    }),
  ]);

  if (!listingResult.data) {
    throw new Error(errorMessage(listingResult.error, "교환 글을 불러오지 못했어요."));
  }
  if (!ipResult.data) {
    throw new Error(errorMessage(ipResult.error, "작품 정보를 불러오지 못했어요."));
  }

  const ipNames = Object.fromEntries(ipResult.data.items.map((ip) => [ip.id, ip.nameKo]));
  const ipSearchTerms = Object.fromEntries(ipResult.data.items.map((ip) => [
    ip.id,
    [ip.nameKo, ip.nameEn, ip.nameJa ?? "", ...ip.aliases].join(" "),
  ]));
  let items = listingResult.data.items
    .filter((listing) => isCustomerVisibleExchangeBundle(exchangeListingInventories(listing)))
    .map(toCardItem);

  if (items.length === 0 && includePreview) {
    const productResult = await client.GET("/v1/catalog/products", {
      params: { query: { limit: 100, category } },
    });
    if (!productResult.data) {
      throw new Error(errorMessage(productResult.error, "상품 정보를 불러오지 못했어요."));
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
    throw new Error(errorMessage(ipResult.error, "작품 정보를 불러오지 못했어요."));
  }

  const ipNames = Object.fromEntries(ipResult.data.items.map((ip) => [ip.id, ip.nameKo]));
  if (itemId.startsWith(EXAMPLE_PREFIX)) {
    const productId = itemId.slice(EXAMPLE_PREFIX.length);
    const productResult = await client.GET("/v1/catalog/products", {
      params: { query: { limit: 100 } },
    });
    if (!productResult.data) {
      throw new Error(errorMessage(productResult.error, "상품 정보를 불러오지 못했어요."));
    }
    const item = createExampleItems(productResult.data.items).find(
      (candidate) => candidate.product.id === productId,
    );
    if (!item) throw new Error("교환 글을 찾을 수 없어요.");
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
    throw new Error(errorMessage(listingResult.error, "교환 글을 불러오지 못했어요."));
  }

  const listing = listingResult.data;
  const listingInventories = exchangeListingInventories(listing);
  if (!listingInventories.every((inventory) => inventory.sourceType === "GACHA")) {
    throw new Error("가챠로 뽑은 상품만 교환할 수 있어요.");
  }
  if (!areCustomerVisibleExchangeProducts(listingInventories.map((inventory) => inventory.product))) {
    throw new Error("현재 참여할 수 없는 교환 상품이에요.");
  }
  const item = toCardItem(listing);
  return {
    item,
    ipName: ipNames[item.product.ipId] ?? null,
    ipNames,
    proposals: (listing.offers ?? [])
      .filter((offer) => isCustomerVisibleExchangeBundle(exchangeOfferInventories(offer)))
      .map(toProposalItem),
    viewerRole: meResult.data?.actor.userId === listing.authorId ? "AUTHOR" : "VISITOR",
    listingStatus: listing.status,
  };
}

export async function fetchMyExchangeActivity(
  apiBaseUrl: string,
  accessToken: string,
): Promise<ExchangeActivitySnapshot> {
  const client = createDabbobaClient({
    baseUrl: apiBaseUrl,
    token: () => accessToken,
    requestId: randomUUID,
  });
  const [activityResult, ipResult] = await Promise.all([
    client.GET("/v1/exchange/activity", {}),
    client.GET("/v1/catalog/ips", { params: { query: { limit: 100 } } }),
  ]);
  if (!activityResult.data) {
    throw new ProfileApiError(
      activityResult.response.status,
      errorMessage(activityResult.error, "내 교환 현황을 불러오지 못했어요."),
    );
  }
  if (!ipResult.data) {
    throw new ProfileApiError(
      ipResult.response.status,
      errorMessage(ipResult.error, "작품 정보를 불러오지 못했어요."),
    );
  }
  return {
    authored: activityResult.data.authored
      .filter((listing) => isCustomerVisibleExchangeBundle(exchangeListingInventories(listing)))
      .map(toCardItem),
    applied: activityResult.data.applied
      .filter((listing) => isCustomerVisibleExchangeBundle(exchangeListingInventories(listing)))
      .map(toCardItem),
    ipNames: Object.fromEntries(ipResult.data.items.map((ip) => [ip.id, ip.nameKo])),
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
    throw new Error(errorMessage(result.error, "교환 제안을 처리하지 못했어요."));
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
    throw new ProfileApiError(inventoryResult.response.status, errorMessage(inventoryResult.error, "보관함 상품을 불러오지 못했어요."));
  }
  if (!ipResult.data) {
    throw new ProfileApiError(ipResult.response.status, errorMessage(ipResult.error, "작품 정보를 불러오지 못했어요."));
  }
  return {
    items: inventoryResult.data.items,
    ipNames: Object.fromEntries(ipResult.data.items.map((ip) => [ip.id, ip.nameKo])),
  };
}

export function isDrawnExchangeInventory(item: InventoryUnit): boolean {
  return isCustomerEligibleExchangeInventory(item);
}

export async function createExchangeListing(
  apiBaseUrl: string,
  accessToken: string,
  input: {
    title: string;
    details: string;
    offeredInventoryUnitIds: string[];
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
    throw new Error(errorMessage(result.error, "교환 상품을 올리지 못했어요."));
  }
  return result.data;
}

export async function createExchangeOffer(
  apiBaseUrl: string,
  accessToken: string,
  listingId: string,
  offeredInventoryUnitIds: string[],
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
    body: { offeredInventoryUnitIds },
  });
  if (!result.data) {
    throw new Error(errorMessage(result.error, "교환 신청을 보내지 못했어요."));
  }
  return result.data;
}

function toCardItem(listing: ExchangeListing): ExchangeCardItem {
  const products = exchangeListingInventories(listing).map((inventory) => inventory.product);
  return {
    id: listing.id,
    isExample: false,
    authorId: listing.authorId,
    title: listing.title,
    details: listing.details,
    product: products[0] ?? listing.offeredInventory.product,
    products,
    authorNickname: listing.authorNickname,
    offerCount: listing.offerCount,
    status: listing.status,
    expiresAt: listing.expiresAt,
    storageExpiresAt: listing.offeredInventory.storageExpiresAt ?? null,
  };
}

function toProposalItem(offer: ExchangeOffer): ExchangeProposalItem {
  const products = exchangeOfferInventories(offer).map((inventory) => inventory.product);
  return {
    id: offer.id,
    isExample: false,
    proposerId: offer.proposerId,
    proposerNickname: offer.proposerNickname,
    product: products[0] ?? offer.offeredInventory.product,
    products,
    status: offer.status,
  };
}

function exchangeListingInventories(listing: ExchangeListing): InventoryUnit[] {
  return listing.offeredInventories?.length ? listing.offeredInventories : [listing.offeredInventory];
}

function exchangeOfferInventories(offer: ExchangeOffer): InventoryUnit[] {
  return offer.offeredInventories?.length ? offer.offeredInventories : [offer.offeredInventory];
}

function createExampleItems(
  products: CatalogProduct[],
  selectedCategory?: ExchangeCategory,
  search?: string,
  ipNames: Record<string, string> = {},
): ExchangeCardItem[] {
  const categories: ExchangeCategory[] = selectedCategory === "tcg"
    ? []
    : selectedCategory
      ? [selectedCategory]
      : customerProductCategoryValues("exchange");

  return categories.flatMap((category, categoryIndex) => {
    const categoryItems = products
      .filter((product) => product.category === category && product.imageUrl && product.isActive)
      .map((product, index) => ({
        id: `${EXAMPLE_PREFIX}${product.id}`,
        isExample: true,
        authorId: `40000000-0000-4000-8000-${String(categoryIndex * 10 + index + 1).padStart(12, "0")}`,
        title: exampleTitle(category, index),
        details: "",
        product,
        products: [product],
        authorNickname: EXAMPLE_AUTHORS[(categoryIndex + index) % EXAMPLE_AUTHORS.length] ?? "다뽑아회원",
        offerCount: 4,
        status: "OPEN" as const,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        storageExpiresAt: null,
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
    ...item.products.flatMap((product) => [
      product.name,
      product.sku,
      product.manufacturer ?? "",
      ipNames[product.ipId] ?? "",
    ]),
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
      products: [product],
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
  return productCategoryLabel(category);
}
