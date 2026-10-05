import assert from "node:assert/strict";
import test from "node:test";
import type { DatabasePool } from "@dabboba/db";
import type { Logger } from "./logger.js";
import {
  DEFAULT_COMMERCE_RETENTION,
  normalizeCommerceRetentionConfig,
  runCommerceRetentionBatch,
} from "./commerce-retention.js";

const logger = { debug() {}, info() {}, warn() {}, error() {} } as Logger;

test("commerce disposal defaults off without opening a database connection", async () => {
  const pool = { connect() { throw new Error("disabled must not connect"); } } as unknown as DatabasePool;
  assert.deepEqual(DEFAULT_COMMERCE_RETENTION, { mode: "DISABLED", batchSize: 25 });
  assert.deepEqual(await runCommerceRetentionBatch(pool, undefined, logger), {
    mode: "DISABLED", examined: 0, eligible: 0, disposed: 0, blocked: {},
  });
});

test("commerce mode and batch limits fail closed for invalid configuration", () => {
  for (const mode of ["execute", "DELETE", "", true, null]) {
    assert.throws(() => normalizeCommerceRetentionConfig({ mode, batchSize: 25 } as never), /mode/);
  }
  for (const batchSize of [0, 101, 1.5, NaN, Infinity]) {
    assert.throws(() => normalizeCommerceRetentionConfig({ mode: "PREVIEW", batchSize }), /batch/);
  }
});

test("preview opens a read-only transaction and returns counts without record identifiers or PII", async () => {
  const calls: string[] = [];
  const rows = [
    { blocker: null },
    { blocker: "LEGAL_HOLD" },
    { blocker: "LEGAL_HOLD" },
    { blocker: "POLICY_MISSING" },
  ];
  const pool = {
    async connect() {
      return {
        async query(sql: string, params?: unknown[]) {
          calls.push(sql);
          if (sql.includes("preview_commerce_retention")) {
            assert.deepEqual(params, [10]);
            return { rows };
          }
          return { rows: [] };
        },
        release() { calls.push("RELEASE"); },
      };
    },
  } as unknown as DatabasePool;
  const result = await runCommerceRetentionBatch(pool, { mode: "PREVIEW", batchSize: 10 }, logger);
  assert.deepEqual(result, {
    mode: "PREVIEW", examined: 4, eligible: 1, disposed: 0,
    blocked: { LEGAL_HOLD: 2, POLICY_MISSING: 1 },
  });
  assert.equal(calls[0], "BEGIN READ ONLY");
  assert.equal(calls.at(-2), "COMMIT");
  assert.ok(calls.every(sql => !/INSERT|UPDATE|DELETE|set_config/i.test(sql)));
});

test("execute delegates to the guarded bounded database operation", async () => {
  const calls: string[] = [];
  const pool = {
    async connect() {
      return {
        async query(sql: string, params?: unknown[]) {
          calls.push(sql);
          if (sql.includes("execute_commerce_retention")) {
            assert.deepEqual(params, [3]);
            return { rows: [{ disposed: "2" }] };
          }
          if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
          return { rows: [] };
        },
        release(destroy?: boolean) { calls.push(destroy ? "DESTROY" : "RELEASE"); },
      };
    },
  } as unknown as DatabasePool;
  assert.deepEqual(await runCommerceRetentionBatch(pool, { mode: "EXECUTE", batchSize: 3 }, logger), {
    mode: "EXECUTE", examined: 2, eligible: 2, disposed: 2, blocked: {},
  });
  // The registry lock is held before the snapshot and released before the
  // connection returns to the pool.
  assert.equal(calls[0], "SELECT pg_try_advisory_lock($1::bigint) AS locked");
  assert.equal(calls[1], "BEGIN ISOLATION LEVEL SERIALIZABLE");
  assert.ok(calls.some(sql => /set_config\('dabboba\.commerce_retention_execute','on',true\)/.test(sql)));
  assert.deepEqual(calls.slice(-3), ["COMMIT", "SELECT pg_advisory_unlock($1::bigint)", "RELEASE"]);
});

test("execute defers without a snapshot while a registry change holds the lock", async () => {
  const calls: string[] = [];
  const pool = {
    async connect() {
      return {
        async query(sql: string) {
          calls.push(sql);
          return { rows: sql.includes("pg_try_advisory_lock") ? [{ locked: false }] : [] };
        },
        release() { calls.push("RELEASE"); },
      };
    },
  } as unknown as DatabasePool;
  assert.equal((await runCommerceRetentionBatch(pool, { mode: "EXECUTE", batchSize: 3 }, logger)).disposed, 0);
  assert.deepEqual(calls, ["SELECT pg_try_advisory_lock($1::bigint) AS locked", "RELEASE"]);
});

test("a connection that cannot release the registry lock is destroyed, not pooled", async () => {
  let released: boolean | undefined;
  const pool = {
    async connect() {
      return {
        async query(sql: string) {
          if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
          if (sql.includes("execute_commerce_retention")) return { rows: [{ disposed: 0 }] };
          if (sql.includes("pg_advisory_unlock")) throw new Error("connection lost");
          return { rows: [] };
        },
        release(destroy?: boolean) { released = destroy === true; },
      };
    },
  } as unknown as DatabasePool;
  assert.equal((await runCommerceRetentionBatch(pool, { mode: "EXECUTE", batchSize: 3 }, logger)).disposed, 0);
  assert.equal(released, true);
});

test("deadline prevents even an enabled sweep from opening a connection", async () => {
  const pool = { connect() { throw new Error("deadline must not connect"); } } as unknown as DatabasePool;
  assert.equal((await runCommerceRetentionBatch(pool, { mode: "EXECUTE", batchSize: 25 }, logger, () => false)).disposed, 0);
});

test("query failure rolls back and releases; raw database errors are never logged", async () => {
  const calls: string[] = [];
  const logs: unknown[] = [];
  const unsafe = new Error("recipient name and phone must not reach a log");
  const pool = {
    async connect() {
      return {
        async query(sql: string) {
          calls.push(sql);
          if (sql.includes("preview_commerce_retention")) throw unsafe;
          return { rows: [] };
        },
        release() { calls.push("RELEASE"); },
      };
    },
  } as unknown as DatabasePool;
  const capture = { ...logger, info(fields: unknown) { logs.push(fields); } };
  await assert.rejects(runCommerceRetentionBatch(pool, { mode: "PREVIEW", batchSize: 25 }, capture), error => error === unsafe);
  assert.equal(calls.at(-2), "ROLLBACK");
  assert.equal(calls.at(-1), "RELEASE");
  assert.deepEqual(logs, []);
});

test("unexpected database blocker and invalid counts cannot become reported success", async () => {
  for (const rows of [[{ blocker: "recipient@example.test" }], [{ disposed: "NaN" }], [{ disposed: "101" }]]) {
    const pool = {
      async connect() {
        return { async query(sql: string) {
          if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
          return { rows: sql.includes("commerce_retention($1)") ? rows : [] };
        }, release() {} };
      },
    } as unknown as DatabasePool;
    const mode = "blocker" in rows[0]! ? "PREVIEW" : "EXECUTE";
    await assert.rejects(runCommerceRetentionBatch(pool, { mode, batchSize: 25 }, logger), /invalid|unexpected/i);
  }
});
