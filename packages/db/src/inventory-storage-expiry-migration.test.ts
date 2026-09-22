import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../migrations/0061_inventory_storage_expiry_lifecycle.sql",
  import.meta.url,
);

test("storage expiry migration adds a non-destructive hold and append-only milestone ledger", async () => {
  const source = await readFile(migration, "utf8");

  assert.match(source, /'POINT_RETURNED',[\s\S]*?'EXPIRED_HOLD'/);
  assert.match(source, /CREATE TABLE public\.inventory_storage_expiry_events/i);
  for (const milestone of ["REMINDER_14D", "REMINDER_7D", "REMINDER_3D", "REMINDER_1D", "EXPIRED_HOLD"]) {
    assert.match(source, new RegExp(`'${milestone}'`));
  }
  assert.match(source, /UNIQUE \(inventory_unit_id, storage_expires_at, event_kind\)/i);
  assert.match(source, /FOREIGN KEY \(outbox_event_id\)[\s\S]*?DEFERRABLE INITIALLY DEFERRED/i);
  assert.match(source, /inventory_storage_expiry_events_immutable/i);
  assert.match(source, /GRANT SELECT, INSERT ON TABLE public\.inventory_storage_expiry_events TO dabboba_worker/i);
  assert.doesNotMatch(source, /GRANT[^;]*DELETE[^;]*inventory_storage_expiry_events/i);
  assert.doesNotMatch(source, /DELETE\s+FROM\s+(?:public\.)?inventory_units/i);
});

test("storage expiry worker permissions are limited to status cleanup and bundle reads", async () => {
  const source = await readFile(migration, "utf8");

  assert.match(source, /GRANT SELECT ON TABLE[\s\S]*?exchange_listing_items,[\s\S]*?exchange_offer_items[\s\S]*?TO dabboba_worker/i);
  assert.match(source, /GRANT UPDATE \(status\) ON TABLE public\.inventory_units TO dabboba_worker/i);
  assert.match(source, /GRANT UPDATE \(status, cancelled_at, cancelled_by, cancel_reason\)[\s\S]*?public\.exchange_listings TO dabboba_worker/i);
  assert.match(source, /GRANT UPDATE \(status, decided_at\)[\s\S]*?public\.exchange_offers TO dabboba_worker/i);
  assert.doesNotMatch(source, /GRANT UPDATE ON TABLE public\.inventory_units/i);
});
