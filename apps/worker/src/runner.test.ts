import assert from "node:assert/strict";
import test from "node:test";
import type { DatabasePool } from "@dabboba/db";
import { loadWorkerConfig } from "./config.js";
import { InicisInquiryPaymentProvider } from "./inicis-inquiry.js";
import { PortOneApiReconciliationProvider } from "./portone-api-requery.js";
import type { JobDependencies } from "./jobs.js";
import type { Logger } from "./logger.js";
import type { PgmqMessage } from "./pgmq.js";
import {
  consumeQueue,
  createPaymentReconciliationProvider,
  queueRetryDelaySeconds,
  runWorkerOnce,
  type WorkerRunOperations,
  type WorkerRunSummary,
} from "./runner.js";

test("pgmq retry delay is exponential, rounded up to seconds, and bounded", () => {
  assert.equal(queueRetryDelaySeconds(1, 100), 1);
  assert.equal(queueRetryDelaySeconds(5, 1_000), 16);
  assert.equal(queueRetryDelaySeconds(50, 1_000), 900);
});

test("configured KG INICIS reconciliation is wired into actual worker job dependencies", async () => {
  const config = loadWorkerConfig({
    NODE_ENV: "production",
    DABBOBA_ENVIRONMENT_TIER: "STAGING",
    WORKER_DATABASE_URL: "postgresql://worker:secret@127.0.0.1:5432/dabboba",
    GCS_BUCKET: "staging-media",
    PAYMENT_RECONCILIATION_PROVIDER: "KG_INICIS",
    KG_INICIS_ENVIRONMENT: "TEST",
    KG_INICIS_MID: "INIpayTest",
    KG_INICIS_INIAPI_KEY: "fixture-inicis-api-key",
    KG_INICIS_CLIENT_IP: "203.0.113.7",
  });
  const observedProviders: unknown[] = [];
  const pool = {
    async connect() {
      return {
        async query(sql: string) {
          return sql.includes("pg_try_advisory_lock")
            ? { rowCount: 1, rows: [{ locked: true }] }
            : { rowCount: 1, rows: [{ pg_advisory_unlock: true }] };
        },
        release() {},
      };
    },
    async end() {},
  } as unknown as DatabasePool;
  const logger = { debug() {}, info() {}, warn() {}, error() {} } as Logger;
  const operations: WorkerRunOperations = {
    async assertPgmqRuntime() { return "1.5.1"; },
    createPgmqOutboxPublisher() { return {} as never; },
    async dispatchOutboxBatch() { return { published: 0, deferred: 0, skipped: 0 }; },
    async consumeQueue() {},
    async processJob(dependencies) { observedProviders.push(dependencies.paymentProvider); },
  };

  await runWorkerOnce(config, logger, () => false, () => pool, operations);

  assert.equal(observedProviders.length, 5);
  assert.equal(observedProviders.every((provider) => provider instanceof InicisInquiryPaymentProvider), true);
  assert.ok(createPaymentReconciliationProvider(config) instanceof InicisInquiryPaymentProvider);
  assert.throws(
    () => createPaymentReconciliationProvider({ ...config, environmentTier: "TEST" }),
    /matching STAGING or PRODUCTION worker tier/,
  );
});

test("explicit PortOne API reconciliation is wired to the scheduled worker provider", () => {
  const config = loadWorkerConfig({
    NODE_ENV: "production",
    DABBOBA_ENVIRONMENT_TIER: "STAGING",
    WORKER_DATABASE_URL: "postgresql://worker:secret@127.0.0.1:5432/dabboba",
    GCS_BUCKET: "staging-media",
    PAYMENT_RECONCILIATION_PROVIDER: "PORTONE_API",
    PORTONE_RECONCILIATION_API_BASE_URL: "https://api.example.test/functions/v1/dabboba-api",
    PAYMENT_RECONCILIATION_WORKER_SECRET: "separate-worker-requery-secret-for-tests",
  });
  assert.ok(createPaymentReconciliationProvider(config) instanceof PortOneApiReconciliationProvider);
});

test("an overlapping scheduled execution exits successfully without doing worker work", async () => {
  const config = loadWorkerConfig({
    NODE_ENV: "test",
    WORKER_DATABASE_URL: "postgresql://worker:secret@127.0.0.1:5432/dabboba",
  });
  const queries: string[] = [];
  const infoMessages: string[] = [];
  let released = false;
  let poolEnded = false;
  const pool = {
    async connect() {
      return {
        async query(sql: string) {
          queries.push(sql);
          return { rowCount: 1, rows: [{ locked: false }] };
        },
        release() {
          released = true;
        },
      };
    },
    async end() {
      poolEnded = true;
    },
  } as unknown as DatabasePool;
  const logger: Logger = {
    debug() {},
    info(_fields, message) { infoMessages.push(message); },
    warn() {},
    error() {},
  };

  const summary = await runWorkerOnce(config, logger, () => false, () => pool);

  assert.equal(summary.status, "overlap_skipped");
  assert.deepEqual(queries, ["SELECT pg_try_advisory_lock($1::bigint) AS locked"]);
  assert.equal(released, true);
  assert.equal(poolEnded, true);
  assert.match(infoMessages.at(-1) || "", /exiting cleanly/);
});

