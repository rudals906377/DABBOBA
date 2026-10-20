import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("new storage policy binds fresh legal versions to HTML without rewriting published history", async () => {
  const migration = await readFile(new URL("../migrations/0094_legal_policy_storage_2026_10_12.sql", import.meta.url), "utf8");
  for (const [key, path] of [["TERMS", "terms"], ["PRIVACY", "privacy"]]) {
    const html = await readFile(new URL(`../../../docs/legal-history/${path}-2026-10-12.html`, import.meta.url));
    const digest = createHash("sha256").update(html).digest("hex");
    assert.ok(migration.includes(`('${key}','2026-10-12','${digest}'`));
    assert.match(html.toString(), /시행일 2026년 10월 12일/);
  }
});

test("expiry migration snapshots only new consenting inventory and prevents duplicate or mutated credits", async () => {
  const sql = await readFile(new URL("../migrations/0093_inventory_storage_point_returns.sql", import.meta.url), "utf8");
  assert.match(sql, /acceptance.policy_version>='2026-10-12'/);
  assert.match(sql, /acceptance.accepted_at<=NEW.acquired_at/);
  assert.match(sql, /Storage return price and rate snapshots are immutable/);
  assert.match(sql, /inventory_unit_id uuid PRIMARY KEY/);
  assert.match(sql, /source_type='GACHA' AND rate=50/);
  assert.match(sql, /source_type='KUJI' AND rate=15/);
  assert.match(sql, /BEFORE UPDATE OR DELETE/);
  assert.doesNotMatch(sql, /UPDATE public.inventory_units SET storage_return/);
  assert.doesNotMatch(sql, /SECURITY DEFINER|GRANT[^;]*DELETE[^;]*TO dabboba_worker/);
});

test("temporary prize labels do not change stock, quantities, images or published draw versions", async () => {
  const sql = await readFile(new URL("../migrations/0095_launch_numeric_prize_names.sql", import.meta.url), "utf8");
  assert.match(sql, /temporaryNumericName/);
  assert.match(sql, /parent.price/);
  assert.doesNotMatch(sql, /UPDATE (?:public\.)?(?:product_stock|draw_pool_entries|draw_probability_versions)/);
});
