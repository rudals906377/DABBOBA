import assert from "node:assert/strict";
import test from "node:test";
import type { DatabasePool } from "@dabboba/db";
import { DEFAULT_WORKER_RETENTION, loadWorkerConfig } from "./config.js";
import type { Logger } from "./logger.js";
import {
  DURABLE_IDEMPOTENCY_SCOPES,
  normalizeRetentionConfig,
  RETAINED_OUTBOX_EVENT_TYPES,
  RETENTION_SQL,
  runRetentionBatch,
} from "./retention.js";
import { parseWorkerJob } from "./types.js";

const logger = { debug() {}, info() {}, warn() {}, error() {} } as Logger;

test("retention config defaults keep the 30-day outbox window, the 90-day session window and outlive the Home popularity window", () => {
  const config = loadWorkerConfig({
    NODE_ENV: "test",
    WORKER_DATABASE_URL: "postgresql://worker:secret@127.0.0.1:5432/dabboba",
  });
  assert.deepEqual(config.retention, DEFAULT_WORKER_RETENTION);
  assert.throws(
    () => loadWorkerConfig({
      NODE_ENV: "test",
      WORKER_DATABASE_URL: "postgresql://worker:secret@127.0.0.1:5432/dabboba",
      WORKER_RETENTION_HOME_CLICK_DAYS: "30",
    }),
    /WORKER_RETENTION_HOME_CLICK_DAYS must be an integer between 31/,
  );
  assert.throws(
    () => loadWorkerConfig({
      NODE_ENV: "test",
      WORKER_DATABASE_URL: "postgresql://worker:secret@127.0.0.1:5432/dabboba",
      WORKER_RETENTION_OUTBOX_DAYS: "7",
    }),
    /WORKER_RETENTION_OUTBOX_DAYS/,
  );
  assert.throws(() => normalizeRetentionConfig({ ...DEFAULT_WORKER_RETENTION, homeClickRollupDays: 30 }), /Home click/);
  assert.throws(() => normalizeRetentionConfig({ ...DEFAULT_WORKER_RETENTION, batchSize: 0 }), /batch size/);
  assert.deepEqual(normalizeRetentionConfig(undefined), DEFAULT_WORKER_RETENTION);
  assert.deepEqual(parseWorkerJob({ kind: "retention.sweep" }), { kind: "retention.sweep" });
});

test("retention SQL preserves durable evidence and bounds every delete", () => {
  assert.deepEqual([...RETAINED_OUTBOX_EVENT_TYPES], ["payment.reservation_expired_requires_reconciliation"]);
  assert.deepEqual([...DURABLE_IDEMPOTENCY_SCOPES], ["CREATE_ORDER"]);
  for (const sql of Object.values(RETENTION_SQL)) assert.match(sql, /LIMIT \$[12]/);
  assert.match(RETENTION_SQL.outbox, /candidate\.published_at IS NOT NULL/);
  assert.match(RETENTION_SQL.outbox, /candidate\.event_type <> ALL\(\$3::text\[\]\)/);
  assert.match(RETENTION_SQL.outbox, /inventory_storage_expiry_events ledger\s+WHERE ledger\.outbox_event_id=candidate\.id/);
  assert.match(RETENTION_SQL.idempotency, /candidate\.scope <> ALL\(\$2::text\[\]\)/);
  assert.match(RETENTION_SQL.idempotency, /candidate\.expires_at <= now\(\)/);
  assert.match(RETENTION_SQL.sessions, /child\.rotated_from_session_id=candidate\.id/);
  assert.doesNotMatch(RETENTION_SQL.sessions, /token_digest|ip_address|user_agent/);
  assert.match(RETENTION_SQL.homeClickRollup, /DELETE FROM home_product_click_events/);
  assert.match(RETENTION_SQL.homeClickRollup, /INSERT INTO home_product_click_daily/);
  assert.match(
    RETENTION_SQL.homeClickRollup,
    /click_count=home_product_click_daily\.click_count\+EXCLUDED\.click_count/,
  );
});

test("retention batch runs each bounded step and flags only the Home rollup transaction", async () => {
  const calls: Array<{ via: "pool" | "client"; sql: string; params: unknown[] }> = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ via: "client", sql, params });
      if (sql.includes("home_product_click_daily")) return { rowCount: 1, rows: [{ deleted: "7", days: "2" }] };
      return { rowCount: null, rows: [] };
    },
    release() {},
  };
  const pool = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ via: "pool", sql, params });
      if (sql === RETENTION_SQL.outbox) return { rowCount: 3, rows: [] };
      if (sql === RETENTION_SQL.idempotency) return { rowCount: 4, rows: [] };
      if (sql === RETENTION_SQL.sessions) return { rowCount: 5, rows: [] };
      throw new Error(`unexpected pool query: ${sql}`);
    },
    async connect() { return client; },
  } as unknown as DatabasePool;

  const result = await runRetentionBatch(pool, { ...DEFAULT_WORKER_RETENTION, batchSize: 50 }, logger);

  assert.deepEqual(result, {
    outboxEventsDeleted: 3,
    idempotencyKeysDeleted: 4,
    sessionsDeleted: 5,
    homeClicksRolledUp: 7,
    homeClickDailyRowsTouched: 2,
  });
  assert.deepEqual(calls.map(({ via, sql }) => (
    sql === "BEGIN" || sql === "COMMIT" ? sql : sql.includes("set_config") ? "flag" : via
  )), ["pool", "pool", "pool", "BEGIN", "flag", "client", "COMMIT"]);
  assert.deepEqual(calls[0]?.params, [30, 50, ["payment.reservation_expired_requires_reconciliation"]]);
  assert.deepEqual(calls[1]?.params, [50, ["CREATE_ORDER"]]);
  assert.deepEqual(calls[2]?.params, [90, 50]);
  assert.match(calls[4]?.sql ?? "", /set_config\('dabboba\.home_click_rollup','on',true\)/);
  assert.deepEqual(calls[5]?.params, [35, 50, "Asia/Seoul"]);
});

test("retention stops between steps once the run deadline is reached", async () => {
  const seen: string[] = [];
  const pool = {
    async query(sql: string) {
      seen.push(sql);
      return { rowCount: 0, rows: [] };
    },
    async connect() { throw new Error("rollup must not start after the deadline"); },
  } as unknown as DatabasePool;
  let budget = 1;
  const result = await runRetentionBatch(pool, undefined, logger, () => budget-- > 0);
  assert.equal(seen.length, 1);
  assert.equal(result.outboxEventsDeleted, 0);
});
