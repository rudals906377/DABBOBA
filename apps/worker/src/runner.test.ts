import assert from "node:assert/strict";
import test from "node:test";
import type { DatabasePool } from "@dabboba/db";
import { loadWorkerConfig } from "./config.js";
import type { JobDependencies } from "./jobs.js";
import type { Logger } from "./logger.js";
import type { PgmqMessage } from "./pgmq.js";
import { consumeQueue, queueRetryDelaySeconds, type WorkerRunSummary } from "./runner.js";

test("pgmq retry delay is exponential, rounded up to seconds, and bounded", () => {
  assert.equal(queueRetryDelaySeconds(1, 100), 1);
  assert.equal(queueRetryDelaySeconds(5, 1_000), 16);
  assert.equal(queueRetryDelaySeconds(50, 1_000), 900);
});

test("one execution does not process a deferred pgmq message ID twice", async () => {
  const config = loadWorkerConfig({
    NODE_ENV: "test",
    WORKER_DATABASE_URL: "postgresql://worker:secret@127.0.0.1:5432/dabboba",
  });
  const warnings: string[] = [];
  const logger: Logger = {
    debug() {},
    info() {},
    warn(_fields, message) { warnings.push(message); },
    error() {},
  };
  const summary: WorkerRunSummary = {
    status: "completed",
    pgmqVersion: "1.5.1",
    outboxPublished: 0,
    outboxDeferred: 0,
    queueCompleted: 0,
    queueRetried: 0,
    queueDeadLettered: 0,
    periodicCompleted: 0,
  };
  const firstRead: PgmqMessage = {
    id: "42",
    readCount: 1,
    enqueuedAt: new Date("2026-09-04T00:00:00.000Z"),
    visibleAt: new Date("2026-09-04T00:15:00.000Z"),
    payload: { kind: "reservation.sweep" },
  };
  let reads = 0;
  let processed = 0;
  let deleted = 0;
  const readQuantities: number[] = [];
  const deferred: Array<{ id: string; delaySeconds: number }> = [];
  const seenMessageIds = new Set<string>();
  const deadline = Date.now() + 120_000;

  await consumeQueue(
    {} as DatabasePool,
    { logger } as JobDependencies,
    config,
    summary,
    seenMessageIds,
    deadline,
    () => false,
    {
      async readMessages(_pool, _queueName, _visibilitySeconds, quantity) {
        reads += 1;
        readQuantities.push(quantity);
        return reads === 1 ? [firstRead] : [{ ...firstRead, readCount: 2 }];
      },
      async processJob() {
        processed += 1;
        throw new Error("queue unavailable");
      },
      async deleteMessage() {
        deleted += 1;
        return true;
      },
      async deferMessage(_pool, _queueName, messageId, delaySeconds) {
        deferred.push({ id: messageId, delaySeconds });
      },
      async deadLetterMessage() {
        throw new Error("unexpected dead-letter operation");
      },
    },
  );

  assert.equal(reads, 2);
  assert.deepEqual(readQuantities, [1, 1]);
  assert.equal(processed, 1);
  assert.equal(deleted, 0);
  assert.equal(deferred[0]?.id, "42");
  assert.ok((deferred[0]?.delaySeconds ?? 0) >= 119);
  assert.deepEqual([...seenMessageIds], ["42"]);
  assert.equal(summary.queueRetried, 1);
  assert.match(warnings.at(-1) || "", /leaving its refreshed visibility for a future execution/);
});

test("stopping after one handler never claims an unprocessed tail message", async () => {
  const config = loadWorkerConfig({
    NODE_ENV: "test",
    WORKER_DATABASE_URL: "postgresql://worker:secret@127.0.0.1:5432/dabboba",
  });
  const summary: WorkerRunSummary = {
    status: "completed",
    pgmqVersion: "1.5.1",
    outboxPublished: 0,
    outboxDeferred: 0,
    queueCompleted: 0,
    queueRetried: 0,
    queueDeadLettered: 0,
    periodicCompleted: 0,
  };
  const logger = { debug() {}, info() {}, warn() {}, error() {} } as Logger;
  let stopped = false;
  let reads = 0;
  const quantities: number[] = [];

  await consumeQueue(
    {} as DatabasePool,
    { logger } as JobDependencies,
    config,
    summary,
    new Set<string>(),
    Date.now() + 10_000,
    () => stopped,
    {
      async readMessages(_pool, _queueName, _visibilitySeconds, quantity) {
        reads += 1;
        quantities.push(quantity);
        return [{
          id: String(reads),
          readCount: 1,
          enqueuedAt: new Date(),
          visibleAt: new Date(),
          payload: { kind: "reservation.sweep" },
        }];
      },
      async processJob() { stopped = true; },
      async deleteMessage() { return true; },
      async deferMessage() { throw new Error("unexpected defer"); },
      async deadLetterMessage() { throw new Error("unexpected dead letter"); },
    },
  );

  assert.equal(reads, 1);
  assert.deepEqual(quantities, [1]);
  assert.equal(summary.queueCompleted, 1);
});
