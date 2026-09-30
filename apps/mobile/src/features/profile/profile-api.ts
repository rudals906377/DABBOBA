import { randomUUID } from "expo-crypto";
import { errorMessage } from "@dabboba/api-client";
import type { CatalogProduct, components } from "@dabboba/contracts";
import {
  isCustomerBrowsableCatalogCategory,
  isCustomerVisibleProductCategory,
} from "@/features/catalog/product-categories";
import { createMobileDabbobaClient as createDabbobaClient } from "@/lib/mobile-api-client";
import { createGuestSnapshot } from "@/features/profile/guest-profile-snapshot";

export { createGuestSnapshot } from "@/features/profile/guest-profile-snapshot";

type Actor = components["schemas"]["UserActor"];
type AccountProfile = components["schemas"]["AccountProfile"];
type AccountBasicInfo = components["schemas"]["AccountBasicInfo"];
type DefaultAddress = components["schemas"]["DefaultShippingAddress"];
type WishlistItem = components["schemas"]["WishlistItem"];
type InventoryUnit = components["schemas"]["InventoryUnit"];
type AccountOrder = components["schemas"]["AccountOrder"];
type PointLedgerEntry = components["schemas"]["PointLedgerEntry"];
type ShippingRequest = components["schemas"]["AccountShippingRequest"];
export type ShippingQuote = components["schemas"]["ShippingQuote"];
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
  /**
   * A missing address (404) is a valid `null`; a failed address request keeps
   * `null` and records `sectionErrors.address`.
   */
  defaultAddress: DefaultAddress | null;
  /**
   * Personal sections are `null` when their request failed (see
   * `sectionErrors`) or when the requested scope did not load them. A failed
   * personal-data request is never returned as an empty successful list or a
   * zero balance.
   */
  wishlist: WishlistItem[] | null;
  inventory: InventoryUnit[] | null;
  orders: AccountOrder[] | null;
  pointBalance: number | null;
  pointHistory: PointLedgerEntry[] | null;
  shippingRequests: ShippingRequest[] | null;
  wantedRequests: ProfileWantedRequest[];
  notices: Notice[];
  inquiries: Inquiry[] | null;
  notificationPreferences: NotificationPreferences | null;
  sectionErrors: Partial<Record<ProfileSnapshotSection, string>>;
  fetchedAt: string;
};

export type ProfileSnapshotSection =
  | "catalog"
  | "wanted"
  | "notices"
  | "profile"
  | "address"
  | "wishlist"
  | "inventory"
  | "orders"
  | "points"
  | "shipping"
  | "inquiries"
  | "preferences";

export type ProfileSnapshotScope = "full" | "storage";

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

