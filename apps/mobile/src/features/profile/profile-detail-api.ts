import { randomUUID } from "expo-crypto";
import { errorMessage } from "@dabboba/api-client";
import type { components } from "@dabboba/contracts";
import { createMobileDabbobaClient as createDabbobaClient } from "@/lib/mobile-api-client";

export type AccountShippingRequest = components["schemas"]["AccountShippingRequest"];

export async function fetchAccountShippingRequestDetail(
  apiBaseUrl: string,
  accessToken: string,
  shippingRequestId: string,
): Promise<AccountShippingRequest> {
  const client = createDabbobaClient({
    baseUrl: apiBaseUrl,
    token: () => accessToken,
    requestId: randomUUID,
  });
  const result = await client.GET("/v1/account/shipping-requests/{shippingRequestId}", {
    params: { path: { shippingRequestId } },
  });

  if (!result.data) {
    throw new Error(errorMessage(result.error, "배송 신청 정보를 불러오지 못했습니다."));
  }
  return result.data;
}
