export type DirectPurchasePayload = { productId: string; quantity: number; pointAmount: number; unitPrice: number };
export type DirectPurchaseIntent = {
  actorId: string;
  key: string;
  payload: DirectPurchasePayload;
  createdAt: number;
  orderId: string | null;
};

type OrderSnapshot = {
  id: string; userId: string; status: string; pointTotal: number;
  subtotal: number; discountTotal: number; total: number;
  lines: Array<{productId: string; quantity: number; unitPrice: number; lineTotal: number}>;
  drawEntitlementIds?: string[];
};

export function assertDirectPurchaseOrder(intent: DirectPurchaseIntent, order: OrderSnapshot): void {
  const line = order.lines[0];
  if (order.userId !== intent.actorId || (intent.orderId && order.id !== intent.orderId)
    || order.lines.length !== 1 || !line || line.productId !== intent.payload.productId
    || line.quantity !== intent.payload.quantity || order.pointTotal !== intent.payload.pointAmount
    || (order.drawEntitlementIds?.length ?? 0) !== 0
    || !Number.isSafeInteger(line.unitPrice) || line.unitPrice <= 0 || line.unitPrice !== intent.payload.unitPrice
    || line.lineTotal !== line.unitPrice * line.quantity || order.subtotal !== line.lineTotal
    || order.discountTotal !== 0 || order.total !== order.subtotal - order.pointTotal) {
    throw new Error("선택한 상품·수량과 주문 정보가 달라요. 추가 결제 전에 고객센터에 문의해 주세요.");
  }
}

export function parseDirectPurchaseIntent(value: string): DirectPurchaseIntent {
  const intent = JSON.parse(value) as DirectPurchaseIntent;
  if (!intent || !/^[0-9a-f-]{36}$/i.test(intent.actorId) || !/^direct-order:[0-9a-f-]{36}$/i.test(intent.key)
    || !/^[a-z0-9-]{1,120}$/.test(intent.payload?.productId)
    || !Number.isSafeInteger(intent.payload.quantity) || intent.payload.quantity < 1 || intent.payload.quantity > 20
    || !Number.isSafeInteger(intent.payload.pointAmount) || intent.payload.pointAmount < 0
    || !Number.isSafeInteger(intent.payload.unitPrice) || intent.payload.unitPrice <= 0
    || !Number.isFinite(intent.createdAt)
    || !(intent.orderId === null || /^[0-9a-f-]{36}$/i.test(intent.orderId))) {
    throw new Error("저장된 주문 정보를 확인할 수 없어요. 고객센터에 문의해 주세요.");
  }
  return intent;
}
