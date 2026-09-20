import assert from "node:assert/strict";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { AppError } from "./errors.js";
import { edgeMediaRuntime } from "./media-runtime-edge.js";
import { configuredSupabaseMediaStorage } from "./media-storage-supabase.js";

const config = {
  mediaStorageProvider: "supabase",
  gcsBucket: null,
  gcsProjectId: null,
  supabaseStorage: {
    url: "https://abcdefghijklmnopqrst.supabase.co",
    serviceKey: "fixture-server-storage-key",
    bucket: "dabboba-media",
    s3Endpoint: "https://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/s3",
    s3Region: "ap-northeast-2",
    s3AccessKeyId: "fixture-access-key",
    s3SecretAccessKey: "fixture-storage-secret",
  },
} as unknown as ApiConfig;

test("Edge media storage never reinterprets legacy GCS or a different Supabase bucket", () => {
  assert.throws(
    () => configuredSupabaseMediaStorage(config, {}),
    (error: unknown) => error instanceof AppError && error.code === "MEDIA_NOT_CONFIGURED" && error.statusCode === 503,
  );
  assert.throws(
    () => configuredSupabaseMediaStorage(config, { storage: { provider: "supabase", bucket: "other-media", version: null } }),
    (error: unknown) => error instanceof AppError && error.code === "MEDIA_NOT_CONFIGURED" && error.statusCode === 503,
  );
});

test("Edge media runtime advertises unavailable image completion and fails closed without Sharp", async () => {
  assert.equal(edgeMediaRuntime.completionAvailable, false);
  await assert.rejects(
    edgeMediaRuntime.sanitizeImage(Buffer.from("not-an-image"), "image/png"),
    (error: unknown) => error instanceof AppError && error.code === "MEDIA_PROCESSING_UNAVAILABLE" && error.statusCode === 503,
  );
});
