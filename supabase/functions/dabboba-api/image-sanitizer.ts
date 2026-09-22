import {
  ImageMagick,
  initializeImageMagick,
  MagickFormat,
  MagickReadSettings,
  ResourceLimits,
} from "@imagemagick/magick-wasm";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

export type EdgeImageMimeType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export type EdgeSanitizedImage = {
  data: Buffer;
  mimeType: "image/webp";
  checksumSha256: string;
  byteSize: number;
  width: number;
  height: number;
};

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_INPUT_PIXELS = 16 * 1024 * 1024;
const MAX_INPUT_DIMENSION = 8_192;
const MAX_OUTPUT_DIMENSION = 4_096;

const wasmBytes = await Deno.readFile(
  new URL(import.meta.resolve("@imagemagick/magick-wasm/magick.wasm")),
);
await initializeImageMagick(wasmBytes);

// Bound decoder allocation before reading untrusted bytes. The API also checks
// declared and actual object size, but compressed image dimensions need their
// own pre-decode limits inside ImageMagick.
ResourceLimits.width = BigInt(MAX_INPUT_DIMENSION);
ResourceLimits.height = BigInt(MAX_INPUT_DIMENSION);
ResourceLimits.area = BigInt(MAX_INPUT_PIXELS);
// ImageMagick may need one additional internal list entry while decoding a
// single requested frame, so keep a strict bound without blocking valid input.
ResourceLimits.listLength = 2n;
ResourceLimits.maxProfileSize = 1_048_576n;

function expectedFormat(mimeType: EdgeImageMimeType) {
  if (mimeType === "image/jpeg") return MagickFormat.Jpeg;
  if (mimeType === "image/png") return MagickFormat.Png;
  if (mimeType === "image/webp") return MagickFormat.WebP;
  return MagickFormat.Gif;
}

function validDimensions(width: number, height: number): boolean {
  return Number.isSafeInteger(width)
    && Number.isSafeInteger(height)
    && width > 0
    && height > 0
    && width <= MAX_INPUT_DIMENSION
    && height <= MAX_INPUT_DIMENSION
    && width * height <= MAX_INPUT_PIXELS;
}

export async function sanitizeEdgeImage(
  input: Buffer,
  detectedMimeType: EdgeImageMimeType,
): Promise<EdgeSanitizedImage> {
  if (!Buffer.isBuffer(input) || input.length < 1 || input.length > MAX_UPLOAD_BYTES) {
    throw new Error("invalid-image-size");
  }
  const settings = new MagickReadSettings();
  settings.frameCount = 1;
  settings.frameIndex = 0;
  const converted = ImageMagick.read(input, settings, (image) => {
    if (image.format !== expectedFormat(detectedMimeType)) throw new Error("image-format-mismatch");
    if (!validDimensions(image.width, image.height)) throw new Error("invalid-image-dimensions");
    image.autoOrient();
    if (!validDimensions(image.width, image.height)) throw new Error("invalid-oriented-dimensions");
    const scale = Math.min(1, MAX_OUTPUT_DIMENSION / image.width, MAX_OUTPUT_DIMENSION / image.height);
    if (scale < 1) {
      image.resize(
        Math.max(1, Math.floor(image.width * scale)),
        Math.max(1, Math.floor(image.height * scale)),
      );
    }
    image.strip();
    image.quality = 82;
    const width = image.width;
    const height = image.height;
    const data = Buffer.from(image.write(MagickFormat.WebP, (bytes) => Uint8Array.from(bytes)));
    return { data, width, height };
  });
  if (
    !validDimensions(converted.width, converted.height)
    || converted.width > MAX_OUTPUT_DIMENSION
    || converted.height > MAX_OUTPUT_DIMENSION
    || converted.data.length < 1
    || converted.data.length > MAX_UPLOAD_BYTES
  ) throw new Error("invalid-image-output");
  return {
    data: converted.data,
    mimeType: "image/webp",
    checksumSha256: createHash("sha256").update(converted.data).digest("hex"),
    byteSize: converted.data.length,
    width: converted.width,
    height: converted.height,
  };
}
