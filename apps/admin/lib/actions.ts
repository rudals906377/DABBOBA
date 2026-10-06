"use server";

import type { components } from "@dabboba/contracts";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AdminApiError, adminApi } from "./api";
import { requireCapability, type AdminSession } from "./auth";
import type { Capability } from "./capabilities";
import type { CatalogProduct } from "./admin-types";
import { saveProductImage } from "./product-image-upload";
import { buildDrawVersionDraftPayload, type DrawDraftCategory } from "./draw-version-draft";
import { safeInternalPath } from "./request-security";

const USER_MANAGEABLE_STATUSES = ["ACTIVE", "SUSPENDED", "BANNED"] as const;
const CONTENT_STATUSES = ["ACTIVE", "HIDDEN", "DELETED"] as const;
const INQUIRY_STATUSES = ["PENDING", "IN_PROGRESS", "ANSWERED", "CLOSED"] as const;
const REPORT_STATUSES = ["RESOLVED", "REJECTED"] as const;
const REPORT_ACTIONS = ["NO_ACTION", "HIDE_POST", "HIDE_COMMENT", "HIDE_EXCHANGE_LISTING", "HIDE_WANTED_REQUEST", "WARN_USER", "SUSPEND_USER"] as const;
const REQUEST_DECISIONS = ["APPROVED", "REJECTED", "ON_HOLD", "MERGED"] as const;
const CATEGORIES = ["gacha", "figure", "kuji", "tcg"] as const;
const PRODUCT_SALE_STATUSES = ["DRAFT", "COMING_SOON", "ON_SALE", "PAUSED"] as const;
const HOME_SECTION_LAYOUT_KINDS = ["gacha", "kuji"] as const;
const HOME_SECTION_SOURCE_KINDS = ["MANUAL", "IP", "NEW", "POPULAR"] as const;
const CATEGORY_AVAILABILITIES = ["active", "coming-soon", "hidden"] as const;
const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"] as const;
const ADMIN_STATUSES = ["ACTIVE", "SUSPENDED", "BANNED"] as const;
const EXCHANGE_ACTIONS = ["COMPLETE", "CANCEL"] as const;
const REFUND_REVIEW_STATUSES = ["PENDING", "IN_REVIEW", "WAITING_PROVIDER", "ESCALATED", "CLOSED"] as const;
const SHIPPING_TARGET_STATUSES = ["PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"] as const;
const ACCOUNT_DELETION_DECISIONS = ["APPROVED", "REJECTED"] as const;

type ProductImageClearInput = components["schemas"]["ProductImageClearInput"];
type ProductImageClearResult = components["schemas"]["ProductImageClearResult"];

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

function idempotencyHeaders(form: FormData, name: string) {
  const key = text(form, name, 200);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
    throw new Error("요청 중복 방지 키가 올바르지 않습니다. 새로고침 후 다시 시도하세요.");
  }
  return { "idempotency-key": key };
}

function mutationHeaders(form: FormData) {
  return idempotencyHeaders(form, "idempotencyKey");
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
  }, "탈퇴 요청의 운영 검토 상태를 기록했습니다.");
}

