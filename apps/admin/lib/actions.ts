"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AdminApiError, adminApi } from "./api";
import { requireCapability, type AdminSession } from "./auth";
import type { Capability } from "./capabilities";
import { safeInternalPath } from "./request-security";

const USER_MANAGEABLE_STATUSES = ["ACTIVE", "SUSPENDED", "BANNED"] as const;
const CONTENT_STATUSES = ["ACTIVE", "HIDDEN", "DELETED"] as const;
const INQUIRY_STATUSES = ["PENDING", "IN_PROGRESS", "ANSWERED", "CLOSED"] as const;
const REPORT_STATUSES = ["RESOLVED", "REJECTED"] as const;
const REPORT_ACTIONS = ["NO_ACTION", "HIDE_POST", "HIDE_COMMENT", "WARN_USER", "SUSPEND_USER"] as const;
const REQUEST_DECISIONS = ["APPROVED", "REJECTED", "ON_HOLD", "MERGED"] as const;
const CATEGORIES = ["gacha", "figure", "kuji", "tcg"] as const;
const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"] as const;
const ADMIN_STATUSES = ["ACTIVE", "SUSPENDED", "BANNED"] as const;
const EXCHANGE_ACTIONS = ["COMPLETE", "CANCEL"] as const;
const REFUND_REVIEW_STATUSES = ["PENDING", "IN_REVIEW", "WAITING_PROVIDER", "ESCALATED", "CLOSED"] as const;
const SHIPPING_TARGET_STATUSES = ["PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"] as const;
const ACCOUNT_DELETION_DECISIONS = ["APPROVED", "REJECTED"] as const;

function text(form: FormData, name: string, max = 10_000) {
  const value = String(form.get(name) || "").trim();
  if (!value || value.length > max) throw new Error(`${name} 값이 올바르지 않습니다.`);
  return value;
}

function optionalText(form: FormData, name: string, max = 10_000) {
  const value = String(form.get(name) || "").trim();
  if (value.length > max) throw new Error(`${name} 값이 너무 깁니다.`);
  return value || null;
}

function rawPassword(form: FormData) {
  const value = String(form.get("password") || "");
  if (value.length < 12 || value.length > 256) throw new Error("비밀번호는 12~256자로 입력하세요.");
  return value;
}

function textAllowEmpty(form: FormData, name: string, max: number) {
  const value = String(form.get(name) || "").trim();
  if (value.length > max) throw new Error(`${name} 값이 너무 깁니다.`);
  return value;
}

function enumValue<const T extends readonly string[]>(form: FormData, name: string, choices: T): T[number] {
  const value = String(form.get(name) || "");
  if (!choices.includes(value)) throw new Error(`${name} 선택값이 올바르지 않습니다.`);
  return value as T[number];
}

function integer(form: FormData, name: string) {
  const raw = String(form.get(name) || "").trim();
  const value = Number(raw);
  if (!raw || !Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
    throw new Error(`${name} 값은 0 이상의 정수여야 합니다.`);
  }
  return value;
}

function signedInteger(form: FormData, name: string) {
  const raw = String(form.get(name) || "").trim();
  const value = Number(raw);
  if (!raw || !Number.isSafeInteger(value) || value < -2_147_483_647 || value > 2_147_483_647) {
    throw new Error(`${name} 값은 정수여야 합니다.`);
  }
  return value;
}

function version(form: FormData) {
  const value = integer(form, "expectedVersion");
  if (value < 1) throw new Error("expectedVersion 값은 1 이상이어야 합니다.");
  return value;
}

function aliases(form: FormData, name = "aliases") {
  return String(form.get(name) || "")
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);
}

function metadata(form: FormData) {
  const raw = String(form.get("metadata") || "{}").trim() || "{}";
  const value: unknown = JSON.parse(raw);
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("metadata는 JSON 객체여야 합니다.");
  return value as Record<string, unknown>;
}

function koreaDateTime(form: FormData, name: string) {
  const value = optionalText(form, name, 40);
  if (!value) return null;
  const withZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    ? value
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)
      ? `${value}${value.length === 16 ? ":00" : ""}+09:00`
      : "invalid";
  const date = new Date(withZone);
  if (Number.isNaN(date.getTime())) throw new Error(`${name} 날짜가 올바르지 않습니다.`);
  return date.toISOString();
}

