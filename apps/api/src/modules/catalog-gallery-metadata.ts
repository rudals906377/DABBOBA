import { conflict } from "../lib/errors.js";

const GALLERY_KEY = "detailGalleryImageUrls";

/** Gallery membership is changed only by the audited media attach/clear routes. */
export function preserveProductGalleryMetadata(
  input: Record<string, unknown>,
  current?: Record<string, unknown>,
): Record<string, unknown> {
  const requested = input[GALLERY_KEY];
  const stored = current?.[GALLERY_KEY];
  if (requested !== undefined && (!Array.isArray(requested) || !requested.every((url) => typeof url === "string"))) {
    throw conflict("상세 슬라이드 사진은 사진 관리에서 변경해 주세요.");
  }
  if (requested !== undefined && JSON.stringify(requested) !== JSON.stringify(stored ?? [])) {
    throw conflict("상세 슬라이드 사진은 사진 관리에서 변경해 주세요.");
  }
  const result = { ...input };
  if (stored === undefined) delete result[GALLERY_KEY];
  else result[GALLERY_KEY] = stored;
  return result;
}
