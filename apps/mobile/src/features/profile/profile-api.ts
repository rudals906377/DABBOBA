import { randomUUID } from "expo-crypto";
import { errorMessage } from "@dabboba/api-client";
import type { CatalogProduct, components } from "@dabboba/contracts";
import {
  isCustomerBrowsableCatalogCategory,
  isCustomerVisibleProductCategory,
} from "@/features/catalog/product-categories";
import { createMobileDabbobaClient as createDabbobaClient } from "@/lib/mobile-api-client";

type Actor = components["schemas"]["UserActor"];
type AccountProfile = components["schemas"]["AccountProfile"];
type AccountBasicInfo = components["schemas"]["AccountBasicInfo"];
type DefaultAddress = components["schemas"]["DefaultShippingAddress"];
type WishlistItem = components["schemas"]["WishlistItem"];
type InventoryUnit = components["schemas"]["InventoryUnit"];
type AccountOrder = components["schemas"]["AccountOrder"];
type PointLedgerEntry = components["schemas"]["PointLedgerEntry"];
type ShippingRequest = components["schemas"]["AccountShippingRequest"];
type WantedRequest = components["schemas"]["WantedRequest"];
type Notice = components["schemas"]["Notice"];
type Inquiry = components["schemas"]["Inquiry"];
type NotificationPreferences = components["schemas"]["NotificationPreferences"];

export type ProfileWantedRequest = WantedRequest & { mediaUrl: string | null };

export type ProfileSnapshot = {
  isExample: boolean;
  catalogProducts: CatalogProduct[];
  ipNames: Record<string, string>;
  actor: Actor | null;
  profile: AccountProfile;
  basicInfo: AccountBasicInfo;
  defaultAddress: DefaultAddress | null;
  wishlist: WishlistItem[];
  inventory: InventoryUnit[];
  orders: AccountOrder[];
  pointBalance: number;
  pointHistory: PointLedgerEntry[];
  shippingRequests: ShippingRequest[];
  wantedRequests: ProfileWantedRequest[];
  notices: Notice[];
  inquiries: Inquiry[];
  notificationPreferences: NotificationPreferences;
  fetchedAt: string;
};

export type PointReturnResult = {
  id: string;
  inventoryUnitIds: string[];
  totalPointAmount: number;
  balance: number;
  returnedAt: string;
};

export class ProfileApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ProfileApiError";
    this.status = status;
  }
}

const IDS = {
  user: "10000000-0000-4000-8000-000000000001",
  wishlistOne: "10000000-0000-4000-8000-000000000011",
  wishlistTwo: "10000000-0000-4000-8000-000000000012",
  inventoryOne: "10000000-0000-4000-8000-000000000021",
  inventoryTwo: "10000000-0000-4000-8000-000000000022",
  shippedInventory: "10000000-0000-4000-8000-000000000023",
  order: "10000000-0000-4000-8000-000000000031",
  pointOne: "10000000-0000-4000-8000-000000000041",
  pointTwo: "10000000-0000-4000-8000-000000000042",
  shipping: "10000000-0000-4000-8000-000000000051",
  wanted: "10000000-0000-4000-8000-000000000061",
  notice: "10000000-0000-4000-8000-000000000071",
  inquiry: "10000000-0000-4000-8000-000000000081",
  address: "10000000-0000-4000-8000-000000000091",
} as const;

