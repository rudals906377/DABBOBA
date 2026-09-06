import type { components } from "../../packages/contracts/src/generated";

const DEFAULT_PAGE_LIMIT = 100;
const MAX_PAGE_REQUESTS = 100;
const MAX_BRIDGE_MESSAGE_BYTES = 8_192;
const MAX_SESSION_REFRESH_DELAY_MS = 2_147_000_000;
const SESSION_REFRESH_LEAD_MS = 5 * 60_000;
const SESSION_REFRESH_DEADLINE_MARGIN_MS = 1_000;
const SESSION_REFRESH_RETRY_MS = 30_000;

export function computeSessionRefreshDelay(expiresAt: string, now = Date.now()): number | null {
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) return null;
  const remaining = expiry - now;
  if (remaining <= 0) return 0;
  return Math.min(
    MAX_SESSION_REFRESH_DELAY_MS,
    Math.max(0, remaining - SESSION_REFRESH_LEAD_MS),
    Math.max(0, remaining - SESSION_REFRESH_DEADLINE_MARGIN_MS),
  );
}

export function computeSessionRefreshRetryDelay(expiresAt: string, now = Date.now()): number | null {
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) return null;
  const remaining = expiry - now;
  if (remaining <= 0) return null;
  if (remaining <= SESSION_REFRESH_DEADLINE_MARGIN_MS) return remaining;
  return Math.min(SESSION_REFRESH_RETRY_MS, remaining - SESSION_REFRESH_DEADLINE_MARGIN_MS);
}

export type ApiRuntimeMode = "prototype" | "remote";

export type ApiRuntimeConfiguration = {
  mode: ApiRuntimeMode;
  baseUrl: string | null;
  token: string | null;
};

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
};

export type ApiUserActor = {
  userId: string;
  email: string;
  nickname: string;
  role: "USER";
  status: "ACTIVE" | "SUSPENDED" | "BANNED" | "DELETED";
};

export type ApiUserSession = {
  id: string;
  kind: "USER";
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
};

export type ApiUserSessionState = {
  actor: ApiUserActor;
  session: ApiUserSession;
};

export type ApiUserSessionIssue = ApiUserSessionState & {
  token: string;
  expiresAt: string;
  rotatedFromSessionId?: string;
};

export type ApiDevelopmentSession = {
  token: string;
  expiresAt: string;
  actor: ApiUserActor & { sessionId: string };
};

