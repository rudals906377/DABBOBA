import { randomUUID } from "expo-crypto";
import { errorMessage } from "@dabboba/api-client";
import type { components } from "@dabboba/contracts";
import { createMobileDabbobaClient as createDabbobaClient } from "@/lib/mobile-api-client";

export type DefaultShippingAddress = components["schemas"]["DefaultShippingAddress"];
export type UpsertDefaultShippingAddressInput = components["schemas"]["UpsertDefaultShippingAddressInput"];
export type AccountDeletionRequest = components["schemas"]["AccountDeletionRequest"];

function authorizedClient(apiBaseUrl: string, accessToken: string) {
  return createDabbobaClient({
    baseUrl: apiBaseUrl,
    token: () => accessToken,
    requestId: randomUUID,
  });
}

export async function upsertDefaultShippingAddress(
  apiBaseUrl: string,
  accessToken: string,
  input: UpsertDefaultShippingAddressInput,
): Promise<DefaultShippingAddress> {
  const client = authorizedClient(apiBaseUrl, accessToken);
  const result = await client.PUT("/v1/account/default-address", {
    params: { header: { "Idempotency-Key": randomUUID() } },
    body: input,
  });
  if (!result.data) throw new Error(errorMessage(result.error, "배송지를 저장하지 못했습니다."));
  return result.data;
}

export async function fetchAccountDeletionRequest(
  apiBaseUrl: string,
  accessToken: string,
): Promise<AccountDeletionRequest | null> {
  const client = authorizedClient(apiBaseUrl, accessToken);
  const result = await client.GET("/v1/account/deletion-request");
  if (result.data) return result.data;
  if (result.response.status === 404) return null;
  throw new Error(errorMessage(result.error, "탈퇴 요청 상태를 확인하지 못했습니다."));
}

export async function requestAccountDeletion(
  apiBaseUrl: string,
  accessToken: string,
): Promise<AccountDeletionRequest> {
  const client = authorizedClient(apiBaseUrl, accessToken);
  const result = await client.POST("/v1/account/deletion-request", {
    params: { header: { "Idempotency-Key": randomUUID() } },
    body: {},
  });
  if (!result.data) throw new Error(errorMessage(result.error, "회원탈퇴를 요청하지 못했습니다."));
  return result.data;
}
