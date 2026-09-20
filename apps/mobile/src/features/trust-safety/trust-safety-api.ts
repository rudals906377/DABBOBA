import { randomUUID } from "expo-crypto";
import { errorMessage } from "@dabboba/api-client";
import { createMobileDabbobaClient as createDabbobaClient } from "@/lib/mobile-api-client";

export type UgcReportTargetType =
  | "POST"
  | "COMMENT"
  | "SNAP"
  | "USER"
  | "EXCHANGE_LISTING"
  | "WANTED_REQUEST";

export type UgcReportReason =
  | "ABUSE"
  | "ADVERTISING"
  | "SPAM"
  | "INAPPROPRIATE"
  | "SUSPECTED_FRAUD"
  | "COPYRIGHT"
  | "OTHER";

function authenticatedClient(apiBaseUrl: string, accessToken: string) {
  return createDabbobaClient({
    baseUrl: apiBaseUrl,
    token: () => accessToken,
    requestId: randomUUID,
  });
}

export async function fetchUgcOperationsPolicyAcceptance(
  apiBaseUrl: string,
  accessToken: string,
) {
  const result = await authenticatedClient(apiBaseUrl, accessToken)
    .GET("/v1/community/operations-policy");
  if (!result.data) {
    throw new Error(errorMessage(result.error, "운영정책 동의 상태를 확인하지 못했습니다."));
  }
  return result.data;
}

export async function acceptUgcOperationsPolicy(
  apiBaseUrl: string,
  accessToken: string,
  policyVersion: string,
) {
  const result = await authenticatedClient(apiBaseUrl, accessToken)
    .POST("/v1/community/operations-policy/acceptance", {
      params: { header: { "Idempotency-Key": randomUUID() } },
      body: { policyVersion },
    });
  if (!result.data) {
    throw new Error(errorMessage(result.error, "운영정책 동의를 저장하지 못했습니다."));
  }
  return result.data;
}

export async function createUgcReport(
  apiBaseUrl: string,
  accessToken: string,
  input: {
    targetType: UgcReportTargetType;
    targetId: string;
    reason: UgcReportReason;
    details?: string;
  },
) {
  const result = await authenticatedClient(apiBaseUrl, accessToken).POST("/v1/reports", {
    params: { header: { "Idempotency-Key": randomUUID() } },
    body: {
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      ...(input.details?.trim() ? { details: input.details.trim() } : {}),
    },
  });
  if (!result.data) throw new Error(errorMessage(result.error, "신고를 접수하지 못했습니다."));
  return result.data;
}

export async function blockCommunityUser(
  apiBaseUrl: string,
  accessToken: string,
  userId: string,
) {
  const result = await authenticatedClient(apiBaseUrl, accessToken)
    .POST("/v1/community/blocks/{userId}", {
      params: {
        path: { userId },
        header: { "Idempotency-Key": randomUUID() },
      },
    });
  if (!result.data) throw new Error(errorMessage(result.error, "사용자를 차단하지 못했습니다."));
  return result.data;
}
