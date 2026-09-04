import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { DatabaseClient, DatabasePool, Queryable } from "@dabboba/db";
import {
  assertPgmqRuntime,
  createPgmqOutboxPublisher,
  deadLetterPgmqMessage,
  deferPgmqMessage,
  deletePgmqMessage,
  readPgmqMessages,
} from "./pgmq.js";

test("pgmq runtime check fails closed when the migration is absent", async () => {
  const pool = {
    async query() {
      return {
        rowCount: 1,
        rows: [{
          extversion: null,
          has_required_api: false,
          has_required_privileges: false,
          has_exact_function_privileges: false,
          has_reconciliation_schedule: false,
        }],
      };
    },
  } as unknown as DatabasePool;
  await assert.rejects(() => assertPgmqRuntime(pool), /run the migration job first/);
});

test("pgmq runtime check rejects callable functions outside the exact worker allow-list", async () => {
  const pool = {
    async query(sql: string) {
      assert.match(sql, /has_exact_function_privileges/);
      assert.match(sql, /pg_proc/);
      return {
        rowCount: 1,
        rows: [{
          extversion: "1.5.1",
          has_required_api: true,
          has_required_privileges: true,
          has_exact_function_privileges: false,
          has_reconciliation_schedule: true,
        }],
      };
    },
  } as unknown as DatabasePool;

  await assert.rejects(() => assertPgmqRuntime(pool), /least-privilege runtime ACL/);
});

test("pgmq runtime check fails closed before the reconciliation schedule migration", async () => {
  const pool = {
    async query(sql: string) {
      assert.match(sql, /to_regclass\('public\.worker_payment_reconciliations'\)/);
      assert.match(sql, /has_reconciliation_schedule/);
      return {
        rowCount: 1,
        rows: [{
          extversion: "1.5.1",
          has_required_api: true,
          has_required_privileges: true,
          has_exact_function_privileges: true,
          has_reconciliation_schedule: false,
        }],
      };
    },
  } as unknown as DatabasePool;

  await assert.rejects(() => assertPgmqRuntime(pool), /run the migration job first/);
});

test("pgmq publisher uses the claimed transaction client and an explicit integer delay", async () => {
  const calls: Array<{ sql: string; values: unknown[] | undefined }> = [];
  const client = {
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      return { rowCount: 1, rows: [{ send: "1" }] };
    },
  } as unknown as DatabaseClient;
  const publisher = createPgmqOutboxPublisher("dabboba_worker");
  const job = { kind: "reservation.sweep" } as const;

  await publisher.add(client, "reservation.sweep", job, {
    jobId: "job-1",
    attempts: 8,
    backoff: { type: "exponential", delay: 1_000 },
  });

  assert.match(calls[0]!.sql, /\$1::text.*\$2::jsonb.*\$3::integer/);
  assert.deepEqual(calls[0]!.values, ["dabboba_worker", job, 0]);
});

test("pgmq consumer reads with visibility and count integer casts", async () => {
  const calls: Array<{ sql: string; values: unknown[] | undefined }> = [];
  const pool = {
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      return {
        rowCount: 1,
        rows: [{
          msg_id: "42",
          read_ct: 2,
          enqueued_at: new Date("2026-09-04T00:00:00.000Z"),
          vt: new Date("2026-09-04T00:10:00.000Z"),
          message: { kind: "reservation.sweep" },
        }],
      };
    },
  } as unknown as DatabasePool;

  const rows = await readPgmqMessages(pool, "dabboba_worker", 600, 10);
  assert.equal(rows[0]?.id, "42");
  assert.equal(rows[0]?.readCount, 2);
  assert.match(calls[0]!.sql, /pgmq\.read\(\$1::text, \$2::integer, \$3::integer\)/);
  assert.deepEqual(calls[0]!.values, ["dabboba_worker", 600, 10]);
});

test("pgmq acknowledgement and retry operations cast bigint and integer explicitly", async () => {
  const calls: Array<{ sql: string; values: unknown[] | undefined }> = [];
  const queryable = {
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      if (sql.includes("pgmq.delete")) return { rowCount: 1, rows: [{ deleted: true }] };
      return { rowCount: 1, rows: [{}] };
    },
  } as unknown as Queryable;

  assert.equal(await deletePgmqMessage(queryable, "dabboba_worker", "42"), true);
  await deferPgmqMessage(queryable, "dabboba_worker", "42", 16);
  assert.match(calls[0]!.sql, /\$2::bigint/);
  assert.match(calls[1]!.sql, /\$2::bigint.*\$3::integer/);
});

