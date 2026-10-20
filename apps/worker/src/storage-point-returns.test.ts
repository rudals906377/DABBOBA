import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseClient } from "@dabboba/db";
import { returnExpiredStoragePoints, storageReturnPoints } from "./storage-point-returns.js";

test("expiry points use GACHA 50% and KUJI 15%, flooring each prize without floating remainder allocation", () => {
  assert.equal(storageReturnPoints(6000, "GACHA"), 3000);
  assert.equal(storageReturnPoints(9999, "GACHA"), 4999);
  assert.equal(storageReturnPoints(5000, "KUJI"), 750);
  assert.equal(storageReturnPoints(9999, "KUJI"), 1499);
  assert.equal(storageReturnPoints(1, "KUJI"), 0);
  for (const amount of [0, -1, NaN, Infinity, 1.5, 2147483648]) {
    assert.throws(() => storageReturnPoints(amount, "GACHA"));
  }
});

function fixture(source: "GACHA" | "KUJI", balanceAvailable = true) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      queries.push({ sql, params });
      if (sql.includes("FROM inventory_units inventory")) return { rowCount: 1, rows: [{
        id: "inventory-1", owner_id: "user-1", source_type: source,
        storage_expires_at: new Date("2026-12-12T00:00:00Z"),
        storage_return_reference_amount: 9999, storage_return_rate: source === "GACHA" ? 50 : 15,
      }] };
      if (sql.startsWith("UPDATE point_accounts")) return { rowCount: balanceAvailable ? 1 : 0, rows: [] };
      if (sql.startsWith("INSERT INTO inventory_storage_expiry_events")) return { rowCount: 1, rows: [{ id: "event-1", outbox_event_id: "outbox-1" }] };
      return { rowCount: 1, rows: [] };
    },
  } as unknown as DatabaseClient;
  return { queries, client };
}

test("expiry credits are journalled with a terminal transition and outbox in the caller transaction", async () => {
  for (const source of ["GACHA", "KUJI"] as const) {
    const { queries, client } = fixture(source);
    assert.equal(await returnExpiredStoragePoints(client, 10, new Date(), () => true), 1);
    assert.match(queries[0]!.sql, /status='EXPIRED_HOLD'/);
    assert.match(queries[0]!.sql, /source_order.status IN \('PAID','FULFILLED'\)/);
    assert.match(queries[0]!.sql, /FOR UPDATE OF inventory SKIP LOCKED/);
    assert.match(queries[0]!.sql, /NOT EXISTS.*inventory_storage_point_returns/);
    const ledger = queries.find(({ sql }) => sql.startsWith("INSERT INTO point_ledger_entries"))!;
    assert.equal(ledger.params[1], source === "GACHA" ? 4999 : 1499);
    assert.equal(ledger.params[2], "inventory-1");
    assert.match(queries.at(-2)!.sql, /SET status='POINT_RETURNED'/);
    assert.match(queries.at(-1)!.sql, /inventory.storage_point_returned/);
  }
});

test("balance overflow leaves the prize on hold without a credit ledger or state transition", async () => {
  const { queries, client } = fixture("GACHA", false);
  assert.equal(await returnExpiredStoragePoints(client, 1, new Date(), () => true), 0);
  assert.equal(queries.length, 3);
  assert.equal(queries.some(({ sql }) => sql.includes("INSERT INTO point_ledger_entries")), false);
});

test("a worker deadline prevents point mutations", async () => {
  const { queries, client } = fixture("GACHA");
  await assert.rejects(() => returnExpiredStoragePoints(client, 1, new Date(), () => false), /deadline/);
  assert.equal(queries.length, 1);
});
