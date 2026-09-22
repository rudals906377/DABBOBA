import { errorMessage } from "@dabboba/api-client";
import type {
  BindKujiSlotsInput,
  KujiSlotBindingResult,
  PaidKujiSelectionSnapshot,
  PublicKujiDeckSnapshot,
} from "@dabboba/contracts";
import { createMobileDabbobaClient as createDabbobaClient } from "@/lib/mobile-api-client";

export class KujiSlotApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "KujiSlotApiError";
    this.status = status;
  }
}

export async function fetchKujiSlotBoard(
  apiBaseUrl: string,
  productId: string,
): Promise<PublicKujiDeckSnapshot> {
  const client = createDabbobaClient({ baseUrl: apiBaseUrl });
  const result = await client.GET("/v1/catalog/products/{productId}/kuji-slots", {
    params: { path: { productId } },
  });
  if (!result.data) {
    throw new KujiSlotApiError(
      errorMessage(result.error, "쿠지 번호판을 불러오지 못했습니다."),
      result.response.status,
    );
  }
  return result.data;
}

export async function fetchPaidKujiSelection(
  apiBaseUrl: string,
  accessToken: string,
  orderId: string,
): Promise<PaidKujiSelectionSnapshot> {
  const client = createDabbobaClient({ baseUrl: apiBaseUrl, token: () => accessToken });
  const [actor, result] = await Promise.all([
    client.GET("/v1/auth/me"),
    client.GET("/v1/orders/{orderId}/kuji-selection", { params: { path: { orderId } } }),
  ]);
  if (!actor.data || !result.data) {
    throw new KujiSlotApiError(
      errorMessage(result.error ?? actor.error, "구매한 쿠지 번호판을 불러오지 못했습니다."),
      !actor.data ? actor.response.status : result.response.status,
    );
  }
  if (result.data.recovery.userId !== actor.data.actor?.userId) {
    throw new KujiSlotApiError("로그인 계정과 쿠지 주문 정보가 일치하지 않습니다.", 409);
  }
  return result.data;
}

export async function bindPaidKujiSlots(
  apiBaseUrl: string,
  accessToken: string,
  input: {
    productId: string;
    roomEntryId: string;
    orderId: string;
    probabilityVersion: number;
    slotNumbers: number[];
  },
): Promise<KujiSlotBindingResult> {
  const client = createDabbobaClient({
    baseUrl: apiBaseUrl,
    token: () => accessToken,
  });
  const body: BindKujiSlotsInput = {
    probabilityVersion: input.probabilityVersion,
    slotNumbers: input.slotNumbers,
  };
  const result = await client.POST("/v1/kuji/rooms/{productId}/entries/{entryId}/slots", {
    params: {
      path: { productId: input.productId, entryId: input.roomEntryId },
      header: {
        "Idempotency-Key": kujiSlotBindingIdempotencyKey(input.orderId),
      },
    },
    body,
  });
  if (!result.data) {
    throw new KujiSlotApiError(
      errorMessage(result.error, "선택한 쿠지 번호를 확정하지 못했습니다."),
      result.response.status,
    );
  }
  return result.data;
}

/**
 * A paid kuji order can own only one sealed-slot binding. A stable key makes a
 * lost successful response replay the original atomic binding instead of
 * reserving another set of slots.
 */
export function kujiSlotBindingIdempotencyKey(orderId: string): string {
  return `kuji-slot-binding-${orderId}`;
}
