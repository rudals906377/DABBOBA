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