export async function fetchProfileSnapshot(
  apiBaseUrl: string,
  accessToken?: string,
): Promise<ProfileSnapshot> {
  const client = createDabbobaClient({
    baseUrl: apiBaseUrl,
    requestId: randomUUID,
    ...(accessToken ? { token: () => accessToken } : {}),
  });

  const [productsResult, ipsResult, wantedResult, noticesResult] = await Promise.all([
    client.GET("/v1/catalog/products", { params: { query: { limit: 100 } } }),
    client.GET("/v1/catalog/ips", { params: { query: { limit: 100 } } }),
    client.GET("/v1/wanted-requests", { params: { query: { limit: 20 } } }),
    client.GET("/v1/notices", { params: { query: { limit: 20 } } }),
  ]);
  const products = productsResult.data?.items ?? [];
  const ipNames = Object.fromEntries(
    (ipsResult.data?.items ?? []).map((ip) => [ip.id, ip.nameKo]),
  );
  const wantedRequests = await attachWantedMediaUrls(
    client,
    (wantedResult.data?.items ?? []).filter((request) => (
      isCustomerVisibleProductCategory(request.category)
    )),
  );

  if (!accessToken) {
    if (!products.length) {
      throw new Error(errorMessage(productsResult.error, "상품 정보를 불러오지 못했습니다."));
    }
    return createExampleSnapshot(
      products,
      ipNames,
      wantedRequests,
      noticesResult.data?.items ?? [],
    );
  }

  const [
    meResult,
    profileResult,
    basicInfoResult,
    addressResult,
    wishlistResult,
    inventoryResult,
    ordersResult,
    pointsResult,
    shippingResult,
    inquiriesResult,
    preferencesResult,
  ] = await Promise.all([
    client.GET("/v1/auth/me"),
    client.GET("/v1/account/profile"),
    client.GET("/v1/account/basic-info"),
    client.GET("/v1/account/default-address"),
    client.GET("/v1/account/wishlist", { params: { query: { limit: 50 } } }),
    client.GET("/v1/account/inventory", { params: { query: { limit: 50 } } }),
    client.GET("/v1/account/orders", { params: { query: { limit: 50 } } }),
    client.GET("/v1/account/points", { params: { query: { limit: 50 } } }),
    client.GET("/v1/account/shipping-requests", { params: { query: { limit: 50 } } }),
    client.GET("/v1/inquiries", { params: { query: { limit: 30 } } }),
    client.GET("/v1/account/notification-preferences"),
  ]);

  if (!meResult.data || !profileResult.data || !basicInfoResult.data) {
    const failed = !meResult.data ? meResult : !profileResult.data ? profileResult : basicInfoResult;
    throw new ProfileApiError(
      failed.response.status,
      errorMessage(failed.error, "로그인 정보를 확인하지 못했습니다."),
    );
  }
  if (!pointsResult.data || !preferencesResult.data) {
    const failed = !pointsResult.data ? pointsResult : preferencesResult;
    throw new ProfileApiError(
      failed.response.status,
      errorMessage(failed.error, "내정보를 모두 불러오지 못했습니다."),
    );
  }

  return {
    isExample: false,
    catalogProducts: products,
    ipNames,
    actor: meResult.data.actor,
    profile: profileResult.data,
    basicInfo: basicInfoResult.data,
    defaultAddress: addressResult.data ?? null,
    wishlist: (wishlistResult.data?.items ?? []).filter((item) => (
      isCustomerBrowsableCatalogCategory(item.product.category)
    )),
    inventory: inventoryResult.data?.items ?? [],
    orders: ordersResult.data?.items ?? [],
    pointBalance: pointsResult.data.balance,
    pointHistory: pointsResult.data.items,
    shippingRequests: shippingResult.data?.items ?? [],
    wantedRequests,
    notices: noticesResult.data?.items ?? [],
    inquiries: inquiriesResult.data?.items ?? [],
    notificationPreferences: preferencesResult.data,
    fetchedAt: new Date().toISOString(),
  };
}

export async function updateAccountProfile(
  apiBaseUrl: string,
  accessToken: string,
  input: { nickname: string; bio: string | null; expectedVersion: number },
): Promise<AccountProfile> {
  const client = authorizedClient(apiBaseUrl, accessToken);
  const result = await client.PATCH("/v1/account/profile", {
    params: { header: { "Idempotency-Key": randomUUID() } },
    body: input,
  });
  if (!result.data) throw new Error(errorMessage(result.error, "프로필을 저장하지 못했습니다."));
  return result.data;
}

export async function updateAccountBasicInfo(
  apiBaseUrl: string,
  accessToken: string,
  input: components["schemas"]["UpdateAccountBasicInfoInput"],
): Promise<AccountBasicInfo> {
  const client = authorizedClient(apiBaseUrl, accessToken);
  const result = await client.PATCH("/v1/account/basic-info", {
    params: { header: { "Idempotency-Key": randomUUID() } },
    body: input,
  });
  if (!result.data) throw new Error(errorMessage(result.error, "계정 기본정보를 저장하지 못했습니다."));
  return result.data;
}

export async function removeWishlistItem(
  apiBaseUrl: string,
  accessToken: string,
  productId: string,
): Promise<void> {
  const client = authorizedClient(apiBaseUrl, accessToken);
  const result = await client.DELETE("/v1/account/wishlist/{productId}", {
    params: {
      path: { productId },
      header: { "Idempotency-Key": randomUUID() },
    },
  });
  if (!result.data) throw new Error(errorMessage(result.error, "찜을 해제하지 못했습니다."));
}

export async function createShippingRequest(
  apiBaseUrl: string,
  accessToken: string,
  inventoryUnitIds: string[],
): Promise<void> {
  const client = authorizedClient(apiBaseUrl, accessToken);
  const result = await client.POST("/v1/account/shipping-requests", {
    params: { header: { "Idempotency-Key": randomUUID() } },
    body: { inventoryUnitIds },
  });
  if (!result.data) throw new Error(errorMessage(result.error, "배송을 신청하지 못했습니다."));
}

