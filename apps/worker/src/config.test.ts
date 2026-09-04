import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOUD_RUN_TASK_TIMEOUT_SECONDS,
  loadWorkerConfig,
  MAX_WORKER_RUN_SECONDS,
  MIN_QUEUE_VISIBILITY_SECONDS,
  QUEUE_VISIBILITY_SAFETY_MARGIN_SECONDS,
} from "./config.js";

const base = {
  NODE_ENV: "test",
  WORKER_DATABASE_URL: "postgresql://worker:secret@127.0.0.1:5432/dabboba",
};

test("loadWorkerConfig applies bounded operational defaults", () => {
  const config = loadWorkerConfig(base);
  assert.equal(config.queueName, "dabboba_worker");
  assert.equal(config.outboxBatchSize, 50);
  assert.equal(config.queueVisibilitySeconds, 900);
  assert.equal(config.maxRunSeconds, 240);
  assert.equal(config.maxMessagesPerRun, 100);
  assert.equal(config.databasePoolMax, 3);
  assert.equal(config.databaseOperationTimeoutMs, 30_000);
  assert.equal(config.mediaPendingTtlMinutes, 5);
  assert.equal(config.gcsBucket, null);
});

test("loadWorkerConfig bounds each database operation below the shutdown margin", () => {
  assert.throws(() => loadWorkerConfig({
    ...base,
    WORKER_DATABASE_OPERATION_TIMEOUT_MS: "30001",
  }), /WORKER_DATABASE_OPERATION_TIMEOUT_MS/);
  assert.equal(loadWorkerConfig({
    ...base,
    WORKER_DATABASE_OPERATION_TIMEOUT_MS: "1000",
  }).databaseOperationTimeoutMs, 1_000);
});

test("loadWorkerConfig requires a worker-specific database URL", () => {
  assert.throws(() => loadWorkerConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://api:secret@127.0.0.1:5432/dabboba",
  }), /WORKER_DATABASE_URL/);
});

test("loadWorkerConfig rejects unsafe production boundaries", () => {
  assert.throws(() => loadWorkerConfig({ ...base, NODE_ENV: "production" }), /GCS_BUCKET/);
  assert.throws(
    () => loadWorkerConfig({
      ...base,
      NODE_ENV: "production",
      GCS_BUCKET: "prod-media",
      NOTIFICATION_DELIVERY_URL: "https://notify.example.test/deliver",
    }),
    /disabled in production until receiver-enforced idempotency/,
  );
});

test("loadWorkerConfig allows HTTP notification delivery outside production", () => {
  for (const environment of ["development", "test"]) {
    const config = loadWorkerConfig({
      ...base,
      NODE_ENV: environment,
      NOTIFICATION_DELIVERY_URL: "http://127.0.0.1:8787/deliver",
    });
    assert.equal(config.notificationDeliveryUrl, "http://127.0.0.1:8787/deliver");
  }
});

test("loadWorkerConfig pins the queue name to its least-privilege database ACL", () => {
  assert.throws(() => loadWorkerConfig({ ...base, WORKER_QUEUE_NAME: "dabboba:worker" }), /WORKER_QUEUE_NAME/);
  assert.throws(() => loadWorkerConfig({ ...base, WORKER_QUEUE_NAME: "Dabboba_worker" }), /WORKER_QUEUE_NAME/);
  assert.throws(() => loadWorkerConfig({ ...base, WORKER_QUEUE_NAME: "x".repeat(48) }), /WORKER_QUEUE_NAME/);
});

test("loadWorkerConfig keeps visibility beyond the Cloud Run task timeout and safety margin", () => {
  assert.equal(
    MIN_QUEUE_VISIBILITY_SECONDS,
    CLOUD_RUN_TASK_TIMEOUT_SECONDS + QUEUE_VISIBILITY_SAFETY_MARGIN_SECONDS,
  );
  assert.throws(
    () => loadWorkerConfig({
      ...base,
      WORKER_QUEUE_VISIBILITY_SECONDS: String(MIN_QUEUE_VISIBILITY_SECONDS - 1),
    }),
    /Cloud Run task timeout plus .* safety margin/,
  );
  assert.equal(
    loadWorkerConfig({
      ...base,
      WORKER_QUEUE_VISIBILITY_SECONDS: String(MIN_QUEUE_VISIBILITY_SECONDS),
    }).queueVisibilitySeconds,
    MIN_QUEUE_VISIBILITY_SECONDS,
  );
});

test("loadWorkerConfig reserves shutdown time inside the Cloud Run task timeout", () => {
  assert.equal(MAX_WORKER_RUN_SECONDS, 240);
  assert.ok(MAX_WORKER_RUN_SECONDS < CLOUD_RUN_TASK_TIMEOUT_SECONDS);
  assert.throws(
    () => loadWorkerConfig({
      ...base,
      WORKER_MAX_RUN_SECONDS: String(MAX_WORKER_RUN_SECONDS + 1),
    }),
    /WORKER_MAX_RUN_SECONDS must be an integer between/,
  );
});