function reason(form: FormData) {
  const value = text(form, "reason", 1_000);
  if (value.length < 2) throw new Error("처리 사유를 두 글자 이상 입력하세요.");
  return value;
}

function returnTo(form: FormData) {
  return safeInternalPath(form.get("returnTo"));
}

function feedback(path: string, kind: "success" | "error", message: string) {
  const url = new URL(path, "https://admin.invalid");
  url.searchParams.delete(kind === "success" ? "error" : "success");
  url.searchParams.set(kind, message.slice(0, 180));
  return `${url.pathname}${url.search}${url.hash}`;
}

function actionError(error: unknown) {
  if (error instanceof SyntaxError) return "JSON 형식을 확인하세요.";
  if (error instanceof AdminApiError) {
    if (error.status === 403) return "이 작업을 수행할 권한이 없습니다.";
    if (error.status === 409) return "현재 서버 상태와 충돌했습니다. 새로고침 후 다시 시도하세요.";
    if (error.status === 429) return "요청이 너무 많습니다. 잠시 후 다시 시도하세요.";
    if (error.status === 400 || error.status === 422) return error.message.slice(0, 180);
    if (error.status === 404) return "대상을 찾을 수 없습니다. 목록을 새로고침하세요.";
    return error.requestId ? `요청을 처리하지 못했습니다. 요청 ID: ${error.requestId}` : "요청을 처리하지 못했습니다.";
  }
  return error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
}

async function mutate(
  capability: Capability,
  form: FormData,
  build: (session: AdminSession, operationReason: string) => Promise<unknown>,
  success: string,
) {
  const session = await requireCapability(capability);
  const destination = returnTo(form);
  try {
    const operationReason = reason(form);
    await build(session, operationReason);
  } catch (error) {
    redirect(feedback(destination, "error", actionError(error)));
  }
  revalidatePath(destination.split("?")[0] || "/");
  redirect(feedback(destination, "success", success));
}

function mutationHeaders(form: FormData) {
  const key = text(form, "idempotencyKey", 200);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
    throw new Error("요청 중복 방지 키가 올바르지 않습니다. 새로고침 후 다시 시도하세요.");
  }
  return { "idempotency-key": key };
}

function id(form: FormData, name: string) {
  return encodeURIComponent(text(form, name, 200));
}

export async function changeUserStatus(form: FormData) {
  await mutate("users.manage", form, async (session, operationReason) => {
    const status = enumValue(form, "status", USER_MANAGEABLE_STATUSES);
    await adminApi(`/v1/admin/users/${id(form, "userId")}/status`, {
      method: "POST", token: session.token, reason: operationReason, headers: mutationHeaders(form),
      body: { status, reason: operationReason, suspendedUntil: status === "SUSPENDED" ? koreaDateTime(form, "suspendedUntil") : null },
    });
  }, "회원 상태를 변경했습니다.");
}

export async function decideAccountDeletion(form: FormData) {
  await mutate("accountDeletions.manage", form, async (session, operationReason) => {
    await adminApi(`/v1/admin/account-deletions/${id(form, "requestId")}/decision`, {
      method: "POST",
      token: session.token,
      reason: operationReason,
      headers: mutationHeaders(form),
      body: {
        decision: enumValue(form, "decision", ACCOUNT_DELETION_DECISIONS),
        reason: operationReason,
      },
    });
  }, "탈퇴 요청의 운영 검토 상태를 기록했습니다. 실제 계정 삭제는 실행되지 않았습니다.");
}

export async function createAdministrator(form: FormData) {
  await mutate("administrators.manage", form, async (session, operationReason) => {
    await adminApi("/v1/admin/administrators", {
      method: "POST", token: session.token, reason: operationReason, headers: mutationHeaders(form),
      body: {
        email: text(form, "email", 254).toLowerCase(), nickname: text(form, "nickname", 40),
        password: rawPassword(form), role: enumValue(form, "role", ADMIN_ROLES),
      },
    });
  }, "관리자 계정을 생성했습니다.");
}

