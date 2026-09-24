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
