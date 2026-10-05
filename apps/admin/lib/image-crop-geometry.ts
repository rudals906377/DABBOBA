export type CropRect = { x: number; y: number; width: number; height: number };

export function imageCropRect(
  imageWidth: number,
  imageHeight: number,
  aspectRatio: number,
  zoom: number,
  horizontalPercent: number,
  verticalPercent: number,
): CropRect {
  if (
    ![imageWidth, imageHeight, aspectRatio, zoom, horizontalPercent, verticalPercent].every(Number.isFinite)
    || imageWidth <= 0 || imageHeight <= 0 || aspectRatio <= 0 || zoom < 1 || zoom > 4
    || horizontalPercent < 0 || horizontalPercent > 100
    || verticalPercent < 0 || verticalPercent > 100
  ) {
    throw new Error("사진 자르기 값이 올바르지 않습니다.");
  }
  const baseWidth = Math.min(imageWidth, imageHeight * aspectRatio);
  const baseHeight = baseWidth / aspectRatio;
  const width = baseWidth / zoom;
  const height = baseHeight / zoom;
  return {
    x: (imageWidth - width) * horizontalPercent / 100,
    y: (imageHeight - height) * verticalPercent / 100,
    width,
    height,
  };
}

// Fixed crop ratios offered by the admin pickers, as whole-number sides.
const EXACT_RATIOS = [[1, 1], [6, 5], [4, 3], [16, 9]] as const;

/**
 * Whole-pixel output size for a crop, scaled down so the longer side is at most `maxSide`.
 * A fixed ratio (1:1, 6:5, 4:3, 16:9) snaps both sides to the same whole multiple of that
 * ratio, because rounding each side separately rarely keeps 16:9 exact and the API checks
 * `width * 9 === height * 16`. Each side grows by at most half a pixel, as plain rounding did.
 */
export function cropOutputSize(rect: Pick<CropRect, "width" | "height">, aspectRatio: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(rect.width, rect.height));
  const scaledWidth = rect.width * scale;
  const scaledHeight = rect.height * scale;
  const exact = EXACT_RATIOS.find(([across, down]) => Math.abs(aspectRatio - across / down) < 1e-9);
  if (!exact) return { width: Math.round(scaledWidth), height: Math.round(scaledHeight) };
  const [across, down] = exact;
  let multiple = Math.round(Math.min(scaledWidth / across, scaledHeight / down));
  if (across * multiple > scaledWidth + 0.5 || down * multiple > scaledHeight + 0.5) multiple -= 1;
  return { width: across * Math.max(0, multiple), height: down * Math.max(0, multiple) };
}
