import { Storage, type GenerateSignedPostPolicyV4Options } from "@google-cloud/storage";
import { storedMediaLocation, type ApiConfig } from "@dabboba/config";
import { SupabaseMediaStorage } from "@dabboba/media-storage";
import { AppError } from "./errors.js";
import type { MediaObject } from "./media-object.js";
export { validMediaObjectVersion } from "./media-object.js";
export type { MediaObject, MediaObjectInfo } from "./media-object.js";

type UploadInput = {
  key: string; mediaId: string; mimeType: string; byteSize: number; checksumSha256: string;
  expiresAt: Date; postPolicy: GenerateSignedPostPolicyV4Options;
};

export function configuredMediaStorage(config: ApiConfig, metadata?: unknown) {
  const location = metadata === undefined ? null : storedMediaLocation(metadata);
  const provider = location?.provider ?? config.mediaStorageProvider ?? "gcs";
  const bucket = location?.bucket ?? (provider === "supabase" ? config.supabaseStorage?.bucket : config.gcsBucket);
  const unavailable = () => new AppError(503, "MEDIA_NOT_CONFIGURED", "미디어 저장소가 구성되지 않았습니다.");
  if (!bucket) throw unavailable();
  // Never reinterpret a stored bucket as the newly configured bucket. An
  // operator must retain old credentials until the old media is migrated.
  if (provider === "supabase") {
    if (!config.supabaseStorage || bucket !== config.supabaseStorage.bucket) throw unavailable();
    const client = new SupabaseMediaStorage(config.supabaseStorage);
    return {
      provider, bucket,
      location: { provider, bucket },
      file(key: string): MediaObject {
        return {
          name: key,
          info: () => client.stat(key),
          read: (version) => client.read(key, version),
          delete: () => client.deleteObject(key),
        };
      },
      upload: (input: UploadInput) => client.createUpload(input),
      saveFinal: (key: string, data: Buffer, input: { mediaId: string; checksumSha256: string }) => client.writeFinal(key, data, input),
      signedRead: (key: string, version: string | null) => {
        if (!version) throw new AppError(502, "MEDIA_VERSION_MISSING", "첨부 파일의 저장 버전을 확인할 수 없습니다.");
        return client.signedRead(key, version, 300);
      },
    };
  }
  if (!config.gcsBucket || bucket !== config.gcsBucket) throw unavailable();
  const storage = new Storage(config.gcsProjectId ? { projectId: config.gcsProjectId } : {});
  const gcsBucket = storage.bucket(bucket);
  const file = (key: string): MediaObject => ({
    name: key,
    async info() {
      const [info] = await gcsBucket.file(key).getMetadata();
      return { version: String(info.generation ?? ""), size: Number(info.size), contentType: info.contentType ?? "", metadata: info.metadata ?? {} };
    },
    read: (version) => gcsBucket.file(key, { generation: version }).createReadStream(),
    async delete() { await gcsBucket.file(key).delete({ ignoreNotFound: true }); },
  });
  return {
    provider, bucket,
    location: { provider, bucket },
    file,
    async upload(input: UploadInput) {
      const [policy] = await gcsBucket.file(input.key).generateSignedPostPolicyV4(input.postPolicy);
      return { uploadUrl: policy.url, method: "POST" as const, fields: policy.fields, fileFieldName: "file" as const, expiresAt: input.expiresAt.toISOString(), maxBytes: input.byteSize };
    },
    async saveFinal(key: string, data: Buffer, input: { mediaId: string; checksumSha256: string }) {
      try {
        await gcsBucket.file(key).save(data, {
          contentType: "image/webp",
          metadata: {
            cacheControl: "private, max-age=31536000, immutable", contentDisposition: "inline", contentType: "image/webp",
            metadata: { sha256: input.checksumSha256, "media-id": input.mediaId, sanitized: "true" },
          },
          preconditionOpts: { ifGenerationMatch: 0 }, resumable: false, validation: "crc32c",
        });
      } catch (saveError) {
        // An earlier attempt may have committed the exact immutable object.
        // The caller still verifies all returned identity/size/hash metadata.
        try { return await file(key).info(); } catch { throw saveError; }
      }
      return file(key).info();
    },
    async signedRead(key: string, version: string | null) {
      const [url] = await gcsBucket.file(key, version === null ? undefined : { generation: version })
        .getSignedUrl({ version: "v4", action: "read", expires: new Date(Date.now() + 300_000) });
      return url;
    },
  };
}
