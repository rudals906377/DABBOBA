import type { ProductCategoryId } from "../domain/catalog";

export const CURRENT_USER_ID = "user-dabboba-demo-01";
export const APP_REFERENCE_VALUE_NOTICE = "앱 참고값 · 현금 거래가 아님";

export type SessionOrderStatus = "결제 완료" | "뽑기 완료" | "배송 신청 전";
export type SessionShippingStatus = "stored" | "requested";
export type SessionExchangeStatus = "available" | "listed" | "offered" | "matched";
export type ExchangeApplicationDecision = "accepted" | "rejected";

export type SessionOrder = {
  id: string;
  userId: string;
  productId: string;
  productTitle: string;
  productImage: string;
  categoryId: ProductCategoryId;
  orderedAt: string;
  quantity: number;
  paidTotal: number;
  pointsUsed: number;
  status: SessionOrderStatus;
};

export type SessionInventoryUnit = {
  id: string;
  ownerId: string;
  catalogItemId: string;
  productId: string;
  ipId: string;
  categoryId: ProductCategoryId;
  itemName: string;
  itemImage: string;
  appReferenceValue: number;
  source: "seed" | "direct-purchase" | "gacha" | "kuji" | "admin-adjustment";
  acquiredAt: string;
  shippingDeadline: string;
  shippingStatus: SessionShippingStatus;
  exchangeStatus: SessionExchangeStatus;
};

export type SessionPointLedgerEntry = {
  id: string;
  userId: string;
  label: string;
  detail: string;
  occurredAt: string;
  amount: number;
  referenceId?: string;
};

export type SessionShippingRequest = {
  id: string;
  userId: string;
  inventoryUnitIds: string[];
  requestedAt: string;
  status: "requested";
};

export type SessionCommerceState = {
  wishlistProductIds: string[];
  orders: SessionOrder[];
  inventoryUnits: SessionInventoryUnit[];
  pointBalance: number;
  pointLedger: SessionPointLedgerEntry[];
  shippingRequests: SessionShippingRequest[];
  exchangeApplicationDecisions: Partial<Record<string, ExchangeApplicationDecision>>;
};

const INITIAL_WISHLIST_PRODUCT_IDS = [
  "one-piece-tcg",
  "dragon-ball-figure",
  "demon-slayer-gacha",
  "jujutsu-kaisen-gacha",
  "naruto-figure",
  "hunter-x-hunter-kuji",
];

const INITIAL_ORDERS: SessionOrder[] = [
  {
    id: "DBB-20260824-001",
    userId: CURRENT_USER_ID,
    productId: "one-piece-tcg",
    productTitle: "원피스 카드게임 OP-13 계승되는 의지",
    productImage: "/assets/dabboba/products/ip/one-piece.jpg",
    categoryId: "tcg",
    orderedAt: "2026.08.24",
    quantity: 2,
    paidTotal: 4_000,
    pointsUsed: 1_000,
    status: "결제 완료",
  },
  {
    id: "DBB-20260823-014",
    userId: CURRENT_USER_ID,
    productId: "demon-slayer-gacha",
    productTitle: "귀멸의 칼날 캡슐룬 미니 피규어",
    productImage: "/assets/dabboba/products/ip/demon-slayer.jpg",
    categoryId: "gacha",
    orderedAt: "2026.08.23",
    quantity: 1,
    paidTotal: 6_000,
    pointsUsed: 0,
    status: "뽑기 완료",
  },
  {
    id: "DBB-20260818-008",
    userId: CURRENT_USER_ID,
    productId: "dragon-ball-figure",
    productTitle: "S.H.Figuarts 손오공 〈마음씨 착한 사이어인〉",
    productImage: "/assets/dabboba/products/ip/dragon-ball.jpg",
    categoryId: "figure",
    orderedAt: "2026.08.18",
    quantity: 1,
    paidTotal: 59_900,
    pointsUsed: 0,
    status: "배송 신청 전",
  },
];

