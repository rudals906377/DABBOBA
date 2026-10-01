import "server-only";

export const MAX_CATALOG_UPLOAD_BODY_BYTES = 11 * 1024 * 1024;

export class CatalogUploadBodyError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

/** Bound streamed requests too: Content-Length alone is not a reliable size limit. */
export async function catalogUploadForm(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (!/^multipart\/form-data\s*;/i.test(contentType) || !/\bboundary=/i.test(contentType)) {
    throw new CatalogUploadBodyError(415, "사진 업로드 형식이 올바르지 않습니다.");
  }
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_CATALOG_UPLOAD_BODY_BYTES)) {
    throw new CatalogUploadBodyError(413, "상품 사진은 10MB 이하 파일이어야 합니다.");
  }
  if (!request.body) throw new CatalogUploadBodyError(400, "업로드할 상품 사진을 선택해 주세요.");
  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_CATALOG_UPLOAD_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new CatalogUploadBodyError(413, "상품 사진은 10MB 이하 파일이어야 합니다.");
      }
      chunks.push(new Uint8Array(value));
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return await new Response(new Blob(chunks), { headers: { "content-type": contentType } }).formData();
  } catch {
    throw new CatalogUploadBodyError(400, "사진 업로드 형식이 올바르지 않습니다.");
  }
}
