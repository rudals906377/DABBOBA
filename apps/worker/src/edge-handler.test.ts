import assert from "node:assert/strict";
import test from "node:test";
import type { WorkerConfig } from "./config.js";
import {
  createSupabaseEdgeWorkerHandler,
  normalizeSupabaseEdgeWorkerEnvironment,
  type EdgeWorkerEnvironment,
} from "./edge-handler.js";
import type { Logger } from "./logger.js";
import type { WorkerRunSummary } from "./runner-core.js";

const invokeSecret = "s".repeat(48);
const workerDatabaseUrl = "postgresql://dabboba_worker.abcdefghijklmnopqrst:secret@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres";

function sourceEnvironment(overrides: EdgeWorkerEnvironment = {}): EdgeWorkerEnvironment {
  return {
    DABBOBA_WORKER_INVOKE_SECRET: invokeSecret,
    DABBOBA_WORKER_DATABASE_URL: workerDatabaseUrl,
    DABBOBA_ENVIRONMENT_TIER: "STAGING",
    DABBOBA_ENABLE_PRODUCTION_WORKER: "true",
    SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    DABBOBA_STORAGE_BUCKET: "dabboba-media",
    DABBOBA_STORAGE_SERVICE_KEY: "server-only-storage-key-fixture",
    DABBOBA_STORAGE_S3_ENDPOINT: "https://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/s3",
    DABBOBA_STORAGE_S3_REGION: "ap-northeast-2",
    DABBOBA_STORAGE_S3_ACCESS_KEY_ID: "storage-access-fixture",
    DABBOBA_STORAGE_S3_SECRET_ACCESS_KEY: "storage-secret-fixture",
    SUPABASE_SERVICE_ROLE_KEY: "managed-fixture-service-role-key",
    ...overrides,
  };
}

function workerConfig(databaseUrl = workerDatabaseUrl): WorkerConfig {
  return {
    environment: "production",
    environmentTier: "STAGING",
    databaseUrl,
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
      serviceKey: "server-only-storage-key-fixture",
      bucket: "dabboba-media",
      s3Endpoint: "https://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/s3",
      s3Region: "ap-northeast-2",
      s3AccessKeyId: "storage-access-fixture",
      s3SecretAccessKey: "storage-secret-fixture",
    },
    supabaseAuthAdmin: {
      url: "https://abcdefghijklmnopqrst.supabase.co",
      secretKey: "managed-fixture-service-role-key",
    },
    notificationDeliveryUrl: null,
    notificationDeliveryToken: null,
    paymentReconciliation: { provider: "MANUAL_REVIEW" },
    logLevel: "info",
  };
}

function summary(status: WorkerRunSummary["status"] = "completed"): WorkerRunSummary {
  return {
    status,
    pgmqVersion: "1.5.1",
    outboxPublished: 1,
    outboxDeferred: 2,
    queueCompleted: 3,
    queueRetried: 4,
    queueDeadLettered: 5,
    periodicCompleted: 3,
    periodicFailed: 0,
  };
}

function authorizedRequest(method = "POST", token = invokeSecret): Request {
  return new Request("https://example.test/functions/v1/dabboba-worker", {
    method,
    headers: { authorization: `Bearer ${token}` },
  });
}

test("Edge worker rejects non-POST, missing/weak auth configuration, and bad tokens before config work", async () => {
  let configLoads = 0;
  let environmentReads = 0;
  let source = sourceEnvironment();
  const handler = createSupabaseEdgeWorkerHandler({
    readInvokeSecret: () => source.DABBOBA_WORKER_INVOKE_SECRET,
    readEnvironment: () => { environmentReads += 1; return source; },
    loadConfig() {
      configLoads += 1;
      return workerConfig();
    },
    runWorker: async () => summary(),
  });

  const get = await handler(authorizedRequest("GET"));
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST");

  source = sourceEnvironment({ DABBOBA_WORKER_INVOKE_SECRET: "weak" });
  const weak = await handler(authorizedRequest());
  assert.equal(weak.status, 503);
  assert.deepEqual(await weak.json(), { ok: false, code: "WORKER_AUTH_UNAVAILABLE" });

  for (const impossible of [" ".repeat(32), "한".repeat(32)]) {
    source = sourceEnvironment({ DABBOBA_WORKER_INVOKE_SECRET: impossible });
    const unavailable = await handler(authorizedRequest());
    assert.equal(unavailable.status, 503);
  }

  source = sourceEnvironment();
  const denied = await handler(authorizedRequest("POST", "x".repeat(48)));
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), { ok: false, code: "UNAUTHORIZED" });
  assert.equal(configLoads, 0);
  assert.equal(environmentReads, 0);
});