export async function changeAdministrator(form: FormData) {
  await mutate("administrators.manage", form, async (session, operationReason) => {
    await adminApi(`/v1/admin/administrators/${id(form, "userId")}`, {
      method: "PATCH",
      token: session.token,
      reason: operationReason,
      headers: mutationHeaders(form),
      body: {
        role: enumValue(form, "role", ADMIN_ROLES),
        status: enumValue(form, "status", ADMIN_STATUSES),
        reason: operationReason,
      },
    });
  }, "관리자 권한과 상태를 변경했습니다.");
}

function noticeBody(form: FormData) {
  return {
    title: text(form, "title", 160), content: text(form, "content", 30_000),
    isPinned: form.get("isPinned") === "on", isPublished: form.get("isPublished") === "on",
  };
}

export async function createNotice(form: FormData) {
  await mutate("notices.manage", form, async (session, operationReason) => {
    await adminApi("/v1/admin/notices", { method: "POST", token: session.token, reason: operationReason, headers: mutationHeaders(form), body: noticeBody(form) });
  }, "공지사항을 생성했습니다.");
}

export async function updateNotice(form: FormData) {
  await mutate("notices.manage", form, async (session, operationReason) => {
    await adminApi(`/v1/admin/notices/${id(form, "noticeId")}`, { method: "PATCH", token: session.token, reason: operationReason, headers: mutationHeaders(form), body: { ...noticeBody(form), expectedVersion: version(form) } });
  }, "공지사항을 수정했습니다.");
}

export async function deleteNotice(form: FormData) {
  await mutate("notices.manage", form, async (session, operationReason) => {
    await adminApi(`/v1/admin/notices/${id(form, "noticeId")}`, { method: "DELETE", token: session.token, reason: operationReason, headers: mutationHeaders(form), body: { expectedVersion: version(form) } });
  }, "공지사항을 삭제 상태로 전환했습니다.");
}

export async function changeNoticeVisibility(form: FormData) {
  await mutate("notices.manage", form, async (session, operationReason) => {
    await adminApi(`/v1/admin/notices/${id(form, "noticeId")}/visibility`, { method: "POST", token: session.token, reason: operationReason, headers: mutationHeaders(form), body: { status: enumValue(form, "status", ["ACTIVE", "HIDDEN"] as const), expectedVersion: version(form) } });
  }, "공지사항 노출 상태를 변경했습니다.");
}

export async function restoreNotice(form: FormData) {
  await mutate("notices.manage", form, async (session, operationReason) => {
    await adminApi(`/v1/admin/notices/${id(form, "noticeId")}/restore`, { method: "POST", token: session.token, reason: operationReason, headers: mutationHeaders(form), body: { expectedVersion: version(form) } });
  }, "공지사항을 미게시 상태로 복구했습니다.");
}

export async function answerInquiry(form: FormData) {
  await mutate("inquiries.manage", form, async (session, operationReason) => {
    await adminApi(`/v1/admin/inquiries/${id(form, "inquiryId")}/messages`, {
      method: "POST", token: session.token, reason: operationReason, headers: mutationHeaders(form),
      body: { content: text(form, "content", 10_000), status: enumValue(form, "status", INQUIRY_STATUSES), isInternal: form.get("isInternal") === "on", mediaIds: [] },
    });
  }, "답변을 등록했습니다.");
}

async function moderate(form: FormData, kind: "posts" | "comments", idName: "postId" | "commentId") {
  await mutate("moderation.manage", form, async (session, operationReason) => {
    await adminApi(`/v1/admin/${kind}/${id(form, idName)}/status`, {
      method: "POST", token: session.token, reason: operationReason, headers: mutationHeaders(form),
      body: { status: enumValue(form, "status", CONTENT_STATUSES), reason: operationReason },
    });
  }, `${kind === "posts" ? "게시물" : "댓글"} 상태를 변경했습니다.`);
}

export async function moderatePost(form: FormData) { await moderate(form, "posts", "postId"); }
export async function moderateComment(form: FormData) { await moderate(form, "comments", "commentId"); }

export async function startReportReview(form: FormData) {
  await mutate("reports.manage", form, async (session, operationReason) => {
    await adminApi(`/v1/admin/reports/${id(form, "reportId")}/review`, {
      method: "POST", token: session.token, reason: operationReason, headers: mutationHeaders(form),
      body: { reason: operationReason },
    });
  }, "신고 검토를 시작했습니다.");
}

