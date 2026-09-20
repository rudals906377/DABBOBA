import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../migrations/0050_shipping_fee_policy.sql",
  import.meta.url,
);

test("shipping fee policy snapshots 3,000 won below the free-shipping threshold", async () => {
  const source = await readFile(migrationUrl, "utf8");

  assert.match(source, /ADD COLUMN shipping_fee integer/);
  assert.match(source, /WHEN qualifies_for_free_shipping THEN 0\s+ELSE 3000\s+END/);
  assert.match(source, /qualifies_for_free_shipping IS NULL[\s\S]*?shipping_fee IS NULL/);
  assert.match(source, /qualifies_for_free_shipping IS NOT NULL[\s\S]*?shipping_fee IS NOT NULL/);
  assert.match(source, /NOT VALID/);
  assert.match(source, /VALIDATE CONSTRAINT shipping_requests_shipping_fee_policy_snapshot/);
  assert.match(source, /BEFORE INSERT ON public\.shipping_requests/);
  assert.match(source, /Shipping policy snapshots are immutable/);
  assert.match(source, /ERRCODE = '55000'/);
  assert.equal((source.match(/SET search_path = pg_catalog, public/g) ?? []).length, 2);
  assert.equal((source.match(/REVOKE EXECUTE ON FUNCTION/g) ?? []).length, 2);
});
