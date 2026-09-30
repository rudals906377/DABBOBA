const LEGACY_CATALOG_MEDIA_BASE_URL =
  "https://yxkmvgfruphgghowzvmo.supabase.co/functions/v1/dabboba-api";
const LEGACY_CATALOG_MEDIA_URL = /^https:\/\/yxkmvgfruphgghowzvmo\.supabase\.co\/functions\/v1\/dabboba-api\/v1\/catalog\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/image$/i;

export function legacyCatalogMediaDeliveryUrl(mediaId: string): string {
  return `${LEGACY_CATALOG_MEDIA_BASE_URL}/v1/catalog/media/${mediaId}/image`;
}

export function rebaseLegacyCatalogMediaUrl(
  currentBaseUrl: string | null | undefined,
  imageUrl: string | null,
): string | null {
  if (!currentBaseUrl || !imageUrl) return imageUrl;
  const match = LEGACY_CATALOG_MEDIA_URL.exec(imageUrl);
  return match ? `${currentBaseUrl}/v1/catalog/media/${match[1]}/image` : imageUrl;
}

/**
 * Stored idempotent replay bodies keep the host that was current when they
 * were committed. Translate only the known legacy media field on the way out
 * so a recovered result keeps its immutable identity and every other value.
 */
export function rebaseLegacyCatalogMediaReplayBody<T>(
  currentBaseUrl: string | null | undefined,
  body: T,
  field = "prizeImageUrl",
): T {
  if (!currentBaseUrl || !body || typeof body !== "object" || Array.isArray(body)) return body;
  const value = (body as Record<string, unknown>)[field];
  if (typeof value !== "string") return body;
  const rebased = rebaseLegacyCatalogMediaUrl(currentBaseUrl, value);
  return rebased === value ? body : { ...body, [field]: rebased };
}
