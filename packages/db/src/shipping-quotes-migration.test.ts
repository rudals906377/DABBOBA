import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL("../migrations/0063_shipping_quotes.sql", import.meta.url);

test("shipping quotes are immutable ten-minute snapshots of inventory, address, and policy", async () => {
  const source = await readFile(migration, "utf8");

  assert.match(source, /CREATE TABLE public\.shipping_quotes/i);
  assert.match(source, /address_id uuid NOT NULL REFERENCES public\.default_shipping_addresses\(id\) ON DELETE CASCADE/i);
  assert.match(source, /inventory_unit_ids uuid\[\] NOT NULL/i);
  assert.match(source, /CHECK \(cardinality\(inventory_unit_ids\) = item_count\)/i);
  assert.match(source, /free_shipping_threshold = CASE WHEN contains_kuji THEN 54900 ELSE 24900 END/i);
  assert.match(source, /reference_subtotal >= free_shipping_threshold THEN 0[\s\S]*ELSE 3000/i);
  assert.match(source, /expires_at = created_at \+ interval '10 minutes'/i);
  assert.match(source, /CHECK \(\(consumed_at IS NULL\) = \(shipping_request_id IS NULL\)\)/i);
  assert.match(source, /CREATE TRIGGER shipping_quotes_guard_mutation/i);
  assert.match(source, /Shipping quote snapshots are immutable/i);
  assert.match(source, /Shipping quotes may only be consumed once/i);
});

test("shipping quotes use RLS and grant runtime only create, read, and consumption columns", async () => {
  const source = await readFile(migration, "utf8");

  assert.match(source, /ALTER TABLE public\.shipping_quotes ENABLE ROW LEVEL SECURITY/i);
  assert.match(
    source,
    /REVOKE ALL ON TABLE public\.shipping_quotes\s+FROM PUBLIC, anon, authenticated, dabboba_runtime, dabboba_worker/i,
  );
  assert.match(source, /GRANT SELECT, INSERT ON TABLE public\.shipping_quotes TO dabboba_runtime/i);
  assert.match(
    source,
    /GRANT UPDATE \(consumed_at, shipping_request_id\)\s+ON TABLE public\.shipping_quotes TO dabboba_runtime/i,
  );
  assert.doesNotMatch(source, /GRANT (?:ALL|DELETE) ON TABLE public\.shipping_quotes/i);
  assert.doesNotMatch(source, /GRANT UPDATE ON TABLE public\.shipping_quotes/i);
  assert.match(source, /REVOKE EXECUTE ON FUNCTION public\.guard_shipping_quote_mutation\(\) FROM PUBLIC/i);
});
