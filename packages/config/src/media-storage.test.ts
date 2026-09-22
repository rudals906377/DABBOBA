import assert from "node:assert/strict";
import test from "node:test";
import { loadMediaStorageConfig, storedMediaLocation } from "./media-storage.js";

const configured = {
  MEDIA_STORAGE_PROVIDER: "supabase",
  SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  SUPABASE_STORAGE_BUCKET: "private-media",
  SUPABASE_STORAGE_SERVICE_KEY: "server-only-test-key",
  SUPABASE_STORAGE_S3_ENDPOINT: "https://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/s3",
  SUPABASE_STORAGE_S3_REGION: "ap-northeast-2",
  SUPABASE_STORAGE_S3_ACCESS_KEY_ID: "local-test-access",
  SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY: "local-test-secret",
};

test("media provider selection is explicit and credentials are all-or-nothing", () => {
  assert.deepEqual(loadMediaStorageConfig({}, "test"), { mediaStorageProvider: "gcs", supabaseStorage: null });
  assert.equal(loadMediaStorageConfig(configured, "production").supabaseStorage?.bucket, "private-media");
  for (const key of Object.keys(configured).filter((key) => key !== "MEDIA_STORAGE_PROVIDER")) {
    assert.throws(() => loadMediaStorageConfig({ ...configured, [key]: undefined }, "production"));
  }
  assert.throws(() => loadMediaStorageConfig({ MEDIA_STORAGE_PROVIDER: "typo" }, "test"));
});

test("storage rejects unsafe endpoints without printing credentials", () => {
  for (const url of ["https://user:never-print-this@example.test", "http://example.test", "https://example.test/?key=never-print-this"]) {
    assert.throws(() => loadMediaStorageConfig({ ...configured, SUPABASE_URL: url }, "production"), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /never-print-this/);
      return true;
    });
  }
  assert.throws(() => loadMediaStorageConfig({ ...configured, SUPABASE_STORAGE_ALLOW_LOCAL_HTTP: "true" }, "production"));
  assert.doesNotThrow(() => loadMediaStorageConfig({
    ...configured, SUPABASE_URL: "http://127.0.0.1:54401",
    SUPABASE_STORAGE_S3_ENDPOINT: "http://127.0.0.1:54401/s3",
    SUPABASE_STORAGE_ALLOW_LOCAL_HTTP: "true",
  }, "test"));
});

test("stored object identity never follows the newly selected default provider", () => {
  assert.deepEqual(storedMediaLocation({}), { provider: "gcs", bucket: null, version: null });
  assert.deepEqual(storedMediaLocation({ storage: { provider: "supabase", bucket: "original", version: "17d0d9c2-fdc6-4fe3-9003-8ef8f90766f8" } }), {
    provider: "supabase", bucket: "original", version: "17d0d9c2-fdc6-4fe3-9003-8ef8f90766f8",
  });
  for (const storage of [null, {}, { provider: "unknown", bucket: "x" }, { provider: "supabase", bucket: "../other" }, { provider: "supabase", bucket: "x", version: "1?token=bad" }]) {
    assert.throws(() => storedMediaLocation({ storage }));
  }
});
