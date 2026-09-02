import { randomUUID } from "expo-crypto";
import { errorMessage } from "@dabboba/api-client";
import type { components } from "@dabboba/contracts";
import { createMobileDabbobaClient as createDabbobaClient } from "@/lib/mobile-api-client";

export type Inquiry = components["schemas"]["Inquiry"];
export type InquiryDetail = components["schemas"]["InquiryDetail"];
export type InquiryMessage = components["schemas"]["InquiryMessage"];
export type CreateInquiryInput = components["schemas"]["CreateInquiryInput"];
export type InquiryCategory = CreateInquiryInput["category"];

const EXAMPLE_INQUIRY_PREFIX = "example__inquiry__";
const EXAMPLE_USER_ID = "10000000-0000-4000-8000-000000000001";
const EXAMPLE_ADMIN_ID = "10000000-0000-4000-8000-000000000002";
const exampleInquiries = new Map<string, InquiryDetail>();

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
  if (!result.data) throw new Error(errorMessage(result.error, "문의를 접수하지 못했습니다."));
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
  if (!result.data) throw new Error(errorMessage(result.error, "문의 내역을 불러오지 못했습니다."));
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
  if (!result.data) throw new Error(errorMessage(result.error, "추가 답변을 보내지 못했습니다."));
  return result.data;
}

export function createExampleInquiry(input: CreateInquiryInput): InquiryDetail {
  const now = new Date().toISOString();
  const id = `${EXAMPLE_INQUIRY_PREFIX}${randomUUID()}`;
  const detail: InquiryDetail = {
    id,
    userId: EXAMPLE_USER_ID,
    category: input.category,
    title: input.title,
    status: "PENDING",
    assignedAdminId: null,
    createdAt: now,
    updatedAt: now,
    messages: [{
      id: `${EXAMPLE_INQUIRY_PREFIX}${randomUUID()}`,
      inquiryId: id,
      authorId: EXAMPLE_USER_ID,
      authorRole: "USER",
      content: input.content,
      isInternal: false,
      mediaIds: [],
      createdAt: now,
    }],
  };
  exampleInquiries.set(id, detail);
  return detail;
}

export function fetchExampleInquiryDetail(inquiryId: string): InquiryDetail {
  const saved = exampleInquiries.get(inquiryId);
  if (saved) return saved;

  const now = new Date();
  const createdAt = new Date(now.getTime() - 86_400_000).toISOString();
  const answeredAt = new Date(now.getTime() - 82_800_000).toISOString();
  const detail: InquiryDetail = {
    id: inquiryId,
    userId: EXAMPLE_USER_ID,
    category: "ORDER",
    title: "합배송 가능 여부가 궁금해요",
    status: "ANSWERED",
    assignedAdminId: EXAMPLE_ADMIN_ID,
    createdAt,
    updatedAt: answeredAt,
    messages: [
      {
        id: `${EXAMPLE_INQUIRY_PREFIX}customer`,
        inquiryId,
        authorId: EXAMPLE_USER_ID,
        authorRole: "USER",
        content: "보관함에 있는 상품을 한 번에 배송 신청할 수 있나요?",
        isInternal: false,
        mediaIds: [],
        createdAt,
      },
      {
        id: `${EXAMPLE_INQUIRY_PREFIX}answer`,
        inquiryId,
        authorId: EXAMPLE_ADMIN_ID,
        authorRole: "ADMIN",
        content: "네, 배송 가능한 보관 상품을 최대 20개까지 선택해 한 번에 신청할 수 있어요.",
        isInternal: false,
        mediaIds: [],
        createdAt: answeredAt,
      },
    ],
  };
  exampleInquiries.set(inquiryId, detail);
  return detail;
}

export function appendExampleInquiryMessage(inquiryId: string, content: string): InquiryMessage {
  const detail = fetchExampleInquiryDetail(inquiryId);
  const createdAt = new Date().toISOString();
  const message: InquiryMessage = {
    id: `${EXAMPLE_INQUIRY_PREFIX}${randomUUID()}`,
    inquiryId,
    authorId: EXAMPLE_USER_ID,
    authorRole: "USER",
    content,
    isInternal: false,
    mediaIds: [],
    createdAt,
  };
  exampleInquiries.set(inquiryId, {
    ...detail,
    status: "IN_PROGRESS",
    updatedAt: createdAt,
    messages: [...detail.messages, message],
  });
  return message;
}

function authorizedClient(apiBaseUrl: string, accessToken: string) {
  return createDabbobaClient({
    baseUrl: apiBaseUrl,
    token: () => accessToken,
    requestId: randomUUID,
  });
}
