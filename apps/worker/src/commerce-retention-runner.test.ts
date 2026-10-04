import assert from "node:assert/strict";
import test from "node:test";
import type { DatabasePool } from "@dabboba/db";
import { loadWorkerConfig } from "./config.js";
import { processWorkerJob } from "./jobs.js";
import type { Logger } from "./logger.js";
import { runWorkerOnce, type WorkerRunOperations } from "./runner.js";
import { parseWorkerJob } from "./types.js";

const logger = { debug() {}, info() {}, warn() {}, error() {} } as Logger;
const base = {
  NODE_ENV: "test",
  WORKER_DATABASE_URL: "postgresql://worker:secret@127.0.0.1:5432/dabboba",
};

function fixture(failCommerce = false) {
  const trace: string[] = [];
  const pool = {
    async connect() {
      return {
        async query(sql: string) { return { rows: [{ locked: sql.includes("pg_try_advisory_lock") }] }; },
        release() {},
      };
    },
    async end() {},
  } as unknown as DatabasePool;
  const operations: WorkerRunOperations = {
    async assertPgmqRuntime() { return "1.5.1"; },
    createPgmqOutboxPublisher() { return {} as never; },
    async dispatchOutboxBatch() { trace.push("dispatch"); return { published: 0, deferred: 0, skipped: 0 }; },
    async consumeQueue() { trace.push("queue"); },
    async processJob(_dependencies, raw) {
      const job = parseWorkerJob(raw);
      trace.push(job.kind);
      if (failCommerce && job.kind === "commerce.retention.sweep") throw new Error("fixture policy unavailable");
    },
  };
  return { trace, pool, operations };
}

test("disabled commerce disposal is not scheduled or invoked by a queued job", async () => {
  const config = loadWorkerConfig(base);
  const { trace, pool, operations } = fixture();
  const summary = await runWorkerOnce(config, logger, () => false, () => pool, operations);
  assert.equal(summary.periodicCompleted, 6);
  assert.equal(trace.includes("commerce.retention.sweep"), false);
  let connected = false;
  const result = await processWorkerJob({
    config, logger, pool: { async connect() { connected = true; throw new Error("must not access DB"); } } as unknown as DatabasePool,
  } as Parameters<typeof processWorkerJob>[0], { kind: "commerce.retention.sweep" });
  assert.deepEqual(result, { mode: "DISABLED", examined: 0, eligible: 0, disposed: 0, blocked: {} });
  assert.equal(connected, false);
});

for (const mode of ["PREVIEW", "EXECUTE"] as const) {
  test(`explicit ${mode} schedules bounded commerce disposal after ordinary retention`, async () => {
    const config = loadWorkerConfig({ ...base, WORKER_COMMERCE_RETENTION_MODE: mode });
    const { trace, pool, operations } = fixture();
    const summary = await runWorkerOnce(config, logger, () => false, () => pool, operations);
    assert.equal(summary.periodicCompleted, 7);
    assert.equal(trace.filter((kind) => kind === "commerce.retention.sweep").length, 1);
    assert.equal(trace.indexOf("commerce.retention.sweep"), trace.indexOf("retention.sweep") + 1);
    assert.ok(trace.indexOf("commerce.retention.sweep") < trace.indexOf("queue"));
  });
}

test("a commerce disposal failure still permits durable queue processing and fails the run for retry", async () => {
  const config = loadWorkerConfig({ ...base, WORKER_COMMERCE_RETENTION_MODE: "PREVIEW" });
  const { trace, pool, operations } = fixture(true);
  await assert.rejects(runWorkerOnce(config, logger, () => false, () => pool, operations), /commerce.retention.sweep/);
  assert.equal(trace.filter((kind) => kind === "queue").length, 2);
  assert.ok(trace.indexOf("queue") > trace.indexOf("commerce.retention.sweep"));
});
