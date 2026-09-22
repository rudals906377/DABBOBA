import { randomUUID } from "expo-crypto";
import { errorMessage } from "@dabboba/api-client";
import type { components } from "@dabboba/contracts";
import { createMobileDabbobaClient as createDabbobaClient } from "@/lib/mobile-api-client";
import { ProfileApiError } from "@/features/profile/profile-api";

export type Inquiry = components["schemas"]["Inquiry"];
export type InquiryDetail = components["schemas"]["InquiryDetail"];
export type InquiryMessage = components["schemas"]["InquiryMessage"];
export type CreateInquiryInput = components["schemas"]["CreateInquiryInput"];
export type InquiryCategory = CreateInquiryInput["category"];

export async function createInquiry(
  apiBaseUrl: string,
  accessToken: string,
  input: CreateInquiryInput,
): Promise<Inquiry> {
  const client = authorizedClient(apiBaseUrl, accessToken);
  const result = await client.POST("/v1/inquiries", {
    params: { header: { "Idempotency-Key": randomUUID() } },
    body: input,
  });
  if (!result.data) throw new ProfileApiError(result.response.status, errorMessage(result.error, "문의를 접수하지 못했습니다."));
  return result.data;
}

export async function fetchInquiryDetail(
  apiBaseUrl: string,
  accessToken: string,
  inquiryId: string,
): Promise<InquiryDetail> {
  const client = authorizedClient(apiBaseUrl, accessToken);
  const result = await client.GET("/v1/inquiries/{inquiryId}", {
    params: { path: { inquiryId } },
  });
  if (!result.data) throw new ProfileApiError(result.response.status, errorMessage(result.error, "문의 내역을 불러오지 못했습니다."));
  return result.data;
}

export async function addInquiryMessage(
  apiBaseUrl: string,
  accessToken: string,
  inquiryId: string,
  content: string,
): Promise<InquiryMessage> {
  const client = authorizedClient(apiBaseUrl, accessToken);
  const result = await client.POST("/v1/inquiries/{inquiryId}/messages", {
    params: { path: { inquiryId } },
    body: { content, mediaIds: [] },
  });
  if (!result.data) throw new ProfileApiError(result.response.status, errorMessage(result.error, "추가 답변을 보내지 못했습니다."));
  return result.data;
}

function authorizedClient(apiBaseUrl: string, accessToken: string) {
  return createDabbobaClient({
    baseUrl: apiBaseUrl,
    token: () => accessToken,
    requestId: randomUUID,
  });
}
