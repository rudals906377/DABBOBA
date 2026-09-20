import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = readFile(
  new URL("../migrations/0039_retire_prototype_catalog.sql", import.meta.url),
  "utf8",
);
const migrator = readFile(new URL("./migrate.ts", import.meta.url), "utf8");

test("prototype catalog retirement fails closed before retiring active versions", async () => {
  const sql = await migration;

  assert.match(sql, /CREATE TEMP TABLE dabboba_0039_target_products/i);
  assert.match(sql, /metadata \? 'developmentFixture'/);
  const prototypeProductIds = sql
    .match(/product\.id = ANY \(ARRAY\[([\s\S]*?)\]::text\[\]\)/)?.[1]
    ?.match(/'[^']+'/g) ?? [];
  assert.equal(prototypeProductIds.length, 25);
  assert.match(sql, /LOCK TABLE[\s\S]*public\.draw_probability_versions[\s\S]*public\.draw_entitlements/i);
  assert.match(sql, /version\.status = 'ACTIVE'[\s\S]*sale_product\.id IS NULL/i);
  assert.match(sql, /status = 'AVAILABLE'/i);
  assert.match(sql, /orders\.status = 'PENDING_PAYMENT'/i);
  assert.match(sql, /payment\.status IN \('PENDING','AUTHORIZED'\)/i);
  assert.match(sql, /reservation\.status = 'ACTIVE'/i);
  assert.match(sql, /room_entry\.state IN \('WAITING','CHECKOUT_PENDING','DRAWING'\)/i);
  assert.match(sql, /binding\.state = 'RESERVED'/i);
  assert.doesNotMatch(sql, /binding\.state = 'CONSUMED'/i);
  assert.doesNotMatch(sql, /shipping\.status|listing\.status|offer\.status/i);
});

test("prototype catalog retirement retires versions before deactivation and preserves history", async () => {
  const sql = await migration;

  const retireVersionAt = sql.indexOf("UPDATE public.draw_probability_versions AS version");
  const deactivateProductAt = sql.indexOf("UPDATE public.catalog_products AS product");
  assert.ok(retireVersionAt >= 0);
  assert.ok(deactivateProductAt > retireVersionAt);
  assert.match(sql, /SET status = 'RETIRED'/);
  assert.match(sql, /SET is_active = false/);
  assert.match(sql, /INSERT INTO dabboba_0039_target_ips[\s\S]*SELECT target\.ip_id/i);
  assert.match(sql, /UPDATE public\.catalog_ips AS ip/);
  assert.match(sql, /NOT EXISTS[\s\S]*product\.is_active = true/);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
});

test("migrator commits the assertion and retirement SQL as one transaction", async () => {
  const source = await migrator;

  assert.match(
    source,
    /await client\.query\("BEGIN"\);[\s\S]*await client\.query\(migration\.sql\);[\s\S]*INSERT INTO schema_migrations[\s\S]*await client\.query\("COMMIT"\)/,
  );
  assert.match(source, /catch \(error\) \{[\s\S]*await client\.query\("ROLLBACK"\)/);
});