export type ApiNotice = {
  id: string;
  title: string;
  content: string;
  isPinned: boolean;
  isPublished: boolean;
  status: "ACTIVE" | "HIDDEN" | "DELETED";
  createdBy: string;
  publishedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ApiCatalogIp = {
  id: string;
  slug: string;
  nameKo: string;
  nameEn: string;
  nameJa: string | null;
  aliases: string[];
  description: string;
  imageUrl: string | null;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ApiCatalogCharacter = {
  id: string;
  ipId: string;
  name: string;
  aliases: string[];
  imageUrl: string | null;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ApiCatalogProduct = {
  id: string;
  sku: string;
  ipId: string;
  characterIds: string[];
  category: "gacha" | "figure" | "kuji" | "tcg";
  name: string;
  manufacturer: string | null;
  releaseDate: string | null;
  price: number;
  availableQuantity: number;
  metadata: Record<string, unknown>;
  imageUrl: string | null;
  isActive: boolean;
  isPrizeOnly: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ApiCatalogRequest = {
  id: string;
  userId: string;
  kind: "PRODUCT" | "IP";
  name: string;
  referenceUrl: string | null;
  description: string | null;
  mediaId: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "ON_HOLD" | "MERGED";
  canonicalTargetId: string | null;
  decisionReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ApiCommunityPost = {
  id: string;
  authorId: string;
  authorNickname: string;
  ipId: string | null;
  kind: "DUKROOM" | "SNAP" | "GENERAL";
  title: string;
  content: string;
  status: "ACTIVE" | "HIDDEN" | "DELETED";
  reportCount: number;
  commentCount: number;
  likeCount: number;
  likedByViewer: boolean;
  mediaIds: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ApiCommunityComment = {
  id: string;
  postId: string;
  authorId: string;
  authorNickname: string;
  content: string;
  status: "ACTIVE" | "HIDDEN" | "DELETED";
  reportCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ApiReportReason =
  | "ABUSE"
  | "ADVERTISING"
  | "SPAM"
  | "INAPPROPRIATE"
  | "SUSPECTED_FRAUD"
  | "COPYRIGHT"
  | "OTHER";

export type ApiReport = {
  id: string;
  reporterId: string;
  targetType: "POST" | "COMMENT" | "SNAP" | "USER" | "EXCHANGE_LISTING";
  targetId: string;
  reason: ApiReportReason;
  details?: string | null;
  status: "PENDING" | "REVIEWING" | "RESOLVED" | "REJECTED";
  targetPreview: string | null;
  targetStatus: string | null;
  resolution?: string | null;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
};

export type ApiWantedRequest = {
  id: string;
  userId: string;
  authorNickname: string;
  category: ApiCatalogProduct["category"];
  ipId: string;
  ipNameKo: string;
  desiredItem: string;
  details: string;
  status: "ACTIVE" | "HIDDEN" | "DELETED";
  likeCount: number;
  likedByViewer: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ApiWantedRequestLikeResult = {
  requestId: string;
  liked: boolean;
  likeCount: number;
};

export type ApiCommunityPostLikeResult = {
  postId: string;
  liked: boolean;
  likeCount: number;
};

export type ApiCommunityPostDeleteResult = {
  postId: string;
  status: "DELETED";
  version: number;
};

export type ApiCommunityCommentDeleteResult = {
  commentId: string;
  status: "DELETED";
};

export type ApiWantedRequestDeleteResult = {
  requestId: string;
  status: "DELETED";
  version: number;
};

export type ApiBlockedUser = {
  userId: string;
  nickname: string;
  blockedAt: string;
};

export type ApiBlockResult = {
  userId: string;
  blocked: boolean;
};

export type ApiMediaPurpose = "PROFILE" | "POST" | "COMMENT" | "INQUIRY" | "EXCHANGE" | "CATALOG_REQUEST";

export type ApiMediaUploadIntent = components["schemas"]["MediaUploadIntent"];

export type ApiMediaReady = {
  mediaId: string;
  status: "READY";
  mimeType: "image/webp";
};

export type ApiMediaReadUrl = {
  mediaId: string;
  url: string;
  expiresAt: string;
  mimeType: "image/webp";
};

export type ApiAccountDeletionRequest = {
  id: string;
  status: "PENDING_REVIEW" | "BLOCKED" | "APPROVED" | "COMPLETED" | "REJECTED" | "CANCELLED";
  blockers: {
    pointBalance: number;
    activeOrderCount: number;
    activePaymentCount: number;
    availableDrawEntitlementCount: number;
    activeInventoryCount: number;
    activeShippingRequestCount: number;
    activeExchangeListingCount: number;
    activeExchangeOfferCount: number;
  };
  requestCount: number;
  hardDeletePerformed: false;
  policy: "MANUAL_REVIEW_REQUIRED";
  requestedAt: string;
  lastRequestedAt: string;
};

export type ApiInventoryUnit = {
  id: string;
  ownerId: string;
  productId: string;
  product: ApiCatalogProduct;
  sourceType: "PURCHASE" | "GACHA" | "KUJI" | "ADMIN_ADJUSTMENT";
  status: "OWNED" | "EXCHANGE_LISTED" | "EXCHANGE_OFFERED" | "SHIPPING" | "DELIVERED" | "TRANSFERRED" | "REFUNDED";
  acquiredAt: string;
};

export type ApiExchangeListing = {
  id: string;
  authorId: string;
  authorNickname: string;
  title: string;
  details: string;
  status: "OPEN" | "MATCHED" | "COMPLETED" | "CANCELLED" | "HIDDEN";
  offeredInventory: ApiInventoryUnit;
  offerCount: number;
  acceptedOfferId: string | null;
  matchedAt: string | null;
  authorConfirmedAt: string | null;
  proposerConfirmedAt: string | null;
  completedAt: string | null;
  completionMode: "MUTUAL_CONFIRMATION" | "ADMIN_OVERRIDE" | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  resolvedByAdminId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ApiExchangeOffer = {
  id: string;
  listingId: string;
  proposerId: string;
  offeredInventory: ApiInventoryUnit;
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "WITHDRAWN";
  createdAt: string;
  updatedAt: string;
};

export type ApiExchangeListingDetail = ApiExchangeListing & {
  offers?: ApiExchangeOffer[];
};

export type ApiInquiry = {
  id: string;
  userId: string;
  category: string;
  title: string;
  status: "PENDING" | "IN_PROGRESS" | "ANSWERED" | "CLOSED";
  assignedAdminId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ApiInquiryMessage = {
  id: string;
  inquiryId: string;
  authorId: string;
  authorRole: "USER" | "ADMIN" | "SUPER_ADMIN";
  content: string;
  isInternal: boolean;
  mediaIds: string[];
  createdAt: string;
};

export type ApiInquiryDetail = ApiInquiry & {
  messages: ApiInquiryMessage[];
};

export type ApiOrder = {
  id: string;
  userId: string;
  paymentId: string;
  status: "PENDING_PAYMENT" | "PAID" | "FULFILLED" | "CANCELLED" | "REFUND_REVIEW" | "REFUNDED";
  currency: "KRW";
  subtotal: number;
  discountTotal: number;
  pointTotal: number;
  total: number;
  lines: Array<{
    productId: string;
    productName: string;
    category: ApiCatalogProduct["category"];
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }>;
  drawEntitlementIds?: string[];
  createdAt: string;
  updatedAt: string;
};

export type ApiDrawResult = {
  id: string;
  entitlementId: string;
  productId: string;
  prizeProductId: string;
  prizeSku: string;
  prizeName: string;
  prizeImageUrl: string | null;
  prizeIpId: string;
  prizeCategory: ApiCatalogProduct["category"];
  prizeInventoryUnitId: string;
  probabilityVersion: number;
  rarity: string;
  committedAt: string;
};

export type ApiDrawOdds = {
  id: string;
  productId: string;
  version: number;
  publishedAt: string;
  calculatedAt: string;
  calculation: "WEIGHT_X_REMAINING_QUANTITY";
  totalEffectiveWeight: number;
  entries: Array<{
    id: string;
    prizeProductId: string;
    prizeSku: string;
    prizeName: string;
    prizeImageUrl: string | null;
    prizeIpId: string;
    prizeCategory: ApiCatalogProduct["category"];
    rarity: string;
    weight: number;
    initialQuantity: number | null;
    remainingQuantity: number | null;
    effectiveWeight: number;
    probabilityNumerator: number;
    probabilityDenominator: number;
    probabilityPercent: number;
  }>;
};

export type ApiAccountProfile = {
  id: string;
  nickname: string;
  bio: string | null;
  favoriteIp: {
    id: string;
    nameKo: string;
    imageUrl: string | null;
  } | null;
  version: number;
  updatedAt: string;
};

export type ApiDefaultShippingAddress = {
  id: string;
  recipient: string;
  phone: string;
  postalCode: string;
  addressLine1: string;
  addressLine2: string | null;
  deliveryNote: string | null;
  version: number;
  updatedAt: string;
};

export type ApiWishlistItem = {
  id: string;
  product: {
    id: string;
    name: string;
    ipId: string;
    ipNameKo: string;
    category: ApiCatalogProduct["category"];
    price: number;
    imageUrl: string | null;
    isActive: boolean;
  };
  wishedAt: string;
};

export type ApiAccountOrder = {
  id: string;
  status: ApiOrder["status"];
  currency: "KRW";
  subtotal: number;
  discountTotal: number;
  pointTotal: number;
  total: number;
  lines: ApiOrder["lines"];
  createdAt: string;
  updatedAt: string;
};

export type ApiAccountDrawEntitlement = {
  id: string;
  orderId: string;
  orderLineId: string;
  product: {
    id: string;
    name: string;
    category: ApiCatalogProduct["category"];
    imageUrl: string | null;
  };
  probabilityVersion: number;
  status: "AVAILABLE" | "CONSUMED" | "CANCELLED";
  createdAt: string;
  consumedAt: string | null;
};

export type ApiPointLedgerEntry = {
  id: string;
  entryType: "EARN" | "SPEND" | "REFUND" | "EXPIRE" | "ADJUSTMENT";
  amount: number;
  referenceType: string;
  referenceId: string;
  reason: string;
  createdAt: string;
};

export type ApiAccountPointPage = Page<ApiPointLedgerEntry> & {
  balance: number;
  version: number;
};

export type ApiAccountNotification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

export type ApiNotificationPreferences = {
  orderUpdates: true;
  exchangeUpdates: boolean;
  requestUpdates: boolean;
  restockUpdates: boolean;
  marketingSms: boolean;
  marketingEmail: boolean;
  marketingPush: boolean;
  personalizedRecommendations: boolean;
  version: number;
  updatedAt: string;
};

export type ApiShippingRequest = {
  id: string;
  status: "REQUESTED";
  inventoryUnitIds: string[];
  destination: {
    recipientMasked: string;
    phoneMasked: string;
    postalCode: string;
    addressLine1: string;
    addressLine2: string | null;
  };
  requestedAt: string;
};

export type ApiAccountShippingRequest = {
  id: string;
  status: "REQUESTED" | "PROCESSING" | "SHIPPED" | "DELIVERED" | "CANCELLED";
  version: number;
  inventoryUnitIds: string[];
  destination: ApiShippingRequest["destination"];
  requestedAt: string;
  updatedAt: string;
  shippedAt: string | null;
  trackingCarrier: string | null;
  trackingNumber: string | null;
};

export function deriveAccountShippingInventoryState(
  shippingRequests: readonly ApiAccountShippingRequest[],
) {
  const unavailableIds = new Set(shippingRequests
    .filter((request) => request.status !== "CANCELLED")
    .flatMap((request) => request.inventoryUnitIds));
  const cancelledOnlyIds = new Set(shippingRequests
    .filter((request) => request.status === "CANCELLED")
    .flatMap((request) => request.inventoryUnitIds)
    .filter((inventoryUnitId) => !unavailableIds.has(inventoryUnitId)));
  return { unavailableIds, cancelledOnlyIds };
}

export type RemoteDataSnapshot = {
  loadedAt: string;
  notices?: ApiNotice[];
  ips?: ApiCatalogIp[];
  characters?: ApiCatalogCharacter[];
  products?: ApiCatalogProduct[];
  communityPosts?: ApiCommunityPost[];
  wantedRequests?: ApiWantedRequest[];
  exchangeListings?: ApiExchangeListing[];
  inquiries?: ApiInquiry[];
  exchangeInventory?: ApiInventoryUnit[];
  accountProfile?: ApiAccountProfile;
  defaultAddress?: ApiDefaultShippingAddress | null;
  wishlist?: ApiWishlistItem[];
  accountOrders?: ApiAccountOrder[];
  accountDrawEntitlements?: ApiAccountDrawEntitlement[];
  accountPoints?: ApiAccountPointPage;
  accountNotifications?: ApiAccountNotification[];
  notificationPreferences?: ApiNotificationPreferences;
  accountShippingRequests?: ApiAccountShippingRequest[];
  failures: Partial<Record<RemoteSnapshotKey, string>>;
};

export type RemoteSnapshotKey =
  | "notices"
  | "ips"
  | "characters"
  | "products"
  | "communityPosts"
  | "wantedRequests"
  | "exchangeListings"
  | "inquiries"
  | "exchangeInventory"
  | "accountProfile"
  | "defaultAddress"
  | "wishlist"
  | "accountOrders"
  | "accountDrawEntitlements"
  | "accountPoints"
  | "accountNotifications"
  | "notificationPreferences"
  | "accountShippingRequests";

export type NativeDeepLinkRoute =
  | "home"
  | "exchange"
  | "ppoba"
  | "dukroom"
  | "profile"
  | "request-room"
  | "settings";

const DEEP_LINK_PATHS: Record<NativeDeepLinkRoute, string> = {
  home: "/",
  exchange: "/exchange",
  ppoba: "/ppoba",
  dukroom: "/dukroom",
  profile: "/profile",
  "request-room": "/request-room",
  settings: "/settings",
};

type RuntimeConfigurationInput = {
  baseUrl?: string;
  /** Explicit test/client construction only. Never source bearer tokens from VITE_ variables. */
  token?: string;
  production?: boolean;
};

export function resolveApiRuntimeConfiguration(
  input: RuntimeConfigurationInput = {
    baseUrl: typeof import.meta.env?.VITE_DABBOBA_API_URL === "string"
      ? import.meta.env.VITE_DABBOBA_API_URL
      : undefined,
    production: import.meta.env?.PROD === true,
  },
): ApiRuntimeConfiguration {
  const rawBaseUrl = input.baseUrl?.trim();
  const token = input.token?.trim() || null;
  if (input.production && token) {
    throw new Error("운영 웹 번들에는 사용자 bearer token을 정적으로 포함할 수 없습니다. 런타임 인증 흐름으로만 설정해 주세요.");
  }
  if (!rawBaseUrl) {
    if (input.production) {
      throw new Error("운영 환경에는 VITE_DABBOBA_API_URL이 필요합니다. 프로토타입 데이터는 개발·프리뷰에서만 사용할 수 있습니다.");
    }
    return { mode: "prototype", baseUrl: null, token: null };
  }

  let url: URL;
  try {
    url = new URL(rawBaseUrl);
  } catch {
    throw new Error("VITE_DABBOBA_API_URL에 올바른 절대 URL이 필요합니다.");
  }
  if (!isApprovedApiProtocol(url) || url.username || url.password || url.search || url.hash) {
    throw new Error("DABBOBA API URL은 인증정보·쿼리·해시가 없는 HTTPS 또는 로컬 HTTP 주소여야 합니다.");
  }

  return {
    mode: "remote",
    baseUrl: url.toString().replace(/\/$/, ""),
    token,
  };
}

export class DabbobaApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 0, code = "API_REQUEST_FAILED") {
    super(message);
    this.name = "DabbobaApiError";
    this.status = status;
    this.code = code;
  }
}

type DabbobaApiClientOptions = {
  configuration?: ApiRuntimeConfiguration;
  fetch?: typeof globalThis.fetch;
  createId?: () => string;
  /** Explicit local test construction only; production builds always reject HTTP uploads. */
  development?: boolean;
};

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  requiresAuth?: boolean;
  idempotencyKey?: string;
  signal?: AbortSignal;
};

type MediaUploadStage = {
  fingerprint: string;
  intent: ApiMediaUploadIntent;
  uploaded: boolean;
  sessionToken: string | null;
};

type MediaUploadTask = {
  fingerprint: string;
  promise: Promise<ApiMediaReady>;
};

type SessionRefreshTask = {
  token: string;
  promise: Promise<ApiUserSessionIssue>;
};

export class DabbobaApiClient {
  readonly configuration: ApiRuntimeConfiguration;
  private readonly fetchImplementation: typeof globalThis.fetch;
  private readonly createId: () => string;
  private readonly developmentMediaUploads: boolean;
  private readonly mediaUploadStages = new Map<string, MediaUploadStage>();
  private readonly mediaUploadTasks = new Map<string, MediaUploadTask>();
  private readonly mediaUploadActionFingerprints = new Map<string, string>();
  private readonly expiredMediaUploadActionKeys = new Set<string>();
  private sessionRefreshTask: SessionRefreshTask | null = null;
  private authInvalidationHandler: ((error: DabbobaApiError) => void) | null = null;

  constructor(options: DabbobaApiClientOptions = {}) {
    this.configuration = options.configuration ?? resolveApiRuntimeConfiguration();
    this.fetchImplementation = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.createId = options.createId ?? createClientRequestId;
    this.developmentMediaUploads = import.meta.env?.PROD !== true
      && (options.development ?? import.meta.env?.DEV === true);
  }

  get remoteEnabled() {
    return this.configuration.mode === "remote";
  }

  get authenticated() {
    return this.remoteEnabled && Boolean(this.configuration.token);
  }

  setToken(token: string | null) {
    const nextToken = token?.trim() || null;
    if (this.configuration.token !== nextToken) {
      this.mediaUploadStages.clear();
      this.mediaUploadTasks.clear();
      this.mediaUploadActionFingerprints.clear();
      this.expiredMediaUploadActionKeys.clear();
      this.sessionRefreshTask = null;
    }
    this.configuration.token = nextToken;
  }

  onAuthInvalidated(handler: (error: DabbobaApiError) => void) {
    this.authInvalidationHandler = handler;
    return () => {
      if (this.authInvalidationHandler === handler) this.authInvalidationHandler = null;
    };
  }

  createDevelopmentSession(email: string) {
    return this.request<ApiDevelopmentSession>("/v1/auth/dev-session", {
      method: "POST",
      body: { email },
    });
  }

  getCurrentUserSession(signal?: AbortSignal) {
    return this.request<ApiUserSessionState>("/v1/auth/me", {
      requiresAuth: true,
      signal,
    });
  }

  refreshUserSession() {
    this.assertRemoteConfiguration();
    const sessionToken = this.configuration.token;
    if (!sessionToken) {
      return Promise.reject(new DabbobaApiError(
        "실제 사용자 인증 토큰이 필요합니다.",
        401,
        "AUTH_TOKEN_REQUIRED",
      ));
    }
    if (this.sessionRefreshTask?.token === sessionToken) return this.sessionRefreshTask.promise;

    let refreshPromise: Promise<ApiUserSessionIssue>;
    refreshPromise = this.request<ApiUserSessionIssue>("/v1/auth/refresh", {
      method: "POST",
      requiresAuth: true,
    }).catch((error) => {
      if (
        error instanceof DabbobaApiError
        && error.status === 401
        && this.configuration.token === sessionToken
      ) {
        this.setToken(null);
      }
      throw error;
    }).finally(() => {
      if (this.sessionRefreshTask?.promise === refreshPromise) this.sessionRefreshTask = null;
    });
    this.sessionRefreshTask = { token: sessionToken, promise: refreshPromise };
    return refreshPromise;
  }

  logoutUserSession() {
    return this.request<void>("/v1/auth/logout", {
      method: "POST",
      requiresAuth: true,
    });
  }

  async loadSnapshot(signal?: AbortSignal): Promise<RemoteDataSnapshot> {
    this.assertRemoteConfiguration();
    if (signal?.aborted) throw createAbortError();
    const requests: Array<[RemoteSnapshotKey, Promise<unknown>]> = [
      ["notices", this.listPage<ApiNotice>("/v1/notices", signal)],
      ["ips", this.listPage<ApiCatalogIp>("/v1/catalog/ips", signal)],
      ["characters", this.listPage<ApiCatalogCharacter>("/v1/catalog/characters", signal)],
      ["products", this.listPage<ApiCatalogProduct>("/v1/catalog/products", signal)],
      ["communityPosts", this.listPage<ApiCommunityPost>("/v1/community/posts", signal)],
      ["wantedRequests", this.listPage<ApiWantedRequest>("/v1/wanted-requests", signal)],
      ["exchangeListings", this.listPage<ApiExchangeListing>("/v1/exchange/listings", signal)],
    ];
    if (this.authenticated) {
      requests.push(
        ["inquiries", this.listPage<ApiInquiry>("/v1/inquiries", signal, true)],
        ["exchangeInventory", this.listPage<ApiInventoryUnit>("/v1/exchange/inventory", signal, true)],
        ["accountProfile", this.getAccountProfile(signal)],
        ["defaultAddress", this.getDefaultShippingAddress(signal)],
        ["wishlist", this.listPage<ApiWishlistItem>("/v1/account/wishlist", signal, true)],
        ["accountOrders", this.listPage<ApiAccountOrder>("/v1/account/orders", signal, true)],
        ["accountDrawEntitlements", this.listAccountDrawEntitlements(signal)],
        ["accountPoints", this.getAccountPointLedger(signal)],
        ["accountNotifications", this.listPage<ApiAccountNotification>("/v1/account/notifications", signal, true)],
        ["notificationPreferences", this.getNotificationPreferences(signal)],
        ["accountShippingRequests", this.listAccountShippingRequests(signal)],
      );
    }

    const settled = await Promise.allSettled(requests.map(([, request]) => request));
    if (signal?.aborted) throw createAbortError();
    const abortedRequest = settled.find((result) => result.status === "rejected" && isAbortError(result.reason));
    if (abortedRequest?.status === "rejected") throw abortedRequest.reason;
    const snapshot: RemoteDataSnapshot = {
      loadedAt: new Date().toISOString(),
      failures: {},
    };
    settled.forEach((result, index) => {
      const key = requests[index]![0];
      if (result.status === "fulfilled") {
        snapshot[key] = result.value as never;
      } else if (!isAbortError(result.reason)) {
        snapshot.failures[key] = errorMessage(result.reason);
      }
    });
    if (signal?.aborted) throw createAbortError();
    return snapshot;
  }

  createInquiry(input: {
    category: "ACCOUNT" | "ERROR" | "PRODUCT" | "COMMUNITY" | "ORDER" | "OTHER";
    title: string;
    content: string;
    mediaIds?: string[];
  }, idempotencyKey?: string) {
    return this.request<ApiInquiry>("/v1/inquiries", {
      method: "POST",
      body: input,
      requiresAuth: true,
      idempotencyKey,
    });
  }

  getInquiryDetail(inquiryId: string, signal?: AbortSignal) {
    return this.request<ApiInquiryDetail>(`/v1/inquiries/${encodeURIComponent(inquiryId)}`, {
      requiresAuth: true,
      signal,
    });
  }

  createInquiryMessage(
    inquiryId: string,
    input: { content: string; mediaIds?: string[] },
    idempotencyKey?: string,
  ) {
    return this.request<ApiInquiryMessage>(
      `/v1/inquiries/${encodeURIComponent(inquiryId)}/messages`,
      {
        method: "POST",
        body: { content: input.content, mediaIds: input.mediaIds ?? [] },
        requiresAuth: true,
        idempotencyKey,
      },
    );
  }

  async getAuthenticatedMediaUrl(mediaId: string, signal?: AbortSignal) {
    const media = await this.request<ApiMediaReadUrl>(`/v1/media/${encodeURIComponent(mediaId)}/url`, {
      requiresAuth: true,
      signal,
    });
    try {
      if (new URL(media.url).protocol !== "https:") throw new Error("insecure protocol");
    } catch {
      throw new DabbobaApiError("안전한 첨부 이미지 주소를 확인할 수 없습니다.", 502, "MEDIA_READ_URL_INVALID");
    }
    return media;
  }

  createCommunityPost(input: {
    ipId?: string | null;
    kind: "DUKROOM" | "SNAP" | "GENERAL";
    title: string;
    content: string;
    mediaIds?: string[];
  }, idempotencyKey?: string) {
    return this.request<ApiCommunityPost>("/v1/community/posts", {
      method: "POST",
      body: input,
      requiresAuth: true,
      idempotencyKey,
    });
  }

  getCommunityPost(postId: string, signal?: AbortSignal) {
    return this.request<ApiCommunityPost>(`/v1/community/posts/${encodeURIComponent(postId)}`, {
      signal,
    });
  }

  listCommunityComments(postId: string, signal?: AbortSignal) {
    return this.listPage<ApiCommunityComment>(
      `/v1/community/posts/${encodeURIComponent(postId)}/comments`,
      signal,
    );
  }

  createCommunityComment(postId: string, content: string, idempotencyKey?: string) {
    return this.request<ApiCommunityComment>(`/v1/community/posts/${encodeURIComponent(postId)}/comments`, {
      method: "POST",
      body: { content },
      requiresAuth: true,
      idempotencyKey,
    });
  }

  deleteCommunityComment(commentId: string, idempotencyKey?: string) {
    return this.request<ApiCommunityCommentDeleteResult>(`/v1/community/comments/${encodeURIComponent(commentId)}`, {
      method: "DELETE",
      requiresAuth: true,
      idempotencyKey,
    });
  }

  updateCommunityPost(postId: string, input: {
    expectedVersion: number;
    title?: string;
    content?: string;
    ipId?: string | null;
    mediaIds?: string[];
  }, idempotencyKey?: string) {
    return this.request<ApiCommunityPost>(`/v1/community/posts/${encodeURIComponent(postId)}`, {
      method: "PATCH",
      body: input,
      requiresAuth: true,
      idempotencyKey,
    });
  }

  deleteCommunityPost(postId: string, expectedVersion: number, idempotencyKey?: string) {
    return this.request<ApiCommunityPostDeleteResult>(`/v1/community/posts/${encodeURIComponent(postId)}`, {
      method: "DELETE",
      body: { expectedVersion },
      requiresAuth: true,
      idempotencyKey,
    });
  }

  setCommunityPostLike(postId: string, liked: boolean, idempotencyKey?: string) {
    return this.request<ApiCommunityPostLikeResult>(`/v1/community/posts/${encodeURIComponent(postId)}/like`, {
      method: "POST",
      body: { liked },
      requiresAuth: true,
      idempotencyKey,
    });
  }

  listBlockedUsers(signal?: AbortSignal) {
    return this.listPage<ApiBlockedUser>("/v1/community/blocks", signal, true);
  }

  setCommunityUserBlocked(userId: string, blocked: boolean, idempotencyKey?: string) {
    return this.request<ApiBlockResult>(`/v1/community/blocks/${encodeURIComponent(userId)}`, {
      method: blocked ? "POST" : "DELETE",
      body: {},
      requiresAuth: true,
      idempotencyKey,
    });
  }

  createReport(input: {
    targetType: "POST" | "COMMENT" | "SNAP" | "USER" | "EXCHANGE_LISTING";
    targetId: string;
    reason: ApiReportReason;
    details?: string;
  }, idempotencyKey?: string) {
    return this.request<ApiReport>("/v1/reports", {
      method: "POST",
      body: input,
      requiresAuth: true,
      idempotencyKey,
    });
  }

  createCatalogRequest(input: {
    kind: "PRODUCT" | "IP";
    name: string;
    referenceUrl?: string | null;
    description?: string | null;
    mediaId?: string | null;
  }, idempotencyKey?: string) {
    return this.request<ApiCatalogRequest>("/v1/catalog/requests", {
      method: "POST",
      body: input,
      requiresAuth: true,
      idempotencyKey,
    });
  }

  async uploadMedia(file: File, purpose: ApiMediaPurpose, idempotencyKey?: string): Promise<ApiMediaReady> {
    const supportedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
    if (!supportedMimeTypes.has(file.type)) {
      throw new DabbobaApiError("JPEG, PNG, WebP 또는 GIF 이미지만 올릴 수 있습니다.", 400, "MEDIA_TYPE_UNSUPPORTED");
    }
    if (file.size < 1) {
      throw new DabbobaApiError("비어 있는 파일은 올릴 수 없습니다.", 400, "MEDIA_FILE_EMPTY");
    }
    if (file.size > 10 * 1024 * 1024) {
      throw new DabbobaApiError("이미지는 10MB 이하만 올릴 수 있습니다.", 400, "MEDIA_FILE_TOO_LARGE");
    }
    if (!file.name.trim() || file.name.length > 255) {
      throw new DabbobaApiError("파일 이름을 확인해 주세요.", 400, "MEDIA_FILENAME_INVALID");
    }

    const actionKey = idempotencyKey ?? this.createId();
    if (this.expiredMediaUploadActionKeys.has(actionKey)) {
      throw new DabbobaApiError(
        "이미지 업로드 주소가 만료됐습니다. 새 업로드 키로 다시 시작해 주세요.",
        410,
        "MEDIA_UPLOAD_INTENT_EXPIRED",
      );
    }
    const checksumSha256 = await sha256Hex(await file.arrayBuffer());
    const fingerprint = JSON.stringify([purpose, file.name, file.type, file.size, checksumSha256]);
    const knownFingerprint = this.mediaUploadActionFingerprints.get(actionKey);
    if (knownFingerprint && knownFingerprint !== fingerprint) {
      throw new DabbobaApiError(
        "같은 업로드 키를 다른 파일에 사용할 수 없습니다. 새 업로드로 다시 시작해 주세요.",
        409,
        "MEDIA_UPLOAD_KEY_REUSED",
      );
    }
    if (!knownFingerprint) {
      this.mediaUploadActionFingerprints.set(actionKey, fingerprint);
    }

    const inFlight = this.mediaUploadTasks.get(actionKey);
    if (inFlight) {
      if (inFlight.fingerprint !== fingerprint) {
        throw new DabbobaApiError(
          "같은 업로드 키를 다른 파일에 사용할 수 없습니다. 새 업로드로 다시 시작해 주세요.",
          409,
          "MEDIA_UPLOAD_KEY_REUSED",
        );
      }
      return inFlight.promise;
    }

    const promise = this.continueMediaUpload({
      actionKey,
      file,
      purpose,
      checksumSha256,
      fingerprint,
      sessionToken: this.configuration.token,
    });
    this.mediaUploadTasks.set(actionKey, { fingerprint, promise });
    try {
      return await promise;
    } finally {
      if (this.mediaUploadTasks.get(actionKey)?.promise === promise) {
        this.mediaUploadTasks.delete(actionKey);
      }
    }
  }

  private async continueMediaUpload(input: {
    actionKey: string;
    file: File;
    purpose: ApiMediaPurpose;
    checksumSha256: string;
    fingerprint: string;
    sessionToken: string | null;
  }): Promise<ApiMediaReady> {
    let stage = this.mediaUploadStages.get(input.actionKey);
    if (stage && stage.fingerprint !== input.fingerprint) {
      throw new DabbobaApiError(
        "같은 업로드 키를 다른 파일에 사용할 수 없습니다. 새 업로드로 다시 시작해 주세요.",
        409,
        "MEDIA_UPLOAD_KEY_REUSED",
      );
    }
    if (!stage) {
      let intent: ApiMediaUploadIntent;
      try {
        intent = await this.request<ApiMediaUploadIntent>("/v1/media/uploads", {
          method: "POST",
          body: {
            purpose: input.purpose,
            filename: input.file.name,
            mimeType: input.file.type,
            byteSize: input.file.size,
            checksumSha256: input.checksumSha256,
            acceptedUploadMethods: ["POST", "PUT"],
          },
          requiresAuth: true,
          idempotencyKey: input.actionKey,
        });
      } catch (error) {
        if (
          error instanceof DabbobaApiError
          && (error.status === 410 || error.code === "MEDIA_UPLOAD_INTENT_EXPIRED")
        ) {
          this.mediaUploadStages.delete(input.actionKey);
          this.expiredMediaUploadActionKeys.add(input.actionKey);
        }
        throw error;
      }
      this.assertMediaUploadSession(input.sessionToken);
      this.mediaUploadRequest(intent, input.file, input.checksumSha256);
      stage = {
        fingerprint: input.fingerprint,
        intent,
        uploaded: false,
        sessionToken: input.sessionToken,
      };
      this.mediaUploadStages.set(input.actionKey, stage);
    }

    this.assertMediaUploadSession(stage.sessionToken);
    if (!stage.uploaded) {
      const expiresAt = Date.parse(stage.intent.expiresAt);
      if (!Number.isFinite(expiresAt)) {
        this.mediaUploadStages.delete(input.actionKey);
        throw new DabbobaApiError("업로드 만료 시간을 확인할 수 없습니다.", 502, "MEDIA_UPLOAD_POLICY_INVALID");
      }
      if (Date.now() >= expiresAt) {
        this.mediaUploadStages.delete(input.actionKey);
        this.expiredMediaUploadActionKeys.add(input.actionKey);
        throw new DabbobaApiError(
          "이미지 업로드 주소가 만료됐습니다. 새 업로드로 다시 시작해 주세요.",
          410,
          "MEDIA_UPLOAD_INTENT_EXPIRED",
        );
      }
      const upload = this.mediaUploadRequest(stage.intent, input.file, input.checksumSha256);
      let body: File | FormData = input.file;
      if (stage.intent.method === "POST") {
        body = new FormData();
        for (const [name, value] of Object.entries(stage.intent.fields)) body.append(name, value);
        body.append(stage.intent.fileFieldName, input.file, input.file.name);
      }
      let uploadResponse: Response;
      try {
        uploadResponse = await this.fetchImplementation(upload.url.toString(), {
          method: stage.intent.method,
          body,
          ...(upload.headers ? { headers: upload.headers } : {}),
          credentials: "omit",
          redirect: "error",
        });
      } catch {
        throw new DabbobaApiError("이미지를 저장소에 전송하지 못했습니다. 다시 시도해 주세요.", 0, "MEDIA_UPLOAD_FAILED");
      }
      if (!uploadResponse.ok || uploadResponse.redirected) {
        throw new DabbobaApiError("이미지 업로드가 완료되지 않았습니다. 다시 시도해 주세요.", uploadResponse.status, "MEDIA_UPLOAD_FAILED");
      }
      stage.uploaded = true;
    }

    this.assertMediaUploadSession(stage.sessionToken);
    let ready: ApiMediaReady;
    try {
      ready = await this.request<ApiMediaReady>(
        `/v1/media/${encodeURIComponent(stage.intent.mediaId)}/complete`,
        {
          method: "POST",
          requiresAuth: true,
          idempotencyKey: input.actionKey,
        },
      );
    } catch (error) {
      if (
        error instanceof DabbobaApiError
        && (error.status === 410 || error.code === "MEDIA_UPLOAD_INTENT_EXPIRED")
      ) {
        this.mediaUploadStages.delete(input.actionKey);
        this.expiredMediaUploadActionKeys.add(input.actionKey);
      }
      throw error;
    }
    this.mediaUploadStages.delete(input.actionKey);
    return ready;
  }

  private mediaUploadRequest(intent: ApiMediaUploadIntent, file: File, checksumSha256: string): { url: URL; headers?: Record<string, string> } {
    const invalid = () => new DabbobaApiError("업로드 정책이 선택한 파일과 일치하지 않습니다.", 502, "MEDIA_UPLOAD_POLICY_INVALID");
    if (!intent || intent.maxBytes !== file.size || !Number.isSafeInteger(intent.maxBytes)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(intent.mediaId)) {
      throw new DabbobaApiError("업로드 정책이 선택한 파일과 일치하지 않습니다.", 502, "MEDIA_UPLOAD_POLICY_INVALID");
    }
    let uploadUrl: URL;
    try {
      uploadUrl = new URL(intent.uploadUrl);
    } catch {
      throw new DabbobaApiError("업로드 주소를 확인할 수 없습니다.", 502, "MEDIA_UPLOAD_POLICY_INVALID");
    }
    const localHttp = this.developmentMediaUploads && uploadUrl.protocol === "http:"
      && ["localhost", "127.0.0.1", "[::1]"].includes(uploadUrl.hostname);
    if ((uploadUrl.protocol !== "https:" && !localHttp) || uploadUrl.username || uploadUrl.password || uploadUrl.hash) {
      throw new DabbobaApiError("안전한 업로드 주소가 아닙니다.", 502, "MEDIA_UPLOAD_POLICY_INVALID");
    }
    if (intent.method === "POST") {
      if (intent.fileFieldName !== "file" || !intent.fields || Array.isArray(intent.fields)
        || typeof intent.fields !== "object" || !Object.keys(intent.fields).length
        || Object.values(intent.fields).some((value) => typeof value !== "string")
        || "headers" in intent || "bodyEncoding" in intent) throw invalid();
      return { url: uploadUrl };
    }
    if (intent.method !== "PUT" || intent.bodyEncoding !== "raw" || "fields" in intent || "fileFieldName" in intent
      || !intent.headers || typeof intent.headers !== "object" || Array.isArray(intent.headers)) throw invalid();
    const expected: Record<string, string> = {
      "content-type": file.type,
      "content-length": String(file.size),
      "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
      "x-amz-meta-sha256": checksumSha256,
      "x-amz-meta-media-id": intent.mediaId,
    };
    const headers: Record<string, string> = {};
    const seen = new Set<string>();
    for (const [name, value] of Object.entries(intent.headers)) {
      const lower = name.toLowerCase();
      if (!Object.hasOwn(expected, lower) || seen.has(lower) || value !== expected[lower]) throw invalid();
      seen.add(lower);
      // Content-Length is signed but forbidden to browser code. The exact raw File determines it.
      if (lower !== "content-length") headers[lower] = value;
    }
    if (seen.size !== Object.keys(expected).length) throw invalid();
    return { url: uploadUrl, headers };
  }

  private assertMediaUploadSession(expectedToken: string | null) {
    if (this.configuration.token !== expectedToken) {
      throw new DabbobaApiError(
        "로그인 세션이 변경되어 이미지 업로드를 중단했습니다. 다시 시작해 주세요.",
        409,
        "MEDIA_UPLOAD_SESSION_CHANGED",
      );
    }
  }

  getPublicMediaUrl(mediaId: string, signal?: AbortSignal) {
    return this.request<ApiMediaReadUrl>(`/v1/media/${encodeURIComponent(mediaId)}/public-url`, {
      signal,
    });
  }

  createWantedRequest(input: {
    category: ApiCatalogProduct["category"];
    ipId: string;
    desiredItem: string;
    details: string;
  }, idempotencyKey?: string) {
    return this.request<ApiWantedRequest>("/v1/wanted-requests", {
      method: "POST",
      body: input,
      requiresAuth: true,
      idempotencyKey,
    });
  }

  updateWantedRequest(requestId: string, input: {
    expectedVersion: number;
    category?: ApiCatalogProduct["category"];
    ipId?: string;
    desiredItem?: string;
    details?: string;
  }, idempotencyKey?: string) {
    return this.request<ApiWantedRequest>(`/v1/wanted-requests/${encodeURIComponent(requestId)}`, {
      method: "PATCH",
      body: input,
      requiresAuth: true,
      idempotencyKey,
    });
  }

  deleteWantedRequest(requestId: string, expectedVersion: number, idempotencyKey?: string) {
    return this.request<ApiWantedRequestDeleteResult>(`/v1/wanted-requests/${encodeURIComponent(requestId)}`, {
      method: "DELETE",
      body: { expectedVersion },
      requiresAuth: true,
      idempotencyKey,
    });
  }

  setWantedRequestLike(requestId: string, liked: boolean, idempotencyKey?: string) {
    return this.request<ApiWantedRequestLikeResult>(
      `/v1/wanted-requests/${encodeURIComponent(requestId)}/like`,
      {
        method: "POST",
        body: { liked },
        requiresAuth: true,
        idempotencyKey,
      },
    );
  }

  getExchangeListingDetail(listingId: string, signal?: AbortSignal) {
    return this.request<ApiExchangeListingDetail>(
      `/v1/exchange/listings/${encodeURIComponent(listingId)}`,
      { signal },
    );
  }

  createExchangeListing(
    input: { title: string; details: string; offeredInventoryUnitId: string },
    idempotencyKey?: string,
  ) {
    return this.request<ApiExchangeListing>("/v1/exchange/listings", {
      method: "POST",
      body: input,
      requiresAuth: true,
      idempotencyKey,
    });
  }

  createExchangeOffer(
    listingId: string,
    input: { offeredInventoryUnitId: string },
    idempotencyKey?: string,
  ) {
    return this.request<ApiExchangeOffer>(`/v1/exchange/listings/${encodeURIComponent(listingId)}/offers`, {
      method: "POST",
      body: input,
      requiresAuth: true,
      idempotencyKey,
    });
  }

  decideExchangeOffer(
    listingId: string,
    offerId: string,
    decision: "ACCEPTED" | "REJECTED",
    idempotencyKey?: string,
  ) {
    return this.request<ApiExchangeOffer>(
      `/v1/exchange/listings/${encodeURIComponent(listingId)}/offers/${encodeURIComponent(offerId)}/decision`,
      {
        method: "POST",
        body: { decision },
        requiresAuth: true,
        idempotencyKey,
      },
    );
  }

  cancelExchangeListing(listingId: string, idempotencyKey?: string) {
    return this.request<ApiExchangeListing>(
      `/v1/exchange/listings/${encodeURIComponent(listingId)}/cancel`,
      {
        method: "POST",
        requiresAuth: true,
        idempotencyKey,
      },
    );
  }

  withdrawExchangeOffer(listingId: string, offerId: string, idempotencyKey?: string) {
    return this.request<ApiExchangeOffer>(
      `/v1/exchange/listings/${encodeURIComponent(listingId)}/offers/${encodeURIComponent(offerId)}/withdraw`,
      {
        method: "POST",
        requiresAuth: true,
        idempotencyKey,
      },
    );
  }

  confirmExchangeCompletion(listingId: string, idempotencyKey?: string) {
    return this.request<ApiExchangeListing>(
      `/v1/exchange/listings/${encodeURIComponent(listingId)}/completion-confirmation`,
      {
        method: "POST",
        requiresAuth: true,
        idempotencyKey,
      },
    );
  }

  createOrder(input: {
    items: Array<{ productId: string; quantity: number; expectedDrawVersion?: number }>;
    couponCode?: string | null;
    pointAmount?: number;
  }, idempotencyKey?: string) {
    return this.request<ApiOrder>("/v1/orders", {
      method: "POST",
      body: input,
      requiresAuth: true,
      idempotencyKey,
    });
  }

  getOrder(orderId: string, signal?: AbortSignal) {
    return this.request<ApiOrder>(`/v1/orders/${encodeURIComponent(orderId)}`, {
      requiresAuth: true,
      signal,
    });
  }

  getActiveDrawOdds(productId: string, signal?: AbortSignal) {
    return this.request<ApiDrawOdds>(`/v1/catalog/products/${encodeURIComponent(productId)}/draw-odds`, {
      signal,
    });
  }

  consumeDrawEntitlement(entitlementId: string, idempotencyKey?: string) {
    return this.request<ApiDrawResult>(`/v1/draws/${encodeURIComponent(entitlementId)}/consume`, {
      method: "POST",
      requiresAuth: true,
      idempotencyKey,
    });
  }

  getAccountProfile(signal?: AbortSignal) {
    return this.request<ApiAccountProfile>("/v1/account/profile", {
      requiresAuth: true,
      signal,
    });
  }

  updateAccountProfile(input: {
    nickname?: string;
    bio?: string | null;
    favoriteIpId?: string | null;
    expectedVersion: number;
  }, idempotencyKey?: string) {
    return this.request<ApiAccountProfile>("/v1/account/profile", {
      method: "PATCH",
      body: input,
      requiresAuth: true,
      idempotencyKey,
    });
  }

  getAccountDeletionRequest(signal?: AbortSignal) {
    return this.request<ApiAccountDeletionRequest>("/v1/account/deletion-request", {
      requiresAuth: true,
      signal,
    });
  }

  requestAccountDeletion(idempotencyKey?: string) {
    return this.request<ApiAccountDeletionRequest>("/v1/account/deletion-request", {
      method: "POST",
      body: {},
      requiresAuth: true,
      idempotencyKey,
    });
  }

  async getDefaultShippingAddress(signal?: AbortSignal) {
    try {
      return await this.request<ApiDefaultShippingAddress>("/v1/account/default-address", {
        requiresAuth: true,
        signal,
      });
    } catch (error) {
      if (error instanceof DabbobaApiError && error.status === 404) return null;
      throw error;
    }
  }

  upsertDefaultShippingAddress(input: {
    recipient: string;
    phone: string;
    postalCode: string;
    addressLine1: string;
    addressLine2?: string | null;
    deliveryNote?: string | null;
    expectedVersion?: number;
  }, idempotencyKey?: string) {
    return this.request<ApiDefaultShippingAddress>("/v1/account/default-address", {
      method: "PUT",
      body: input,
      requiresAuth: true,
      idempotencyKey,
    });
  }

  addWishlistItem(productId: string, idempotencyKey?: string) {
    return this.request<ApiWishlistItem>(`/v1/account/wishlist/${encodeURIComponent(productId)}`, {
      method: "POST",
      requiresAuth: true,
      idempotencyKey,
    });
  }

  removeWishlistItem(productId: string, idempotencyKey?: string) {
    return this.request<{ productId: string; removed: boolean }>(
      `/v1/account/wishlist/${encodeURIComponent(productId)}`,
      {
        method: "DELETE",
        requiresAuth: true,
        idempotencyKey,
      },
    );
  }

  getAccountPointLedger(signal?: AbortSignal) {
    return this.listAccountPointLedger(signal);
  }

  markAccountNotificationRead(notificationId: string, idempotencyKey?: string) {
    return this.request<ApiAccountNotification>(
      `/v1/account/notifications/${encodeURIComponent(notificationId)}/read`,
      {
        method: "POST",
        requiresAuth: true,
        idempotencyKey,
      },
    );
  }

  getNotificationPreferences(signal?: AbortSignal) {
    return this.request<ApiNotificationPreferences>("/v1/account/notification-preferences", {
      requiresAuth: true,
      signal,
    });
  }

  updateNotificationPreferences(input: {
    exchangeUpdates: boolean;
    requestUpdates: boolean;
    restockUpdates: boolean;
    marketingSms: boolean;
    marketingEmail: boolean;
    marketingPush: boolean;
    personalizedRecommendations: boolean;
    expectedVersion: number;
  }, idempotencyKey?: string) {
    return this.request<ApiNotificationPreferences>("/v1/account/notification-preferences", {
      method: "PUT",
      body: input,
      requiresAuth: true,
      idempotencyKey,
    });
  }

  listAccountDrawEntitlements(signal?: AbortSignal) {
    return this.listPage<ApiAccountDrawEntitlement>("/v1/account/draw-entitlements", signal, true);
  }

  listAccountShippingRequests(signal?: AbortSignal) {
    return this.listPage<ApiAccountShippingRequest>("/v1/account/shipping-requests", signal, true);
  }

  getAccountShippingRequest(shippingRequestId: string, signal?: AbortSignal) {
    return this.request<ApiAccountShippingRequest>(
      `/v1/account/shipping-requests/${encodeURIComponent(shippingRequestId)}`,
      { requiresAuth: true, signal },
    );
  }

  createAccountShippingRequest(inventoryUnitIds: string[], idempotencyKey?: string) {
    return this.request<ApiShippingRequest>("/v1/account/shipping-requests", {
      method: "POST",
      body: { inventoryUnitIds },
      requiresAuth: true,
      idempotencyKey,
    });
  }

  private async listPage<T>(path: string, signal?: AbortSignal, requiresAuth = false): Promise<T[]> {
    const items: T[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    let requestCount = 0;
    do {
      requestCount += 1;
      if (requestCount > MAX_PAGE_REQUESTS) {
        throw new DabbobaApiError("서버 페이지 수가 안전 한도를 넘어 동기화를 중단했습니다.", 0, "PAGE_LIMIT_EXCEEDED");
      }
      const separator = path.includes("?") ? "&" : "?";
      const cursorQuery: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
      const page: Page<T> = await this.request<Page<T>>(`${path}${separator}limit=${DEFAULT_PAGE_LIMIT}${cursorQuery}`, {
        requiresAuth,
        signal,
      });
      items.push(...page.items);
      cursor = page.nextCursor;
      if (cursor && seenCursors.has(cursor)) {
        throw new DabbobaApiError("서버 페이지 커서가 반복되어 동기화를 중단했습니다.", 0, "INVALID_PAGE_CURSOR");
      }
      if (cursor) seenCursors.add(cursor);
    } while (cursor);
    return items;
  }

  private async listAccountPointLedger(signal?: AbortSignal): Promise<ApiAccountPointPage> {
    const first = await this.request<ApiAccountPointPage>(`/v1/account/points?limit=${DEFAULT_PAGE_LIMIT}`, {
      requiresAuth: true,
      signal,
    });
    const items = [...first.items];
    const seenCursors = new Set<string>();
    let cursor = first.nextCursor;
    let requestCount = 1;
    while (cursor) {
      requestCount += 1;
      if (requestCount > MAX_PAGE_REQUESTS) {
        throw new DabbobaApiError("서버 포인트 페이지 수가 안전 한도를 넘어 동기화를 중단했습니다.", 0, "PAGE_LIMIT_EXCEEDED");
      }
      if (seenCursors.has(cursor)) {
        throw new DabbobaApiError("서버 포인트 커서가 반복되어 동기화를 중단했습니다.", 0, "INVALID_PAGE_CURSOR");
      }
      seenCursors.add(cursor);
      const page = await this.request<ApiAccountPointPage>(
        `/v1/account/points?limit=${DEFAULT_PAGE_LIMIT}&cursor=${encodeURIComponent(cursor)}`,
        { requiresAuth: true, signal },
      );
      if (page.balance !== first.balance || page.version !== first.version) {
        throw new DabbobaApiError("포인트 페이지 조회 중 잔액 버전이 변경됐습니다. 다시 동기화해 주세요.", 409, "POINT_SNAPSHOT_CHANGED");
      }
      items.push(...page.items);
      cursor = page.nextCursor;
    }
    return { ...first, items, nextCursor: null };
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    this.assertRemoteConfiguration();
    if (options.requiresAuth && !this.configuration.token) {
      throw new DabbobaApiError("실제 사용자 인증 토큰이 필요합니다.", 401, "AUTH_TOKEN_REQUIRED");
    }

    const method = options.method ?? "GET";
    const requestToken = this.configuration.token;
    const headers = new Headers({
      accept: "application/json",
      "x-request-id": this.createId(),
    });
    if (this.configuration.token) headers.set("authorization", `Bearer ${this.configuration.token}`);
    if (options.body !== undefined) headers.set("content-type", "application/json");
    if (method !== "GET") headers.set("idempotency-key", options.idempotencyKey ?? this.createId());

    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.configuration.baseUrl}${path}`, {
        method,
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        ...(options.signal ? { signal: options.signal } : {}),
        credentials: "omit",
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new DabbobaApiError("서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }

    const payload = await readResponsePayload(response);
    if (!response.ok) {
      const envelope = payload as { error?: { code?: unknown; message?: unknown } } | null;
      const apiError = new DabbobaApiError(
        typeof envelope?.error?.message === "string"
          ? envelope.error.message
          : "요청을 처리하지 못했습니다.",
        response.status,
        typeof envelope?.error?.code === "string" ? envelope.error.code : "API_REQUEST_FAILED",
      );
      if (
        response.status === 401
        && options.requiresAuth
        && requestToken !== null
        && this.configuration.token === requestToken
      ) {
        this.setToken(null);
        try {
          this.authInvalidationHandler?.(apiError);
        } catch {
          // The server error remains the authoritative failure even if a UI listener has already unmounted.
        }
      }
      throw apiError;
    }
    return payload as T;
  }

  private assertRemoteConfiguration(): asserts this is this & {
    configuration: ApiRuntimeConfiguration & { baseUrl: string };
  } {
    if (!this.remoteEnabled || !this.configuration.baseUrl) {
      throw new DabbobaApiError("API가 구성되지 않아 프로토타입 데이터 모드로 동작합니다.", 0, "API_NOT_CONFIGURED");
    }
  }
}

export function parseNativeDeepLinkMessage(rawValue: unknown, currentOrigin: string): NativeDeepLinkRoute | null {
  if (typeof rawValue !== "string" || utf8ByteLength(rawValue) > MAX_BRIDGE_MESSAGE_BYTES) return null;

  let value: unknown;
  try {
    value = JSON.parse(rawValue);
  } catch {
    return null;
  }
  if (!isRecord(value) || !hasExactKeys(value, ["payload", "type", "version"])) return null;
  if (value.version !== 1 || value.type !== "DEEP_LINK" || !isRecord(value.payload)) return null;
  if (!hasExactKeys(value.payload, ["route", "url"]) || !isNativeDeepLinkRoute(value.payload.route) || typeof value.payload.url !== "string") {
    return null;
  }

  let target: URL;
  try {
    target = new URL(value.payload.url);
  } catch {
    return null;
  }
  if (
    target.origin !== currentOrigin
    || target.pathname !== DEEP_LINK_PATHS[value.payload.route]
    || target.username
    || target.password
    || target.hash
  ) {
    return null;
  }
  const unexpectedQuery = [...target.searchParams.keys()].some((key) => !["embed", "platform"].includes(key));
  if (unexpectedQuery) return null;
  if (target.searchParams.getAll("embed").length > 1 || target.searchParams.getAll("platform").length > 1) return null;
  if (target.searchParams.has("embed") && target.searchParams.get("embed") !== "1") return null;
  const platform = target.searchParams.get("platform");
  if (platform !== null && platform !== "ios" && platform !== "android") return null;
  return value.payload.route;
}

export function routeForWebPath(pathname: string): NativeDeepLinkRoute | null {
  const match = (Object.entries(DEEP_LINK_PATHS) as Array<[NativeDeepLinkRoute, string]>)
    .find(([, path]) => path === pathname);
  return match?.[0] ?? null;
}

export function webPathForRoute(route: NativeDeepLinkRoute): string {
  return DEEP_LINK_PATHS[route];
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
}

function isApprovedApiProtocol(url: URL) {
  if (url.protocol === "https:") return true;
  if (url.protocol !== "http:") return false;
  const hostname = url.hostname.toLowerCase();
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname === "10.0.2.2"
    || isPrivateIpv4Host(hostname);
}

function isPrivateIpv4Host(hostname: string) {
  const octets = hostname.split(".");
  if (octets.length !== 4 || octets.some((octet) => !/^\d{1,3}$/.test(octet))) return false;
  const [first, second, third, fourth] = octets.map(Number);
  if ([first, second, third, fourth].some((octet) => octet < 0 || octet > 255)) return false;
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createClientRequestId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

async function sha256Hex(input: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function isNativeDeepLinkRoute(value: unknown): value is NativeDeepLinkRoute {
  return typeof value === "string" && Object.hasOwn(DEEP_LINK_PATHS, value);
}

function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function createAbortError() {
  if (typeof DOMException === "function") return new DOMException("요청이 취소됐습니다.", "AbortError");
  const error = new Error("요청이 취소됐습니다.");
  error.name = "AbortError";
  return error;
}

async function readResponsePayload(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new DabbobaApiError("서버 응답 형식을 확인할 수 없습니다.", response.status, "INVALID_API_RESPONSE");
  }
}