test("a startup connection failure still closes the finite worker pool", async () => {
  const config = loadWorkerConfig({
    NODE_ENV: "test",
    WORKER_DATABASE_URL: "postgresql://worker:secret@127.0.0.1:5432/dabboba",
  });
  const connectionError = new Error("connection failed");
  let poolEnded = false;
  const pool = {
    async connect() { throw connectionError; },
    async end() { poolEnded = true; },
  } as unknown as DatabasePool;
  const logger = { debug() {}, info() {}, warn() {}, error() {} } as Logger;

  await assert.rejects(
    () => runWorkerOnce(config, logger, () => false, () => pool),
    (error) => error === connectionError,
  );
  assert.equal(poolEnded, true);
});

test("a productive run prioritizes lease-sensitive periodic work before queue consumption", async () => {
  const config = loadWorkerConfig({
    NODE_ENV: "test",
    WORKER_DATABASE_URL: "postgresql://worker:secret@127.0.0.1:5432/dabboba",
    WORKER_INVENTORY_STORAGE_EXPIRY_MODE: "ENABLED",
  });
  const trace: string[] = [];
  const pool = {
    async connect() {
      return {
        async query(sql: string) {
          return sql.includes("pg_try_advisory_lock")
            ? { rowCount: 1, rows: [{ locked: true }] }
            : { rowCount: 1, rows: [{ pg_advisory_unlock: true }] };
        },
        release() {},
      };
    },
    async end() {},
  } as unknown as DatabasePool;
  const logger = { debug() {}, info() {}, warn() {}, error() {} } as Logger;
  const operations: WorkerRunOperations = {
    async assertPgmqRuntime() {
      trace.push("acl");
      return "1.5.1";
    },
    createPgmqOutboxPublisher() {
      return {} as never;
    },
    async dispatchOutboxBatch() {
      trace.push("dispatch");
      return { published: 0, deferred: 0, skipped: 0 };
    },
    async consumeQueue() {
      trace.push("queue");
    },
    async processJob(_dependencies, raw) {
      trace.push(`periodic:${(raw as { kind: string }).kind}`);
    },
  };

  const summary = await runWorkerOnce(config, logger, () => false, () => pool, operations);

  assert.equal(summary.periodicCompleted, 6);
  assert.equal(summary.periodicFailed, 0);
  assert.deepEqual(trace.slice(0, 9), [
    "acl",
    "periodic:payment.reconcile",
    "periodic:reservation.sweep",
    "periodic:inventory.storage-expiry",
    "periodic:account-auth.cleanup",
    "periodic:media.cleanup",
    "periodic:retention.sweep",
    "dispatch",
    "queue",
  ]);
});

test("a failed periodic class does not starve later maintenance or one bounded queue pass", async () => {
  const config = loadWorkerConfig({
    NODE_ENV: "test",
    WORKER_DATABASE_URL: "postgresql://worker:secret@127.0.0.1:5432/dabboba",
    WORKER_INVENTORY_STORAGE_EXPIRY_MODE: "ENABLED",
  });
  const trace: string[] = [];
  const errors: Array<{ fields: Record<string, unknown>; message: string }> = [];
  let released = false;
  let poolEnded = false;
  const pool = {
    async connect() {
      return {
        async query(sql: string) {
          trace.push(sql.includes("pg_try_advisory_lock") ? "lock" : "unlock");
          return sql.includes("pg_try_advisory_lock")
            ? { rowCount: 1, rows: [{ locked: true }] }
            : { rowCount: 1, rows: [{ pg_advisory_unlock: true }] };
        },
        release() { released = true; },
      };
    },
    async end() { poolEnded = true; },
  } as unknown as DatabasePool;
  const logger: Logger = {
    debug() {},
    info() {},
    warn() {},
    error(fields, message) { errors.push({ fields, message }); },
  };
  const operations: WorkerRunOperations = {
    async assertPgmqRuntime() { return "1.5.1"; },
    createPgmqOutboxPublisher() { return {} as never; },
    async dispatchOutboxBatch() {
      trace.push("dispatch");
      return { published: 1, deferred: 0, skipped: 0 };
    },
    async consumeQueue(_pool, _dependencies, _config, summary) {
      trace.push("queue");
      summary.queueCompleted += 1;
    },
    async processJob(_dependencies, raw) {
      const kind = (raw as { kind: string }).kind;
      trace.push(`periodic:${kind}`);
      if (kind === "reservation.sweep") throw new Error("poison reservation row");
    },
  };

  await assert.rejects(
    () => runWorkerOnce(config, logger, () => false, () => pool, operations),
    /reservation\.sweep/,
  );

  assert.deepEqual(trace.slice(1, 10), [
    "periodic:payment.reconcile",
    "periodic:reservation.sweep",
    "periodic:inventory.storage-expiry",
    "periodic:account-auth.cleanup",
    "periodic:media.cleanup",
    "periodic:retention.sweep",
    "dispatch",
    "queue",
    "dispatch",
  ]);
  assert.equal(trace.filter((item) => item === "queue").length, 2);
  assert.equal(trace.at(-1), "unlock");
  assert.equal(released, true);
  assert.equal(poolEnded, true);
  assert.equal(errors.length, 2);
  assert.equal(errors[0]?.fields.periodicJobKind, "reservation.sweep");
  assert.match(errors[0]?.message ?? "", /failed; continuing/i);
  assert.match(errors[1]?.message ?? "", /failed after queue processing/i);
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
    periodicFailed: 0,
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
    periodicFailed: 0,
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
