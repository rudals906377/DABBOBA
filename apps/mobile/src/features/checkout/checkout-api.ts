import { randomUUID } from "expo-crypto";
import { errorMessage } from "@dabboba/api-client";
import type { components } from "@dabboba/contracts";
import { createMobileDabbobaClient as createDabbobaClient } from "@/lib/mobile-api-client";

export type CheckoutOrder = components["schemas"]["Order"];

export type CreateKujiCheckoutOrderInput = {
  productId: string;
  quantity: number;
  expectedDrawVersion: number;
  pointAmount: number;
  kujiRoomEntryId: string;
};

export class CheckoutOrderApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CheckoutOrderApiError";
    this.status = status;
  }
}

export async function fetchCheckoutPointBalance(
  apiBaseUrl: string,
  accessToken: string,
): Promise<number> {
  const client = createDabbobaClient({
    baseUrl: apiBaseUrl,
    token: () => accessToken,
    requestId: randomUUID,
  });
  const result = await client.GET("/v1/account/points", {
    params: { query: { limit: 1 } },
  });
  if (!result.data) {
    throw new Error(errorMessage(result.error, "포인트 정보를 불러오지 못했습니다."));
  }
  return Math.max(0, result.data.balance);
}

export async function createKujiCheckoutOrder(
  apiBaseUrl: string,
  accessToken: string,
  input: CreateKujiCheckoutOrderInput,
): Promise<CheckoutOrder> {
  const client = createDabbobaClient({
    baseUrl: apiBaseUrl,
    token: () => accessToken,
    requestId: randomUUID,
  });
  const result = await client.POST("/v1/orders", {
    params: {
      header: {
        "Idempotency-Key": kujiCheckoutOrderIdempotencyKey(input.kujiRoomEntryId),
      },
    },
    body: {
      items: [{
        productId: input.productId,
        quantity: input.quantity,
        expectedDrawVersion: input.expectedDrawVersion,
      }],
      pointAmount: input.pointAmount,
      kujiRoomEntryId: input.kujiRoomEntryId,
    },
  });
  if (!result.data) {
    throw new CheckoutOrderApiError(
      errorMessage(result.error, "쿠지 주문을 접수하지 못했습니다."),
      result.response.status,
    );
  }
  return result.data;
}

/**
 * One room entry can create at most one kuji order. Keeping this key stable
 * makes a retry after a lost response replay the same server transaction.
 */
export function kujiCheckoutOrderIdempotencyKey(kujiRoomEntryId: string): string {
  return `kuji-order-${kujiRoomEntryId}`;
}

export function paidKujiOrderEntitlementIds(
  order: CheckoutOrder,
  expectedQuantity: number,
): string[] | null {
  if (order.status !== "PAID" && order.status !== "FULFILLED") return null;
  const entitlementIds = order.drawEntitlementIds ?? [];
  if (
    entitlementIds.length !== expectedQuantity
    || new Set(entitlementIds).size !== entitlementIds.length
    || entitlementIds.some((id) => !id.trim())
  ) {
    return null;
  }
  return entitlementIds;
}
