import { randomUUID } from "expo-crypto";
import { errorMessage } from "@dabboba/api-client";
import type { components } from "@dabboba/contracts";
import { createMobileDabbobaClient as createDabbobaClient } from "@/lib/mobile-api-client";
import { ProfileApiError } from "@/features/profile/profile-api";

export type AccountShippingRequestDetail = components["schemas"]["AccountShippingRequestDetail"];

export async function fetchAccountShippingRequestDetail(
  apiBaseUrl: string,
  accessToken: string,
  shippingRequestId: string,
): Promise<AccountShippingRequestDetail> {
  const client = createDabbobaClient({
    baseUrl: apiBaseUrl,
    token: () => accessToken,
    requestId: randomUUID,
  });
  const result = await client.GET("/v1/account/shipping-requests/{shippingRequestId}", {
    params: { path: { shippingRequestId } },
  });

  if (!result.data) {
    throw new ProfileApiError(
      result.response.status,
      errorMessage(result.error, "배송 신청 정보를 불러오지 못했어요."),
    );
  }
  return result.data;
}
