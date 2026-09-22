import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = readFile(
  new URL("../migrations/0034_home_catalog_sections.sql", import.meta.url),
  "utf8",
);

test("home catalog sections are ordered, IP-backed, versioned, and backend-only", async () => {
  const source = await migration;

  assert.match(source, /CREATE TABLE public\.home_catalog_sections/i);
  assert.match(source, /id text PRIMARY KEY/i);
  assert.match(source, /ip_id text NOT NULL UNIQUE REFERENCES public\.catalog_ips\(id\) ON DELETE RESTRICT/i);
  assert.match(source, /sort_order integer NOT NULL CHECK \(sort_order >= 0\)/i);
  assert.match(source, /is_active boolean NOT NULL DEFAULT false/i);
  assert.match(source, /version integer NOT NULL DEFAULT 1 CHECK \(version >= 1\)/i);
  assert.match(source, /CREATE TRIGGER home_catalog_sections_set_updated_at/i);
  assert.match(source, /ALTER TABLE public\.home_catalog_sections ENABLE ROW LEVEL SECURITY/i);
  assert.match(source, /REVOKE ALL ON TABLE public\.home_catalog_sections FROM PUBLIC/i);
  assert.match(source, /rolname IN \('anon', 'authenticated', 'service_role'\)/i);
});

test("runtime role can manage visibility without deleting home section records", async () => {
  const source = await migration;

  assert.match(
    source,
    /GRANT SELECT, INSERT, UPDATE ON TABLE public\.home_catalog_sections TO dabboba_runtime/i,
  );
  assert.match(source, /REVOKE ALL ON TABLE public\.home_catalog_sections FROM dabboba_runtime/i);
  assert.doesNotMatch(source, /GRANT[^;]*DELETE[^;]*home_catalog_sections/i);
  assert.doesNotMatch(source, /GRANT[^;]*home_catalog_sections[^;]*dabboba_worker/i);
  assert.doesNotMatch(source, /PASSWORD|CREATE POLICY/i);
});
