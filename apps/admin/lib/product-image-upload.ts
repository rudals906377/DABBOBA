import "server-only";

import { createHash } from "node:crypto";
import type { components } from "@dabboba/contracts";
import { AdminApiError, adminApi } from "./api";
import { catalogImageFile, uploadCatalogImage } from "./catalog-media-upload";

type MediaUploadIntent = components["schemas"]["MediaUploadIntent"];
type MediaReady = components["schemas"]["MediaReady"];
type ProductImageAttachment = components["schemas"]["ProductImageAttachment"];
const ROLES = ["primary", "storefront", "gallery"] as const;
class ProductImageUploadError extends Error {}

function field(form: FormData, name: string, max: number) {
  const value = form.get(name);
  if (typeof value !== "string" || !value.trim() || value.trim().length > max || form.getAll(name).length !== 1) {
    throw new ProductImageUploadError(`${name} 값이 올바르지 않습니다.`);
  }
  return value.trim();
}

export function productImageReason(form: FormData) {
  const value = field(form, "reason", 1000);
  if (value.length < 2) throw new ProductImageUploadError("처리 사유를 두 글자 이상 입력하세요.");
  return value;
}

function idempotency(form: FormData, name: string) {
  const key = field(form, name, 200);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
    throw new ProductImageUploadError("요청 중복 방지 키가 올바르지 않습니다. 새로고침 후 다시 시도하세요.");
  }
  return { "idempotency-key": key };
}

/** Shared by the legacy action and the ordinary multipart route. Never accepts a client storage URL. */
export async function saveProductImage(form: FormData, token: string, operationReason: string) {
  const productId = encodeURIComponent(field(form, "productId", 200));
  const expectedVersion = Number(field(form, "expectedVersion", 20));
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || expectedVersion > 2_147_483_647) {
    throw new ProductImageUploadError("expectedVersion 값은 1 이상의 정수여야 합니다.");
  }
  const roleValue = field(form, "role", 20);
  if (!ROLES.includes(roleValue as typeof ROLES[number])) throw new ProductImageUploadError("role 선택값이 올바르지 않습니다.");
  const role = roleValue as typeof ROLES[number];
  if (form.getAll("image").length !== 1) throw new ProductImageUploadError("상품 사진은 한 번에 한 장씩 업로드해 주세요.");
  let file: ReturnType<typeof catalogImageFile>;
  try { file = catalogImageFile(form.get("image")); }
  catch { throw new ProductImageUploadError("JPG, PNG, WEBP, GIF 상품 사진 중 10MB 이하 파일을 선택해 주세요."); }
  // Validate all three keys before creating any storage intent.
  const intentHeaders = idempotency(form, "idempotencyKey");
  const completeHeaders = idempotency(form, "completeIdempotencyKey");
  const attachHeaders = idempotency(form, "attachIdempotencyKey");
  const checksumSha256 = createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex");
  let stage = "intent";
  try {
    const intent = await adminApi<MediaUploadIntent>("/v1/admin/catalog-media/uploads", {
      method: "POST", token, reason: operationReason, headers: intentHeaders,
      body: { filename: file.name, mimeType: file.type, byteSize: file.size, checksumSha256, acceptedUploadMethods: ["POST", "PUT"] },
    });
    stage = "storage";
    await uploadCatalogImage(intent, file);
    stage = "complete";
    await adminApi<MediaReady>(`/v1/admin/catalog-media/${encodeURIComponent(intent.mediaId)}/complete`, {
      method: "POST", token, reason: operationReason, headers: completeHeaders,
    });
    stage = "attach";
    await adminApi<ProductImageAttachment>(`/v1/admin/products/${productId}/image`, {
      method: "PATCH", token, reason: operationReason, headers: attachHeaders,
      body: { mediaId: intent.mediaId, expectedVersion, role },
    });
  } catch (error) {
    // No filenames, signed URLs, credentials, body, or raw provider errors in logs.
    console.error("catalog-media-admin-flow", stage, error instanceof AdminApiError ? error.status : "local");
    if (error instanceof AdminApiError && error.status === 503) {
      throw new ProductImageUploadError("현재 상품 이미지 저장을 사용할 수 없습니다. 운영 환경의 미디어 구성을 확인한 뒤 다시 시도해 주세요.");
    }
    if (error instanceof AdminApiError && error.status === 410) {
      throw new ProductImageUploadError("상품 사진 업로드 시간이 만료되었습니다. 사진을 다시 선택해 시도해 주세요.");
    }
    if (error instanceof AdminApiError) throw error;
    throw new ProductImageUploadError("상품 사진 파일을 전송하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

export function productImageError(error: unknown) {
  if (error instanceof AdminApiError) {
    if (error.status === 403) return "이 작업을 수행할 권한이 없습니다.";
    if (error.status === 409) return "현재 서버 상태와 충돌했습니다. 새로고침 후 다시 시도하세요.";
    if (error.status === 429) return "요청이 너무 많습니다. 잠시 후 다시 시도하세요.";
    if (error.status === 400 || error.status === 422) return error.message.slice(0, 180);
    if (error.status === 404) return "대상을 찾을 수 없습니다. 목록을 새로고침하세요.";
    return "상품 사진을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
  // Errors emitted by the local form/transport validators contain no secrets.
  return error instanceof ProductImageUploadError ? error.message.slice(0, 180) : "상품 사진을 저장하지 못했습니다.";
}
