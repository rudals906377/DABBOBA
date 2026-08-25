import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseClient } from "@dabboba/db";
import { outboxRetryDelayMs, publishClaimedOutboxEvent, type OutboxPublisher } from "./outbox.js";

const row = {
  id: "61d9ade2-3e4d-433f-a8e4-46edaa54e337",
  aggregate_type: "ORDER",
  aggregate_id: "50c663bd-250f-45e7-a37a-2c3550afaf9c",
  event_type: "order.paid",
  payload: { userId: "a472f9d7-244f-47eb-9b99-51255bf8c325" },
  correlation_id: "request-1",
  attempts: 0,
  created_at: new Date("2026-08-24T00:00:00.000Z"),
};

function fakeClient(attempt = 1) {
  const calls: Array<{ sql: string; values: unknown[] | undefined }> = [];
  const client = {
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      if (sql.startsWith("UPDATE outbox_events SET attempts")) return { rowCount: 1, rows: [{ attempts: attempt }] };
      return { rowCount: 1, rows: [] };
    },
  } as unknown as DatabaseClient;
  return { client, calls };
}

test("outbox is marked published only after BullMQ accepts the stable job id", async () => {
  const { client, calls } = fakeClient();
  const published: Array<{ name: string; data: unknown; options: unknown }> = [];
  const publisher: OutboxPublisher = {
    async add(name, data, options) {
      published.push({ name, data, options });
      return {};
    },
  };

  const outcome = await publishClaimedOutboxEvent(client, publisher, row, { jobAttempts: 8, jobBackoffMs: 1_000 });
  assert.equal(outcome, "published");
  assert.equal(published[0]!.name, "outbox.event");
  assert.equal((published[0]!.options as { jobId: string }).jobId, `outbox-${row.id}`);
  assert.match(calls[1]!.sql, /published_at/);
  assert.equal(calls.some((call) => call.sql.includes("available_at=$2")), false);
});

test("queue failure keeps the event unpublished and schedules a bounded retry", async () => {
  const { client, calls } = fakeClient(4);
  const publisher: OutboxPublisher = { async add() { throw new Error("redis unavailable"); } };
  const now = new Date("2026-08-24T00:00:00.000Z");

  const outcome = await publishClaimedOutboxEvent(client, publisher, row, { jobAttempts: 8, jobBackoffMs: 1_000 }, now);
  assert.equal(outcome, "deferred");
  const retry = calls.at(-1)!;
  assert.match(retry.sql, /available_at=\$2/);
  assert.equal((retry.values![1] as Date).toISOString(), "2026-08-24T00:00:08.000Z");
  assert.equal(retry.values![2], "redis unavailable");
  assert.equal(calls.some((call) => call.sql.includes("published_at=$2")), false);
});

test("outbox retry delay is exponential and capped", () => {
  assert.equal(outboxRetryDelayMs(1, 1_000), 1_000);
  assert.equal(outboxRetryDelayMs(5, 1_000), 16_000);
  assert.equal(outboxRetryDelayMs(50, 1_000), 900_000);
});
