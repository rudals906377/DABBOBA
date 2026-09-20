import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL("../migrations/0051_home_catalog_section_layout.sql", import.meta.url);

test("Home catalog layout migration keeps legacy rows nullable and accepts only Gacha or Kuji", async () => {
  const source = await readFile(migration, "utf8");

  assert.match(source, /ADD COLUMN layout_kind text/i);
  assert.match(source, /CHECK \(layout_kind IN \('gacha', 'kuji'\)\)/i);
  assert.doesNotMatch(source, /layout_kind text\s+NOT NULL/i);
  assert.doesNotMatch(source, /layout_kind[^;]*DEFAULT/i);
  assert.doesNotMatch(source, /UPDATE\s+public\.home_catalog_sections/i);
});

test("Home catalog layout migration permits the same IP in category-specific ordered rails", async () => {
  const source = await readFile(migration, "utf8");

  assert.match(source, /DROP CONSTRAINT home_catalog_sections_ip_id_key/i);
  assert.match(source, /CREATE INDEX home_catalog_sections_ip_order_idx[\s\S]*\(ip_id, sort_order, id\)/i);
  assert.doesNotMatch(source, /CREATE UNIQUE INDEX[^;]*home_catalog_sections/i);
});