export async function resolveReport(form: FormData) {
  await mutate("reports.manage", form, async (session, operationReason) => {
    const action = enumValue(form, "action", REPORT_ACTIONS);
    await adminApi(`/v1/admin/reports/${id(form, "reportId")}/resolution`, {
      method: "POST", token: session.token, reason: operationReason, headers: mutationHeaders(form),
      body: {
        status: enumValue(form, "status", REPORT_STATUSES), action, reason: operationReason,
        suspendUntil: action === "SUSPEND_USER" ? koreaDateTime(form, "suspendUntil") : null,
      },
    });
  }, "신고를 처리했습니다.");
}

export async function resolveExchange(form: FormData) {
  await mutate("exchange.manage", form, async (session, operationReason) => {
    const action = enumValue(form, "action", EXCHANGE_ACTIONS);
    await adminApi(`/v1/admin/exchange/listings/${id(form, "listingId")}/resolution`, {
      method: "POST",
      token: session.token,
      reason: operationReason,
      headers: mutationHeaders(form),
      body: { action, reason: operationReason },
    });
  }, "교환 운영 처리를 완료했습니다.");
}

function ipBody(form: FormData) {
  return {
    slug: text(form, "slug", 100), nameKo: text(form, "nameKo", 160), nameEn: text(form, "nameEn", 160),
    nameJa: optionalText(form, "nameJa", 160), aliases: aliases(form), description: textAllowEmpty(form, "description", 5_000),
    imageUrl: optionalText(form, "imageUrl", 2_000), isActive: form.get("isActive") === "on",
  };
}

export async function createIp(form: FormData) {
  await mutate("catalog.manage", form, async (session, operationReason) => {
    await adminApi("/v1/admin/ips", { method: "POST", token: session.token, reason: operationReason, headers: mutationHeaders(form), body: ipBody(form) });
  }, "IP를 생성했습니다.");
}
export async function updateIp(form: FormData) {
  await mutate("catalog.manage", form, async (session, operationReason) => {
    await adminApi(`/v1/admin/ips/${id(form, "ipId")}`, { method: "PATCH", token: session.token, reason: operationReason, headers: mutationHeaders(form), body: { ...ipBody(form), expectedVersion: version(form) } });
  }, "IP를 수정했습니다.");
}

function characterBody(form: FormData) {
  return {
    ipId: text(form, "ipId", 120), name: text(form, "name", 160), aliases: aliases(form),
    imageUrl: optionalText(form, "imageUrl", 2_000), isActive: form.get("isActive") === "on",
  };
}
export async function createCharacter(form: FormData) {
  await mutate("catalog.manage", form, async (session, operationReason) => {
    await adminApi("/v1/admin/characters", { method: "POST", token: session.token, reason: operationReason, headers: mutationHeaders(form), body: characterBody(form) });
  }, "캐릭터를 생성했습니다.");
}
export async function updateCharacter(form: FormData) {
  await mutate("catalog.manage", form, async (session, operationReason) => {
    await adminApi(`/v1/admin/characters/${id(form, "characterId")}`, { method: "PATCH", token: session.token, reason: operationReason, headers: mutationHeaders(form), body: { ...characterBody(form), expectedVersion: version(form) } });
  }, "캐릭터를 수정했습니다.");
}

function productBody(form: FormData) {
  const characterIds = aliases(form, "characterIds");
  return {
    sku: text(form, "sku", 80), ipId: text(form, "ipId", 120), characterIds,
    category: enumValue(form, "category", CATEGORIES), name: text(form, "name", 240),
    manufacturer: optionalText(form, "manufacturer", 160), releaseDate: optionalText(form, "releaseDate", 10),
    price: integer(form, "price"), availableQuantity: integer(form, "availableQuantity"), metadata: metadata(form),
    imageUrl: optionalText(form, "imageUrl", 2_000), isActive: form.get("isActive") === "on",
  };
}
export async function createProduct(form: FormData) {
  await mutate("catalog.manage", form, async (session, operationReason) => {
    await adminApi("/v1/admin/products", { method: "POST", token: session.token, reason: operationReason, headers: mutationHeaders(form), body: productBody(form) });
  }, "상품을 생성했습니다.");
}
export async function updateProduct(form: FormData) {
  await mutate("catalog.manage", form, async (session, operationReason) => {
    await adminApi(`/v1/admin/products/${id(form, "productId")}`, { method: "PATCH", token: session.token, reason: operationReason, headers: mutationHeaders(form), body: { ...productBody(form), expectedVersion: version(form) } });
  }, "상품을 수정했습니다.");
}

