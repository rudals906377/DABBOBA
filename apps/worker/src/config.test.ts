import assert from "node:assert/strict";
import test from "node:test";
import { loadWorkerConfig } from "./config.js";

const base = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://worker:secret@127.0.0.1:5432/dabboba",
  REDIS_URL: "redis://127.0.0.1:6379/2",
};

test("loadWorkerConfig applies bounded operational defaults", () => {
  const config = loadWorkerConfig(base);
  assert.equal(config.queueName, "dabboba-worker");
  assert.equal(config.outboxBatchSize, 50);
  assert.equal(config.healthHost, "127.0.0.1");
  assert.equal(config.mediaCleanupMs, 60_000);
  assert.equal(config.mediaPendingTtlMinutes, 5);
  assert.equal(config.gcsBucket, null);
});

test("loadWorkerConfig rejects unsafe production boundaries", () => {
  assert.throws(() => loadWorkerConfig({ ...base, NODE_ENV: "production" }), /GCS_BUCKET/);
  assert.throws(
    () => loadWorkerConfig({ ...base, NODE_ENV: "production", GCS_BUCKET: "prod-media", NOTIFICATION_DELIVERY_URL: "http://notify.internal" }),
    /HTTPS/,
  );
});

test("loadWorkerConfig rejects queue names that collide with BullMQ key separators", () => {
  assert.throws(() => loadWorkerConfig({ ...base, WORKER_QUEUE_NAME: "dabboba:worker" }), /WORKER_QUEUE_NAME/);
});
