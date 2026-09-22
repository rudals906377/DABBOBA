import { errorMessage } from "@dabboba/api-client";
import type { PaidGachaDrawCompletion } from "@dabboba/contracts";
import { createMobileDabbobaClient } from "@/lib/mobile-api-client";

export async function fetchPaidGachaDrawCompletion(
  apiBaseUrl: string,
  accessToken: string,
  orderId: string,
): Promise<PaidGachaDrawCompletion> {
  const client = createMobileDabbobaClient({ baseUrl: apiBaseUrl, token: () => accessToken });
  const result = await client.GET("/v1/orders/{orderId}/draw-completion", {
    params: { path: { orderId } },
  });
  if (!result.data) throw new Error(errorMessage(result.error, "주문 전체의 뽑기 완료를 확인하지 못했습니다."));
  return result.data;
}
