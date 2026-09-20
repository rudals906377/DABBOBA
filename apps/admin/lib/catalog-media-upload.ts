import "server-only";

import type { components } from "@dabboba/contracts";

type MediaUploadIntent = components["schemas"]["MediaUploadIntent"];

export const MAX_CATALOG_IMAGE_BYTES = 10 * 1024 * 1024;
export const CATALOG_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

export type CatalogImageFile = File & { type: typeof CATALOG_IMAGE_MIME_TYPES[number] };

export function catalogImageFile(value: FormDataEntryValue | null): CatalogImageFile {
  if (typeof value === "string" || !value || typeof value.arrayBuffer !== "function") {
    throw new Error("업로드할 상품 사진을 선택해 주세요.");
  }
  if (!value.name || value.name.length > 255) {
    throw new Error("상품 사진 파일 이름은 1~255자여야 합니다.");
  }
  if (!CATALOG_IMAGE_MIME_TYPES.includes(value.type as CatalogImageFile["type"])) {
    throw new Error("JPG, PNG, WEBP, GIF 상품 사진만 업로드할 수 있습니다.");
  }
  if (!Number.isSafeInteger(value.size) || value.size < 1 || value.size > MAX_CATALOG_IMAGE_BYTES) {
    throw new Error("상품 사진은 10MB 이하 파일이어야 합니다.");
  }
  return value as CatalogImageFile;
}

function uploadUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("상품 사진 업로드 주소가 올바르지 않습니다.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("상품 사진 업로드 주소가 올바르지 않습니다.");
  }
  if (url.username || url.password || url.hash) {
    throw new Error("상품 사진 업로드 주소가 올바르지 않습니다.");
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && (process.env.NODE_ENV === "production" || !loopback)) {
    throw new Error("상품 사진 업로드 주소가 올바르지 않습니다.");
  }
  return url;
}

function stringRecord(value: unknown, label: string): Record<string, string> {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${label} 응답이 올바르지 않습니다.`);
  }
  const entries = Object.entries(value);
  if (entries.some(([, item]) => typeof item !== "string")) {
    throw new Error(`${label} 응답이 올바르지 않습니다.`);
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

export async function uploadCatalogImage(intent: MediaUploadIntent, file: CatalogImageFile) {
  if (!/^[0-9a-f-]{36}$/i.test(intent.mediaId) || intent.maxBytes !== file.size) {
    throw new Error("상품 사진 업로드 응답이 파일 정보와 일치하지 않습니다.");
  }
  if (intent.method !== "POST" && intent.method !== "PUT") {
    throw new Error("상품 사진 업로드 방식이 올바르지 않습니다.");
  }
  const url = uploadUrl(intent.uploadUrl);
  let response: Response;
  try {
    if (intent.method === "POST") {
      const body = new FormData();
      for (const [name, value] of Object.entries(stringRecord(intent.fields, "상품 사진 업로드"))) {
        body.append(name, value);
      }
      body.append(intent.fileFieldName, file, file.name);
      response = await fetch(url, {
        method: "POST", body, cache: "no-store", credentials: "omit", redirect: "error",
        signal: AbortSignal.timeout(120_000),
      });
    } else {
      response = await fetch(url, {
        method: "PUT", headers: stringRecord(intent.headers, "상품 사진 업로드"), body: file,
        cache: "no-store", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(120_000),
      });
    }
  } catch {
    throw new Error("상품 사진 파일을 전송하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  if (!response.ok) {
    throw new Error("상품 사진 파일을 전송하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}