export async function fetchProfileSnapshot(
  apiBaseUrl: string,
  accessToken?: string,
  options: { scope?: ProfileSnapshotScope } = {},
): Promise<ProfileSnapshot> {
  const client = createDabbobaClient({
    baseUrl: apiBaseUrl,
    requestId: randomUUID,
    ...(accessToken ? { token: () => accessToken } : {}),
  });

  if (options.scope === "storage") {
    return fetchStorageProfileSnapshot(client, accessToken);
  }

  const [productsResult, ipsResult, wantedResult, noticesResult] = await Promise.all([
    client.GET("/v1/catalog/products", { params: { query: { limit: 100 } } }),
    client.GET("/v1/catalog/ips", { params: { query: { limit: 100 } } }),
    client.GET("/v1/wanted-requests", { params: { query: { limit: 20 } } }),
    client.GET("/v1/notices", { params: { query: { limit: 20 } } }),
  ]);
  const sectionErrors: ProfileSnapshot["sectionErrors"] = {};
  if (!productsResult.data) {
    throw new ProfileApiError(
      productsResult.response.status,
      errorMessage(productsResult.error, "상품 정보를 불러오지 못했어요."),
    );
  }
  if (!ipsResult.data) {
    throw new ProfileApiError(
      ipsResult.response.status,
      errorMessage(ipsResult.error, "작품 정보를 불러오지 못했어요."),
    );
  }
  if (!wantedResult.data) sectionErrors.wanted = errorMessage(wantedResult.error, "신청방을 불러오지 못했어요.");
  if (!noticesResult.data) sectionErrors.notices = errorMessage(noticesResult.error, "공지사항을 불러오지 못했어요.");
  const products = productsResult.data.items;
  const ipNames = Object.fromEntries(
    ipsResult.data.items.map((ip) => [ip.id, ip.nameKo]),
  );
  const wantedRequests = await attachWantedMediaUrls(
    client,
    (wantedResult.data?.items ?? []).filter((request) => (
      isCustomerVisibleProductCategory(request.category)
    )),
  );
  const notices = noticesResult.data?.items ?? [];

  if (!accessToken) {
    return {
      ...createGuestSnapshot(
      products,
      ipNames,
      wantedRequests,
      notices,
      ),
      sectionErrors,
    };
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
    client.GET("/v1/account/inventory", { params: { query: { limit: 100 } } }),
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
      errorMessage(failed.error, "로그인 정보를 확인하지 못했어요."),
    );
  }
  const defaultAddress = addressResult.data ?? null;
  if (!addressResult.data && addressResult.response.status !== 404) {
    sectionErrors.address = errorMessage(addressResult.error, "기본 배송지를 불러오지 못했어요.");
  }
  if (!wishlistResult.data) sectionErrors.wishlist = errorMessage(wishlistResult.error, "찜 목록을 불러오지 못했어요.");
  if (!inventoryResult.data) sectionErrors.inventory = errorMessage(inventoryResult.error, "보관함을 불러오지 못했어요.");
  if (!ordersResult.data) sectionErrors.orders = errorMessage(ordersResult.error, "구매 내역을 불러오지 못했어요.");
  if (!pointsResult.data) sectionErrors.points = errorMessage(pointsResult.error, "포인트 정보를 불러오지 못했어요.");
  if (!shippingResult.data) sectionErrors.shipping = errorMessage(shippingResult.error, "배송 신청 내역을 불러오지 못했어요.");
  if (!inquiriesResult.data) sectionErrors.inquiries = errorMessage(inquiriesResult.error, "문의 내역을 불러오지 못했어요.");
  if (!preferencesResult.data) sectionErrors.preferences = errorMessage(preferencesResult.error, "알림 설정을 불러오지 못했어요.");

  const inventoryItems = [...(inventoryResult.data?.items ?? [])];
  const seenInventoryCursors = new Set<string>();
  let inventoryCursor = inventoryResult.data?.nextCursor ?? undefined;
  while (inventoryCursor) {
    if (seenInventoryCursors.has(inventoryCursor)) {
      throw new ProfileApiError(502, "보관함 페이지가 반복되어 전체 목록을 확인하지 못했어요.");
    }
    seenInventoryCursors.add(inventoryCursor);
    const pageResult = await client.GET("/v1/account/inventory", {
      params: { query: { limit: 100, cursor: inventoryCursor } },
    });
    if (!pageResult.data) {
      // Verified pages stay visible for reading, but the recorded section error
      // keeps every inventory action closed until a full reload succeeds.
      sectionErrors.inventory = errorMessage(pageResult.error, "보관함을 모두 불러오지 못했어요.");
      break;
    }
    const page = pageResult.data;
    inventoryItems.push(...page.items);
    inventoryCursor = page.nextCursor ?? undefined;
  }

  return {
    isExample: false,
    catalogProducts: products,
    ipNames,
    actor: meResult.data.actor,
    profile: profileResult.data,
    basicInfo: basicInfoResult.data,
    defaultAddress,
    wishlist: wishlistResult.data
      ? wishlistResult.data.items.filter((item) => isCustomerBrowsableCatalogCategory(item.product.category))
      : null,
    inventory: inventoryResult.data ? inventoryItems : null,
    orders: ordersResult.data?.items ?? null,
    pointBalance: pointsResult.data?.balance ?? null,
    pointHistory: pointsResult.data?.items ?? null,
    shippingRequests: shippingResult.data?.items ?? null,
    wantedRequests,
    notices,
    inquiries: inquiriesResult.data?.items ?? null,
    notificationPreferences: preferencesResult.data ?? null,
    sectionErrors,
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchStorageProfileSnapshot(
  client: ReturnType<typeof createDabbobaClient>,
  accessToken?: string,
): Promise<ProfileSnapshot> {
  if (!accessToken) return createGuestSnapshot([], {}, [], []);

  const [productsResult, ipsResult, meResult, profileResult, basicInfoResult, addressResult, inventoryResult] = await Promise.all([
    client.GET("/v1/catalog/products", { params: { query: { limit: 100 } } }),
    client.GET("/v1/catalog/ips", { params: { query: { limit: 100 } } }),
    client.GET("/v1/auth/me"),
    client.GET("/v1/account/profile"),
    client.GET("/v1/account/basic-info"),
    client.GET("/v1/account/default-address"),
    client.GET("/v1/account/inventory", { params: { query: { limit: 100 } } }),
  ]);

  if (!meResult.data) {
    throw new ProfileApiError(
      meResult.response.status,
      errorMessage(meResult.error, "로그인 정보를 확인하지 못했어요."),
    );
  }
  if (!inventoryResult.data) {
    throw new ProfileApiError(
      inventoryResult.response.status,
      errorMessage(inventoryResult.error, "보관함을 불러오지 못했어요."),
    );
  }

  const sectionErrors: ProfileSnapshot["sectionErrors"] = {};
  if (!productsResult.data || !ipsResult.data) {
    sectionErrors.catalog = "일부 작품 정보를 불러오지 못했어요. 보관 상품은 계속 확인할 수 있어요.";
  }
  if (!profileResult.data || !basicInfoResult.data) {
    sectionErrors.profile = "계정 표시 정보 일부를 불러오지 못했어요.";
  }
  const defaultAddress = addressResult.data ?? null;
  if (!addressResult.data && addressResult.response.status !== 404) {
    sectionErrors.address = errorMessage(addressResult.error, "기본 배송지를 불러오지 못했어요.");
  }

  const inventoryItems = [...inventoryResult.data.items];
  const seenInventoryCursors = new Set<string>();
  let inventoryCursor = inventoryResult.data.nextCursor ?? undefined;
  while (inventoryCursor) {
    if (seenInventoryCursors.has(inventoryCursor)) {
      throw new ProfileApiError(502, "보관함 페이지가 반복되어 전체 목록을 확인하지 못했어요.");
    }
    seenInventoryCursors.add(inventoryCursor);
    const pageResult = await client.GET("/v1/account/inventory", {
      params: { query: { limit: 100, cursor: inventoryCursor } },
    });
    if (!pageResult.data) {
      throw new ProfileApiError(
        pageResult.response.status,
        errorMessage(pageResult.error, "보관함을 모두 불러오지 못했어요."),
      );
    }
    inventoryItems.push(...pageResult.data.items);
    inventoryCursor = pageResult.data.nextCursor ?? undefined;
  }

  const actor = meResult.data.actor;
  const fetchedAt = new Date().toISOString();
  const products = productsResult.data?.items ?? [];
  const ipNames = Object.fromEntries(ipsResult.data?.items.map((ip) => [ip.id, ip.nameKo]) ?? []);
  const base = createGuestSnapshot(products, ipNames, [], []);

  return {
    ...base,
    isExample: false,
    actor,
    profile: profileResult.data ?? {
      id: actor.userId,
      nickname: actor.nickname,
      bio: null,
      favoriteIp: null,
      version: 0,
      updatedAt: fetchedAt,
    },
    basicInfo: basicInfoResult.data ?? {
      id: actor.userId,
      nickname: actor.nickname,
      email: actor.email,
      phoneMasked: null,
      birthDate: null,
      version: 0,
      updatedAt: fetchedAt,
    },
    defaultAddress,
    inventory: inventoryItems,
    // The storage scope loads only inventory; the other personal sections were
    // not requested and must not read as empty successful results.
    wishlist: null,
    orders: null,
    pointBalance: null,
    pointHistory: null,
    shippingRequests: null,
    inquiries: null,
    notificationPreferences: null,
    sectionErrors,
    fetchedAt,
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
  if (!result.data) throw new Error(errorMessage(result.error, "프로필을 저장하지 못했어요."));
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
  if (!result.data) throw new Error(errorMessage(result.error, "계정 기본정보를 저장하지 못했어요."));
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
  if (!result.data) throw new Error(errorMessage(result.error, "찜을 해제하지 못했어요."));
}

export async function createShippingQuote(
  apiBaseUrl: string,
  accessToken: string,
  inventoryUnitIds: string[],
): Promise<ShippingQuote> {
  const client = authorizedClient(apiBaseUrl, accessToken);
  const result = await client.POST("/v1/account/shipping-quotes", {
    body: { inventoryUnitIds },
  });
  if (!result.data) throw new Error(errorMessage(result.error, "배송 금액을 확인하지 못했어요."));
  return result.data;
}

export async function createShippingRequest(
  apiBaseUrl: string,
  accessToken: string,
  input: Pick<ShippingQuote, "id" | "addressVersion">,
): Promise<components["schemas"]["ShippingRequest"]> {
  const client = authorizedClient(apiBaseUrl, accessToken);
  const result = await client.POST("/v1/account/shipping-requests", {
    params: { header: { "Idempotency-Key": randomUUID() } },
    body: { quoteId: input.id, addressVersion: input.addressVersion },
  });
  if (!result.data) throw new Error(errorMessage(result.error, "배송을 신청하지 못했어요."));
  return result.data;
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
  if (!result.data) throw new Error(errorMessage(result.error, "포인트 환급을 신청하지 못했어요."));
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
  if (!result.data) throw new Error(errorMessage(result.error, "신청방 반응을 저장하지 못했어요."));
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
  if (!result.data) throw new Error(errorMessage(result.error, "알림 설정을 저장하지 못했어요."));
  return result.data;
}

export async function logoutAccount(apiBaseUrl: string, accessToken: string): Promise<void> {
  const client = authorizedClient(apiBaseUrl, accessToken);
  const result = await client.POST("/v1/auth/logout", {});
  if (!result.response.ok) throw new Error(errorMessage(result.error, "로그아웃하지 못했어요."));
}

export async function logoutOtherAccountSessions(apiBaseUrl: string, accessToken: string): Promise<void> {
  const client = authorizedClient(apiBaseUrl, accessToken);
  const result = await client.POST("/v1/auth/logout-others", {});
  if (!result.response.ok) throw new Error(errorMessage(result.error, "다른 기기에서 로그아웃하지 못했어요."));
}

function authorizedClient(apiBaseUrl: string, accessToken: string) {
  return createDabbobaClient({
    baseUrl: apiBaseUrl,
    token: () => accessToken,
    requestId: randomUUID,
  });
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
