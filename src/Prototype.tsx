import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type KeyboardEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { ActionButton } from "@seed-design/react";
import { useDrag } from "@use-gesture/react";
import "@seed-design/css/all.css";
import "@fontsource/press-start-2p/latin-400.css";
import {
  IconArrowLeftLine,
  IconBellLine,
  IconBoxFlapLine,
  IconCameraLine,
  IconCardLine,
  IconCheckmarkCircleFill,
  IconCheckmarkLine,
  IconChevronRightLine,
  IconCouponLine,
  IconDocumentLine,
  IconEnvelopeLine,
  IconGearLine,
  IconDot3HorizontalChatbubbleLeftLine,
  IconGridLine,
  IconHeartFill,
  IconHeartLine,
  IconLockLine,
  IconMagnifyingglassLine,
  IconMegaphoneLine,
  IconMinusLine,
  IconPencilLine,
  IconPerson2Line,
  IconPlusLine,
  IconQuestionmarkCircleLine,
  IconReceiptLine,
  IconTruckLine,
  IconTrashcanLine,
  IconXmarkLine,
} from "@karrotmarket/react-monochrome-icon";
import {
  BottomSheet,
  Carousel,
  FlowStack,
  KeyboardInput,
  KeyboardTextarea,
  MobileScroll,
  useKeyboard,
  useFlow,
  type FlowControls,
  type FlowScreen,
} from "./mobile";
import { AppBottomNavigation } from "./components/AppBottomNavigation";
import {
  DEFAULT_EXCHANGE_APPLICATIONS,
  DEFAULT_EXCHANGE_POSTS,
  DEFAULT_PRODUCT_REQUESTS,
  EXCHANGE_FILTERS,
  REQUEST_CATEGORY_IDS,
  type ExchangeApplication,
  type ExchangeFilter,
  type ExchangePost,
  type ProductRequest,
} from "./data/exchangeRequestFixtures";
import {
  POPULAR_EXCHANGE_CATALOG_ITEMS,
  type ExchangeCatalogItem,
} from "./data/exchangeCatalogFixtures";
import { IP_CATALOG } from "./data/ipCatalog";
import { PRODUCTS, type CatalogProduct } from "./data/productCatalog";
import {
  DEFAULT_MEMBER_SETTINGS,
  PROFILE_CUSTOMER_FAQS,
  type MemberSettings,
} from "./data/profileFixtures";
import {
  APP_REFERENCE_VALUE_NOTICE,
  CURRENT_USER_ID,
  createInitialSessionCommerceState,
  decideSessionExchangeApplication,
  eligibleDrawExchangeProposalUnits,
  exchangeDecisionKey,
  recordSessionInventoryUnitOnce,
  recordSessionOrderOnce,
  requestSessionShipping,
  setSessionInventoryExchangeStatus,
  toggleSessionWishlist,
  updateSessionOrderStatus,
  type ExchangeApplicationDecision,
  type SessionCommerceState,
  type SessionExchangeStatus,
  type SessionInventoryUnit,
  type SessionOrder,
  type SessionShippingRequest,
} from "./data/sessionCommerceFixtures";
import {
  LEGAL_RELEASE_CHECKLIST,
  SETTINGS_LEGAL_DOCUMENTS,
  SETTINGS_NOTICES,
  type LegalDocument,
  type SettingsNotice,
} from "./data/settingsFixtures";
import {
  DUCKROOM_FILTERS,
  DUCKROOM_SHOWCASES,
  type DuckroomFilter,
  type DuckroomShowcase,
} from "./data/socialFixtures";
import {
  CUSTOMER_VISIBLE_PRODUCT_CATEGORIES,
  CUSTOMER_VISIBLE_PRODUCT_CATEGORY_LABELS,
  categoryLabel,
  isCustomerBrowsableProductCategory,
  isCustomerVisibleProductCategory,
  isRandomDrawCategory,
  matchesIpSearch,
  normalizeCatalogSearch,
  type IpRecord,
  type ProductCategoryId,
  type ProductCategoryLabel,
} from "./domain/catalog";
import type { RootTabId } from "./domain/navigation";
import {
  computeSessionRefreshDelay,
  computeSessionRefreshRetryDelay,
  deriveAccountShippingInventoryState,
  DabbobaApiClient,
  DabbobaApiError,
  errorMessage as apiErrorMessage,
  parseNativeDeepLinkMessage,
  routeForWebPath,
  webPathForRoute,
  type ApiAccountNotification,
  type ApiAccountOrder,
  type ApiAccountDrawEntitlement,
  type ApiAccountShippingRequest,
  type ApiAccountDeletionRequest,
  type ApiAccountProfile,
  type ApiCatalogCharacter,
  type ApiCatalogRequest,
  type ApiDefaultShippingAddress,
  type ApiDrawOdds,
  type ApiDrawResult,
  type ApiCatalogIp,
  type ApiCatalogProduct,
  type ApiBlockedUser,
  type ApiBlockResult,
  type ApiCommunityComment,
  type ApiCommunityCommentDeleteResult,
  type ApiCommunityPostDeleteResult,
  type ApiCommunityPostLikeResult,
  type ApiCommunityPost,
  type ApiExchangeListing,
  type ApiExchangeListingDetail,
  type ApiExchangeOffer,
  type ApiInquiry,
  type ApiInquiryDetail,
  type ApiInquiryMessage,
  type ApiInventoryUnit,
  type ApiMediaReadUrl,
  type ApiMediaReady,
  type ApiNotificationPreferences,
  type ApiNotice,
  type ApiOrder,
  type ApiReport,
  type ApiReportReason,
  type ApiShippingRequest,
  type ApiWantedRequest,
  type ApiWantedRequestDeleteResult,
  type ApiWantedRequestLikeResult,
  type ApiWishlistItem,
  type ApiDevelopmentSession,
  type NativeDeepLinkRoute,
} from "./services/dabbobaApi";

type Category = ProductCategoryLabel;
type CategoryFilter = "전체" | Category;
type RequestFilter = "all" | ProductCategoryId;
type PaymentMethod = "간편카드" | "카카오페이" | "네이버페이";
type DrawState = "ready" | "transitioning" | "drawing" | "result" | "done";
type PrizeGrade = "S" | "A" | "B";
type IpDetailTab = "상품" | "캐릭터" | "스냅" | "교환방";
type SplashState = "visible" | "leaving" | "hidden";
type RootNavigationState = "expanded" | "compact";
type AuthIntent =
  | { kind: "exchange-post"; postId: string }
  | { kind: "exchange-compose" }
  | { kind: "request-compose" }
  | { kind: "catalog-request" }
  | { kind: "request-like"; requestId: string }
  | { kind: "community-compose" }
  | { kind: "community-like"; postId: string }
  | { kind: "community-comment"; postId: string }
  | { kind: "community-block"; userId: string }
  | { kind: "community-report"; postId: string; targetType: "POST" | "SNAP" };
type UserProfile = {
  id: string;
  nickname: string;
  bio: string;
  favoriteIpId: string;
};
type ApiSyncState = "prototype" | "loading" | "ready" | "partial" | "error";
type RemoteAddressState = "prototype" | "unavailable" | "loading" | "ready" | "missing" | "error";
type DrawOddsLoadState = "loading" | "ready" | "unavailable" | "error";
type UserMutationResult<T = undefined> = {
  ok: boolean;
  source: "prototype" | "remote";
  message: string;
  data?: T;
  code?: string;
};

type Product = CatalogProduct;
type UiDuckroomShowcase = DuckroomShowcase & {
  authorId?: string;
  kind?: ApiCommunityPost["kind"];
  title?: string;
  content?: string;
  ipId?: string | null;
  commentCount?: number;
  createdAt?: string;
  version?: number;
  likedByViewer?: boolean;
  mediaIds?: string[];
  mediaUrl?: string;
};

const EMPTY_DEFAULT_ADDRESS: MemberSettings["defaultAddress"] = {
  recipient: "",
  phone: "",
  postalCode: "",
  addressLine1: "",
  addressLine2: "",
  deliveryNote: "",
};

const EMPTY_REMOTE_MEMBER_SETTINGS: MemberSettings = {
  personal: { legalName: "", email: "", phone: "", birthDate: "" },
  defaultAddress: EMPTY_DEFAULT_ADDRESS,
  paymentCard: null,
  paymentPreferences: {
    defaultMethod: "card",
    cashReceiptPhone: "",
    requirePaymentConfirmation: true,
  },
  security: { passwordUpdatedAt: "", twoFactorEnabled: false, socialLogin: "" },
  privacy: {
    orderUpdates: true,
    exchangeUpdates: false,
    requestUpdates: false,
    restockUpdates: false,
    marketingSms: false,
    marketingEmail: false,
    marketingPush: false,
    personalizedRecommendations: false,
  },
};

const EMPTY_PRODUCT_IMAGE_SRC = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='3' viewBox='0 0 4 3'%3E%3Crect width='4' height='3' fill='%23F0F0EA'/%3E%3C/svg%3E";
const products: Product[] = PRODUCTS;

type ExchangeSelectableItem = ExchangeCatalogItem & {
  catalogItemId: string;
  image: string;
  inventoryUnitId?: string;
};

const exchangeCatalogItems: ExchangeSelectableItem[] = [
  ...POPULAR_EXCHANGE_CATALOG_ITEMS.map((item) => ({
    ...item,
    catalogItemId: item.id,
    image: products.find((product) => product.id === item.productId)?.asset ?? "",
  })),
  ...products.map((product, index) => ({
    id: `catalog-${product.id}`,
    catalogItemId: `catalog-${product.id}`,
    productId: product.id,
    ipId: product.ipId,
    categoryId: product.categoryId,
    name: product.title,
    image: product.asset,
    estimatedPrice: product.price,
    searchCount: Math.max(80, 420 - index * 11),
    postCount: Math.max(12, 76 - index * 2),
  })),
];

function exchangeItemSuggestions(
  query: string,
  items: readonly ExchangeSelectableItem[] = exchangeCatalogItems,
  ips: readonly IpRecord[] = IP_CATALOG,
) {
  const normalizedQuery = normalizeCatalogSearch(query);
  if (normalizedQuery.length < 2) return [];

  return items
    .map((item) => {
      const ip = ips.find((candidate) => candidate.id === item.ipId);
      const normalizedName = normalizeCatalogSearch(item.name);
      const searchable = normalizeCatalogSearch([
        item.name,
        ip?.nameKo,
        ip?.nameEn,
        ip?.nameJa,
        ...(ip?.aliases ?? []),
      ].filter(Boolean).join(" "));
      if (!searchable.includes(normalizedQuery)) return null;
      const matchRank = normalizedName === normalizedQuery ? 0 : normalizedName.startsWith(normalizedQuery) ? 1 : 2;
      return { item, matchRank, popularity: item.postCount * 10 + item.searchCount };
    })
    .filter((candidate): candidate is { item: ExchangeSelectableItem; matchRank: number; popularity: number } => Boolean(candidate))
    .sort((left, right) => left.matchRank - right.matchRank || right.popularity - left.popularity)
    .slice(0, 6)
    .map((candidate) => candidate.item);
}

function inventoryExchangeItems(inventoryUnits: readonly SessionInventoryUnit[]): ExchangeSelectableItem[] {
  return inventoryUnits.map((unit) => ({
    id: unit.id,
    inventoryUnitId: unit.id,
    catalogItemId: unit.catalogItemId,
    productId: unit.productId,
    ipId: unit.ipId,
    categoryId: unit.categoryId,
    name: unit.itemName,
    image: unit.itemImage,
    estimatedPrice: unit.appReferenceValue,
    searchCount: 0,
    postCount: 0,
  }));
}

const filters: CategoryFilter[] = ["전체", ...CUSTOMER_VISIBLE_PRODUCT_CATEGORY_LABELS];
const customerVisibleRequestCategoryIds = REQUEST_CATEGORY_IDS.filter(isCustomerVisibleProductCategory);
const paymentMethods: PaymentMethod[] = ["간편카드", "카카오페이", "네이버페이"];
const couponOptions = [1_000, 0] as const;
const ipDetailTabs: IpDetailTab[] = ["상품", "캐릭터", "스냅", "교환방"];
const DABBOBA_WORDMARK_SRC = "/assets/dabboba/brand/dabboba-wordmark.png";
const ROOT_NAVIGATION_TOP_THRESHOLD = 12;
const ROOT_NAVIGATION_COLLAPSE_THRESHOLD = 18;
const ROOT_NAVIGATION_EXPAND_THRESHOLD = 10;
const DEVELOPMENT_USER_SESSION_KEY = "dabboba.development-user-session";

function readDevelopmentUserSessionToken() {
  if (import.meta.env?.DEV !== true) return null;
  try {
    return window.sessionStorage.getItem(DEVELOPMENT_USER_SESSION_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

function storeDevelopmentUserSessionToken(token: string | null) {
  if (import.meta.env?.DEV !== true) return;
  try {
    if (token) window.sessionStorage.setItem(DEVELOPMENT_USER_SESSION_KEY, token);
    else window.sessionStorage.removeItem(DEVELOPMENT_USER_SESSION_KEY);
  } catch {
    // A privacy-restricted browser may disable sessionStorage. The in-memory
    // token remains usable for the current development preview.
  }
}

function formatWon(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

function exchangePriceLabel(value: number | undefined) {
  return value === undefined ? "참고값 확인 중" : formatWon(value);
}

function formatPoints(value: number) {
  return `${value.toLocaleString("ko-KR")}P`;
}

function drawOddsInventorySignature(odds: ApiDrawOdds) {
  return JSON.stringify([
    odds.version,
    odds.entries.map((entry) => [
      entry.id,
      entry.remainingQuantity,
      entry.probabilityNumerator,
      entry.probabilityDenominator,
    ]),
  ]);
}

function formatDrawOddsCalculatedAt(value: string) {
  const calculatedAt = new Date(value);
  if (Number.isNaN(calculatedAt.getTime())) return "조회 시점";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(calculatedAt);
}

function drawOddsPoolKind(odds: ApiDrawOdds) {
  const finiteEntryCount = odds.entries.filter((entry) => entry.remainingQuantity !== null).length;
  if (finiteEntryCount === 0) return "고정 가중치";
  if (finiteEntryCount === odds.entries.length) return "수량 제한형";
  return "혼합형";
}

function ServerDrawOddsTable({ odds, compact = false, label }: { odds: ApiDrawOdds; compact?: boolean; label: string }) {
  return (
    <table className={`server-odds-table${compact ? " compact" : ""}`} aria-label={label}>
      <thead>
        <tr>
          <th scope="col">등급</th>
          <th scope="col">경품</th>
          <th scope="col">현재 확률</th>
        </tr>
      </thead>
      <tbody>
        {odds.entries.map((entry) => (
          <tr key={entry.id}>
            <td><span>{entry.rarity}</span></td>
            <td>
              <b>{entry.prizeName}</b>
              <small>
                {entry.remainingQuantity === null
                  ? "수량 제한 없음"
                  : `초기 ${entry.initialQuantity?.toLocaleString("ko-KR") ?? "-"}개 · 남음 ${entry.remainingQuantity.toLocaleString("ko-KR")}개`}
                {` · 현재 산식 ${entry.probabilityNumerator.toLocaleString("ko-KR")} / ${entry.probabilityDenominator.toLocaleString("ko-KR")}`}
              </small>
            </td>
            <td><em>{entry.probabilityPercent.toLocaleString("ko-KR", { maximumFractionDigits: 6 })}%</em></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DrawOddsDisclosure({ odds, compact = false }: { odds: ApiDrawOdds; compact?: boolean }) {
  const finiteEntryCount = odds.entries.filter((entry) => entry.remainingQuantity !== null).length;
  const poolDescription = finiteEntryCount === 0
    ? "남은 수량을 차감하지 않는 고정 가중치 구성입니다. 이전 결과는 다음 회차의 확률을 바꾸지 않습니다."
    : finiteEntryCount === odds.entries.length
      ? "경품별 수량이 정해진 구성입니다. 당첨된 경품의 수량이 차감되면 이후 확률이 달라집니다."
      : "수량 제한 경품과 고정 가중치 경품이 함께 있는 구성입니다. 경품별 남은 수량과 현재 확률을 함께 확인해 주세요.";

  return (
    <aside className={`draw-odds-disclosure${compact ? " compact" : ""}`} aria-label="확률 및 경품 수량 안내">
      <div className="draw-odds-disclosure-heading">
        <span>
          <IconQuestionmarkCircleLine size={19} aria-hidden="true" />
          <strong>확률·수량 안내</strong>
        </span>
        <time dateTime={odds.calculatedAt}>{formatDrawOddsCalculatedAt(odds.calculatedAt)} 조회 기준</time>
      </div>
      <div className="draw-odds-meta" aria-label="확률표 계산 정보">
        <span>{drawOddsPoolKind(odds)}</span>
        <span>확률표 v{odds.version}</span>
        <span>총 유효 가중치 {odds.totalEffectiveWeight.toLocaleString("ko-KR")}</span>
      </div>
      {compact ? (
        <ul>
          <li>표시 값은 조회 시점 기준이며, 다른 추첨이 처리되면 실제 추첨 직전의 남은 수량과 확률이 달라질 수 있습니다.</li>
          <li>중복 방지가 별도로 표시되지 않은 경우 남은 수량이 있는 같은 경품을 다시 받을 수 있습니다.</li>
        </ul>
      ) : (
        <>
          <p>{poolDescription}</p>
          <ul>
            <li>현재 확률은 수량 제한 경품의 설정 가중치 × 남은 수량을 전체 유효 가중치로 나눠 계산합니다. 수량 제한이 없으면 설정 가중치를 그대로 반영하며, 단순 1/n 균등 확률이 아닐 수 있습니다.</li>
            <li>표시된 수량과 확률은 조회 시점 기준입니다. 여러 추첨이 동시에 진행되면 서버 처리 순서에 따라 실제 추첨 직전 값이 달라질 수 있습니다.</li>
            <li>시크릿·희귀 경품은 위 표에 개별 항목과 정확한 확률이 표시된 경우에만 추첨 대상입니다.</li>
            <li>중복 방지나 확정 보상이 별도로 표시되지 않은 경우, 남은 수량이 있는 같은 경품을 다시 받을 수 있습니다.</li>
          </ul>
        </>
      )}
      <p className="draw-odds-server-note">
        결제 직전에 최신 확률표를 다시 확인합니다. 결제된 추첨권에는 확인한 확률표 버전(v{odds.version})이 기록되며,
        실제 결과는 추첨 시 같은 버전의 최신 남은 수량을 기준으로 서버가 먼저 확정합니다.
      </p>
    </aside>
  );
}

function isOptionalAbsoluteUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return true;
  try {
    new URL(trimmed);
    return true;
  } catch {
    return false;
  }
}

function createSessionId(prefix: string) {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function sessionDateLabel(date = new Date()) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date).replace(/\. /g, ".").replace(/\.$/, "");
}

function sessionShippingDeadlineLabel(date = new Date()) {
  const deadline = new Date(date);
  deadline.setDate(deadline.getDate() + 30);
  return sessionDateLabel(deadline);
}

function serverDateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date).replace(/\s/g, "");
}

function metadataText(metadata: Record<string, unknown>, key: string, fallback: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function mapApiProduct(item: ApiCatalogProduct): Product {
  return {
    id: item.id,
    ipId: item.ipId,
    categoryId: item.category,
    category: categoryLabel(item.category) as ProductCategoryLabel,
    line: metadataText(item.metadata, "line", item.manufacturer ?? item.name),
    title: item.name,
    description: metadataText(item.metadata, "description", "상품 상세 정보는 운영자가 준비 중입니다."),
    price: item.price,
    stock: item.availableQuantity,
    asset: item.imageUrl ?? EMPTY_PRODUCT_IMAGE_SRC,
    edition: metadataText(item.metadata, "edition", "DABBOBA"),
    reward: metadataText(item.metadata, "reward", item.name),
    sourcePage: "server",
  };
}

function mapApiIp(
  item: ApiCatalogIp,
  remoteProducts: readonly Product[],
  remoteCharacters: readonly ApiCatalogCharacter[],
): IpRecord {
  const categories = [...new Set(remoteProducts
    .filter((product) => product.ipId === item.id)
    .map((product) => product.categoryId))];
  return {
    id: item.id,
    slug: item.slug,
    nameKo: item.nameKo,
    nameEn: item.nameEn,
    nameJa: item.nameJa ?? "",
    aliases: item.aliases,
    image: item.imageUrl ?? "",
    description: item.description,
    featured: false,
    isActive: item.isActive,
    availableCategories: categories,
    characters: remoteCharacters
      .filter((character) => character.ipId === item.id)
      .map((character) => character.name),
    sourceMediaId: "server",
    sourcePage: "server",
  };
}

function mapApiNotice(item: ApiNotice): SettingsNotice {
  const firstLine = item.content.split(/\n+/).find((line) => line.trim())?.trim() ?? "공지 내용을 확인해 주세요.";
  return {
    id: item.id,
    title: item.title,
    summary: firstLine.length > 72 ? `${firstLine.slice(0, 72)}…` : firstLine,
    postedAt: serverDateLabel(item.publishedAt ?? item.createdAt),
    important: item.isPinned,
    sections: [{ heading: "안내", body: item.content }],
  };
}

function mapApiWantedRequest(item: ApiWantedRequest): ProductRequest {
  return {
    id: item.id,
    authorId: item.userId,
    author: item.authorNickname,
    categoryId: item.category,
    ipId: item.ipId,
    desiredItem: item.desiredItem,
    details: item.details,
    time: serverDateLabel(item.createdAt),
    likes: item.likeCount,
    version: item.version,
  };
}

function mapApiAccountProfile(item: ApiAccountProfile): UserProfile {
  return {
    id: item.id,
    nickname: item.nickname,
    bio: item.bio ?? "",
    favoriteIpId: item.favoriteIp?.id ?? "",
  };
}

function mapApiDefaultAddress(item: ApiDefaultShippingAddress): MemberSettings["defaultAddress"] {
  return {
    recipient: item.recipient,
    phone: item.phone,
    postalCode: item.postalCode,
    addressLine1: item.addressLine1,
    addressLine2: item.addressLine2 ?? "",
    deliveryNote: item.deliveryNote ?? "",
  };
}

function accountOrderStatusLabel(status: ApiAccountOrder["status"]) {
  const labels: Record<ApiAccountOrder["status"], string> = {
    PENDING_PAYMENT: "결제 대기",
    PAID: "결제 완료",
    FULFILLED: "처리 완료",
    CANCELLED: "취소",
    REFUND_REVIEW: "환불 검토",
    REFUNDED: "환불 완료",
  };
  return labels[status];
}

function accountShippingStatusLabel(status: ApiAccountShippingRequest["status"]) {
  const labels: Record<ApiAccountShippingRequest["status"], string> = {
    REQUESTED: "신청 접수",
    PROCESSING: "포장 중",
    SHIPPED: "배송 중",
    DELIVERED: "배송 완료",
    CANCELLED: "신청 취소",
  };
  return labels[status];
}

function maskedShippingAddressLabel(destination: ApiAccountShippingRequest["destination"]) {
  const coarseAddress = destination.addressLine1.trim().split(/\s+/).slice(0, 2).join(" ");
  return [
    destination.postalCode ? `[${destination.postalCode}]` : "",
    coarseAddress ? `${coarseAddress} ***` : "주소 비공개",
  ].filter(Boolean).join(" ");
}

function applyRemoteShippingState(
  inventoryUnits: SessionInventoryUnit[],
  shippingRequests: readonly ApiAccountShippingRequest[],
) {
  const { unavailableIds, cancelledOnlyIds } = deriveAccountShippingInventoryState(shippingRequests);
  return inventoryUnits.map((unit) => {
    if (unavailableIds.has(unit.id)) {
      return { ...unit, shippingStatus: "requested" as const, exchangeStatus: "matched" as const };
    }
    if (
      cancelledOnlyIds.has(unit.id)
      && unit.shippingStatus === "requested"
      && unit.exchangeStatus === "matched"
    ) {
      return { ...unit, shippingStatus: "stored" as const, exchangeStatus: "available" as const };
    }
    return unit;
  });
}

function mergeAccountShippingRequest(
  current: ApiAccountShippingRequest[],
  next: ApiAccountShippingRequest,
) {
  return current.some((item) => item.id === next.id)
    ? current.map((item) => item.id === next.id ? next : item)
    : [next, ...current];
}

function notificationPreferencesToPrivacy(
  preferences: ApiNotificationPreferences,
): MemberSettings["privacy"] {
  return {
    orderUpdates: true,
    exchangeUpdates: preferences.exchangeUpdates,
    requestUpdates: preferences.requestUpdates,
    restockUpdates: preferences.restockUpdates,
    marketingSms: preferences.marketingSms,
    marketingEmail: preferences.marketingEmail,
    marketingPush: preferences.marketingPush,
    personalizedRecommendations: preferences.personalizedRecommendations,
  };
}

function mapApiInventoryUnit(item: ApiInventoryUnit): SessionInventoryUnit {
  const product = mapApiProduct(item.product);
  const source: SessionInventoryUnit["source"] = item.sourceType === "GACHA"
    ? "gacha"
    : item.sourceType === "KUJI"
      ? "kuji"
      : item.sourceType === "ADMIN_ADJUSTMENT"
        ? "admin-adjustment"
        : "direct-purchase";
  const exchangeStatus: SessionExchangeStatus = item.status === "EXCHANGE_LISTED"
    ? "listed"
    : item.status === "EXCHANGE_OFFERED"
      ? "offered"
      : item.status === "TRANSFERRED"
        ? "matched"
        : "available";
  return {
    id: item.id,
    ownerId: item.ownerId,
    catalogItemId: `catalog-${item.productId}`,
    productId: item.productId,
    ipId: product.ipId,
    categoryId: product.categoryId,
    itemName: product.title,
    itemImage: product.asset,
    appReferenceValue: product.price,
    source,
    acquiredAt: serverDateLabel(item.acquiredAt),
    shippingDeadline: sessionShippingDeadlineLabel(new Date(item.acquiredAt)),
    shippingStatus: item.status === "SHIPPING" || item.status === "DELIVERED" ? "requested" : "stored",
    exchangeStatus,
  };
}

function mapApiExchangeListing(item: ApiExchangeListing): ExchangePost {
  const inventory = mapApiInventoryUnit(item.offeredInventory);
  return {
    id: item.id,
    authorId: item.authorId,
    author: item.authorNickname,
    categoryId: inventory.categoryId,
    ipId: inventory.ipId,
    title: item.title,
    offeredInventoryUnitId: inventory.id,
    offeredCatalogItemId: inventory.catalogItemId,
    offeredItem: inventory.itemName,
    offeredItemImage: inventory.itemImage,
    appReferenceValue: inventory.appReferenceValue,
    sourceType: item.offeredInventory.sourceType,
    body: item.details,
    time: serverDateLabel(item.createdAt),
    applications: item.offerCount,
    lifecycleStatus: item.status,
    acceptedOfferId: item.acceptedOfferId,
    authorConfirmedAt: item.authorConfirmedAt,
    proposerConfirmedAt: item.proposerConfirmedAt,
  };
}

function mapApiExchangeOffer(item: ApiExchangeOffer, author: string): ExchangeApplication {
  const inventory = mapApiInventoryUnit(item.offeredInventory);
  return {
    id: item.id,
    authorId: item.proposerId,
    author,
    offeredInventoryUnitId: inventory.id,
    offeredCatalogItemId: inventory.catalogItemId,
    ipId: inventory.ipId,
    categoryId: inventory.categoryId,
    offeredItem: inventory.itemName,
    offeredItemImage: inventory.itemImage,
    appReferenceValue: inventory.appReferenceValue,
    sourceType: item.offeredInventory.sourceType,
    time: serverDateLabel(item.createdAt),
    status: item.status,
  };
}

function mergeApiExchangeListing(current: ExchangePost[], listing: ApiExchangeListing) {
  if (listing.status !== "OPEN") return current.filter((item) => item.id !== listing.id);
  const mapped = mapApiExchangeListing(listing);
  return current.some((item) => item.id === mapped.id)
    ? current.map((item) => item.id === mapped.id ? mapped : item)
    : [mapped, ...current];
}

function exchangeListingStatusLabel(status: ApiExchangeListing["status"] | undefined) {
  if (status === "MATCHED") return "교환 확인 중";
  if (status === "COMPLETED") return "교환 완료";
  if (status === "CANCELLED") return "취소됨";
  if (status === "HIDDEN") return "숨김 처리";
  return "교환 가능";
}

function exchangeOfferStatusLabel(status: ApiExchangeOffer["status"] | undefined) {
  if (status === "ACCEPTED") return "수락됨";
  if (status === "REJECTED") return "거절됨";
  if (status === "WITHDRAWN") return "철회됨";
  return "검토 대기";
}

function mapApiCommunityPost(item: ApiCommunityPost, catalogProducts: readonly Product[]): UiDuckroomShowcase {
  const product = catalogProducts.find((candidate) => candidate.ipId === item.ipId);
  return {
    id: item.id,
    authorId: item.authorId,
    author: item.authorNickname,
    caption: item.title || item.content,
    title: item.title,
    content: item.content,
    ipId: item.ipId,
    commentCount: item.commentCount,
    createdAt: item.createdAt,
    categoryId: product?.categoryId ?? "figure",
    productId: product?.id ?? "",
    collectedCount: item.mediaIds.length,
    likes: item.likeCount,
    kind: item.kind,
    version: item.version,
    likedByViewer: item.likedByViewer,
    mediaIds: item.mediaIds,
  };
}

function mergeCommunityShowcase(current: UiDuckroomShowcase[], next: UiDuckroomShowcase) {
  const previous = current.find((item) => item.id === next.id);
  const previousMediaId = previous?.mediaIds?.[0];
  const nextMediaId = next.mediaIds?.[0];
  const withPreservedMedia = !next.mediaUrl && nextMediaId && nextMediaId === previousMediaId
    ? { ...next, mediaUrl: previous?.mediaUrl }
    : next;
  return current.some((item) => item.id === next.id)
    ? current.map((item) => item.id === next.id ? withPreservedMedia : item)
    : [withPreservedMedia, ...current];
}

function exchangeApplicationCount(post: ExchangePost, applications: readonly ExchangeApplication[]) {
  const seededVisibleCount = DEFAULT_EXCHANGE_APPLICATIONS[post.id]?.length ?? 0;
  return post.applications + Math.max(0, applications.length - seededVisibleCount);
}

function useScreenEntryFocus() {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => ref.current?.focus({ preventScroll: true }), 80);
    return () => window.clearTimeout(timer);
  }, []);

  return ref;
}

function handleRadioArrow<T>(
  event: KeyboardEvent<HTMLButtonElement>,
  options: readonly T[],
  index: number,
  select: (value: T) => void,
) {
  if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(event.key)) return;
  event.preventDefault();
  const delta = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
  const nextIndex = (index + delta + options.length) % options.length;
  const group = event.currentTarget.parentElement;
  select(options[nextIndex]);
  window.requestAnimationFrame(() => {
    group?.querySelectorAll<HTMLElement>('[role="radio"]')[nextIndex]?.focus();
  });
}

function rollPrizeGrade(): PrizeGrade {
  const roll = Math.random() * 100;
  if (roll < 2) return "S";
  if (roll < 20) return "A";
  return "B";
}

function isPrizeGrade(value: string): value is PrizeGrade {
  return value === "S" || value === "A" || value === "B";
}

function rewardForGrade(product: Product, grade: PrizeGrade) {
  const [secret, special] = prizeGuideFor(product.categoryId);
  if (grade === "S") return `${product.line} ${secret}`;
  if (grade === "A") return `${product.line} ${special}`;
  return product.reward;
}

const prizeGuides: Record<ProductCategoryId, readonly [string, string, string]> = {
  gacha: ["시크릿 컬러", "레어 디자인", "기본 디자인"],
  figure: ["시크릿 컬러", "스페셜 파츠", "기본 에디션"],
  kuji: ["라스트원상", "상위상", "굿즈상"],
  tcg: ["시크릿 레어", "홀로 레어", "커먼·언커먼"],
};

function prizeGuideFor(categoryId: ProductCategoryId) {
  return prizeGuides[categoryId];
}

function commerceCopyFor(product: Product) {
  if (product.categoryId === "gacha") {
    return { action: "가챠 뽑기", quantityTitle: "뽑기 횟수", quantityDescription: "진행할 횟수를 선택해 주세요.", unit: "회" } as const;
  }
  if (product.categoryId === "kuji") {
    return { action: "쿠지 참여하기", quantityTitle: "쿠지 수량", quantityDescription: "구매할 쿠지 장 수를 선택해 주세요.", unit: "장" } as const;
  }
  if (product.categoryId === "tcg") {
    return { action: "구매하기", quantityTitle: "팩 수량", quantityDescription: "구매할 카드 팩 수를 선택해 주세요.", unit: "팩" } as const;
  }
  return { action: "구매하기", quantityTitle: "구매 수량", quantityDescription: "구매할 상품 수량을 선택해 주세요.", unit: "개" } as const;
}

function commerceUnit(product: Product) {
  return commerceCopyFor(product).unit;
}

function purchaseGuideFor(product: Product) {
  if (product.categoryId === "figure") {
    return [
      ["판매 방식", "일반 상품 구매"],
      ["상품 구성", "피규어 본품 1개"],
      ["배송", "결제 후 배송 준비"],
    ] as const;
  }

  return [
    ["판매 방식", "미개봉 카드팩 구매"],
    ["상품 구성", "카드 팩 1팩"],
    ["배송", "결제 후 배송 준비"],
  ] as const;
}

function returnToCatalog(flow: FlowControls) {
  const steps = Math.max(0, flow.stack.length - 1);
  for (let step = 0; step < steps; step += 1) flow.pop();

  const focusCurrentMain = () => {
    const activeScreens = document.querySelectorAll<HTMLElement>('.flow-screen[data-flow-current="true"]');
    activeScreens[activeScreens.length - 1]?.querySelector<HTMLElement>("main")?.focus({ preventScroll: true });
  };

  // Radix restores focus after its sheet exit. Re-assert focus once the route
  // transition and the dialog exit have both settled.
  [180, 480, 820].forEach((delay) => window.setTimeout(focusCurrentMain, delay));
}

type DabbobaContextValue = {
  currentUserId: string;
  apiMode: "prototype" | "remote";
  apiSyncState: ApiSyncState;
  apiSyncMessage: string;
  catalogProducts: Product[];
  drawOddsByProductId: Record<string, ApiDrawOdds>;
  drawOddsStateByProductId: Record<string, DrawOddsLoadState>;
  loadDrawOdds: (productId: string, force?: boolean) => Promise<UserMutationResult<ApiDrawOdds>>;
  catalogIps: IpRecord[];
  notices: SettingsNotice[];
  duckroomShowcases: UiDuckroomShowcase[];
  inquiries: ApiInquiry[];
  wishlistItems: ApiWishlistItem[];
  accountOrders: ApiAccountOrder[];
  accountDrawEntitlements: ApiAccountDrawEntitlement[];
  accountShippingRequests: ApiAccountShippingRequest[];
  accountNotifications: ApiAccountNotification[];
  notificationPreferences: ApiNotificationPreferences | null;
  remoteAddressState: RemoteAddressState;
  isAuthenticated: boolean;
  setIsAuthenticated: Dispatch<SetStateAction<boolean>>;
  createDevelopmentSession: (email: string) => Promise<UserMutationResult<ApiDevelopmentSession>>;
  logoutUserSession: () => Promise<UserMutationResult>;
  requestAccountDeletion: (idempotencyKey?: string) => Promise<UserMutationResult<ApiAccountDeletionRequest>>;
  authIntent: AuthIntent | null;
  setAuthIntent: Dispatch<SetStateAction<AuthIntent | null>>;
  exchangeComposerRequested: boolean;
  setExchangeComposerRequested: Dispatch<SetStateAction<boolean>>;
  requestComposerRequested: boolean;
  setRequestComposerRequested: Dispatch<SetStateAction<boolean>>;
  catalogRequestComposerRequested: boolean;
  setCatalogRequestComposerRequested: Dispatch<SetStateAction<boolean>>;
  communityComposerRequested: boolean;
  setCommunityComposerRequested: Dispatch<SetStateAction<boolean>>;
  communityReportRequested: { postId: string; targetType: "POST" | "SNAP" } | null;
  setCommunityReportRequested: Dispatch<SetStateAction<{ postId: string; targetType: "POST" | "SNAP" } | null>>;
  activeRootTab: RootTabId;
  setActiveRootTab: Dispatch<SetStateAction<RootTabId>>;
  profile: UserProfile;
  setProfile: Dispatch<SetStateAction<UserProfile>>;
  updateProfile: (input: Omit<UserProfile, "id">, idempotencyKey?: string) => Promise<UserMutationResult<ApiAccountProfile>>;
  profileSaveNotice: string;
  setProfileSaveNotice: Dispatch<SetStateAction<string>>;
  memberSettings: MemberSettings;
  setMemberSettings: Dispatch<SetStateAction<MemberSettings>>;
  saveDefaultAddress: (
    address: MemberSettings["defaultAddress"],
    idempotencyKey?: string,
  ) => Promise<UserMutationResult<ApiDefaultShippingAddress>>;
  memberSaveNotice: string;
  setMemberSaveNotice: Dispatch<SetStateAction<string>>;
  exchangePosts: ExchangePost[];
  addExchangePost: (
    post: Omit<ExchangePost, "id" | "authorId" | "author" | "time" | "applications">,
    idempotencyKey?: string,
  ) => Promise<UserMutationResult>;
  exchangeApplications: Record<string, ExchangeApplication[]>;
  addExchangeApplication: (
    postId: string,
    application: Pick<
      ExchangeApplication,
      "offeredInventoryUnitId" | "offeredCatalogItemId" | "ipId" | "categoryId" | "offeredItem" | "offeredItemImage" | "appReferenceValue" | "sourceType"
    >,
    idempotencyKey?: string,
  ) => Promise<UserMutationResult<ApiExchangeOffer>>;
  loadExchangeListingDetail: (
    postId: string,
    signal?: AbortSignal,
  ) => Promise<UserMutationResult<ApiExchangeListingDetail>>;
  decideExchangeApplication: (
    postId: string,
    applicationId: string,
    decision: ExchangeApplicationDecision,
    idempotencyKey?: string,
  ) => Promise<UserMutationResult<ApiExchangeOffer>>;
  cancelExchangeListing: (
    postId: string,
    idempotencyKey?: string,
  ) => Promise<UserMutationResult<ApiExchangeListing>>;
  withdrawExchangeApplication: (
    postId: string,
    applicationId: string,
    idempotencyKey?: string,
  ) => Promise<UserMutationResult<ApiExchangeOffer>>;
  confirmExchangeCompletion: (
    postId: string,
    idempotencyKey?: string,
  ) => Promise<UserMutationResult<ApiExchangeListing>>;
  productRequests: ProductRequest[];
  addProductRequest: (
    request: Omit<ProductRequest, "id" | "authorId" | "author" | "time" | "likes">,
    idempotencyKey?: string,
  ) => Promise<UserMutationResult<ApiWantedRequest>>;
  likedProductRequestIds: Set<string>;
  toggleProductRequestLike: (
    requestId: string,
    idempotencyKey?: string,
  ) => Promise<UserMutationResult<ApiWantedRequestLikeResult>>;
  deleteProductRequest: (
    requestId: string,
    expectedVersion: number,
    idempotencyKey?: string,
  ) => Promise<UserMutationResult<ApiWantedRequestDeleteResult>>;
  submitCatalogRequest: (
    input: { kind: "PRODUCT" | "IP"; name: string; referenceUrl?: string | null; description?: string | null },
    idempotencyKey?: string,
  ) => Promise<UserMutationResult<ApiCatalogRequest>>;
  submitCommunityPost: (
    input: { kind: "DUKROOM" | "SNAP"; ipId: string | null; title: string; content: string; mediaIds?: string[] },
    idempotencyKey?: string,
  ) => Promise<UserMutationResult<ApiCommunityPost>>;
  loadCommunityPost: (
    postId: string,
    signal?: AbortSignal,
  ) => Promise<UserMutationResult<UiDuckroomShowcase>>;
  loadCommunityComments: (
    postId: string,
    signal?: AbortSignal,
  ) => Promise<UserMutationResult<ApiCommunityComment[]>>;
  submitCommunityComment: (
    postId: string,
    content: string,
    idempotencyKey?: string,
  ) => Promise<UserMutationResult<ApiCommunityComment>>;
  deleteCommunityComment: (
    commentId: string,
    idempotencyKey?: string,
  ) => Promise<UserMutationResult<ApiCommunityCommentDeleteResult>>;
  updateCommunityPost: (
    postId: string,
    input: { expectedVersion: number; title: string; content: string; ipId: string | null; mediaIds: string[] },
    idempotencyKey?: string,
  ) => Promise<UserMutationResult<UiDuckroomShowcase>>;
  uploadMedia: (
    file: File,
    purpose: "PROFILE" | "POST" | "COMMENT" | "INQUIRY" | "EXCHANGE" | "CATALOG_REQUEST",
    idempotencyKey?: string,
  ) => Promise<UserMutationResult<ApiMediaReady>>;
  toggleCommunityPostLike: (
    postId: string,
    liked: boolean,
    idempotencyKey?: string,
  ) => Promise<UserMutationResult<ApiCommunityPostLikeResult>>;
  deleteCommunityPost: (
    postId: string,
    expectedVersion: number,
    idempotencyKey?: string,
  ) => Promise<UserMutationResult<ApiCommunityPostDeleteResult>>;
  blockCommunityUser: (
    userId: string,
    idempotencyKey?: string,
  ) => Promise<UserMutationResult>;
  loadBlockedUsers: (signal?: AbortSignal) => Promise<UserMutationResult<ApiBlockedUser[]>>;
  unblockCommunityUser: (
    userId: string,
    idempotencyKey?: string,
  ) => Promise<UserMutationResult<ApiBlockResult>>;
  submitCommunityReport: (
    input: { targetType: "POST" | "SNAP"; targetId: string; reason: ApiReportReason; details?: string },
    idempotencyKey?: string,
  ) => Promise<UserMutationResult<ApiReport>>;
  submitInquiry: (
    input: { category: string; title: string; content: string },
    idempotencyKey?: string,
  ) => Promise<UserMutationResult<ApiInquiry>>;
  loadInquiryDetail: (inquiryId: string, signal?: AbortSignal) => Promise<UserMutationResult<ApiInquiryDetail>>;
  submitInquiryMessage: (
    inquiryId: string,
    input: { content: string; mediaIds?: string[] },
    idempotencyKey?: string,
  ) => Promise<UserMutationResult<ApiInquiryMessage>>;
  loadAuthenticatedMediaUrl: (
    mediaId: string,
    signal?: AbortSignal,
  ) => Promise<UserMutationResult<ApiMediaReadUrl>>;
  submitOrder: (input: { productId: string; quantity: number; pointAmount: number; expectedDrawVersion?: number; idempotencyKey?: string }) => Promise<UserMutationResult<ApiOrder>>;
  sessionCommerce: SessionCommerceState;
  toggleWishlistProduct: (productId: string, idempotencyKey?: string) => Promise<UserMutationResult<ApiWishlistItem>>;
  recordOrder: (order: SessionOrder) => void;
  updateOrderStatus: (orderId: string, status: SessionOrder["status"]) => void;
  recordInventoryUnit: (inventoryUnit: SessionInventoryUnit) => void;
  requestShipping: (request: SessionShippingRequest, idempotencyKey?: string) => Promise<UserMutationResult<ApiShippingRequest>>;
  loadShippingRequests: (signal?: AbortSignal) => Promise<UserMutationResult<ApiAccountShippingRequest[]>>;
  loadShippingRequestDetail: (
    shippingRequestId: string,
    signal?: AbortSignal,
  ) => Promise<UserMutationResult<ApiAccountShippingRequest>>;
  markNotificationRead: (notificationId: string, idempotencyKey?: string) => Promise<UserMutationResult<ApiAccountNotification>>;
  saveNotificationPreferences: (
    privacy: MemberSettings["privacy"],
    idempotencyKey?: string,
  ) => Promise<UserMutationResult<ApiNotificationPreferences>>;
  setInventoryExchangeStatus: (inventoryUnitId: string, status: SessionExchangeStatus) => void;
  pointBalance: number;
  couponDiscount: number;
  setCouponDiscount: Dispatch<SetStateAction<number>>;
  points: number;
  setPoints: Dispatch<SetStateAction<number>>;
  paymentMethod: PaymentMethod;
  setPaymentMethod: Dispatch<SetStateAction<PaymentMethod>>;
  paying: boolean;
  setPaying: Dispatch<SetStateAction<boolean>>;
  drawState: DrawState;
  setDrawState: Dispatch<SetStateAction<DrawState>>;
  drawRemaining: number;
  setDrawRemaining: Dispatch<SetStateAction<number>>;
  resultOpen: boolean;
  setResultOpen: Dispatch<SetStateAction<boolean>>;
  resultGrade: string;
  setResultGrade: Dispatch<SetStateAction<string>>;
  drawControlProgress: number;
  setDrawControlProgress: Dispatch<SetStateAction<number>>;
  prepareCheckout: () => void;
  prepareDraw: (count: number) => void;
  loadOrder: (orderId: string, signal?: AbortSignal) => Promise<UserMutationResult<ApiOrder>>;
  consumeDrawEntitlement: (entitlementId: string, idempotencyKey?: string) => Promise<UserMutationResult<ApiDrawResult>>;
};

const DabbobaContext = createContext<DabbobaContextValue | null>(null);

function useDabboba() {
  const context = useContext(DabbobaContext);
  if (!context) throw new Error("useDabboba must be used inside DabbobaContext");
  return context;
}

function DabbobaWordmark({ className = "", alt = "DABBOBA" }: { className?: string; alt?: string }) {
  return (
    <img
      src={DABBOBA_WORDMARK_SRC}
      className={`dabboba-wordmark ${className}`.trim()}
      alt={alt}
      draggable={false}
      decoding="async"
    />
  );
}

export default function Prototype() {
  const [apiRuntime] = useState(() => {
    try {
      const client = new DabbobaApiClient();
      if (client.remoteEnabled) client.setToken(readDevelopmentUserSessionToken());
      return { client, configurationError: "" };
    } catch (error) {
      return {
        client: new DabbobaApiClient({
          configuration: import.meta.env?.PROD === true
            ? { mode: "remote" as const, baseUrl: null, token: null }
            : { mode: "prototype" as const, baseUrl: null, token: null },
        }),
        configurationError: apiErrorMessage(error),
      };
    }
  });
  const [splashState, setSplashState] = useState<SplashState>("visible");
  const [apiSyncState, setApiSyncState] = useState<ApiSyncState>(() => (
    apiRuntime.configurationError ? "error" : apiRuntime.client.remoteEnabled ? "loading" : "prototype"
  ));
  const [apiSyncMessage, setApiSyncMessage] = useState(apiRuntime.configurationError);
  const [catalogProducts, setCatalogProducts] = useState<Product[]>(() => apiRuntime.client.remoteEnabled ? [] : PRODUCTS);
  const [drawOddsByProductId, setDrawOddsByProductId] = useState<Record<string, ApiDrawOdds>>({});
  const [drawOddsStateByProductId, setDrawOddsStateByProductId] = useState<Record<string, DrawOddsLoadState>>({});
  const pendingDrawOddsRef = useRef<Record<string, Promise<ApiDrawOdds>>>({});
  const [catalogIps, setCatalogIps] = useState<IpRecord[]>(() => apiRuntime.client.remoteEnabled ? [] : IP_CATALOG);
  const [notices, setNotices] = useState<SettingsNotice[]>(() => apiRuntime.client.remoteEnabled ? [] : SETTINGS_NOTICES);
  const [duckroomShowcases, setDuckroomShowcases] = useState<UiDuckroomShowcase[]>(() => (
    apiRuntime.client.remoteEnabled ? [] : DUCKROOM_SHOWCASES
  ));
  const [inquiries, setInquiries] = useState<ApiInquiry[]>([]);
  const [wishlistItems, setWishlistItems] = useState<ApiWishlistItem[]>([]);
  const [accountOrders, setAccountOrders] = useState<ApiAccountOrder[]>([]);
  const [accountDrawEntitlements, setAccountDrawEntitlements] = useState<ApiAccountDrawEntitlement[]>([]);
  const [accountShippingRequests, setAccountShippingRequests] = useState<ApiAccountShippingRequest[]>([]);
  const [accountNotifications, setAccountNotifications] = useState<ApiAccountNotification[]>([]);
  const [notificationPreferences, setNotificationPreferences] = useState<ApiNotificationPreferences | null>(null);
  const [currentUserId, setCurrentUserId] = useState(apiRuntime.client.remoteEnabled ? "" : CURRENT_USER_ID);
  const [isAuthenticated, setIsAuthenticated] = useState(() => (
    apiRuntime.client.remoteEnabled ? false : apiRuntime.client.authenticated
  ));
  const [authGeneration, setAuthGeneration] = useState(0);
  const authGenerationRef = useRef(0);
  const advanceAuthGeneration = useCallback(() => {
    authGenerationRef.current += 1;
    setAuthGeneration(authGenerationRef.current);
  }, []);
  const [sessionValidationComplete, setSessionValidationComplete] = useState(() => (
    !apiRuntime.client.remoteEnabled || !apiRuntime.client.authenticated
  ));
  const [authIntent, setAuthIntent] = useState<AuthIntent | null>(null);
  const [exchangeComposerRequested, setExchangeComposerRequested] = useState(false);
  const [requestComposerRequested, setRequestComposerRequested] = useState(false);
  const [catalogRequestComposerRequested, setCatalogRequestComposerRequested] = useState(false);
  const [communityComposerRequested, setCommunityComposerRequested] = useState(false);
  const [communityReportRequested, setCommunityReportRequested] = useState<{ postId: string; targetType: "POST" | "SNAP" } | null>(null);
  const [activeRootTab, setActiveRootTab] = useState<RootTabId>("home");
  const [profile, setProfile] = useState<UserProfile>(() => apiRuntime.client.remoteEnabled
    ? {
      id: "",
      nickname: apiRuntime.client.authenticated ? "프로필 불러오는 중" : "로그인이 필요합니다",
      bio: "",
      favoriteIpId: "",
    }
    : {
      id: CURRENT_USER_ID,
      nickname: "다뽑러 01",
      bio: "좋아하는 작품과 굿즈를 천천히 모으고 있어요.",
      favoriteIpId: "one-piece",
    });
  const [accountProfileVersion, setAccountProfileVersion] = useState<number | null>(null);
  const [profileSaveNotice, setProfileSaveNotice] = useState("");
  const [memberSettings, setMemberSettings] = useState<MemberSettings>(() => (
    apiRuntime.client.remoteEnabled ? EMPTY_REMOTE_MEMBER_SETTINGS : DEFAULT_MEMBER_SETTINGS
  ));
  const [defaultAddressVersion, setDefaultAddressVersion] = useState<number | null>(null);
  const [remoteAddressState, setRemoteAddressState] = useState<RemoteAddressState>(() => (
    !apiRuntime.client.remoteEnabled
      ? "prototype"
      : apiRuntime.client.authenticated ? "loading" : "unavailable"
  ));
  const [memberSaveNotice, setMemberSaveNotice] = useState("");
  const [exchangePosts, setExchangePosts] = useState<ExchangePost[]>(() => (
    apiRuntime.client.remoteEnabled ? [] : DEFAULT_EXCHANGE_POSTS
  ));
  const [exchangeApplications, setExchangeApplications] = useState<Record<string, ExchangeApplication[]>>(() => (
    apiRuntime.client.remoteEnabled
      ? {}
      : Object.fromEntries(
        Object.entries(DEFAULT_EXCHANGE_APPLICATIONS).map(([postId, applications]) => [postId, [...applications]]),
      )
  ));
  const [productRequests, setProductRequests] = useState<ProductRequest[]>(() => (
    apiRuntime.client.remoteEnabled ? [] : DEFAULT_PRODUCT_REQUESTS
  ));
  const [likedProductRequestIds, setLikedProductRequestIds] = useState<Set<string>>(() => new Set());
  const [sessionCommerce, setSessionCommerce] = useState<SessionCommerceState>(() => {
    const initial = createInitialSessionCommerceState();
    if (!apiRuntime.client.remoteEnabled) return initial;
    return {
      ...initial,
      wishlistProductIds: [],
      orders: [],
      inventoryUnits: [],
      pointBalance: 0,
      pointLedger: [],
      shippingRequests: [],
      exchangeApplicationDecisions: {},
    };
  });
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [points, setPoints] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("간편카드");
  const [paying, setPaying] = useState(false);
  const [drawState, setDrawState] = useState<DrawState>("ready");
  const [drawRemaining, setDrawRemaining] = useState(1);
  const [resultOpen, setResultOpen] = useState(false);
  const [resultGrade, setResultGrade] = useState("B");
  const [drawControlProgress, setDrawControlProgress] = useState(0);
  const initialScreen = useMemo(() => createCatalogScreen(), []);

  const clearUserSession = useCallback(() => {
    apiRuntime.client.setToken(null);
    storeDevelopmentUserSessionToken(null);
    setIsAuthenticated(false);
    setSessionValidationComplete(true);
    advanceAuthGeneration();
    setAuthIntent(null);
    setExchangeComposerRequested(false);
    setRequestComposerRequested(false);
    setCatalogRequestComposerRequested(false);
    setCommunityComposerRequested(false);
    setCommunityReportRequested(null);
    setCurrentUserId("");
    setProfile({ id: "", nickname: "로그인이 필요합니다", bio: "", favoriteIpId: "" });
    setAccountProfileVersion(null);
    setProfileSaveNotice("");
    setMemberSaveNotice("");
    setMemberSettings(EMPTY_REMOTE_MEMBER_SETTINGS);
    setDefaultAddressVersion(null);
    setInquiries([]);
    setWishlistItems([]);
    setAccountOrders([]);
    setAccountDrawEntitlements([]);
    setAccountShippingRequests([]);
    setAccountNotifications([]);
    setNotificationPreferences(null);
    setExchangeApplications({});
    setLikedProductRequestIds(new Set());
    setDuckroomShowcases((current) => current.map((post) => ({ ...post, likedByViewer: false })));
    setRemoteAddressState("unavailable");
    setCouponDiscount(0);
    setPoints(0);
    setSessionCommerce((current) => ({
      ...current,
      wishlistProductIds: [],
      inventoryUnits: [],
      orders: [],
      pointBalance: 0,
      pointLedger: [],
      shippingRequests: [],
      exchangeApplicationDecisions: {},
    }));
    setPaying(false);
    setDrawState("ready");
    setDrawRemaining(1);
    setResultOpen(false);
    setResultGrade("B");
    setDrawControlProgress(0);
  }, [advanceAuthGeneration, apiRuntime.client]);

  useEffect(() => {
    document.title = "DABBOBA — 원하는 거 다 뽑아";
  }, []);

  useEffect(() => {
    if (!apiRuntime.client.remoteEnabled) return;
    return apiRuntime.client.onAuthInvalidated((error) => {
      clearUserSession();
      setApiSyncState("error");
      setApiSyncMessage(error.status === 401
        ? "사용자 세션이 만료됐습니다. 다시 로그인해 주세요."
        : apiErrorMessage(error));
    });
  }, [apiRuntime.client, clearUserSession]);

  useEffect(() => {
    if (!apiRuntime.client.remoteEnabled) {
      setSessionValidationComplete(true);
      return;
    }
    if (!apiRuntime.client.authenticated) {
      setIsAuthenticated(false);
      setSessionValidationComplete(true);
      return;
    }

    const controller = new AbortController();
    let refreshTimer: number | undefined;
    const sessionToken = apiRuntime.client.configuration.token;
    const sessionGeneration = authGenerationRef.current;
    const generationIsCurrent = () => (
      !controller.signal.aborted && authGenerationRef.current === sessionGeneration
    );
    const sessionIsCurrent = () => (
      generationIsCurrent() && apiRuntime.client.configuration.token === sessionToken
    );
    setSessionValidationComplete(false);
    void apiRuntime.client.getCurrentUserSession(controller.signal).then((sessionState) => {
      if (!sessionIsCurrent()) return;
      setIsAuthenticated(true);
      setCurrentUserId(sessionState.actor.userId);
      setProfile((current) => ({
        ...current,
        id: sessionState.actor.userId,
        nickname: sessionState.actor.nickname,
      }));
      setSessionValidationComplete(true);

      const expiresAt = Date.parse(sessionState.session.expiresAt);
      const refreshDelay = computeSessionRefreshDelay(sessionState.session.expiresAt);
      if (!Number.isFinite(expiresAt) || refreshDelay === null) return;
      if (expiresAt <= Date.now()) {
        if (sessionIsCurrent()) clearUserSession();
        return;
      }
      const scheduleRefresh = (delay: number) => {
        if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(refreshSession, delay);
      };
      const refreshSession = () => {
        if (!sessionIsCurrent()) return;
        if (Date.now() >= expiresAt) {
          clearUserSession();
          return;
        }
        void apiRuntime.client.refreshUserSession().then((issued) => {
          if (!sessionIsCurrent()) return;
          apiRuntime.client.setToken(issued.token);
          storeDevelopmentUserSessionToken(issued.token);
          setSessionValidationComplete(false);
          advanceAuthGeneration();
        }).catch((error) => {
          if (!generationIsCurrent()) return;
          if (
            (error instanceof DabbobaApiError && error.status === 401)
            || apiRuntime.client.configuration.token === null
          ) {
            clearUserSession();
            return;
          }
          if (apiRuntime.client.configuration.token !== sessionToken) return;
          const retryDelay = computeSessionRefreshRetryDelay(sessionState.session.expiresAt);
          if (retryDelay === null) {
            clearUserSession();
            return;
          }
          setApiSyncState("partial");
          setApiSyncMessage("사용자 세션 갱신에 일시적으로 실패해 만료 전에 다시 시도합니다.");
          scheduleRefresh(retryDelay);
        });
      };
      scheduleRefresh(refreshDelay);
    }).catch((error) => {
      if (!sessionIsCurrent() || (error instanceof Error && error.name === "AbortError")) return;
      setApiSyncState("error");
      setApiSyncMessage(error instanceof DabbobaApiError && error.status === 401
        ? "저장된 사용자 세션이 만료됐습니다. 다시 로그인해 주세요."
        : `사용자 세션을 확인하지 못했습니다: ${apiErrorMessage(error)}`);
      clearUserSession();
    });

    return () => {
      controller.abort();
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    };
  }, [advanceAuthGeneration, apiRuntime.client, authGeneration, clearUserSession]);

  useEffect(() => {
    if (!apiRuntime.client.remoteEnabled) return;
    if (apiRuntime.configurationError) return;
    if (!sessionValidationComplete) return;
    const controller = new AbortController();
    const snapshotToken = apiRuntime.client.configuration.token;
    const snapshotGeneration = authGenerationRef.current;
    const snapshotIsCurrent = () => (
      !controller.signal.aborted
      && authGenerationRef.current === snapshotGeneration
      && apiRuntime.client.configuration.token === snapshotToken
    );
    const commitSnapshot = (commit: () => void) => {
      if (!snapshotIsCurrent()) return false;
      commit();
      return true;
    };
    commitSnapshot(() => {
      setMemberSettings((current) => ({ ...current, defaultAddress: EMPTY_DEFAULT_ADDRESS }));
      setApiSyncState("loading");
      setApiSyncMessage("서버 데이터를 불러오는 중입니다.");
    });
    void apiRuntime.client.loadSnapshot(controller.signal).then(async (snapshot) => {
      if (!snapshotIsCurrent()) return;
      const nextProducts = snapshot.products?.map(mapApiProduct);
      if (nextProducts && !commitSnapshot(() => setCatalogProducts(nextProducts))) return;
      if (snapshot.ips) {
        const nextIps = snapshot.ips.map((item) => mapApiIp(
          item,
          nextProducts ?? [],
          snapshot.characters ?? [],
        ));
        if (!commitSnapshot(() => setCatalogIps(nextIps))) return;
      }
      if (snapshot.notices) {
        const nextNotices = snapshot.notices.map(mapApiNotice);
        if (!commitSnapshot(() => setNotices(nextNotices))) return;
      }
      if (snapshot.communityPosts) {
        const nextShowcases = snapshot.communityPosts
          .filter((item) => item.kind === "DUKROOM" || item.kind === "SNAP")
          .map((item) => mapApiCommunityPost(item, nextProducts ?? []));
        if (!commitSnapshot(() => setDuckroomShowcases(nextShowcases))) return;
        const mediaLookups = await Promise.allSettled(nextShowcases.map(async (showcase) => {
          const id = showcase.mediaIds?.[0];
          if (!id) return showcase;
          const media = await apiRuntime.client.getPublicMediaUrl(id, controller.signal);
          return { ...showcase, mediaUrl: media.url };
        }));
        if (!snapshotIsCurrent()) return;
        const showcasesWithMedia = mediaLookups.map((result, index) => (
          result.status === "fulfilled" ? result.value : nextShowcases[index]!
        ));
        if (!commitSnapshot(() => setDuckroomShowcases(showcasesWithMedia))) return;
      }
      if (snapshot.wantedRequests) {
        const nextRequests = snapshot.wantedRequests.map(mapApiWantedRequest);
        const nextLikedRequestIds = new Set(
          snapshot.wantedRequests.filter((item) => item.likedByViewer).map((item) => item.id),
        );
        if (!commitSnapshot(() => {
          setProductRequests(nextRequests);
          setLikedProductRequestIds(nextLikedRequestIds);
        })) return;
      }
      if (snapshot.exchangeListings) {
        const nextExchangePosts = snapshot.exchangeListings.map(mapApiExchangeListing);
        const nextExchangeApplications = Object.fromEntries(snapshot.exchangeListings.map((item) => [item.id, []]));
        if (!commitSnapshot(() => {
          setExchangePosts(nextExchangePosts);
          setExchangeApplications(nextExchangeApplications);
        })) return;
      }
      if (snapshot.inquiries && !commitSnapshot(() => setInquiries(snapshot.inquiries!))) return;
      if (snapshot.exchangeInventory) {
        const remoteInventory = snapshot.exchangeInventory.map(mapApiInventoryUnit);
        const remoteUserId = remoteInventory[0]?.ownerId ?? snapshot.inquiries?.[0]?.userId;
        if (!commitSnapshot(() => {
          setSessionCommerce((current) => ({ ...current, inventoryUnits: remoteInventory }));
          if (remoteUserId) {
            setCurrentUserId(remoteUserId);
            setProfile((current) => ({ ...current, id: remoteUserId }));
          }
        })) return;
      }
      if (snapshot.accountProfile) {
        const nextAccountProfile = mapApiAccountProfile(snapshot.accountProfile);
        if (!commitSnapshot(() => {
          setProfile(nextAccountProfile);
          setCurrentUserId(snapshot.accountProfile!.id);
          setAccountProfileVersion(snapshot.accountProfile!.version);
        })) return;
      } else if (snapshot.failures.accountProfile) {
        if (!commitSnapshot(() => {
          setProfile({ id: "", nickname: "프로필 불러오기 실패", bio: "잠시 후 다시 시도해 주세요.", favoriteIpId: "" });
          setAccountProfileVersion(null);
        })) return;
      }
      if ("defaultAddress" in snapshot) {
        if (snapshot.defaultAddress) {
          const address = snapshot.defaultAddress;
          if (!commitSnapshot(() => {
            setMemberSettings((current) => ({
              ...current,
              defaultAddress: mapApiDefaultAddress(address),
            }));
            setDefaultAddressVersion(address.version);
            setRemoteAddressState("ready");
          })) return;
        } else {
          if (!commitSnapshot(() => {
            setMemberSettings((current) => ({ ...current, defaultAddress: EMPTY_DEFAULT_ADDRESS }));
            setDefaultAddressVersion(null);
            setRemoteAddressState("missing");
          })) return;
        }
      } else if (snapshot.failures.defaultAddress) {
        if (!commitSnapshot(() => setRemoteAddressState("error"))) return;
      }
      if (snapshot.wishlist) {
        const nextWishlist = snapshot.wishlist;
        if (!commitSnapshot(() => {
          setWishlistItems(nextWishlist);
          setSessionCommerce((current) => ({
            ...current,
            wishlistProductIds: nextWishlist.map((item) => item.product.id),
          }));
        })) return;
      }
      if (snapshot.accountOrders && !commitSnapshot(() => setAccountOrders(snapshot.accountOrders!))) return;
      if (snapshot.accountDrawEntitlements) {
        const availableEntitlements = snapshot.accountDrawEntitlements.filter((item) => item.status === "AVAILABLE");
        if (!commitSnapshot(() => setAccountDrawEntitlements(availableEntitlements))) return;
      }
      if (snapshot.accountPoints) {
        const remoteAccountUserId = snapshot.accountProfile?.id
          ?? snapshot.exchangeInventory?.[0]?.ownerId
          ?? snapshot.inquiries?.[0]?.userId
          ?? CURRENT_USER_ID;
        const nextPointBalance = snapshot.accountPoints.balance;
        const nextPointLedger = snapshot.accountPoints.items.map((entry) => ({
          id: entry.id,
          userId: remoteAccountUserId,
          label: entry.reason,
          detail: `${entry.entryType} · ${entry.referenceType}`,
          occurredAt: serverDateLabel(entry.createdAt),
          amount: entry.amount,
          referenceId: entry.referenceId,
        }));
        if (!commitSnapshot(() => setSessionCommerce((current) => ({
          ...current,
          pointBalance: nextPointBalance,
          pointLedger: nextPointLedger,
        })))) return;
      }
      if (
        snapshot.accountNotifications
        && !commitSnapshot(() => setAccountNotifications(snapshot.accountNotifications!))
      ) return;
      if (snapshot.notificationPreferences) {
        const nextPreferences = snapshot.notificationPreferences;
        if (!commitSnapshot(() => {
          setNotificationPreferences(nextPreferences);
          setMemberSettings((current) => ({
            ...current,
            privacy: notificationPreferencesToPrivacy(nextPreferences),
          }));
        })) return;
      }
      if (snapshot.accountShippingRequests) {
        const nextShippingRequests = snapshot.accountShippingRequests;
        if (!commitSnapshot(() => {
          setAccountShippingRequests(nextShippingRequests);
          setSessionCommerce((current) => ({
            ...current,
            inventoryUnits: applyRemoteShippingState(current.inventoryUnits, nextShippingRequests),
          }));
        })) return;
      }
      const failures = Object.values(snapshot.failures);
      commitSnapshot(() => {
        setApiSyncState(failures.length ? "partial" : "ready");
        setApiSyncMessage(failures.length
          ? `일부 서버 데이터를 불러오지 못했습니다: ${failures.join(" · ")}`
          : "서버 데이터와 동기화됐습니다.");
      });
    }).catch((error) => {
      if (!snapshotIsCurrent() || (error instanceof Error && error.name === "AbortError")) return;
      commitSnapshot(() => {
        setApiSyncState("error");
        setApiSyncMessage(apiErrorMessage(error));
      });
    });
    return () => controller.abort();
  }, [apiRuntime.client, apiRuntime.configurationError, authGeneration, sessionValidationComplete]);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const leaveTimer = window.setTimeout(() => setSplashState("leaving"), reducedMotion ? 260 : 1_050);
    const hideTimer = window.setTimeout(() => setSplashState("hidden"), reducedMotion ? 320 : 1_380);

    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(hideTimer);
    };
  }, []);

  const createDevelopmentSession = useCallback(async (
    email: string,
  ): Promise<UserMutationResult<ApiDevelopmentSession>> => {
    if (!apiRuntime.client.remoteEnabled) {
      return { ok: false, source: "prototype", message: "API 주소를 설정한 개발 환경에서만 서버 테스트 계정을 만들 수 있습니다." };
    }
    if (import.meta.env?.DEV !== true) {
      return { ok: false, source: "remote", message: "운영 로그인 제공자 연결이 필요합니다. 개발 세션은 운영 빌드에서 사용할 수 없습니다." };
    }
    try {
      const issued = await apiRuntime.client.createDevelopmentSession(email.trim());
      apiRuntime.client.setToken(issued.token);
      storeDevelopmentUserSessionToken(issued.token);
      setSessionValidationComplete(false);
      advanceAuthGeneration();
      setApiSyncMessage("개발 사용자 세션을 확인하고 계정 데이터를 불러오는 중입니다.");
      return { ok: true, source: "remote", message: "개발 사용자 세션으로 로그인했습니다.", data: issued };
    } catch (error) {
      apiRuntime.client.setToken(null);
      storeDevelopmentUserSessionToken(null);
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [advanceAuthGeneration, apiRuntime.client]);

  const logoutUserSession = useCallback(async (): Promise<UserMutationResult> => {
    if (!apiRuntime.client.remoteEnabled) {
      clearUserSession();
      return { ok: true, source: "prototype", message: "프로토타입 로그인 상태를 해제했습니다." };
    }
    let result: UserMutationResult;
    try {
      await apiRuntime.client.logoutUserSession();
      result = { ok: true, source: "remote", message: "서버 세션을 종료하고 로그아웃했습니다." };
    } catch (error) {
      result = {
        ok: false,
        source: "remote",
        message: `서버 로그아웃 확인에 실패했지만 이 기기의 사용자 정보는 삭제했습니다: ${apiErrorMessage(error)}`,
      };
    } finally {
      clearUserSession();
    }
    return result;
  }, [apiRuntime.client, clearUserSession]);

  const requestAccountDeletion = useCallback(async (
    idempotencyKey?: string,
  ): Promise<UserMutationResult<ApiAccountDeletionRequest>> => {
    if (!apiRuntime.client.remoteEnabled) {
      clearUserSession();
      return { ok: true, source: "prototype", message: "프로토타입 탈퇴 요청 화면을 완료했습니다." };
    }
    try {
      const deletionRequest = await apiRuntime.client.requestAccountDeletion(idempotencyKey);
      clearUserSession();
      return {
        ok: true,
        source: "remote",
        message: deletionRequest.status === "BLOCKED"
          ? "탈퇴 요청은 접수됐지만 정리해야 할 거래·보관 항목이 있습니다. 운영 검토가 필요합니다."
          : "탈퇴 요청이 운영 검토 대기 상태로 접수됐습니다.",
        data: deletionRequest,
      };
    } catch (error) {
      if (error instanceof DabbobaApiError && error.status === 401) clearUserSession();
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [apiRuntime.client, clearUserSession]);

  const prepareCheckout = useCallback(() => {
    setCouponDiscount(0);
    setPoints(0);
    setPaymentMethod("간편카드");
    setPaying(false);
  }, []);

  const prepareDraw = useCallback((count: number) => {
    setDrawRemaining(count);
    setDrawState("ready");
    setResultOpen(false);
    setResultGrade("B");
    setDrawControlProgress(0);
  }, []);

  const updateProfile = useCallback(async (
    input: Omit<UserProfile, "id">,
    idempotencyKey?: string,
  ): Promise<UserMutationResult<ApiAccountProfile>> => {
    if (!apiRuntime.client.remoteEnabled) {
      setProfile((current) => ({ ...current, ...input }));
      return { ok: true, source: "prototype", message: "프로필을 프로토타입에 저장했어요." };
    }
    if (accountProfileVersion === null) {
      return { ok: false, source: "remote", message: "서버 프로필을 먼저 불러온 뒤 다시 시도해 주세요." };
    }
    try {
      const updated = await apiRuntime.client.updateAccountProfile({
        nickname: input.nickname,
        bio: input.bio || null,
        favoriteIpId: input.favoriteIpId || null,
        expectedVersion: accountProfileVersion,
      }, idempotencyKey);
      setProfile(mapApiAccountProfile(updated));
      setCurrentUserId(updated.id);
      setAccountProfileVersion(updated.version);
      return { ok: true, source: "remote", message: "프로필이 서버에 저장됐습니다.", data: updated };
    } catch (error) {
      if (error instanceof DabbobaApiError && error.status === 409) {
        try {
          const latest = await apiRuntime.client.getAccountProfile();
          setProfile(mapApiAccountProfile(latest));
          setAccountProfileVersion(latest.version);
          return {
            ok: false,
            source: "remote",
            message: "다른 변경과 충돌해 최신 프로필을 다시 불러왔습니다. 내용을 확인해 주세요.",
            data: latest,
          };
        } catch {
          // Keep the original conflict as the actionable result.
        }
        return { ok: false, source: "remote", message: "다른 변경과 충돌해 최신 프로필을 다시 불러왔습니다. 내용을 확인해 주세요." };
      }
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [accountProfileVersion, apiRuntime.client]);

  const saveDefaultAddress = useCallback(async (
    address: MemberSettings["defaultAddress"],
    idempotencyKey?: string,
  ): Promise<UserMutationResult<ApiDefaultShippingAddress>> => {
    const normalizedAddress = {
      ...address,
      phone: address.phone.replace(/\D/g, ""),
    };
    if (!apiRuntime.client.remoteEnabled) {
      setMemberSettings((current) => ({ ...current, defaultAddress: normalizedAddress }));
      return { ok: true, source: "prototype", message: "기본 배송지를 프로토타입에 저장했어요." };
    }
    if (remoteAddressState !== "ready" && remoteAddressState !== "missing") {
      return { ok: false, source: "remote", message: "서버 배송지 상태를 확인한 뒤 다시 시도해 주세요." };
    }
    try {
      const updated = await apiRuntime.client.upsertDefaultShippingAddress({
        recipient: normalizedAddress.recipient,
        phone: normalizedAddress.phone,
        postalCode: normalizedAddress.postalCode,
        addressLine1: normalizedAddress.addressLine1,
        addressLine2: normalizedAddress.addressLine2 || null,
        deliveryNote: normalizedAddress.deliveryNote || null,
        ...(remoteAddressState === "ready" && defaultAddressVersion !== null
          ? { expectedVersion: defaultAddressVersion }
          : {}),
      }, idempotencyKey);
      setMemberSettings((current) => ({ ...current, defaultAddress: mapApiDefaultAddress(updated) }));
      setDefaultAddressVersion(updated.version);
      setRemoteAddressState("ready");
      return { ok: true, source: "remote", message: "기본 배송지가 서버에 저장됐습니다.", data: updated };
    } catch (error) {
      if (error instanceof DabbobaApiError && error.status === 409) {
        try {
          const latest = await apiRuntime.client.getDefaultShippingAddress();
          if (latest) {
            setMemberSettings((current) => ({ ...current, defaultAddress: mapApiDefaultAddress(latest) }));
            setDefaultAddressVersion(latest.version);
            setRemoteAddressState("ready");
            return {
              ok: false,
              source: "remote",
              message: "다른 변경과 충돌해 최신 배송지를 다시 불러왔습니다. 내용을 확인해 주세요.",
              data: latest,
            };
          } else {
            setDefaultAddressVersion(null);
            setRemoteAddressState("missing");
          }
        } catch {
          setRemoteAddressState("error");
        }
        return { ok: false, source: "remote", message: "다른 변경과 충돌해 최신 배송지를 다시 확인했습니다. 내용을 확인해 주세요." };
      }
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [apiRuntime.client, defaultAddressVersion, remoteAddressState]);

  const addExchangePost = useCallback(async (
    post: Omit<ExchangePost, "id" | "authorId" | "author" | "time" | "applications">,
    idempotencyKey?: string,
  ): Promise<UserMutationResult> => {
    if (apiRuntime.client.remoteEnabled) {
      try {
        const created = await apiRuntime.client.createExchangeListing({
          title: post.title,
          details: post.body,
          offeredInventoryUnitId: post.offeredInventoryUnitId,
        }, idempotencyKey);
        setExchangePosts((current) => [mapApiExchangeListing(created), ...current.filter((item) => item.id !== created.id)]);
        setSessionCommerce((current) => setSessionInventoryExchangeStatus(current, post.offeredInventoryUnitId, "listed"));
        return { ok: true, source: "remote", message: "교환 글이 서버에 등록됐습니다." };
      } catch (error) {
        return { ok: false, source: "remote", message: apiErrorMessage(error) };
      }
    }
    setExchangePosts((current) => [
      {
        id: createSessionId("exchange-post"),
        authorId: currentUserId,
        author: profile.nickname,
        time: "방금 전",
        applications: 0,
        ...post,
      },
      ...current,
    ]);
    setSessionCommerce((current) => setSessionInventoryExchangeStatus(
      current,
      post.offeredInventoryUnitId,
      "listed",
    ));
    return { ok: true, source: "prototype", message: "교환 글을 프로토타입에 등록했어요." };
  }, [apiRuntime.client, currentUserId, profile.nickname]);

  const addExchangeApplication = useCallback(async (
    postId: string,
    application: Pick<
      ExchangeApplication,
      "offeredInventoryUnitId" | "offeredCatalogItemId" | "ipId" | "categoryId" | "offeredItem" | "offeredItemImage" | "appReferenceValue" | "sourceType"
    >,
    idempotencyKey?: string,
  ): Promise<UserMutationResult<ApiExchangeOffer>> => {
    if (apiRuntime.client.remoteEnabled) {
      try {
        const created = await apiRuntime.client.createExchangeOffer(postId, {
          offeredInventoryUnitId: application.offeredInventoryUnitId,
        }, idempotencyKey);
        const nextApplication = mapApiExchangeOffer(created, profile.nickname);
        setExchangeApplications((current) => ({
          ...current,
          [postId]: [...(current[postId] ?? []).filter((item) => item.id !== created.id), nextApplication],
        }));
        setSessionCommerce((current) => setSessionInventoryExchangeStatus(current, application.offeredInventoryUnitId, "offered"));
        return { ok: true, source: "remote", message: "교환 제안이 서버에 접수됐습니다.", data: created };
      } catch (error) {
        return { ok: false, source: "remote", message: apiErrorMessage(error) };
      }
    }
    const nextApplication: ExchangeApplication = {
      id: createSessionId("exchange-application"),
      authorId: currentUserId,
      author: profile.nickname,
      time: "방금 전",
      ...application,
    };
    setExchangeApplications((current) => ({
      ...current,
      [postId]: [...(current[postId] ?? []), nextApplication],
    }));
    setSessionCommerce((current) => setSessionInventoryExchangeStatus(
      current,
      application.offeredInventoryUnitId,
      "offered",
    ));
    return { ok: true, source: "prototype", message: "교환 제안을 프로토타입에 등록했어요." };
  }, [apiRuntime.client, currentUserId, profile.nickname]);

  const addProductRequest = useCallback(async (
    request: Omit<ProductRequest, "id" | "authorId" | "author" | "time" | "likes">,
    idempotencyKey?: string,
  ): Promise<UserMutationResult<ApiWantedRequest>> => {
    if (apiRuntime.client.remoteEnabled) {
      try {
        const created = await apiRuntime.client.createWantedRequest({
          category: request.categoryId,
          ipId: request.ipId,
          desiredItem: request.desiredItem,
          details: request.details,
        }, idempotencyKey);
        setProductRequests((current) => [
          mapApiWantedRequest(created),
          ...current.filter((item) => item.id !== created.id),
        ]);
        setLikedProductRequestIds((current) => {
          const next = new Set(current);
          if (created.likedByViewer) next.add(created.id);
          else next.delete(created.id);
          return next;
        });
        return { ok: true, source: "remote", message: "상품 신청이 서버 신청방에 등록됐습니다.", data: created };
      } catch (error) {
        return { ok: false, source: "remote", message: apiErrorMessage(error) };
      }
    }
    setProductRequests((current) => [
      {
        id: createSessionId("request"),
        authorId: currentUserId,
        author: profile.nickname,
        time: "방금 전",
        likes: 0,
        ...request,
      },
      ...current,
    ]);
    return { ok: true, source: "prototype", message: "상품 신청을 프로토타입에 등록했어요." };
  }, [apiRuntime.client, currentUserId, profile.nickname]);

  const submitCatalogRequest = useCallback(async (
    input: { kind: "PRODUCT" | "IP"; name: string; referenceUrl?: string | null; description?: string | null },
    idempotencyKey?: string,
  ): Promise<UserMutationResult<ApiCatalogRequest>> => {
    if (!apiRuntime.client.remoteEnabled) {
      return {
        ok: true,
        source: "prototype",
        message: "개발 프리뷰에서 입력 폼만 확인했습니다. 서버나 관리자에게 전송되지 않았습니다.",
      };
    }
    try {
      const created = await apiRuntime.client.createCatalogRequest(input, idempotencyKey);
      return {
        ok: true,
        source: "remote",
        message: `${created.kind === "IP" ? "작품 IP" : "상품"} 추가 요청이 관리자 검토 대기 상태로 접수됐습니다.`,
        data: created,
      };
    } catch (error) {
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [apiRuntime.client]);

  const toggleProductRequestLike = useCallback(async (
    requestId: string,
    idempotencyKey?: string,
  ): Promise<UserMutationResult<ApiWantedRequestLikeResult>> => {
    if (apiRuntime.client.remoteEnabled) {
      const liked = likedProductRequestIds.has(requestId);
      try {
        const updated = await apiRuntime.client.setWantedRequestLike(requestId, !liked, idempotencyKey);
        setProductRequests((current) => current.map((request) => (
          request.id === updated.requestId ? { ...request, likes: updated.likeCount } : request
        )));
        setLikedProductRequestIds((current) => {
          const next = new Set(current);
          if (updated.liked) next.add(updated.requestId);
          else next.delete(updated.requestId);
          return next;
        });
        return {
          ok: true,
          source: "remote",
          message: updated.liked ? "같이 원해요를 서버에 반영했습니다." : "같이 원해요를 서버에서 취소했습니다.",
          data: updated,
        };
      } catch (error) {
        return { ok: false, source: "remote", message: apiErrorMessage(error) };
      }
    }
    const liked = likedProductRequestIds.has(requestId);
    setProductRequests((current) => current.map((request) => (
      request.id === requestId ? { ...request, likes: Math.max(0, request.likes + (liked ? -1 : 1)) } : request
    )));
    setLikedProductRequestIds((current) => {
      const next = new Set(current);
      if (next.has(requestId)) next.delete(requestId);
      else next.add(requestId);
      return next;
    });
    return { ok: true, source: "prototype", message: "프로토타입 좋아요를 반영했어요." };
  }, [apiRuntime.client, likedProductRequestIds]);

  const deleteProductRequest = useCallback(async (
    requestId: string,
    expectedVersion: number,
    idempotencyKey?: string,
  ): Promise<UserMutationResult<ApiWantedRequestDeleteResult>> => {
    if (!apiRuntime.client.remoteEnabled) {
      setProductRequests((current) => current.filter((request) => request.id !== requestId));
      return { ok: true, source: "prototype", message: "프로토타입 신청 글을 삭제했습니다." };
    }
    try {
      const deleted = await apiRuntime.client.deleteWantedRequest(requestId, expectedVersion, idempotencyKey);
      setProductRequests((current) => current.filter((request) => request.id !== deleted.requestId));
      setLikedProductRequestIds((current) => {
        const next = new Set(current);
        next.delete(deleted.requestId);
        return next;
      });
      return { ok: true, source: "remote", message: "신청 글을 서버에서 삭제했습니다.", data: deleted };
    } catch (error) {
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [apiRuntime.client]);

  const toggleWishlistProduct = useCallback(async (
    productId: string,
    idempotencyKey?: string,
  ): Promise<UserMutationResult<ApiWishlistItem>> => {
    if (!apiRuntime.client.remoteEnabled) {
      setSessionCommerce((current) => toggleSessionWishlist(current, productId));
      return { ok: true, source: "prototype", message: "프로토타입 찜 목록에 반영했어요." };
    }
    const liked = sessionCommerce.wishlistProductIds.includes(productId);
    try {
      if (liked) {
        await apiRuntime.client.removeWishlistItem(productId, idempotencyKey);
        setWishlistItems((current) => current.filter((item) => item.product.id !== productId));
        setSessionCommerce((current) => ({
          ...current,
          wishlistProductIds: current.wishlistProductIds.filter((id) => id !== productId),
        }));
        return { ok: true, source: "remote", message: "서버 찜 목록에서 삭제했습니다." };
      }
      const created = await apiRuntime.client.addWishlistItem(productId, idempotencyKey);
      setWishlistItems((current) => [created, ...current.filter((item) => item.product.id !== productId)]);
      setSessionCommerce((current) => ({
        ...current,
        wishlistProductIds: [...new Set([productId, ...current.wishlistProductIds])],
      }));
      return { ok: true, source: "remote", message: "서버 찜 목록에 추가했습니다.", data: created };
    } catch (error) {
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [apiRuntime.client, sessionCommerce.wishlistProductIds]);

  const recordOrder = useCallback((order: SessionOrder) => {
    setSessionCommerce((current) => recordSessionOrderOnce(current, order));
  }, []);

  const updateOrderStatus = useCallback((orderId: string, status: SessionOrder["status"]) => {
    setSessionCommerce((current) => updateSessionOrderStatus(current, orderId, status));
  }, []);

  const recordInventoryUnit = useCallback((inventoryUnit: SessionInventoryUnit) => {
    setSessionCommerce((current) => recordSessionInventoryUnitOnce(current, inventoryUnit));
  }, []);

  const loadShippingRequests = useCallback(async (
    signal?: AbortSignal,
  ): Promise<UserMutationResult<ApiAccountShippingRequest[]>> => {
    if (!apiRuntime.client.remoteEnabled) {
      return { ok: false, source: "prototype", message: "프로토타입 배송 내역은 현재 세션 상태로 표시합니다." };
    }
    try {
      const shippingRequests = await apiRuntime.client.listAccountShippingRequests(signal);
      setAccountShippingRequests(shippingRequests);
      setSessionCommerce((current) => ({
        ...current,
        inventoryUnits: applyRemoteShippingState(current.inventoryUnits, shippingRequests),
      }));
      return { ok: true, source: "remote", message: "배송 신청 내역을 서버에서 불러왔습니다.", data: shippingRequests };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [apiRuntime.client]);

  const loadShippingRequestDetail = useCallback(async (
    shippingRequestId: string,
    signal?: AbortSignal,
  ): Promise<UserMutationResult<ApiAccountShippingRequest>> => {
    if (!apiRuntime.client.remoteEnabled) {
      return { ok: false, source: "prototype", message: "프로토타입 배송 내역은 서버 상세가 없습니다." };
    }
    try {
      const detail = await apiRuntime.client.getAccountShippingRequest(shippingRequestId, signal);
      const nextShippingRequests = mergeAccountShippingRequest(accountShippingRequests, detail);
      setAccountShippingRequests(nextShippingRequests);
      setSessionCommerce((current) => ({
        ...current,
        inventoryUnits: applyRemoteShippingState(current.inventoryUnits, nextShippingRequests),
      }));
      return { ok: true, source: "remote", message: "배송 신청 상세를 서버에서 확인했습니다.", data: detail };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [accountShippingRequests, apiRuntime.client]);

  const requestShipping = useCallback(async (
    request: SessionShippingRequest,
    idempotencyKey?: string,
  ): Promise<UserMutationResult<ApiShippingRequest>> => {
    if (!apiRuntime.client.remoteEnabled) {
      setSessionCommerce((current) => requestSessionShipping(current, request));
      return { ok: true, source: "prototype", message: "배송 신청을 프로토타입 세션에 저장했어요." };
    }
    if (remoteAddressState !== "ready") {
      return { ok: false, source: "remote", message: "서버에 기본 배송지를 먼저 등록해 주세요." };
    }
    try {
      const created = await apiRuntime.client.createAccountShippingRequest(request.inventoryUnitIds, idempotencyKey);
      setSessionCommerce((current) => requestSessionShipping(current, {
        id: created.id,
        userId: request.userId,
        inventoryUnitIds: created.inventoryUnitIds,
        requestedAt: serverDateLabel(created.requestedAt),
        status: "requested",
      }));
      try {
        const shippingRequests = await apiRuntime.client.listAccountShippingRequests();
        setAccountShippingRequests(shippingRequests);
        setSessionCommerce((current) => ({
          ...current,
          inventoryUnits: applyRemoteShippingState(current.inventoryUnits, shippingRequests),
        }));
        return { ok: true, source: "remote", message: "배송 신청이 서버에 접수됐습니다.", data: created };
      } catch {
        return {
          ok: true,
          source: "remote",
          message: "배송 신청은 접수됐지만 최신 내역을 불러오지 못했습니다. 내역 새로고침으로 다시 확인해 주세요.",
          data: created,
        };
      }
    } catch (error) {
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [apiRuntime.client, remoteAddressState]);

  const markNotificationRead = useCallback(async (
    notificationId: string,
    idempotencyKey?: string,
  ): Promise<UserMutationResult<ApiAccountNotification>> => {
    if (!apiRuntime.client.remoteEnabled) {
      return { ok: false, source: "prototype", message: "프로토타입 알림은 서버 읽음 상태를 만들지 않습니다." };
    }
    try {
      const updated = await apiRuntime.client.markAccountNotificationRead(notificationId, idempotencyKey);
      setAccountNotifications((current) => current.map((item) => item.id === updated.id ? updated : item));
      return { ok: true, source: "remote", message: "알림을 읽음 처리했습니다.", data: updated };
    } catch (error) {
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [apiRuntime.client]);

  const saveNotificationPreferences = useCallback(async (
    privacy: MemberSettings["privacy"],
    idempotencyKey?: string,
  ): Promise<UserMutationResult<ApiNotificationPreferences>> => {
    if (!apiRuntime.client.remoteEnabled) {
      setMemberSettings((current) => ({
        ...current,
        privacy: { ...privacy, orderUpdates: true },
      }));
      return { ok: true, source: "prototype", message: "알림 수신 설정을 저장했어요." };
    }
    if (!apiRuntime.client.authenticated || !notificationPreferences) {
      return { ok: false, source: "remote", message: "로그인 후 서버 알림 설정을 불러와야 저장할 수 있습니다." };
    }
    const commitPreferences = (next: ApiNotificationPreferences) => {
      setNotificationPreferences(next);
      setMemberSettings((current) => ({
        ...current,
        privacy: notificationPreferencesToPrivacy(next),
      }));
    };
    try {
      const updated = await apiRuntime.client.updateNotificationPreferences({
        exchangeUpdates: privacy.exchangeUpdates,
        requestUpdates: privacy.requestUpdates,
        restockUpdates: privacy.restockUpdates,
        marketingSms: privacy.marketingSms,
        marketingEmail: privacy.marketingEmail,
        marketingPush: privacy.marketingPush,
        personalizedRecommendations: privacy.personalizedRecommendations,
        expectedVersion: notificationPreferences.version,
      }, idempotencyKey);
      commitPreferences(updated);
      return { ok: true, source: "remote", message: "알림 수신 설정을 서버에 저장했습니다.", data: updated };
    } catch (error) {
      if (error instanceof DabbobaApiError && error.status === 409) {
        try {
          const latest = await apiRuntime.client.getNotificationPreferences();
          commitPreferences(latest);
          return {
            ok: false,
            source: "remote",
            code: "NOTIFICATION_PREFERENCES_CONFLICT",
            message: "다른 기기에서 먼저 변경되어 최신 알림 설정을 다시 불러왔습니다. 확인 후 다시 저장해 주세요.",
            data: latest,
          };
        } catch {
          return {
            ok: false,
            source: "remote",
            code: "NOTIFICATION_PREFERENCES_CONFLICT",
            message: "알림 설정 변경이 충돌했고 최신값도 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
          };
        }
      }
      return {
        ok: false,
        source: "remote",
        message: apiErrorMessage(error),
        ...(error instanceof DabbobaApiError ? { code: error.code } : {}),
      };
    }
  }, [apiRuntime.client, notificationPreferences]);

  const setInventoryExchangeStatus = useCallback((inventoryUnitId: string, status: SessionExchangeStatus) => {
    setSessionCommerce((current) => setSessionInventoryExchangeStatus(current, inventoryUnitId, status));
  }, []);

  const loadExchangeListingDetail = useCallback(async (
    postId: string,
    signal?: AbortSignal,
  ): Promise<UserMutationResult<ApiExchangeListingDetail>> => {
    if (!apiRuntime.client.remoteEnabled) {
      return { ok: false, source: "prototype", message: "프로토타입 교환 상세는 현재 세션 데이터로 표시합니다." };
    }
    try {
      const detail = await apiRuntime.client.getExchangeListingDetail(postId, signal);
      setExchangePosts((current) => mergeApiExchangeListing(current, detail));
      if (detail.offers) {
        setExchangeApplications((current) => ({
          ...current,
          [postId]: detail.offers!.map((offer) => mapApiExchangeOffer(
            offer,
            offer.proposerId === currentUserId ? profile.nickname : "교환 제안자",
          )),
        }));
      }
      if (currentUserId) {
        const relatedInventory = [
          detail.offeredInventory,
          ...(detail.offers ?? []).map((offer) => offer.offeredInventory),
        ];
        const relatedIds = new Set(relatedInventory.map((inventory) => inventory.id));
        const actorInventory = relatedInventory
          .filter((inventory) => inventory.ownerId === currentUserId)
          .map(mapApiInventoryUnit);
        setSessionCommerce((current) => ({
          ...current,
          inventoryUnits: [
            ...actorInventory,
            ...current.inventoryUnits.filter((inventory) => !relatedIds.has(inventory.id)),
          ],
        }));
      }
      return { ok: true, source: "remote", message: "교환 상세를 서버에서 불러왔습니다.", data: detail };
    } catch (error) {
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [apiRuntime.client, currentUserId, profile.nickname]);

  const decideExchangeApplication = useCallback(async (
    postId: string,
    applicationId: string,
    decision: ExchangeApplicationDecision,
    idempotencyKey?: string,
  ): Promise<UserMutationResult<ApiExchangeOffer>> => {
    const post = exchangePosts.find((candidate) => candidate.id === postId);
    if (!post) return { ok: false, source: apiRuntime.client.remoteEnabled ? "remote" : "prototype", message: "교환 글을 찾을 수 없습니다." };
    const applications = exchangeApplications[postId] ?? [];
    let remoteOffer: ApiExchangeOffer | undefined;
    if (apiRuntime.client.remoteEnabled) {
      try {
        remoteOffer = await apiRuntime.client.decideExchangeOffer(
          postId,
          applicationId,
          decision === "accepted" ? "ACCEPTED" : "REJECTED",
          idempotencyKey,
        );
        setExchangeApplications((current) => ({
          ...current,
          [postId]: (current[postId] ?? []).map((application) => (
            application.id === remoteOffer!.id
              ? { ...application, status: remoteOffer!.status }
              : decision === "accepted" && application.status === "PENDING"
                ? { ...application, status: "REJECTED" }
                : application
          )),
        }));
      } catch (error) {
        return { ok: false, source: "remote", message: apiErrorMessage(error) };
      }
    }
    setSessionCommerce((current) => {
      const decided = decideSessionExchangeApplication(current, {
        actorId: currentUserId,
        postId,
        postAuthorId: post.authorId,
        applicationId,
        applicationIds: applications.map((application) => application.id),
        decision,
      });
      return decided !== current && decision === "accepted"
        ? setSessionInventoryExchangeStatus(decided, post.offeredInventoryUnitId, "matched")
        : decided;
    });
    return {
      ok: true,
      source: apiRuntime.client.remoteEnabled ? "remote" : "prototype",
      message: decision === "accepted" ? "교환 제안을 수락했습니다." : "교환 제안을 거절했습니다.",
      data: remoteOffer,
    };
  }, [apiRuntime.client, currentUserId, exchangeApplications, exchangePosts]);

  const cancelExchangeListing = useCallback(async (
    postId: string,
    idempotencyKey?: string,
  ): Promise<UserMutationResult<ApiExchangeListing>> => {
    if (!apiRuntime.client.remoteEnabled) {
      return { ok: false, source: "prototype", message: "프로토타입 교환 글은 서버 취소 상태를 만들지 않습니다." };
    }
    try {
      const listing = await apiRuntime.client.cancelExchangeListing(postId, idempotencyKey);
      setExchangePosts((current) => mergeApiExchangeListing(current, listing));
      setSessionCommerce((current) => setSessionInventoryExchangeStatus(
        current,
        listing.offeredInventory.id,
        "available",
      ));
      return { ok: true, source: "remote", message: "교환 글을 취소하고 상품 예약을 해제했습니다.", data: listing };
    } catch (error) {
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [apiRuntime.client]);

  const withdrawExchangeApplication = useCallback(async (
    postId: string,
    applicationId: string,
    idempotencyKey?: string,
  ): Promise<UserMutationResult<ApiExchangeOffer>> => {
    if (!apiRuntime.client.remoteEnabled) {
      return { ok: false, source: "prototype", message: "프로토타입 교환 제안은 서버 철회 상태를 만들지 않습니다." };
    }
    try {
      const offer = await apiRuntime.client.withdrawExchangeOffer(postId, applicationId, idempotencyKey);
      setExchangeApplications((current) => ({
        ...current,
        [postId]: (current[postId] ?? []).map((application) => (
          application.id === offer.id ? { ...application, status: offer.status } : application
        )),
      }));
      setSessionCommerce((current) => setSessionInventoryExchangeStatus(
        current,
        offer.offeredInventory.id,
        "available",
      ));
      return { ok: true, source: "remote", message: "교환 제안을 철회하고 상품 예약을 해제했습니다.", data: offer };
    } catch (error) {
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [apiRuntime.client]);

  const confirmExchangeCompletion = useCallback(async (
    postId: string,
    idempotencyKey?: string,
  ): Promise<UserMutationResult<ApiExchangeListing>> => {
    if (!apiRuntime.client.remoteEnabled) {
      return { ok: false, source: "prototype", message: "프로토타입 교환은 서버 완료 확인 상태를 만들지 않습니다." };
    }
    try {
      const listing = await apiRuntime.client.confirmExchangeCompletion(postId, idempotencyKey);
      setExchangePosts((current) => mergeApiExchangeListing(current, listing));
      return {
        ok: true,
        source: "remote",
        message: listing.status === "COMPLETED"
          ? "양쪽 확인이 완료되어 상품 소유권 교환이 확정됐습니다."
          : "내 교환 완료 확인을 서버에 저장했습니다.",
        data: listing,
      };
    } catch (error) {
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [apiRuntime.client]);

  const submitCommunityPost = useCallback(async (
    input: { kind: "DUKROOM" | "SNAP"; ipId: string | null; title: string; content: string; mediaIds?: string[] },
    idempotencyKey?: string,
  ): Promise<UserMutationResult<ApiCommunityPost>> => {
    if (!apiRuntime.client.remoteEnabled) {
      return {
        ok: false,
        source: "prototype",
        message: "개발 프리뷰에서는 덕룸 글을 서버에 등록하지 않습니다.",
      };
    }
    try {
      const post = await apiRuntime.client.createCommunityPost({
        kind: input.kind,
        ipId: input.ipId,
        title: input.title,
        content: input.content,
        mediaIds: input.mediaIds ?? [],
      }, idempotencyKey);
      setDuckroomShowcases((current) => mergeCommunityShowcase(
        current,
        mapApiCommunityPost(post, catalogProducts),
      ));
      return {
        ok: true,
        source: "remote",
        message: post.kind === "SNAP" ? "스냅이 서버에 등록됐습니다." : "덕룸 글이 서버에 등록됐습니다.",
        data: post,
      };
    } catch (error) {
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [apiRuntime.client, catalogProducts]);

  const loadCommunityPost = useCallback(async (
    postId: string,
    signal?: AbortSignal,
  ): Promise<UserMutationResult<UiDuckroomShowcase>> => {
    if (!apiRuntime.client.remoteEnabled) {
      return {
        ok: false,
        source: "prototype",
        message: "개발 프리뷰 게시물은 서버 상세를 불러오지 않습니다.",
      };
    }
    try {
      const post = await apiRuntime.client.getCommunityPost(postId, signal);
      let mapped = mapApiCommunityPost(post, catalogProducts);
      const mediaId = mapped.mediaIds?.[0];
      if (mediaId) {
        try {
          const media = await apiRuntime.client.getPublicMediaUrl(mediaId, signal);
          mapped = { ...mapped, mediaUrl: media.url };
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") throw error;
        }
      }
      setDuckroomShowcases((current) => mergeCommunityShowcase(current, mapped));
      return { ok: true, source: "remote", message: "게시물 상세를 서버에서 불러왔습니다.", data: mapped };
    } catch (error) {
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [apiRuntime.client, catalogProducts]);

  const loadCommunityComments = useCallback(async (
    postId: string,
    signal?: AbortSignal,
  ): Promise<UserMutationResult<ApiCommunityComment[]>> => {
    if (!apiRuntime.client.remoteEnabled) {
      return {
        ok: false,
        source: "prototype",
        message: "개발 프리뷰 게시물은 서버 댓글이 없습니다.",
      };
    }
    try {
      const comments = await apiRuntime.client.listCommunityComments(postId, signal);
      return { ok: true, source: "remote", message: "댓글을 서버에서 불러왔습니다.", data: comments };
    } catch (error) {
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [apiRuntime.client]);

  const submitCommunityComment = useCallback(async (
    postId: string,
    content: string,
    idempotencyKey?: string,
  ): Promise<UserMutationResult<ApiCommunityComment>> => {
    if (!apiRuntime.client.remoteEnabled) {
      return {
        ok: false,
        source: "prototype",
        message: "개발 프리뷰에서는 댓글을 서버에 등록하지 않습니다.",
      };
    }
    try {
      const comment = await apiRuntime.client.createCommunityComment(postId, content, idempotencyKey);
      return { ok: true, source: "remote", message: "댓글이 서버에 등록됐습니다.", data: comment };
    } catch (error) {
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [apiRuntime.client]);

  const deleteCommunityComment = useCallback(async (
    commentId: string,
    idempotencyKey?: string,
  ): Promise<UserMutationResult<ApiCommunityCommentDeleteResult>> => {
    if (!apiRuntime.client.remoteEnabled) {
      return {
        ok: false,
        source: "prototype",
        message: "개발 프리뷰에서는 댓글 삭제 상태를 서버에 만들지 않습니다.",
      };
    }
    try {
      const deleted = await apiRuntime.client.deleteCommunityComment(commentId, idempotencyKey);
      return { ok: true, source: "remote", message: "댓글을 서버에서 삭제했습니다.", data: deleted };
    } catch (error) {
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [apiRuntime.client]);

  const updateCommunityPost = useCallback(async (
    postId: string,
    input: { expectedVersion: number; title: string; content: string; ipId: string | null; mediaIds: string[] },
    idempotencyKey?: string,
  ): Promise<UserMutationResult<UiDuckroomShowcase>> => {
    if (!apiRuntime.client.remoteEnabled) {
      return {
        ok: false,
        source: "prototype",
        message: "개발 프리뷰에서는 게시물 수정을 서버에 저장하지 않습니다.",
      };
    }
    const mapAndStore = async (post: ApiCommunityPost) => {
      let mapped = mapApiCommunityPost(post, catalogProducts);
      const mediaId = mapped.mediaIds?.[0];
      if (mediaId) {
        try {
          const media = await apiRuntime.client.getPublicMediaUrl(mediaId);
          mapped = { ...mapped, mediaUrl: media.url };
        } catch {
          // The authoritative edit can still succeed while media processing is pending.
        }
      }
      setDuckroomShowcases((current) => mergeCommunityShowcase(current, mapped));
      return mapped;
    };
    try {
      const post = await apiRuntime.client.updateCommunityPost(postId, input, idempotencyKey);
      const mapped = await mapAndStore(post);
      return { ok: true, source: "remote", message: "게시물 수정 내용을 서버에 저장했습니다.", data: mapped };
    } catch (error) {
      if (error instanceof DabbobaApiError && error.status === 409) {
        try {
          const latest = await apiRuntime.client.getCommunityPost(postId);
          const mapped = await mapAndStore(latest);
          return {
            ok: false,
            source: "remote",
            message: "다른 변경과 충돌해 최신 게시물을 다시 불러왔습니다. 내용을 확인해 주세요.",
            data: mapped,
          };
        } catch {
          // Keep the original conflict message when refresh also fails.
        }
      }
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [apiRuntime.client, catalogProducts]);

  const uploadMedia = useCallback(async (
    file: File,
    purpose: "PROFILE" | "POST" | "COMMENT" | "INQUIRY" | "EXCHANGE" | "CATALOG_REQUEST",
    idempotencyKey?: string,
  ): Promise<UserMutationResult<ApiMediaReady>> => {
    if (!apiRuntime.client.remoteEnabled) {
      return {
        ok: false,
        source: "prototype",
        message: "개발 프리뷰에서는 사진을 서버 저장소에 업로드하지 않습니다.",
      };
    }
    try {
      const media = await apiRuntime.client.uploadMedia(file, purpose, idempotencyKey);
      return { ok: true, source: "remote", message: "사진 업로드가 완료됐습니다.", data: media };
    } catch (error) {
      return {
        ok: false,
        source: "remote",
        message: apiErrorMessage(error),
        ...(error instanceof DabbobaApiError ? { code: error.code } : {}),
      };
    }
  }, [apiRuntime.client]);

  const toggleCommunityPostLike = useCallback(async (
    postId: string,
    liked: boolean,
    idempotencyKey?: string,
  ): Promise<UserMutationResult<ApiCommunityPostLikeResult>> => {
    if (!apiRuntime.client.remoteEnabled) {
      setDuckroomShowcases((current) => current.map((post) => post.id === postId ? {
        ...post,
        likedByViewer: liked,
        likes: Math.max(0, post.likes + (liked ? 1 : -1)),
      } : post));
      return { ok: true, source: "prototype", message: liked ? "프로토타입 좋아요를 반영했어요." : "프로토타입 좋아요를 취소했어요." };
    }
    try {
      const updated = await apiRuntime.client.setCommunityPostLike(postId, liked, idempotencyKey);
      setDuckroomShowcases((current) => current.map((post) => post.id === updated.postId ? {
        ...post,
        likedByViewer: updated.liked,
        likes: updated.likeCount,
      } : post));
      return { ok: true, source: "remote", message: updated.liked ? "덕룸 좋아요를 서버에 반영했습니다." : "덕룸 좋아요를 서버에서 취소했습니다.", data: updated };
    } catch (error) {
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [apiRuntime.client]);

  const deleteCommunityPost = useCallback(async (
    postId: string,
    expectedVersion: number,
    idempotencyKey?: string,
  ): Promise<UserMutationResult<ApiCommunityPostDeleteResult>> => {
    if (!apiRuntime.client.remoteEnabled) {
      setDuckroomShowcases((current) => current.filter((post) => post.id !== postId));
      return { ok: true, source: "prototype", message: "프로토타입 덕룸 글을 삭제했습니다." };
    }
    try {
      const deleted = await apiRuntime.client.deleteCommunityPost(postId, expectedVersion, idempotencyKey);
      setDuckroomShowcases((current) => current.filter((post) => post.id !== deleted.postId));
      return { ok: true, source: "remote", message: "덕룸 글을 서버에서 삭제했습니다.", data: deleted };
    } catch (error) {
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [apiRuntime.client]);

  const blockCommunityUser = useCallback(async (
    userId: string,
    idempotencyKey?: string,
  ): Promise<UserMutationResult> => {
    if (apiRuntime.client.remoteEnabled) {
      try {
        await apiRuntime.client.setCommunityUserBlocked(userId, true, idempotencyKey);
      } catch (error) {
        return { ok: false, source: "remote", message: apiErrorMessage(error) };
      }
    }
    setDuckroomShowcases((current) => current.filter((post) => post.authorId !== userId));
    return {
      ok: true,
      source: apiRuntime.client.remoteEnabled ? "remote" : "prototype",
      message: "작성자를 차단했습니다. 서로의 덕룸 콘텐츠가 더 이상 표시되지 않습니다.",
    };
  }, [apiRuntime.client]);

  const loadBlockedUsers = useCallback(async (
    signal?: AbortSignal,
  ): Promise<UserMutationResult<ApiBlockedUser[]>> => {
    if (!apiRuntime.client.remoteEnabled) {
      return {
        ok: false,
        source: "prototype",
        message: "개발 프리뷰에서는 서버 차단 목록을 불러오지 않습니다.",
      };
    }
    try {
      const blockedUsers = await apiRuntime.client.listBlockedUsers(signal);
      return { ok: true, source: "remote", message: "차단 목록을 서버에서 불러왔습니다.", data: blockedUsers };
    } catch (error) {
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [apiRuntime.client]);

  const unblockCommunityUser = useCallback(async (
    userId: string,
    idempotencyKey?: string,
  ): Promise<UserMutationResult<ApiBlockResult>> => {
    if (!apiRuntime.client.remoteEnabled) {
      return {
        ok: false,
        source: "prototype",
        message: "개발 프리뷰에서는 차단 해제 상태를 서버에 저장하지 않습니다.",
      };
    }
    try {
      const result = await apiRuntime.client.setCommunityUserBlocked(userId, false, idempotencyKey);
      return { ok: true, source: "remote", message: "차단을 해제했습니다. 덕룸을 새로 불러오면 해당 사용자의 글이 다시 표시됩니다.", data: result };
    } catch (error) {
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [apiRuntime.client]);

  const submitCommunityReport = useCallback(async (
    input: { targetType: "POST" | "SNAP"; targetId: string; reason: ApiReportReason; details?: string },
    idempotencyKey?: string,
  ): Promise<UserMutationResult<ApiReport>> => {
    if (!apiRuntime.client.remoteEnabled) {
      return {
        ok: false,
        source: "prototype",
        message: "개발 프리뷰에서는 신고를 서버나 운영자에게 전송하지 않습니다.",
      };
    }
    try {
      const report = await apiRuntime.client.createReport(input, idempotencyKey);
      return { ok: true, source: "remote", message: "신고가 운영자 검토 대기 상태로 접수됐습니다.", data: report };
    } catch (error) {
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [apiRuntime.client]);

  const loadInquiryDetail = useCallback(async (
    inquiryId: string,
    signal?: AbortSignal,
  ): Promise<UserMutationResult<ApiInquiryDetail>> => {
    if (!apiRuntime.client.remoteEnabled) {
      return {
        ok: false,
        source: "prototype",
        message: "개발 프리뷰 문의는 서버 대화 내역이 없습니다.",
      };
    }
    try {
      const detail = await apiRuntime.client.getInquiryDetail(inquiryId, signal);
      setInquiries((current) => current.map((inquiry) => inquiry.id === detail.id ? {
        id: detail.id,
        userId: detail.userId,
        category: detail.category,
        title: detail.title,
        status: detail.status,
        assignedAdminId: detail.assignedAdminId,
        createdAt: detail.createdAt,
        updatedAt: detail.updatedAt,
      } : inquiry));
      return { ok: true, source: "remote", message: "문의 대화를 불러왔습니다.", data: detail };
    } catch (error) {
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [apiRuntime.client]);

  const submitInquiryMessage = useCallback(async (
    inquiryId: string,
    input: { content: string; mediaIds?: string[] },
    idempotencyKey?: string,
  ): Promise<UserMutationResult<ApiInquiryMessage>> => {
    if (!apiRuntime.client.remoteEnabled) {
      return {
        ok: false,
        source: "prototype",
        message: "개발 프리뷰에서는 문의 답글을 서버나 운영자에게 전송하지 않습니다.",
      };
    }
    try {
      const message = await apiRuntime.client.createInquiryMessage(inquiryId, input, idempotencyKey);
      return { ok: true, source: "remote", message: "후속 답글을 서버 문의에 등록했습니다.", data: message };
    } catch (error) {
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [apiRuntime.client]);

  const loadAuthenticatedMediaUrl = useCallback(async (
    mediaId: string,
    signal?: AbortSignal,
  ): Promise<UserMutationResult<ApiMediaReadUrl>> => {
    if (!apiRuntime.client.remoteEnabled) {
      return {
        ok: false,
        source: "prototype",
        message: "개발 프리뷰에는 인증된 문의 첨부 URL이 없습니다.",
      };
    }
    try {
      const media = await apiRuntime.client.getAuthenticatedMediaUrl(mediaId, signal);
      return { ok: true, source: "remote", message: "문의 첨부 이미지를 불러왔습니다.", data: media };
    } catch (error) {
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [apiRuntime.client]);

  const submitInquiry = useCallback(async (
    input: { category: string; title: string; content: string },
    idempotencyKey?: string,
  ): Promise<UserMutationResult<ApiInquiry>> => {
    if (!apiRuntime.client.remoteEnabled) {
      return {
        ok: false,
        source: "prototype",
        message: "개발 프리뷰에서는 문의를 서버나 운영자에게 전송하지 않습니다.",
      };
    }
    const categoryMap: Record<string, "ACCOUNT" | "ERROR" | "PRODUCT" | "COMMUNITY" | "ORDER" | "OTHER"> = {
      account: "ACCOUNT",
      draw: "PRODUCT",
      exchange: "COMMUNITY",
      order: "ORDER",
      delivery: "ORDER",
      other: "OTHER",
    };
    try {
      const inquiry = await apiRuntime.client.createInquiry({
        category: categoryMap[input.category] ?? "OTHER",
        title: input.title,
        content: input.content,
      }, idempotencyKey);
      setInquiries((current) => [inquiry, ...current.filter((item) => item.id !== inquiry.id)]);
      return { ok: true, source: "remote", message: "문의가 서버에 접수됐습니다.", data: inquiry };
    } catch (error) {
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [apiRuntime.client]);

  const loadDrawOdds = useCallback(async (productId: string, force = false): Promise<UserMutationResult<ApiDrawOdds>> => {
    if (!apiRuntime.client.remoteEnabled) {
      return { ok: false, source: "prototype", message: "프로토타입에서는 화면 확인용 경품표를 사용합니다." };
    }
    const cached = drawOddsByProductId[productId];
    if (cached && !force) return { ok: true, source: "remote", message: "서버 확률표를 확인했습니다.", data: cached };
    setDrawOddsStateByProductId((current) => ({ ...current, [productId]: "loading" }));
    const request = pendingDrawOddsRef.current[productId] ?? apiRuntime.client.getActiveDrawOdds(productId);
    pendingDrawOddsRef.current[productId] = request;
    try {
      const odds = await request;
      setDrawOddsByProductId((current) => ({ ...current, [productId]: odds }));
      setDrawOddsStateByProductId((current) => ({ ...current, [productId]: "ready" }));
      return { ok: true, source: "remote", message: "서버 확률표를 확인했습니다.", data: odds };
    } catch (error) {
      setDrawOddsStateByProductId((current) => ({
        ...current,
        [productId]: error instanceof DabbobaApiError && error.status === 404 ? "unavailable" : "error",
      }));
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    } finally {
      if (pendingDrawOddsRef.current[productId] === request) delete pendingDrawOddsRef.current[productId];
    }
  }, [apiRuntime.client, drawOddsByProductId]);

  const submitOrder = useCallback(async (input: { productId: string; quantity: number; pointAmount: number; expectedDrawVersion?: number; idempotencyKey?: string }): Promise<UserMutationResult<ApiOrder>> => {
    if (!apiRuntime.client.remoteEnabled) {
      return { ok: true, source: "prototype", message: "프로토타입 주문 흐름을 계속합니다." };
    }
    try {
      const order = await apiRuntime.client.createOrder({
        items: [{
          productId: input.productId,
          quantity: input.quantity,
          ...(input.expectedDrawVersion === undefined ? {} : { expectedDrawVersion: input.expectedDrawVersion }),
        }],
        pointAmount: input.pointAmount,
      }, input.idempotencyKey);
      setAccountOrders((current) => [order, ...current.filter((item) => item.id !== order.id)]);
      return {
        ok: true,
        source: "remote",
        message: "서버 주문 예약이 생성됐습니다. 결제 승인 전에는 상품이나 추첨권이 지급되지 않습니다.",
        data: order,
      };
    } catch (error) {
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [apiRuntime.client]);

  const loadOrder = useCallback(async (orderId: string, signal?: AbortSignal): Promise<UserMutationResult<ApiOrder>> => {
    if (!apiRuntime.client.remoteEnabled) {
      return { ok: false, source: "prototype", message: "프로토타입 주문은 서버에서 조회하지 않습니다." };
    }
    try {
      const order = await apiRuntime.client.getOrder(orderId, signal);
      setAccountOrders((current) => [order, ...current.filter((item) => item.id !== order.id)]);
      return { ok: true, source: "remote", message: "서버 주문 상태를 확인했습니다.", data: order };
    } catch (error) {
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [apiRuntime.client]);

  const consumeDrawEntitlement = useCallback(async (
    entitlementId: string,
    idempotencyKey?: string,
  ): Promise<UserMutationResult<ApiDrawResult>> => {
    if (!apiRuntime.client.remoteEnabled) {
      return { ok: false, source: "prototype", message: "프로토타입 추첨권은 서버에서 소비하지 않습니다." };
    }
    try {
      const result = await apiRuntime.client.consumeDrawEntitlement(entitlementId, idempotencyKey);
      setAccountDrawEntitlements((current) => current.filter((entitlement) => entitlement.id !== result.entitlementId));
      return { ok: true, source: "remote", message: "서버가 추첨 결과를 확정했습니다.", data: result };
    } catch (error) {
      return { ok: false, source: "remote", message: apiErrorMessage(error) };
    }
  }, [apiRuntime.client]);

  const contextValue: DabbobaContextValue = {
    currentUserId,
    apiMode: apiRuntime.client.remoteEnabled ? "remote" : "prototype",
    apiSyncState,
    apiSyncMessage,
    catalogProducts,
    drawOddsByProductId,
    drawOddsStateByProductId,
    loadDrawOdds,
    catalogIps,
    notices,
    duckroomShowcases,
    inquiries,
    wishlistItems,
    accountOrders,
    accountDrawEntitlements,
    accountShippingRequests,
    accountNotifications,
    notificationPreferences,
    remoteAddressState,
    isAuthenticated,
    setIsAuthenticated,
    createDevelopmentSession,
    logoutUserSession,
    requestAccountDeletion,
    authIntent,
    setAuthIntent,
    exchangeComposerRequested,
    setExchangeComposerRequested,
    requestComposerRequested,
    setRequestComposerRequested,
    catalogRequestComposerRequested,
    setCatalogRequestComposerRequested,
    communityComposerRequested,
    setCommunityComposerRequested,
    communityReportRequested,
    setCommunityReportRequested,
    activeRootTab,
    setActiveRootTab,
    profile,
    setProfile,
    updateProfile,
    profileSaveNotice,
    setProfileSaveNotice,
    memberSettings,
    setMemberSettings,
    saveDefaultAddress,
    memberSaveNotice,
    setMemberSaveNotice,
    exchangePosts,
    addExchangePost,
    exchangeApplications,
    addExchangeApplication,
    loadExchangeListingDetail,
    decideExchangeApplication,
    cancelExchangeListing,
    withdrawExchangeApplication,
    confirmExchangeCompletion,
    productRequests,
    addProductRequest,
    likedProductRequestIds,
    toggleProductRequestLike,
    deleteProductRequest,
    submitCatalogRequest,
    submitCommunityPost,
    loadCommunityPost,
    loadCommunityComments,
    submitCommunityComment,
    deleteCommunityComment,
    updateCommunityPost,
    uploadMedia,
    toggleCommunityPostLike,
    deleteCommunityPost,
    blockCommunityUser,
    loadBlockedUsers,
    unblockCommunityUser,
    submitCommunityReport,
    submitInquiry,
    loadInquiryDetail,
    submitInquiryMessage,
    loadAuthenticatedMediaUrl,
    submitOrder,
    loadOrder,
    consumeDrawEntitlement,
    sessionCommerce,
    toggleWishlistProduct,
    recordOrder,
    updateOrderStatus,
    recordInventoryUnit,
    requestShipping,
    loadShippingRequests,
    loadShippingRequestDetail,
    markNotificationRead,
    saveNotificationPreferences,
    setInventoryExchangeStatus,
    pointBalance: sessionCommerce.pointBalance,
    couponDiscount,
    setCouponDiscount,
    points,
    setPoints,
    paymentMethod,
    setPaymentMethod,
    paying,
    setPaying,
    drawState,
    setDrawState,
    drawRemaining,
    setDrawRemaining,
    resultOpen,
    setResultOpen,
    resultGrade,
    setResultGrade,
    drawControlProgress,
    setDrawControlProgress,
    prepareCheckout,
    prepareDraw,
  };

  return (
    <DabbobaContext.Provider value={contextValue}>
      <div className="dabboba-root">
        <FlowStack initial={initialScreen} />
        {splashState !== "hidden" ? <DabbobaSplash state={splashState} /> : null}
      </div>
    </DabbobaContext.Provider>
  );
}

function DabbobaSplash({ state }: { state: Exclude<SplashState, "hidden"> }) {
  return (
    <div className="dabboba-splash" data-state={state} role="status" aria-label="DABBOBA 불러오는 중">
      <div className="dabboba-splash-lockup">
        <DabbobaWordmark className="dabboba-splash-wordmark" alt="" />
        <small>원하는 거 다 뽑아</small>
        <span className="dabboba-splash-loader" aria-hidden="true"><i /><i /><i /><i /></span>
      </div>
    </div>
  );
}

function createCatalogScreen(): FlowScreen {
  return {
    id: "root-home",
    header: (flow) => <CatalogHeader flow={flow} />,
    headerHeight: 58,
    footer: (flow) => <RootTabFooter flow={flow} />,
    footerHeight: 70,
    render: (flow) => <CatalogPage flow={flow} />,
  };
}

function createExchangeRoomScreen(): FlowScreen {
  return {
    id: "root-community",
    header: () => <RootTabHeader title="교환방" subtitle="내 굿즈와 원하는 교환을 연결하는 곳" />,
    headerHeight: 58,
    footer: (flow) => <RootTabFooter flow={flow} />,
    footerHeight: 70,
    render: (flow) => <ExchangeRoomPage flow={flow} />,
  };
}

function createExchangeDetailScreen(postId: string): FlowScreen {
  return {
    id: `exchange-post-${postId}`,
    header: (flow) => <BackHeader title="교환 상세" onBack={flow.pop} />,
    headerHeight: 56,
    render: () => <ExchangeDetailPage postId={postId} />,
  };
}

function createLoginScreen(): FlowScreen {
  return {
    id: "login",
    header: (flow) => <LoginHeader flow={flow} />,
    headerHeight: 56,
    render: (flow) => <LoginPage flow={flow} />,
  };
}

function createShopScreen(): FlowScreen {
  return {
    id: "root-shop",
    header: () => <RootTabHeader title="뽀바" subtitle="가챠 · 피규어 · 쿠지" showPoints />,
    headerHeight: 58,
    footer: (flow) => <RootTabFooter flow={flow} />,
    footerHeight: 70,
    render: (flow) => <ShopPage flow={flow} />,
  };
}

function createDuckroomScreen(): FlowScreen {
  return {
    id: "root-duckroom",
    header: () => <RootTabHeader title="덕룸" subtitle="모은 굿즈를 꺼내 보여주는 곳" />,
    headerHeight: 58,
    footer: (flow) => <RootTabFooter flow={flow} />,
    footerHeight: 70,
    render: () => <DuckroomPage />,
  };
}

function createDuckroomDetailScreen(postId: string): FlowScreen {
  return {
    id: `duckroom-post-${postId}`,
    header: (flow) => <BackHeader title="덕룸 상세" onBack={flow.pop} />,
    headerHeight: 56,
    render: () => <DuckroomDetailPage postId={postId} />,
  };
}

function createProfileScreen(): FlowScreen {
  return {
    id: "root-profile",
    header: () => <RootTabHeader title="프로필" subtitle="나의 DABBOBA" />,
    headerHeight: 58,
    footer: (flow) => <RootTabFooter flow={flow} />,
    footerHeight: 70,
    render: (flow) => <ProfilePage flow={flow} />,
  };
}

function createProfileDetailScreen(): FlowScreen {
  return {
    id: "profile-detail",
    header: (flow) => <BackHeader title="프로필 관리" onBack={flow.pop} />,
    headerHeight: 56,
    render: (flow) => <ProfileDetailPage flow={flow} />,
  };
}

function createMemberInfoScreen(): FlowScreen {
  return {
    id: "profile-member-info",
    header: (flow) => <BackHeader title="회원정보 변경" onBack={flow.pop} />,
    headerHeight: 56,
    render: (flow) => <MemberInfoPage flow={flow} />,
  };
}

function createPersonalInformationScreen(): FlowScreen {
  return {
    id: "profile-personal-information",
    header: (flow) => <BackHeader title="개인정보" onBack={flow.pop} />,
    headerHeight: 56,
    render: (flow) => <PersonalInformationPage flow={flow} />,
  };
}

function createPhoneNumberScreen(): FlowScreen {
  return {
    id: "profile-phone-number",
    header: (flow) => <BackHeader title="휴대폰 번호" onBack={flow.pop} />,
    headerHeight: 56,
    render: (flow) => <PhoneNumberPage flow={flow} />,
  };
}

function createEmailAddressScreen(): FlowScreen {
  return {
    id: "profile-email-address",
    header: (flow) => <BackHeader title="이메일" onBack={flow.pop} />,
    headerHeight: 56,
    render: (flow) => <EmailAddressPage flow={flow} />,
  };
}

function createDefaultAddressScreen(): FlowScreen {
  return {
    id: "profile-default-address",
    header: (flow) => <BackHeader title="기본 배송지" onBack={flow.pop} />,
    headerHeight: 56,
    render: (flow) => <DefaultAddressPage flow={flow} />,
  };
}

function createPaymentCardsScreen(): FlowScreen {
  return {
    id: "profile-payment-cards",
    header: (flow) => <BackHeader title="결제 카드" onBack={flow.pop} />,
    headerHeight: 56,
    render: (flow) => <PaymentCardsPage flow={flow} />,
  };
}

function createPaymentPreferencesScreen(): FlowScreen {
  return {
    id: "profile-payment-preferences",
    header: (flow) => <BackHeader title="결제 설정" onBack={flow.pop} />,
    headerHeight: 56,
    render: (flow) => <PaymentPreferencesPage flow={flow} />,
  };
}

function createLoginSecurityScreen(): FlowScreen {
  return {
    id: "profile-login-security",
    header: (flow) => <BackHeader title="로그인 및 보안" onBack={flow.pop} />,
    headerHeight: 56,
    render: (flow) => <LoginSecurityPage flow={flow} />,
  };
}

function createPrivacySettingsScreen(): FlowScreen {
  return {
    id: "profile-privacy-settings",
    header: (flow) => <BackHeader title="개인정보 및 수신 동의" onBack={flow.pop} />,
    headerHeight: 56,
    render: (flow) => <PrivacySettingsPage flow={flow} />,
  };
}

function createSettingsScreen(): FlowScreen {
  return {
    id: "settings",
    header: (flow) => <BackHeader title="설정" onBack={flow.pop} />,
    headerHeight: 56,
    render: (flow) => <SettingsPage flow={flow} />,
  };
}

function createNotificationSettingsScreen(): FlowScreen {
  return {
    id: "settings-notifications",
    header: (flow) => <BackHeader title="알림 수신 설정" onBack={flow.pop} />,
    headerHeight: 56,
    render: (flow) => <NotificationSettingsPage flow={flow} />,
  };
}

function createBlockedUsersScreen(): FlowScreen {
  return {
    id: "settings-blocked-users",
    header: (flow) => <BackHeader title="차단한 사용자" onBack={flow.pop} />,
    headerHeight: 56,
    render: () => <BlockedUsersPage />,
  };
}

function createNoticesScreen(): FlowScreen {
  return {
    id: "settings-notices",
    header: (flow) => <BackHeader title="공지사항" onBack={flow.pop} />,
    headerHeight: 56,
    render: (flow) => <NoticesPage flow={flow} />,
  };
}

function createNoticeDetailScreen(notice: SettingsNotice): FlowScreen {
  return {
    id: `settings-notice-${notice.id}`,
    header: (flow) => <BackHeader title="공지사항" onBack={flow.pop} />,
    headerHeight: 56,
    render: () => <NoticeDetailPage notice={notice} />,
  };
}

function createInquiryScreen(): FlowScreen {
  return {
    id: "settings-inquiry",
    header: (flow) => <BackHeader title="문의하기" onBack={flow.pop} />,
    headerHeight: 56,
    render: (flow) => <InquiryPage flow={flow} />,
  };
}

function createInquiryDetailScreen(inquiryId: string, title: string): FlowScreen {
  return {
    id: `settings-inquiry-${inquiryId}`,
    header: (flow) => <BackHeader title="문의 내역" onBack={flow.pop} />,
    headerHeight: 56,
    render: () => <InquiryDetailPage inquiryId={inquiryId} fallbackTitle={title} />,
  };
}

function createLegalHubScreen(): FlowScreen {
  return {
    id: "settings-legal",
    header: (flow) => <BackHeader title="이용약관 및 정책" onBack={flow.pop} />,
    headerHeight: 56,
    render: (flow) => <LegalHubPage flow={flow} />,
  };
}

function createLegalDocumentScreen(document: LegalDocument): FlowScreen {
  return {
    id: `settings-legal-${document.id}`,
    header: (flow) => <BackHeader title="약관 및 정책" onBack={flow.pop} />,
    headerHeight: 56,
    render: () => <LegalDocumentPage document={document} />,
  };
}

function createAccountDeletionScreen(): FlowScreen {
  return {
    id: "settings-account-deletion",
    header: (flow) => <BackHeader title="탈퇴하기" onBack={flow.pop} />,
    headerHeight: 56,
    render: (flow) => <AccountDeletionPage flow={flow} />,
  };
}

function createWishlistScreen(): FlowScreen {
  return {
    id: "profile-wishlist",
    header: (flow) => <BackHeader title="내 찜 목록" onBack={flow.pop} />,
    headerHeight: 56,
    render: (flow) => <WishlistPage flow={flow} />,
  };
}

function createStorageScreen(): FlowScreen {
  return {
    id: "profile-storage",
    header: (flow) => <BackHeader title="보관함" onBack={flow.pop} />,
    headerHeight: 56,
    render: (flow) => <StoragePage flow={flow} />,
  };
}

function createShippingRequestScreen(): FlowScreen {
  return {
    id: "profile-shipping-request",
    header: (flow) => <BackHeader title="배송 신청" onBack={flow.pop} />,
    headerHeight: 56,
    render: () => <ShippingRequestPage />,
  };
}

function createShippingHistoryScreen(): FlowScreen {
  return {
    id: "profile-shipping-history",
    header: (flow) => <BackHeader title="배송 신청 내역" onBack={flow.pop} />,
    headerHeight: 56,
    render: () => <ShippingHistoryPage />,
  };
}

function createPurchaseHistoryScreen(): FlowScreen {
  return {
    id: "profile-purchase-history",
    header: (flow) => <BackHeader title="구매 내역" onBack={flow.pop} />,
    headerHeight: 56,
    render: (flow) => <PurchaseHistoryPage flow={flow} />,
  };
}

function createPointHistoryScreen(): FlowScreen {
  return {
    id: "profile-point-history",
    header: (flow) => <BackHeader title="포인트 내역" onBack={flow.pop} />,
    headerHeight: 56,
    render: () => <PointHistoryPage />,
  };
}

function createCustomerCenterScreen(): FlowScreen {
  return {
    id: "customer-center",
    header: (flow) => <BackHeader title="고객센터" onBack={flow.pop} />,
    headerHeight: 56,
    render: () => <CustomerCenterPage />,
  };
}

function createRequestRoomScreen(): FlowScreen {
  return {
    id: "request-room",
    header: (flow) => <BackHeader title="신청방" onBack={flow.pop} />,
    headerHeight: 56,
    render: (flow) => <RequestRoomPage flow={flow} />,
  };
}

const PROFILE_MENU_ITEMS = [
  { label: "내 찜 목록", createScreen: createWishlistScreen },
  { label: "보관함", createScreen: createStorageScreen },
  { label: "배송 신청", createScreen: createShippingRequestScreen },
  { label: "배송 신청 내역", createScreen: createShippingHistoryScreen },
  { label: "구매 내역", createScreen: createPurchaseHistoryScreen },
  { label: "포인트 내역", createScreen: createPointHistoryScreen },
  { label: "고객센터", createScreen: createCustomerCenterScreen },
] as const;

function createRootScreen(tab: RootTabId) {
  if (tab === "community") return createExchangeRoomScreen();
  if (tab === "shop") return createShopScreen();
  if (tab === "duckroom") return createDuckroomScreen();
  if (tab === "profile") return createProfileScreen();
  return createCatalogScreen();
}

function rootTabRoute(tab: RootTabId): NativeDeepLinkRoute {
  if (tab === "community") return "exchange";
  if (tab === "shop") return "ppoba";
  if (tab === "duckroom") return "dukroom";
  if (tab === "profile") return "profile";
  return "home";
}

function replaceWebPath(route: NativeDeepLinkRoute) {
  const pathname = webPathForRoute(route);
  if (window.location.pathname === pathname) return;
  window.history.replaceState(window.history.state, "", `${pathname}${window.location.search}`);
}

function NativeBridgeController({ rootScreenId }: { rootScreenId: string }) {
  const flow = useFlow();
  const { setActiveRootTab } = useDabboba();
  const active = flow.stack[0]?.id === rootScreenId;
  const lastHandledRef = useRef("");

  const navigate = useCallback((route: NativeDeepLinkRoute) => {
    const rootTab: RootTabId = route === "exchange"
      ? "community"
      : route === "ppoba"
        ? "shop"
        : route === "dukroom"
          ? "duckroom"
          : route === "profile" || route === "request-room" || route === "settings"
            ? "profile"
            : "home";
    const screensAboveRoot = Math.max(0, flow.stack.length - 1);
    for (let index = 0; index < screensAboveRoot; index += 1) flow.pop();
    replaceWebPath(route);
    setActiveRootTab(rootTab);
    flow.replace(createRootScreen(rootTab));
    if (route === "request-room") flow.push(createRequestRoomScreen());
    if (route === "settings") flow.push(createSettingsScreen());
  }, [flow, setActiveRootTab]);

  useEffect(() => {
    if (!active) return;
    const handleMessage = (event: MessageEvent) => {
      if (event.currentTarget === window && event.origin !== window.location.origin) return;
      if (event.currentTarget === document && event.origin && event.origin !== window.location.origin) return;
      const route = parseNativeDeepLinkMessage(event.data, window.location.origin);
      if (!route) return;
      const fingerprint = `${route}:${String(event.data)}`;
      if (lastHandledRef.current === fingerprint) return;
      lastHandledRef.current = fingerprint;
      navigate(route);
      window.setTimeout(() => {
        if (lastHandledRef.current === fingerprint) lastHandledRef.current = "";
      }, 250);
    };
    window.addEventListener("message", handleMessage);
    document.addEventListener("message", handleMessage as EventListener);

    const initialRoute = routeForWebPath(window.location.pathname);
    const targetRootId = initialRoute === "exchange"
      ? "root-community"
      : initialRoute === "ppoba"
        ? "root-shop"
        : initialRoute === "dukroom"
          ? "root-duckroom"
          : initialRoute === "profile" || initialRoute === "request-room" || initialRoute === "settings"
            ? "root-profile"
            : "root-home";
    if (
      initialRoute
      && flow.stack.length === 1
      && (flow.current.id !== targetRootId || initialRoute === "request-room" || initialRoute === "settings")
    ) {
      navigate(initialRoute);
    }
    return () => {
      window.removeEventListener("message", handleMessage);
      document.removeEventListener("message", handleMessage as EventListener);
    };
  }, [active, navigate]);

  return null;
}

function createIpCatalogScreen(): FlowScreen {
  return {
    id: "ip-catalog",
    header: (flow) => <BackHeader title="전체 작품" onBack={flow.pop} />,
    headerHeight: 56,
    render: (flow) => <IpCatalogPage flow={flow} />,
  };
}

function createIpDetailScreen(ip: IpRecord): FlowScreen {
  return {
    id: `ip-${ip.slug}`,
    header: (flow) => <BackHeader title="작품" onBack={flow.pop} />,
    headerHeight: 56,
    render: (flow) => <IpDetailPage flow={flow} ip={ip} />,
  };
}

function createDetailScreen(product: Product): FlowScreen {
  return {
    id: `detail-${product.id}`,
    header: (flow) => <BackHeader title="상품 상세" onBack={flow.pop} />,
    headerHeight: 56,
    footer: (flow) => <DetailFooter flow={flow} product={product} />,
    footerHeight: 82,
    render: () => <ProductDetail product={product} />,
  };
}

function createCheckoutScreen(product: Product, quantity: number): FlowScreen {
  return {
    id: `checkout-${product.id}`,
    header: (flow) => <BackHeader title="결제" onBack={flow.pop} />,
    headerHeight: 56,
    footer: (flow) => <CheckoutFooter flow={flow} product={product} quantity={quantity} />,
    footerHeight: 104,
    render: () => <CheckoutPage product={product} quantity={quantity} />,
  };
}

function createDrawScreen(product: Product, quantity: number, orderId: string, drawEntitlementIds: string[] = []): FlowScreen {
  return {
    id: `draw-${product.id}`,
    header: () => <DrawHeader />,
    headerHeight: 56,
    footer: (flow) => <DrawFooter flow={flow} product={product} quantity={quantity} orderId={orderId} drawEntitlementIds={drawEntitlementIds} />,
    footerHeight: 94,
    render: () => <DrawPage product={product} quantity={quantity} />,
  };
}

function createPurchaseCompleteScreen(
  product: Product,
  quantity: number,
  paidTotal: number,
  orderId: string,
  drawEntitlementIds: string[] = [],
): FlowScreen {
  const drawMode = isRandomDrawCategory(product.categoryId);

  return {
    id: `purchase-complete-${product.id}`,
    header: () => <StaticHeader title={drawMode ? "결제 완료" : "주문 완료"} />,
    headerHeight: 56,
    footer: (flow) => <PurchaseCompleteFooter flow={flow} product={product} quantity={quantity} orderId={orderId} drawEntitlementIds={drawEntitlementIds} />,
    footerHeight: 82,
    render: () => <PurchaseCompletePage product={product} quantity={quantity} paidTotal={paidTotal} orderId={orderId} />,
  };
}

function CatalogHeader({ flow }: { flow: FlowControls }) {
  const { pointBalance } = useDabboba();

  return (
    <div className="app-toolbar catalog-toolbar">
      <div className="brand-lockup">
        <DabbobaWordmark className="catalog-wordmark" />
        <span>원하는 거 다 뽑아</span>
      </div>
      <div className="catalog-toolbar-actions">
        <button
          type="button"
          className="catalog-search-button"
          onClick={() => flow.push(createIpCatalogScreen())}
          aria-label="전체 작품 검색"
        >
          <IconMagnifyingglassLine size={23} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="catalog-search-button"
          onClick={() => flow.push(createSettingsScreen())}
          aria-label="설정 열기"
        >
          <IconGearLine size={23} aria-hidden="true" />
        </button>
        <span className="header-points" aria-label={`보유 포인트 ${formatPoints(pointBalance)}`}>
          {formatPoints(pointBalance)}
        </span>
      </div>
    </div>
  );
}

function BackHeader({ title, onBack, pixel = false }: { title: string; onBack: () => void; pixel?: boolean }) {
  return (
    <div className="app-toolbar back-toolbar">
      <button type="button" className="icon-button" onClick={onBack} aria-label="뒤로 가기">
        <IconArrowLeftLine size={26} aria-hidden="true" />
      </button>
      <strong className={pixel ? "toolbar-title pixel-title" : "toolbar-title"}>{title}</strong>
      <span className="toolbar-spacer" aria-hidden="true" />
    </div>
  );
}

function LoginHeader({ flow }: { flow: FlowControls }) {
  const { setAuthIntent } = useDabboba();

  return (
    <BackHeader
      title="로그인"
      onBack={() => {
        setAuthIntent(null);
        flow.pop();
      }}
    />
  );
}

function StaticHeader({ title, pixel = false }: { title: string; pixel?: boolean }) {
  return (
    <div className="app-toolbar back-toolbar">
      <span className="toolbar-spacer" aria-hidden="true" />
      <strong className={pixel ? "toolbar-title pixel-title" : "toolbar-title"}>{title}</strong>
      <span className="toolbar-spacer" aria-hidden="true" />
    </div>
  );
}

function DrawHeader() {
  const { drawState } = useDabboba();

  return (
    <div className="app-toolbar back-toolbar draw-toolbar" data-state={drawState}>
      <span className="toolbar-spacer" aria-hidden="true" />
      <div className="draw-brand-lockup" role="img" aria-label="DABBOBA ARCADE">
        <DabbobaWordmark className="draw-wordmark" alt="" />
        <span>ARCADE</span>
      </div>
      <span className="toolbar-spacer" aria-hidden="true" />
    </div>
  );
}

function RootTabHeader({
  title,
  subtitle,
  showPoints = false,
}: {
  title: string;
  subtitle: string;
  showPoints?: boolean;
}) {
  const { pointBalance } = useDabboba();

  return (
    <div className="app-toolbar root-tab-toolbar">
      <div>
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      {showPoints ? (
        <span className="header-points" aria-label={`보유 포인트 ${formatPoints(pointBalance)}`}>
          {formatPoints(pointBalance)}
        </span>
      ) : null}
    </div>
  );
}

function RootTabFooter({ flow }: { flow: FlowControls }) {
  const { activeRootTab, setActiveRootTab } = useDabboba();
  const [navigationState, setNavigationState] = useState<RootNavigationState>("expanded");
  const navigationStateRef = useRef<RootNavigationState>("expanded");
  const lastScrollTopRef = useRef(0);
  const directionDistanceRef = useRef(0);
  const scrollTargetRef = useRef<HTMLElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);

  const updateNavigationState = useCallback((nextState: RootNavigationState) => {
    if (navigationStateRef.current === nextState) return;
    navigationStateRef.current = nextState;
    setNavigationState(nextState);
  }, []);

  useEffect(() => {
    updateNavigationState("expanded");
    directionDistanceRef.current = 0;
    const activeScrollTarget = document.querySelector<HTMLElement>(
      '.dabboba-root .flow-screen[data-flow-current="true"] .mobile-scroll',
    );
    scrollTargetRef.current = activeScrollTarget;
    lastScrollTopRef.current = Math.max(0, activeScrollTarget?.scrollTop ?? 0);

    const updateNavigation = () => {
      scrollFrameRef.current = null;
      const scrollTarget = scrollTargetRef.current;
      if (!scrollTarget) return;

      if (scrollTarget.scrollHeight <= scrollTarget.clientHeight + 2) {
        lastScrollTopRef.current = 0;
        directionDistanceRef.current = 0;
        updateNavigationState("expanded");
        return;
      }

      const nextScrollTop = Math.max(0, scrollTarget.scrollTop);
      const delta = nextScrollTop - lastScrollTopRef.current;
      lastScrollTopRef.current = nextScrollTop;

      if (nextScrollTop <= ROOT_NAVIGATION_TOP_THRESHOLD) {
        directionDistanceRef.current = 0;
        updateNavigationState("expanded");
        return;
      }

      if (delta === 0) return;

      if (navigationStateRef.current === "expanded") {
        directionDistanceRef.current = Math.max(0, directionDistanceRef.current + delta);
      } else {
        directionDistanceRef.current = Math.min(0, directionDistanceRef.current + delta);
      }

      if (
        navigationStateRef.current === "expanded" &&
        directionDistanceRef.current >= ROOT_NAVIGATION_COLLAPSE_THRESHOLD
      ) {
        directionDistanceRef.current = 0;
        updateNavigationState("compact");
      } else if (
        navigationStateRef.current === "compact" &&
        directionDistanceRef.current <= -ROOT_NAVIGATION_EXPAND_THRESHOLD
      ) {
        directionDistanceRef.current = 0;
        updateNavigationState("expanded");
      }
    };

    const handleScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target.classList.contains("mobile-scroll")) return;
      if (!target.closest('.dabboba-root .flow-screen[data-flow-current="true"]')) return;

      if (scrollTargetRef.current !== target) {
        scrollTargetRef.current = target;
        lastScrollTopRef.current = Math.max(0, target.scrollTop);
        directionDistanceRef.current = 0;
        return;
      }

      scrollTargetRef.current = target;
      if (scrollFrameRef.current === null) {
        scrollFrameRef.current = window.requestAnimationFrame(updateNavigation);
      }
    };

    document.addEventListener("scroll", handleScroll, { capture: true, passive: true });

    return () => {
      document.removeEventListener("scroll", handleScroll, true);
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [activeRootTab, updateNavigationState]);

  const selectTab = (tab: RootTabId) => {
    if (tab === activeRootTab) return;
    updateNavigationState("expanded");
    replaceWebPath(rootTabRoute(tab));
    setActiveRootTab(tab);
    flow.replace(createRootScreen(tab));
  };

  return (
    <div
      className="root-tab-footer"
      data-navigation-state={navigationState}
      onFocusCapture={() => updateNavigationState("expanded")}
    >
      <AppBottomNavigation activeTab={activeRootTab} onSelect={selectTab} />
    </div>
  );
}

function ExchangeSuggestionList({
  items,
  label,
  onSelect,
}: {
  items: readonly ExchangeSelectableItem[];
  label: string;
  onSelect: (item: ExchangeSelectableItem) => void;
}) {
  const { catalogIps } = useDabboba();
  return (
    <div className="exchange-suggestion-list" role="listbox" aria-label={label}>
      {items.length > 0 ? items.map((item) => {
        const ip = catalogIps.find((candidate) => candidate.id === item.ipId);
        return (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected="false"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => onSelect(item)}
          >
            {item.image ? <img src={item.image} alt="" loading="eager" decoding="sync" draggable={false} /> : null}
            <span>
              <strong>{item.name}</strong>
              <small>{ip?.nameKo ?? "작품 미지정"} · {categoryLabel(item.categoryId)}</small>
            </span>
            <em><span>{formatWon(item.estimatedPrice)}</span><small>{APP_REFERENCE_VALUE_NOTICE}</small></em>
          </button>
        );
      }) : (
        <p>앱에 등록된 상품 중 일치하는 결과가 없어요.</p>
      )}
    </div>
  );
}

function ExchangeSelectedInventoryCard({ item }: { item: ExchangeSelectableItem }) {
  const { catalogIps } = useDabboba();
  const ip = catalogIps.find((candidate) => candidate.id === item.ipId);
  return (
    <div className="exchange-selected-inventory" aria-label={`선택한 보유 상품 ${item.name}`}>
      {item.image ? <img src={item.image} alt="" loading="eager" decoding="sync" draggable={false} /> : null}
      <span>
        <small>등록된 내 상품</small>
        <strong>{item.name}</strong>
        <em>{ip?.nameKo ?? "작품 미지정"} · {categoryLabel(item.categoryId)}</em>
      </span>
      <b><span>{formatWon(item.estimatedPrice)}</span><small>{APP_REFERENCE_VALUE_NOTICE}</small></b>
    </div>
  );
}

function ExchangeRoomPage({ flow }: { flow: FlowControls }) {
  const {
    currentUserId,
    isAuthenticated,
    authIntent,
    setAuthIntent,
    exchangeComposerRequested,
    setExchangeComposerRequested,
    exchangePosts,
    addExchangePost,
    exchangeApplications,
    sessionCommerce,
    catalogProducts,
    catalogIps,
    apiMode,
    apiSyncState,
    apiSyncMessage,
  } = useDabboba();
  const keyboard = useKeyboard();
  const screenFocusRef = useScreenEntryFocus();
  const pendingListingKeyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const ownedExchangeItems = useMemo(() => inventoryExchangeItems(
    eligibleDrawExchangeProposalUnits(sessionCommerce, currentUserId),
  ), [currentUserId, sessionCommerce]);
  const firstOwnedExchangeItem = ownedExchangeItems[0];
  const [filter, setFilter] = useState<ExchangeFilter>("전체");
  const [composerOpen, setComposerOpen] = useState(false);
  const [draftCategoryId, setDraftCategoryId] = useState<ProductCategoryId>(firstOwnedExchangeItem?.categoryId ?? "gacha");
  const [draftIpId, setDraftIpId] = useState(firstOwnedExchangeItem?.ipId ?? catalogIps[0]?.id ?? "one-piece");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftOfferedQuery, setDraftOfferedQuery] = useState("");
  const [draftOfferedInventoryUnitId, setDraftOfferedInventoryUnitId] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [titleSuggestionsOpen, setTitleSuggestionsOpen] = useState(false);
  const [offeredSuggestionsOpen, setOfferedSuggestionsOpen] = useState(false);
  const [composerStatus, setComposerStatus] = useState("");
  const [submittingListing, setSubmittingListing] = useState(false);
  const syncedExchangeCatalogItems = useMemo<ExchangeSelectableItem[]>(() => catalogProducts.map((product) => ({
    id: `catalog-${product.id}`,
    catalogItemId: `catalog-${product.id}`,
    productId: product.id,
    ipId: product.ipId,
    categoryId: product.categoryId,
    name: product.title,
    image: product.asset,
    estimatedPrice: product.price,
    searchCount: 0,
    postCount: 0,
  })), [catalogProducts]);
  const fixtureTitleSuggestions = exchangeItemSuggestions(draftTitle);
  const titleSuggestions = apiMode === "remote"
    ? exchangeItemSuggestions(draftTitle, syncedExchangeCatalogItems, catalogIps)
    : fixtureTitleSuggestions;
  const offeredSuggestions = normalizeCatalogSearch(draftOfferedQuery).length >= 2
    ? exchangeItemSuggestions(draftOfferedQuery, ownedExchangeItems, catalogIps)
    : ownedExchangeItems;
  const selectedOfferedItem = ownedExchangeItems.find((item) => item.inventoryUnitId === draftOfferedInventoryUnitId);
  const eligibleExchangePosts = exchangePosts.filter((post) => post.sourceType === "GACHA");
  const visiblePosts = filter === "전체"
    ? eligibleExchangePosts
    : eligibleExchangePosts.filter((post) => categoryLabel(post.categoryId) === filter);

  useEffect(() => {
    if (!isAuthenticated || !exchangeComposerRequested) return;
    setExchangeComposerRequested(false);
    setComposerOpen(true);
  }, [exchangeComposerRequested, isAuthenticated, setExchangeComposerRequested]);

  const requestExchangeAccess = (intent: AuthIntent) => {
    if (isAuthenticated) {
      if (intent.kind === "exchange-post") flow.push(createExchangeDetailScreen(intent.postId));
      else setComposerOpen(true);
      return;
    }

    keyboard.hide();
    setAuthIntent(intent);
  };

  const submitPost = async () => {
    const title = draftTitle.trim();
    const body = draftBody.trim();
    if (!title || !selectedOfferedItem || !body || submittingListing) return;
    const fingerprint = JSON.stringify([
      title,
      body,
      selectedOfferedItem.inventoryUnitId ?? selectedOfferedItem.id,
    ]);
    const pending = pendingListingKeyRef.current?.fingerprint === fingerprint
      ? pendingListingKeyRef.current
      : { fingerprint, key: createSessionId("exchange-listing") };
    pendingListingKeyRef.current = pending;
    setSubmittingListing(true);
    const result = await addExchangePost({
      categoryId: selectedOfferedItem.categoryId,
      ipId: selectedOfferedItem.ipId,
      title,
      offeredInventoryUnitId: selectedOfferedItem.inventoryUnitId ?? selectedOfferedItem.id,
      offeredCatalogItemId: selectedOfferedItem.catalogItemId,
      offeredItem: selectedOfferedItem.name,
      offeredItemImage: selectedOfferedItem.image,
      appReferenceValue: selectedOfferedItem.estimatedPrice,
      sourceType: "GACHA",
      body,
    }, pending.key);
    setSubmittingListing(false);
    if (!result.ok) {
      setComposerStatus(result.message);
      return;
    }
    pendingListingKeyRef.current = null;
    keyboard.hide();
    setDraftTitle("");
    setDraftOfferedQuery("");
    setDraftOfferedInventoryUnitId("");
    setDraftBody("");
    setTitleSuggestionsOpen(false);
    setOfferedSuggestionsOpen(false);
    setComposerStatus("");
    setFilter("전체");
    setComposerOpen(false);
  };

  const chooseOfferedItem = (item: ExchangeSelectableItem) => {
    setDraftOfferedQuery(item.name);
    setDraftOfferedInventoryUnitId(item.inventoryUnitId ?? item.id);
    setDraftCategoryId(item.categoryId);
    setDraftIpId(item.ipId);
    setOfferedSuggestionsOpen(false);
    if (!draftTitle.trim()) setDraftTitle(`${item.name} 교환 제안 받아요`);
  };

  const clearOfferedSelection = () => {
    setDraftOfferedQuery("");
    setDraftOfferedInventoryUnitId("");
    setOfferedSuggestionsOpen(false);
  };

  const handleComposerOpenChange = (open: boolean) => {
    if (!open) keyboard.hide();
    setComposerOpen(open);
  };

  return (
    <>
      <NativeBridgeController rootScreenId="root-community" />
      <MobileScroll className="app-screen dabboba-screen">
        <main ref={screenFocusRef} tabIndex={-1} className="root-tab-page exchange-page" aria-label="교환방 목록">
          <button
            type="button"
            className="exchange-composer-callout"
            onClick={() => requestExchangeAccess({ kind: "exchange-compose" })}
          >
            <span className="exchange-composer-icon"><IconPencilLine size={21} aria-hidden="true" /></span>
            <span><strong>교환 상품 올리기</strong><small>내 상품을 공개하고 다른 사용자의 제안을 받아보세요.</small></span>
            <IconChevronRightLine size={21} aria-hidden="true" />
          </button>

          <Carousel className="exchange-filter-carousel" contentClassName="exchange-filter-rail" ariaLabel="교환 상품 카테고리">
            {EXCHANGE_FILTERS.map((category) => (
              <button
                key={category}
                type="button"
                className="filter-chip"
                data-selected={filter === category ? "true" : "false"}
                aria-pressed={filter === category}
                onClick={() => setFilter(category)}
              >
                {category}
              </button>
            ))}
          </Carousel>

          <section className="exchange-feed" aria-labelledby="exchange-feed-title">
            <div className="section-heading">
              <h1 id="exchange-feed-title">교환을 기다리고 있어요</h1>
              <span>{visiblePosts.length}개</span>
            </div>
            {visiblePosts.map((post) => {
              const ip = catalogIps.find((item) => item.id === post.ipId);
              const applicationCount = exchangeApplicationCount(post, exchangeApplications[post.id] ?? []);
              return (
                <article key={post.id} className="exchange-post">
                  <div className="exchange-post-summary">
                    <div className="exchange-post-meta">
                      <span>{post.authorId === currentUserId ? "내 글" : categoryLabel(post.categoryId)}</span>
                      <small>{post.author} · {post.time}</small>
                    </div>
                    <h2>{post.title}</h2>
                    <div className="exchange-listing-product" aria-label={`교환할 상품 ${post.offeredItem}, ${APP_REFERENCE_VALUE_NOTICE} ${exchangePriceLabel(post.appReferenceValue)}`}>
                      {post.offeredItemImage ? <img src={post.offeredItemImage} alt="" loading="eager" decoding="sync" draggable={false} /> : null}
                      <span>
                        <small>교환할 상품</small>
                        <strong>{post.offeredItem}</strong>
                        <em>{ip?.nameKo ?? "작품 미지정"} · {categoryLabel(post.categoryId)}</em>
                      </span>
                      <b>{exchangePriceLabel(post.appReferenceValue)}<small>{APP_REFERENCE_VALUE_NOTICE}</small></b>
                    </div>
                    <p>{post.body}</p>
                    <button
                      type="button"
                      className="exchange-post-open"
                      aria-label={`${post.title} 교환 상세 보기`}
                      onClick={() => requestExchangeAccess({ kind: "exchange-post", postId: post.id })}
                    />
                  </div>
                  <div className="exchange-post-actions" aria-label={`${post.title} 교환 현황`}>
                    <span>자유롭게 상품을 제안할 수 있어요</span>
                    <span><IconDot3HorizontalChatbubbleLeftLine size={18} aria-hidden="true" /> 교환 제안 {applicationCount}건</span>
                  </div>
                </article>
              );
            })}
          </section>
          <p className="prototype-disclosure exchange-disclosure" role={apiMode === "remote" ? "status" : undefined}>
            {apiMode === "remote"
              ? apiSyncState === "ready" ? "교환 글과 보유 상품은 서버 데이터입니다." : apiSyncMessage
              : "교환 글과 신청은 화면 확인용 테스트 데이터이며 새로고침하면 작성 내용이 초기화됩니다."}
          </p>
        </main>
      </MobileScroll>

      {!isAuthenticated && authIntent ? (
        <GuestAuthPrompt
          intent={authIntent}
          onDismiss={() => setAuthIntent(null)}
          onLogin={() => flow.push(createLoginScreen())}
        />
      ) : null}

      <BottomSheet
        open={composerOpen}
        onOpenChange={handleComposerOpenChange}
        title="교환 상품 올리기"
        description="내 보유 상품을 공개하면 다른 사용자가 자기 상품으로 교환을 제안해요."
        snap={0.88}
      >
        <div className="exchange-compose-form">
          <div className="compose-category-list" role="radiogroup" aria-label="상품 카테고리">
            {CUSTOMER_VISIBLE_PRODUCT_CATEGORIES.map((category, index) => (
              <button
                key={category.id}
                type="button"
                role="radio"
                aria-checked={draftCategoryId === category.id}
                tabIndex={draftCategoryId === category.id ? 0 : -1}
                data-selected={draftCategoryId === category.id ? "true" : "false"}
                onKeyDown={(event) => handleRadioArrow(event, CUSTOMER_VISIBLE_PRODUCT_CATEGORIES, index, (nextCategory) => {
                  setDraftCategoryId(nextCategory.id);
                  clearOfferedSelection();
                })}
                onClick={() => {
                  setDraftCategoryId(category.id);
                  clearOfferedSelection();
                }}
              >
                {category.label}
              </button>
            ))}
          </div>
          <label>
            <span>작품 IP</span>
            <select value={draftIpId} onChange={(event) => {
              setDraftIpId(event.currentTarget.value);
              clearOfferedSelection();
            }}>
              {catalogIps.map((ip) => <option key={ip.id} value={ip.id}>{ip.nameKo}</option>)}
            </select>
          </label>
          <div className="exchange-autocomplete-field">
            <span>글 제목</span>
            <small>두 글자부터 등록 상품과 인기 검색어를 추천해요.</small>
            <KeyboardInput
              value={draftTitle}
              aria-label="글 제목"
              maxLength={48}
              placeholder="예: 포켓몬스터 피카츄"
              autoComplete="off"
              onFocus={() => setTitleSuggestionsOpen(true)}
              onChange={(event) => {
                setDraftTitle(event.currentTarget.value);
                setTitleSuggestionsOpen(true);
              }}
              onBlur={() => {
                setTitleSuggestionsOpen(false);
                keyboard.hide();
              }}
            />
            {titleSuggestionsOpen && normalizeCatalogSearch(draftTitle).length >= 2 ? (
              <ExchangeSuggestionList
                items={titleSuggestions}
                label="글 제목 등록 상품 추천"
                onSelect={(item) => {
                  setDraftTitle(`${item.name} 교환 제안 받아요`);
                  setTitleSuggestionsOpen(false);
                }}
              />
            ) : null}
          </div>
          <div className="exchange-autocomplete-field">
            <span>올릴 상품</span>
            <small>검색창을 열면 지금 교환 가능한 보유 상품 전체가 보여요.</small>
            <KeyboardInput
              value={draftOfferedQuery}
              aria-label="올릴 상품"
              maxLength={60}
              placeholder="내 보유 상품을 검색해 선택하세요"
              autoComplete="off"
              onFocus={() => setOfferedSuggestionsOpen(true)}
              onChange={(event) => {
                setDraftOfferedQuery(event.currentTarget.value);
                setDraftOfferedInventoryUnitId("");
                setOfferedSuggestionsOpen(true);
              }}
              onBlur={() => {
                setOfferedSuggestionsOpen(false);
                keyboard.hide();
              }}
            />
            {selectedOfferedItem ? (
              <ExchangeSelectedInventoryCard item={selectedOfferedItem} />
            ) : null}
            {offeredSuggestionsOpen ? (
              <ExchangeSuggestionList
                items={offeredSuggestions}
                label="내 보유 상품 추천"
                onSelect={chooseOfferedItem}
              />
            ) : null}
            {ownedExchangeItems.length === 0 ? (
              <span className="exchange-field-notice">배송 신청 또는 다른 교환에 사용 중이지 않은 보유 상품이 없어요.</span>
            ) : null}
          </div>
          <label>
            <span>상세 설명</span>
            <KeyboardTextarea
              value={draftBody}
              maxLength={500}
              placeholder="상품 상태와 가능한 교환 방법을 적어주세요. 원하는 상품은 다른 사용자가 자유롭게 제안합니다."
              onChange={(event) => setDraftBody(event.currentTarget.value)}
              onBlur={() => keyboard.hide()}
            />
          </label>
          <ActionButton
            type="button"
            variant="brandSolid"
            size="large"
            className="sheet-primary-button"
            disabled={submittingListing || !draftTitle.trim() || !selectedOfferedItem || !draftBody.trim()}
            aria-busy={submittingListing}
            onPointerDown={(event) => event.preventDefault()}
            onClick={submitPost}
          >
            {submittingListing ? "등록 중..." : "교환 글 등록하기"}
          </ActionButton>
          {composerStatus ? <span className="exchange-field-notice" role="status">{composerStatus}</span> : null}
        </div>
      </BottomSheet>
    </>
  );
}

function GuestAuthPrompt({
  intent,
  onDismiss,
  onLogin,
}: {
  intent: AuthIntent;
  onDismiss: () => void;
  onLogin: () => void;
}) {
  const description = intent.kind === "exchange-compose"
    ? "교환 상품을 올리려면 로그인해 주세요."
    : intent.kind === "exchange-post"
      ? "교환 상세와 제안을 보려면 로그인해 주세요."
      : intent.kind === "request-compose"
        ? "원하는 상품을 신청하려면 로그인해 주세요."
        : intent.kind === "catalog-request"
          ? "새 상품이나 작품 IP를 관리자에게 요청하려면 로그인해 주세요."
          : intent.kind === "community-compose"
            ? "덕룸에 수집 글을 올리려면 로그인해 주세요."
            : intent.kind === "community-like"
              ? "덕룸 게시물에 좋아요를 남기려면 로그인해 주세요."
              : intent.kind === "community-comment"
                ? "덕룸 게시물에 댓글을 남기려면 로그인해 주세요."
                : intent.kind === "community-block"
                  ? "덕룸 작성자를 차단하려면 로그인해 주세요."
                  : intent.kind === "community-report"
                    ? "덕룸 게시물을 신고하려면 로그인해 주세요."
                    : "신청에 좋아요를 남기려면 로그인해 주세요.";

  return (
    <aside
      className="guest-auth-prompt"
      role="dialog"
      aria-live="polite"
      aria-labelledby="guest-auth-title"
      aria-describedby="guest-auth-description"
    >
      <div className="guest-auth-prompt-copy">
        <span aria-hidden="true"><IconLockLine size={20} /></span>
        <div>
          <strong id="guest-auth-title">로그인이 필요합니다</strong>
          <p id="guest-auth-description">{description}</p>
        </div>
        <button type="button" className="guest-auth-dismiss" onClick={onDismiss} aria-label="로그인 안내 닫기">
          <IconXmarkLine size={20} aria-hidden="true" />
        </button>
      </div>
      <ActionButton type="button" variant="brandSolid" size="large" className="guest-auth-login-button" onClick={onLogin}>
        로그인
      </ActionButton>
    </aside>
  );
}

function LoginPage({ flow }: { flow: FlowControls }) {
  const {
    authIntent,
    setAuthIntent,
    setIsAuthenticated,
    setExchangeComposerRequested,
    setRequestComposerRequested,
    setCatalogRequestComposerRequested,
    setCommunityComposerRequested,
    setCommunityReportRequested,
    toggleProductRequestLike,
    toggleCommunityPostLike,
    blockCommunityUser,
    createDevelopmentSession,
    apiMode,
  } = useDabboba();
  const keyboard = useKeyboard();
  const screenFocusRef = useScreenEntryFocus();
  const timer = useRef<number | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginStatus, setLoginStatus] = useState("");
  const [developmentEmail, setDevelopmentEmail] = useState("preview@dabboba.local");
  const intentCopy = authIntent?.kind === "exchange-compose"
    ? "로그인하면 교환 글 작성으로 바로 이어집니다."
    : authIntent?.kind === "exchange-post"
      ? "로그인하면 선택한 교환 상세로 바로 이동합니다."
      : authIntent?.kind === "request-compose"
        ? "로그인하면 원하는 상품 신청으로 바로 이어집니다."
        : authIntent?.kind === "catalog-request"
          ? "로그인하면 관리자 카탈로그 추가 요청으로 바로 이어집니다."
          : authIntent?.kind === "community-compose"
            ? "로그인하면 덕룸 글 작성으로 바로 이어집니다."
            : authIntent?.kind === "community-like"
              ? "로그인하면 선택한 덕룸 좋아요가 반영됩니다."
              : authIntent?.kind === "community-comment"
                ? "로그인하면 작성 중인 덕룸 댓글로 돌아갑니다."
                : authIntent?.kind === "community-block"
                  ? "로그인하면 선택한 덕룸 작성자를 차단합니다."
                  : authIntent?.kind === "community-report"
                    ? "로그인하면 선택한 덕룸 게시물 신고로 바로 이어집니다."
                    : "로그인하면 선택한 신청에 좋아요가 반영됩니다.";

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const returnToGuest = () => {
    if (loggingIn) return;
    setAuthIntent(null);
    flow.pop();
  };

  const continueAfterLogin = (completedIntent: AuthIntent | null) => {
      setIsAuthenticated(true);
      setAuthIntent(null);
      setLoggingIn(false);
      timer.current = null;

      if (completedIntent?.kind === "exchange-post") {
        flow.replace(createExchangeDetailScreen(completedIntent.postId));
        return;
      }

      flow.pop();
      if (completedIntent?.kind === "exchange-compose") {
        window.setTimeout(() => setExchangeComposerRequested(true), 260);
      } else if (completedIntent?.kind === "request-compose") {
        window.setTimeout(() => setRequestComposerRequested(true), 260);
      } else if (completedIntent?.kind === "catalog-request") {
        window.setTimeout(() => setCatalogRequestComposerRequested(true), 260);
      } else if (completedIntent?.kind === "community-compose") {
        window.setTimeout(() => setCommunityComposerRequested(true), 260);
      } else if (completedIntent?.kind === "community-report") {
        window.setTimeout(() => setCommunityReportRequested({
          postId: completedIntent.postId,
          targetType: completedIntent.targetType,
        }), 260);
      } else if (completedIntent?.kind === "request-like") {
        void toggleProductRequestLike(completedIntent.requestId);
      } else if (completedIntent?.kind === "community-like") {
        void toggleCommunityPostLike(completedIntent.postId, true);
      } else if (completedIntent?.kind === "community-block") {
        void blockCommunityUser(completedIntent.userId);
      }
  };

  const completeLogin = async () => {
    if (loggingIn) return;
    setLoginStatus("");
    if (apiMode === "remote") {
      if (import.meta.env?.DEV !== true) {
        setLoginStatus("운영 사용자 로그인은 인증 제공자와 리디렉션 주소를 확정한 뒤 연결해야 합니다.");
        return;
      }
      const email = developmentEmail.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        setLoginStatus("개발 테스트에 사용할 이메일 형식을 확인해 주세요.");
        return;
      }
      keyboard.hide();
      setLoggingIn(true);
      const result = await createDevelopmentSession(email);
      setLoginStatus(result.message);
      if (!result.ok) {
        setLoggingIn(false);
        return;
      }
      continueAfterLogin(authIntent);
      return;
    }
    setLoggingIn(true);
    timer.current = window.setTimeout(() => continueAfterLogin(authIntent), 520);
  };

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="login-page" aria-label="DABBOBA 로그인">
        <section className="login-brand-panel">
          <DabbobaWordmark className="login-wordmark" />
          <h1>좋아하는 굿즈를<br />안전하게 이어보세요.</h1>
          <p>상품과 컬렉션은 로그인 없이 둘러볼 수 있어요.<br />교환과 상품 신청을 시작할 때만 로그인이 필요합니다.</p>
        </section>

        <section className="login-action-panel" aria-label="로그인 선택">
          <div className="login-intent-note">
            <IconLockLine size={19} aria-hidden="true" />
            <span>{intentCopy}</span>
          </div>
          {apiMode === "remote" && import.meta.env?.DEV === true ? (
            <label className="login-dev-field">
              <span>개발 테스트 이메일</span>
              <KeyboardInput
                type="email"
                value={developmentEmail}
                maxLength={254}
                autoComplete="email"
                disabled={loggingIn}
                onChange={(event) => setDevelopmentEmail(event.currentTarget.value)}
                onBlur={() => keyboard.hide()}
              />
            </label>
          ) : null}
          <ActionButton
            type="button"
            variant="brandSolid"
            size="large"
            className="login-primary-button"
            disabled={loggingIn || (apiMode === "remote" && import.meta.env?.DEV !== true)}
            aria-busy={loggingIn}
            onClick={() => void completeLogin()}
          >
            {loggingIn ? "로그인 중..." : apiMode === "remote" && import.meta.env?.DEV === true ? "개발 서버 계정으로 로그인" : apiMode === "remote" ? "운영 로그인 준비 중" : "테스트 계정으로 로그인"}
          </ActionButton>
          <button type="button" className="login-guest-button" disabled={loggingIn} onClick={returnToGuest}>
            둘러보기로 돌아가기
          </button>
          <small role={loginStatus ? "status" : undefined}>
            {loginStatus || (apiMode === "remote"
              ? import.meta.env?.DEV === true
                ? "입력한 이메일로 로컬 개발용 세션을 만듭니다. 운영 빌드에서는 이 기능이 제거됩니다."
                : "운영 인증 제공자 연결 전에는 로그인할 수 없습니다."
              : "현재는 화면 흐름 확인용 로그인입니다. 실제 계정이나 개인정보는 사용하지 않습니다.")}
          </small>
        </section>
      </main>
    </MobileScroll>
  );
}

function ExchangeDetailPage({ postId }: { postId: string }) {
  const {
    currentUserId,
    exchangePosts,
    exchangeApplications,
    addExchangeApplication,
    loadExchangeListingDetail,
    decideExchangeApplication,
    cancelExchangeListing,
    withdrawExchangeApplication,
    confirmExchangeCompletion,
    sessionCommerce,
    catalogIps,
    apiMode,
  } = useDabboba();
  const keyboard = useKeyboard();
  const screenFocusRef = useScreenEntryFocus();
  const pendingOfferKeyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const pendingLifecycleKeysRef = useRef<Record<string, string>>({});
  const offerRequestInFlightRef = useRef(false);
  const lifecycleRequestInFlightRef = useRef(false);
  const [draftOfferedQuery, setDraftOfferedQuery] = useState("");
  const [draftOfferedInventoryUnitId, setDraftOfferedInventoryUnitId] = useState("");
  const [applicationSuggestionsOpen, setApplicationSuggestionsOpen] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");
  const [remoteDetail, setRemoteDetail] = useState<ApiExchangeListingDetail | null>(null);
  const [detailLoadMessage, setDetailLoadMessage] = useState("");
  const [detailLoading, setDetailLoading] = useState(apiMode === "remote");
  const [submittingOffer, setSubmittingOffer] = useState(false);
  const [busyLifecycleAction, setBusyLifecycleAction] = useState("");
  const ownedExchangeItems = useMemo(() => inventoryExchangeItems(
    eligibleDrawExchangeProposalUnits(sessionCommerce, currentUserId),
  ), [currentUserId, sessionCommerce]);

  const refreshRemoteDetail = useCallback(async (signal?: AbortSignal) => {
    const result = await loadExchangeListingDetail(postId, signal);
    if (signal?.aborted) return result;
    if (result.ok && result.data) {
      setRemoteDetail(result.data);
      setDetailLoadMessage("");
    } else {
      setDetailLoadMessage(result.message);
    }
    setDetailLoading(false);
    return result;
  }, [loadExchangeListingDetail, postId]);

  useEffect(() => {
    if (apiMode !== "remote") return;
    const controller = new AbortController();
    setRemoteDetail(null);
    setDetailLoading(true);
    setDetailLoadMessage("교환 상태와 내게 허용된 제안을 불러오는 중입니다.");
    void refreshRemoteDetail(controller.signal);
    return () => controller.abort();
  }, [apiMode, refreshRemoteDetail]);

  const snapshotPost = exchangePosts.find((item) => item.id === postId);
  const candidatePost = remoteDetail ? mapApiExchangeListing(remoteDetail) : snapshotPost;
  const post = candidatePost?.sourceType === "GACHA" ? candidatePost : undefined;

  if (!post) {
    return (
      <MobileScroll className="app-screen dabboba-screen">
        <main ref={screenFocusRef} tabIndex={-1} className="exchange-detail-page exchange-detail-missing" aria-label="교환 글을 찾을 수 없음">
          <IconDot3HorizontalChatbubbleLeftLine size={32} aria-hidden="true" />
          <h1>{apiMode === "remote" && detailLoading ? "교환 상세를 불러오는 중이에요." : "교환 글을 찾을 수 없어요."}</h1>
          <p>{detailLoadMessage || "새로고침으로 임시 교환 글이 초기화됐을 수 있습니다."}</p>
        </main>
      </MobileScroll>
    );
  }

  const applications = (exchangeApplications[post.id] ?? []).filter((application) => (
    application.sourceType === "GACHA"
  ));
  const applicationCount = exchangeApplicationCount(post, applications);
  const ip = catalogIps.find((item) => item.id === post.ipId);
  const isOwnPost = post.authorId === currentUserId;
  const listingStatus = remoteDetail?.status ?? post.lifecycleStatus ?? "OPEN";
  const acceptedApplication = applications.find((application) => application.id === (
    remoteDetail?.acceptedOfferId ?? post.acceptedOfferId
  ));
  const isAcceptedProposer = acceptedApplication?.authorId === currentUserId;
  const isCompletionParticipant = isOwnPost || isAcceptedProposer;
  const hasConfirmedCompletion = isOwnPost
    ? Boolean(remoteDetail?.authorConfirmedAt ?? post.authorConfirmedAt)
    : Boolean(remoteDetail?.proposerConfirmedAt ?? post.proposerConfirmedAt);
  const selectedApplicationItem = ownedExchangeItems.find((item) => item.inventoryUnitId === draftOfferedInventoryUnitId);
  const eligibleApplicationItems = ownedExchangeItems.filter((item) => item.inventoryUnitId !== post.offeredInventoryUnitId);
  const applicationSuggestions = normalizeCatalogSearch(draftOfferedQuery).length >= 2
    ? exchangeItemSuggestions(draftOfferedQuery, eligibleApplicationItems, catalogIps)
    : eligibleApplicationItems;

  const submitApplication = async () => {
    if (!selectedApplicationItem || isOwnPost || submittingOffer || offerRequestInFlightRef.current || listingStatus !== "OPEN") return;
    const fingerprint = JSON.stringify([
      post.id,
      selectedApplicationItem.inventoryUnitId ?? selectedApplicationItem.id,
    ]);
    const pending = pendingOfferKeyRef.current?.fingerprint === fingerprint
      ? pendingOfferKeyRef.current
      : { fingerprint, key: createSessionId("exchange-offer") };
    pendingOfferKeyRef.current = pending;
    offerRequestInFlightRef.current = true;
    setSubmittingOffer(true);
    const result = await addExchangeApplication(post.id, {
      offeredInventoryUnitId: selectedApplicationItem.inventoryUnitId ?? selectedApplicationItem.id,
      offeredCatalogItemId: selectedApplicationItem.catalogItemId,
      ipId: selectedApplicationItem.ipId,
      categoryId: selectedApplicationItem.categoryId,
      offeredItem: selectedApplicationItem.name,
      offeredItemImage: selectedApplicationItem.image,
      appReferenceValue: selectedApplicationItem.estimatedPrice,
      sourceType: "GACHA",
    }, pending.key);
    offerRequestInFlightRef.current = false;
    setSubmittingOffer(false);
    if (!result.ok) {
      setSubmitMessage(result.message);
      return;
    }
    pendingOfferKeyRef.current = null;
    keyboard.hide();
    setDraftOfferedQuery("");
    setDraftOfferedInventoryUnitId("");
    setApplicationSuggestionsOpen(false);
    setSubmitMessage(result.message);
    if (apiMode === "remote") void refreshRemoteDetail();
  };

  const lifecycleKey = (action: string) => {
    const existing = pendingLifecycleKeysRef.current[action];
    if (existing) return existing;
    const created = createSessionId(`exchange-${action}`);
    pendingLifecycleKeysRef.current[action] = created;
    return created;
  };

  const finishLifecycleAction = async (
    action: string,
    request: (key: string) => Promise<UserMutationResult<unknown>>,
  ) => {
    if (busyLifecycleAction || lifecycleRequestInFlightRef.current) return;
    lifecycleRequestInFlightRef.current = true;
    setBusyLifecycleAction(action);
    setSubmitMessage("");
    const result = await request(lifecycleKey(action));
    lifecycleRequestInFlightRef.current = false;
    setBusyLifecycleAction("");
    setSubmitMessage(result.message);
    if (!result.ok) return;
    delete pendingLifecycleKeysRef.current[action];
    if (apiMode === "remote") await refreshRemoteDetail();
  };

  const handleDecision = async (
    applicationId: string,
    decision: ExchangeApplicationDecision,
  ) => {
    const action = `decision-${applicationId}-${decision}`;
    await finishLifecycleAction(action, (key) => (
      decideExchangeApplication(post.id, applicationId, decision, key)
    ));
  };

  const handleCancelListing = async () => {
    if (apiMode !== "remote" || listingStatus !== "OPEN" || !isOwnPost) return;
    keyboard.hide();
    if (!window.confirm("교환 글을 취소하면 내 상품과 대기 중인 제안 상품의 예약이 해제됩니다. 취소할까요?")) return;
    await finishLifecycleAction("cancel-listing", (key) => cancelExchangeListing(post.id, key));
  };

  const handleWithdrawOffer = async (applicationId: string) => {
    if (apiMode !== "remote" || listingStatus !== "OPEN") return;
    await finishLifecycleAction(`withdraw-${applicationId}`, (key) => (
      withdrawExchangeApplication(post.id, applicationId, key)
    ));
  };

  const handleCompletionConfirmation = async () => {
    if (apiMode !== "remote" || listingStatus !== "MATCHED" || !isCompletionParticipant || hasConfirmedCompletion) return;
    keyboard.hide();
    if (!window.confirm("서로 상품을 확인했나요? 양쪽이 모두 확인하면 서버에서 상품 소유권 교환이 완료됩니다.")) return;
    await finishLifecycleAction("completion-confirmation", (key) => confirmExchangeCompletion(post.id, key));
  };

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="exchange-detail-page" aria-label={`${post.title} 교환 상세`}>
        <article className="exchange-detail-article">
          <div className="exchange-detail-meta">
            <span>{categoryLabel(post.categoryId)} · {ip?.nameKo ?? "작품 미지정"}</span>
            <small>{post.time}</small>
          </div>

          <div className="exchange-detail-author">
            <span aria-hidden="true"><IconPerson2Line size={20} /></span>
            <div><strong>{post.author}</strong><small>DABBOBA 교환방</small></div>
          </div>

          <h1>{post.title}</h1>
          <div className="exchange-detail-product" aria-label={`교환할 상품 ${post.offeredItem}, ${APP_REFERENCE_VALUE_NOTICE} ${exchangePriceLabel(post.appReferenceValue)}`}>
            {post.offeredItemImage ? <img src={post.offeredItemImage} alt="" loading="eager" decoding="sync" draggable={false} /> : null}
            <div>
              <small>교환할 상품</small>
              <strong>{post.offeredItem}</strong>
              <span>{ip?.nameKo ?? "작품 미지정"} · {categoryLabel(post.categoryId)}</span>
            </div>
            <b>{exchangePriceLabel(post.appReferenceValue)}<small>{APP_REFERENCE_VALUE_NOTICE}</small></b>
          </div>
          <p>{post.body}</p>

          <div className="exchange-detail-actions" aria-label="교환 제안 현황">
            <span><IconDot3HorizontalChatbubbleLeftLine size={19} aria-hidden="true" /> 교환 제안 {applicationCount}건</span>
            <span>{exchangeListingStatusLabel(listingStatus)}</span>
          </div>
        </article>

        {detailLoadMessage && post ? (
          <p className="exchange-application-status" role="status">{detailLoadMessage}</p>
        ) : null}

        {apiMode === "remote" && remoteDetail ? (
          <section className="exchange-lifecycle-panel" aria-labelledby="exchange-lifecycle-title">
            <div>
              <span>EXCHANGE STATUS</span>
              <h2 id="exchange-lifecycle-title">{exchangeListingStatusLabel(listingStatus)}</h2>
              <p>
                {listingStatus === "OPEN"
                  ? isOwnPost
                    ? "작성자는 대기 중인 제안을 결정하거나 글을 취소할 수 있어요."
                    : "내 보유 상품으로 제안하고, 결정 전에는 내 제안을 철회할 수 있어요."
                  : listingStatus === "MATCHED"
                    ? "수락된 두 당사자가 모두 완료를 확인하면 서버가 상품 소유권을 교환합니다. 매칭 후 취소는 운영자 확인이 필요해요."
                    : listingStatus === "COMPLETED"
                      ? "양쪽 완료 확인 또는 운영자 조정으로 서버 소유권 교환이 확정됐습니다."
                      : "이 교환은 더 이상 진행할 수 없습니다."}
              </p>
            </div>
            {isOwnPost && listingStatus === "OPEN" ? (
              <button
                type="button"
                data-tone="danger"
                disabled={Boolean(busyLifecycleAction)}
                onClick={() => { void handleCancelListing(); }}
              >
                {busyLifecycleAction === "cancel-listing" ? "취소 처리 중..." : "교환 글 취소"}
              </button>
            ) : null}
            {listingStatus === "MATCHED" && isCompletionParticipant ? (
              <button
                type="button"
                data-tone="confirm"
                disabled={hasConfirmedCompletion || Boolean(busyLifecycleAction)}
                onClick={() => { void handleCompletionConfirmation(); }}
              >
                {hasConfirmedCompletion
                  ? "내 완료 확인 저장됨"
                  : busyLifecycleAction === "completion-confirmation"
                    ? "확인 저장 중..."
                    : "교환 완료 확인"}
              </button>
            ) : null}
          </section>
        ) : null}

        <section className="exchange-application-section" aria-labelledby="exchange-application-title">
          <div className="exchange-application-heading">
            <h2 id="exchange-application-title">
              {apiMode === "remote" ? isOwnPost ? "받은 교환 제안" : "내 교환 제안" : "교환 제안"} {applications.length}
            </h2>
            <span>{apiMode === "remote" ? isOwnPost ? "작성자에게 허용된 전체 제안" : "내 계정이 보낸 제안만 표시" : "제안 상품을 확인해 보세요"}</span>
          </div>

          <div className="exchange-application-list">
            {applications.length > 0 ? applications.map((application) => {
              const applicationIp = catalogIps.find((candidate) => candidate.id === application.ipId);
              const prototypeStatus = sessionCommerce.exchangeApplicationDecisions[
                exchangeDecisionKey(post.id, application.id)
              ] ?? "pending";
              const status = apiMode === "remote"
                ? application.status ?? "PENDING"
                : prototypeStatus === "accepted" ? "ACCEPTED" : prototypeStatus === "rejected" ? "REJECTED" : "PENDING";
              const isOwnApplication = application.authorId === currentUserId;
              return (
                <article key={application.id} className="exchange-application" data-status={status.toLowerCase()}>
                  <header>
                    <span className="exchange-application-avatar" aria-hidden="true">{application.author.slice(0, 1)}</span>
                    <strong>{application.author}</strong>
                    <small>{application.time} · {exchangeOfferStatusLabel(status)}</small>
                  </header>
                  <div className="exchange-application-product">
                    {application.offeredItemImage ? <img src={application.offeredItemImage} alt="" loading="eager" decoding="sync" draggable={false} /> : null}
                    <span>
                      <small>교환 제안 상품</small>
                      <strong>{application.offeredItem}</strong>
                      <em>{applicationIp?.nameKo ?? "작품 미지정"} · {categoryLabel(application.categoryId)}</em>
                    </span>
                    <b>{exchangePriceLabel(application.appReferenceValue)}<small>{APP_REFERENCE_VALUE_NOTICE}</small></b>
                  </div>
                  {isOwnPost && listingStatus === "OPEN" ? (
                    <div className="exchange-application-controls" aria-label={`${application.author}의 교환 제안 처리`}>
                      <button
                        type="button"
                        data-decision="rejected"
                        aria-pressed={status === "REJECTED"}
                        disabled={status !== "PENDING" || Boolean(busyLifecycleAction)}
                        onClick={() => {
                          void handleDecision(application.id, "rejected");
                        }}
                      >
                        {status === "REJECTED" ? "거절됨" : "거절하기"}
                      </button>
                      <button
                        type="button"
                        data-decision="accepted"
                        aria-pressed={status === "ACCEPTED"}
                        disabled={status !== "PENDING" || Boolean(busyLifecycleAction)}
                        onClick={() => {
                          void handleDecision(application.id, "accepted");
                        }}
                      >
                        {status === "ACCEPTED" ? "수락됨" : "수락하기"}
                      </button>
                    </div>
                  ) : apiMode === "remote" && isOwnApplication && listingStatus === "OPEN" && status === "PENDING" ? (
                    <div className="exchange-application-controls exchange-application-withdraw" aria-label="내 교환 제안 철회">
                      <button
                        type="button"
                        data-decision="withdrawn"
                        disabled={Boolean(busyLifecycleAction)}
                        onClick={() => { void handleWithdrawOffer(application.id); }}
                      >
                        {busyLifecycleAction === `withdraw-${application.id}` ? "철회 처리 중..." : "교환 제안 철회"}
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            }) : apiMode === "remote" ? (
              <div className="exchange-application-empty">
                <IconDot3HorizontalChatbubbleLeftLine size={28} aria-hidden="true" />
                <strong>{detailLoading || detailLoadMessage
                  ? detailLoading ? "교환 제안을 불러오는 중이에요." : "교환 제안을 확인하지 못했어요."
                  : isOwnPost ? "아직 받은 교환 제안이 없어요." : "내가 보낸 교환 제안이 없어요."}</strong>
                <span>{detailLoading || detailLoadMessage
                  ? detailLoadMessage
                  : isOwnPost ? "새 제안이 접수되면 이곳에서 결정할 수 있어요." : "서버는 다른 사용자의 제안 내용을 공개하지 않습니다."}</span>
              </div>
            ) : (
              <div className="exchange-application-empty">
                <IconDot3HorizontalChatbubbleLeftLine size={28} aria-hidden="true" />
                <strong>아직 교환 제안이 없어요.</strong>
                <span>내 상품으로 첫 교환을 제안해 보세요.</span>
              </div>
            )}
          </div>

          {apiMode === "remote" && !isOwnPost && applicationCount > applications.length ? (
            <p className="exchange-application-disclosure">
              전체 제안 {applicationCount}건 중 현재 계정이 보낸 {applications.length}건만 서버 권한에 따라 표시합니다.
            </p>
          ) : apiMode !== "remote" && applicationCount > applications.length ? (
            <p className="exchange-application-disclosure">현재 화면에는 확인용 예시 신청 일부만 표시됩니다.</p>
          ) : null}

          {isOwnPost ? (
            <p className="exchange-owner-notice" role="status">
              {apiMode === "remote"
                ? listingStatus === "OPEN"
                  ? "서버가 작성자 권한으로 허용한 전체 제안입니다. 대기 중인 제안만 수락하거나 거절할 수 있어요."
                  : "교환 상태가 확정되어 새 제안 결정은 잠겼습니다."
                : "내가 올린 상품입니다. 들어온 제안을 비교해 수락하거나 거절해 주세요."}
            </p>
          ) : listingStatus === "OPEN" && (apiMode !== "remote" || Boolean(remoteDetail)) ? (
            <form className="exchange-application-form" onSubmit={(event) => { event.preventDefault(); submitApplication(); }}>
              <div className="exchange-application-product-picker">
                <label htmlFor="exchange-offered-item">내가 제안할 상품</label>
                <small>내가 가챠·쿠지에서 직접 뽑아 보관 중인 상품만 선택할 수 있어요.</small>
                <KeyboardInput
                  id="exchange-offered-item"
                  value={draftOfferedQuery}
                  maxLength={60}
                  autoComplete="off"
                  placeholder="내 보유 상품을 검색하세요"
                  onFocus={() => setApplicationSuggestionsOpen(true)}
                  onChange={(event) => {
                    setDraftOfferedQuery(event.currentTarget.value);
                    setDraftOfferedInventoryUnitId("");
                    setApplicationSuggestionsOpen(true);
                    setSubmitMessage("");
                  }}
                  onBlur={() => {
                    setApplicationSuggestionsOpen(false);
                    keyboard.hide();
                  }}
                />
                {selectedApplicationItem ? <ExchangeSelectedInventoryCard item={selectedApplicationItem} /> : null}
                {applicationSuggestionsOpen ? (
                  <ExchangeSuggestionList
                    items={applicationSuggestions}
                    label="교환 제안 보유 상품 추천"
                    onSelect={(item) => {
                      setDraftOfferedQuery(item.name);
                      setDraftOfferedInventoryUnitId(item.inventoryUnitId ?? item.id);
                      setApplicationSuggestionsOpen(false);
                    }}
                  />
                ) : null}
              </div>
              <div>
                <small>별도 글 없이 선택한 상품 정보만 전달됩니다.</small>
                <ActionButton
                  type="submit"
                  variant="brandSolid"
                  size="medium"
                  disabled={submittingOffer || !selectedApplicationItem}
                  aria-busy={submittingOffer}
                  onPointerDown={(event) => event.preventDefault()}
                >
                  {submittingOffer ? "제안 접수 중..." : "이 상품으로 교환 제안하기"}
                </ActionButton>
              </div>
            </form>
          ) : listingStatus === "OPEN" ? (
            <p className="exchange-owner-notice" role="status">{detailLoadMessage || "서버 교환 상세를 확인한 뒤 제안할 수 있습니다."}</p>
          ) : (
            <p className="exchange-owner-notice" role="status">
              {listingStatus === "MATCHED"
                ? isAcceptedProposer
                  ? "내 제안이 수락됐습니다. 상품을 주고받은 뒤 양쪽 모두 완료를 확인해 주세요."
                  : "다른 제안과 매칭되어 새 제안을 보낼 수 없습니다."
                : `현재 상태는 ${exchangeListingStatusLabel(listingStatus)}이며 새 제안을 보낼 수 없습니다.`}
            </p>
          )}
          {submitMessage ? <p className="exchange-application-status" role="status">{submitMessage}</p> : null}
        </section>

        <p className="prototype-disclosure exchange-detail-disclosure">
          {apiMode === "remote"
            ? "교환 상세·권한별 제안·수락·거절·철회·글 취소·상호 완료 확인은 서버 상태와 동기화됩니다. 매칭 이후 취소는 운영자 확인이 필요합니다."
            : "교환 글과 신청은 화면 확인용 테스트 데이터이며 새로고침하면 작성 내용이 초기화됩니다."}
        </p>
      </main>
    </MobileScroll>
  );
}

function ShopPage({ flow }: { flow: FlowControls }) {
  const { catalogProducts, catalogIps } = useDabboba();
  const [filter, setFilter] = useState<CategoryFilter>("전체");
  const [query, setQuery] = useState("");
  const keyboard = useKeyboard();
  const screenFocusRef = useScreenEntryFocus();
  const isFigureComingSoon = filter === "피규어";
  const normalizedQuery = normalizeCatalogSearch(query);
  const productSearchIndex = useMemo(() => new Map(catalogProducts.map((product) => {
    const ip = catalogIps.find((candidate) => candidate.id === product.ipId);
    return [product.id, normalizeCatalogSearch([
      product.title,
      product.line,
      product.description,
      ip?.nameKo,
      ip?.nameEn,
      ip?.nameJa,
      ...(ip?.aliases ?? []),
    ].filter(Boolean).join(" "))] as const;
  })), [catalogIps, catalogProducts]);
  const visibleProducts = useMemo(() => catalogProducts.filter((product) => (
    isCustomerBrowsableProductCategory(product.categoryId) &&
    (filter === "전체" || product.category === filter) &&
    (!normalizedQuery || productSearchIndex.get(product.id)?.includes(normalizedQuery))
  )), [catalogProducts, filter, normalizedQuery, productSearchIndex]);

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <NativeBridgeController rootScreenId="root-shop" />
      <main ref={screenFocusRef} tabIndex={-1} className="root-tab-page shop-page" aria-label="DABBOBA 뽀바">
        <section className="shop-lead" aria-labelledby="shop-lead-title">
          <h1 id="shop-lead-title">원하는 방식으로 골라보세요.</h1>
          <p>가챠와 쿠지를 만나고, 준비 중인 피규어도 확인해 보세요.</p>
        </section>
        <div className="shop-search-box ip-search-box">
          <IconMagnifyingglassLine size={21} aria-hidden="true" />
          <KeyboardInput
            type="search"
            value={query}
            placeholder="상품명·작품 IP 검색"
            aria-label="뽀바 상품 검색"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onBlur={() => keyboard.hide()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setQuery("");
                keyboard.hide();
              }
            }}
          />
          {query ? (
            <button type="button" className="ip-search-clear" onClick={() => setQuery("")} aria-label="상품 검색어 지우기">
              <IconXmarkLine size={19} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <Carousel className="category-carousel shop-category-carousel" contentClassName="category-rail" ariaLabel="뽀바 카테고리">
          {filters.map((item) => (
            <button
              key={item}
              type="button"
              className="filter-chip"
              data-selected={item === filter ? "true" : "false"}
              aria-pressed={item === filter}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
        </Carousel>
        <section className="shop-products" aria-labelledby="shop-products-title">
          <div className="section-heading">
            <h2 id="shop-products-title">상품</h2>
            <span aria-live="polite">{visibleProducts.length}개</span>
          </div>
          {visibleProducts.length > 0 ? (
            <ProductGrid flow={flow} items={visibleProducts} />
          ) : (
            <div className="ip-empty-state shop-empty-state" role="status">
              <IconMagnifyingglassLine size={30} aria-hidden="true" />
              <strong>{isFigureComingSoon ? "준비중입니다." : "찾는 상품이 없어요"}</strong>
              <span>{isFigureComingSoon ? "피규어 상품은 준비가 끝나는 대로 공개할게요." : "검색어나 카테고리를 바꿔보세요."}</span>
            </div>
          )}
        </section>
      </main>
    </MobileScroll>
  );
}

const COMMUNITY_REPORT_REASONS: ReadonlyArray<{ value: ApiReportReason; label: string }> = [
  { value: "ABUSE", label: "욕설·괴롭힘" },
  { value: "ADVERTISING", label: "광고·홍보" },
  { value: "SPAM", label: "도배·스팸" },
  { value: "INAPPROPRIATE", label: "부적절한 콘텐츠" },
  { value: "SUSPECTED_FRAUD", label: "사기 의심" },
  { value: "COPYRIGHT", label: "저작권 침해" },
  { value: "OTHER", label: "기타" },
];

const COMMUNITY_POST_KINDS: ReadonlyArray<{
  value: "DUKROOM" | "SNAP";
  label: string;
  description: string;
}> = [
  { value: "DUKROOM", label: "덕룸 기록", description: "수집 이야기와 진열 기록을 길게 남겨요." },
  { value: "SNAP", label: "스냅", description: "사진 중심의 짧은 순간을 공유해요." },
];

function DuckroomPage() {
  const {
    currentUserId,
    isAuthenticated,
    authIntent,
    setAuthIntent,
    communityComposerRequested,
    setCommunityComposerRequested,
    communityReportRequested,
    setCommunityReportRequested,
    duckroomShowcases,
    catalogProducts,
    catalogIps,
    submitCommunityPost,
    uploadMedia,
    toggleCommunityPostLike,
    deleteCommunityPost,
    blockCommunityUser,
    submitCommunityReport,
    apiMode,
  } = useDabboba();
  const flow = useFlow();
  const keyboard = useKeyboard();
  const screenFocusRef = useScreenEntryFocus();
  const pendingPostKeyRef = useRef<{
    fingerprint: string;
    key: string;
    mediaKey: string;
    mediaId?: string;
  } | null>(null);
  const pendingReportKeyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const pendingLikeKeysRef = useRef<Record<string, { liked: boolean; key: string }>>({});
  const pendingBlockKeyRef = useRef<{ userId: string; key: string } | null>(null);
  const pendingDeleteKeyRef = useRef<{ postId: string; key: string } | null>(null);
  const eligibleIps = useMemo(() => catalogIps.filter((ip) => (
    catalogProducts.some((product) => product.ipId === ip.id)
  )), [catalogIps, catalogProducts]);
  const [filter, setFilter] = useState<DuckroomFilter>("전체");
  const [composerOpen, setComposerOpen] = useState(false);
  const [draftKind, setDraftKind] = useState<"DUKROOM" | "SNAP">("DUKROOM");
  const [draftIpId, setDraftIpId] = useState(eligibleIps[0]?.id ?? "");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [draftMediaFile, setDraftMediaFile] = useState<File | null>(null);
  const [draftMediaPreview, setDraftMediaPreview] = useState("");
  const [postStatus, setPostStatus] = useState("");
  const [postSubmitting, setPostSubmitting] = useState(false);
  const [reportTarget, setReportTarget] = useState<UiDuckroomShowcase | null>(null);
  const [reportReason, setReportReason] = useState<ApiReportReason>("INAPPROPRIATE");
  const [reportDetails, setReportDetails] = useState("");
  const [reportStatus, setReportStatus] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [pendingLikePostIds, setPendingLikePostIds] = useState<Set<string>>(() => new Set());
  const [deleteTarget, setDeleteTarget] = useState<UiDuckroomShowcase | null>(null);
  const [deletingPost, setDeletingPost] = useState(false);
  const [blockingUser, setBlockingUser] = useState(false);
  const [reportedPostIds, setReportedPostIds] = useState<Set<string>>(() => new Set());
  const visibleShowcases = duckroomShowcases.filter((showcase) => (
    filter === "전체" || categoryLabel(showcase.categoryId) === filter
  ));
  const postValid = draftTitle.trim().length > 0 && draftContent.trim().length > 0;

  useEffect(() => {
    if (!draftIpId || eligibleIps.some((ip) => ip.id === draftIpId)) return;
    setDraftIpId(eligibleIps[0]?.id ?? "");
  }, [draftIpId, eligibleIps]);

  useEffect(() => {
    if (!draftMediaFile) {
      setDraftMediaPreview("");
      return;
    }
    const previewUrl = URL.createObjectURL(draftMediaFile);
    setDraftMediaPreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [draftMediaFile]);

  useEffect(() => {
    if (!isAuthenticated || !communityComposerRequested) return;
    setCommunityComposerRequested(false);
    setComposerOpen(true);
  }, [communityComposerRequested, isAuthenticated, setCommunityComposerRequested]);

  useEffect(() => {
    if (!isAuthenticated || !communityReportRequested) return;
    const target = duckroomShowcases.find((showcase) => showcase.id === communityReportRequested.postId);
    setCommunityReportRequested(null);
    if (target) setReportTarget(target);
    else setReportStatus("신고할 게시물을 찾을 수 없습니다.");
  }, [communityReportRequested, duckroomShowcases, isAuthenticated, setCommunityReportRequested]);

  const requestComposeAccess = () => {
    setPostStatus("");
    if (isAuthenticated) {
      setComposerOpen(true);
      return;
    }
    keyboard.hide();
    setAuthIntent({ kind: "community-compose" });
  };

  const requestReportAccess = (showcase: UiDuckroomShowcase) => {
    setReportStatus("");
    const targetType = showcase.kind === "SNAP" ? "SNAP" : "POST";
    if (isAuthenticated) {
      setReportTarget(showcase);
      return;
    }
    keyboard.hide();
    setAuthIntent({ kind: "community-report", postId: showcase.id, targetType });
  };

  const toggleShowcaseLike = async (showcase: UiDuckroomShowcase) => {
    if (pendingLikePostIds.has(showcase.id) || showcase.authorId === currentUserId) return;
    if (!isAuthenticated) {
      keyboard.hide();
      setAuthIntent({ kind: "community-like", postId: showcase.id });
      return;
    }
    const liked = !showcase.likedByViewer;
    const previous = pendingLikeKeysRef.current[showcase.id];
    const pending = previous?.liked === liked
      ? previous
      : { liked, key: createSessionId("community-like") };
    pendingLikeKeysRef.current[showcase.id] = pending;
    setPendingLikePostIds((current) => new Set(current).add(showcase.id));
    setPostStatus("");
    const result = await toggleCommunityPostLike(showcase.id, liked, pending.key);
    setPendingLikePostIds((current) => {
      const next = new Set(current);
      next.delete(showcase.id);
      return next;
    });
    setPostStatus(result.message);
    if (result.ok) delete pendingLikeKeysRef.current[showcase.id];
  };

  const confirmPostDeletion = async () => {
    if (!deleteTarget || deletingPost) return;
    const previous = pendingDeleteKeyRef.current;
    const pending = previous?.postId === deleteTarget.id
      ? previous
      : { postId: deleteTarget.id, key: createSessionId("community-delete") };
    pendingDeleteKeyRef.current = pending;
    setDeletingPost(true);
    setPostStatus("");
    const result = await deleteCommunityPost(deleteTarget.id, deleteTarget.version ?? 1, pending.key);
    setDeletingPost(false);
    setPostStatus(result.message);
    if (!result.ok) return;
    pendingDeleteKeyRef.current = null;
    setDeleteTarget(null);
  };

  const blockReportAuthor = async () => {
    const userId = reportTarget?.authorId;
    if (!userId || blockingUser) return;
    const previous = pendingBlockKeyRef.current;
    const pending = previous?.userId === userId
      ? previous
      : { userId, key: createSessionId("community-block") };
    pendingBlockKeyRef.current = pending;
    setBlockingUser(true);
    setReportStatus("");
    const result = await blockCommunityUser(userId, pending.key);
    setBlockingUser(false);
    setReportStatus(result.message);
    if (!result.ok) return;
    pendingBlockKeyRef.current = null;
    setReportTarget(null);
  };

  const submitPost = async () => {
    const title = draftTitle.trim();
    const content = draftContent.trim();
    if (!postValid || postSubmitting) return;
    const fingerprint = JSON.stringify([
      draftKind,
      draftIpId,
      title,
      content,
      draftMediaFile?.name ?? null,
      draftMediaFile?.size ?? null,
      draftMediaFile?.lastModified ?? null,
    ]);
    const pending = pendingPostKeyRef.current?.fingerprint === fingerprint
      ? pendingPostKeyRef.current
      : {
        fingerprint,
        key: createSessionId("community-post"),
        mediaKey: createSessionId("community-post-media"),
      };
    pendingPostKeyRef.current = pending;
    setPostSubmitting(true);
    setPostStatus("");
    if (apiMode === "remote" && draftMediaFile && !pending.mediaId) {
      setPostStatus("사진을 안전하게 업로드하고 있습니다.");
      const uploaded = await uploadMedia(draftMediaFile, "POST", pending.mediaKey);
      if (!uploaded.ok || !uploaded.data) {
        if (uploaded.code === "MEDIA_UPLOAD_INTENT_EXPIRED") {
          pendingPostKeyRef.current = {
            ...pending,
            mediaKey: createSessionId("community-post-media"),
            mediaId: undefined,
          };
        }
        setPostSubmitting(false);
        setPostStatus(uploaded.message);
        return;
      }
      pending.mediaId = uploaded.data.mediaId;
    }
    const result = await submitCommunityPost({
      kind: draftKind,
      ipId: draftIpId || null,
      title,
      content,
      mediaIds: pending.mediaId ? [pending.mediaId] : [],
    }, pending.key);
    setPostSubmitting(false);
    setPostStatus(result.message);
    if (!result.ok) return;
    pendingPostKeyRef.current = null;
    keyboard.hide();
    setDraftTitle("");
    setDraftContent("");
    setDraftKind("DUKROOM");
    setDraftMediaFile(null);
    setFilter("전체");
    setComposerOpen(false);
  };

  const submitReport = async () => {
    if (!reportTarget || reportSubmitting) return;
    const targetType = reportTarget.kind === "SNAP" ? "SNAP" : "POST";
    const details = reportDetails.trim();
    const fingerprint = JSON.stringify([targetType, reportTarget.id, reportReason, details]);
    const pending = pendingReportKeyRef.current?.fingerprint === fingerprint
      ? pendingReportKeyRef.current
      : { fingerprint, key: createSessionId("community-report") };
    pendingReportKeyRef.current = pending;
    setReportSubmitting(true);
    setReportStatus("");
    const result = await submitCommunityReport({
      targetType,
      targetId: reportTarget.id,
      reason: reportReason,
      ...(details ? { details } : {}),
    }, pending.key);
    setReportSubmitting(false);
    setReportStatus(result.message);
    if (!result.ok) return;
    pendingReportKeyRef.current = null;
    setReportedPostIds((current) => new Set(current).add(reportTarget.id));
    keyboard.hide();
    setReportDetails("");
    setReportTarget(null);
  };

  return (
    <>
      <MobileScroll className="app-screen dabboba-screen">
        <NativeBridgeController rootScreenId="root-duckroom" />
        <main ref={screenFocusRef} tabIndex={-1} className="root-tab-page duckroom-page" aria-label="덕룸 수집장">
          <section className="duckroom-lead" aria-labelledby="duckroom-title">
            <h1 id="duckroom-title">모은 걸 꺼내 자랑해요.</h1>
            <p>가챠 한 알부터 완성한 진열장까지, 서로의 수집 기록을 구경해 보세요.</p>
          </section>
          <button type="button" className="request-composer-callout" onClick={requestComposeAccess}>
            <span aria-hidden="true"><IconCameraLine size={21} /></span>
            <div><strong>덕룸 글 올리기</strong><small>{eligibleIps.length ? "작품과 수집 이야기를 남겨주세요." : "작품 미지정으로도 수집 이야기를 남길 수 있어요."}</small></div>
            <IconChevronRightLine size={21} aria-hidden="true" />
          </button>
          {postStatus ? <p className="request-submit-status" role="status">{postStatus}</p> : null}
          {reportStatus && !reportTarget ? <p className="request-submit-status" role="status">{reportStatus}</p> : null}
          <Carousel className="duckroom-filter-carousel" contentClassName="duckroom-filter-rail" ariaLabel="덕룸 카테고리">
            {DUCKROOM_FILTERS.map((item) => (
              <button
                key={item}
                type="button"
                className="filter-chip"
                data-selected={filter === item ? "true" : "false"}
                aria-pressed={filter === item}
                onClick={() => setFilter(item)}
              >
                {item}
              </button>
            ))}
          </Carousel>
          <section className="duckroom-grid" aria-label="수집 자랑 게시물">
            {visibleShowcases.map((showcase) => {
              const product = catalogProducts.find((item) => item.id === showcase.productId);
              const liked = Boolean(showcase.likedByViewer);
              const reported = reportedPostIds.has(showcase.id);
              const ownPost = Boolean(currentUserId) && showcase.authorId === currentUserId;
              return (
                <article key={showcase.id} className="duckroom-card">
                  <div className="duckroom-media">
                    <img
                      src={showcase.mediaUrl ?? product?.asset ?? EMPTY_PRODUCT_IMAGE_SRC}
                      alt={showcase.mediaUrl ? `${showcase.caption} 첨부 사진` : product ? `${showcase.caption} 대표 상품` : "첨부 이미지 없음"}
                      loading="eager"
                      decoding="sync"
                      draggable={false}
                    />
                    <span>{showcase.kind === "SNAP" ? "SNAP" : categoryLabel(showcase.categoryId)}</span>
                  </div>
                  <div className="duckroom-copy">
                    <small>{showcase.author}</small>
                    <button
                      type="button"
                      className="duckroom-detail-link"
                      aria-label={`${showcase.caption} 상세와 댓글 보기`}
                      onClick={() => flow.push(createDuckroomDetailScreen(showcase.id))}
                    >
                      <h2>{showcase.caption}</h2>
                      <span>{showcase.commentCount ?? 0}개 댓글 · 상세 보기</span>
                    </button>
                    <div>
                      <span>{showcase.collectedCount}개 수집</span>
                      <button
                        type="button"
                        aria-label={ownPost ? `${showcase.caption} 삭제` : reported ? `${showcase.caption} 신고 접수됨` : `${showcase.caption} 신고`}
                        disabled={!ownPost && reported}
                        onClick={() => ownPost ? setDeleteTarget(showcase) : requestReportAccess(showcase)}
                      >
                        {ownPost ? "삭제" : reported ? "신고됨" : "신고"}
                      </button>
                      <button
                        type="button"
                        aria-label={liked ? `${showcase.caption} 좋아요 취소` : `${showcase.caption} 좋아요`}
                        aria-pressed={liked}
                        aria-busy={pendingLikePostIds.has(showcase.id)}
                        disabled={ownPost || pendingLikePostIds.has(showcase.id)}
                        onClick={() => void toggleShowcaseLike(showcase)}
                      >
                        {liked ? <IconHeartFill size={17} aria-hidden="true" /> : <IconHeartLine size={17} aria-hidden="true" />}
                        {pendingLikePostIds.has(showcase.id) ? "…" : showcase.likes}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
          {visibleShowcases.length === 0 ? <p className="prototype-disclosure" role="status">표시할 덕룸 게시물이 없습니다.</p> : null}
          <p className="prototype-disclosure">
            {apiMode === "remote"
              ? "덕룸 게시물 작성·사진 첨부·좋아요·작성자 삭제·신고·차단은 서버에 반영됩니다. 첨부 사진은 안전 변환이 끝난 공개 게시물에서만 표시됩니다."
              : "개발 프리뷰 데이터입니다. 글 작성과 신고 입력은 확인할 수 있지만 서버나 운영자에게 전송되지 않습니다."}
          </p>
        </main>
      </MobileScroll>

      {!isAuthenticated && (authIntent?.kind === "community-compose" || authIntent?.kind === "community-like" || authIntent?.kind === "community-block" || authIntent?.kind === "community-report") ? (
        <GuestAuthPrompt
          intent={authIntent}
          onDismiss={() => setAuthIntent(null)}
          onLogin={() => flow.push(createLoginScreen())}
        />
      ) : null}

      <BottomSheet
        open={composerOpen}
        onOpenChange={(open) => {
          if (!open) keyboard.hide();
          setComposerOpen(open);
        }}
        title="덕룸 글 올리기"
        description="공개할 기록 형식을 고르고 좋아하는 작품과 수집 이야기를 남겨보세요."
        snap={0.78}
      >
        <form className="request-compose-form" onSubmit={(event) => { event.preventDefault(); void submitPost(); }} noValidate>
          <fieldset className="community-kind-selector">
            <legend>게시물 형식</legend>
            <div role="radiogroup" aria-label="게시물 형식">
              {COMMUNITY_POST_KINDS.map((kind, index) => (
                <button
                  key={kind.value}
                  type="button"
                  role="radio"
                  aria-checked={draftKind === kind.value}
                  tabIndex={draftKind === kind.value ? 0 : -1}
                  data-selected={draftKind === kind.value ? "true" : "false"}
                  onKeyDown={(event) => handleRadioArrow(
                    event,
                    COMMUNITY_POST_KINDS,
                    index,
                    (next) => setDraftKind(next.value),
                  )}
                  onClick={() => {
                    pendingPostKeyRef.current = null;
                    setDraftKind(kind.value);
                  }}
                >
                  <strong>{kind.label}</strong>
                  <small>{kind.description}</small>
                </button>
              ))}
            </div>
          </fieldset>
          <label>
            <span>작품 IP</span>
            <select value={draftIpId} onChange={(event) => setDraftIpId(event.currentTarget.value)}>
              <option value="">작품 미지정</option>
              {eligibleIps.map((ip) => <option key={ip.id} value={ip.id}>{ip.nameKo}</option>)}
            </select>
          </label>
          <label>
            <span>글 제목</span>
            <KeyboardInput value={draftTitle} maxLength={160} placeholder="수집 기록의 제목을 적어주세요" onChange={(event) => setDraftTitle(event.currentTarget.value)} onBlur={() => keyboard.hide()} />
          </label>
          <label>
            <span>수집 이야기</span>
            <KeyboardTextarea value={draftContent} maxLength={20_000} placeholder="무엇을 모았는지, 어떤 점이 좋은지 알려주세요." onChange={(event) => setDraftContent(event.currentTarget.value)} onBlur={() => keyboard.hide()} />
          </label>
          <label className="community-media-field">
            <span>사진 첨부 <small>선택 · 최대 10MB</small></span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              disabled={postSubmitting}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0] ?? null;
                event.currentTarget.value = "";
                if (!file) return;
                if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
                  setPostStatus("JPEG, PNG, WebP 또는 GIF 이미지만 첨부할 수 있습니다.");
                  return;
                }
                if (file.size < 1 || file.size > 10 * 1024 * 1024) {
                  setPostStatus("사진은 비어 있지 않은 10MB 이하 파일만 첨부할 수 있습니다.");
                  return;
                }
                pendingPostKeyRef.current = null;
                setPostStatus("");
                setDraftMediaFile(file);
              }}
            />
            <span className="community-media-picker">
              <IconCameraLine size={20} aria-hidden="true" />
              {draftMediaFile ? "다른 사진 선택" : "사진 선택"}
            </span>
          </label>
          {draftMediaFile ? (
            <div className="community-media-preview">
              {draftMediaPreview ? <img src={draftMediaPreview} alt="첨부할 사진 미리보기" /> : null}
              <span><strong>{draftMediaFile.name}</strong><small>{Math.max(1, Math.ceil(draftMediaFile.size / 1024))}KB</small></span>
              <button
                type="button"
                aria-label="첨부 사진 삭제"
                disabled={postSubmitting}
                onClick={() => {
                  pendingPostKeyRef.current = null;
                  setDraftMediaFile(null);
                }}
              >
                <IconTrashcanLine size={19} aria-hidden="true" />
              </button>
            </div>
          ) : null}
          <ActionButton
            type="button"
            variant="brandSolid"
            size="large"
            className="sheet-primary-button"
            disabled={!postValid || postSubmitting}
            loading={postSubmitting}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => { void submitPost(); }}
          >
            {postSubmitting ? "등록 중" : apiMode === "remote" ? `${draftKind === "SNAP" ? "스냅" : "덕룸"}에 등록하기` : "프리뷰 입력 확인"}
          </ActionButton>
          {postStatus && composerOpen ? <span className="exchange-field-notice" role="status">{postStatus}</span> : null}
          <p className="prototype-disclosure">
            {apiMode === "remote"
              ? "사진은 업로드 의도 발급·저장소 전송·완료 검증을 거친 뒤 게시글에 연결됩니다. 공개 미디어 주소가 없으면 카드에는 선택한 작품의 등록 상품을 대표로 보여줍니다."
              : "개발 프리뷰에서는 입력을 확인할 뿐 게시글을 생성하지 않습니다."}
          </p>
        </form>
      </BottomSheet>

      <BottomSheet
        open={Boolean(reportTarget)}
        onOpenChange={(open) => {
          if (!open) {
            keyboard.hide();
            setReportTarget(null);
          }
        }}
        title="게시물 신고"
        description={reportTarget ? `“${reportTarget.caption}” 게시물을 운영자에게 알려요.` : "신고할 게시물을 확인해 주세요."}
        snap={0.68}
      >
        <form className="request-compose-form" onSubmit={(event) => { event.preventDefault(); void submitReport(); }} noValidate>
          <label>
            <span>신고 사유</span>
            <select value={reportReason} onChange={(event) => setReportReason(event.currentTarget.value as ApiReportReason)}>
              {COMMUNITY_REPORT_REASONS.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
            </select>
          </label>
          <label>
            <span>상세 내용 <small>선택</small></span>
            <KeyboardTextarea value={reportDetails} maxLength={2_000} placeholder="운영자가 확인할 내용을 적어주세요." onChange={(event) => setReportDetails(event.currentTarget.value)} onBlur={() => keyboard.hide()} />
          </label>
          <ActionButton
            type="button"
            variant="brandSolid"
            size="large"
            className="sheet-primary-button"
            disabled={!reportTarget || reportSubmitting}
            loading={reportSubmitting}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => { void submitReport(); }}
          >
            {reportSubmitting ? "접수 중" : apiMode === "remote" ? "신고 접수하기" : "프리뷰 입력 확인"}
          </ActionButton>
          {reportTarget?.authorId ? (
            <button
              type="button"
              className="settings-secondary-action"
              disabled={reportSubmitting || blockingUser}
              onClick={() => void blockReportAuthor()}
            >
              {blockingUser ? "작성자 차단 중" : "이 작성자 차단하기"}
            </button>
          ) : null}
          {reportStatus && reportTarget ? <span className="exchange-field-notice" role="status">{reportStatus}</span> : null}
          <p className="prototype-disclosure">
            {apiMode === "remote"
              ? "신고는 서버에 접수되며 게시물 조치 여부는 운영자가 검토합니다."
              : "개발 프리뷰에서는 신고가 서버나 운영자에게 전송되지 않습니다."}
          </p>
        </form>
      </BottomSheet>

      <BottomSheet
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !deletingPost) setDeleteTarget(null);
        }}
        title="덕룸 글을 삭제할까요?"
        description={deleteTarget ? `“${deleteTarget.caption}” 글은 공개 목록에서 사라지고 운영 증거를 위해 서버에 soft delete 상태로 남습니다.` : "삭제할 글을 확인해 주세요."}
        snap={0.42}
      >
        <div className="settings-confirm-actions">
          <ActionButton type="button" variant="brandSolid" size="large" className="sheet-primary-button account-deletion-button" loading={deletingPost} disabled={deletingPost} onClick={() => void confirmPostDeletion()}>{deletingPost ? "삭제 중" : "글 삭제"}</ActionButton>
          <button type="button" disabled={deletingPost} onClick={() => setDeleteTarget(null)}>취소</button>
        </div>
      </BottomSheet>
    </>
  );
}

function DuckroomDetailPage({ postId }: { postId: string }) {
  const {
    currentUserId,
    isAuthenticated,
    authIntent,
    setAuthIntent,
    duckroomShowcases,
    catalogProducts,
    catalogIps,
    loadCommunityPost,
    loadCommunityComments,
    submitCommunityComment,
    deleteCommunityComment,
    updateCommunityPost,
    apiMode,
  } = useDabboba();
  const flow = useFlow();
  const keyboard = useKeyboard();
  const screenFocusRef = useScreenEntryFocus();
  const pendingCommentKeyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const pendingCommentDeleteKeysRef = useRef<Record<string, string>>({});
  const pendingEditKeyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const initialPost = duckroomShowcases.find((item) => item.id === postId) ?? null;
  const [post, setPost] = useState<UiDuckroomShowcase | null>(initialPost);
  const [comments, setComments] = useState<ApiCommunityComment[]>([]);
  const [loading, setLoading] = useState(apiMode === "remote");
  const [detailStatus, setDetailStatus] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [deletingCommentIds, setDeletingCommentIds] = useState<Set<string>>(() => new Set());
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState(initialPost?.title ?? initialPost?.caption ?? "");
  const [editContent, setEditContent] = useState(initialPost?.content ?? "");
  const [editIpId, setEditIpId] = useState(initialPost?.ipId ?? "");
  const [editKeepMedia, setEditKeepMedia] = useState(Boolean(initialPost?.mediaIds?.length));
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editStatus, setEditStatus] = useState("");

  const refreshPostAndComments = useCallback(async (signal?: AbortSignal) => {
    const [postResult, commentsResult] = await Promise.all([
      loadCommunityPost(postId, signal),
      loadCommunityComments(postId, signal),
    ]);
    if (signal?.aborted) return { postResult, commentsResult };
    if (postResult.ok && postResult.data) setPost(postResult.data);
    if (commentsResult.ok && commentsResult.data) setComments(commentsResult.data);
    return { postResult, commentsResult };
  }, [loadCommunityComments, loadCommunityPost, postId]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(apiMode === "remote");
    setDetailStatus("");
    void refreshPostAndComments(controller.signal).then(({ postResult, commentsResult }) => {
      if (controller.signal.aborted) return;
      setLoading(false);
      if (!postResult.ok) setDetailStatus(postResult.message);
      else if (!commentsResult.ok && apiMode === "remote") setDetailStatus(commentsResult.message);
    });
    return () => controller.abort();
  }, [apiMode, refreshPostAndComments]);

  const openEditor = () => {
    if (!post || post.authorId !== currentUserId) return;
    setEditTitle(post.title ?? post.caption);
    setEditContent(post.content ?? "");
    setEditIpId(post.ipId ?? "");
    setEditKeepMedia(Boolean(post.mediaIds?.length));
    setEditStatus("");
    setEditOpen(true);
  };

  const submitComment = async () => {
    const content = commentDraft.trim();
    if (!content || commentSubmitting) return;
    if (!isAuthenticated) {
      keyboard.hide();
      setAuthIntent({ kind: "community-comment", postId });
      return;
    }
    const fingerprint = JSON.stringify([postId, content]);
    const pending = pendingCommentKeyRef.current?.fingerprint === fingerprint
      ? pendingCommentKeyRef.current
      : { fingerprint, key: createSessionId("community-comment") };
    pendingCommentKeyRef.current = pending;
    setCommentSubmitting(true);
    setDetailStatus("");
    const result = await submitCommunityComment(postId, content, pending.key);
    setCommentSubmitting(false);
    setDetailStatus(result.message);
    if (!result.ok) return;
    pendingCommentKeyRef.current = null;
    setCommentDraft("");
    keyboard.hide();
    const refreshed = await refreshPostAndComments();
    if (!refreshed.commentsResult.ok || !refreshed.postResult.ok) {
      setDetailStatus(`${result.message} 최신 댓글 수를 다시 확인하지 못했습니다.`);
    }
  };

  const removeComment = async (comment: ApiCommunityComment) => {
    if (comment.authorId !== currentUserId || deletingCommentIds.has(comment.id)) return;
    const pending = {
      key: pendingCommentDeleteKeysRef.current[comment.id] ?? createSessionId("community-comment-delete"),
    };
    pendingCommentDeleteKeysRef.current[comment.id] = pending.key;
    setDeletingCommentIds((current) => new Set(current).add(comment.id));
    setDetailStatus("");
    const result = await deleteCommunityComment(comment.id, pending.key);
    setDeletingCommentIds((current) => {
      const next = new Set(current);
      next.delete(comment.id);
      return next;
    });
    setDetailStatus(result.message);
    if (!result.ok) return;
    delete pendingCommentDeleteKeysRef.current[comment.id];
    const refreshed = await refreshPostAndComments();
    if (!refreshed.commentsResult.ok || !refreshed.postResult.ok) {
      setDetailStatus(`${result.message} 최신 댓글 수를 다시 확인하지 못했습니다.`);
    }
  };

  const savePostEdit = async () => {
    if (!post?.version || post.authorId !== currentUserId || editSubmitting) return;
    const title = editTitle.trim();
    const content = editContent.trim();
    if (!title || !content) return;
    const mediaIds = editKeepMedia ? post.mediaIds ?? [] : [];
    const fingerprint = JSON.stringify([
      post.id,
      post.version,
      title,
      content,
      editIpId,
      mediaIds,
    ]);
    const pending = pendingEditKeyRef.current?.fingerprint === fingerprint
      ? pendingEditKeyRef.current
      : { fingerprint, key: createSessionId("community-post-edit") };
    pendingEditKeyRef.current = pending;
    setEditSubmitting(true);
    setEditStatus("");
    const result = await updateCommunityPost(post.id, {
      expectedVersion: post.version,
      title,
      content,
      ipId: editIpId || null,
      mediaIds,
    }, pending.key);
    setEditSubmitting(false);
    setEditStatus(result.message);
    if (result.data) {
      setPost(result.data);
      setEditTitle(result.data.title ?? result.data.caption);
      setEditContent(result.data.content ?? "");
      setEditIpId(result.data.ipId ?? "");
      setEditKeepMedia(Boolean(result.data.mediaIds?.length));
    }
    if (!result.ok) return;
    pendingEditKeyRef.current = null;
    keyboard.hide();
    setDetailStatus(result.message);
    setEditOpen(false);
  };

  if (!post && loading) {
    return (
      <MobileScroll className="app-screen dabboba-screen">
        <main ref={screenFocusRef} tabIndex={-1} className="duckroom-detail-page" aria-busy="true">
          <p className="prototype-disclosure" role="status">게시물과 댓글을 불러오는 중입니다.</p>
        </main>
      </MobileScroll>
    );
  }

  if (!post) {
    return (
      <MobileScroll className="app-screen dabboba-screen">
        <main ref={screenFocusRef} tabIndex={-1} className="duckroom-detail-page">
          <div className="ip-empty-state" role="status">
            <IconDocumentLine size={30} aria-hidden="true" />
            <strong>게시물을 열 수 없어요</strong>
            <span>{detailStatus || "삭제됐거나 공개되지 않은 게시물입니다."}</span>
          </div>
        </main>
      </MobileScroll>
    );
  }

  const product = catalogProducts.find((item) => item.id === post.productId);
  const ownPost = Boolean(currentUserId) && post.authorId === currentUserId;
  const kindLabel = post.kind === "SNAP" ? "SNAP" : "DUKROOM";
  const postedAt = post.createdAt ? serverDateLabel(post.createdAt) : "프리뷰 기록";

  return (
    <>
      <MobileScroll className="app-screen dabboba-screen">
        <main ref={screenFocusRef} tabIndex={-1} className="duckroom-detail-page" aria-labelledby="duckroom-detail-title">
          <article className="duckroom-detail-article">
            <div className="duckroom-detail-meta">
              <span>{kindLabel}</span>
              <time>{postedAt}</time>
            </div>
            <div className="duckroom-detail-author">
              <span aria-hidden="true"><IconPerson2Line size={20} /></span>
              <strong>{post.author}</strong>
              {ownPost ? <em>내 게시물</em> : null}
            </div>
            <h1 id="duckroom-detail-title">{post.title ?? post.caption}</h1>
            {post.mediaUrl || product?.asset ? (
              <img
                className="duckroom-detail-media"
                src={post.mediaUrl ?? product?.asset}
                alt={post.mediaUrl ? `${post.caption} 첨부 사진` : `${post.caption} 대표 상품`}
              />
            ) : null}
            <p className="duckroom-detail-content">{post.content || post.caption}</p>
            <div className="duckroom-detail-stats">
              <span><IconHeartLine size={17} aria-hidden="true" /> {post.likes}</span>
              <span><IconDot3HorizontalChatbubbleLeftLine size={17} aria-hidden="true" /> {post.commentCount ?? comments.length}</span>
              {ownPost ? (
                <button type="button" onClick={openEditor}><IconPencilLine size={17} aria-hidden="true" /> 수정</button>
              ) : null}
            </div>
          </article>

          <section className="community-comment-section" aria-labelledby="community-comments-title">
            <div className="community-comment-heading">
              <h2 id="community-comments-title">댓글 {post.commentCount ?? comments.length}</h2>
              {loading ? <small>불러오는 중</small> : null}
            </div>
            <form className="community-comment-form" onSubmit={(event) => { event.preventDefault(); void submitComment(); }}>
              <KeyboardTextarea
                value={commentDraft}
                maxLength={2_000}
                placeholder={isAuthenticated ? "수집 이야기에 댓글을 남겨보세요." : "로그인 후 댓글을 남길 수 있어요."}
                aria-label="댓글 내용"
                disabled={commentSubmitting}
                onChange={(event) => {
                  setCommentDraft(event.currentTarget.value);
                  if (pendingCommentKeyRef.current?.fingerprint !== JSON.stringify([postId, event.currentTarget.value.trim()])) {
                    pendingCommentKeyRef.current = null;
                  }
                }}
                onBlur={() => keyboard.hide()}
              />
              <ActionButton
                type="submit"
                variant="brandSolid"
                size="large"
                loading={commentSubmitting}
                disabled={!commentDraft.trim() || commentSubmitting}
              >
                {commentSubmitting ? "등록 중" : isAuthenticated ? "댓글 등록" : "로그인하고 댓글 쓰기"}
              </ActionButton>
            </form>

            <div className="community-comment-list" aria-label="댓글 목록">
              {comments.map((comment) => {
                const ownComment = Boolean(currentUserId) && comment.authorId === currentUserId;
                const deleting = deletingCommentIds.has(comment.id);
                return (
                  <article key={comment.id}>
                    <div>
                      <strong>{comment.authorNickname}</strong>
                      <time>{serverDateLabel(comment.createdAt)}</time>
                    </div>
                    <p>{comment.content}</p>
                    {ownComment ? (
                      <button type="button" disabled={deleting} onClick={() => { void removeComment(comment); }}>
                        {deleting ? "삭제 중" : "내 댓글 삭제"}
                      </button>
                    ) : null}
                  </article>
                );
              })}
              {!loading && comments.length === 0 ? <p className="community-comment-empty">아직 댓글이 없습니다. 첫 댓글을 남겨보세요.</p> : null}
            </div>
          </section>

          {detailStatus ? <p className="profile-subpage-status" role="status">{detailStatus}</p> : null}
          <p className="prototype-disclosure">
            {apiMode === "remote"
              ? "게시물 상세와 공개 댓글은 서버에서 조회합니다. 댓글 작성·삭제와 내 게시물 수정은 성공 응답 뒤 서버 상태를 다시 확인합니다."
              : "개발 프리뷰 게시물입니다. 댓글과 수정 입력은 서버에 저장되지 않습니다."}
          </p>
        </main>
      </MobileScroll>

      {!isAuthenticated && authIntent?.kind === "community-comment" && authIntent.postId === postId ? (
        <GuestAuthPrompt
          intent={authIntent}
          onDismiss={() => setAuthIntent(null)}
          onLogin={() => flow.push(createLoginScreen())}
        />
      ) : null}

      <BottomSheet
        open={editOpen}
        onOpenChange={(open) => {
          if (!open && !editSubmitting) {
            keyboard.hide();
            setEditOpen(false);
          }
        }}
        title="게시물 수정"
        description={`${kindLabel} 형식은 유지하고 제목, 내용, 작품과 기존 사진 연결을 수정합니다.`}
        snap={0.76}
      >
        <form className="request-compose-form community-edit-form" onSubmit={(event) => { event.preventDefault(); void savePostEdit(); }} noValidate>
          <p className="community-edit-kind"><strong>{kindLabel}</strong><span>게시물 형식은 수정할 수 없습니다.</span></p>
          <label>
            <span>작품 IP</span>
            <select value={editIpId} disabled={editSubmitting} onChange={(event) => setEditIpId(event.currentTarget.value)}>
              <option value="">작품 미지정</option>
              {catalogIps.map((ip) => <option key={ip.id} value={ip.id}>{ip.nameKo}</option>)}
            </select>
          </label>
          <label>
            <span>글 제목</span>
            <KeyboardInput value={editTitle} maxLength={160} disabled={editSubmitting} onChange={(event) => setEditTitle(event.currentTarget.value)} onBlur={() => keyboard.hide()} />
          </label>
          <label>
            <span>수집 이야기</span>
            <KeyboardTextarea value={editContent} maxLength={20_000} disabled={editSubmitting} onChange={(event) => setEditContent(event.currentTarget.value)} onBlur={() => keyboard.hide()} />
          </label>
          {post.mediaIds?.length ? (
            <button
              type="button"
              className="community-edit-media-toggle"
              role="checkbox"
              aria-checked={editKeepMedia}
              disabled={editSubmitting}
              onClick={() => setEditKeepMedia((current) => !current)}
            >
              <span>{editKeepMedia ? <IconCheckmarkLine size={16} aria-hidden="true" /> : null}</span>
              <strong>기존 사진 {post.mediaIds.length}개 유지</strong>
              <small>{editKeepMedia ? "저장하면 기존 mediaIds를 그대로 보냅니다." : "저장하면 기존 사진 연결을 제거합니다."}</small>
            </button>
          ) : null}
          <ActionButton
            type="submit"
            variant="brandSolid"
            size="large"
            className="sheet-primary-button"
            loading={editSubmitting}
            disabled={!editTitle.trim() || !editContent.trim() || editSubmitting}
          >
            {editSubmitting ? "저장 중" : "수정 내용 저장"}
          </ActionButton>
          {editStatus ? <span className="exchange-field-notice" role="status">{editStatus}</span> : null}
          <p className="prototype-disclosure">서버 version을 기준으로 충돌을 확인하며, 충돌 시 최신 게시물을 다시 불러옵니다.</p>
        </form>
      </BottomSheet>
    </>
  );
}

function ProfileSubpageLead({
  eyebrow,
  title,
  description,
  summary,
}: {
  eyebrow: string;
  title: string;
  description: string;
  summary?: string;
}) {
  return (
    <section className="profile-subpage-lead">
      <span>{eyebrow}</span>
      <div>
        <h1>{title}</h1>
        {summary ? <strong>{summary}</strong> : null}
      </div>
      <p>{description}</p>
    </section>
  );
}

function WishlistPage({ flow }: { flow: FlowControls }) {
  const { sessionCommerce, catalogProducts, wishlistItems, apiMode } = useDabboba();
  const screenFocusRef = useScreenEntryFocus();
  const favoriteProducts = sessionCommerce.wishlistProductIds
    .map((productId) => catalogProducts.find((product) => product.id === productId))
    .filter((product): product is Product => Boolean(product));
  const catalogProductIds = new Set(catalogProducts.map((product) => product.id));
  const unavailableWishlistItems = wishlistItems.filter((item) => !catalogProductIds.has(item.product.id));

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="profile-subpage" aria-label="내 찜 목록">
        <ProfileSubpageLead
          eyebrow="WISHLIST"
          title="다시 보고 싶은 상품"
          description="찜해 둔 상품의 가격과 남은 수량을 한 번에 확인할 수 있어요."
          summary={`${sessionCommerce.wishlistProductIds.length}개`}
        />
        <ProductGrid flow={flow} items={favoriteProducts} />
        {unavailableWishlistItems.length ? (
          <section className="profile-order-list" aria-label="현재 카탈로그에서 숨겨진 찜 상품">
            {unavailableWishlistItems.map((item) => (
              <article key={item.id} className="profile-order-card">
                <div className="profile-order-meta"><span>{item.product.ipNameKo}</span><em>{item.product.isActive ? "카탈로그 확인 중" : "판매 중지"}</em></div>
                <div className="profile-order-product"><span><strong>{item.product.name}</strong><small>{formatWon(item.product.price)}</small></span></div>
              </article>
            ))}
          </section>
        ) : null}
        {sessionCommerce.wishlistProductIds.length === 0 ? <p role="status">찜한 상품이 없습니다.</p> : null}
        <p className="prototype-disclosure">
          {apiMode === "remote"
            ? "찜 목록은 서버 계정 기준입니다. 비활성 상품은 계약에 없는 재고 수량을 추정하지 않고 별도로 표시합니다."
            : "찜 목록은 이 프로토타입을 연 동안만 유지되며 새로고침하면 초기화됩니다."}
        </p>
      </main>
    </MobileScroll>
  );
}

function StoragePage({ flow }: { flow: FlowControls }) {
  const { currentUserId, sessionCommerce, catalogProducts, catalogIps, apiMode } = useDabboba();
  const screenFocusRef = useScreenEntryFocus();
  const storedInventoryUnits = sessionCommerce.inventoryUnits.filter((item) => (
    item.ownerId === currentUserId && item.shippingStatus === "stored"
  ));

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="profile-subpage" aria-label="보관함">
        <ProfileSubpageLead
          eyebrow="MY STORAGE"
          title="뽑은 상품을 모아뒀어요."
          description="구매하거나 뽑은 상품은 배송을 신청하기 전까지 여기에 보관됩니다."
          summary={`${storedInventoryUnits.length}개`}
        />
        <section className="profile-item-list" aria-label="보관 중인 상품">
          {storedInventoryUnits.map((item) => {
            const product = catalogProducts.find((candidate) => candidate.id === item.productId);
            const ip = catalogIps.find((candidate) => candidate.id === item.ipId);
            return (
              <article key={item.id} className="profile-storage-card">
                <img src={item.itemImage} alt="" loading="eager" decoding="sync" draggable={false} />
                <div>
                  <span>{ip?.nameKo ?? "작품 미지정"} · {categoryLabel(item.categoryId)}</span>
                  <h2>{item.itemName}</h2>
                  <dl>
                    <div><dt>획득일</dt><dd>{item.acquiredAt}</dd></div>
                    <div><dt>배송 신청 기한</dt><dd>{item.shippingDeadline}</dd></div>
                  </dl>
                  {product ? (
                    <button type="button" onClick={() => flow.push(createDetailScreen(product))}>
                      상품 보기 <IconChevronRightLine size={17} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </section>
        <p className="prototype-disclosure">{apiMode === "remote" ? "보관 상품은 인증된 서버 인벤토리입니다." : "보관·배송 상태는 이 프로토타입을 연 동안만 유지되며 실제 물류 요청은 발생하지 않습니다."}</p>
      </main>
    </MobileScroll>
  );
}

function ShippingRequestPage() {
  const {
    currentUserId,
    memberSettings,
    requestShipping,
    sessionCommerce,
    apiMode,
    remoteAddressState,
  } = useDabboba();
  const screenFocusRef = useScreenEntryFocus();
  const pendingIdempotencyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const requestableInventoryUnits = sessionCommerce.inventoryUnits.filter((item) => (
    item.ownerId === currentUserId
    && item.shippingStatus === "stored"
    && item.exchangeStatus === "available"
  ));
  const requestableFingerprint = requestableInventoryUnits.map((item) => item.id).sort().join(":");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(requestableInventoryUnits.slice(0, 20).map((item) => item.id)));
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const selectedCount = selectedIds.size;
  const shippingFee = selectedCount >= 2 ? 0 : 3_000;

  useEffect(() => {
    const requestableIds = new Set(requestableFingerprint ? requestableFingerprint.split(":") : []);
    setSelectedIds((current) => new Set([...current].filter((id) => requestableIds.has(id))));
  }, [requestableFingerprint]);

  const toggleItem = (itemId: string) => {
    setStatus("");
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else if (next.size < 20) next.add(itemId);
      else setStatus("배송 신청은 한 번에 20개까지 선택할 수 있습니다.");
      return next;
    });
  };

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="profile-subpage" aria-label="배송 신청">
        <ProfileSubpageLead
          eyebrow="SHIPPING"
          title="받을 상품을 골라주세요."
          description="보관함의 상품을 함께 선택하면 한 번에 배송을 신청할 수 있어요."
          summary={`${selectedCount}개 선택`}
        />
        <section className="profile-shipping-list" aria-label="배송할 상품 선택">
          {requestableInventoryUnits.map((item) => {
            const selected = selectedIds.has(item.id);
            return (
              <button
                key={item.id}
                type="button"
                className="profile-shipping-item"
                role="checkbox"
                aria-checked={selected}
                onClick={() => toggleItem(item.id)}
              >
                <span className="profile-shipping-check" data-selected={selected ? "true" : "false"}>
                  {selected ? <IconCheckmarkLine size={16} aria-hidden="true" /> : null}
                </span>
                <img src={item.itemImage} alt="" loading="eager" decoding="sync" draggable={false} />
                <span><strong>{item.itemName}</strong><small>{categoryLabel(item.categoryId)} · {formatWon(item.appReferenceValue)} {APP_REFERENCE_VALUE_NOTICE}</small></span>
              </button>
            );
          })}
          {requestableInventoryUnits.length === 0 ? <p role="status">현재 배송 신청 가능한 보관 상품이 없습니다.</p> : null}
        </section>
        <section className="profile-shipping-address" aria-label="기본 배송지">
          <div><span>기본 배송지</span><strong>{memberSettings.defaultAddress.recipient || "미등록"} · {memberSettings.defaultAddress.phone.replace(/(\d{3})\d{4}(\d{4})/, "$1-****-$2") || "연락처 없음"}</strong></div>
          <p>{memberSettings.defaultAddress.addressLine1 || "회원정보 변경에서 기본 배송지를 등록해 주세요."}{memberSettings.defaultAddress.addressLine2 ? ` · ${memberSettings.defaultAddress.addressLine2}` : ""}</p>
        </section>
        <dl className="profile-shipping-summary">
          <div><dt>선택 상품</dt><dd>{selectedCount}개</dd></div>
          <div><dt>배송비</dt><dd>{apiMode === "remote" ? "API 제공 안 함" : shippingFee ? formatWon(shippingFee) : "무료"}</dd></div>
        </dl>
        <ActionButton
          type="button"
          variant="brandSolid"
          size="large"
          className="sheet-primary-button profile-subpage-action"
          disabled={!selectedCount || submitting || (apiMode === "remote" && remoteAddressState !== "ready")}
          onClick={() => {
            if (submitting) return;
            setSubmitting(true);
            setStatus("");
            const inventoryUnitIds = [...selectedIds].sort();
            const fingerprint = inventoryUnitIds.join(":");
            const pending = pendingIdempotencyRef.current?.fingerprint === fingerprint
              ? pendingIdempotencyRef.current
              : { fingerprint, key: createSessionId("shipping-request") };
            pendingIdempotencyRef.current = pending;
            void requestShipping({
              id: createSessionId("shipping-request"),
              userId: currentUserId,
              inventoryUnitIds,
              requestedAt: sessionDateLabel(),
              status: "requested",
            }, pending.key).then((result) => {
              setSubmitting(false);
              setStatus(result.message);
              if (!result.ok) return;
              pendingIdempotencyRef.current = null;
              setSelectedIds(new Set<string>());
            });
          }}
        >
          {submitting ? "신청 중" : "배송 신청하기"}
        </ActionButton>
        {status ? <p className="profile-subpage-status" role="status">{status}</p> : null}
        <p className="prototype-disclosure">
          {apiMode === "remote"
            ? remoteAddressState === "ready"
              ? "배송 신청 성공 후 서버 내역을 다시 불러옵니다. 배송 완료 상품은 보관함과 새 배송 신청 대상에서 제외합니다."
              : "서버 기본 배송지를 먼저 등록해야 배송을 신청할 수 있습니다."
            : "배송 신청은 화면 확인용 로컬 상태이며 실제 물류 요청은 발생하지 않습니다."}
        </p>
      </main>
    </MobileScroll>
  );
}

function ShippingHistoryPage() {
  const {
    loadShippingRequests,
    loadShippingRequestDetail,
    accountShippingRequests,
    apiMode,
  } = useDabboba();
  const screenFocusRef = useScreenEntryFocus();
  const detailAbortRef = useRef<AbortController | null>(null);
  const [refreshingHistory, setRefreshingHistory] = useState(false);
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<ApiAccountShippingRequest | null>(null);
  const [historyStatus, setHistoryStatus] = useState("");

  useEffect(() => () => detailAbortRef.current?.abort(), []);

  const refreshHistory = async () => {
    if (refreshingHistory || apiMode !== "remote") return;
    setRefreshingHistory(true);
    setHistoryStatus("");
    const result = await loadShippingRequests();
    setRefreshingHistory(false);
    setHistoryStatus(result.message);
  };

  const toggleHistoryDetail = async (shippingRequest: ApiAccountShippingRequest) => {
    if (selectedDetail?.id === shippingRequest.id) {
      detailAbortRef.current?.abort();
      detailAbortRef.current = null;
      setSelectedDetail(null);
      setLoadingDetailId(null);
      return;
    }
    detailAbortRef.current?.abort();
    const controller = new AbortController();
    detailAbortRef.current = controller;
    setLoadingDetailId(shippingRequest.id);
    setHistoryStatus("");
    try {
      const result = await loadShippingRequestDetail(shippingRequest.id, controller.signal);
      if (controller.signal.aborted) return;
      setLoadingDetailId(null);
      setHistoryStatus(result.message);
      if (result.ok && result.data) setSelectedDetail(result.data);
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "AbortError") {
        setLoadingDetailId(null);
        setHistoryStatus(apiErrorMessage(error));
      }
    }
  };

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="profile-subpage" aria-label="배송 신청 내역">
        <section className="profile-shipping-history" aria-label="최근 배송 신청 목록">
          <div className="profile-shipping-history-head">
            <div><span>최근 신청 순서</span></div>
            {apiMode === "remote" ? (
              <button type="button" disabled={refreshingHistory} onClick={() => { void refreshHistory(); }}>
                {refreshingHistory ? "불러오는 중" : "내역 새로고침"}
              </button>
            ) : null}
          </div>
          <div className="profile-shipping-history-list">
            {accountShippingRequests.map((shippingRequest) => {
              const detailOpen = selectedDetail?.id === shippingRequest.id;
              const detail = detailOpen ? selectedDetail : shippingRequest;
              const destinationLines = maskedShippingAddressLabel(detail.destination);
              return (
                <article key={shippingRequest.id} className="profile-shipping-history-card" data-status={shippingRequest.status}>
                  <button
                    type="button"
                    className="profile-shipping-history-toggle"
                    aria-expanded={detailOpen}
                    disabled={loadingDetailId === shippingRequest.id}
                    onClick={() => { void toggleHistoryDetail(shippingRequest); }}
                  >
                    <span>
                      <em>{accountShippingStatusLabel(shippingRequest.status)}</em>
                      <strong>{shippingRequest.inventoryUnitIds.length}개 상품</strong>
                      <small>{serverDateLabel(shippingRequest.requestedAt)} 신청 · {shippingRequest.id}</small>
                    </span>
                    <small>{loadingDetailId === shippingRequest.id ? "확인 중" : detailOpen ? "접기" : "상세"}</small>
                  </button>
                  {detailOpen ? (
                    <div className="profile-shipping-history-detail">
                      <dl>
                        <div><dt>받는 분</dt><dd>{detail.destination.recipientMasked} · {detail.destination.phoneMasked}</dd></div>
                        <div><dt>배송지</dt><dd>{destinationLines || "마스킹 배송지 정보 없음"}</dd></div>
                        <div><dt>최근 변경</dt><dd>{serverDateLabel(detail.updatedAt)}</dd></div>
                        {detail.shippedAt ? <div><dt>발송일</dt><dd>{serverDateLabel(detail.shippedAt)}</dd></div> : null}
                        <div>
                          <dt>송장</dt>
                          <dd>{detail.trackingCarrier && detail.trackingNumber
                            ? `${detail.trackingCarrier} · ${detail.trackingNumber}`
                            : detail.status === "SHIPPED" || detail.status === "DELIVERED"
                              ? "송장 정보 확인 중"
                              : "발송 전"}</dd>
                        </div>
                      </dl>
                    </div>
                  ) : null}
                </article>
              );
            })}
            {accountShippingRequests.length === 0 ? <p role="status">최근 배송 신청 내역이 없습니다.</p> : null}
          </div>
          {historyStatus ? <p className="profile-subpage-status" role="status">{historyStatus}</p> : null}
        </section>
      </main>
    </MobileScroll>
  );
}

function PurchaseHistoryPage({ flow }: { flow: FlowControls }) {
  const {
    sessionCommerce,
    catalogProducts,
    accountOrders,
    accountDrawEntitlements,
    prepareDraw,
    apiMode,
  } = useDabboba();
  const screenFocusRef = useScreenEntryFocus();
  const orderCount = apiMode === "remote" ? accountOrders.length : sessionCommerce.orders.length;
  const entitlementGroupsByOrder = useMemo(() => {
    const grouped = new Map<string, Map<string, ApiAccountDrawEntitlement[]>>();
    accountDrawEntitlements.forEach((entitlement) => {
      if (entitlement.status !== "AVAILABLE") return;
      const orderGroups = grouped.get(entitlement.orderId) ?? new Map<string, ApiAccountDrawEntitlement[]>();
      const productGroup = orderGroups.get(entitlement.product.id) ?? [];
      productGroup.push(entitlement);
      orderGroups.set(entitlement.product.id, productGroup);
      grouped.set(entitlement.orderId, orderGroups);
    });
    return grouped;
  }, [accountDrawEntitlements]);

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="profile-subpage" aria-label="구매 내역">
        <ProfileSubpageLead
          eyebrow="ORDER HISTORY"
          title="최근 구매를 확인하세요."
          description="일반 구매와 가챠·쿠지 결제 내역을 주문 단위로 모았습니다."
          summary={`${orderCount}건`}
        />
        <section className="profile-order-list" aria-label="주문 목록">
          {apiMode === "remote"
            ? accountOrders.map((order) => {
              const firstLine = order.lines[0];
              const product = firstLine ? catalogProducts.find((candidate) => candidate.id === firstLine.productId) : undefined;
              const totalQuantity = order.lines.reduce((sum, line) => sum + line.quantity, 0);
              const entitlementGroups = [...(entitlementGroupsByOrder.get(order.id)?.values() ?? [])];
              return (
                <article key={order.id} className="profile-order-card">
                  <div className="profile-order-meta"><span>{serverDateLabel(order.createdAt)}</span><em>{accountOrderStatusLabel(order.status)}</em></div>
                  <button
                    type="button"
                    className="profile-order-open"
                    disabled={!product}
                    onClick={() => { if (product) flow.push(createDetailScreen(product)); }}
                  >
                    <span className="profile-order-product">
                      <img src={product?.asset ?? EMPTY_PRODUCT_IMAGE_SRC} alt="" loading="eager" decoding="sync" draggable={false} />
                      <span>
                        <strong>{firstLine?.productName ?? "주문 상품 정보 없음"}{order.lines.length > 1 ? ` 외 ${order.lines.length - 1}개 상품` : ""}</strong>
                        <small>총 {totalQuantity}개 · {formatWon(order.total)}</small>
                      </span>
                      {product ? <IconChevronRightLine size={20} aria-hidden="true" /> : null}
                    </span>
                  </button>
                  <small>주문번호 {order.id}</small>
                  {entitlementGroups.map((entitlements) => {
                    const entitlement = entitlements[0]!;
                    const drawProduct = catalogProducts.find((candidate) => (
                      candidate.id === entitlement.product.id
                      && isRandomDrawCategory(candidate.categoryId)
                    ));
                    const probabilityVersions = [...new Set(entitlements.map((item) => item.probabilityVersion))].sort((a, b) => a - b);
                    return (
                      <section key={`${order.id}:${entitlement.product.id}`} className="profile-draw-resume" aria-label={`${entitlement.product.name} 이어 뽑기`}>
                        <div>
                          <img src={entitlement.product.imageUrl ?? EMPTY_PRODUCT_IMAGE_SRC} alt="" loading="eager" decoding="sync" draggable={false} />
                          <span>
                            <strong>{entitlement.product.name}</strong>
                            <small>미사용 추첨권 {entitlements.length}장 · 결제 확률표 {probabilityVersions.map((version) => `v${version}`).join(", ")}</small>
                          </span>
                        </div>
                        <ActionButton
                          type="button"
                          variant="neutralSolid"
                          size="medium"
                          disabled={!drawProduct}
                          onClick={() => {
                            if (!drawProduct) return;
                            prepareDraw(entitlements.length);
                            flow.push(createDrawScreen(
                              drawProduct,
                              entitlements.length,
                              order.id,
                              entitlements.map((item) => item.id),
                            ));
                          }}
                        >
                          {drawProduct ? `이어 뽑기 ${entitlements.length}회` : "이어 뽑기 불가"}
                        </ActionButton>
                        {!drawProduct ? <p role="status">현재 카탈로그에 없는 상품이라 이어 뽑기를 시작할 수 없습니다.</p> : null}
                      </section>
                    );
                  })}
                </article>
              );
            })
            : sessionCommerce.orders.map((order) => {
              const product = catalogProducts.find((candidate) => candidate.id === order.productId);
              return (
                <button
                  key={order.id}
                  type="button"
                  className="profile-order-card"
                  disabled={!product}
                  onClick={() => { if (product) flow.push(createDetailScreen(product)); }}
                >
                  <div className="profile-order-meta"><span>{order.orderedAt}</span><em>{order.status}</em></div>
                  <div className="profile-order-product">
                    <img src={order.productImage} alt="" loading="eager" decoding="sync" draggable={false} />
                    <span><strong>{order.productTitle}</strong><small>{order.quantity}{product ? commerceUnit(product) : "개"} · {formatWon(order.paidTotal)}</small></span>
                    <IconChevronRightLine size={20} aria-hidden="true" />
                  </div>
                  <small>주문번호 {order.id}</small>
                </button>
              );
            })}
        </section>
        {orderCount === 0 ? <p role="status">주문 내역이 없습니다.</p> : null}
        <p className="prototype-disclosure">{apiMode === "remote" ? "주문 금액과 상태는 서버 주문 목록 그대로 표시하며 결제·지급 상태를 클라이언트에서 추정하지 않습니다." : "구매 내역은 이 프로토타입 세션에서만 갱신되며 실제 주문 기록이 아닙니다."}</p>
      </main>
    </MobileScroll>
  );
}

function PointHistoryPage() {
  const { pointBalance, sessionCommerce, apiMode } = useDabboba();
  const screenFocusRef = useScreenEntryFocus();

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="profile-subpage" aria-label="포인트 내역">
        <ProfileSubpageLead
          eyebrow="POINT LEDGER"
          title="포인트 흐름을 확인하세요."
          description="적립과 사용 내역을 시간순으로 보여드려요."
          summary={formatPoints(pointBalance)}
        />
        <section className="profile-point-balance" aria-label="현재 포인트">
          <span>사용 가능한 포인트</span>
          <strong>{formatPoints(pointBalance)}</strong>
          <small>결제 단계에서 사용할 포인트를 직접 입력할 수 있어요.</small>
        </section>
        <section className="profile-point-list" aria-label="포인트 적립 및 사용 내역">
          {sessionCommerce.pointLedger.map((history) => (
            <article key={history.id} className="profile-point-row" data-direction={history.amount > 0 ? "plus" : "minus"}>
              <div><strong>{history.label}</strong><span>{history.detail} · {history.occurredAt}</span></div>
              <em>{history.amount > 0 ? "+" : ""}{formatPoints(history.amount)}</em>
            </article>
          ))}
        </section>
        <p className="prototype-disclosure">
          {apiMode === "remote"
            ? "잔액과 원장은 인증된 서버 계정 기준이며 클라이언트에서 임의 계산하지 않습니다."
            : "포인트 내역은 이 프로토타입 세션에서만 계산되며 실제 자산이 아닙니다."}
        </p>
      </main>
    </MobileScroll>
  );
}

function CustomerCenterPage() {
  const screenFocusRef = useScreenEntryFocus();

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="customer-center-page" aria-label="고객센터">
        <section className="customer-center-lead">
          <span>HELP DESK</span>
          <h1>궁금한 내용을<br />빠르게 확인하세요.</h1>
          <p>신청방은 프로필 메뉴에서 바로 들어갈 수 있고, 고객센터는 이용 안내와 문의를 담당합니다.</p>
        </section>

        <section className="customer-center-contact" aria-label="고객센터 운영 정보">
          <div><span>상담 운영</span><strong>평일 10:00–18:00</strong></div>
          <div><span>답변 안내</span><strong>접수 후 1–2영업일</strong></div>
          <p>주말과 공휴일에 남긴 문의는 다음 영업일부터 순서대로 확인합니다.</p>
        </section>

        <section className="customer-center-faq" aria-labelledby="customer-center-faq-title">
          <div className="section-heading"><h2 id="customer-center-faq-title">자주 묻는 질문</h2><span>{PROFILE_CUSTOMER_FAQS.length}개</span></div>
          {PROFILE_CUSTOMER_FAQS.map((faq) => (
            <details key={faq.question}>
              <summary>{faq.question}<IconPlusLine size={18} aria-hidden="true" /></summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </section>

        <section className="customer-center-channels" aria-label="문의 채널">
          <div><IconDot3HorizontalChatbubbleLeftLine size={22} aria-hidden="true" /><span><strong>1:1 문의</strong><small>문의하기에서 접수 상태와 운영자 답변을 확인할 수 있어요.</small></span></div>
          <div><IconReceiptLine size={22} aria-hidden="true" /><span><strong>주문·결제 문의</strong><small>주문번호를 함께 알려주면 더 빨리 확인할 수 있어요.</small></span></div>
        </section>
        <p className="prototype-disclosure">고객센터 내용과 운영시간은 현재 화면 확인용 테스트 정보입니다.</p>
      </main>
    </MobileScroll>
  );
}

function RequestRoomPage({ flow }: { flow: FlowControls }) {
  const {
    currentUserId,
    isAuthenticated,
    authIntent,
    setAuthIntent,
    requestComposerRequested,
    setRequestComposerRequested,
    catalogRequestComposerRequested,
    setCatalogRequestComposerRequested,
    productRequests,
    addProductRequest,
    submitCatalogRequest,
    likedProductRequestIds,
    toggleProductRequestLike,
    deleteProductRequest,
    catalogIps,
    apiMode,
    apiSyncState,
    apiSyncMessage,
  } = useDabboba();
  const keyboard = useKeyboard();
  const screenFocusRef = useScreenEntryFocus();
  const pendingCreateKeyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const pendingCatalogRequestKeyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const pendingLikeKeysRef = useRef<Record<string, { liked: boolean; key: string }>>({});
  const pendingDeleteRequestKeyRef = useRef<{ requestId: string; key: string } | null>(null);
  const [filter, setFilter] = useState<RequestFilter>("all");
  const [composerOpen, setComposerOpen] = useState(false);
  const [catalogRequestOpen, setCatalogRequestOpen] = useState(false);
  const [draftCategoryId, setDraftCategoryId] = useState<ProductCategoryId>(REQUEST_CATEGORY_IDS[0] ?? "gacha");
  const [draftIpId, setDraftIpId] = useState(catalogIps[0]?.id ?? "one-piece");
  const [draftDesiredItem, setDraftDesiredItem] = useState("");
  const [draftDetails, setDraftDetails] = useState("");
  const [submitMessage, setSubmitMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [catalogRequestKind, setCatalogRequestKind] = useState<"PRODUCT" | "IP">("PRODUCT");
  const [catalogRequestName, setCatalogRequestName] = useState("");
  const [catalogReferenceUrl, setCatalogReferenceUrl] = useState("");
  const [catalogRequestDescription, setCatalogRequestDescription] = useState("");
  const [catalogRequestStatus, setCatalogRequestStatus] = useState("");
  const [catalogRequestSubmitting, setCatalogRequestSubmitting] = useState(false);
  const [pendingLikeRequestIds, setPendingLikeRequestIds] = useState<Set<string>>(() => new Set());
  const [deleteRequestTarget, setDeleteRequestTarget] = useState<ProductRequest | null>(null);
  const [deletingRequest, setDeletingRequest] = useState(false);
  const customerVisibleRequests = productRequests.filter((request) => (
    isCustomerVisibleProductCategory(request.categoryId)
  ));
  const visibleRequests = filter === "all"
    ? customerVisibleRequests
    : customerVisibleRequests.filter((request) => request.categoryId === filter);
  const emptyRequestMessage = apiMode !== "remote"
    ? "이번 세션에 접수된 상품 신청이 없습니다."
    : apiSyncState === "loading"
      ? "서버 신청 목록을 불러오는 중입니다."
      : apiSyncState === "error"
        ? apiSyncMessage || "서버 신청 목록을 불러오지 못했습니다."
        : "등록된 상품 신청이 없습니다.";
  const catalogRequestValid = catalogRequestName.trim().length > 0
    && isOptionalAbsoluteUrl(catalogReferenceUrl);

  useEffect(() => {
    if (!isAuthenticated || !requestComposerRequested) return;
    setRequestComposerRequested(false);
    setComposerOpen(true);
  }, [isAuthenticated, requestComposerRequested, setRequestComposerRequested]);

  useEffect(() => {
    if (!isAuthenticated || !catalogRequestComposerRequested) return;
    setCatalogRequestComposerRequested(false);
    setCatalogRequestOpen(true);
  }, [catalogRequestComposerRequested, isAuthenticated, setCatalogRequestComposerRequested]);

  useEffect(() => {
    if (!catalogIps.length || catalogIps.some((ip) => ip.id === draftIpId)) return;
    setDraftIpId(catalogIps[0]!.id);
  }, [catalogIps, draftIpId]);

  const requestAccess = (intent: Extract<AuthIntent, { kind: "request-compose" | "request-like" }>) => {
    if (isAuthenticated) {
      if (intent.kind === "request-compose") setComposerOpen(true);
      else {
        if (pendingLikeRequestIds.has(intent.requestId)) return;
        const nextLiked = !likedProductRequestIds.has(intent.requestId);
        const previous = pendingLikeKeysRef.current[intent.requestId];
        const pending = previous?.liked === nextLiked
          ? previous
          : { liked: nextLiked, key: createSessionId("wanted-like") };
        pendingLikeKeysRef.current[intent.requestId] = pending;
        setPendingLikeRequestIds((current) => new Set(current).add(intent.requestId));
        setSubmitMessage("");
        void toggleProductRequestLike(intent.requestId, pending.key).then((result) => {
          setPendingLikeRequestIds((current) => {
            const next = new Set(current);
            next.delete(intent.requestId);
            return next;
          });
          setSubmitMessage(result.message);
          if (result.ok) delete pendingLikeKeysRef.current[intent.requestId];
        });
      }
      return;
    }
    keyboard.hide();
    setAuthIntent(intent);
  };

  const handleComposerOpenChange = (open: boolean) => {
    if (!open) keyboard.hide();
    setComposerOpen(open);
  };

  const requestCatalogAccess = () => {
    if (isAuthenticated) {
      setCatalogRequestStatus("");
      setCatalogRequestOpen(true);
      return;
    }
    keyboard.hide();
    setAuthIntent({ kind: "catalog-request" });
  };

  const handleCatalogRequestOpenChange = (open: boolean) => {
    if (!open) keyboard.hide();
    setCatalogRequestOpen(open);
  };

  const submitRequest = async () => {
    const desiredItem = draftDesiredItem.trim();
    const details = draftDetails.trim();
    if (!desiredItem || !details || submitting) return;
    const fingerprint = JSON.stringify([draftCategoryId, draftIpId, desiredItem, details]);
    const pending = pendingCreateKeyRef.current?.fingerprint === fingerprint
      ? pendingCreateKeyRef.current
      : { fingerprint, key: createSessionId("wanted-create") };
    pendingCreateKeyRef.current = pending;
    setSubmitting(true);
    setSubmitMessage("");
    const result = await addProductRequest({
      categoryId: draftCategoryId,
      ipId: draftIpId,
      desiredItem,
      details,
    }, pending.key);
    setSubmitting(false);
    if (!result.ok) {
      setSubmitMessage(result.message);
      return;
    }
    pendingCreateKeyRef.current = null;
    keyboard.hide();
    setDraftDesiredItem("");
    setDraftDetails("");
    setFilter("all");
    setComposerOpen(false);
    setSubmitMessage(result.message);
  };

  const submitCatalogAdditionRequest = async () => {
    const name = catalogRequestName.trim();
    const referenceUrl = catalogReferenceUrl.trim();
    const description = catalogRequestDescription.trim();
    if (!catalogRequestValid || catalogRequestSubmitting) return;
    const fingerprint = JSON.stringify([catalogRequestKind, name, referenceUrl, description]);
    const pending = pendingCatalogRequestKeyRef.current?.fingerprint === fingerprint
      ? pendingCatalogRequestKeyRef.current
      : { fingerprint, key: createSessionId("catalog-request") };
    pendingCatalogRequestKeyRef.current = pending;
    setCatalogRequestSubmitting(true);
    setCatalogRequestStatus("");
    const result = await submitCatalogRequest({
      kind: catalogRequestKind,
      name,
      referenceUrl: referenceUrl || null,
      description: description || null,
    }, pending.key);
    setCatalogRequestSubmitting(false);
    setCatalogRequestStatus(result.message);
    if (!result.ok) return;
    pendingCatalogRequestKeyRef.current = null;
    keyboard.hide();
    setCatalogRequestName("");
    setCatalogReferenceUrl("");
    setCatalogRequestDescription("");
    setCatalogRequestOpen(false);
  };

  const confirmRequestDeletion = async () => {
    if (!deleteRequestTarget || deletingRequest) return;
    const previous = pendingDeleteRequestKeyRef.current;
    const pending = previous?.requestId === deleteRequestTarget.id
      ? previous
      : { requestId: deleteRequestTarget.id, key: createSessionId("wanted-delete") };
    pendingDeleteRequestKeyRef.current = pending;
    setDeletingRequest(true);
    setSubmitMessage("");
    const result = await deleteProductRequest(deleteRequestTarget.id, deleteRequestTarget.version ?? 1, pending.key);
    setDeletingRequest(false);
    setSubmitMessage(result.message);
    if (!result.ok) return;
    pendingDeleteRequestKeyRef.current = null;
    setDeleteRequestTarget(null);
  };

  return (
    <>
      <MobileScroll className="app-screen dabboba-screen">
        <main ref={screenFocusRef} tabIndex={-1} className="request-room-page" aria-label="상품 신청방">
          <section className="request-room-lead">
            <span>WISH BOARD</span>
            <h1>어떤 상품을<br />만나고 싶나요?</h1>
            <p>원하는 굿즈를 신청하고, 같은 상품을 기다리는 사람과 좋아요를 모아보세요.</p>
          </section>

          <button type="button" className="request-composer-callout" disabled={!catalogIps.length} onClick={() => requestAccess({ kind: "request-compose" })}>
            <span aria-hidden="true"><IconPencilLine size={21} /></span>
            <div><strong>원하는 상품 신청하기</strong><small>{catalogIps.length ? "카테고리 · 작품 IP · 상품명을 알려주세요." : "작품 목록을 불러온 뒤 신청할 수 있어요."}</small></div>
            <IconChevronRightLine size={21} aria-hidden="true" />
          </button>
          {submitMessage ? <p className="request-submit-status" role="status">{submitMessage}</p> : null}
          <button type="button" className="settings-secondary-action" onClick={requestCatalogAccess}>
            목록에 없는 상품·작품 IP를 관리자에게 요청
          </button>
          {catalogRequestStatus && !catalogRequestOpen ? <p className="request-submit-status" role="status">{catalogRequestStatus}</p> : null}

          <Carousel className="request-filter-carousel" contentClassName="request-filter-rail" ariaLabel="신청 상품 카테고리">
            <button
              type="button"
              className="filter-chip"
              data-selected={filter === "all" ? "true" : "false"}
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              전체
            </button>
            {customerVisibleRequestCategoryIds.map((categoryId) => (
              <button
                key={categoryId}
                type="button"
                className="filter-chip"
                data-selected={filter === categoryId ? "true" : "false"}
                aria-pressed={filter === categoryId}
                onClick={() => setFilter(categoryId)}
              >
                {categoryLabel(categoryId)}
              </button>
            ))}
          </Carousel>

          <section className="request-list" aria-labelledby="request-list-title">
            <div className="section-heading">
              <h2 id="request-list-title">모인 신청</h2>
              <span>{visibleRequests.length}개</span>
            </div>
            {visibleRequests.map((request) => {
              const ip = catalogIps.find((item) => item.id === request.ipId);
              const liked = likedProductRequestIds.has(request.id);
              const ownRequest = Boolean(currentUserId) && request.authorId === currentUserId;
              return (
                <article key={request.id} className="request-card">
                  {ip?.image ? <img src={ip.image} alt="" loading="eager" decoding="sync" draggable={false} /> : <span className="request-card-image-placeholder" aria-hidden="true" />}
                  <div className="request-card-copy">
                    <div><span>{categoryLabel(request.categoryId)}</span><small>{request.author} · {request.time}</small></div>
                    <em>{ip?.nameKo ?? "작품 미지정"}</em>
                    <h3>{request.desiredItem}</h3>
                    <p>{request.details}</p>
                    {ownRequest ? (
                      <button type="button" aria-label={`${request.desiredItem} 신청 글 삭제`} onClick={() => setDeleteRequestTarget(request)}>
                        <IconTrashcanLine size={18} aria-hidden="true" />
                        <span>내 신청 삭제</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        aria-label={liked ? `${request.desiredItem} 좋아요 취소` : `${request.desiredItem} 좋아요`}
                        aria-pressed={liked}
                        aria-busy={pendingLikeRequestIds.has(request.id)}
                        disabled={pendingLikeRequestIds.has(request.id)}
                        onClick={() => requestAccess({ kind: "request-like", requestId: request.id })}
                      >
                        {liked ? <IconHeartFill size={18} aria-hidden="true" /> : <IconHeartLine size={18} aria-hidden="true" />}
                        <span>{pendingLikeRequestIds.has(request.id) ? "반영 중" : `같이 원해요 ${request.likes}`}</span>
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
            {visibleRequests.length === 0 ? <p role="status">{emptyRequestMessage}</p> : null}
          </section>
          <p className="prototype-disclosure request-room-disclosure">
            {apiMode === "remote"
              ? "신청 목록·작성·같이 원해요·작성자 삭제 상태는 서버 신청방과 동기화됩니다. 로그인하지 않으면 공개 목록만 표시합니다."
              : "신청과 좋아요는 화면 확인용 테스트 데이터이며 새로고침하면 초기화됩니다."}
          </p>
        </main>
      </MobileScroll>

      {!isAuthenticated && (authIntent?.kind === "request-compose" || authIntent?.kind === "request-like" || authIntent?.kind === "catalog-request") ? (
        <GuestAuthPrompt
          intent={authIntent}
          onDismiss={() => setAuthIntent(null)}
          onLogin={() => flow.push(createLoginScreen())}
        />
      ) : null}

      <BottomSheet
        open={Boolean(deleteRequestTarget)}
        onOpenChange={(open) => {
          if (!open && !deletingRequest) setDeleteRequestTarget(null);
        }}
        title="신청 글을 삭제할까요?"
        description={deleteRequestTarget ? `“${deleteRequestTarget.desiredItem}” 신청은 공개 목록에서 사라집니다.` : "삭제할 신청을 확인해 주세요."}
        snap={0.4}
      >
        <div className="settings-confirm-actions">
          <ActionButton type="button" variant="brandSolid" size="large" className="sheet-primary-button account-deletion-button" loading={deletingRequest} disabled={deletingRequest} onClick={() => void confirmRequestDeletion()}>{deletingRequest ? "삭제 중" : "신청 삭제"}</ActionButton>
          <button type="button" disabled={deletingRequest} onClick={() => setDeleteRequestTarget(null)}>취소</button>
        </div>
      </BottomSheet>

      <BottomSheet
        open={composerOpen}
        onOpenChange={handleComposerOpenChange}
        title="상품 신청하기"
        description="DABBOBA에서 만나고 싶은 상품을 알려주세요."
        snap={0.86}
      >
        <div className="request-compose-form">
          <div className="compose-category-list" role="radiogroup" aria-label="신청 카테고리">
            {customerVisibleRequestCategoryIds.map((categoryId, index) => (
              <button
                key={categoryId}
                type="button"
                role="radio"
                aria-checked={draftCategoryId === categoryId}
                tabIndex={draftCategoryId === categoryId ? 0 : -1}
                data-selected={draftCategoryId === categoryId ? "true" : "false"}
                onKeyDown={(event) => handleRadioArrow(event, customerVisibleRequestCategoryIds, index, setDraftCategoryId)}
                onClick={() => setDraftCategoryId(categoryId)}
              >
                {categoryLabel(categoryId)}
              </button>
            ))}
          </div>
          <label>
            <span>작품 IP</span>
            <select value={draftIpId} onChange={(event) => setDraftIpId(event.currentTarget.value)}>
              {catalogIps.map((ip) => <option key={ip.id} value={ip.id}>{ip.nameKo}</option>)}
            </select>
          </label>
          <label>
            <span>원하는 상품</span>
            <KeyboardInput
              value={draftDesiredItem}
              maxLength={70}
              placeholder="상품명, 캐릭터, 에디션 등을 적어주세요"
              onChange={(event) => setDraftDesiredItem(event.currentTarget.value)}
              onBlur={() => keyboard.hide()}
            />
          </label>
          <label>
            <span>신청 내용</span>
            <KeyboardTextarea
              value={draftDetails}
              maxLength={300}
              placeholder="원하는 크기, 버전, 판매 방식 등을 알려주세요."
              onChange={(event) => setDraftDetails(event.currentTarget.value)}
              onBlur={() => keyboard.hide()}
            />
          </label>
          <ActionButton
            type="button"
            variant="brandSolid"
            size="large"
            className="sheet-primary-button"
            disabled={!catalogIps.length || !draftDesiredItem.trim() || !draftDetails.trim() || submitting}
            aria-busy={submitting}
            onPointerDown={(event) => event.preventDefault()}
            onClick={submitRequest}
          >
            {submitting ? "등록 중" : "신청 등록하기"}
          </ActionButton>
        </div>
      </BottomSheet>

      <BottomSheet
        open={catalogRequestOpen}
        onOpenChange={handleCatalogRequestOpenChange}
        title="카탈로그 추가 요청"
        description="신청방 글과 별도로 관리자 검토가 필요한 상품 또는 작품 IP를 알려주세요."
        snap={0.82}
      >
        <form className="request-compose-form" onSubmit={(event) => { event.preventDefault(); void submitCatalogAdditionRequest(); }} noValidate>
          <div className="compose-category-list" role="radiogroup" aria-label="카탈로그 요청 종류">
            {(["PRODUCT", "IP"] as const).map((kind, index, kinds) => (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={catalogRequestKind === kind}
                tabIndex={catalogRequestKind === kind ? 0 : -1}
                data-selected={catalogRequestKind === kind ? "true" : "false"}
                onKeyDown={(event) => handleRadioArrow(event, kinds, index, setCatalogRequestKind)}
                onClick={() => setCatalogRequestKind(kind)}
              >
                {kind === "PRODUCT" ? "상품" : "작품 IP"}
              </button>
            ))}
          </div>
          <label>
            <span>{catalogRequestKind === "PRODUCT" ? "상품 이름" : "작품 IP 이름"}</span>
            <KeyboardInput
              value={catalogRequestName}
              maxLength={240}
              placeholder={catalogRequestKind === "PRODUCT" ? "정확한 상품명이나 에디션" : "작품명과 알려진 별칭"}
              onChange={(event) => setCatalogRequestName(event.currentTarget.value)}
              onBlur={() => keyboard.hide()}
            />
          </label>
          <label>
            <span>참고 링크 <small>선택</small></span>
            <KeyboardInput
              type="url"
              value={catalogReferenceUrl}
              maxLength={2_000}
              placeholder="https://"
              aria-invalid={!isOptionalAbsoluteUrl(catalogReferenceUrl)}
              onChange={(event) => setCatalogReferenceUrl(event.currentTarget.value)}
              onBlur={() => keyboard.hide()}
            />
            {!isOptionalAbsoluteUrl(catalogReferenceUrl) ? <small className="profile-field-error">프로토콜을 포함한 전체 링크를 입력해 주세요.</small> : null}
          </label>
          <label>
            <span>설명 <small>선택</small></span>
            <KeyboardTextarea
              value={catalogRequestDescription}
              maxLength={1_000}
              placeholder="관리자가 대상을 구분할 수 있는 캐릭터, 제조사, 버전 등을 알려주세요."
              onChange={(event) => setCatalogRequestDescription(event.currentTarget.value)}
              onBlur={() => keyboard.hide()}
            />
          </label>
          <ActionButton
            type="submit"
            variant="brandSolid"
            size="large"
            className="sheet-primary-button"
            disabled={!catalogRequestValid || catalogRequestSubmitting}
            aria-busy={catalogRequestSubmitting}
          >
            {catalogRequestSubmitting ? "처리 중" : apiMode === "remote" ? "관리자 검토 요청하기" : "프리뷰 입력 확인"}
          </ActionButton>
          {catalogRequestStatus && catalogRequestOpen ? <span className="exchange-field-notice" role="status">{catalogRequestStatus}</span> : null}
          <p className="prototype-disclosure">
            {apiMode === "remote"
              ? "서버에 PENDING 요청으로 저장되며 승인·보류·거절 결과는 관리자가 결정합니다."
              : "개발 프리뷰에서는 입력 화면만 확인하며 서버나 관리자에게 전송되지 않습니다."}
          </p>
        </form>
      </BottomSheet>
    </>
  );
}

function ProfilePage({ flow }: { flow: FlowControls }) {
  const {
    currentUserId,
    pointBalance,
    exchangePosts,
    profile,
    profileSaveNotice,
    sessionCommerce,
    setProfileSaveNotice,
    apiMode,
  } = useDabboba();
  const screenFocusRef = useScreenEntryFocus();
  const myPostCount = exchangePosts.filter((post) => post.authorId === currentUserId).length;
  const storedCount = sessionCommerce.inventoryUnits.filter((item) => (
    item.ownerId === currentUserId && item.shippingStatus === "stored"
  )).length;

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <NativeBridgeController rootScreenId="root-profile" />
      <main ref={screenFocusRef} tabIndex={-1} className="root-tab-page profile-page" aria-label="내 프로필">
        <button
          type="button"
          className="profile-identity"
          aria-label="프로필 상세 보기"
          onClick={() => {
            setProfileSaveNotice("");
            flow.push(createProfileDetailScreen());
          }}
        >
          <span className="profile-avatar"><IconPerson2Line size={30} aria-hidden="true" /></span>
          <div><strong>{profile.nickname}</strong><span>{profile.bio}</span></div>
          <IconChevronRightLine size={22} aria-hidden="true" />
        </button>

        <section className="profile-wallet" aria-label="포인트와 쿠폰">
          <div><span>내 포인트</span><strong>{formatPoints(pointBalance)}</strong></div>
          <div><span>내 쿠폰</span><strong>{apiMode === "remote" ? "준비 중" : "1장"}</strong></div>
        </section>

        <section className="profile-activity" aria-label="나의 활동">
          <div><strong>{sessionCommerce.wishlistProductIds.length}</strong><span>찜</span></div>
          <div><strong>{storedCount}</strong><span>보관함</span></div>
          <div><strong>{myPostCount}</strong><span>교환글</span></div>
        </section>

        <button
          type="button"
          className="profile-request-room-entry"
          aria-label="신청방 열기"
          onClick={() => {
            setProfileSaveNotice("");
            flow.push(createRequestRoomScreen());
          }}
        >
          <span className="profile-request-room-icon" aria-hidden="true"><IconPencilLine size={23} /></span>
          <span className="profile-request-room-copy">
            <small>WISH BOARD</small>
            <strong>신청방</strong>
            <em>원하는 상품을 함께 신청해요.</em>
          </span>
          <IconChevronRightLine size={22} aria-hidden="true" />
        </button>

        <section className="profile-menu" aria-label="프로필 메뉴">
          {PROFILE_MENU_ITEMS.map((menu) => (
            <button
              key={menu.label}
              type="button"
              onClick={() => {
                setProfileSaveNotice("");
                flow.push(menu.createScreen());
              }}
            >
              <span>{menu.label}</span>
              <IconChevronRightLine size={21} aria-hidden="true" />
            </button>
          ))}
        </section>
        {profileSaveNotice ? <p className="profile-message" role="status">{profileSaveNotice}</p> : null}
        <p className="prototype-disclosure profile-disclosure">
          {apiMode === "remote"
            ? "프로필·찜·보관함·주문·포인트는 인증된 서버 계정 기준입니다. 쿠폰 API가 없어 보유 수량과 사용 기능은 제공하지 않습니다."
            : "프로필 활동은 현재 브라우저의 프로토타입 세션에만 저장됩니다."}
        </p>
      </main>
    </MobileScroll>
  );
}

function ProfileDetailPage({ flow }: { flow: FlowControls }) {
  const { profile, setProfile, setProfileSaveNotice } = useDabboba();
  const { updateProfile, catalogIps, apiMode } = useDabboba();
  const keyboard = useKeyboard();
  const screenFocusRef = useScreenEntryFocus();
  const pendingIdempotencyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const [nickname, setNickname] = useState(profile.nickname);
  const [bio, setBio] = useState(profile.bio);
  const [favoriteIpId, setFavoriteIpId] = useState(profile.favoriteIpId);
  const [favoriteOpen, setFavoriteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const favoriteIp = catalogIps.find((ip) => ip.id === favoriteIpId);
  const trimmedNickname = nickname.trim();
  const nicknameIsValid = trimmedNickname.length >= 2;
  const nicknameError = nicknameIsValid ? "" : "닉네임은 2~12자로 입력해 주세요.";

  const saveProfile = async () => {
    const nextNickname = trimmedNickname;
    if (!nicknameIsValid || saving) return;
    keyboard.hide();
    if (apiMode !== "remote") {
      setProfile({
        id: profile.id,
        nickname: nextNickname,
        bio: bio.trim() || "좋아하는 굿즈를 모으고 있어요.",
        favoriteIpId,
      });
      setProfileSaveNotice("프로필을 저장했어요.");
      flow.pop();
      return;
    }
    setSaving(true);
    setSaveStatus("");
    const fingerprint = JSON.stringify([nextNickname, bio.trim(), favoriteIpId]);
    const pending = pendingIdempotencyRef.current?.fingerprint === fingerprint
      ? pendingIdempotencyRef.current
      : { fingerprint, key: createSessionId("profile-save") };
    pendingIdempotencyRef.current = pending;
    const result = await updateProfile({
      nickname: nextNickname,
      bio: apiMode === "remote" ? bio.trim() : bio.trim() || "좋아하는 굿즈를 모으고 있어요.",
      favoriteIpId,
    }, pending.key);
    setSaving(false);
    setSaveStatus(result.message);
    if (result.data && !result.ok) {
      const latest = mapApiAccountProfile(result.data);
      setNickname(latest.nickname);
      setBio(latest.bio);
      setFavoriteIpId(latest.favoriteIpId);
    }
    if (!result.ok) return;
    pendingIdempotencyRef.current = null;
    setProfileSaveNotice(result.message);
    flow.pop();
  };

  return (
    <>
      <MobileScroll className="app-screen dabboba-screen">
        <main ref={screenFocusRef} tabIndex={-1} className="profile-detail-page" aria-label="프로필 상세 및 수정">
          <section className="profile-detail-summary" aria-label="현재 프로필 미리보기">
            <span className="profile-detail-avatar"><IconPerson2Line size={34} aria-hidden="true" /></span>
            <div>
              <strong>{nickname.trim() || "닉네임을 입력해 주세요"}</strong>
              <span>{favoriteIp?.nameKo ?? "좋아하는 작품 선택"}</span>
            </div>
          </section>

          <form className="profile-edit-form" onSubmit={(event) => { event.preventDefault(); void saveProfile(); }} noValidate>
            <div className="profile-edit-field">
              <div className="profile-field-heading">
                <label htmlFor="profile-nickname">닉네임</label>
                <small id="profile-nickname-count">{nickname.length}/12</small>
              </div>
              <KeyboardInput
                id="profile-nickname"
                value={nickname}
                required
                minLength={2}
                maxLength={12}
                placeholder="닉네임을 입력해 주세요"
                aria-invalid={!nicknameIsValid}
                aria-describedby={`profile-nickname-count${nicknameError ? " profile-nickname-error" : ""}`}
                onChange={(event) => setNickname(event.currentTarget.value)}
                onBlur={() => keyboard.hide()}
              />
              {nicknameError ? <span id="profile-nickname-error" className="profile-field-error">{nicknameError}</span> : null}
            </div>

            <div className="profile-edit-field">
              <div className="profile-field-heading">
                <label htmlFor="profile-bio">한 줄 소개</label>
                <small id="profile-bio-count">{bio.length}/60</small>
              </div>
              <KeyboardTextarea
                id="profile-bio"
                value={bio}
                maxLength={60}
                placeholder="수집 취향을 간단히 소개해 보세요"
                aria-describedby="profile-bio-count"
                onChange={(event) => setBio(event.currentTarget.value)}
                onBlur={() => keyboard.hide()}
              />
            </div>

            <div className="profile-favorite-field">
              <span>좋아하는 작품</span>
              <button
                type="button"
                aria-label={`좋아하는 작품, 현재 ${favoriteIp?.nameKo ?? "선택 안 됨"}, 변경`}
                onClick={() => setFavoriteOpen(true)}
              >
                {favoriteIp?.image ? <img src={favoriteIp.image} alt="" decoding="async" draggable={false} /> : null}
                <span><strong>{favoriteIp?.nameKo ?? "작품 선택"}</strong><small>대표 작품으로 표시됩니다.</small></span>
                <IconChevronRightLine size={21} aria-hidden="true" />
              </button>
            </div>

            <ActionButton
              type="submit"
              variant="brandSolid"
              size="large"
              className="sheet-primary-button profile-save-button"
              disabled={!nicknameIsValid || saving}
            >
              {saving ? "저장 중" : "저장하기"}
            </ActionButton>
            {saveStatus ? <p className="profile-message" role="status">{saveStatus}</p> : null}
          </form>

          <section className="member-info-entry" aria-labelledby="member-info-entry-title">
            <div>
              <small>ACCOUNT</small>
              <h2 id="member-info-entry-title">회원정보 변경</h2>
              <p>휴대폰 번호, 배송지, 결제 카드와 개인정보를 관리해요.</p>
            </div>
            <button
              type="button"
              aria-label="회원정보 변경 열기"
              onClick={() => {
                keyboard.hide();
                flow.push(createMemberInfoScreen());
              }}
            >
              <span><strong>회원정보 관리</strong><small>개인정보 · 배송 · 결제 · 보안</small></span>
              <IconChevronRightLine size={21} aria-hidden="true" />
            </button>
          </section>

          <p className="prototype-disclosure profile-detail-disclosure">
            {apiMode === "remote"
              ? "닉네임·소개·좋아하는 작품은 버전 충돌을 확인한 뒤 서버 계정에 저장됩니다."
              : "현재 변경 내용은 이 브라우저에만 임시로 반영되며 실제 계정에는 저장되지 않습니다."}
          </p>
        </main>
      </MobileScroll>

      <BottomSheet
        open={favoriteOpen}
        onOpenChange={setFavoriteOpen}
        title="좋아하는 작품"
        description="프로필에 표시할 대표 작품을 골라주세요."
        snap={0.76}
      >
        <div className="profile-ip-options" role="radiogroup" aria-label="좋아하는 작품">
          {catalogIps.map((ip, index) => {
            const selected = ip.id === favoriteIpId;
            return (
              <button
                key={ip.id}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                data-selected={selected ? "true" : "false"}
                onKeyDown={(event) => handleRadioArrow(event, catalogIps, index, (nextIp) => setFavoriteIpId(nextIp.id))}
                onClick={() => { setFavoriteIpId(ip.id); setFavoriteOpen(false); }}
              >
                {ip.image ? <img
                  src={ip.image}
                  alt=""
                  loading={index < 8 ? "eager" : "lazy"}
                  decoding={index < 8 ? "sync" : "async"}
                  draggable={false}
                /> : null}
                <span>{ip.nameKo}</span>
                {selected ? <IconCheckmarkCircleFill size={20} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      </BottomSheet>
    </>
  );
}

function maskedPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return phone || "등록 전";
  return `${digits.slice(0, 3)}-${digits.slice(3, digits.length - 4).replace(/./g, "•")}-${digits.slice(-4)}`;
}

function MemberSettingsLead({ label, title, description }: { label: string; title: string; description: string }) {
  return (
    <section className="member-settings-lead">
      <small>{label}</small>
      <h1>{title}</h1>
      <p>{description}</p>
    </section>
  );
}

function MemberSettingRow({
  label,
  summary,
  onClick,
  disabled = false,
}: {
  label: string;
  summary: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}>
      <span><strong>{label}</strong><small>{summary}</small></span>
      {disabled ? <small>준비 중</small> : <IconChevronRightLine size={21} aria-hidden="true" />}
    </button>
  );
}

function MemberInfoPage({ flow }: { flow: FlowControls }) {
  const {
    memberSettings,
    memberSaveNotice,
    setMemberSaveNotice,
    notificationPreferences,
    apiMode,
    isAuthenticated,
  } = useDabboba();
  const screenFocusRef = useScreenEntryFocus();
  const open = (screen: FlowScreen) => {
    setMemberSaveNotice("");
    flow.push(screen);
  };
  const cardSummary = memberSettings.paymentCard
    ? `${memberSettings.paymentCard.issuer} •••• ${memberSettings.paymentCard.last4}`
    : "등록된 카드가 없어요";

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="member-settings-page" aria-label="회원정보 변경">
        <MemberSettingsLead
          label="ACCOUNT"
          title="내 정보와 결제 설정"
          description="주문과 배송에 쓰이는 정보를 항목별로 확인하고 바꿀 수 있어요."
        />

        {memberSaveNotice ? <p className="profile-message member-save-message" role="status">{memberSaveNotice}</p> : null}

        <section className="member-settings-section" aria-labelledby="member-personal-title">
          <h2 id="member-personal-title">개인정보</h2>
          <div className="member-settings-list">
            <MemberSettingRow
              label="기본 개인정보"
              summary={apiMode === "remote" ? "서버 변경 API 준비 중" : `${memberSettings.personal.legalName} · ${memberSettings.personal.birthDate}`}
              disabled={apiMode === "remote"}
              onClick={() => open(createPersonalInformationScreen())}
            />
            <MemberSettingRow label="휴대폰 번호" summary={apiMode === "remote" ? "본인 인증 API 준비 중" : maskedPhone(memberSettings.personal.phone)} disabled={apiMode === "remote"} onClick={() => open(createPhoneNumberScreen())} />
            <MemberSettingRow label="이메일" summary={apiMode === "remote" ? "이메일 변경 API 준비 중" : memberSettings.personal.email} disabled={apiMode === "remote"} onClick={() => open(createEmailAddressScreen())} />
          </div>
        </section>

        <section className="member-settings-section" aria-labelledby="member-commerce-title">
          <h2 id="member-commerce-title">배송과 결제</h2>
          <div className="member-settings-list">
            <MemberSettingRow
              label="기본 배송지"
              summary={memberSettings.defaultAddress.addressLine1
                ? `${memberSettings.defaultAddress.recipient} · ${memberSettings.defaultAddress.addressLine1}`
                : "등록된 배송지가 없어요"}
              onClick={() => open(createDefaultAddressScreen())}
            />
            <MemberSettingRow label="결제 카드" summary={apiMode === "remote" ? "결제사 연동 준비 중" : cardSummary} disabled={apiMode === "remote"} onClick={() => open(createPaymentCardsScreen())} />
            <MemberSettingRow
              label="결제 설정"
              summary={apiMode === "remote" ? "결제 설정 API 준비 중" : memberSettings.paymentPreferences.requirePaymentConfirmation ? "결제 전 확인 사용 중" : "바로 결제 사용 중"}
              disabled={apiMode === "remote"}
              onClick={() => open(createPaymentPreferencesScreen())}
            />
          </div>
        </section>

        <section className="member-settings-section" aria-labelledby="member-security-title">
          <h2 id="member-security-title">보안과 동의</h2>
          <div className="member-settings-list">
            <MemberSettingRow
              label="로그인 및 보안"
              summary={apiMode === "remote" ? "보안 설정 API 준비 중" : `${memberSettings.security.socialLogin} · 비밀번호 ${memberSettings.security.passwordUpdatedAt} 변경`}
              disabled={apiMode === "remote"}
              onClick={() => open(createLoginSecurityScreen())}
            />
            <MemberSettingRow
              label="개인정보 및 수신 동의"
              summary={apiMode === "remote"
                ? notificationPreferences ? `서버 설정 v${notificationPreferences.version}` : "로그인 후 설정 확인"
                : memberSettings.privacy.marketingPush ? "앱 푸시 수신 중" : "마케팅 알림 수신 안 함"}
              disabled={apiMode === "remote" && (!isAuthenticated || !notificationPreferences)}
              onClick={() => open(createPrivacySettingsScreen())}
            />
          </div>
        </section>

        <p className="prototype-disclosure member-settings-disclosure">
          {apiMode === "remote"
            ? "기본 배송지와 알림 수신 동의는 서버 계정과 동기화됩니다. 이름·연락처·이메일·카드·결제·보안 변경은 서버 계약 전까지 비활성화됩니다."
            : "현재 회원·배송·결제 정보는 화면 확인용 로컬 테스트 데이터이며 서버나 결제사에 저장되지 않습니다."}
        </p>
      </main>
    </MobileScroll>
  );
}

function PersonalInformationPage({ flow }: { flow: FlowControls }) {
  const { memberSettings, setMemberSettings, setMemberSaveNotice, apiMode } = useDabboba();
  const keyboard = useKeyboard();
  const screenFocusRef = useScreenEntryFocus();
  const [legalName, setLegalName] = useState(memberSettings.personal.legalName);
  const [birthDate, setBirthDate] = useState(memberSettings.personal.birthDate);
  const valid = legalName.trim().length >= 2 && birthDate.trim().length >= 8;

  const save = () => {
    if (!valid || apiMode === "remote") return;
    keyboard.hide();
    setMemberSettings((current) => ({
      ...current,
      personal: { ...current.personal, legalName: legalName.trim(), birthDate: birthDate.trim() },
    }));
    setMemberSaveNotice("개인정보를 저장했어요.");
    flow.pop();
  };

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="member-settings-page" aria-label="개인정보 수정">
        <MemberSettingsLead label="PERSONAL" title="기본 개인정보" description="본인 확인에 사용하는 이름과 생년월일을 관리해요." />
        <form className="member-settings-form" onSubmit={(event) => { event.preventDefault(); save(); }} noValidate>
          <label><span>이름</span><KeyboardInput value={legalName} maxLength={20} onChange={(event) => setLegalName(event.currentTarget.value)} onBlur={() => keyboard.hide()} /></label>
          <label><span>생년월일</span><KeyboardInput value={birthDate} inputMode="numeric" maxLength={10} placeholder="1995.03.18" onChange={(event) => setBirthDate(event.currentTarget.value)} onBlur={() => keyboard.hide()} /></label>
          <ActionButton type="submit" variant="brandSolid" size="large" className="sheet-primary-button" disabled={!valid || apiMode === "remote"}>{apiMode === "remote" ? "개인정보 API 준비 중" : "기본 정보 저장하기"}</ActionButton>
        </form>
        <p className="prototype-disclosure member-detail-disclosure">{apiMode === "remote" ? "법적 이름·생년월일 변경 API가 없어 서버에는 저장하지 않습니다." : "법적 이름과 생년월일 변경은 실제 서비스에서 추가 본인 확인이 필요할 수 있습니다."}</p>
      </main>
    </MobileScroll>
  );
}

function PhoneNumberPage({ flow }: { flow: FlowControls }) {
  const { memberSettings, setMemberSettings, setMemberSaveNotice, apiMode } = useDabboba();
  const keyboard = useKeyboard();
  const screenFocusRef = useScreenEntryFocus();
  const [phone, setPhone] = useState(memberSettings.personal.phone);
  const [verificationCode, setVerificationCode] = useState("");
  const phoneDigits = phone.replace(/\D/g, "");
  const valid = phoneDigits.length >= 10 && /^\d{6}$/.test(verificationCode);

  const save = () => {
    if (!valid || apiMode === "remote") return;
    keyboard.hide();
    setMemberSettings((current) => ({ ...current, personal: { ...current.personal, phone: phoneDigits } }));
    setMemberSaveNotice("휴대폰 번호를 변경했어요.");
    setVerificationCode("");
    flow.pop();
  };

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="member-settings-page" aria-label="휴대폰 번호 변경">
        <MemberSettingsLead label="PHONE" title="휴대폰 번호" description="주문과 배송 안내를 받을 번호를 변경해요." />
        <form className="member-settings-form" onSubmit={(event) => { event.preventDefault(); save(); }} noValidate>
          <label><span>새 휴대폰 번호</span><KeyboardInput value={phone} inputMode="tel" maxLength={13} placeholder="01012345678" onChange={(event) => setPhone(event.currentTarget.value)} onBlur={() => keyboard.hide()} /></label>
          <label><span>인증번호</span><KeyboardInput value={verificationCode} inputMode="numeric" maxLength={6} placeholder="화면 확인용 6자리" onChange={(event) => setVerificationCode(event.currentTarget.value.replace(/\D/g, ""))} onBlur={() => keyboard.hide()} /><small className="member-field-help">프로토타입에서는 임의의 숫자 6자리로 인증 흐름을 확인할 수 있어요.</small></label>
          <ActionButton type="submit" variant="brandSolid" size="large" className="sheet-primary-button" disabled={!valid || apiMode === "remote"}>{apiMode === "remote" ? "휴대폰 인증 API 준비 중" : "휴대폰 번호 변경하기"}</ActionButton>
        </form>
        <p className="prototype-disclosure member-detail-disclosure">{apiMode === "remote" ? "휴대폰 인증·변경 API가 없어 입력과 저장을 제공하지 않습니다." : "실제 인증 문자는 발송되지 않으며 번호도 서버에 저장되지 않습니다."}</p>
      </main>
    </MobileScroll>
  );
}

function EmailAddressPage({ flow }: { flow: FlowControls }) {
  const { memberSettings, setMemberSettings, setMemberSaveNotice, apiMode } = useDabboba();
  const keyboard = useKeyboard();
  const screenFocusRef = useScreenEntryFocus();
  const [email, setEmail] = useState(memberSettings.personal.email);
  const [verificationCode, setVerificationCode] = useState("");
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && /^\d{6}$/.test(verificationCode);

  const save = () => {
    if (!valid || apiMode === "remote") return;
    keyboard.hide();
    setMemberSettings((current) => ({ ...current, personal: { ...current.personal, email: email.trim() } }));
    setMemberSaveNotice("이메일을 변경했어요.");
    setVerificationCode("");
    flow.pop();
  };

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="member-settings-page" aria-label="이메일 변경">
        <MemberSettingsLead label="EMAIL" title="이메일" description="결제 내역과 계정 안내를 받을 이메일을 변경해요." />
        <form className="member-settings-form" onSubmit={(event) => { event.preventDefault(); save(); }} noValidate>
          <label><span>새 이메일</span><KeyboardInput value={email} inputMode="email" maxLength={60} placeholder="name@example.com" onChange={(event) => setEmail(event.currentTarget.value)} onBlur={() => keyboard.hide()} /></label>
          <label><span>인증번호</span><KeyboardInput value={verificationCode} inputMode="numeric" maxLength={6} placeholder="화면 확인용 6자리" onChange={(event) => setVerificationCode(event.currentTarget.value.replace(/\D/g, ""))} onBlur={() => keyboard.hide()} /><small className="member-field-help">프로토타입에서는 임의의 숫자 6자리로 인증 흐름을 확인할 수 있어요.</small></label>
          <ActionButton type="submit" variant="brandSolid" size="large" className="sheet-primary-button" disabled={!valid || apiMode === "remote"}>{apiMode === "remote" ? "이메일 인증 API 준비 중" : "이메일 변경하기"}</ActionButton>
        </form>
        <p className="prototype-disclosure member-detail-disclosure">{apiMode === "remote" ? "이메일 인증·변경 API가 없어 입력과 저장을 제공하지 않습니다." : "실제 인증 메일은 발송되지 않으며 이메일도 서버에 저장되지 않습니다."}</p>
      </main>
    </MobileScroll>
  );
}

function DefaultAddressPage({ flow }: { flow: FlowControls }) {
  const { memberSettings, saveDefaultAddress, setMemberSaveNotice, apiMode, remoteAddressState } = useDabboba();
  const keyboard = useKeyboard();
  const screenFocusRef = useScreenEntryFocus();
  const pendingIdempotencyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const [address, setAddress] = useState(memberSettings.defaultAddress);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const update = (key: keyof MemberSettings["defaultAddress"], value: string) => setAddress((current) => ({ ...current, [key]: value }));
  const valid = address.recipient.trim().length >= 2 && address.phone.replace(/\D/g, "").length >= 10 && address.postalCode.trim().length === 5 && address.addressLine1.trim().length >= 5;

  const save = async () => {
    if (!valid || saving) return;
    keyboard.hide();
    setSaving(true);
    setSaveStatus("");
    const fingerprint = JSON.stringify(address);
    const pending = pendingIdempotencyRef.current?.fingerprint === fingerprint
      ? pendingIdempotencyRef.current
      : { fingerprint, key: createSessionId("address-save") };
    pendingIdempotencyRef.current = pending;
    const result = await saveDefaultAddress(address, pending.key);
    setSaving(false);
    setSaveStatus(result.message);
    if (result.data && !result.ok) setAddress(mapApiDefaultAddress(result.data));
    if (!result.ok) return;
    pendingIdempotencyRef.current = null;
    setMemberSaveNotice(result.message);
    flow.pop();
  };

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="member-settings-page" aria-label="기본 배송지 수정">
        <MemberSettingsLead label="DELIVERY" title="기본 배송지" description="구매 상품과 보관함 배송 신청에 기본으로 사용할 주소예요." />
        <form className="member-settings-form" onSubmit={(event) => { event.preventDefault(); void save(); }} noValidate>
          <label><span>받는 사람</span><KeyboardInput value={address.recipient} maxLength={20} onChange={(event) => update("recipient", event.currentTarget.value)} onBlur={() => keyboard.hide()} /></label>
          <label><span>연락처</span><KeyboardInput value={address.phone} inputMode="tel" maxLength={13} onChange={(event) => update("phone", event.currentTarget.value)} onBlur={() => keyboard.hide()} /></label>
          <label><span>우편번호</span><KeyboardInput value={address.postalCode} inputMode="numeric" maxLength={5} onChange={(event) => update("postalCode", event.currentTarget.value)} onBlur={() => keyboard.hide()} /></label>
          <label><span>주소</span><KeyboardInput value={address.addressLine1} maxLength={80} onChange={(event) => update("addressLine1", event.currentTarget.value)} onBlur={() => keyboard.hide()} /></label>
          <label><span>상세 주소</span><KeyboardInput value={address.addressLine2} maxLength={60} onChange={(event) => update("addressLine2", event.currentTarget.value)} onBlur={() => keyboard.hide()} /></label>
          <label><span>배송 요청사항</span><KeyboardInput value={address.deliveryNote} maxLength={60} onChange={(event) => update("deliveryNote", event.currentTarget.value)} onBlur={() => keyboard.hide()} /></label>
          <ActionButton type="submit" variant="brandSolid" size="large" className="sheet-primary-button" disabled={!valid || saving || remoteAddressState === "loading"}>
            {saving ? "저장 중" : "기본 배송지 저장하기"}
          </ActionButton>
        </form>
        {saveStatus ? <p className="profile-message" role="status">{saveStatus}</p> : null}
        <p className="prototype-disclosure member-detail-disclosure">
          {apiMode === "remote"
            ? remoteAddressState === "missing"
              ? "등록된 서버 배송지가 없습니다. 저장하면 첫 기본 배송지로 생성됩니다."
              : "기본 배송지는 버전 충돌을 확인한 뒤 서버 계정에 저장됩니다."
            : "이 배송지는 프로토타입 세션에서만 사용됩니다."}
        </p>
      </main>
    </MobileScroll>
  );
}

function PaymentCardsPage({ flow }: { flow: FlowControls }) {
  const { memberSettings, setMemberSettings, setMemberSaveNotice, apiMode } = useDabboba();
  const keyboard = useKeyboard();
  const screenFocusRef = useScreenEntryFocus();
  const [issuer, setIssuer] = useState(memberSettings.paymentCard?.issuer ?? "현대카드");
  const [nickname, setNickname] = useState(memberSettings.paymentCard?.nickname ?? "");
  const [holderName, setHolderName] = useState(memberSettings.paymentCard?.holderName ?? memberSettings.personal.legalName);
  const [last4, setLast4] = useState(memberSettings.paymentCard?.last4 ?? "");
  const valid = nickname.trim().length >= 2 && holderName.trim().length >= 2 && /^\d{4}$/.test(last4);

  const save = () => {
    if (!valid || apiMode === "remote") return;
    keyboard.hide();
    setMemberSettings((current) => ({
      ...current,
      paymentCard: { id: current.paymentCard?.id ?? `card-local-${Date.now()}`, issuer, nickname: nickname.trim(), holderName: holderName.trim(), last4 },
    }));
    setMemberSaveNotice("결제 카드 정보를 저장했어요.");
    flow.pop();
  };

  const remove = () => {
    if (apiMode === "remote") return;
    keyboard.hide();
    setMemberSettings((current) => ({ ...current, paymentCard: null }));
    setMemberSaveNotice("등록 카드를 삭제했어요.");
    flow.pop();
  };

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="member-settings-page" aria-label="결제 카드 관리">
        <MemberSettingsLead label="PAYMENT CARD" title="결제 카드" description="기본 결제 카드의 표시 정보와 별칭을 관리해요." />
        <section className="member-card-preview" aria-label="등록 카드 미리보기">
          <IconCardLine size={24} aria-hidden="true" />
          <div><small>{issuer}</small><strong>•••• •••• •••• {last4 || "0000"}</strong><span>{nickname.trim() || "카드 별칭"}</span></div>
        </section>
        <form className="member-settings-form" onSubmit={(event) => { event.preventDefault(); save(); }} noValidate>
          <label><span>카드사</span><select value={issuer} onChange={(event) => setIssuer(event.currentTarget.value)}><option>현대카드</option><option>신한카드</option><option>삼성카드</option><option>KB국민카드</option><option>롯데카드</option></select></label>
          <label><span>카드 별칭</span><KeyboardInput value={nickname} maxLength={20} placeholder="예: 굿즈 결제 카드" onChange={(event) => setNickname(event.currentTarget.value)} onBlur={() => keyboard.hide()} /></label>
          <label><span>카드 명의자</span><KeyboardInput value={holderName} maxLength={20} onChange={(event) => setHolderName(event.currentTarget.value)} onBlur={() => keyboard.hide()} /></label>
          <label><span>카드 끝 4자리</span><KeyboardInput value={last4} inputMode="numeric" maxLength={4} placeholder="0000" onChange={(event) => setLast4(event.currentTarget.value.replace(/\D/g, ""))} onBlur={() => keyboard.hide()} /></label>
          <ActionButton type="submit" variant="brandSolid" size="large" className="sheet-primary-button" disabled={!valid || apiMode === "remote"}>{apiMode === "remote" ? "결제 카드 API 준비 중" : "카드 정보 저장하기"}</ActionButton>
          {memberSettings.paymentCard ? <button type="button" className="member-danger-button" disabled={apiMode === "remote"} onClick={remove}>{apiMode === "remote" ? "카드 삭제 API 준비 중" : "등록 카드 삭제"}</button> : null}
        </form>
        <p className="prototype-disclosure member-detail-disclosure">실제 카드번호와 CVC는 앱에 저장하지 않고 결제사 인증 화면에서만 처리해야 합니다. 여기서는 끝 4자리만 로컬에서 테스트하며 서버 카드 API를 호출하지 않습니다.</p>
      </main>
    </MobileScroll>
  );
}

function PaymentPreferencesPage({ flow }: { flow: FlowControls }) {
  const { memberSettings, setMemberSettings, setMemberSaveNotice, apiMode } = useDabboba();
  const keyboard = useKeyboard();
  const screenFocusRef = useScreenEntryFocus();
  const [preferences, setPreferences] = useState(memberSettings.paymentPreferences);
  const methodOptions = [
    { id: "card", label: "등록 카드" },
    { id: "kakao", label: "카카오페이" },
    { id: "naver", label: "네이버페이" },
  ] as const;

  const save = () => {
    if (apiMode === "remote") return;
    keyboard.hide();
    setMemberSettings((current) => ({ ...current, paymentPreferences: { ...preferences, cashReceiptPhone: preferences.cashReceiptPhone.replace(/\D/g, "") } }));
    setMemberSaveNotice("결제 설정을 저장했어요.");
    flow.pop();
  };

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="member-settings-page" aria-label="결제 설정 변경">
        <MemberSettingsLead label="PAYMENT" title="결제 설정" description="기본 결제수단과 결제 전 확인 방식을 설정해요." />
        <form className="member-settings-form" onSubmit={(event) => { event.preventDefault(); save(); }}>
          <fieldset className="member-choice-field"><legend>기본 결제수단</legend>{methodOptions.map((option) => <button key={option.id} type="button" role="radio" aria-checked={preferences.defaultMethod === option.id} disabled={apiMode === "remote"} data-selected={preferences.defaultMethod === option.id ? "true" : "false"} onClick={() => setPreferences((current) => ({ ...current, defaultMethod: option.id }))}><span>{option.label}</span>{preferences.defaultMethod === option.id ? <IconCheckmarkLine size={19} aria-hidden="true" /> : null}</button>)}</fieldset>
          <label><span>현금영수증 휴대폰 번호</span><KeyboardInput value={preferences.cashReceiptPhone} inputMode="tel" maxLength={13} onChange={(event) => setPreferences((current) => ({ ...current, cashReceiptPhone: event.currentTarget.value }))} onBlur={() => keyboard.hide()} /></label>
          <button type="button" className="member-switch-row" role="switch" aria-checked={preferences.requirePaymentConfirmation} disabled={apiMode === "remote"} onClick={() => setPreferences((current) => ({ ...current, requirePaymentConfirmation: !current.requirePaymentConfirmation }))}><span><strong>결제 전 최종 확인</strong><small>금액과 상품을 한 번 더 확인해요.</small></span><i data-checked={preferences.requirePaymentConfirmation ? "true" : "false"} aria-hidden="true" /></button>
          <ActionButton type="submit" variant="brandSolid" size="large" className="sheet-primary-button" disabled={apiMode === "remote"}>{apiMode === "remote" ? "결제 설정 API 준비 중" : "결제 설정 저장하기"}</ActionButton>
        </form>
        <p className="prototype-disclosure member-detail-disclosure">{apiMode === "remote" ? "결제 설정 API가 없어 서버나 결제사에는 저장하지 않습니다." : "이 결제 설정은 프로토타입 세션에서만 유지됩니다."}</p>
      </main>
    </MobileScroll>
  );
}

function LoginSecurityPage({ flow }: { flow: FlowControls }) {
  const { memberSettings, setMemberSettings, setMemberSaveNotice, apiMode } = useDabboba();
  const keyboard = useKeyboard();
  const screenFocusRef = useScreenEntryFocus();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(memberSettings.security.twoFactorEnabled);
  const passwordValid = !newPassword || (newPassword.length >= 8 && newPassword === confirmPassword);

  const save = () => {
    if (!passwordValid || apiMode === "remote") return;
    keyboard.hide();
    setMemberSettings((current) => ({
      ...current,
      security: { ...current.security, twoFactorEnabled, passwordUpdatedAt: newPassword ? "2026.08.24" : current.security.passwordUpdatedAt },
    }));
    setMemberSaveNotice(newPassword ? "비밀번호와 보안 설정을 변경했어요." : "보안 설정을 저장했어요.");
    setNewPassword("");
    setConfirmPassword("");
    flow.pop();
  };

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="member-settings-page" aria-label="로그인 및 보안 설정">
        <MemberSettingsLead label="SECURITY" title="로그인 및 보안" description="비밀번호와 추가 인증 설정을 관리해요." />
        <section className="member-security-summary"><IconLockLine size={22} aria-hidden="true" /><div><strong>{memberSettings.security.socialLogin}</strong><small>마지막 비밀번호 변경 {memberSettings.security.passwordUpdatedAt}</small></div></section>
        <form className="member-settings-form" onSubmit={(event) => { event.preventDefault(); save(); }} noValidate>
          <label><span>새 비밀번호</span><KeyboardInput type="password" value={newPassword} minLength={8} maxLength={40} placeholder="변경할 때만 8자 이상 입력" onChange={(event) => setNewPassword(event.currentTarget.value)} onBlur={() => keyboard.hide()} /></label>
          <label><span>새 비밀번호 확인</span><KeyboardInput type="password" value={confirmPassword} minLength={8} maxLength={40} placeholder="새 비밀번호를 다시 입력" aria-invalid={!passwordValid} onChange={(event) => setConfirmPassword(event.currentTarget.value)} onBlur={() => keyboard.hide()} />{!passwordValid ? <small className="profile-field-error">비밀번호는 8자 이상이며 서로 같아야 해요.</small> : null}</label>
          <button type="button" className="member-switch-row" role="switch" aria-checked={twoFactorEnabled} disabled={apiMode === "remote"} onClick={() => setTwoFactorEnabled((current) => !current)}><span><strong>2단계 인증</strong><small>새 기기 로그인 시 추가 확인을 사용해요.</small></span><i data-checked={twoFactorEnabled ? "true" : "false"} aria-hidden="true" /></button>
          <ActionButton type="submit" variant="brandSolid" size="large" className="sheet-primary-button" disabled={!passwordValid || apiMode === "remote"}>{apiMode === "remote" ? "보안 설정 API 준비 중" : "보안 설정 저장하기"}</ActionButton>
        </form>
        <p className="prototype-disclosure member-detail-disclosure">{apiMode === "remote" ? "비밀번호·2단계 인증 API가 없어 입력과 저장을 제공하지 않습니다." : "입력한 테스트 비밀번호는 화면 상태에도 보관하지 않고 즉시 비우며, 서버 보안 API를 호출하지 않습니다."}</p>
      </main>
    </MobileScroll>
  );
}

function PrivacySettingsPage({ flow }: { flow: FlowControls }) {
  const {
    memberSettings,
    setMemberSaveNotice,
    notificationPreferences,
    saveNotificationPreferences,
    apiMode,
    isAuthenticated,
  } = useDabboba();
  const screenFocusRef = useScreenEntryFocus();
  const pendingSaveRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const [privacy, setPrivacy] = useState(memberSettings.privacy);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const canEdit = apiMode === "prototype" || (isAuthenticated && notificationPreferences !== null);
  const options: Array<{ key: keyof MemberSettings["privacy"]; label: string; description: string }> = [
    { key: "marketingSms", label: "문자 혜택 알림", description: "이벤트와 쿠폰 소식을 문자로 받아요." },
    { key: "marketingEmail", label: "이메일 혜택 알림", description: "상품과 이벤트 소식을 이메일로 받아요." },
    { key: "marketingPush", label: "앱 푸시 혜택 알림", description: "입고와 이벤트 알림을 앱에서 받아요." },
    { key: "personalizedRecommendations", label: "맞춤 상품 추천", description: "관심 작품과 구매 기록을 바탕으로 추천해요." },
  ];

  useEffect(() => {
    if (apiMode === "remote") setPrivacy(memberSettings.privacy);
  }, [apiMode, memberSettings.privacy, notificationPreferences?.version]);

  const save = async () => {
    if (saving || !canEdit) return;
    const fingerprint = JSON.stringify([privacy, notificationPreferences?.version ?? "prototype"]);
    const pending = pendingSaveRef.current?.fingerprint === fingerprint
      ? pendingSaveRef.current
      : { fingerprint, key: createSessionId("privacy-preferences") };
    pendingSaveRef.current = pending;
    setSaving(true);
    setStatus("");
    const result = await saveNotificationPreferences(privacy, pending.key);
    setSaving(false);
    setStatus(result.message);
    if (!result.ok) {
      if (result.code === "NOTIFICATION_PREFERENCES_CONFLICT") {
        pendingSaveRef.current = null;
        if (result.data) setPrivacy(notificationPreferencesToPrivacy(result.data));
      }
      return;
    }
    pendingSaveRef.current = null;
    setMemberSaveNotice("개인정보와 수신 동의를 저장했어요.");
    flow.pop();
  };

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="member-settings-page" aria-label="개인정보 및 수신 동의 설정">
        <MemberSettingsLead label="PRIVACY" title="개인정보 및 수신 동의" description="선택 동의 항목은 언제든 직접 켜고 끌 수 있어요." />
        <section className="member-switch-list" aria-label="선택 동의 항목">
          {options.map((option) => (
            <button key={option.key} type="button" className="member-switch-row" role="switch" aria-checked={privacy[option.key]} disabled={!canEdit || saving} onClick={() => setPrivacy((current) => ({ ...current, [option.key]: !current[option.key] }))}>
              <span><strong>{option.label}</strong><small>{option.description}</small></span>
              <i data-checked={privacy[option.key] ? "true" : "false"} aria-hidden="true" />
            </button>
          ))}
        </section>
        <ActionButton type="button" variant="brandSolid" size="large" className="sheet-primary-button member-standalone-save" loading={saving} disabled={!canEdit || saving} onClick={() => { void save(); }}>{saving ? "저장 중" : "수신 동의 저장하기"}</ActionButton>
        {status ? <p className="profile-subpage-status" role="status">{status}</p> : null}
        <p className="prototype-disclosure member-detail-disclosure">{apiMode === "remote" ? canEdit ? "선택 동의는 서버 계정 설정에 저장되며 다른 기기에서 바뀐 경우 최신값을 다시 확인합니다." : "로그인 후 서버 수신 동의를 불러와야 변경할 수 있습니다." : "필수 서비스 안내와 주문·배송 알림은 선택 동의와 관계없이 발송될 수 있습니다."}</p>
      </main>
    </MobileScroll>
  );
}

function LegacySettingsPagePrototype({ flow }: { flow: FlowControls }) {
  const screenFocusRef = useScreenEntryFocus();
  const menus = [
    { label: "알림 수신 설정", description: "주문·교환·혜택 알림 관리", screen: createNotificationSettingsScreen },
    { label: "공지사항", description: "서비스 소식과 운영 안내", screen: createNoticesScreen },
    { label: "문의하기", description: "이용 중 궁금한 점 남기기", screen: createInquiryScreen },
    { label: "이용약관 및 정책", description: "약관·개인정보·운영정책 확인", screen: createLegalHubScreen },
    { label: "탈퇴하기", description: "계정 탈퇴 안내와 확인", screen: createAccountDeletionScreen },
  ] as const;

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="member-settings-page" aria-label="설정">
        <MemberSettingsLead label="SETTINGS" title="설정 및 활동" description="알림, 안내, 약관과 계정 설정을 관리해요." />
        <section className="member-settings-section" aria-labelledby="settings-menu-title">
          <h2 id="settings-menu-title">설정 메뉴</h2>
          <div className="member-settings-list">
            {menus.map((menu) => (
              <button key={menu.label} type="button" onClick={() => flow.push(menu.screen())}>
                <span><strong>{menu.label}</strong><small>{menu.description}</small></span>
                <IconChevronRightLine size={20} aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
        <p className="prototype-disclosure member-settings-disclosure">로그아웃과 실제 계정 처리는 인증 서버 연결 단계에서 제공됩니다.</p>
      </main>
    </MobileScroll>
  );
}

function LegacyNotificationSettingsPagePrototype({ flow }: { flow: FlowControls }) {
  const { memberSettings, setMemberSettings, setMemberSaveNotice } = useDabboba();
  const screenFocusRef = useScreenEntryFocus();
  const [notifications, setNotifications] = useState({
    order: true,
    exchange: true,
    requestRoom: true,
    benefit: memberSettings.privacy.marketingPush,
  });
  const options = [
    { key: "order", label: "주문·배송 알림", description: "결제와 배송 상태를 알려드려요." },
    { key: "exchange", label: "교환방 알림", description: "새 교환 제안과 처리 결과를 알려드려요." },
    { key: "requestRoom", label: "신청방 알림", description: "좋아요와 입고 검토 소식을 알려드려요." },
    { key: "benefit", label: "혜택 알림", description: "쿠폰과 이벤트 소식을 받아요." },
  ] as const;

  const save = () => {
    setMemberSettings((current) => ({
      ...current,
      privacy: { ...current.privacy, marketingPush: notifications.benefit },
    }));
    setMemberSaveNotice("알림 수신 설정을 저장했어요.");
    flow.pop();
  };

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="member-settings-page" aria-label="알림 수신 설정">
        <MemberSettingsLead label="NOTIFICATIONS" title="알림 수신 설정" description="꼭 필요한 알림과 선택 알림을 나눠 관리해요." />
        <section className="member-switch-list" aria-label="알림 항목">
          {options.map((option) => (
            <button
              key={option.key}
              type="button"
              className="member-switch-row"
              role="switch"
              aria-checked={notifications[option.key]}
              onClick={() => setNotifications((current) => ({ ...current, [option.key]: !current[option.key] }))}
            >
              <span><strong>{option.label}</strong><small>{option.description}</small></span>
              <i data-checked={notifications[option.key] ? "true" : "false"} aria-hidden="true" />
            </button>
          ))}
        </section>
        <ActionButton type="button" variant="brandSolid" size="large" className="sheet-primary-button member-standalone-save" onClick={save}>알림 설정 저장하기</ActionButton>
        <p className="prototype-disclosure member-detail-disclosure">계정 보안과 결제처럼 필수 안내는 선택 설정과 별도로 제공될 수 있습니다.</p>
      </main>
    </MobileScroll>
  );
}

function LegacyNoticesPagePrototype({ flow }: { flow: FlowControls }) {
  const screenFocusRef = useScreenEntryFocus();

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="member-settings-page" aria-label="공지사항">
        <MemberSettingsLead label="NOTICES" title="공지사항" description="DABBOBA의 새로운 소식과 운영 안내를 확인하세요." />
        <section className="member-settings-list settings-document-list" aria-label="공지 목록">
          {SETTINGS_NOTICES.map((notice) => (
            <button key={notice.id} type="button" onClick={() => flow.push(createNoticeDetailScreen(notice))}>
              <span><strong>{notice.important ? `[중요] ${notice.title}` : notice.title}</strong><small>{notice.summary} · {notice.postedAt}</small></span>
              <IconChevronRightLine size={20} aria-hidden="true" />
            </button>
          ))}
        </section>
      </main>
    </MobileScroll>
  );
}

function LegacyNoticeDetailPagePrototype({ notice }: { notice: SettingsNotice }) {
  const screenFocusRef = useScreenEntryFocus();

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="member-settings-page settings-document-page" aria-label={`${notice.title} 공지 상세`}>
        <MemberSettingsLead label={notice.important ? "IMPORTANT" : "NOTICE"} title={notice.title} description={`${notice.postedAt} · ${notice.summary}`} />
        {notice.sections.map((section) => (
          <section key={section.heading}><h2>{section.heading}</h2><p>{section.body}</p></section>
        ))}
      </main>
    </MobileScroll>
  );
}

function LegacyInquiryPagePrototype({ flow }: { flow: FlowControls }) {
  const keyboard = useKeyboard();
  const screenFocusRef = useScreenEntryFocus();
  const [category, setCategory] = useState("주문·결제");
  const [subject, setSubject] = useState("");
  const [details, setDetails] = useState("");
  const [status, setStatus] = useState("");

  const submit = () => {
    if (!subject.trim() || !details.trim()) return;
    keyboard.hide();
    setStatus("문의가 화면 확인용으로 접수됐어요.");
  };

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="member-settings-page" aria-label="문의하기">
        <MemberSettingsLead label="INQUIRY" title="문의하기" description="문의 유형과 내용을 남기면 확인 순서대로 답변해 드려요." />
        <form className="member-settings-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <label><span>문의 유형</span><select value={category} onChange={(event) => setCategory(event.currentTarget.value)}><option>주문·결제</option><option>배송·보관함</option><option>교환방·신청방</option><option>계정·기타</option></select></label>
          <label><span>제목</span><KeyboardInput value={subject} maxLength={80} placeholder="문의 제목을 입력하세요" onChange={(event) => { setSubject(event.currentTarget.value); setStatus(""); }} onBlur={() => keyboard.hide()} /></label>
          <label><span>문의 내용</span><KeyboardTextarea value={details} maxLength={800} placeholder="확인이 필요한 내용을 자세히 적어주세요." onChange={(event) => { setDetails(event.currentTarget.value); setStatus(""); }} onBlur={() => keyboard.hide()} /></label>
          <ActionButton type="submit" variant="brandSolid" size="large" className="sheet-primary-button" disabled={!subject.trim() || !details.trim()}>문의 접수하기</ActionButton>
        </form>
        {status ? <p className="profile-subpage-status" role="status">{status}</p> : null}
        <button type="button" className="settings-secondary-action" onClick={flow.pop}>취소하고 돌아가기</button>
        <p className="prototype-disclosure member-detail-disclosure">현재 문의 접수는 화면 확인용이며 서버에 전송되지 않습니다.</p>
      </main>
    </MobileScroll>
  );
}

function LegacyLegalHubPagePrototype({ flow }: { flow: FlowControls }) {
  const screenFocusRef = useScreenEntryFocus();

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="member-settings-page" aria-label="이용약관 및 정책">
        <MemberSettingsLead label="LEGAL" title="이용약관 및 정책" description="서비스 이용과 거래에 필요한 문서를 모았습니다." />
        <section className="member-settings-list settings-document-list" aria-label="약관 및 정책 목록">
          {SETTINGS_LEGAL_DOCUMENTS.map((document) => (
            <button key={document.id} type="button" onClick={() => flow.push(createLegalDocumentScreen(document))}>
              <span><strong>{document.title}</strong><small>{document.required ? "필수" : "선택"} · {document.summary}</small></span>
              <IconChevronRightLine size={20} aria-hidden="true" />
            </button>
          ))}
        </section>
        <section className="settings-release-checklist" aria-label="출시 전 확인 목록">
          <h2>출시 전 확인</h2>
          <ul>{LEGAL_RELEASE_CHECKLIST.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
        <p className="prototype-disclosure member-detail-disclosure">법률 문서는 화면 구성을 위한 초안이며 실제 출시 전 법률 검토가 필요합니다.</p>
      </main>
    </MobileScroll>
  );
}

function LegacyLegalDocumentPagePrototype({ document }: { document: LegalDocument }) {
  const screenFocusRef = useScreenEntryFocus();

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="member-settings-page settings-document-page" aria-label={`${document.title} 문서`}>
        <MemberSettingsLead label={document.required ? "REQUIRED" : "POLICY"} title={document.title} description={`${document.summary} · 시행일 ${document.effectiveDate}`} />
        {document.sections.map((section) => (
          <section key={section.heading}><h2>{section.heading}</h2><p>{section.body}</p></section>
        ))}
      </main>
    </MobileScroll>
  );
}

function LegacyAccountDeletionPagePrototype({ flow }: { flow: FlowControls }) {
  const screenFocusRef = useScreenEntryFocus();
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState("");

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="member-settings-page" aria-label="회원 탈퇴">
        <MemberSettingsLead label="ACCOUNT" title="탈퇴하기" description="탈퇴 전 보관 상품과 진행 중인 주문·교환을 먼저 확인해 주세요." />
        <section className="settings-deletion-guide"><h2>탈퇴 전에 확인하세요.</h2><ul><li>배송하지 않은 보관 상품과 남은 포인트를 확인해 주세요.</li><li>진행 중인 주문, 환불과 교환이 있으면 먼저 완료해 주세요.</li><li>법령상 보관 의무가 있는 거래 기록은 정해진 기간 동안 분리 보관될 수 있어요.</li></ul></section>
        <button type="button" className="settings-confirm-row" role="checkbox" aria-checked={confirmed} onClick={() => { setConfirmed((current) => !current); setStatus(""); }}><span>{confirmed ? <IconCheckmarkLine size={16} aria-hidden="true" /> : null}</span><strong>안내 내용을 확인했습니다.</strong></button>
        <ActionButton type="button" variant="neutralSolid" size="large" className="sheet-primary-button" disabled={!confirmed} onClick={() => setStatus("현재는 테스트 화면이라 실제 계정이 삭제되지 않습니다.")}>탈퇴 요청하기</ActionButton>
        {status ? <p className="profile-subpage-status" role="status">{status}</p> : null}
        <button type="button" className="settings-secondary-action" onClick={flow.pop}>계정 유지하기</button>
        <p className="prototype-disclosure member-detail-disclosure">정식 출시 시 본인 확인과 서버 탈퇴 처리 절차를 연결합니다.</p>
      </main>
    </MobileScroll>
  );
}

function SettingsMenuRow({
  icon,
  label,
  summary,
  onClick,
  danger = false,
  disabled = false,
}: {
  icon: ReactNode;
  label: string;
  summary: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button type="button" className="settings-menu-row" data-danger={danger ? "true" : "false"} disabled={disabled} onClick={onClick}>
      <span className="settings-menu-icon" aria-hidden="true">{icon}</span>
      <span className="settings-menu-copy"><strong>{label}</strong><small>{summary}</small></span>
      {disabled ? <small>준비 중</small> : <IconChevronRightLine size={21} aria-hidden="true" />}
    </button>
  );
}

function SettingsPage({ flow }: { flow: FlowControls }) {
  const {
    isAuthenticated,
    logoutUserSession,
    memberSettings,
    profile,
    notices,
    apiMode,
    apiSyncMessage,
  } = useDabboba();
  const screenFocusRef = useScreenEntryFocus();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [logoutStatus, setLogoutStatus] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);

  const finishLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    const result = await logoutUserSession();
    setLoggingOut(false);
    setLogoutStatus(result.message);
    if (!result.ok) return;
    setLogoutOpen(false);
    flow.pop();
  };

  return (
    <>
      <MobileScroll className="app-screen dabboba-screen">
        <main ref={screenFocusRef} tabIndex={-1} className="member-settings-page settings-page" aria-label="DABBOBA 설정">
          <MemberSettingsLead label="SETTINGS" title="설정" description="알림, 계정, 고객지원과 서비스 정책을 한곳에서 관리해요." />

          <section className="settings-account-summary" aria-label="현재 계정">
            <span aria-hidden="true"><IconPerson2Line size={23} /></span>
            <div>
              <strong>{isAuthenticated ? profile.nickname : "둘러보기 중"}</strong>
              <small>{isAuthenticated ? apiMode === "remote" ? "서버 사용자 세션 연결됨" : memberSettings.personal.email : "로그인하면 계정 설정을 저장할 수 있어요."}</small>
            </div>
            <em>{isAuthenticated ? "로그인" : "게스트"}</em>
          </section>

          <section className="member-settings-section" aria-labelledby="settings-notification-title">
            <h2 id="settings-notification-title">알림</h2>
            <div className="settings-menu-list">
              <SettingsMenuRow icon={<IconBellLine size={21} />} label="알림 수신 설정" summary="주문·교환·재입고·혜택 알림" onClick={() => flow.push(createNotificationSettingsScreen())} />
            </div>
          </section>

          <section className="member-settings-section" aria-labelledby="settings-user-title">
            <h2 id="settings-user-title">사용자 설정</h2>
            <div className="settings-menu-list">
              <SettingsMenuRow icon={<IconPerson2Line size={21} />} label="계정정보 변경" summary="개인정보, 배송지와 결제 설정" onClick={() => flow.push(createMemberInfoScreen())} />
              <SettingsMenuRow icon={<IconLockLine size={21} />} label="비밀번호 변경" summary={apiMode === "remote" ? "보안 설정 API 준비 중" : `마지막 변경 ${memberSettings.security.passwordUpdatedAt}`} disabled={apiMode === "remote"} onClick={() => flow.push(createLoginSecurityScreen())} />
              <SettingsMenuRow icon={<IconXmarkLine size={21} />} label="차단한 사용자" summary="덕룸에서 차단한 사용자 확인·해제" disabled={!isAuthenticated} onClick={() => flow.push(createBlockedUsersScreen())} />
            </div>
          </section>

          <section className="member-settings-section" aria-labelledby="settings-support-title">
            <h2 id="settings-support-title">고객센터</h2>
            <div className="settings-menu-list">
              <SettingsMenuRow icon={<IconMegaphoneLine size={21} />} label="공지사항" summary={`중요 공지 포함 ${notices.length}개`} onClick={() => flow.push(createNoticesScreen())} />
              <SettingsMenuRow icon={<IconEnvelopeLine size={21} />} label="문의하기" summary="주문·배송·결제·계정 문의 접수" onClick={() => flow.push(createInquiryScreen())} />
              <SettingsMenuRow icon={<IconQuestionmarkCircleLine size={21} />} label="자주 묻는 질문" summary="가챠, 구매, 배송과 교환 이용 안내" onClick={() => flow.push(createCustomerCenterScreen())} />
            </div>
          </section>

          <section className="member-settings-section" aria-labelledby="settings-etc-title">
            <h2 id="settings-etc-title">기타</h2>
            <div className="settings-menu-list">
              <SettingsMenuRow icon={<IconDocumentLine size={21} />} label="이용약관 및 정책" summary="개인정보, 구매·환불, 배송과 운영정책" onClick={() => flow.push(createLegalHubScreen())} />
              <SettingsMenuRow icon={<IconArrowLeftLine size={21} />} label={isAuthenticated ? "로그아웃" : "로그인"} summary={isAuthenticated ? apiMode === "remote" ? "현재 서버 세션을 안전하게 종료" : "이 기기에서 계정 연결 해제" : "현재 둘러보기 상태예요"} onClick={() => { setLogoutStatus(""); if (isAuthenticated) setLogoutOpen(true); else flow.push(createLoginScreen()); }} />
              <SettingsMenuRow icon={<IconTrashcanLine size={21} />} label="탈퇴하기" summary={apiMode === "remote" ? "거래 상태 확인 후 운영 검토 요청" : "계정과 연결된 데이터 삭제 요청"} disabled={!isAuthenticated} danger onClick={() => flow.push(createAccountDeletionScreen())} />
            </div>
          </section>

          {logoutStatus ? <p className="profile-subpage-status" role="status">{logoutStatus}</p> : null}

          <p className="prototype-disclosure member-settings-disclosure">
            {apiMode === "remote"
              ? `공지·문의·프로필·기본 배송지·차단 목록·로그아웃·탈퇴 요청과 계정 활동 목록은 서버에 연결됩니다. 계약이 없는 개인정보·결제·보안·수신 동의 변경은 비활성화됩니다.${apiSyncMessage ? ` ${apiSyncMessage}` : ""}`
              : "설정 변경과 문의 접수는 현재 브라우저에서만 확인되는 테스트 기능입니다."}
          </p>
        </main>
      </MobileScroll>

      <BottomSheet
        open={logoutOpen}
        onOpenChange={setLogoutOpen}
        title="로그아웃할까요?"
        description={apiMode === "remote"
          ? "현재 서버 세션을 폐기합니다. 계정과 보관함 상품은 삭제되지 않습니다."
          : "이 기기의 로그인 상태만 해제되며 계정과 보관함 상품은 삭제되지 않습니다."}
        snap={0.38}
      >
        <div className="settings-confirm-actions">
          <ActionButton type="button" variant="brandSolid" size="large" className="sheet-primary-button" loading={loggingOut} disabled={loggingOut} onClick={() => void finishLogout()}>{loggingOut ? "로그아웃 중" : "로그아웃"}</ActionButton>
          <button type="button" disabled={loggingOut} onClick={() => setLogoutOpen(false)}>취소</button>
        </div>
      </BottomSheet>
    </>
  );
}

function BlockedUsersPage() {
  const { isAuthenticated, loadBlockedUsers, unblockCommunityUser, apiMode } = useDabboba();
  const screenFocusRef = useScreenEntryFocus();
  const pendingUnblockKeysRef = useRef<Record<string, string>>({});
  const [blockedUsers, setBlockedUsers] = useState<ApiBlockedUser[]>([]);
  const [loading, setLoading] = useState(apiMode === "remote" && isAuthenticated);
  const [unblockingIds, setUnblockingIds] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      setStatus("로그인 후 차단 목록을 확인할 수 있습니다.");
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setStatus("");
    void loadBlockedUsers(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setLoading(false);
      if (result.ok && result.data) {
        setBlockedUsers(result.data);
        return;
      }
      setStatus(result.message);
    });
    return () => controller.abort();
  }, [isAuthenticated, loadBlockedUsers]);

  const unblock = async (blockedUser: ApiBlockedUser) => {
    if (unblockingIds.has(blockedUser.userId)) return;
    const pending = {
      key: pendingUnblockKeysRef.current[blockedUser.userId] ?? createSessionId("community-unblock"),
    };
    pendingUnblockKeysRef.current[blockedUser.userId] = pending.key;
    setUnblockingIds((current) => new Set(current).add(blockedUser.userId));
    setStatus("");
    const result = await unblockCommunityUser(blockedUser.userId, pending.key);
    setUnblockingIds((current) => {
      const next = new Set(current);
      next.delete(blockedUser.userId);
      return next;
    });
    setStatus(result.message);
    if (!result.ok) return;
    delete pendingUnblockKeysRef.current[blockedUser.userId];
    setBlockedUsers((current) => current.filter((item) => item.userId !== blockedUser.userId));
  };

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="member-settings-page blocked-users-page" aria-labelledby="blocked-users-title">
        <MemberSettingsLead label="COMMUNITY" title="차단한 사용자" description="덕룸에서 숨긴 사용자를 확인하고 차단을 해제할 수 있어요." />
        <section className="member-settings-section" aria-labelledby="blocked-users-title">
          <h2 id="blocked-users-title">차단 목록 {loading ? "" : blockedUsers.length}</h2>
          <div className="blocked-user-list" aria-busy={loading} aria-label="차단한 사용자 목록">
            {blockedUsers.map((blockedUser) => {
              const unblocking = unblockingIds.has(blockedUser.userId);
              return (
                <article key={blockedUser.userId}>
                  <span aria-hidden="true"><IconPerson2Line size={21} /></span>
                  <div>
                    <strong>{blockedUser.nickname}</strong>
                    <small>{serverDateLabel(blockedUser.blockedAt)} 차단</small>
                  </div>
                  <button type="button" disabled={unblocking} onClick={() => { void unblock(blockedUser); }}>
                    {unblocking ? "해제 중" : "차단 해제"}
                  </button>
                </article>
              );
            })}
            {loading ? <p role="status">차단 목록을 불러오는 중입니다.</p> : null}
            {!loading && blockedUsers.length === 0 ? <p>차단한 사용자가 없습니다.</p> : null}
          </div>
        </section>
        {status ? <p className="profile-subpage-status" role="status">{status}</p> : null}
        <p className="prototype-disclosure member-detail-disclosure">
          {apiMode === "remote"
            ? "차단 해제는 서버에 반영됩니다. 덕룸 목록을 새로 불러오면 해당 사용자의 공개 글과 댓글이 다시 표시될 수 있습니다."
            : "개발 프리뷰에서는 서버 차단 목록을 불러오거나 변경하지 않습니다."}
        </p>
      </main>
    </MobileScroll>
  );
}

function NotificationSettingsPage({ flow }: { flow: FlowControls }) {
  const {
    memberSettings,
    setMemberSaveNotice,
    accountNotifications,
    notificationPreferences,
    saveNotificationPreferences,
    markNotificationRead,
    apiMode,
    isAuthenticated,
  } = useDabboba();
  const screenFocusRef = useScreenEntryFocus();
  const pendingReadKeysRef = useRef<Record<string, string>>({});
  const pendingSaveRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const [privacy, setPrivacy] = useState(memberSettings.privacy);
  const [readingId, setReadingId] = useState<string | null>(null);
  const [inboxStatus, setInboxStatus] = useState("");
  const [preferenceStatus, setPreferenceStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const canEdit = apiMode === "prototype" || (isAuthenticated && notificationPreferences !== null);
  const activityOptions: Array<{ key: keyof MemberSettings["privacy"]; label: string; description: string }> = [
    { key: "exchangeUpdates", label: "교환방 알림", description: "교환 신청과 답변 소식을 받아요." },
    { key: "requestUpdates", label: "신청방 알림", description: "좋아요와 요청 반영 소식을 받아요." },
    { key: "restockUpdates", label: "재입고 알림", description: "찜한 상품과 작품의 재입고 소식을 받아요." },
  ];
  const marketingOptions: Array<{ key: keyof MemberSettings["privacy"]; label: string; description: string }> = [
    { key: "marketingPush", label: "앱 푸시 혜택", description: "이벤트와 쿠폰 소식을 앱에서 받아요." },
    { key: "marketingSms", label: "문자 혜택", description: "선택한 혜택 소식을 문자로 받아요." },
    { key: "marketingEmail", label: "이메일 혜택", description: "상품과 이벤트 소식을 이메일로 받아요." },
    { key: "personalizedRecommendations", label: "맞춤 상품 추천", description: "관심 작품과 구매 기록을 바탕으로 추천해요." },
  ];

  useEffect(() => {
    if (apiMode === "remote") setPrivacy(memberSettings.privacy);
  }, [apiMode, memberSettings.privacy, notificationPreferences?.version]);

  const toggle = (key: keyof MemberSettings["privacy"]) => {
    if (!canEdit || saving || key === "orderUpdates") return;
    setPrivacy((current) => ({ ...current, [key]: !current[key] }));
  };
  const save = async () => {
    if (saving || !canEdit) return;
    const fingerprint = JSON.stringify([privacy, notificationPreferences?.version ?? "prototype"]);
    const pending = pendingSaveRef.current?.fingerprint === fingerprint
      ? pendingSaveRef.current
      : { fingerprint, key: createSessionId("notification-preferences") };
    pendingSaveRef.current = pending;
    setSaving(true);
    setPreferenceStatus("");
    const result = await saveNotificationPreferences(privacy, pending.key);
    setSaving(false);
    setPreferenceStatus(result.message);
    if (!result.ok) {
      if (result.code === "NOTIFICATION_PREFERENCES_CONFLICT") {
        pendingSaveRef.current = null;
        if (result.data) setPrivacy(notificationPreferencesToPrivacy(result.data));
      }
      return;
    }
    pendingSaveRef.current = null;
    setMemberSaveNotice("알림 수신 설정을 저장했어요.");
    flow.pop();
  };
  const readNotification = async (notificationId: string) => {
    if (readingId) return;
    setReadingId(notificationId);
    setInboxStatus("");
    const idempotencyKey = pendingReadKeysRef.current[notificationId] ?? createSessionId("notification-read");
    pendingReadKeysRef.current[notificationId] = idempotencyKey;
    const result = await markNotificationRead(notificationId, idempotencyKey);
    setReadingId(null);
    setInboxStatus(result.message);
    if (result.ok) delete pendingReadKeysRef.current[notificationId];
  };

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="member-settings-page notification-settings-page" aria-label="알림 수신 설정">
        <MemberSettingsLead label="NOTIFICATIONS" title="받고 싶은 소식만" description="필수 서비스 안내와 선택 알림을 구분해 관리해요." />

        {apiMode === "remote" ? (
          <section className="member-settings-section" aria-labelledby="account-notification-inbox-title">
            <h2 id="account-notification-inbox-title">최근 받은 알림</h2>
            <div className="settings-notice-list" aria-label="계정 알림 목록">
              {accountNotifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  disabled={Boolean(notification.readAt) || readingId === notification.id}
                  onClick={() => { void readNotification(notification.id); }}
                >
                  <span>
                    {!notification.readAt ? <em>새 알림</em> : null}
                    <strong>{notification.title}</strong>
                    <small>{notification.body}</small>
                    <time>{serverDateLabel(notification.createdAt)}</time>
                  </span>
                  <small>{readingId === notification.id ? "처리 중" : notification.readAt ? "읽음" : "읽음 처리"}</small>
                </button>
              ))}
              {accountNotifications.length === 0 ? <p role="status">받은 알림이 없습니다.</p> : null}
            </div>
            {inboxStatus ? <p className="profile-message" role="status">{inboxStatus}</p> : null}
          </section>
        ) : null}

        <section className="notification-required" aria-labelledby="required-notification-title">
          <div><h2 id="required-notification-title">필수 알림</h2><span>항상 받음</span></div>
          <p>계정 보안, 결제, 주문, 배송과 서비스 장애 안내는 안전한 이용을 위해 발송될 수 있어요.</p>
          <button type="button" className="member-switch-row" role="switch" aria-checked="true" disabled>
            <span><strong>주문·배송 알림</strong><small>결제, 주문 처리와 배송 상태를 알려드려요.</small></span>
            <i data-checked="true" aria-hidden="true" />
          </button>
        </section>

        <section className="member-settings-section" aria-labelledby="activity-notification-title">
          <h2 id="activity-notification-title">활동 알림</h2>
          <div className="member-switch-list settings-switch-list">
            {activityOptions.map((option) => <button key={option.key} type="button" className="member-switch-row" role="switch" aria-checked={privacy[option.key]} disabled={!canEdit || saving} onClick={() => toggle(option.key)}><span><strong>{option.label}</strong><small>{option.description}</small></span><i data-checked={privacy[option.key] ? "true" : "false"} aria-hidden="true" /></button>)}
          </div>
        </section>

        <section className="member-settings-section" aria-labelledby="marketing-notification-title">
          <h2 id="marketing-notification-title">혜택과 추천</h2>
          <div className="member-switch-list settings-switch-list">
            {marketingOptions.map((option) => <button key={option.key} type="button" className="member-switch-row" role="switch" aria-checked={privacy[option.key]} disabled={!canEdit || saving} onClick={() => toggle(option.key)}><span><strong>{option.label}</strong><small>{option.description}</small></span><i data-checked={privacy[option.key] ? "true" : "false"} aria-hidden="true" /></button>)}
          </div>
        </section>

        <ActionButton type="button" variant="brandSolid" size="large" className="sheet-primary-button member-standalone-save" loading={saving} disabled={!canEdit || saving} onClick={() => { void save(); }}>{saving ? "저장 중" : "알림 설정 저장하기"}</ActionButton>
        {preferenceStatus ? <p className="profile-subpage-status" role="status">{preferenceStatus}</p> : null}
        <p className="prototype-disclosure member-detail-disclosure">
          {apiMode === "remote"
            ? canEdit
              ? "알림 목록·읽음 상태와 수신 동의를 서버 계정에 동기화합니다. 알림 data 값으로 임의 이동하지 않습니다."
              : "로그인 후 서버 알림 설정을 불러와야 스위치를 변경할 수 있습니다."
            : "기기의 전체 푸시 허용 여부는 iOS·Android 시스템 알림 설정에서도 변경할 수 있습니다."}
        </p>
      </main>
    </MobileScroll>
  );
}

function NoticesPage({ flow }: { flow: FlowControls }) {
  const { notices, apiMode, apiSyncMessage } = useDabboba();
  const screenFocusRef = useScreenEntryFocus();
  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="member-settings-page settings-content-page" aria-label="공지사항 목록">
        <MemberSettingsLead label="NOTICE" title="공지사항" description="서비스 운영과 이용에 필요한 소식을 확인해 주세요." />
        <section className="settings-notice-list" aria-label="공지사항">
          {notices.map((notice) => (
            <button key={notice.id} type="button" onClick={() => flow.push(createNoticeDetailScreen(notice))}>
              <span>{notice.important ? <em>중요</em> : null}<strong>{notice.title}</strong><small>{notice.summary}</small><time>{notice.postedAt}</time></span>
              <IconChevronRightLine size={21} aria-hidden="true" />
            </button>
          ))}
          {notices.length === 0 ? <p role="status">등록된 공지가 없습니다.</p> : null}
        </section>
        {apiMode === "remote" && apiSyncMessage ? <p className="prototype-disclosure" role="status">{apiSyncMessage}</p> : null}
      </main>
    </MobileScroll>
  );
}

function NoticeDetailPage({ notice }: { notice: SettingsNotice }) {
  const screenFocusRef = useScreenEntryFocus();
  return (
    <MobileScroll className="app-screen dabboba-screen">
      <article ref={screenFocusRef} tabIndex={-1} className="settings-article-page" aria-labelledby="notice-detail-title">
        <header><span>{notice.important ? "IMPORTANT NOTICE" : "NOTICE"}</span><h1 id="notice-detail-title">{notice.title}</h1><p>{notice.summary}</p><time>{notice.postedAt}</time></header>
        <div className="settings-article-sections">{notice.sections.map((section) => <section key={section.heading}><h2>{section.heading}</h2><p>{section.body}</p></section>)}</div>
      </article>
    </MobileScroll>
  );
}

function inquiryStatusLabel(status: ApiInquiry["status"]) {
  if (status === "PENDING") return "답변 대기";
  if (status === "IN_PROGRESS") return "확인 중";
  if (status === "ANSWERED") return "답변 완료";
  return "문의 종료";
}

function InquiryDetailPage({ inquiryId, fallbackTitle }: { inquiryId: string; fallbackTitle: string }) {
  const {
    loadInquiryDetail,
    submitInquiryMessage,
    loadAuthenticatedMediaUrl,
    uploadMedia,
  } = useDabboba();
  const keyboard = useKeyboard();
  const screenFocusRef = useScreenEntryFocus();
  const pendingReplyKeyRef = useRef<{
    fingerprint: string;
    key: string;
    mediaKey: string;
    mediaId?: string;
  } | null>(null);
  const replyInFlightRef = useRef(false);
  const [detail, setDetail] = useState<ApiInquiryDetail | null>(null);
  const [loadStatus, setLoadStatus] = useState("문의 대화를 불러오는 중입니다.");
  const [replyContent, setReplyContent] = useState("");
  const [replyMediaFile, setReplyMediaFile] = useState<File | null>(null);
  const [replyMediaPreview, setReplyMediaPreview] = useState("");
  const [replyStatus, setReplyStatus] = useState("");
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [messageMedia, setMessageMedia] = useState<Record<string, {
    status: "loading" | "ready" | "error";
    url?: string;
  }>>({});

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setDetail(null);
    setLoadStatus("문의 대화를 불러오는 중입니다.");
    void loadInquiryDetail(inquiryId, controller.signal).then((result) => {
      if (!active || controller.signal.aborted) return;
      if (result.ok && result.data) {
        setDetail(result.data);
        setLoadStatus("");
      } else {
        setLoadStatus(result.message);
      }
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [inquiryId, loadInquiryDetail]);

  useEffect(() => {
    if (!replyMediaFile) {
      setReplyMediaPreview("");
      return;
    }
    const previewUrl = URL.createObjectURL(replyMediaFile);
    setReplyMediaPreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [replyMediaFile]);

  const visibleMessages = useMemo(() => detail?.messages.filter((message) => !message.isInternal) ?? [], [detail]);
  const hasAdminAnswer = visibleMessages.some((message) => message.authorRole === "ADMIN" || message.authorRole === "SUPER_ADMIN");
  const mediaIds = useMemo(() => [...new Set(visibleMessages.flatMap((message) => message.mediaIds))], [visibleMessages]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    if (!mediaIds.length) {
      setMessageMedia({});
      return () => controller.abort();
    }
    setMessageMedia(Object.fromEntries(mediaIds.map((mediaId) => [mediaId, { status: "loading" as const }])));
    void Promise.all(mediaIds.map(async (mediaId) => {
      const result = await loadAuthenticatedMediaUrl(mediaId, controller.signal);
      return [mediaId, result] as const;
    })).then((entries) => {
      if (!active || controller.signal.aborted) return;
      setMessageMedia(Object.fromEntries(entries.map(([mediaId, result]) => [
        mediaId,
        result.ok && result.data
          ? { status: "ready" as const, url: result.data.url }
          : { status: "error" as const },
      ])));
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [loadAuthenticatedMediaUrl, mediaIds]);

  const refreshInquiryDetail = async () => {
    const result = await loadInquiryDetail(inquiryId);
    if (result.ok && result.data) {
      setDetail(result.data);
      setLoadStatus("");
    }
    return result;
  };

  const submitReply = async () => {
    const content = replyContent.trim();
    if (!detail || detail.status === "CLOSED" || !content || replySubmitting || replyInFlightRef.current) return;
    const fingerprint = JSON.stringify([
      inquiryId,
      content,
      replyMediaFile?.name ?? null,
      replyMediaFile?.size ?? null,
      replyMediaFile?.lastModified ?? null,
    ]);
    const pending = pendingReplyKeyRef.current?.fingerprint === fingerprint
      ? pendingReplyKeyRef.current
      : {
        fingerprint,
        key: createSessionId("inquiry-reply"),
        mediaKey: createSessionId("inquiry-reply-media"),
      };
    pendingReplyKeyRef.current = pending;
    replyInFlightRef.current = true;
    setReplySubmitting(true);
    setReplyStatus("");
    keyboard.hide();

    if (replyMediaFile && !pending.mediaId) {
      setReplyStatus("문의 첨부 이미지를 안전하게 업로드하고 있습니다.");
      const uploaded = await uploadMedia(replyMediaFile, "INQUIRY", pending.mediaKey);
      if (!uploaded.ok || !uploaded.data) {
        if (uploaded.code === "MEDIA_UPLOAD_INTENT_EXPIRED") {
          pendingReplyKeyRef.current = {
            ...pending,
            mediaKey: createSessionId("inquiry-reply-media"),
            mediaId: undefined,
          };
        }
        replyInFlightRef.current = false;
        setReplySubmitting(false);
        setReplyStatus(uploaded.message);
        return;
      }
      pending.mediaId = uploaded.data.mediaId;
    }

    const result = await submitInquiryMessage(inquiryId, {
      content,
      mediaIds: pending.mediaId ? [pending.mediaId] : [],
    }, pending.key);
    replyInFlightRef.current = false;
    setReplySubmitting(false);
    setReplyStatus(result.message);
    if (!result.ok) return;

    pendingReplyKeyRef.current = null;
    setReplyContent("");
    setReplyMediaFile(null);
    const refreshed = await refreshInquiryDetail();
    if (!refreshed.ok) {
      setReplyStatus(`${result.message} 최신 대화는 다시 열어 확인해 주세요.`);
    }
  };

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <article ref={screenFocusRef} tabIndex={-1} className="settings-article-page" aria-labelledby="inquiry-detail-title">
        <header>
          <span>1:1 INQUIRY</span>
          <h1 id="inquiry-detail-title">{detail?.title ?? fallbackTitle}</h1>
          <p>{detail ? `${detail.category} · ${inquiryStatusLabel(detail.status)}` : "접수한 문의와 운영자 답변을 확인합니다."}</p>
          {detail ? <time>{serverDateLabel(detail.createdAt)} 접수</time> : null}
        </header>
        {loadStatus ? <p className="profile-message" role="status">{loadStatus}</p> : null}
        {detail ? (
          <div className="settings-article-sections" aria-label="문의 대화">
            {visibleMessages.map((message) => {
              const fromAdmin = message.authorRole === "ADMIN" || message.authorRole === "SUPER_ADMIN";
              const readyMedia = message.mediaIds.filter((mediaId) => messageMedia[mediaId]?.status === "ready" && messageMedia[mediaId]?.url);
              const failedMediaCount = message.mediaIds.filter((mediaId) => messageMedia[mediaId]?.status === "error").length;
              const loadingMediaCount = message.mediaIds.length - readyMedia.length - failedMediaCount;
              return (
                <section key={message.id} aria-label={fromAdmin ? "운영자 답변" : "내 문의"}>
                  <h2>{fromAdmin ? "DABBOBA 운영팀" : "나"}</h2>
                  <time>{serverDateLabel(message.createdAt)}</time>
                  <p>{message.content}</p>
                  {message.mediaIds.length > 0 ? (
                    <div className="inquiry-message-media" aria-label={`첨부 이미지 ${message.mediaIds.length}개`}>
                      {readyMedia.map((mediaId, index) => (
                        <a
                          key={mediaId}
                          href={messageMedia[mediaId]!.url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`문의 첨부 이미지 ${index + 1} 크게 보기`}
                        >
                          <img
                            src={messageMedia[mediaId]!.url}
                            alt={`문의 첨부 이미지 ${index + 1}`}
                            loading="lazy"
                            draggable={false}
                            onError={() => setMessageMedia((current) => ({
                              ...current,
                              [mediaId]: { status: "error" },
                            }))}
                          />
                          <span>이미지 열기</span>
                        </a>
                      ))}
                      {loadingMediaCount > 0 ? <small>첨부 파일 {loadingMediaCount}개를 불러오는 중입니다.</small> : null}
                      {failedMediaCount > 0 ? <small>첨부 파일 {failedMediaCount}개를 불러오지 못했습니다.</small> : null}
                    </div>
                  ) : null}
                </section>
              );
            })}
            {visibleMessages.length === 0 ? <p role="status">표시할 문의 메시지가 없습니다.</p> : null}
          </div>
        ) : null}
        {detail ? (
          <p className="prototype-disclosure">
            {hasAdminAnswer ? "운영자 답변이 포함된 서버 문의 대화입니다." : "아직 운영자 답변이 등록되지 않았습니다."}
          </p>
        ) : null}

        {detail && detail.status !== "CLOSED" ? (
          <section className="inquiry-reply-composer" aria-labelledby="inquiry-reply-title">
            <div>
              <span>FOLLOW-UP</span>
              <h2 id="inquiry-reply-title">후속 답글 남기기</h2>
              <p>추가 설명은 같은 서버 문의 대화에 이어서 등록됩니다.</p>
            </div>
            <KeyboardTextarea
              value={replyContent}
              maxLength={10_000}
              placeholder="추가로 전달할 내용을 입력해 주세요."
              aria-label="문의 후속 답글"
              disabled={replySubmitting}
              onChange={(event) => {
                setReplyContent(event.currentTarget.value);
                setReplyStatus("");
              }}
              onBlur={() => keyboard.hide()}
            />
            <label className="inquiry-reply-media-field">
              <span className="inquiry-reply-media-picker"><IconCameraLine size={18} aria-hidden="true" /> 사진 1장 선택</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                disabled={replySubmitting}
                onChange={(event) => {
                  setReplyMediaFile(event.currentTarget.files?.[0] ?? null);
                  event.currentTarget.value = "";
                  setReplyStatus("");
                }}
              />
            </label>
            {replyMediaFile ? (
              <div className="inquiry-reply-media-preview">
                {replyMediaPreview ? <img src={replyMediaPreview} alt="선택한 문의 첨부 미리보기" draggable={false} /> : null}
                <span><strong>{replyMediaFile.name}</strong><small>{Math.max(1, Math.ceil(replyMediaFile.size / 1024)).toLocaleString("ko-KR")}KB · 전송 전 미리보기</small></span>
                <button type="button" disabled={replySubmitting} onClick={() => setReplyMediaFile(null)} aria-label="문의 첨부 이미지 제거"><IconXmarkLine size={18} aria-hidden="true" /></button>
              </div>
            ) : null}
            <ActionButton
              type="button"
              variant="brandSolid"
              size="large"
              disabled={replySubmitting || !replyContent.trim()}
              aria-busy={replySubmitting}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => { void submitReply(); }}
            >
              {replySubmitting ? "답글 등록 중..." : "후속 답글 등록"}
            </ActionButton>
            {replyStatus ? <p className="profile-message" role="status">{replyStatus}</p> : null}
          </section>
        ) : detail?.status === "CLOSED" ? (
          <p className="inquiry-closed-notice" role="status">종료된 문의에는 후속 답글을 추가할 수 없습니다.</p>
        ) : null}
      </article>
    </MobileScroll>
  );
}

function InquiryPage({ flow }: { flow: FlowControls }) {
  const { memberSettings, submitInquiry, apiMode, inquiries } = useDabboba();
  const keyboard = useKeyboard();
  const screenFocusRef = useScreenEntryFocus();
  const pendingInquiryKeyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const [category, setCategory] = useState("order");
  const [orderNumber, setOrderNumber] = useState("");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [submittedId, setSubmittedId] = useState("");
  const [submitStatus, setSubmitStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const valid = title.trim().length >= 2 && details.trim().length >= 10;

  const submit = async () => {
    if (!valid || submitting) return;
    const nextTitle = title.trim();
    const content = [orderNumber.trim() ? `주문번호: ${orderNumber.trim()}` : "", details.trim()].filter(Boolean).join("\n\n");
    const fingerprint = JSON.stringify([category, nextTitle, content]);
    const pending = pendingInquiryKeyRef.current?.fingerprint === fingerprint
      ? pendingInquiryKeyRef.current
      : { fingerprint, key: createSessionId("inquiry") };
    pendingInquiryKeyRef.current = pending;
    keyboard.hide();
    setSubmitting(true);
    setSubmitStatus("");
    const result = await submitInquiry({
      category,
      title: nextTitle,
      content,
    }, pending.key);
    setSubmitting(false);
    if (!result.ok || !result.data) {
      setSubmitStatus(result.message);
      return;
    }
    pendingInquiryKeyRef.current = null;
    setSubmittedId(result.data.id);
  };

  if (submittedId) {
    return (
      <MobileScroll className="app-screen dabboba-screen">
        <main ref={screenFocusRef} tabIndex={-1} className="inquiry-complete-page" aria-label="문의 접수 완료">
          <span aria-hidden="true"><IconCheckmarkCircleFill size={32} /></span>
          <h1>문의를 접수했어요.</h1>
          <p>답변이 등록되면 앱 알림과 문의 내역에서 알려드릴게요.</p>
          <dl>
            <div><dt>접수번호</dt><dd>{submittedId}</dd></div>
            <div><dt>{apiMode === "remote" ? "답변 확인" : "답변 이메일"}</dt><dd>{apiMode === "remote" ? "앱 내 문의 내역" : memberSettings.personal.email}</dd></div>
          </dl>
          <ActionButton type="button" variant="brandSolid" size="large" className="sheet-primary-button" onClick={flow.pop}>설정으로 돌아가기</ActionButton>
          <p className="prototype-disclosure">
            {apiMode === "remote" ? "문의 내용과 접수 상태는 서버에 저장됩니다." : "화면 확인용 접수번호이며 실제 문의는 전송되지 않았습니다."}
          </p>
        </main>
      </MobileScroll>
    );
  }

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="member-settings-page inquiry-page" aria-label="고객센터 문의하기">
        <MemberSettingsLead label="1:1 INQUIRY" title="문의하기" description="확인에 필요한 내용을 남기면 접수 순서대로 답변드려요." />
        <button type="button" className="inquiry-faq-link" onClick={() => flow.push(createCustomerCenterScreen())}><span><strong>문의 전에 빠르게 확인하기</strong><small>자주 묻는 질문에서 바로 답을 찾을 수 있어요.</small></span><IconChevronRightLine size={21} aria-hidden="true" /></button>
        {apiMode === "remote" ? (
          <section className="member-settings-section" aria-labelledby="inquiry-history-title">
            <h2 id="inquiry-history-title">내 문의 내역</h2>
            <div className="settings-menu-list">
              {inquiries.map((inquiry) => (
                <SettingsMenuRow
                  key={inquiry.id}
                  icon={<IconEnvelopeLine size={20} />}
                  label={inquiry.title}
                  summary={`${inquiryStatusLabel(inquiry.status)} · ${inquiry.category} · ${serverDateLabel(inquiry.createdAt)}`}
                  onClick={() => flow.push(createInquiryDetailScreen(inquiry.id, inquiry.title))}
                />
              ))}
              {inquiries.length === 0 ? <p role="status">접수된 문의가 없습니다.</p> : null}
            </div>
          </section>
        ) : null}
        <form className="member-settings-form inquiry-form" onSubmit={(event) => { event.preventDefault(); submit(); }} noValidate>
          <label><span>문의 유형</span><select value={category} onChange={(event) => setCategory(event.currentTarget.value)}><option value="order">주문·결제</option><option value="delivery">배송·보관함</option><option value="draw">가챠·쿠지 결과</option><option value="exchange">교환방·덕룸</option><option value="account">계정·개인정보</option><option value="other">기타</option></select></label>
          <label><span>주문번호 <small>선택</small></span><KeyboardInput value={orderNumber} maxLength={30} placeholder="관련 주문이 있을 때 입력" onChange={(event) => setOrderNumber(event.currentTarget.value)} onBlur={() => keyboard.hide()} /></label>
          <label><span>문의 제목</span><KeyboardInput value={title} maxLength={60} placeholder="무엇을 도와드릴까요?" onChange={(event) => setTitle(event.currentTarget.value)} onBlur={() => keyboard.hide()} /></label>
          <label><span>문의 내용</span><KeyboardTextarea value={details} maxLength={1000} placeholder="상품명, 발생 시점과 확인할 내용을 10자 이상 적어주세요." onChange={(event) => setDetails(event.currentTarget.value)} onBlur={() => keyboard.hide()} /><small className="member-field-help">{details.length}/1000 · 비밀번호, 카드번호, 주민등록번호는 적지 마세요.</small></label>
          <label>
            <span>{apiMode === "remote" ? "답변 확인" : "답변 받을 이메일"}</span>
            <KeyboardInput value={apiMode === "remote" ? "앱 내 문의 내역" : memberSettings.personal.email} readOnly aria-readonly="true" />
          </label>
          <ActionButton type="submit" variant="brandSolid" size="large" className="sheet-primary-button" loading={submitting} disabled={!valid || submitting}>{submitting ? "접수 중" : "문의 접수하기"}</ActionButton>
        </form>
        {submitStatus ? <p className="profile-subpage-status" role="status">{submitStatus}</p> : null}
      </main>
    </MobileScroll>
  );
}

function LegalHubPage({ flow }: { flow: FlowControls }) {
  const screenFocusRef = useScreenEntryFocus();
  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="member-settings-page legal-hub-page" aria-label="이용약관 및 정책 목록">
        <MemberSettingsLead label="LEGAL" title="이용약관 및 정책" description="DABBOBA를 안전하게 이용하기 위한 기준과 정보예요." />
        <section className="legal-review-callout" aria-label="출시 전 검토 안내"><IconDocumentLine size={22} aria-hidden="true" /><div><strong>출시용 약관 구조 초안</strong><p>대괄호 안의 실제 사업자 정보와 운영 조건을 확정하고 법률 검토를 받아야 합니다.</p></div></section>
        <section className="legal-document-list" aria-label="약관과 정책">
          {SETTINGS_LEGAL_DOCUMENTS.map((document) => <button key={document.id} type="button" onClick={() => flow.push(createLegalDocumentScreen(document))}><span><strong>{document.title}</strong><small>{document.summary}</small><em>{document.required ? "필수" : "운영정책"}</em></span><IconChevronRightLine size={21} aria-hidden="true" /></button>)}
        </section>
        <section className="legal-business-card" aria-labelledby="business-info-title"><h2 id="business-info-title">사업자 정보</h2><dl><div><dt>상호·대표자</dt><dd>[상호명] · [대표자명]</dd></div><div><dt>사업자 정보</dt><dd>[사업자등록번호] · [통신판매업 신고번호]</dd></div><div><dt>주소</dt><dd>[사업장 주소]</dd></div><div><dt>고객센터</dt><dd>[고객센터 이메일·전화번호·운영시간]</dd></div><div><dt>앱 버전</dt><dd>0.1.0 prototype</dd></div></dl></section>
        <section className="legal-release-checklist" aria-labelledby="legal-checklist-title"><h2 id="legal-checklist-title">출시 전 필수 확인</h2><ul>{LEGAL_RELEASE_CHECKLIST.map((item) => <li key={item}>{item}</li>)}</ul></section>
      </main>
    </MobileScroll>
  );
}

function LegalDocumentPage({ document }: { document: LegalDocument }) {
  const screenFocusRef = useScreenEntryFocus();
  return (
    <MobileScroll className="app-screen dabboba-screen">
      <article ref={screenFocusRef} tabIndex={-1} className="settings-article-page legal-document-page" aria-labelledby="legal-document-title">
        <header><span>{document.required ? "REQUIRED" : "POLICY"}</span><h1 id="legal-document-title">{document.title}</h1><p>{document.summary}</p><time>시행일: {document.effectiveDate}</time></header>
        <div className="settings-article-sections">{document.sections.map((section) => <section key={section.heading}><h2>{section.heading}</h2><p>{section.body}</p></section>)}</div>
        <p className="prototype-disclosure legal-document-disclosure">출시 화면 구성을 위한 법률 문서 초안입니다. 실제 서비스에 적용하기 전 사업자 정보와 운영 조건을 확정하고 전문가 검토를 받아야 합니다.</p>
      </article>
    </MobileScroll>
  );
}

function AccountDeletionPage({ flow }: { flow: FlowControls }) {
  const { requestAccountDeletion, apiMode } = useDabboba();
  const keyboard = useKeyboard();
  const screenFocusRef = useScreenEntryFocus();
  const deletionKeyRef = useRef("");
  const [confirmation, setConfirmation] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deletionRequest, setDeletionRequest] = useState<ApiAccountDeletionRequest | null>(null);
  const ready = confirmation.trim() === "탈퇴";

  const completeDeletion = async () => {
    if (deleting) return;
    if (!deletionKeyRef.current) deletionKeyRef.current = createSessionId("account-deletion");
    setDeleting(true);
    setDeleteStatus("");
    const result = await requestAccountDeletion(deletionKeyRef.current);
    setDeleting(false);
    setDeleteStatus(result.message);
    if (!result.ok) return;
    setDeletionRequest(result.data ?? null);
    setConfirmOpen(false);
    setCompleted(true);
  };

  if (completed) {
    return (
      <MobileScroll className="app-screen dabboba-screen">
        <main ref={screenFocusRef} tabIndex={-1} className="account-deletion-complete" aria-label="탈퇴 요청 완료">
          <span aria-hidden="true"><IconCheckmarkCircleFill size={32} /></span><h1>탈퇴 요청을 접수했어요.</h1><p>{deletionRequest?.status === "BLOCKED" ? "진행 중인 거래·보관 항목을 먼저 정리한 뒤 운영 검토가 이어집니다." : apiMode === "remote" ? "서버 세션이 종료됐고 요청은 운영 검토 대기 상태입니다." : "프로토타입 화면에서 탈퇴 흐름을 완료했습니다."}</p>
          <ActionButton type="button" variant="brandSolid" size="large" className="sheet-primary-button" onClick={() => returnToCatalog(flow)}>홈으로 돌아가기</ActionButton>
          <p className="prototype-disclosure">{apiMode === "remote" ? `요청 상태: ${deletionRequest?.status ?? "접수됨"} · 즉시 물리 삭제하지 않고 거래 보존 의무와 차단 항목을 운영자가 검토합니다.` : "현재는 화면 확인용이며 실제 계정이나 데이터는 삭제되지 않았습니다."}</p>
        </main>
      </MobileScroll>
    );
  }

  return (
    <>
      <MobileScroll className="app-screen dabboba-screen">
        <main ref={screenFocusRef} tabIndex={-1} className="member-settings-page account-deletion-page" aria-label="회원 탈퇴">
          <MemberSettingsLead label="DELETE ACCOUNT" title="탈퇴하기" description="삭제되는 정보와 남겨야 하는 기록을 확인한 뒤 요청해 주세요." />
          <section className="account-deletion-warning"><IconTrashcanLine size={24} aria-hidden="true" /><div><strong>탈퇴 후 되돌릴 수 없어요.</strong><p>프로필, 찜, 교환·덕룸 활동과 선택 알림 정보가 계정에서 삭제됩니다.</p></div></section>
          <section className="account-deletion-info"><h2>탈퇴 전에 확인해 주세요</h2><ul><li>보관함 상품과 진행 중인 주문·배송·교환을 먼저 정리해야 합니다.</li><li>관계 법령상 보관이 필요한 계약, 결제, 소비자 분쟁 기록은 정해진 기간 동안 계정과 분리해 보관할 수 있습니다.</li><li>게시물의 즉시 삭제 범위와 익명화 기준은 운영정책과 실제 백엔드 정책으로 확정해야 합니다.</li><li>정식 앱에서는 탈퇴 완료 시점과 처리 결과를 이메일로 안내합니다.</li></ul></section>
          <label className="account-deletion-confirm-field"><span>계속하려면 <strong>탈퇴</strong>를 입력해 주세요.</span><KeyboardInput value={confirmation} disabled={deleting} maxLength={2} placeholder="탈퇴" onChange={(event) => { setConfirmation(event.currentTarget.value); setDeleteStatus(""); }} onBlur={() => keyboard.hide()} /></label>
          <ActionButton type="button" variant="brandSolid" size="large" className="sheet-primary-button account-deletion-button" disabled={deleting || !ready} onClick={() => { keyboard.hide(); setConfirmOpen(true); }}>탈퇴 요청하기</ActionButton>
          {deleteStatus ? <p className="profile-subpage-status" role="status">{deleteStatus}</p> : null}
          <p className="prototype-disclosure member-detail-disclosure">{apiMode === "remote" ? "요청 시 활성 세션이 모두 폐기됩니다. 계정은 즉시 물리 삭제하지 않으며 서버가 포인트·주문·결제·추첨권·보관함·배송·교환 차단 항목을 함께 기록합니다." : "Google Play 출시 전에는 앱 밖에서도 접근 가능한 웹 탈퇴 요청 경로를 추가해야 합니다."}</p>
        </main>
      </MobileScroll>
      <BottomSheet open={confirmOpen} onOpenChange={setConfirmOpen} title="정말 탈퇴할까요?" description="정식 서비스에서는 본인 확인 후 계정과 연결 데이터를 삭제합니다." snap={0.42}>
        <div className="settings-confirm-actions"><ActionButton type="button" variant="brandSolid" size="large" className="sheet-primary-button account-deletion-button" loading={deleting} disabled={deleting} onClick={() => void completeDeletion()}>{deleting ? "요청 중" : "탈퇴 확정"}</ActionButton><button type="button" disabled={deleting} onClick={() => setConfirmOpen(false)}>취소</button></div>
      </BottomSheet>
    </>
  );
}

function CatalogPage({ flow }: { flow: FlowControls }) {
  const { catalogProducts, apiMode, apiSyncState, apiSyncMessage } = useDabboba();
  const [filter, setFilter] = useState<CategoryFilter>("전체");
  const screenFocusRef = useScreenEntryFocus();
  const isFigureComingSoon = filter === "피규어";
  const customerBrowsableProducts = catalogProducts.filter((product) => (
    isCustomerBrowsableProductCategory(product.categoryId)
  ));
  const visibleProducts = filter === "전체"
    ? customerBrowsableProducts
    : customerBrowsableProducts.filter((product) => product.category === filter);

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <NativeBridgeController rootScreenId="root-home" />
      <main ref={screenFocusRef} tabIndex={-1} className="catalog-page" aria-label="DABBOBA 상품 목록">
        <section className="texture-banner" aria-labelledby="catalog-title">
          <img
            src="/assets/dabboba/retro-arcade-texture.png"
            alt=""
            className="retro-texture"
            draggable={false}
            aria-hidden="true"
          />
          <div className="banner-copy">
            <span>8BIT SELECT</span>
            <h1 id="catalog-title">취향을 고르고<br />오늘 가볍게 골라봐.</h1>
            <p>가챠와 쿠지를 한곳에서, 피규어는 준비 중이에요.</p>
          </div>
        </section>

        <PopularIpSection flow={flow} />

        <Carousel
          className="category-carousel"
          contentClassName="category-rail"
          ariaLabel="상품 카테고리"
        >
          {filters.map((item) => (
            <button
              key={item}
              type="button"
              className="filter-chip"
              data-selected={item === filter ? "true" : "false"}
              aria-pressed={item === filter}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
        </Carousel>

        <section className="catalog-section" aria-labelledby="available-products">
          <div className="section-heading">
            <h2 id="available-products">지금 만날 수 있어요</h2>
            <span>{visibleProducts.length}개</span>
          </div>
          <ProductGrid flow={flow} items={visibleProducts} />
          {visibleProducts.length === 0 ? (
            <div className="ip-empty-state" role="status">
              <strong>{isFigureComingSoon ? "준비중입니다." : "등록된 상품이 없어요"}</strong>
              <span>{isFigureComingSoon ? "피규어 상품은 준비가 끝나는 대로 공개할게요." : "운영 카탈로그가 준비되면 여기에 표시됩니다."}</span>
            </div>
          ) : null}
        </section>
        <p className="prototype-disclosure">
          {apiMode === "remote"
            ? apiSyncState === "ready" ? "상품과 재고는 서버 카탈로그 기준입니다." : apiSyncMessage
            : apiSyncState === "error" && apiSyncMessage
              ? `API 설정 오류로 프로토타입 데이터를 표시합니다. ${apiSyncMessage}`
              : "상품과 재고는 화면 확인용 프로토타입 데이터입니다."}
        </p>
      </main>
    </MobileScroll>
  );
}

function ProductGrid({ flow, items }: { flow: FlowControls; items: Product[] }) {
  return (
    <div className="product-grid">
      {items.filter((product) => isCustomerBrowsableProductCategory(product.categoryId)).map((product, index) => (
        <button
          key={product.id}
          type="button"
          className="product-card"
          onClick={() => flow.push(createDetailScreen(product))}
          aria-label={`${product.title}, ${formatWon(product.price)}, ${product.stock}${commerceUnit(product)} 남음`}
        >
          <span className="product-media">
            <img
              src={product.asset}
              alt=""
              loading={index < 6 ? "eager" : "lazy"}
              decoding={index < 6 ? "sync" : "async"}
              draggable={false}
            />
            <span className="product-category">{product.category}</span>
          </span>
          <span className="product-copy">
            <small>{product.line}</small>
            <strong>{product.title}</strong>
            <span className="product-price-row">
              <b>{formatWon(product.price)}</b>
              <em>{product.stock}{commerceUnit(product)} 남음</em>
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function PopularIpSection({ flow }: { flow: FlowControls }) {
  const { catalogIps, catalogProducts } = useDabboba();
  const customerBrowsableIps = catalogIps.filter((ip) => (
    catalogProducts.some((product) => (
      product.ipId === ip.id && isCustomerBrowsableProductCategory(product.categoryId)
    ))
  ));
  const featuredIps = customerBrowsableIps.filter((ip) => ip.featured).slice(0, 8);
  const visibleIps = featuredIps.length ? featuredIps : customerBrowsableIps.slice(0, 8);
  return (
    <section className="popular-ip-section" aria-labelledby="popular-ip-title">
      <div className="section-heading popular-ip-heading">
        <div>
          <span className="section-eyebrow">IP SELECT</span>
          <h2 id="popular-ip-title">인기 작품</h2>
        </div>
        <button type="button" className="section-link" onClick={() => flow.push(createIpCatalogScreen())}>
          전체보기
          <IconChevronRightLine size={18} aria-hidden="true" />
        </button>
      </div>
      <Carousel className="popular-ip-carousel" contentClassName="popular-ip-rail" ariaLabel="인기 작품">
        {visibleIps.map((ip, index) => (
          <button
            key={ip.id}
            type="button"
            className="popular-ip-card"
            onClick={() => flow.push(createIpDetailScreen(ip))}
            aria-label={`${ip.nameKo} 작품 보기`}
          >
            <span className="popular-ip-media">
              {ip.image ? <img src={ip.image} alt="" loading="eager" decoding="sync" draggable={false} /> : null}
              <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            </span>
            <strong>{ip.nameKo}</strong>
          </button>
        ))}
      </Carousel>
    </section>
  );
}

function IpCatalogPage({ flow }: { flow: FlowControls }) {
  const { catalogIps, catalogProducts } = useDabboba();
  const [query, setQuery] = useState("");
  const keyboard = useKeyboard();
  const screenFocusRef = useScreenEntryFocus();
  const visibleIps = useMemo(() => catalogIps.filter((ip) => (
    catalogProducts.some((product) => (
      product.ipId === ip.id && isCustomerBrowsableProductCategory(product.categoryId)
    )) && matchesIpSearch(ip, query)
  )), [catalogIps, catalogProducts, query]);

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="ip-catalog-page" aria-label="전체 작품 검색">
        <div className="ip-search-box">
          <IconMagnifyingglassLine size={21} aria-hidden="true" />
          <KeyboardInput
            type="search"
            value={query}
            placeholder="작품명·별칭 검색"
            aria-label="작품 검색"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setQuery("");
                keyboard.hide();
              }
            }}
          />
          {query ? (
            <button type="button" className="ip-search-clear" onClick={() => setQuery("")} aria-label="검색어 지우기">
              <IconXmarkLine size={19} aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <div className="ip-directory-heading">
          <div>
            <span className="section-eyebrow">ALL IP</span>
            <h1>작품을 골라보세요</h1>
          </div>
          <span aria-live="polite">{visibleIps.length}개</span>
        </div>

        {visibleIps.length ? (
          <div className="ip-grid">
            {visibleIps.map((ip, index) => (
              <button
                key={ip.id}
                type="button"
                className="ip-grid-card"
                onClick={() => flow.push(createIpDetailScreen(ip))}
                aria-label={`${ip.nameKo}, ${ip.nameEn}`}
              >
                <span className="ip-grid-media">
                  {ip.image ? <img
                    src={ip.image}
                    alt={`${ip.nameKo} 작품 이미지`}
                    loading={index < 8 ? "eager" : "lazy"}
                    decoding={index < 8 ? "sync" : "async"}
                    draggable={false}
                  /> : null}
                </span>
                <strong>{ip.nameKo}</strong>
                <small>{ip.nameEn}</small>
              </button>
            ))}
          </div>
        ) : (
          <div className="ip-empty-state">
            <IconMagnifyingglassLine size={30} aria-hidden="true" />
            <strong role="status">검색 결과가 없어요</strong>
            <span>다른 이름이나 별칭으로 검색해 보세요.</span>
            <small>목록에 없는 작품은 신청방에서 운영자에게 추가를 요청할 수 있어요.</small>
            <button type="button" className="settings-secondary-action" onClick={() => flow.push(createRequestRoomScreen())}>
              신청방에서 작품 추가 요청하기
            </button>
          </div>
        )}
      </main>
    </MobileScroll>
  );
}

function IpDetailPage({ flow, ip }: { flow: FlowControls; ip: IpRecord }) {
  const [activeTab, setActiveTab] = useState<IpDetailTab>("상품");
  const screenFocusRef = useScreenEntryFocus();
  const activeTabIndex = ipDetailTabs.indexOf(activeTab);
  const panelId = `ip-panel-${ip.slug}`;
  const visibleAvailableCategories = CUSTOMER_VISIBLE_PRODUCT_CATEGORIES.filter((category) => (
    ip.availableCategories.includes(category.id)
  ));

  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = ipDetailTabs.length - 1;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % ipDetailTabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + ipDetailTabs.length) % ipDetailTabs.length;
    setActiveTab(ipDetailTabs[nextIndex]);
    const group = event.currentTarget.parentElement;
    window.requestAnimationFrame(() => group?.querySelectorAll<HTMLElement>('[role="tab"]')[nextIndex]?.focus());
  };

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="ip-detail-page" aria-label={`${ip.nameKo} 작품 정보`}>
        <section className="ip-detail-hero">
          {ip.image ? <img src={ip.image} alt={`${ip.nameKo} 작품 이미지`} decoding="async" draggable={false} /> : null}
          <div className="ip-detail-hero-copy">
            <span>IP FILE · {ip.sourceMediaId}</span>
            <h1>{ip.nameKo}</h1>
            <strong>{ip.nameEn}</strong>
          </div>
        </section>

        <section className="ip-detail-summary" aria-label="작품 소개">
          <p>{ip.description}</p>
          <div className="ip-category-list" aria-label="운영 카테고리">
            {visibleAvailableCategories.map((category) => (
              <span key={category.id}>{category.label}</span>
            ))}
          </div>
          {ip.sourcePage.startsWith("http") ? <a href={ip.sourcePage} target="_blank" rel="noreferrer">이미지 출처 확인</a> : null}
        </section>

        <div className="ip-tab-list" role="tablist" aria-label={`${ip.nameKo} 콘텐츠`}>
          {ipDetailTabs.map((tab, index) => {
            const selected = activeTab === tab;
            return (
              <button
                key={tab}
                id={`ip-tab-${ip.slug}-${index}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                data-selected={selected ? "true" : "false"}
                onClick={() => setActiveTab(tab)}
                onKeyDown={(event) => moveTab(event, index)}
              >
                {tab}
              </button>
            );
          })}
        </div>

        <section
          id={panelId}
          className="ip-tab-panel"
          role="tabpanel"
          aria-labelledby={`ip-tab-${ip.slug}-${activeTabIndex}`}
          tabIndex={0}
        >
          <IpTabContent flow={flow} ip={ip} tab={activeTab} />
        </section>
      </main>
    </MobileScroll>
  );
}

function IpTabContent({ flow, ip, tab }: { flow: FlowControls; ip: IpRecord; tab: IpDetailTab }) {
  const { setActiveRootTab, catalogProducts, apiMode } = useDabboba();

  if (tab === "상품") {
    const linkedProducts = catalogProducts.filter((product) => (
      product.ipId === ip.id && isCustomerBrowsableProductCategory(product.categoryId)
    ));

    return (
      <>
        <div className="ip-panel-heading">
          <IconGridLine size={23} aria-hidden="true" />
          <div><strong>카테고리</strong><span>이 작품의 상품 구조를 먼저 확인해 보세요.</span></div>
        </div>
        <div className="ip-category-cards">
          {CUSTOMER_VISIBLE_PRODUCT_CATEGORIES.map((category) => {
            const available = ip.availableCategories.includes(category.id);
            const status = category.id === "figure"
              ? "준비중입니다."
              : available
                ? `${linkedProducts.filter((product) => product.categoryId === category.id).length}개 운영 중`
                : "입점 예정";
            return (
              <div key={category.id} data-available={available ? "true" : "false"}>
                <span>{category.label}</span>
                <small>{status}</small>
              </div>
            );
          })}
        </div>
        <div className="ip-linked-products" aria-label={`${ip.nameKo} 운영 상품`}>
          {linkedProducts.map((product) => (
            <button
              key={product.id}
              type="button"
              className="ip-linked-product"
              onClick={() => flow.push(createDetailScreen(product))}
              aria-label={`${product.title} 상세 보기`}
            >
              <img src={product.asset} alt="" loading="eager" decoding="sync" draggable={false} />
              <span>
                <small>{product.category} · {formatWon(product.price)}</small>
                <strong>{product.title}</strong>
                <em>{product.stock}{commerceUnit(product)} 남음</em>
              </span>
              <IconChevronRightLine size={22} aria-hidden="true" />
            </button>
          ))}
        </div>
        <p className="prototype-disclosure">{apiMode === "remote" ? "상품 가격과 재고는 서버 카탈로그 기준입니다." : "임시 테스트 상품과 재고이며 실제 운영 전 상품 계약·권리 확인이 필요합니다."}</p>
      </>
    );
  }

  if (tab === "캐릭터") {
    return (
      <>
        <div className="ip-panel-heading">
          <IconPerson2Line size={23} aria-hidden="true" />
          <div><strong>대표 캐릭터</strong><span>상품 탐색에 사용할 기본 캐릭터 목록입니다.</span></div>
        </div>
        <div className="character-list">
          {ip.characters.map((character, index) => (
            <div key={character}><span>{String(index + 1).padStart(2, "0")}</span><strong>{character}</strong></div>
          ))}
          {ip.characters.length === 0 ? <p role="status">등록된 캐릭터가 없습니다.</p> : null}
        </div>
      </>
    );
  }

  if (tab === "스냅") {
    return (
      <div className="ip-empty-state ip-tab-empty">
        <IconCameraLine size={32} aria-hidden="true" />
        <strong>아직 등록된 스냅이 없어요</strong>
        <span>수집 사진과 후기 기능은 다음 단계에서 연결됩니다.</span>
      </div>
    );
  }

  return (
    <div className="ip-empty-state ip-tab-empty">
      <IconDot3HorizontalChatbubbleLeftLine size={32} aria-hidden="true" />
      <strong>{ip.nameKo} 교환을 찾아보세요</strong>
      <span>올라온 상품을 보고 내 보유 상품으로 교환을 제안할 수 있어요.</span>
      <button
        type="button"
        className="ip-exchange-link"
        onClick={() => {
          setActiveRootTab("community");
          flow.replace(createExchangeRoomScreen());
        }}
      >
        교환방으로 이동
      </button>
    </div>
  );
}

function ProductDetail({ product }: { product: Product }) {
  const { apiMode, drawOddsByProductId, drawOddsStateByProductId, loadDrawOdds } = useDabboba();
  const screenFocusRef = useScreenEntryFocus();
  const drawMode = isRandomDrawCategory(product.categoryId);
  const prizeGuide = prizeGuideFor(product.categoryId);
  const purchaseGuide = purchaseGuideFor(product);
  const drawOdds = drawOddsByProductId[product.id];
  const drawOddsState = drawOddsStateByProductId[product.id];

  useEffect(() => {
    if (apiMode !== "remote" || !drawMode || drawOdds || drawOddsState !== undefined) return;
    void loadDrawOdds(product.id);
  }, [apiMode, drawMode, drawOdds, drawOddsState, loadDrawOdds, product.id]);

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="detail-page" aria-label={`${product.title} 상세 정보`}>
        <div className="detail-hero">
          <img src={product.asset} alt={`${product.title} 상품 이미지`} decoding="async" draggable={false} />
          <span>{product.edition}</span>
        </div>

        <div className="detail-content">
          <div className="detail-kicker">
            <span>{product.category}</span>
            <b>남은 수량 {product.stock}{commerceUnit(product)}</b>
          </div>
          <h1>{product.title}</h1>
          <p>{product.description}</p>
          <strong className="detail-price">{formatWon(product.price)}</strong>
          {product.sourcePage.startsWith("http") ? <a className="product-source-link" href={product.sourcePage} target="_blank" rel="noreferrer">
            임시 상품 이미지 출처
            <IconChevronRightLine size={17} aria-hidden="true" />
          </a> : null}

          <div className="detail-facts" aria-label="상품 안내">
            <div>
              <IconReceiptLine size={22} aria-hidden="true" />
              <span>{drawMode ? "결제 후 오락실에서 즉시 추첨" : "표시된 상품을 그대로 구매"}</span>
            </div>
            <div>
              <IconBoxFlapLine size={22} aria-hidden="true" />
              <span>{drawMode ? "당첨 상품은 보관함에 저장" : "주문 완료 후 구매 내역과 보관함에 저장"}</span>
            </div>
            <div>
              <IconTruckLine size={22} aria-hidden="true" />
              <span>{drawMode ? "보관함에서 합배송 신청 가능" : "배송 신청 단계에서 수령 정보 입력"}</span>
            </div>
          </div>

          {drawMode ? (
            <section className="detail-section" aria-labelledby="prize-guide">
              <h2 id="prize-guide">현재 경품·확률</h2>
              {apiMode === "remote" ? (
                drawOdds ? (
                  <>
                    <ServerDrawOddsTable odds={drawOdds} label={`확률표 버전 ${drawOdds.version}`} />
                    <DrawOddsDisclosure odds={drawOdds} />
                  </>
                ) : (
                  <div className="ip-empty-state ip-tab-empty" role="status">
                    <IconLockLine size={28} aria-hidden="true" />
                    <strong>{drawOddsState === "unavailable" ? "공개된 확률표가 없습니다" : drawOddsState === "error" ? "확률표를 불러오지 못했습니다" : "서버 확률표 확인 중"}</strong>
                    <span>활성 경품·확률표를 확인하기 전에는 주문할 수 없습니다.</span>
                    {drawOddsState === "unavailable" || drawOddsState === "error" ? (
                      <button type="button" onClick={() => { void loadDrawOdds(product.id); }}>다시 확인</button>
                    ) : null}
                  </div>
                )
              ) : (
                <>
                  <div className="grade-table">
                    <div><span>S</span><b>{prizeGuide[0]}</b><em>2%</em></div>
                    <div><span>A</span><b>{prizeGuide[1]}</b><em>18%</em></div>
                    <div><span>B</span><b>{prizeGuide[2]}</b><em>80%</em></div>
                  </div>
                  <p>개발 프리뷰용 등급표이며 실제 판매 확률이 아닙니다.</p>
                </>
              )}
            </section>
          ) : (
            <section className="detail-section" aria-labelledby="purchase-guide-title">
              <h2 id="purchase-guide-title">구매 안내</h2>
              <dl className="purchase-guide">
                {purchaseGuide.map(([label, value]) => (
                  <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                ))}
              </dl>
              <p>
                {product.categoryId === "tcg"
                  ? "팩 속 카드는 제조사 기준으로 무작위 구성될 수 있으며, 구매한 팩 그대로 제공됩니다."
                  : "선택한 피규어와 수량 그대로 주문됩니다."}
              </p>
            </section>
          )}
        </div>
      </main>
    </MobileScroll>
  );
}

function DetailFooter({ flow, product }: { flow: FlowControls; product: Product }) {
  const {
    apiMode,
    prepareCheckout,
    sessionCommerce,
    toggleWishlistProduct,
    drawOddsByProductId,
    drawOddsStateByProductId,
    loadDrawOdds,
  } = useDabboba();
  const liked = sessionCommerce.wishlistProductIds.includes(product.id);
  const pendingWishlistRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [wishlistPending, setWishlistPending] = useState(false);
  const [wishlistStatus, setWishlistStatus] = useState("");
  const [oddsRefreshing, setOddsRefreshing] = useState(false);
  const [oddsRefreshStatus, setOddsRefreshStatus] = useState("");
  const commerceCopy = commerceCopyFor(product);
  const drawMode = isRandomDrawCategory(product.categoryId);
  const drawOdds = drawOddsByProductId[product.id];
  const drawOddsState = drawOddsStateByProductId[product.id];
  const drawDisclosureReady = apiMode !== "remote" || !drawMode || Boolean(drawOdds);
  const unit = commerceCopy.unit;
  const maxQuantity = Math.min(5, product.stock);
  const total = product.price * quantity;

  const continueToCheckout = async () => {
    if (!drawDisclosureReady) return;
    if (apiMode === "remote" && drawMode) {
      setOddsRefreshing(true);
      setOddsRefreshStatus("결제 화면으로 이동하기 전에 현재 남은 경품·확률을 다시 확인합니다.");
      const refreshed = await loadDrawOdds(product.id, true);
      setOddsRefreshing(false);
      if (!refreshed.ok || !refreshed.data) {
        setOddsRefreshStatus(refreshed.message);
        return;
      }
    }
    setOddsRefreshStatus("");
    setSheetOpen(false);
    prepareCheckout();
    flow.push(createCheckoutScreen(product, quantity));
  };

  useEffect(() => {
    if (apiMode !== "remote" || !drawMode || drawOdds || drawOddsState !== undefined) return;
    void loadDrawOdds(product.id);
  }, [apiMode, drawMode, drawOdds, drawOddsState, loadDrawOdds, product.id]);
  const toggleWishlist = async () => {
    if (wishlistPending) return;
    setWishlistPending(true);
    setWishlistStatus("");
    const fingerprint = `${product.id}:${liked ? "remove" : "add"}`;
    const pending = pendingWishlistRef.current?.fingerprint === fingerprint
      ? pendingWishlistRef.current
      : { fingerprint, key: createSessionId("wishlist") };
    pendingWishlistRef.current = pending;
    const result = await toggleWishlistProduct(product.id, pending.key);
    setWishlistPending(false);
    setWishlistStatus(result.message);
    if (result.ok) pendingWishlistRef.current = null;
  };

  if (!isCustomerBrowsableProductCategory(product.categoryId)) {
    return (
      <div className="route-footer detail-footer">
        <ActionButton
          type="button"
          variant="neutralSolid"
          size="large"
          className="primary-action"
          disabled
        >준비중입니다.</ActionButton>
      </div>
    );
  }

  return (
    <>
      <div className="route-footer detail-footer">
        <button
          type="button"
          className="favorite-button"
          disabled={wishlistPending}
          onClick={() => { void toggleWishlist(); }}
          aria-label={wishlistPending ? "찜 처리 중" : liked ? "찜 해제" : "찜하기"}
          aria-pressed={liked}
        >
          {liked ? <IconHeartFill size={26} aria-hidden="true" /> : <IconHeartLine size={26} aria-hidden="true" />}
        </button>
        <ActionButton
          type="button"
          variant="brandSolid"
          size="large"
          className="primary-action"
          disabled={maxQuantity < 1 || !drawDisclosureReady}
          onClick={() => setSheetOpen(true)}
        >
          {maxQuantity < 1 ? "품절" : !drawDisclosureReady ? "확률표 확인 필요" : commerceCopy.action}
        </ActionButton>
      </div>
      {wishlistStatus ? <p className="prototype-disclosure" role="status">{wishlistStatus}</p> : null}

      <BottomSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={commerceCopy.quantityTitle}
        description={commerceCopy.quantityDescription}
        snap={0.5}
      >
        <div className="sheet-product">
          <img src={product.asset} alt="" decoding="async" draggable={false} />
          <div>
            <small>{product.line}</small>
            <strong>{product.title}</strong>
            <span>{formatWon(product.price)} / 1{unit}</span>
          </div>
        </div>

        <div className="quantity-row">
          <div>
            <small>수량</small>
            <strong>최대 {maxQuantity}{unit}까지</strong>
          </div>
          <div className="quantity-stepper" aria-label={commerceCopy.quantityTitle}>
            <button
              type="button"
              onClick={() => setQuantity((current) => Math.max(1, current - 1))}
              disabled={quantity === 1}
              aria-label="수량 줄이기"
            >
              <IconMinusLine size={20} aria-hidden="true" />
            </button>
            <strong aria-live="polite">{quantity}</strong>
            <button
              type="button"
              onClick={() => setQuantity((current) => Math.min(maxQuantity, current + 1))}
              disabled={quantity === maxQuantity}
              aria-label="수량 늘리기"
            >
              <IconPlusLine size={20} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="sheet-total">
          <span>결제 예정 금액</span>
          <strong>{formatWon(total)}</strong>
        </div>
        {drawOdds ? <p className="draw-commit-status">확인한 확률표 v{drawOdds.version} · 표시 값은 조회 시점 기준이며 다른 추첨 처리로 달라질 수 있습니다. 결제 직전에 다시 확인하며, 중복 방지 표시가 없으면 같은 경품을 다시 받을 수 있습니다.</p> : null}
        {oddsRefreshStatus ? <p className="draw-commit-status" role="status">{oddsRefreshStatus}</p> : null}
        <ActionButton
          type="button"
          variant="brandSolid"
          size="large"
          className="sheet-primary-button"
          loading={oddsRefreshing}
          disabled={!drawDisclosureReady || oddsRefreshing}
          onClick={() => { void continueToCheckout(); }}
        >
          {oddsRefreshing ? "현재 확률 확인 중" : "결제하기"}
        </ActionButton>
      </BottomSheet>
    </>
  );
}

function CheckoutPage({ product, quantity }: { product: Product; quantity: number }) {
  const {
    pointBalance,
    couponDiscount,
    setCouponDiscount,
    points,
    setPoints,
    paymentMethod,
    setPaymentMethod,
    apiMode,
    drawOddsByProductId,
  } = useDabboba();
  const keyboard = useKeyboard();
  const screenFocusRef = useScreenEntryFocus();
  const [couponOpen, setCouponOpen] = useState(false);
  const unit = commerceUnit(product);
  const subtotal = product.price * quantity;
  const drawOdds = drawOddsByProductId[product.id];
  const maxPoints = Math.max(0, Math.min(pointBalance, subtotal - couponDiscount));

  const updatePoints = (value: string) => {
    const numeric = Number(value.replace(/[^0-9]/g, ""));
    setPoints(Math.min(Number.isFinite(numeric) ? numeric : 0, maxPoints));
  };

  const selectCoupon = (discount: number, close = true) => {
    setCouponDiscount(discount);
    setPoints((current) => Math.min(current, Math.max(0, subtotal - discount)));
    if (close) setCouponOpen(false);
  };

  return (
    <>
      <MobileScroll className="app-screen dabboba-screen">
        <main ref={screenFocusRef} tabIndex={-1} className="checkout-page" aria-label="결제 정보 입력">
          <section className="checkout-section" aria-labelledby="order-product">
            <h1 id="order-product">구매 상품</h1>
            <div className="checkout-product">
              <img src={product.asset} alt="" decoding="async" draggable={false} />
              <div>
                <small>{product.line}</small>
                <strong>{product.title}</strong>
                <span>{formatWon(product.price)} · {quantity}{unit}</span>
              </div>
            </div>
          </section>

          {apiMode === "remote" && isRandomDrawCategory(product.categoryId) ? (
            <section className="checkout-section" aria-labelledby="checkout-draw-odds-title">
              <h2 id="checkout-draw-odds-title">확인한 경품·확률</h2>
              {drawOdds ? (
                <>
                  <ServerDrawOddsTable odds={drawOdds} compact label={`결제 적용 확률표 버전 ${drawOdds.version}`} />
                  <DrawOddsDisclosure odds={drawOdds} compact />
                </>
              ) : <p role="alert">확률표를 확인할 수 없어 주문을 진행할 수 없습니다.</p>}
            </section>
          ) : null}

          <section className="checkout-section" aria-labelledby="discount-title">
            <h2 id="discount-title">할인</h2>
            <button type="button" className="checkout-row" disabled={apiMode === "remote"} onClick={() => setCouponOpen(true)}>
              <IconCouponLine size={22} aria-hidden="true" />
              <span>쿠폰</span>
              <b>{apiMode === "remote" ? "쿠폰 API 준비 중" : couponDiscount ? `${formatWon(couponDiscount)} 할인` : "사용 안 함"}</b>
              <IconChevronRightLine size={21} aria-hidden="true" />
            </button>

            <div className="point-box">
              <div className="point-heading">
                <span>포인트</span>
                <small>보유 {formatPoints(pointBalance)}</small>
              </div>
              <div className="point-input-row">
                <KeyboardInput
                  type="text"
                  inputMode="numeric"
                  value={points || ""}
                  placeholder="0"
                  aria-label="사용할 포인트"
                  onChange={(event) => updatePoints(event.currentTarget.value)}
                  onBlur={() => keyboard.hide()}
                />
                <span>원</span>
                <button type="button" onClick={() => setPoints(maxPoints)}>모두 사용</button>
              </div>
            </div>
          </section>

          <section className="checkout-section" aria-labelledby="payment-title">
            <h2 id="payment-title">{apiMode === "remote" ? "결제 수단 · PG 연동 준비 중" : "결제 수단"}</h2>
            <div className="payment-list" role="radiogroup" aria-label="결제 수단">
              {paymentMethods.map((method, index) => {
                const selected = method === paymentMethod;
                return (
                  <button
                    key={method}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    tabIndex={selected ? 0 : -1}
                    disabled={apiMode === "remote"}
                    className="payment-method"
                    data-selected={selected ? "true" : "false"}
                    onClick={() => setPaymentMethod(method)}
                    onKeyDown={(event) => handleRadioArrow(event, paymentMethods, index, setPaymentMethod)}
                  >
                    <IconCardLine size={22} aria-hidden="true" />
                    <span>{method}</span>
                    {selected ? (
                      <IconCheckmarkCircleFill className="selected-check" size={22} aria-hidden="true" />
                    ) : (
                      <span className="empty-check" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          <div className="secure-note">
            <IconLockLine size={18} aria-hidden="true" />
            <span>{apiMode === "remote" ? "서버가 가격·포인트·재고를 다시 검증해 주문 예약만 생성합니다. 결제 승인은 별도 PG 연결이 필요합니다." : "이 화면은 결제 흐름 확인용 프로토타입이며 실제 결제는 이루어지지 않습니다."}</span>
          </div>
        </main>
      </MobileScroll>

      <BottomSheet
        open={couponOpen}
        onOpenChange={setCouponOpen}
        title="쿠폰 선택"
        description="이번 주문에 사용할 쿠폰을 골라주세요."
        snap={0.43}
      >
        <div className="coupon-list" role="radiogroup" aria-label="쿠폰">
          {couponOptions.map((discount, index) => {
            const selected = couponDiscount === discount;
            return (
              <button
                key={discount}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                data-selected={selected ? "true" : "false"}
                onClick={() => selectCoupon(discount)}
                onKeyDown={(event) => handleRadioArrow(event, couponOptions, index, (value) => selectCoupon(value, false))}
              >
                <span>
                  <small>{discount ? "WELCOME" : "COUPON"}</small>
                  <strong>{discount ? "첫 구매 1,000원 할인" : "사용하지 않기"}</strong>
                </span>
                {selected ? <IconCheckmarkLine size={22} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      </BottomSheet>
    </>
  );
}

function CheckoutFooter({
  flow,
  product,
  quantity,
}: {
  flow: FlowControls;
  product: Product;
  quantity: number;
}) {
  const {
    currentUserId,
    couponDiscount,
    points,
    paymentMethod,
    paying,
    setPaying,
    prepareDraw,
    recordInventoryUnit,
    recordOrder,
    submitOrder,
    loadOrder,
    apiMode,
    drawOddsByProductId,
    loadDrawOdds,
  } = useDabboba();
  const timer = useRef<number | null>(null);
  const pendingOrderRef = useRef<{ fingerprint: string; key: string; serverOrderId?: string } | null>(null);
  const [checkoutStatus, setCheckoutStatus] = useState("");
  const [remoteOrderId, setRemoteOrderId] = useState("");
  const drawMode = isRandomDrawCategory(product.categoryId);
  const drawOdds = drawOddsByProductId[product.id];
  const total = Math.max(0, product.price * quantity - couponDiscount - points);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const pay = async () => {
    if (paying) return;
    if (apiMode === "remote" && drawMode && !drawOdds) {
      setCheckoutStatus("서버 경품·확률표를 다시 확인한 뒤 주문해 주세요.");
      return;
    }
    setPaying(true);
    setCheckoutStatus("");
    let confirmedDrawOdds = drawOdds;
    if (apiMode === "remote" && drawMode && !pendingOrderRef.current?.serverOrderId) {
      setCheckoutStatus("주문 직전 현재 남은 경품·확률을 다시 확인합니다.");
      const refreshed = await loadDrawOdds(product.id, true);
      if (!refreshed.ok || !refreshed.data) {
        setPaying(false);
        setCheckoutStatus(refreshed.message);
        return;
      }
      if (drawOdds && drawOddsInventorySignature(drawOdds) !== drawOddsInventorySignature(refreshed.data)) {
        pendingOrderRef.current = null;
        setPaying(false);
        setCheckoutStatus("남은 경품 수량과 현재 확률이 바뀌었습니다. 갱신된 표를 확인한 뒤 주문 버튼을 다시 눌러 주세요.");
        return;
      }
      confirmedDrawOdds = refreshed.data;
    }
    const fingerprint = JSON.stringify([product.id, quantity, points, couponDiscount, confirmedDrawOdds?.version ?? null]);
    const pending = pendingOrderRef.current?.fingerprint === fingerprint
      ? pendingOrderRef.current
      : {
        fingerprint,
        key: apiMode === "remote" ? createSessionId("remote-order") : createSessionId("DBB-order"),
      };
    pendingOrderRef.current = pending;
    const orderId = pending.key;
    if (apiMode === "remote") {
      const result = pending.serverOrderId
        ? await loadOrder(pending.serverOrderId)
        : await submitOrder({
          productId: product.id,
          quantity,
          pointAmount: points,
          ...(confirmedDrawOdds ? { expectedDrawVersion: confirmedDrawOdds.version } : {}),
          idempotencyKey: orderId,
        });
      setPaying(false);
      if (result.ok && result.data) {
        pending.serverOrderId = result.data.id;
        setRemoteOrderId(result.data.id);
        const fulfilled = result.data.status === "PAID" || result.data.status === "FULFILLED";
        if (fulfilled) {
          const entitlementIds = result.data.drawEntitlementIds ?? [];
          if (drawMode && entitlementIds.length !== quantity) {
            setCheckoutStatus("결제는 확인됐지만 추첨권 수량이 일치하지 않습니다. 고객센터에 문의해 주세요.");
            return;
          }
          pendingOrderRef.current = null;
          if (drawMode) prepareDraw(entitlementIds.length);
          flow.replace(createPurchaseCompleteScreen(
            product,
            quantity,
            result.data.total,
            result.data.id,
            entitlementIds,
          ));
          return;
        }
        setCheckoutStatus("주문 예약 상태입니다. PG 결제 완료 후 아래 버튼으로 서버 상태를 다시 확인해 주세요.");
        return;
      }
      setCheckoutStatus(result.message);
      return;
    }
    timer.current = window.setTimeout(() => {
      const orderedAt = sessionDateLabel();
      recordOrder({
        id: orderId,
        userId: currentUserId,
        productId: product.id,
        productTitle: product.title,
        productImage: product.asset,
        categoryId: product.categoryId,
        orderedAt,
        quantity,
        paidTotal: total,
        pointsUsed: points,
        status: drawMode ? "결제 완료" : "배송 신청 전",
      });
      if (!drawMode) {
        Array.from({ length: quantity }, (_, index) => index + 1).forEach((unitNumber) => {
          recordInventoryUnit({
            id: `${orderId}-unit-${unitNumber}`,
            ownerId: currentUserId,
            catalogItemId: `catalog-${product.id}`,
            productId: product.id,
            ipId: product.ipId,
            categoryId: product.categoryId,
            itemName: product.title,
            itemImage: product.asset,
            appReferenceValue: product.price,
            source: "direct-purchase",
            acquiredAt: orderedAt,
            shippingDeadline: sessionShippingDeadlineLabel(),
            shippingStatus: "stored",
            exchangeStatus: "available",
          });
        });
      }
      setPaying(false);
      if (drawMode) prepareDraw(quantity);
      flow.replace(createPurchaseCompleteScreen(product, quantity, total, orderId));
      timer.current = null;
    }, 900);
  };

  return (
    <div className="route-footer checkout-footer">
      <div className="payment-total">
        <small>{apiMode === "remote" ? "PG 결제 전 주문 예약" : paymentMethod}</small>
        <strong>{formatWon(total)}</strong>
        {checkoutStatus ? <span role="status">{checkoutStatus}</span> : null}
      </div>
      <ActionButton
        type="button"
        variant="brandSolid"
        size="large"
        className="primary-action checkout-action"
        loading={paying}
        disabled={paying || (apiMode === "remote" && drawMode && !drawOdds)}
        onClick={() => { void pay(); }}
      >
        {paying ? "서버 확인 중" : apiMode === "remote" ? remoteOrderId ? "결제 상태 확인" : "주문 예약하기" : "결제하기"}
      </ActionButton>
    </div>
  );
}

function PurchaseCompletePage({
  product,
  quantity,
  paidTotal,
  orderId,
}: {
  product: Product;
  quantity: number;
  paidTotal: number;
  orderId: string;
}) {
  const { apiMode } = useDabboba();
  const screenFocusRef = useScreenEntryFocus();
  const unit = commerceUnit(product);
  const drawMode = isRandomDrawCategory(product.categoryId);
  const drawActionLabel = product.categoryId === "gacha" ? "가챠하러 가기" : "쿠지 추첨하러 가기";

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main
        ref={screenFocusRef}
        tabIndex={-1}
        className="purchase-complete-page"
        aria-label={drawMode ? `${product.line} 결제 완료` : "일반 상품 주문 완료"}
      >
        <section className="purchase-complete-heading">
          <span><IconCheckmarkCircleFill size={36} aria-hidden="true" /></span>
          <h1>{drawMode ? "결제가 완료됐어요." : "구매가 완료됐어요."}</h1>
          <p>
            {drawMode
              ? `${product.category} · ${quantity}${unit} 이용권이 준비됐습니다.`
              : `${product.category} · ${quantity}${unit} 구매 내역이 준비됐습니다.`}
          </p>
        </section>

        <section className="purchase-complete-product" aria-labelledby="purchase-complete-product-title">
          <h2 id="purchase-complete-product-title">{drawMode ? "결제 상품" : "주문 상품"}</h2>
          <div>
            <img src={product.asset} alt="" decoding="async" draggable={false} />
            <span>
              <small>{product.line}</small>
              <strong>{product.title}</strong>
              <em>{formatWon(product.price)} · {quantity}{unit}</em>
            </span>
          </div>
        </section>

        <dl className="purchase-complete-meta">
          <div><dt>결제 금액</dt><dd>{formatWon(paidTotal)}</dd></div>
          <div><dt>{drawMode ? "결제 상태" : "주문 상태"}</dt><dd>결제 완료</dd></div>
          <div><dt>{drawMode ? "이용 상태" : "배송 상태"}</dt><dd>{drawMode ? "뽑기 대기" : "배송 신청 전"}</dd></div>
          <div><dt>{apiMode === "remote" ? "서버" : "테스트"} {drawMode ? "결제" : "주문"}번호</dt><dd>{orderId}</dd></div>
        </dl>

        <div className="purchase-complete-note">
          {drawMode ? <IconReceiptLine size={21} aria-hidden="true" /> : <IconTruckLine size={21} aria-hidden="true" />}
          <span>
            {drawMode
              ? `아직 상품은 확정되지 않았어요. 아래 ${drawActionLabel} 버튼을 눌러 뽑기를 진행해 주세요.`
              : apiMode === "remote" ? "구매 상품은 서버 보관함에 반영됐습니다. 배송 신청에서 수령 정보를 확인해 주세요." : "배송지 입력과 실제 주문 접수는 정식 결제·배송 시스템 연결 후 제공됩니다."}
          </span>
        </div>
        <p className="prototype-disclosure">
          {apiMode === "remote"
            ? "서버가 결제·재고 상태를 확인한 주문입니다. 추첨 결과는 애니메이션 전에 서버에서 확정됩니다."
            : `현재 화면은 ${drawMode ? "결제·뽑기" : "구매"} 흐름 확인용이며 실제 결제${drawMode ? "" : "·주문·배송"}는 발생하지 않았습니다.`}
        </p>
      </main>
    </MobileScroll>
  );
}

function PurchaseCompleteFooter({
  flow,
  product,
  quantity,
  orderId,
  drawEntitlementIds,
}: {
  flow: FlowControls;
  product: Product;
  quantity: number;
  orderId: string;
  drawEntitlementIds: string[];
}) {
  const drawMode = isRandomDrawCategory(product.categoryId);
  const drawActionLabel = product.categoryId === "gacha" ? "가챠하러 가기" : "쿠지 추첨하러 가기";

  return (
    <div className="route-footer purchase-complete-footer">
      <ActionButton
        type="button"
        variant="brandSolid"
        size="large"
        className="primary-action"
        onClick={() => {
          if (drawMode) {
            flow.replace(createDrawScreen(product, quantity, orderId, drawEntitlementIds));
            return;
          }
          returnToCatalog(flow);
        }}
      >
        {drawMode ? drawActionLabel : "상품 목록으로"}
      </ActionButton>
    </div>
  );
}

const CAPSULE_CINEMATIC_SCRUB_END = 0.7;

function CapsuleDrawAnimation({ state, controlProgress }: { state: DrawState; controlProgress: number }) {
  const cinematicRef = useRef<HTMLVideoElement | null>(null);
  const crankAngle = controlProgress * 360;
  const cinematicActive = state === "drawing" || state === "result";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const syncCinematic = useCallback((video: HTMLVideoElement) => {
    if (video.readyState === 0) return;

    if (state === "drawing") {
      if (reducedMotion) {
        video.pause();
        if (Number.isFinite(video.duration)) video.currentTime = Math.max(0, video.duration - 0.04);
        return;
      }

      if (
        video.ended
        || video.currentTime < CAPSULE_CINEMATIC_SCRUB_END - 0.08
        || video.currentTime > CAPSULE_CINEMATIC_SCRUB_END + 0.24
      ) {
        video.currentTime = CAPSULE_CINEMATIC_SCRUB_END;
      }
      void video.play().catch(() => undefined);
      return;
    }

    video.pause();
    if (state === "result" && Number.isFinite(video.duration)) {
      video.currentTime = Math.max(0, video.duration - 0.04);
    }
  }, [reducedMotion, state]);

  useEffect(() => {
    if (cinematicRef.current) syncCinematic(cinematicRef.current);
  }, [syncCinematic]);

  return (
    <div
      className="capsule-animation"
      data-state={state}
      style={{
        "--crank-drag-angle": `${crankAngle}deg`,
      } as CSSProperties}
      aria-hidden="true"
    >
      {cinematicActive ? (
        <video
          ref={cinematicRef}
          className="capsule-cinematic"
          src="/assets/dabboba/video/dabboba-capsule-lower-chute.mp4"
          poster="/assets/dabboba/video/dabboba-capsule-machine-poster.jpg"
          muted
          playsInline
          preload="auto"
          controls={false}
          disablePictureInPicture
          onLoadedMetadata={(event) => syncCinematic(event.currentTarget)}
        />
      ) : (
        <div className="capsule-ready-cinematic">
          <div className="capsule-ready-machine">
            <img
              className="capsule-ready-machine-art"
              src="/assets/dabboba/capsule-machine-front-pixel.png"
              alt=""
              draggable={false}
              decoding="async"
            />
            <img
              className="capsule-ready-crank-plate"
              src="/assets/dabboba/capsule-crank-plate-pixel.png"
              alt=""
              draggable={false}
              decoding="async"
            />
            <img
              className="capsule-ready-crank-handle"
              src="/assets/dabboba/capsule-crank-pixel.png"
              alt=""
              draggable={false}
              decoding="async"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function DrawPage({ product, quantity }: { product: Product; quantity: number }) {
  const {
    apiMode,
    drawState,
    drawRemaining,
    drawControlProgress,
    drawOddsByProductId,
    drawOddsStateByProductId,
    loadDrawOdds,
  } = useDabboba();
  const [oddsOpen, setOddsOpen] = useState(false);
  const screenFocusRef = useScreenEntryFocus();
  const unit = commerceUnit(product);
  const drawLabel = product.categoryId === "kuji" ? "쿠지 추첨" : "가챠 뽑기";
  const prizeGuide = prizeGuideFor(product.categoryId);
  const drawOdds = drawOddsByProductId[product.id];
  const drawOddsState = drawOddsStateByProductId[product.id];

  useEffect(() => {
    if (apiMode !== "remote" || drawOdds || drawOddsState !== undefined) return;
    void loadDrawOdds(product.id);
  }, [apiMode, drawOdds, drawOddsState, loadDrawOdds, product.id]);

  return (
    <>
      <MobileScroll className="app-screen dabboba-screen">
        <main ref={screenFocusRef} tabIndex={-1} className="draw-page" data-state={drawState} aria-label={`${product.line} ${drawLabel}`}>
          <div className="paid-ticket">
            <IconCheckmarkCircleFill size={22} aria-hidden="true" />
            <div>
              <strong>{product.categoryId === "gacha" ? "가챠 준비 완료" : "쿠지 준비 완료"}</strong>
              <span>{quantity}{unit} 추첨권이 준비됐어요</span>
            </div>
          </div>

          <div className="draw-heading">
            <span>{product.edition}</span>
            <h1>{product.line}</h1>
            <p>
              {product.categoryId === "gacha"
                ? "하단 바를 끝까지 밀면 레버가 돌아가고 뽑기가 시작돼요."
                : `${drawLabel} 버튼을 눌러 추첨을 시작하세요.`}
            </p>
          </div>

          <section className="arcade-stage" data-state={drawState} aria-label={`DABBOBA 오락실 ${drawLabel} 기계`}>
            {product.categoryId === "gacha" ? (
              <CapsuleDrawAnimation state={drawState} controlProgress={drawControlProgress} />
            ) : (
              <img
                src="/assets/dabboba/arcade-cabinet.png"
                className="arcade-cabinet"
                alt={`${product.line} 추첨을 진행하는 검은색 오락기`}
                draggable={false}
              />
            )}
            <span className="draw-status" aria-live="polite">
              {drawState === "drawing"
                ? product.categoryId === "gacha" ? "CAPSULE RUN" : "DRAWING"
                : drawState === "transitioning" ? "SYSTEM ON"
                : drawRemaining > 0 ? "READY" : "CLEAR"}
            </span>
          </section>

          <section className="draw-info" aria-label={`${drawLabel} 정보`}>
            <div>
              <img src={product.asset} alt="" decoding="async" draggable={false} />
              <span><small>선택한 상품</small><strong>{product.title}</strong></span>
            </div>
            <button type="button" onClick={() => setOddsOpen(true)}>
              <span><small>남은 추첨권</small><strong>{drawRemaining}{unit}</strong></span>
              <span>경품·확률</span>
              <IconChevronRightLine size={21} aria-hidden="true" />
            </button>
          </section>
        </main>
      </MobileScroll>

      <BottomSheet
        open={oddsOpen}
        onOpenChange={setOddsOpen}
        title="경품·확률"
        description="조회 시점 수치와 실제 추첨 기준을 확인해 주세요."
        snap={0.68}
      >
        {apiMode === "remote" ? (
          drawOdds ? (
            <>
              <ServerDrawOddsTable odds={drawOdds} compact label={`확률표 버전 ${drawOdds.version}`} />
              <DrawOddsDisclosure odds={drawOdds} compact />
            </>
          ) : (
            <div className="ip-empty-state ip-tab-empty" role="status">
              <IconLockLine size={28} aria-hidden="true" />
              <strong>서버 확률표 확인 중</strong>
              <span>추첨 결과 자체는 결제 당시 원장에 고정된 버전으로 서버가 먼저 확정합니다.</span>
            </div>
          )
        ) : (
          <div className="grade-table sheet-grade-table">
            <div><span>S</span><b>{prizeGuide[0]}</b><em>2%</em></div>
            <div><span>A</span><b>{prizeGuide[1]}</b><em>18%</em></div>
            <div><span>B</span><b>{prizeGuide[2]}</b><em>80%</em></div>
          </div>
        )}
        <ActionButton
          type="button"
          variant="brandSolid"
          size="large"
          className="sheet-primary-button"
          onClick={() => setOddsOpen(false)}
        >
          확인
        </ActionButton>
      </BottomSheet>
    </>
  );
}

function DrawFooter({
  flow,
  product,
  quantity,
  orderId,
  drawEntitlementIds,
}: {
  flow: FlowControls;
  product: Product;
  quantity: number;
  orderId: string;
  drawEntitlementIds: string[];
}) {
  const {
    apiMode,
    catalogProducts,
    currentUserId,
    drawState,
    setDrawState,
    drawRemaining,
    setDrawRemaining,
    resultOpen,
    setResultOpen,
    resultGrade,
    setResultGrade,
    drawControlProgress,
    setDrawControlProgress,
    recordInventoryUnit,
    updateOrderStatus,
    consumeDrawEntitlement,
  } = useDabboba();
  const drawTimer = useRef<number | null>(null);
  const transitionTimer = useRef<number | null>(null);
  const activationLockRef = useRef(false);
  const sliderTrackRef = useRef<HTMLDivElement | null>(null);
  const sliderThumbRef = useRef<HTMLButtonElement | null>(null);
  const [sliderX, setSliderX] = useState(0);
  const [drawCommitting, setDrawCommitting] = useState(false);
  const [drawStatus, setDrawStatus] = useState("");
  const [committedDrawResult, setCommittedDrawResult] = useState<ApiDrawResult | null>(null);
  const unit = commerceUnit(product);
  const drawNoun = product.categoryId === "kuji" ? "쿠지" : "뽑기";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const drawDuration = product.categoryId === "gacha"
    ? reducedMotion ? 420 : 3_350
    : 1_250;

  useEffect(() => () => {
    if (drawTimer.current !== null) window.clearTimeout(drawTimer.current);
    if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
  }, []);

  const resetSlider = useCallback(() => {
    activationLockRef.current = false;
    setSliderX(0);
    setDrawControlProgress(0);
  }, [setDrawControlProgress]);

  useEffect(() => {
    if (drawState === "ready") resetSlider();
  }, [drawState, resetSlider]);

  const finishDraw = useCallback((serverResult: ApiDrawResult | null) => {
      const grade = serverResult?.rarity ?? rollPrizeGrade();
      const drawNumber = quantity - drawRemaining + 1;
      const prizeProduct = serverResult
        ? catalogProducts.find((candidate) => candidate.id === serverResult.prizeProductId)
        : null;
      setCommittedDrawResult(serverResult);
      setResultGrade(grade);
      recordInventoryUnit({
        id: serverResult?.prizeInventoryUnitId ?? `${orderId}-draw-${drawNumber}`,
        ownerId: currentUserId,
        catalogItemId: serverResult ? `catalog-${serverResult.prizeProductId}` : `draw-result-${product.id}-${grade.toLowerCase()}`,
        productId: serverResult?.prizeProductId ?? product.id,
        ipId: serverResult?.prizeIpId ?? prizeProduct?.ipId ?? product.ipId,
        categoryId: serverResult?.prizeCategory ?? prizeProduct?.categoryId ?? product.categoryId,
        itemName: serverResult?.prizeName ?? prizeProduct?.title ?? `${grade}상 · ${rewardForGrade(product, grade as PrizeGrade)}`,
        itemImage: serverResult?.prizeImageUrl ?? prizeProduct?.asset ?? product.asset,
        appReferenceValue: prizeProduct?.price ?? product.price,
        source: product.categoryId === "kuji" ? "kuji" : "gacha",
        acquiredAt: serverResult ? serverDateLabel(serverResult.committedAt) : sessionDateLabel(),
        shippingDeadline: sessionShippingDeadlineLabel(),
        shippingStatus: "stored",
        exchangeStatus: "available",
      });
      if (apiMode === "prototype" && drawRemaining <= 1) updateOrderStatus(orderId, "뽑기 완료");
      setDrawRemaining((current) => Math.max(0, current - 1));
      setDrawState("result");
      setResultOpen(true);
      drawTimer.current = null;
  }, [
    apiMode,
    catalogProducts,
    currentUserId,
    drawRemaining,
    orderId,
    product,
    quantity,
    recordInventoryUnit,
    setDrawRemaining,
    setDrawState,
    setResultGrade,
    setResultOpen,
    updateOrderStatus,
  ]);

  const startDraw = useCallback(async () => {
    if (activationLockRef.current || drawCommitting || drawState === "transitioning" || drawState === "drawing" || drawRemaining < 1) return;
    activationLockRef.current = true;

    let serverResult: ApiDrawResult | null = null;
    if (apiMode === "remote") {
      const entitlementIndex = quantity - drawRemaining;
      const entitlementId = drawEntitlementIds[entitlementIndex];
      if (!entitlementId) {
        setDrawStatus("결제 확정된 서버 추첨권을 찾을 수 없습니다. 주문 상태를 다시 확인해 주세요.");
        activationLockRef.current = false;
        resetSlider();
        return;
      }
      setDrawCommitting(true);
      setDrawStatus("서버가 추첨 결과를 확정하고 있습니다.");
      const committed = await consumeDrawEntitlement(entitlementId, `draw-entitlement-${entitlementId}`);
      setDrawCommitting(false);
      if (!committed.ok || !committed.data) {
        setDrawStatus(committed.message);
        activationLockRef.current = false;
        resetSlider();
        return;
      }
      serverResult = committed.data;
      setCommittedDrawResult(serverResult);
      setDrawStatus("서버 결과가 확정됐습니다. 애니메이션으로 결과를 표시합니다.");
    }

    const revealCommittedResult = () => finishDraw(serverResult);

    if (product.categoryId === "gacha") {
      setDrawState("transitioning");
      transitionTimer.current = window.setTimeout(() => {
        setDrawState("drawing");
        transitionTimer.current = null;
        drawTimer.current = window.setTimeout(revealCommittedResult, drawDuration);
      }, reducedMotion ? 40 : 400);
      return;
    }

    setDrawState("drawing");
    drawTimer.current = window.setTimeout(revealCommittedResult, drawDuration);
  }, [apiMode, consumeDrawEntitlement, drawCommitting, drawDuration, drawEntitlementIds, drawRemaining, drawState, finishDraw, product.categoryId, quantity, reducedMotion, resetSlider, setDrawState]);

  const getSliderGeometry = useCallback(() => {
    const track = sliderTrackRef.current;
    const thumb = sliderThumbRef.current;
    const sliderStartInset = 16;
    const sliderEndInset = 4;
    const localMax = Math.max(
      1,
      (track?.offsetWidth ?? 0) - (thumb?.offsetWidth ?? 52) - sliderStartInset - sliderEndInset,
    );
    const visualScale = track?.offsetWidth ? track.getBoundingClientRect().width / track.offsetWidth : 1;

    return {
      localMax,
      visualMax: Math.max(1, localMax * visualScale),
    };
  }, []);

  const completeSlider = useCallback(() => {
    if (drawCommitting || drawState !== "ready" || drawRemaining < 1) return;
    const { localMax } = getSliderGeometry();
    setSliderX(localMax);
    setDrawControlProgress(1);
    void startDraw();
  }, [drawCommitting, drawRemaining, drawState, getSliderGeometry, setDrawControlProgress, startDraw]);

  const bindSlider = useDrag(
    (gesture) => {
      gesture.event.stopPropagation();
      if (product.categoryId !== "gacha" || drawCommitting || drawState !== "ready" || drawRemaining < 1) return;
      const { localMax, visualMax } = getSliderGeometry();
      const nextProgress = Math.max(0, Math.min(1, gesture.movement[0] / visualMax));
      const nextX = localMax * nextProgress;

      setSliderX(nextX);
      setDrawControlProgress(nextProgress);

      if (!gesture.last) return;
      if (nextProgress >= 0.92) {
        setSliderX(localMax);
        setDrawControlProgress(1);
        void startDraw();
      } else {
        resetSlider();
      }
    },
    {
      axis: "x",
      eventOptions: { capture: true, passive: false },
      filterTaps: true,
      pointer: { touch: true },
    },
  );

  const handleSliderKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (drawCommitting || drawState !== "ready" || drawRemaining < 1) return;
    if (["Enter", " ", "End"].includes(event.key)) {
      event.preventDefault();
      completeSlider();
      return;
    }
    if (!["ArrowRight", "ArrowLeft", "Home"].includes(event.key)) return;
    event.preventDefault();
    const currentProgress = event.key === "Home"
      ? 0
      : Math.max(0, Math.min(1, drawControlProgress + (event.key === "ArrowRight" ? 0.1 : -0.1)));
    setDrawControlProgress(currentProgress);
    setSliderX(getSliderGeometry().localMax * currentProgress);
    if (currentProgress >= 1) completeSlider();
  };

  const handleResultOpen = (open: boolean) => {
    setResultOpen(open);
    if (!open && drawRemaining > 0) {
      setCommittedDrawResult(null);
      setDrawStatus("");
      resetSlider();
      setDrawState("ready");
    }
    if (!open && drawRemaining < 1) {
      setCommittedDrawResult(null);
      setDrawStatus("");
      resetSlider();
      setDrawState("done");
      returnToCatalog(flow);
    }
  };

  const nextAction = () => {
    setResultOpen(false);
    if (drawRemaining > 0) {
      setCommittedDrawResult(null);
      setDrawStatus("");
      resetSlider();
      setDrawState("ready");
      return;
    }
    setCommittedDrawResult(null);
    setDrawStatus("");
    resetSlider();
    setDrawState("done");
    returnToCatalog(flow);
  };

  const committedPrizeProduct = committedDrawResult
    ? catalogProducts.find((candidate) => candidate.id === committedDrawResult.prizeProductId)
    : null;
  const localResultGrade = isPrizeGrade(resultGrade) ? resultGrade : "B";

  return (
    <>
      <div className="route-footer draw-footer" data-state={drawState}>
        {product.categoryId === "gacha" ? (
          <div
            ref={sliderTrackRef}
            className="draw-slider"
            data-state={drawState}
            style={{ "--draw-slider-progress": drawControlProgress } as CSSProperties}
          >
            <span className="draw-slider-fill" style={{ width: `${Math.max(7, drawControlProgress * 100)}%` }} />
            <span className="draw-slider-copy" aria-hidden="true">
              {drawCommitting ? "SERVER LOCK" : drawState === "transitioning" ? "ARCADE LOADING" : drawState === "drawing" ? "CAPSULE RUN" : drawRemaining > 0 ? "밀어서 뽑기" : "뽑기 완료"}
            </span>
            <button
              {...bindSlider()}
              ref={sliderThumbRef}
              type="button"
              role="slider"
              className="draw-slider-thumb"
              style={{ transform: `translate3d(${sliderX}px, 0, 0)` }}
              aria-label="밀어서 가챠 뽑기"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(drawControlProgress * 100)}
              aria-valuetext={`${Math.round(drawControlProgress * 100)}% 진행`}
              aria-disabled={drawCommitting || drawState !== "ready" || drawRemaining < 1}
              onKeyDown={handleSliderKeyDown}
            >
              <span aria-hidden="true">››</span>
            </button>
          </div>
        ) : (
          <ActionButton
            type="button"
            variant="brandSolid"
            size="large"
            className="primary-action draw-action"
            loading={drawCommitting || drawState === "transitioning" || drawState === "drawing"}
            disabled={drawCommitting || drawState === "transitioning" || drawState === "drawing" || drawRemaining < 1}
            onClick={() => void startDraw()}
          >
            {drawCommitting ? "서버 결과 확정 중" : drawState === "transitioning" || drawState === "drawing" ? "추첨 중" : drawRemaining > 0 ? `${drawNoun} · ${drawRemaining}${unit}` : "추첨 완료"}
          </ActionButton>
        )}
        {drawStatus ? <p className="draw-commit-status" role="status">{drawStatus}</p> : null}
      </div>

      <BottomSheet
        open={resultOpen}
        onOpenChange={handleResultOpen}
        title={`${drawNoun} 완료`}
        description="새 경품이 보관함에 들어왔어요."
        snap={0.49}
      >
        <div className="result-card">
          <span className="result-grade">{resultGrade}</span>
          <img src={committedDrawResult?.prizeImageUrl ?? committedPrizeProduct?.asset ?? product.asset} alt="" decoding="async" draggable={false} />
          <div>
            <small>{committedPrizeProduct?.line ?? product.line}</small>
            <strong>
              {committedDrawResult?.prizeName
                ?? committedPrizeProduct?.title
                ?? rewardForGrade(product, localResultGrade)}
            </strong>
          </div>
        </div>
        <div className="result-meta">
          <span>남은 추첨권</span>
          <strong>{drawRemaining}{unit}</strong>
        </div>
        <ActionButton
          type="button"
          variant="brandSolid"
          size="large"
          className="sheet-primary-button"
          onClick={nextAction}
        >
          {drawRemaining > 0 ? `다음 ${drawNoun}` : "상품 목록으로"}
        </ActionButton>
      </BottomSheet>
    </>
  );
}