export async function createPointReturn(
  apiBaseUrl: string,
  accessToken: string,
  inventoryUnitIds: string[],
): Promise<PointReturnResult> {
  const client = authorizedClient(apiBaseUrl, accessToken);
  const result = await client.POST("/v1/account/point-returns", {
    params: { header: { "Idempotency-Key": randomUUID() } },
    body: { inventoryUnitIds },
  });
  if (!result.data) throw new Error(errorMessage(result.error, "포인트 환급을 신청하지 못했습니다."));
  return result.data;
}

export async function setWantedRequestLike(
  apiBaseUrl: string,
  accessToken: string,
  requestId: string,
  liked: boolean,
): Promise<{ liked: boolean; likeCount: number }> {
  const client = authorizedClient(apiBaseUrl, accessToken);
  const result = await client.POST("/v1/wanted-requests/{requestId}/like", {
    params: {
      path: { requestId },
      header: { "Idempotency-Key": randomUUID() },
    },
    body: { liked },
  });
  if (!result.data) throw new Error(errorMessage(result.error, "신청방 반응을 저장하지 못했습니다."));
  return result.data;
}

export async function updateNotificationPreferences(
  apiBaseUrl: string,
  accessToken: string,
  input: components["schemas"]["UpdateNotificationPreferencesInput"],
): Promise<NotificationPreferences> {
  const client = authorizedClient(apiBaseUrl, accessToken);
  const result = await client.PUT("/v1/account/notification-preferences", {
    params: { header: { "Idempotency-Key": randomUUID() } },
    body: input,
  });
  if (!result.data) throw new Error(errorMessage(result.error, "알림 설정을 저장하지 못했습니다."));
  return result.data;
}

export async function logoutAccount(apiBaseUrl: string, accessToken: string): Promise<void> {
  const client = authorizedClient(apiBaseUrl, accessToken);
  const result = await client.POST("/v1/auth/logout", {});
  if (!result.response.ok) throw new Error(errorMessage(result.error, "로그아웃하지 못했습니다."));
}

function authorizedClient(apiBaseUrl: string, accessToken: string) {
  return createDabbobaClient({
    baseUrl: apiBaseUrl,
    token: () => accessToken,
    requestId: randomUUID,
  });
}

