import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL("../migrations/0062_home_catalog_section_sources.sql", import.meta.url);

test("Home section sources preserve legacy IP rails and add bounded presentation fields", async () => {
  const source = await readFile(migration, "utf8");

  assert.match(source, /ADD COLUMN subtitle varchar\(240\)/i);
  assert.match(source, /source_kind text NOT NULL DEFAULT 'IP'/i);
  assert.match(source, /source_kind IN \('MANUAL', 'IP', 'NEW', 'POPULAR'\)/i);
  assert.match(source, /visible_limit smallint NOT NULL DEFAULT 20/i);
  assert.match(source, /visible_limit BETWEEN 1 AND 20/i);
  assert.match(source, /ALTER COLUMN ip_id DROP NOT NULL/i);
  assert.match(source, /CHECK \(source_kind <> 'IP' OR ip_id IS NOT NULL\)/i);
});

test("Manual Home selections have durable unique order and runtime-only mutation access", async () => {
  const source = await readFile(migration, "utf8");

  assert.match(source, /CREATE TABLE public\.home_catalog_section_products/i);
  assert.match(source, /section_id text NOT NULL REFERENCES public\.home_catalog_sections\(id\) ON DELETE CASCADE/i);
  assert.match(source, /product_id text NOT NULL REFERENCES public\.catalog_products\(id\) ON DELETE RESTRICT/i);
  assert.match(source, /PRIMARY KEY \(section_id, product_id\)/i);
  assert.match(source, /UNIQUE \(section_id, sort_order\)/i);
  assert.match(source, /sort_order BETWEEN 0 AND 19/i);
  assert.match(source, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(source, /REVOKE ALL ON TABLE public\.home_catalog_section_products[\s\S]*FROM PUBLIC, anon, authenticated, dabboba_worker, dabboba_runtime/i);
  assert.match(source, /GRANT SELECT, INSERT, DELETE ON TABLE public\.home_catalog_section_products TO dabboba_runtime/i);
  assert.doesNotMatch(source, /(?:EXECUTE|format\s*\()/i);
});
