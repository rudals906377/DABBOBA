import assert from "node:assert/strict";
import test from "node:test";
import type { DatabasePool } from "@dabboba/db";
import type { Logger } from "./logger.js";
import { processInventoryStorageExpiryBatch } from "./storage-expiry.js";
import { parseWorkerJob } from "./types.js";

function loggerWith(debugEntries: Array<Record<string, unknown>>): Logger {
  return {
    debug(fields) { debugEntries.push(fields); },
    info() {},
    warn() {},
    error() {},
  };
}

test("storage expiry sweep unwinds only stale open exchange work, then holds owned inventory and emits reminders", async () => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const debugEntries: Array<Record<string, unknown>> = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      queries.push({ sql, params });
      if (sql === "BEGIN" || sql === "COMMIT") return { rowCount: null, rows: [] };
      if (sql.includes("stale_listing_candidates")) {
        return {
          rowCount: 1,
          rows: [{ cancelled_listings: "1", rejected_offers: "2", released_inventory: "3" }],
        };
      }
      if (sql.includes("inventory.storage_expired_hold")) {
        return { rowCount: 1, rows: [{ recorded_events: "2", outbox_events: "2" }] };
      }
      if (sql.includes("inventory.storage_expiry_reminder")) {
        return { rowCount: 1, rows: [{ recorded_events: "4", outbox_events: "4" }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {},
  };
  const pool = { async connect() { return client; } } as unknown as DatabasePool;
  const now = new Date("2026-09-20T00:00:00.000Z");

  const result = await processInventoryStorageExpiryBatch(
    pool,
    25,
    loggerWith(debugEntries),
    now,
  );

  assert.deepEqual(result, {
    cancelledListings: 1,
    rejectedOffers: 2,
    releasedExchangeInventory: 3,
    heldInventory: 2,
    reminders: 4,
  });
  assert.deepEqual(queries.map(({ sql }) => sql === "BEGIN" || sql === "COMMIT" ? sql : "work"), [
    "BEGIN",
    "work",
    "work",
    "work",
    "COMMIT",
  ]);
  const [cleanup, hold, reminders] = queries.filter(({ sql }) => sql !== "BEGIN" && sql !== "COMMIT");
  assert.deepEqual(cleanup?.params, [25, now]);
  assert.match(cleanup?.sql ?? "", /listing\.status='OPEN'/);
  assert.match(cleanup?.sql ?? "", /offer\.status='PENDING'/);
  assert.match(cleanup?.sql ?? "", /listing\.id NOT IN \(SELECT id FROM expired_listings\)/);
  assert.match(cleanup?.sql ?? "", /inventory\.status='EXCHANGE_LISTED'/);
  assert.match(cleanup?.sql ?? "", /inventory\.status='EXCHANGE_OFFERED'/);

  assert.deepEqual(hold?.params, [25, now]);
  assert.match(hold?.sql ?? "", /inventory\.status='OWNED'/);
  assert.match(hold?.sql ?? "", /SET status='EXPIRED_HOLD'/);
  assert.match(hold?.sql ?? "", /event_kind,outbox_event_id[\s\S]*?'EXPIRED_HOLD'/);
  assert.match(hold?.sql ?? "", /ON CONFLICT \(inventory_unit_id,storage_expires_at,event_kind\) DO NOTHING/);

  assert.deepEqual(reminders?.params, [25, now]);
  assert.match(reminders?.sql ?? "", /VALUES \(1\),\(3\),\(7\),\(14\)/);
  assert.match(reminders?.sql ?? "", /listing\.status='MATCHED'/);
  assert.match(reminders?.sql ?? "", /offer\.status='ACCEPTED'/);
  assert.match(reminders?.sql ?? "", /inventory\.storage_expires_at>\$2::timestamptz/);
  assert.match(reminders?.sql ?? "", /inventory\.storage_expiry_reminder/);
  assert.equal(queries.some(({ sql }) => /DELETE\s+FROM\s+inventory_units/i.test(sql)), false);
  assert.deepEqual(debugEntries, [result]);
});

test("storage expiry ledger/outbox mismatch rolls the transaction back", async () => {
  const transaction: string[] = [];
  const client = {
    async query(sql: string) {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
        transaction.push(sql);
        return { rowCount: null, rows: [] };
      }
      if (sql.includes("stale_listing_candidates")) {
        return { rowCount: 1, rows: [{ cancelled_listings: 0, rejected_offers: 0, released_inventory: 0 }] };
      }
      if (sql.includes("inventory.storage_expired_hold")) {
        return { rowCount: 1, rows: [{ recorded_events: 1, outbox_events: 0 }] };
      }
      throw new Error("reminders must not run after an invariant failure");
    },
    release() {},
  };
  const pool = { async connect() { return client; } } as unknown as DatabasePool;

  await assert.rejects(
    () => processInventoryStorageExpiryBatch(pool, 10, loggerWith([])),
    /hold ledger\/outbox invariant failed/i,
  );
  assert.deepEqual(transaction, ["BEGIN", "ROLLBACK"]);
});

test("storage expiry periodic job payload is finite and deadline stops before opening a transaction", async () => {
  assert.deepEqual(parseWorkerJob({ kind: "inventory.storage-expiry" }), {
    kind: "inventory.storage-expiry",
  });
  let connections = 0;
  const pool = {
    async connect() {
      connections += 1;
      throw new Error("must not connect");
    },
  } as unknown as DatabasePool;

  assert.deepEqual(
    await processInventoryStorageExpiryBatch(pool, 10, loggerWith([]), new Date(), () => false),
    {
      cancelledListings: 0,
      rejectedOffers: 0,
      releasedExchangeInventory: 0,
      heldInventory: 0,
      reminders: 0,
    },
  );
  assert.equal(connections, 0);
});