export async function completeAccountDeletion(form: FormData) {
  await mutate("accountDeletions.manage", form, async (session, operationReason) => {
    await adminApi(`/v1/admin/account-deletions/${id(form, "requestId")}/completion`, {
      method: "POST",
      token: session.token,
      reason: operationReason,
      headers: mutationHeaders(form),
      body: { reason: operationReason },
    });
  }, "회원의 로그인 연결과 개인정보를 제거해 탈퇴 처리를 완료했습니다.");
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
    slug: optionalText(form, "slug", 100) ?? `work-${mutationHeaders(form)["idempotency-key"]}`, nameKo: text(form, "nameKo", 160), nameEn: optionalText(form, "nameEn", 160) ?? text(form, "nameKo", 160),
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

function homeSectionBody(form: FormData) {
  const visibleLimit = integer(form, "visibleLimit");
  if (visibleLimit < 1 || visibleLimit > 20) {
    throw new Error("visibleLimit 값은 1~20 사이여야 합니다.");
  }
  return {
    title: text(form, "title", 120),
    subtitle: optionalText(form, "subtitle", 240),
    ipId: optionalText(form, "ipId", 120),
    layoutKind: enumValue(form, "layoutKind", HOME_SECTION_LAYOUT_KINDS),
    sourceKind: enumValue(form, "sourceKind", HOME_SECTION_SOURCE_KINDS),
    visibleLimit,
    manualProductIds: aliases(form, "manualProductIds"),
    sortOrder: integer(form, "sortOrder"),
    isActive: form.get("isActive") === "on",
  };
}

export async function createHomeSection(form: FormData) {
  await mutate("catalog.manage", form, async (session, operationReason) => {
    if (form.get("confirmCatalogOverride") !== "on") {
      throw new Error("홈 상품 레일 운영 안내를 확인해 주세요.");
    }
    await adminApi("/v1/admin/home-sections", {
      method: "POST", token: session.token, reason: operationReason, headers: mutationHeaders(form),
      body: { id: optionalText(form, "sectionId", 120) ?? `home-${mutationHeaders(form)["idempotency-key"]}`, ...homeSectionBody(form), isActive: false },
    });
  }, "홈 섹션을 비노출 상태로 생성했습니다.");
}

export async function updateHomeSection(form: FormData) {
  await mutate("catalog.manage", form, async (session, operationReason) => {
    await adminApi(`/v1/admin/home-sections/${id(form, "sectionId")}`, {
      method: "PATCH", token: session.token, reason: operationReason, headers: mutationHeaders(form),
      body: { ...homeSectionBody(form), expectedVersion: version(form) },
    });
  }, "홈 섹션을 수정했습니다.");
}

export async function updateStorefrontCategorySetting(form: FormData) {
  await mutate("catalog.manage", form, async (session, operationReason) => {
    const category = enumValue(form, "category", CATEGORIES);
    await adminApi(`/v1/admin/category-settings/${encodeURIComponent(category)}`, {
      method: "PATCH",
      token: session.token,
      reason: operationReason,
      headers: mutationHeaders(form),
      body: {
        label: text(form, "label", 40),
        sortOrder: integer(form, "sortOrder"),
        availability: enumValue(form, "availability", CATEGORY_AVAILABILITIES),
        showOnHome: form.get("showOnHome") === "on",
        showOnCatalog: form.get("showOnCatalog") === "on",
        showOnExchange: form.get("showOnExchange") === "on",
        showOnWanted: form.get("showOnWanted") === "on",
        description: textAllowEmpty(form, "description", 240),
        imageUrl: optionalText(form, "imageUrl", 2_000),
        iconKey: optionalText(form, "iconKey", 80),
        expectedVersion: version(form),
      },
    });
  }, "카테고리 표시 설정을 수정했습니다. 앱에 자동으로 반영됩니다.");
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

function productBody(form: FormData, current?: CatalogProduct) {
  if (form.get("simpleCatalog") === "on") {
    const category = current?.category ?? enumValue(form, "category", CATEGORIES);
    return {
      sku: current?.sku ?? `${category}-${mutationHeaders(form)["idempotency-key"]}`,
      ipId: text(form, "ipId", 120),
      characterIds: current?.characterIds ?? [],
      category, name: text(form, "name", 240),
      manufacturer: optionalText(form, "manufacturer", 160), releaseDate: optionalText(form, "releaseDate", 10),
      price: integer(form, "price"), availableQuantity: current?.availableQuantity ?? integer(form, "availableQuantity"),
      metadata: current?.metadata ?? {}, imageUrl: current?.imageUrl ?? null,
      isActive: form.get("isActive") === "on", isPrizeOnly: current?.isPrizeOnly ?? form.get("isPrizeOnly") === "on",
      saleStatus: current?.isPrizeOnly ? "DRAFT" : enumValue(form, "saleStatus", PRODUCT_SALE_STATUSES),
    };
  }
  const characterIds = aliases(form, "characterIds");
  return {
    sku: text(form, "sku", 80), ipId: text(form, "ipId", 120), characterIds,
    category: enumValue(form, "category", CATEGORIES), name: text(form, "name", 240),
    manufacturer: optionalText(form, "manufacturer", 160), releaseDate: optionalText(form, "releaseDate", 10),
    price: integer(form, "price"), availableQuantity: integer(form, "availableQuantity"), metadata: metadata(form),
    imageUrl: optionalText(form, "imageUrl", 2_000), isActive: form.get("isActive") === "on",
    isPrizeOnly: form.get("isPrizeOnly") === "on",
    saleStatus: enumValue(form, "saleStatus", PRODUCT_SALE_STATUSES),
  };
}
export async function createProduct(form: FormData) {
  const session = await requireCapability("catalog.manage");
  const destination = returnTo(form);
  let created: CatalogProduct;
  try {
    const operationReason = reason(form);
    created = await adminApi<CatalogProduct>("/v1/admin/products", {
      method: "POST",
      token: session.token,
      reason: operationReason,
      headers: mutationHeaders(form),
      body: productBody(form),
    });
  } catch (error) {
    redirect(feedback(destination, "error", actionError(error)));
  }
  revalidatePath(destination.split("?")[0] || "/");
  const needsKujiConfiguration = created.category === "kuji" && !created.isPrizeOnly;
  const successDestination = needsKujiConfiguration
    ? `/catalog/products/${encodeURIComponent(created.id)}/draws`
    : form.get("simpleCatalog") === "on" && destination.split("?")[0] === "/catalog/products"
      ? `/catalog/products/${encodeURIComponent(created.id)}`
    : destination;
  redirect(feedback(
    successDestination,
    "success",
    needsKujiConfiguration ? "상품을 생성했습니다. 쿠지 상 구성을 완료해 주세요." : "상품을 생성했습니다.",
  ));
}
export async function updateProduct(form: FormData) {
  await mutate("catalog.manage", form, async (session, operationReason) => {
    const path = `/v1/admin/products/${id(form, "productId")}`;
    const expectedVersion = version(form);
    const current = form.get("simpleCatalog") === "on" ? await adminApi<CatalogProduct>(path, { token: session.token }) : undefined;
    if (current && current.version !== expectedVersion) throw new Error("다른 운영자가 먼저 수정했습니다. 새로고침 후 다시 저장해 주세요.");
    await adminApi(path, { method: "PATCH", token: session.token, reason: operationReason, headers: mutationHeaders(form), body: { ...productBody(form, current), expectedVersion } });
  }, "상품을 수정했습니다.");
}

export async function uploadProductImage(form: FormData) {
  await mutate("catalog.manage", form, async (session, operationReason) => {
    await saveProductImage(form, session.token, operationReason);
  }, "상품 사진을 저장했습니다.");
}

export async function clearStorefrontProductImage(form: FormData) {
  await mutate("catalog.manage", form, async (session, operationReason) => {
    if (form.get("confirmStorefrontImageClear") !== "on") {
      throw new Error("목록 사진 연결 해제 안내를 확인해 주세요.");
    }
    const input: ProductImageClearInput = {
      expectedVersion: version(form),
      role: enumValue(form, "role", ["storefront"] as const),
    };
    await adminApi<ProductImageClearResult>(`/v1/admin/products/${id(form, "productId")}/image`, {
      method: "DELETE",
      token: session.token,
      reason: operationReason,
      headers: mutationHeaders(form),
      body: input,
    });
  }, "상품 목록 사진 연결을 해제했습니다.");
}

export async function clearGalleryProductImage(form: FormData) {
  await mutate("catalog.manage", form, async (session, operationReason) => {
    if (form.get("confirmGalleryImageClear") !== "on") {
      throw new Error("상세 슬라이드 사진 연결 해제를 확인해 주세요.");
    }
    const input: ProductImageClearInput = {
      expectedVersion: version(form),
      role: "gallery",
      imageUrl: text(form, "imageUrl", 2_000),
    };
    await adminApi<ProductImageClearResult>(`/v1/admin/products/${id(form, "productId")}/image`, {
      method: "DELETE",
      token: session.token,
      reason: operationReason,
      headers: mutationHeaders(form),
      body: input,
    });
  }, "상세 슬라이드 사진 연결을 해제했습니다.");
}

function drawVersionBody(form: FormData, category: DrawDraftCategory) {
  const entries: unknown = JSON.parse(text(form, "entries", 100_000));
  return buildDrawVersionDraftPayload(category, entries, form.get("totalSlots"));
}

export async function createDrawVersion(form: FormData) {
  await mutate("catalog.manage", form, async (session, operationReason) => {
    const productId = id(form, "productId");
    const headers = mutationHeaders(form);
    const product = await adminApi<CatalogProduct>(`/v1/admin/products/${productId}`, { token: session.token });
    if (product.category !== "gacha" && product.category !== "kuji") {
      throw new Error("가챠·쿠지 판매 상품만 확률표를 만들 수 있습니다.");
    }
    await adminApi(`/v1/admin/products/${productId}/draw-versions`, {
      method: "POST", token: session.token, reason: operationReason, headers, body: drawVersionBody(form, product.category),
    });
  }, "추첨 구성 초안을 생성했습니다.");
}

export async function publishDrawVersion(form: FormData) {
  await mutate("catalog.manage", form, async (session, operationReason) => {
    await adminApi(`/v1/admin/products/${id(form, "productId")}/draw-versions/${id(form, "versionId")}/publish`, {
      method: "POST", token: session.token, reason: operationReason, headers: mutationHeaders(form), body: { reason: operationReason },
    });
  }, "추첨 구성을 공개했습니다.");
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

export async function reconcilePortOneRefundCancellation(form: FormData) {
  await mutate("refunds.reconcile", form, async (session, operationReason) => {
    await adminApi(`/v1/admin/commerce/refund-reviews/${id(form, "paymentId")}/cancellation/reconcile`, {
      method: "POST",
      token: session.token,
      reason: operationReason,
      headers: mutationHeaders(form),
      body: { reason: operationReason },
    });
  }, "포트원 결제 상태를 다시 조회했습니다. 새 취소 요청은 보내지 않았습니다.");
}

export async function reconcilePortOnePayment(form: FormData) {
  await mutate("payments.reconcile", form, async (session, operationReason) => {
    if (operationReason.length > 500) throw new Error("재조회 사유는 500자 이내로 입력하세요.");
    await adminApi(`/v1/admin/commerce/payments/${id(form, "paymentId")}/reconcile`, {
      method: "POST",
      token: session.token,
      reason: operationReason,
      headers: mutationHeaders(form),
      body: { reason: operationReason },
    });
  }, "포트원 결제 상태를 다시 확인했습니다. 결제 요청이나 취소 요청은 보내지 않았습니다.");
}

export async function requestPortOneFullDrawRefund(form: FormData) {
  await mutate("refunds.cancel", form, async (session, operationReason) => {
    if (operationReason.length > 500) throw new Error("환불 사유는 500자 이내로 입력하세요.");
    if (String(form.get("confirmFullRefund") || "") !== "yes") {
      throw new Error("결제 전액 환불 확인에 동의해 주세요.");
    }
    await adminApi(`/v1/admin/commerce/payments/${id(form, "paymentId")}/refund`, {
      method: "POST",
      token: session.token,
      reason: operationReason,
      headers: mutationHeaders(form),
      body: { reason: operationReason },
    });
  }, "전액 환불 요청을 기록했습니다. 공급자 확인 전에는 최종 환불로 표시하지 않습니다.");
}

export async function requestPointOrderRefund(form: FormData) {
  await mutate("refunds.cancel", form, async (session, operationReason) => {
    if (operationReason.length > 500) throw new Error("환불 사유는 500자 이내로 입력하세요.");
    if (String(form.get("confirmPointRefund") || "") !== "yes") {
      throw new Error("포인트 주문 환불 내용을 확인해 주세요.");
    }
    await adminApi(`/v1/admin/commerce/payments/${id(form, "paymentId")}/point-refund`, {
      method: "POST",
      token: session.token,
      reason: operationReason,
      headers: mutationHeaders(form),
      body: { reason: operationReason },
    });
  }, "포인트 주문을 환불했습니다. 사용한 포인트를 회원에게 되돌리고 뽑기권을 취소했습니다.");
}

export async function requestPartialUnusedRefund(form: FormData) {
  await mutate("refunds.cancel", form, async (session, operationReason) => {
    if (operationReason.length > 500) throw new Error("환불 사유는 500자 이내로 입력하세요.");
    if (String(form.get("confirmPartialRefund") || "") !== "yes") {
      throw new Error("미사용 뽑기 부분 환불 내용을 확인해 주세요.");
    }
    await adminApi(`/v1/admin/commerce/payments/${id(form, "paymentId")}/partial-refund`, {
      method: "POST",
      token: session.token,
      reason: operationReason,
      headers: mutationHeaders(form),
      body: { reason: operationReason },
    });
  }, "미사용 뽑기 부분 환불을 요청했습니다. 아래 진행 상태를 확인해 주세요.");
}

export async function reconcilePartialUnusedRefund(form: FormData) {
  await mutate("refunds.cancel", form, async (session, operationReason) => {
    if (operationReason.length > 500) throw new Error("확인 사유는 500자 이내로 입력하세요.");
    await adminApi(`/v1/admin/commerce/payments/${id(form, "paymentId")}/partial-refund/reconcile`, {
      method: "POST",
      token: session.token,
      reason: operationReason,
      headers: mutationHeaders(form),
      body: { reason: operationReason },
    });
  }, "결제사 상태를 다시 확인했습니다. 부분 환불 진행 상태를 확인해 주세요.");
}

export async function requestPortOneLateRefund(form: FormData) {
  await mutate("refunds.cancel", form, async (session, operationReason) => {
    if (operationReason.length > 500) throw new Error("환불 사유는 500자 이내로 입력하세요.");
    if (String(form.get("confirmFullRefund") || "") !== "yes") {
      throw new Error("결제 전액 취소 요청을 확인해 주세요.");
    }
    await adminApi(`/v1/admin/commerce/refund-reviews/${id(form, "paymentId")}/cancel`, {
      method: "POST",
      token: session.token,
      reason: operationReason,
      headers: mutationHeaders(form),
      body: { reason: operationReason },
    });
  }, "결제 지연 전액 환불 요청을 기록했습니다. 포트원 최종 상태를 대조해 주세요.");
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
