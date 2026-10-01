// The gallery is separate from prize images and the storefront card image.
// When a curated detail gallery exists, the primary image is only a fallback.
export function productDetailGalleryImages(metadata: Record<string, unknown>, primaryImageUrl: string | null): string[] {
  const value = metadata.detailGalleryImageUrls;
  if (!Array.isArray(value)) return primaryImageUrl ? [primaryImageUrl] : [];
  const urls = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => {
      if (item.startsWith("/") && !item.startsWith("//")) return true;
      try {
        const url = new URL(item);
        return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname);
      } catch {
        return false;
      }
    });
  const unique = [...new Set(urls)].slice(0, 8);
  return unique.length ? unique : primaryImageUrl ? [primaryImageUrl] : [];
}
