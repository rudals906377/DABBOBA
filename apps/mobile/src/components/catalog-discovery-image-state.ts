export const MIN_SAFE_COVER_VISIBLE_FRACTION = 0.8;

export function catalogArtworkVisibleFraction(
  width: number,
  height: number,
  targetAspectRatio: number,
): number {
  if (width <= 0 || height <= 0 || targetAspectRatio <= 0) return 0;
  const sourceAspectRatio = width / height;
  return Math.min(sourceAspectRatio, targetAspectRatio)
    / Math.max(sourceAspectRatio, targetAspectRatio);
}