function createExampleSnapshot(
  products: CatalogProduct[],
  ipNames: Record<string, string>,
  publicWanted: ProfileWantedRequest[],
  publicNotices: Notice[],
): ProfileSnapshot {
  const now = new Date();
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const first = products[0]!;
  const second = products[1] ?? first;
  const browsableProducts = products.filter((product) => (
    isCustomerBrowsableCatalogCategory(product.category)
  ));
  const wishlist = browsableProducts.slice(0, 2).map((product, index): WishlistItem => ({
    id: index === 0 ? IDS.wishlistOne : IDS.wishlistTwo,
    product: {
      id: product.id,
      name: product.name,
      ipId: product.ipId,
      ipNameKo: ipNames[product.ipId] ?? "등록 작품",
      category: product.category,
      price: product.price,
      imageUrl: product.imageUrl,
      isActive: product.isActive,
    },
    wishedAt: daysAgo(index + 2),
  }));
  const inventoryProducts = [first, second];
  const inventoryIds = [IDS.inventoryOne, IDS.inventoryTwo];
  const inventory = inventoryProducts.map((product, index): InventoryUnit => ({
    id: inventoryIds[index]!,
    ownerId: IDS.user,
    productId: product.id,
    product,
    sourceType: index === 0 ? "GACHA" : "KUJI",
    status: "OWNED",
    acquiredAt: daysAgo(index + 3),
  }));
  const wantedFallbackProduct = products.find((product) => (
    isCustomerVisibleProductCategory(product.category)
  ));
  const wantedFallback: ProfileWantedRequest | null = wantedFallbackProduct ? {
    id: IDS.wanted,
    userId: IDS.user,
    authorNickname: "모찌수집가",
    category: wantedFallbackProduct.category,
    ipId: wantedFallbackProduct.ipId,
    ipNameKo: ipNames[wantedFallbackProduct.ipId] ?? "등록 작품",
    desiredItem: `${wantedFallbackProduct.name} 재입고를 기다려요`,
    details: "같이 기다리는 수집가가 얼마나 있는지 알려주세요.",
    mediaId: null,
    mediaUrl: null,
    status: "ACTIVE",
    likeCount: 18,
    likedByViewer: false,
    version: 1,
    createdAt: daysAgo(4),
    updatedAt: daysAgo(4),
  } : null;
  const noticeFallback: Notice = {
    id: IDS.notice,
    title: "DABBOBA 이용 안내",
    content: "공지와 운영 안내는 이곳에서 확인할 수 있어요.",
    isPinned: true,
    isPublished: true,
    status: "ACTIVE",
    createdBy: IDS.user,
    publishedAt: daysAgo(1),
    version: 1,
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
  };

  return {
    isExample: true,
    catalogProducts: products,
    ipNames,
    actor: null,
    profile: {
      id: IDS.user,
      nickname: "모찌수집가",
      bio: "좋아하는 작품을 천천히 모으는 중이에요.",
      favoriteIp: null,
      version: 1,
      updatedAt: daysAgo(1),
    },
    basicInfo: {
      id: IDS.user,
      nickname: "모찌수집가",
      email: "mobile-test@dabboba.local",
      phoneMasked: null,
      birthDate: null,
      version: 1,
      updatedAt: daysAgo(1),
    },
    defaultAddress: {
      id: IDS.address,
      recipient: "홍*동",
      phone: "010****1234",
      postalCode: "*****",
      addressLine1: "서울특별시 성동구 ****로",
      addressLine2: "상세주소는 로그인 후 표시",
      deliveryNote: "문 앞에 놓아주세요",
      version: 1,
      updatedAt: daysAgo(7),
    },
    wishlist,
    inventory,
    orders: [{
      id: IDS.order,
      status: "FULFILLED",
      currency: "KRW",
      subtotal: first.price,
      discountTotal: 0,
      pointTotal: 0,
      total: first.price,
      lines: [{
        productId: first.id,
        productName: first.name,
        category: first.category,
        unitPrice: first.price,
        quantity: 1,
        lineTotal: first.price,
      }],
      createdAt: daysAgo(5),
      updatedAt: daysAgo(5),
    }],
    pointBalance: 3_200,
    pointHistory: [
      { id: IDS.pointOne, entryType: "EARN", amount: 5_000, referenceType: "ORDER", referenceId: IDS.order, reason: "구매 적립", createdAt: daysAgo(5) },
      { id: IDS.pointTwo, entryType: "SPEND", amount: -1_800, referenceType: "ORDER", referenceId: IDS.order, reason: "주문 사용", createdAt: daysAgo(3) },
    ],
    shippingRequests: [{
      id: IDS.shipping,
      status: "PROCESSING",
      version: 1,
      inventoryUnitIds: [IDS.shippedInventory],
      destination: {
        recipientMasked: "홍*동",
        phoneMasked: "010****1234",
        postalCode: "*****",
        addressLine1: "서울특별시 성동구 ****로",
        addressLine2: null,
      },
      requestedAt: daysAgo(2),
      updatedAt: daysAgo(1),
      shippedAt: null,
      trackingCarrier: null,
      trackingNumber: null,
    }],
    wantedRequests: publicWanted.length
      ? publicWanted.filter((request) => isCustomerVisibleProductCategory(request.category))
      : wantedFallback ? [wantedFallback] : [],
    notices: publicNotices.length ? publicNotices : [noticeFallback],
    inquiries: [{
      id: IDS.inquiry,
      userId: IDS.user,
      category: "ORDER",
      title: "합배송 가능 여부가 궁금해요",
      status: "ANSWERED",
      assignedAdminId: null,
      createdAt: daysAgo(8),
      updatedAt: daysAgo(7),
    }],
    notificationPreferences: {
      orderUpdates: true,
      exchangeUpdates: true,
      requestUpdates: true,
      restockUpdates: true,
      marketingSms: false,
      marketingEmail: false,
      marketingPush: false,
      personalizedRecommendations: false,
      version: 1,
      updatedAt: daysAgo(1),
    },
    fetchedAt: now.toISOString(),
  };
}

async function attachWantedMediaUrls(
  client: ReturnType<typeof createDabbobaClient>,
  requests: WantedRequest[],
): Promise<ProfileWantedRequest[]> {
  return Promise.all(requests.map(async (request) => {
    if (!request.mediaId) return { ...request, mediaUrl: null };
    const result = await client.GET("/v1/media/{mediaId}/public-url", {
      params: { path: { mediaId: request.mediaId } },
    });
    return { ...request, mediaUrl: result.data?.url ?? null };
  }));
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

export function categoryLabel(category: CatalogProduct["category"]): string {
  if (category === "gacha") return "가챠";
  if (category === "figure") return "피규어";
  if (category === "kuji") return "쿠지";
  return "카드";
}
