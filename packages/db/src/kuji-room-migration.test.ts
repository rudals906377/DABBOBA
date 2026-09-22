import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = readFile(
  new URL("../migrations/0022_kuji_room_entries.sql", import.meta.url),
  "utf8",
);

function normalizeSql(source: string) {
  return source.replace(/\s+/g, " ").trim();
}

test("kuji room entries link at most one order and enforce state ownership", async () => {
  const source = normalizeSql(await migration);

  assert.match(
    source,
    /order_id uuid UNIQUE REFERENCES orders\(id\) ON DELETE RESTRICT/,
  );
  assert.match(source, /CONSTRAINT kuji_room_entries_state_order_ck CHECK/);
  assert.match(source, /state = 'WAITING' AND order_id IS NULL/);
  assert.match(source, /state = 'CHECKOUT_PENDING'/);
  assert.match(
    source,
    /state IN \('DRAWING','COMPLETED'\) AND order_id IS NOT NULL/,
  );
  assert.match(source, /state IN \('CANCELLED','EXPIRED'\)/);
});

test("kuji room entry order linkage is immutable after assignment", async () => {
  const source = normalizeSql(await migration);

  assert.match(
    source,
    /OLD\.order_id IS NOT NULL AND OLD\.order_id IS DISTINCT FROM NEW\.order_id/,
  );
  assert.match(source, /Kuji room entry order linkage is immutable/);
});

test("checkout and drawing leases cannot be renewed in place", async () => {
  const source = normalizeSql(await migration);

  assert.match(source, /checkout_expires_at = checkout_started_at \+ interval '3 minutes'/);
  assert.match(source, /drawing_expires_at = drawing_started_at \+ interval '5 minutes'/);

  assert.match(
    source,
    /OLD\.state = 'CHECKOUT_PENDING' AND NEW\.state = 'CHECKOUT_PENDING'.*OLD\.checkout_started_at IS DISTINCT FROM NEW\.checkout_started_at.*OLD\.checkout_expires_at IS DISTINCT FROM NEW\.checkout_expires_at/s,
  );
  assert.match(source, /Kuji checkout lease is non-renewing/);
  assert.match(
    source,
    /OLD\.state = 'DRAWING' AND NEW\.state = 'DRAWING'.*OLD\.drawing_started_at IS DISTINCT FROM NEW\.drawing_started_at.*OLD\.drawing_expires_at IS DISTINCT FROM NEW\.drawing_expires_at/s,
  );
  assert.match(source, /Kuji drawing lease is non-renewing/);
});
