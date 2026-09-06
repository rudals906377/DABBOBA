type Environment = Record<string, string | undefined>;

/** Server-only. This object must never be serialized into logs or client config. */
export type SupabaseStorageConfiguration = {
  url: string;
  serviceKey: string;
  bucket: string;
  s3Endpoint: string;
  s3Region: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  allowLocalHttp?: boolean;
};

export type MediaStorageConfiguration = {
  mediaStorageProvider: "gcs" | "supabase";
  supabaseStorage: SupabaseStorageConfiguration | null;
};

const BUCKET = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const VERSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function required(env: Environment, key: string): string {
  const value = env[key]?.trim();
  if (!value || /[\r\n]/.test(value)) throw new Error(`Missing or invalid ${key}`);
  return value;
}

function endpoint(value: string, key: string, allowLocalHttp: boolean, originOnly: boolean): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`Invalid ${key}`); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(allowLocalHttp && local && url.protocol === "http:"))
    || url.username || url.password || url.search || url.hash
    || (originOnly && url.pathname !== "/")
  ) throw new Error(`Invalid ${key}: HTTPS without credentials or query is required`);
  return url.toString().replace(/\/$/, "");
}

export function loadMediaStorageConfig(env: Environment, runtime: "development" | "test" | "production"): MediaStorageConfiguration {
  const provider = env.MEDIA_STORAGE_PROVIDER?.trim() || "gcs";
  if (provider !== "gcs" && provider !== "supabase") throw new Error("MEDIA_STORAGE_PROVIDER must be gcs or supabase");
  const allowLocalHttp = env.SUPABASE_STORAGE_ALLOW_LOCAL_HTTP === "true";
  if (allowLocalHttp && runtime === "production") throw new Error("Local HTTP storage is forbidden in production");
  // A rollback may select GCS for new uploads while still serving existing
  // Supabase objects. Load a complete secondary configuration, never infer it
  // from the active default or silently fall back when part of it is missing.
  const anyStorageValue = Object.entries(env).some(([key, value]) => key.startsWith("SUPABASE_STORAGE_")
    && key !== "SUPABASE_STORAGE_ALLOW_LOCAL_HTTP" && Boolean(value?.trim()));
  if (provider === "gcs" && !anyStorageValue) return { mediaStorageProvider: provider, supabaseStorage: null };
  const bucket = required(env, "SUPABASE_STORAGE_BUCKET");
  if (!BUCKET.test(bucket)) throw new Error("Invalid SUPABASE_STORAGE_BUCKET");
  const serviceKey = required(env, "SUPABASE_STORAGE_SERVICE_KEY");
  if (serviceKey.startsWith("sb_publishable_")) throw new Error("Storage requires a server-only key, not a publishable key");
  const s3Region = required(env, "SUPABASE_STORAGE_S3_REGION");
  if (!/^[A-Za-z0-9-]{1,64}$/.test(s3Region)) throw new Error("Invalid SUPABASE_STORAGE_S3_REGION");
  return {
    mediaStorageProvider: provider,
    supabaseStorage: {
      url: endpoint(required(env, "SUPABASE_URL"), "SUPABASE_URL", allowLocalHttp, true),
      serviceKey,
      bucket,
      s3Endpoint: endpoint(required(env, "SUPABASE_STORAGE_S3_ENDPOINT"), "SUPABASE_STORAGE_S3_ENDPOINT", allowLocalHttp, false),
      s3Region,
      s3AccessKeyId: required(env, "SUPABASE_STORAGE_S3_ACCESS_KEY_ID"),
      s3SecretAccessKey: required(env, "SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY"),
      allowLocalHttp,
    },
  };
}

export type StoredMediaLocation = { provider: "gcs" | "supabase"; bucket: string | null; version: string | null };

/** Legacy rows belong to GCS even after the new-upload default changes. */
export function storedMediaLocation(metadata: unknown): StoredMediaLocation {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("Invalid stored media metadata");
  if (!("storage" in metadata)) return { provider: "gcs", bucket: null, version: null };
  const storage = (metadata as Record<string, unknown>).storage;
  if (!storage || typeof storage !== "object" || Array.isArray(storage)) throw new Error("Invalid stored media location");
  const { provider, bucket, version } = storage as Record<string, unknown>;
  if ((provider !== "gcs" && provider !== "supabase") || typeof bucket !== "string" || !BUCKET.test(bucket)) {
    throw new Error("Invalid stored media location");
  }
  if (version != null && (typeof version !== "string" || !(provider === "gcs" ? /^\d+$/.test(version) : VERSION.test(version)))) {
    throw new Error("Invalid stored media version");
  }
  return { provider, bucket, version: version as string | null | undefined ?? null };
}
