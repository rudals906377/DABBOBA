import { createHash } from "node:crypto";
import sharp from "sharp";
import { AppError } from "./errors.js";
import type { ApiImageMimeType, SanitizedImage } from "./media-runtime.js";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_INPUT_PIXELS = 16 * 1024 * 1024;
const MAX_INPUT_DIMENSION = 8_192;
const MAX_OUTPUT_DIMENSION = 4_096;

function mediaImageInvalid(message: string): AppError {
  return new AppError(400, "MEDIA_IMAGE_INVALID", message);
}

function expectedSharpFormat(mimeType: ApiImageMimeType): "jpeg" | "png" | "webp" | "gif" {
  if (mimeType === "image/jpeg") return "jpeg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "gif";
}

export async function sanitizeImage(
  input: Buffer,
  detectedMimeType: ApiImageMimeType,
): Promise<SanitizedImage> {
  try {
    const pipeline = sharp(input, {
      animated: false,
      failOn: "warning",
      limitInputChannels: 4,
      limitInputPixels: MAX_INPUT_PIXELS,
      pages: 1,
      sequentialRead: true,
    });
    const metadata = await pipeline.metadata();
    if (metadata.format !== expectedSharpFormat(detectedMimeType)) {
      throw mediaImageInvalid("이미지 디코더가 확인한 형식이 업로드 형식과 일치하지 않습니다.");
    }
    if (!metadata.width || !metadata.height) throw mediaImageInvalid("이미지 크기를 확인할 수 없습니다.");
    if (
      metadata.width > MAX_INPUT_DIMENSION
      || metadata.height > MAX_INPUT_DIMENSION
      || metadata.width * metadata.height > MAX_INPUT_PIXELS
    ) {
      throw mediaImageInvalid("이미지 해상도가 허용 범위를 초과합니다.");
    }
    const { data, info } = await pipeline
      .rotate()
      .resize({
        width: MAX_OUTPUT_DIMENSION,
        height: MAX_OUTPUT_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82, alphaQuality: 90, effort: 4, smartSubsample: true })
      .toBuffer({ resolveWithObject: true });
    if (!info.width || !info.height || info.width > MAX_OUTPUT_DIMENSION || info.height > MAX_OUTPUT_DIMENSION) {
      throw mediaImageInvalid("안전 이미지 변환 결과를 확인할 수 없습니다.");
    }
    if (data.length > MAX_UPLOAD_BYTES) throw mediaImageInvalid("변환된 이미지 크기가 허용 범위를 초과합니다.");
    return {
      data,
      mimeType: "image/webp",
      checksumSha256: createHash("sha256").update(data).digest("hex"),
      byteSize: data.length,
      width: info.width,
      height: info.height,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw mediaImageInvalid("이미지를 안전하게 처리할 수 없습니다.");
  }
}