test("dead-letter insert and queue delete commit in one database transaction", async () => {
  const calls: string[] = [];
  const client = {
    async query(sql: string) {
      calls.push(sql);
      if (sql.includes("pgmq.delete")) return { rowCount: 1, rows: [{ deleted: true }] };
      return { rowCount: 1, rows: [] };
    },
    release() { calls.push("RELEASE CLIENT"); },
  };
  const pool = {
    async connect() { return client; },
  } as unknown as DatabasePool;

  await deadLetterPgmqMessage(pool, "dabboba_worker", {
    id: "42",
    readCount: 8,
    enqueuedAt: new Date("2026-09-04T00:00:00.000Z"),
    visibleAt: new Date("2026-09-04T00:10:00.000Z"),
    payload: { kind: "unsupported" },
  }, new Error("invalid job"));

  assert.equal(calls[0], "BEGIN");
  assert.match(calls[1]!, /INSERT INTO worker_dead_letters/);
  assert.match(calls[1]!, /ON CONFLICT DO NOTHING/);
  assert.doesNotMatch(calls[1]!, /ON CONFLICT \(/);
  assert.match(calls[2]!, /pgmq\.delete/);
  assert.equal(calls[3], "COMMIT");
  assert.equal(calls[4], "RELEASE CLIENT");
});

test("oversized poison payloads use a bounded forensic envelope before atomic deletion", async () => {
  const calls: Array<{ sql: string; values: unknown[] | undefined }> = [];
  const client = {
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      if (sql.includes("pgmq.delete")) return { rowCount: 1, rows: [{ deleted: true }] };
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  const pool = {
    async connect() { return client; },
  } as unknown as DatabasePool;
  const payload = {
    kind: "outbox.event" + "k".repeat(300),
    event: { id: "outbox-" + "i".repeat(300), payload: "x".repeat(1_048_576) },
  };
  const serialized = JSON.stringify(payload);

  await deadLetterPgmqMessage(pool, "dabboba_worker", {
    id: "43",
    readCount: 8,
    enqueuedAt: new Date("2026-09-04T00:00:00.000Z"),
    visibleAt: new Date("2026-09-04T00:10:00.000Z"),
    payload,
  }, new Error("invalid oversized job"));

  const insert = calls.find((call) => call.sql.includes("INSERT INTO worker_dead_letters"));
  assert.ok(insert?.values);
  const storedPayload = JSON.parse(insert.values[3] as string) as Record<string, unknown>;
  assert.deepEqual(storedPayload, {
    schema: "dabboba.dead-letter-payload/v1",
    omitted: true,
    reason: "payload_too_large",
    byteLength: Buffer.byteLength(serialized, "utf8"),
    sha256: createHash("sha256").update(serialized, "utf8").digest("hex"),
    kind: payload.kind.slice(0, 200),
    outboxEventId: payload.event.id.slice(0, 200),
  });
  assert.ok(Buffer.byteLength(insert.values[3] as string, "utf8") < 2_048);
  assert.equal(insert.values[6], insert.values[3]);
  assert.match(insert.sql, /octet_length\(\(\$4::jsonb\)::text\).*\$7::jsonb/s);
  assert.deepEqual(calls.map((call) => call.sql), [
    "BEGIN",
    insert.sql,
    calls[2]!.sql,
    "COMMIT",
  ]);
  assert.match(calls[2]!.sql, /pgmq\.delete/);
});

test("payload serialization failure still inserts a bounded forensic envelope", async () => {
  const calls: Array<{ sql: string; values: unknown[] | undefined }> = [];
  const client = {
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      if (sql.includes("pgmq.delete")) return { rowCount: 1, rows: [{ deleted: true }] };
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  const pool = {
    async connect() { return client; },
  } as unknown as DatabasePool;
  const circular: Record<string, unknown> = {
    kind: "outbox.event",
    event: { id: "outbox-circular" },
  };
  circular.self = circular;

  await deadLetterPgmqMessage(pool, "dabboba_worker", {
    id: "44",
    readCount: 8,
    enqueuedAt: new Date("2026-09-04T00:00:00.000Z"),
    visibleAt: new Date("2026-09-04T00:10:00.000Z"),
    payload: circular,
  }, new Error("invalid circular job"));

  const insert = calls.find((call) => call.sql.includes("INSERT INTO worker_dead_letters"));
  assert.ok(insert?.values);
  assert.deepEqual(JSON.parse(insert.values[3] as string), {
    schema: "dabboba.dead-letter-payload/v1",
    omitted: true,
    reason: "payload_serialization_failed",
    byteLength: null,
    sha256: null,
    kind: "outbox.event",
    outboxEventId: "outbox-circular",
  });
  assert.equal(insert.values[6], insert.values[3]);
});

test("dead-letter deletion failure rolls back the ledger insert", async () => {
  const calls: string[] = [];
  const client = {
    async query(sql: string) {
      calls.push(sql);
      if (sql.includes("pgmq.delete")) return { rowCount: 1, rows: [{ deleted: false }] };
      return { rowCount: 1, rows: [] };
    },
    release() { calls.push("RELEASE CLIENT"); },
  };
  const pool = {
    async connect() { return client; },
  } as unknown as DatabasePool;

  await assert.rejects(
    () => deadLetterPgmqMessage(pool, "dabboba_worker", {
      id: "45",
      readCount: 8,
      enqueuedAt: new Date("2026-09-04T00:00:00.000Z"),
      visibleAt: new Date("2026-09-04T00:10:00.000Z"),
      payload: { kind: "unsupported" },
    }, new Error("invalid job")),
    /disappeared before dead-letter commit/,
  );

  assert.deepEqual(calls.map((sql) => sql === "RELEASE CLIENT" ? sql : sql.split("\n")[0]), [
    "BEGIN",
    "INSERT INTO worker_dead_letters",
    "SELECT pgmq.delete($1::text, $2::bigint) AS deleted",
    "ROLLBACK",
    "RELEASE CLIENT",
  ]);
  assert.ok(!calls.includes("COMMIT"));
});