function drawEntries(form: FormData) {
  const raw = text(form, "entries", 100_000);
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.length < 1 || value.length > 200) throw new Error("경품 구성은 1~200개 배열이어야 합니다.");
  return value;
}

export async function createDrawVersion(form: FormData) {
  await mutate("catalog.manage", form, async (session, operationReason) => {
    await adminApi(`/v1/admin/products/${id(form, "productId")}/draw-versions`, {
      method: "POST", token: session.token, reason: operationReason, headers: mutationHeaders(form), body: { entries: drawEntries(form) },
    });
  }, "추첨 확률표 초안을 생성했습니다.");
}

export async function publishDrawVersion(form: FormData) {
  await mutate("catalog.manage", form, async (session, operationReason) => {
    await adminApi(`/v1/admin/products/${id(form, "productId")}/draw-versions/${id(form, "versionId")}/publish`, {
      method: "POST", token: session.token, reason: operationReason, headers: mutationHeaders(form), body: { reason: operationReason },
    });
  }, "추첨 확률표를 공개했습니다.");
}

export async function decideCatalogRequest(form: FormData) {
  await mutate("catalogRequests.manage", form, async (session, operationReason) => {
    const decision = enumValue(form, "decision", REQUEST_DECISIONS);
    const canonicalTargetId = decision === "APPROVED" || decision === "MERGED"
      ? text(form, "canonicalTargetId", 120)
      : null;
    await adminApi(`/v1/admin/catalog-requests/${id(form, "requestId")}/decision`, {
      method: "POST", token: session.token, reason: operationReason, headers: mutationHeaders(form),
      body: decision === "APPROVED" || decision === "MERGED"
        ? { decision, reason: operationReason, canonicalTargetId }
        : { decision, reason: operationReason },
    });
  }, "카탈로그 신청을 처리했습니다.");
}

export async function updateRefundReview(form: FormData) {
  await mutate("refunds.manage", form, async (session, operationReason) => {
    await adminApi(`/v1/admin/commerce/refund-reviews/${id(form, "paymentId")}`, {
      method: "POST",
      token: session.token,
      reason: operationReason,
      headers: mutationHeaders(form),
      body: {
        status: enumValue(form, "status", REFUND_REVIEW_STATUSES),
        note: text(form, "note", 5_000),
        expectedVersion: integer(form, "expectedVersion"),
        reason: operationReason,
      },
    });
  }, "환불 운영 검토 메모를 기록했습니다. PG 환불은 실행되지 않았습니다.");
}

export async function adjustInventory(form: FormData) {
  await mutate("inventory.adjust", form, async (session, operationReason) => {
    const deltaOnHand = signedInteger(form, "deltaOnHand");
    if (deltaOnHand === 0) throw new Error("재고 증감 수량은 0일 수 없습니다.");
    await adminApi(`/v1/admin/commerce/inventory/${id(form, "productId")}/adjustments`, {
      method: "POST",
      token: session.token,
      reason: operationReason,
      headers: mutationHeaders(form),
      body: { deltaOnHand, expectedVersion: version(form), reason: operationReason },
    });
  }, "재고 조정 원장을 기록하고 판매 재고를 반영했습니다.");
}

export async function updateShippingStatus(form: FormData) {
  await mutate("shipping.manage", form, async (session, operationReason) => {
    const status = enumValue(form, "status", SHIPPING_TARGET_STATUSES);
    await adminApi(`/v1/admin/commerce/shipping/${id(form, "shippingRequestId")}/status`, {
      method: "POST",
      token: session.token,
      reason: operationReason,
      headers: mutationHeaders(form),
      body: {
        status,
        expectedVersion: version(form),
        reason: operationReason,
        trackingCarrier: status === "SHIPPED" ? optionalText(form, "trackingCarrier", 100) : null,
        trackingNumber: status === "SHIPPED" ? optionalText(form, "trackingNumber", 200) : null,
      },
    });
  }, "배송 상태를 변경했습니다.");
}
