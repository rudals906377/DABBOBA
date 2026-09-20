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

const INITIAL_WISHLIST_PRODUCT_IDS: string[] = [];
const INITIAL_ORDERS: SessionOrder[] = [];
const INITIAL_INVENTORY_UNITS: SessionInventoryUnit[] = [];
const INITIAL_POINT_LEDGER: SessionPointLedgerEntry[] = [];

export function createInitialSessionCommerceState(): SessionCommerceState {
  return {
    wishlistProductIds: [...INITIAL_WISHLIST_PRODUCT_IDS],
    orders: INITIAL_ORDERS.map((order) => ({ ...order })),
    inventoryUnits: INITIAL_INVENTORY_UNITS.map((unit) => ({ ...unit })),
    pointBalance: 0,
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
