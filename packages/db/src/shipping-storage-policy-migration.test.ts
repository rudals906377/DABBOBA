import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../migrations/0049_shipping_storage_policy.sql",
  import.meta.url,
);

test("shipping and storage policy migration establishes a non-shortening 60-day baseline", async () => {
  const source = await readFile(migrationUrl, "utf8");

  assert.match(source, /reference_subtotal integer/);
  assert.match(source, /free_shipping_threshold integer/);
  assert.match(source, /qualifies_for_free_shipping boolean/);
  assert.match(source, /contains_kuji boolean/);
  assert.match(source, /SET DEFAULT \(now\(\) \+ interval '60 days'\)/);
  assert.match(source, /GREATEST\([\s\S]*?storage_expires_at[\s\S]*?acquired_at \+ interval '60 days'[\s\S]*?\)/);
  assert.match(source, /storage_expires_at >= acquired_at \+ interval '60 days'/);
  assert.doesNotMatch(source, /UPDATE[\s\S]*?SET storage_expires_at = acquired_at \+ interval '60 days'/);
});