const INITIAL_INVENTORY_UNITS: SessionInventoryUnit[] = [
  {
    id: "inventory-demon-slayer-tanjiro",
    ownerId: CURRENT_USER_ID,
    catalogItemId: "demon-slayer-tanjiro-mini",
    productId: "demon-slayer-gacha",
    ipId: "demon-slayer",
    categoryId: "gacha",
    itemName: "귀멸의 칼날 탄지로 미니 피규어",
    itemImage: "/assets/dabboba/products/ip/demon-slayer.jpg",
    appReferenceValue: 6_000,
    source: "gacha",
    acquiredAt: "2026.08.23",
    shippingDeadline: "2026.09.22",
    shippingStatus: "stored",
    exchangeStatus: "available",
  },
  {
    id: "inventory-jujutsu-kaisen-gojo",
    ownerId: CURRENT_USER_ID,
    catalogItemId: "jjk-gojo-capsule",
    productId: "jujutsu-kaisen-gacha",
    ipId: "jujutsu-kaisen",
    categoryId: "gacha",
    itemName: "주술회전 캡슐 DX 고죠 사토루",
    itemImage: "/assets/dabboba/products/ip/jujutsu-kaisen.jpg",
    appReferenceValue: 9_000,
    source: "gacha",
    acquiredAt: "2026.08.21",
    shippingDeadline: "2026.09.20",
    shippingStatus: "stored",
    exchangeStatus: "available",
  },
  {
    id: "inventory-hunter-x-hunter-kuji-c",
    ownerId: CURRENT_USER_ID,
    catalogItemId: "hunter-x-hunter-kuji-c",
    productId: "hunter-x-hunter-kuji",
    ipId: "hunter-x-hunter",
    categoryId: "kuji",
    itemName: "HUNTER×HUNTER 키메라 앤트 C상",
    itemImage: "/assets/dabboba/products/ip/hunter-x-hunter.jpg",
    appReferenceValue: 13_000,
    source: "kuji",
    acquiredAt: "2026.08.19",
    shippingDeadline: "2026.09.18",
    shippingStatus: "stored",
    exchangeStatus: "available",
  },
  {
    id: "inventory-one-piece-luffy-leader",
    ownerId: CURRENT_USER_ID,
    catalogItemId: "one-piece-luffy-leader",
    productId: "one-piece-tcg",
    ipId: "one-piece",
    categoryId: "tcg",
    itemName: "OP-13 몽키 D. 루피 리더 카드",
    itemImage: "/assets/dabboba/products/ip/one-piece.jpg",
    appReferenceValue: 12_000,
    source: "direct-purchase",
    acquiredAt: "2026.08.24",
    shippingDeadline: "2026.09.23",
    shippingStatus: "stored",
    exchangeStatus: "available",
  },
];

const INITIAL_POINT_LEDGER: SessionPointLedgerEntry[] = [
  {
    id: "point-welcome",
    userId: CURRENT_USER_ID,
    label: "가입 축하 포인트",
    detail: "DABBOBA 첫 가입 혜택",
    occurredAt: "2026.08.10",
    amount: 10_000,
  },
  {
    id: "point-first-order",
    userId: CURRENT_USER_ID,
    label: "첫 구매 적립",
    detail: "첫 상품 구매 완료",
    occurredAt: "2026.08.18",
    amount: 3_000,
  },
  {
    id: "point-order-use",
    userId: CURRENT_USER_ID,
    label: "상품 결제 사용",
    detail: "원피스 카드게임 OP-13",
    occurredAt: "2026.08.24",
    amount: -1_000,
    referenceId: "DBB-20260824-001",
  },
  {
    id: "point-event",
    userId: CURRENT_USER_ID,
    label: "오픈 이벤트 적립",
    detail: "앱 오픈 이벤트 참여",
    occurredAt: "2026.08.24",
    amount: 500,
  },
];

export function createInitialSessionCommerceState(): SessionCommerceState {
  return {
    wishlistProductIds: [...INITIAL_WISHLIST_PRODUCT_IDS],
    orders: INITIAL_ORDERS.map((order) => ({ ...order })),
    inventoryUnits: INITIAL_INVENTORY_UNITS.map((unit) => ({ ...unit })),
    pointBalance: 12_500,
    pointLedger: INITIAL_POINT_LEDGER.map((entry) => ({ ...entry })),
    shippingRequests: [],
    exchangeApplicationDecisions: {},
  };
}

export function toggleSessionWishlist(state: SessionCommerceState, productId: string): SessionCommerceState {
  const exists = state.wishlistProductIds.includes(productId);
  return {
    ...state,
    wishlistProductIds: exists
      ? state.wishlistProductIds.filter((id) => id !== productId)
      : [productId, ...state.wishlistProductIds],
  };
}

