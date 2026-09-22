import { storedMediaLocation, type ApiConfig } from "@dabboba/config";
import { SupabaseMediaStorage } from "@dabboba/media-storage";
import { AppError } from "./errors.js";
import type { ApiMediaStorage } from "./media-runtime.js";

function unavailable(): AppError {
  return new AppError(503, "MEDIA_NOT_CONFIGURED", "미디어 저장소가 구성되지 않았습니다.");
}

/** Edge-only storage factory. It cannot import or reinterpret legacy GCS media. */
export function configuredSupabaseMediaStorage(config: ApiConfig, metadata?: unknown): ApiMediaStorage {
  const location = metadata === undefined ? null : storedMediaLocation(metadata);
  const provider = location?.provider ?? config.mediaStorageProvider;
  const bucket = location?.bucket ?? config.supabaseStorage?.bucket;
  if (provider !== "supabase" || !config.supabaseStorage || bucket !== config.supabaseStorage.bucket) {
    throw unavailable();
  }
  const client = new SupabaseMediaStorage(config.supabaseStorage);
  return {
    provider: "supabase",
    bucket,
    location: { provider: "supabase", bucket },
    file(key: string) {
      return {
        name: key,
        info: () => client.stat(key),
        read: (version: string) => client.read(key, version),
        delete: () => client.deleteObject(key),
      };
    },
    upload: (input) => client.createUpload(input),
    saveFinal: (key, data, input) => client.writeFinal(key, data, input),
    signedRead: (key, version) => {
      if (!version) throw new AppError(502, "MEDIA_VERSION_MISSING", "첨부 파일의 저장 버전을 확인할 수 없습니다.");
      return client.signedS3Read(key, version, 300);
    },
  };
}
