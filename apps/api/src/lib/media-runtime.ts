import type { ApiConfig } from "@dabboba/config";
import type { configuredMediaStorage } from "./media-storage.js";

export type ApiImageMimeType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export type SanitizedImage = {
  data: Buffer;
  mimeType: "image/webp";
  checksumSha256: string;
  byteSize: number;
  width: number;
  height: number;
};

export type ApiMediaStorage = ReturnType<typeof configuredMediaStorage>;

export type ApiMediaRuntime = {
  completionAvailable: boolean;
  configuredMediaStorage(config: ApiConfig, metadata?: unknown): ApiMediaStorage;
  sanitizeImage(input: Buffer, detectedMimeType: ApiImageMimeType): Promise<SanitizedImage>;
};
