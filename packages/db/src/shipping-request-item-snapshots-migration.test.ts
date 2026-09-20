import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = readFile(
  new URL("../migrations/0038_shipping_request_item_snapshots.sql", import.meta.url),
  "utf8",
);

test("shipping request items keep an immutable request-time product snapshot", async () => {
  const source = await migration;

  assert.match(source, /ALTER TABLE public\.shipping_request_items[\s\S]*ADD COLUMN product_snapshot jsonb/i);
  assert.match(source, /UPDATE public\.shipping_request_items AS item[\s\S]*jsonb_build_object/i);
  assert.match(source, /'productName',[\s\S]*product\.name/i);
  assert.match(source, /'ipNameKo',[\s\S]*ip\.name_ko/i);
  assert.match(source, /ALTER COLUMN product_snapshot SET NOT NULL/i);
  assert.match(source, /CHECK \(jsonb_typeof\(product_snapshot\) = 'object'\)/i);
  assert.match(source, /CREATE FUNCTION public\.guard_shipping_request_item_snapshot\(\)/i);
  assert.match(source, /SET search_path = pg_catalog, public/i);
  assert.match(source, /NEW\.product_snapshot IS DISTINCT FROM expected_snapshot/i);
  assert.match(source, /BEFORE INSERT OR UPDATE OR DELETE ON public\.shipping_request_items/i);
  assert.match(
    source,
    /REVOKE EXECUTE ON FUNCTION public\.guard_shipping_request_item_snapshot\(\) FROM PUBLIC/i,
  );
  assert.doesNotMatch(source, /SECURITY DEFINER|PASSWORD|DATABASE_URL|EXECUTE\s+format/i);
});
