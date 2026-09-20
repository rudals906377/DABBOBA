import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../migrations/0054_catalog_sale_status_and_prelaunch.sql",
  import.meta.url,
);

test("catalog sale status migration makes zero-price products non-sellable and guards ON_SALE transitions", async () => {
  const source = await readFile(migration, "utf8");
  assert.match(source, /ADD COLUMN sale_status text NOT NULL DEFAULT 'DRAFT'/);
  assert.match(source, /sale_status IN \('DRAFT','COMING_SOON','ON_SALE','PAUSED'\)/);
  assert.match(source, /sale_status <> 'ON_SALE'[\s\S]*?price > 0/);
  assert.match(source, /ON_SALE products require positive available stock/);
  assert.match(source, /draw_probability_versions[\s\S]*?status = 'ACTIVE'/);
  assert.match(source, /SECURITY INVOKER/);
  assert.match(source, /REVOKE EXECUTE ON FUNCTION public\.guard_catalog_product_on_sale_transition\(\) FROM PUBLIC/);
});