test("Edge worker turns secret/config environment access failures into fixed unavailable responses", async () => {
  const authFailure = createSupabaseEdgeWorkerHandler({
    readInvokeSecret() { throw new Error("private runtime auth failure"); },
    readEnvironment: sourceEnvironment,
  });
  const authResponse = await authFailure(authorizedRequest());
  assert.equal(authResponse.status, 503);
  assert.deepEqual(await authResponse.json(), { ok: false, code: "WORKER_AUTH_UNAVAILABLE" });

  const environmentFailure = createSupabaseEdgeWorkerHandler({
    readInvokeSecret: () => invokeSecret,
    readEnvironment() { throw new Error("private runtime environment failure"); },
  });
  const environmentResponse = await environmentFailure(authorizedRequest());
  assert.equal(environmentResponse.status, 503);
  assert.deepEqual(await environmentResponse.json(), { ok: false, code: "WORKER_CONFIG_UNAVAILABLE" });
});

test("Edge normalization maps only DABBOBA storage/database secrets after auth", () => {
  const source = sourceEnvironment({
    DABBOBA_WORKER_APPLE_CLIENT_ID: "com.dabboba.app",
    DABBOBA_WORKER_APPLE_CLIENT_SECRET: "signed-client-secret-value-that-is-long-enough",
    DABBOBA_WORKER_APPLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString("base64url"),
    DABBOBA_WORKER_APPLE_TOKEN_ENCRYPTION_KEY_VERSION: "1",
    DABBOBA_WORKER_EXPO_PUSH_ACCESS_TOKEN: "expo-server-access-token-for-tests",
    PAYMENT_RECONCILIATION_PROVIDER: "PORTONE_API",
    PORTONE_RECONCILIATION_API_BASE_URL: "https://api.example.test/functions/v1/dabboba-api",
    PAYMENT_RECONCILIATION_WORKER_SECRET: "worker-requery-secret-for-tests",
  });
  const normalized = normalizeSupabaseEdgeWorkerEnvironment(source);
  assert.equal(normalized.NODE_ENV, "production");
  assert.equal(normalized.MEDIA_STORAGE_PROVIDER, "supabase");
  assert.equal(normalized.WORKER_DATABASE_URL, workerDatabaseUrl);
  assert.equal(normalized.SUPABASE_STORAGE_BUCKET, source.DABBOBA_STORAGE_BUCKET);
  assert.equal(normalized.SUPABASE_STORAGE_SERVICE_KEY, source.DABBOBA_STORAGE_SERVICE_KEY);
  assert.equal(normalized.SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY, source.DABBOBA_STORAGE_S3_SECRET_ACCESS_KEY);
  assert.equal(normalized.SUPABASE_AUTH_ADMIN_SECRET_KEY, source.SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(normalized.APPLE_CLIENT_ID, "com.dabboba.app");
  assert.equal(normalized.APPLE_TOKEN_ENCRYPTION_KEY_VERSION, "1");
  assert.equal(normalized.EXPO_PUSH_ACCESS_TOKEN, "expo-server-access-token-for-tests");
  assert.equal(normalized.PAYMENT_RECONCILIATION_PROVIDER, "PORTONE_API");
  assert.equal(normalized.PAYMENT_RECONCILIATION_WORKER_SECRET, "worker-requery-secret-for-tests");
  assert.equal(normalized.DABBOBA_WORKER_INVOKE_SECRET, undefined);
  assert.equal(normalized.SUPABASE_DB_URL, undefined);

  for (const poisoned of [
    { WORKER_DATABASE_URL: workerDatabaseUrl },
    { GCS_BUCKET: "legacy-media" },
    { SUPABASE_STORAGE_SERVICE_KEY: "forbidden-reserved-prefix-secret" },
    { SUPABASE_STORAGE_ALLOW_LOCAL_HTTP: "true" },
    { MEDIA_STORAGE_PROVIDER: "gcs" },
    { NODE_ENV: "development" },
    { EXPO_PUSH_ACCESS_TOKEN: "forbidden-direct-expo-token" },
  ]) {
    assert.throws(
      () => normalizeSupabaseEdgeWorkerEnvironment(sourceEnvironment(poisoned)),
      (error) => error instanceof Error
        && !error.message.includes(workerDatabaseUrl)
        && !error.message.includes("forbidden-reserved-prefix-secret"),
    );
  }
});

test("Edge worker reuses the managed Supabase service role key without leaking it before auth", () => {
  const normalized = normalizeSupabaseEdgeWorkerEnvironment(sourceEnvironment({
    DABBOBA_STORAGE_SERVICE_KEY: undefined,
  }));
  assert.equal(normalized.SUPABASE_STORAGE_SERVICE_KEY, "managed-fixture-service-role-key");
  assert.equal(normalized.SUPABASE_AUTH_ADMIN_SECRET_KEY, "managed-fixture-service-role-key");
  assert.equal(normalized.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(normalized.DABBOBA_WORKER_INVOKE_SECRET, undefined);
});

test("authorized Edge worker loads the normalized hosted configuration", async () => {
  const loaded: WorkerConfig[] = [];
  const handler = createSupabaseEdgeWorkerHandler({
    readInvokeSecret: () => invokeSecret,
    readEnvironment: sourceEnvironment,
    async runWorker(config) {
      loaded.push(config);
      return summary();
    },
  });
  const response = await handler(authorizedRequest());
  assert.equal(response.status, 200);
  assert.equal(loaded[0]?.environment, "production");
  assert.equal(loaded[0]?.environmentTier, "STAGING");
  assert.equal(loaded[0]?.databaseUrl, workerDatabaseUrl);
  assert.equal(loaded[0]?.mediaStorageProvider, "supabase");
  assert.equal(loaded[0]?.gcsBucket, null);
});

test("authorized Edge worker awaits the finite batch and exposes only its bounded summary", async () => {
  let release: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  let runs = 0;
  const handler = createSupabaseEdgeWorkerHandler({
    readInvokeSecret: () => invokeSecret,
    readEnvironment: sourceEnvironment,
    loadConfig: () => workerConfig(),
    async runWorker() {
      const invocation = ++runs;
      if (invocation === 1) await waiting;
      return summary(invocation === 1 ? "completed" : "overlap_skipped");
    },
  });

  const first = handler(authorizedRequest());
  await Promise.resolve();
  const second = await handler(authorizedRequest());
  assert.equal(second.status, 200);
  assert.equal((await second.json() as { status: string }).status, "overlap_skipped");
  release?.();
  const completed = await first;
  assert.equal(completed.status, 200);
  assert.deepEqual(await completed.json(), { ok: true, ...summary("completed") });
  assert.equal(runs, 2);
});

test("Edge worker rejects owner-role and transaction-pooler URLs before starting the runner", async () => {
  let runs = 0;
  for (const databaseUrl of [
    "postgresql://postgres.abcdefghijklmnopqrst:secret@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres",
    "postgresql://dabboba_worker.abcdefghijklmnopqrst:secret@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres",
  ]) {
    const handler = createSupabaseEdgeWorkerHandler({
      readInvokeSecret: () => invokeSecret,
      readEnvironment: sourceEnvironment,
      loadConfig: () => workerConfig(databaseUrl),
      async runWorker() { runs += 1; return summary(); },
    });
    const response = await handler(authorizedRequest());
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { ok: false, code: "WORKER_EXECUTION_FAILED" });
  }
  assert.equal(runs, 0);
});

test("config and runner failures never expose credentials or provider error text", async () => {
  const rawFailure = `${invokeSecret}: provider response contained private data`;
  const logged: Array<Record<string, unknown>> = [];
  const logger: Logger = {
    debug() {},
    info() {},
    warn() {},
    error(fields) { logged.push(fields); },
  };
  const configFailure = createSupabaseEdgeWorkerHandler({
    readInvokeSecret: () => invokeSecret,
    readEnvironment: sourceEnvironment,
    loadConfig() { throw new Error(rawFailure); },
  });
  const configResponse = await configFailure(authorizedRequest());
  assert.equal(configResponse.status, 500);
  assert.doesNotMatch(await configResponse.text(), new RegExp(invokeSecret));

  const runFailure = createSupabaseEdgeWorkerHandler({
    readInvokeSecret: () => invokeSecret,
    readEnvironment: sourceEnvironment,
    loadConfig: () => workerConfig(),
    createLogger: () => logger,
    async runWorker() { throw new Error(rawFailure); },
  });
  const runResponse = await runFailure(authorizedRequest());
  assert.equal(runResponse.status, 500);
  assert.doesNotMatch(await runResponse.text(), /private data/);
  assert.deepEqual(logged, [{ errorName: "Error" }]);
});
