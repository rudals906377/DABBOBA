import { randomUUID } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { errorMessage } from "@dabboba/api-client";
import type { components } from "@dabboba/contracts";
import { createMobileDabbobaClient as createDabbobaClient } from "@/lib/mobile-api-client";

export type DefaultShippingAddress = components["schemas"]["DefaultShippingAddress"];
export type UpsertDefaultShippingAddressInput = components["schemas"]["UpsertDefaultShippingAddressInput"];
export type AccountDeletionRequest = components["schemas"]["AccountDeletionRequest"];
export type AccountDeletionReceipt = components["schemas"]["AccountDeletionReceipt"];
export type AccountDeletionPreview = components["schemas"]["AccountDeletionPreview"];
export type AccountPolicyAcceptanceStatus = components["schemas"]["AccountPolicyAcceptanceStatus"];

const ACCOUNT_DELETION_RECEIPT_KEY = "dabboba.account-deletion.receipt.v1";

export type StoredAccountDeletionReceipt = Pick<AccountDeletionReceipt, "id" | "statusToken">;

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
  if (!result.data) throw new Error(errorMessage(result.error, "배송지를 저장하지 못했어요."));
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
  throw new Error(errorMessage(result.error, "탈퇴 요청 상태를 확인하지 못했어요."));
}

export async function fetchAccountDeletionPreview(
  apiBaseUrl: string,
  accessToken: string,
): Promise<AccountDeletionPreview> {
  const client = authorizedClient(apiBaseUrl, accessToken);
  const result = await client.GET("/v1/account/deletion-preview");
  if (!result.data) throw new Error(errorMessage(result.error, "탈퇴 가능 상태를 확인하지 못했어요."));
  return result.data;
}

export async function fetchAccountPolicyAcceptances(
  apiBaseUrl: string,
  accessToken: string,
): Promise<AccountPolicyAcceptanceStatus> {
  const client = authorizedClient(apiBaseUrl, accessToken);
  const result = await client.GET("/v1/account/policy-acceptances");
  if (!result.data) throw new Error(errorMessage(result.error, "약관 동의 현황을 확인하지 못했어요."));
  return result.data;
}

export async function requestAccountDeletion(
  apiBaseUrl: string,
  accessToken: string,
  forfeitPointBalance?: number,
): Promise<AccountDeletionReceipt> {
  const client = authorizedClient(apiBaseUrl, accessToken);
  const result = await client.POST("/v1/account/deletion-request", {
    params: { header: { "Idempotency-Key": randomUUID() } },
    // Only the exact balance the customer agreed to give up; the server rejects any other amount.
    body: forfeitPointBalance && forfeitPointBalance > 0 ? { forfeitPointBalance } : {},
  });
  if (!result.data) throw new Error(errorMessage(result.error, "회원탈퇴를 요청하지 못했어요."));
  return result.data;
}

export async function fetchAccountDeletionStatusByReceipt(
  apiBaseUrl: string,
  receipt: StoredAccountDeletionReceipt,
): Promise<AccountDeletionRequest> {
  const client = createDabbobaClient({ baseUrl: apiBaseUrl, requestId: randomUUID });
  const result = await client.GET("/v1/account/deletion-requests/{requestId}/status", {
    params: {
      path: { requestId: receipt.id },
      header: { "X-Deletion-Status-Token": receipt.statusToken },
    },
  });
  if (!result.data) throw new Error(errorMessage(result.error, "탈퇴 처리 상태를 확인하지 못했어요."));
  return result.data;
}

export async function storeAccountDeletionReceipt(
  receipt: StoredAccountDeletionReceipt,
): Promise<void> {
  await SecureStore.setItemAsync(ACCOUNT_DELETION_RECEIPT_KEY, JSON.stringify(receipt));
}

export async function readAccountDeletionReceipt(): Promise<StoredAccountDeletionReceipt | null> {
  const raw = await SecureStore.getItemAsync(ACCOUNT_DELETION_RECEIPT_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredAccountDeletionReceipt>;
    if (
      typeof value.id !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id)
      || typeof value.statusToken !== "string"
      || !/^[A-Za-z0-9_-]{43}$/.test(value.statusToken)
    ) {
      await SecureStore.deleteItemAsync(ACCOUNT_DELETION_RECEIPT_KEY);
      return null;
    }
    return { id: value.id, statusToken: value.statusToken };
  } catch {
    await SecureStore.deleteItemAsync(ACCOUNT_DELETION_RECEIPT_KEY);
    return null;
  }
}

export async function clearAccountDeletionReceipt(): Promise<void> {
  await SecureStore.deleteItemAsync(ACCOUNT_DELETION_RECEIPT_KEY);
}
