import type { PaidKujiDrawRecovery, components } from "@dabboba/contracts";

type Order = components["schemas"]["Order"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PaidProductDraw = {
  category: "gacha" | "kuji";
  productId: string;
  quantity: number;
  entitlementIds: string[];
};

/** Only an owned, server-refreshed paid order may supply the draw destination. */
export function paidProductDrawFromOrder(order: Order, requestedOrderId: string): PaidProductDraw {
  const line = order.lines[0];
  const entitlementIds = order.drawEntitlementIds ?? [];
  if (
    order.id !== requestedOrderId
    || order.orderKind !== "PRODUCT"
    || (order.status !== "PAID" && order.status !== "FULFILLED")
    || order.lines.length !== 1
    || !line
    || (line.category !== "gacha" && line.category !== "kuji")
    || !line.productId.trim()
    || !Number.isSafeInteger(line.quantity)
    || line.quantity < 1 || line.quantity > 20
    || entitlementIds.length !== line.quantity
    || entitlementIds.some((id) => !UUID_PATTERN.test(id))
    || new Set(entitlementIds.map((id) => id.toLowerCase())).size !== entitlementIds.length
  ) {
    throw new Error("결제한 상품과 추첨권 정보가 일치하지 않습니다. 내정보의 결제·뽑기 복구에서 다시 확인해 주세요.");
  }
  return {
    category: line.category,
    productId: line.productId,
    quantity: line.quantity,
    entitlementIds,
  };
}

/** The kuji room identity is recovered from the paid server order, not a redirect query. */
export function paidKujiRoomEntryFromRecovery(
  recovery: PaidKujiDrawRecovery,
  order: Order,
  draw: PaidProductDraw,
): string {
  const expectedIds = draw.entitlementIds.map((id) => id.toLowerCase());
  const actualIds = recovery.entitlementIds.map((id) => id.toLowerCase());
  if (
    draw.category !== "kuji"
    || recovery.orderId !== order.id
    || recovery.userId !== order.userId
    || recovery.productId !== draw.productId
    || !UUID_PATTERN.test(recovery.roomEntryId)
    || (recovery.roomState !== "DRAWING" && recovery.roomState !== "EXPIRED")
    || actualIds.length !== expectedIds.length
    || actualIds.some((id, index) => id !== expectedIds[index])
    || recovery.bindings.length > 0
  ) {
    throw new Error("결제한 쿠지 방 정보를 확인하지 못했습니다. 내정보의 결제·뽑기 복구에서 다시 확인해 주세요.");
  }
  return recovery.roomEntryId;
}
