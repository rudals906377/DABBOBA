export function resolveTwoColumnProductCardWidth({
  viewportWidth,
  horizontalSafeArea = 0,
  horizontalGutter,
  columnGap,
}: {
  viewportWidth: number;
  horizontalSafeArea?: number;
  horizontalGutter: number;
  columnGap: number;
}): number {
  const safeViewportWidth = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0;
  const safeArea = Number.isFinite(horizontalSafeArea) ? Math.max(0, horizontalSafeArea) : 0;
  const gutter = Number.isFinite(horizontalGutter) ? Math.max(0, horizontalGutter) : 0;
  const gap = Number.isFinite(columnGap) ? Math.max(0, columnGap) : 0;
  const availableWidth = Math.max(0, safeViewportWidth - safeArea - (gutter * 2));

  return Math.max(0, (availableWidth - gap) / 2);
}