export function recordSessionOrderOnce(state: SessionCommerceState, order: SessionOrder): SessionCommerceState {
  if (state.orders.some((candidate) => candidate.id === order.id)) return state;

  const pointLedgerEntry = order.pointsUsed > 0 && !state.pointLedger.some((entry) => entry.referenceId === order.id)
    ? [{
      id: `point-order-${order.id}`,
      userId: order.userId,
      label: "상품 결제 사용",
      detail: order.productTitle,
      occurredAt: order.orderedAt,
      amount: -order.pointsUsed,
      referenceId: order.id,
    }, ...state.pointLedger]
    : state.pointLedger;

  return {
    ...state,
    orders: [order, ...state.orders],
    pointBalance: Math.max(0, state.pointBalance - order.pointsUsed),
    pointLedger: pointLedgerEntry,
  };
}

export function updateSessionOrderStatus(
  state: SessionCommerceState,
  orderId: string,
  status: SessionOrderStatus,
): SessionCommerceState {
  const order = state.orders.find((candidate) => candidate.id === orderId);
  if (!order || order.status === status) return state;
  return {
    ...state,
    orders: state.orders.map((candidate) => candidate.id === orderId ? { ...candidate, status } : candidate),
  };
}

export function recordSessionInventoryUnitOnce(
  state: SessionCommerceState,
  inventoryUnit: SessionInventoryUnit,
): SessionCommerceState {
  if (state.inventoryUnits.some((candidate) => candidate.id === inventoryUnit.id)) return state;
  return { ...state, inventoryUnits: [inventoryUnit, ...state.inventoryUnits] };
}

export function eligibleSessionInventoryUnits(
  state: SessionCommerceState,
  ownerId = CURRENT_USER_ID,
): SessionInventoryUnit[] {
  return state.inventoryUnits.filter((unit) => (
    unit.ownerId === ownerId
    && unit.source === "gacha"
    && unit.shippingStatus === "stored"
    && unit.exchangeStatus === "available"
  ));
}

export function eligibleDrawExchangeProposalUnits(
  state: SessionCommerceState,
  ownerId = CURRENT_USER_ID,
): SessionInventoryUnit[] {
  return eligibleSessionInventoryUnits(state, ownerId);
}

export function setSessionInventoryExchangeStatus(
  state: SessionCommerceState,
  inventoryUnitId: string,
  exchangeStatus: SessionExchangeStatus,
): SessionCommerceState {
  const inventoryUnit = state.inventoryUnits.find((unit) => unit.id === inventoryUnitId);
  if (!inventoryUnit || inventoryUnit.exchangeStatus === exchangeStatus) return state;
  return {
    ...state,
    inventoryUnits: state.inventoryUnits.map((unit) => (
      unit.id === inventoryUnitId ? { ...unit, exchangeStatus } : unit
    )),
  };
}

export function requestSessionShipping(
  state: SessionCommerceState,
  request: SessionShippingRequest,
): SessionCommerceState {
  if (state.shippingRequests.some((candidate) => candidate.id === request.id)) return state;
  const requestableIds = new Set(state.inventoryUnits
    .filter((unit) => (
      unit.ownerId === request.userId
      && unit.shippingStatus === "stored"
      && unit.exchangeStatus === "available"
      && request.inventoryUnitIds.includes(unit.id)
    ))
    .map((unit) => unit.id));
  if (requestableIds.size === 0) return state;

  return {
    ...state,
    shippingRequests: [{ ...request, inventoryUnitIds: [...requestableIds] }, ...state.shippingRequests],
    inventoryUnits: state.inventoryUnits.map((unit) => requestableIds.has(unit.id)
      ? { ...unit, shippingStatus: "requested", exchangeStatus: "matched" }
      : unit),
  };
}

export function exchangeDecisionKey(postId: string, applicationId: string) {
  return `${postId}:${applicationId}`;
}

export function decideSessionExchangeApplication(
  state: SessionCommerceState,
  input: {
    actorId: string;
    postId: string;
    postAuthorId: string;
    applicationId: string;
    applicationIds: readonly string[];
    decision: ExchangeApplicationDecision;
  },
): SessionCommerceState {
  if (input.actorId !== input.postAuthorId) return state;

  const nextDecisions = { ...state.exchangeApplicationDecisions };
  if (input.decision === "accepted") {
    input.applicationIds.forEach((applicationId) => {
      nextDecisions[exchangeDecisionKey(input.postId, applicationId)] = applicationId === input.applicationId
        ? "accepted"
        : "rejected";
    });
  } else {
    nextDecisions[exchangeDecisionKey(input.postId, input.applicationId)] = "rejected";
  }

  return { ...state, exchangeApplicationDecisions: nextDecisions };
}
