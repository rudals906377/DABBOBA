import assert from "node:assert/strict";
import test from "node:test";
import type { WorkerConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { SupabaseOnlyMediaStore } from "./media-supabase.js";

const serviceKey = "server-only-storage-key-fixture";
const config: WorkerConfig = {
  environment: "production",
  environmentTier: "STAGING",
  databaseUrl: "postgresql://dabboba_worker.abcdefghijklmnopqrst:secret@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres",
  queueName: "dabboba_worker",
  outboxBatchSize: 10,
  paymentStaleMinutes: 10,
  mediaPendingTtlMinutes: 5,
  mediaRejectedTtlHours: 24,
  jobAttempts: 8,
  jobBackoffMs: 1_000,
  queueVisibilitySeconds: 900,
  maxMessagesPerRun: 10,
  maxRunSeconds: 45,
  databasePoolMax: 2,
  databaseOperationTimeoutMs: 30_000,
  gcsBucket: null,
  gcsProjectId: null,
  mediaStorageProvider: "supabase",
  supabaseStorage: {
    url: "https://abcdefghijklmnopqrst.supabase.co",
    serviceKey,
    bucket: "dabboba-media",
    s3Endpoint: "https://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/s3",
    s3Region: "ap-northeast-2",
    s3AccessKeyId: "storage-access-fixture",
    s3SecretAccessKey: "storage-secret-fixture",
  },
  supabaseAuthAdmin: {
    url: "https://abcdefghijklmnopqrst.supabase.co",
    secretKey: serviceKey,
  },
  notificationDeliveryUrl: null,
  notificationDeliveryToken: null,
  paymentReconciliation: { provider: "MANUAL_REVIEW" },
  logLevel: "info",
};

function logger(warnings: Array<Record<string, unknown>>): Logger {
  return {
    debug() {},
    info() {},
    warn(fields) { warnings.push(fields); },
    error() {},
  };
}

test("Supabase-only cleanup skips legacy GCS and a mismatched Supabase bucket without transport", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests += 1;
    return new Response(null, { status: 204 });
  });
  const warnings: Array<Record<string, unknown>> = [];
  const store = new SupabaseOnlyMediaStore(config, logger(warnings));
  const objectKey = `media/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/${"a".repeat(64)}.webp`;

  assert.equal(await store.deleteObject(objectKey, {}), "skipped");
  assert.equal(await store.deleteObject(objectKey, {
    storage: {
      provider: "supabase",
      bucket: "another-private-bucket",
      version: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    },
  }), "skipped");
  assert.equal(requests, 0);
  assert.equal(warnings.length, 2);
});

test("Supabase-only cleanup deletes the expected object with server authentication", async (t) => {
  const calls: Array<{
    url: string;
    method: string;
    authorization: string | null;
    apiKey: string | null;
    redirect: string;
  }> = [];
  t.mock.method(globalThis, "fetch", async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const request = new Request(input, init);
    calls.push({
      url: request.url,
      method: request.method,
      authorization: request.headers.get("authorization"),
      apiKey: request.headers.get("apikey"),
      redirect: request.redirect,
    });
    return new Response(null, { status: 204 });
  });
  const store = new SupabaseOnlyMediaStore(config, logger([]));
  const objectKey = `media/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/${"a".repeat(64)}.webp`;

  assert.equal(await store.deleteObject(objectKey, {
    storage: {
      provider: "supabase",
      bucket: "dabboba-media",
      version: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    },
  }), "deleted");
  assert.deepEqual(calls, [{
    url: `https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/dabboba-media/${objectKey}`,
    method: "DELETE",
    authorization: `Bearer ${serviceKey}`,
    apiKey: serviceKey,
    redirect: "error",
  }]);
});
