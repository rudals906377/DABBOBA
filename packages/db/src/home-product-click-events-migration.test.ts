import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL("../migrations/0045_home_product_click_events.sql", import.meta.url);

test("Home click evidence is anonymous, immutable, and available only to the API runtime", async () => {
  const source = await readFile(migration, "utf8");
  const statements = source.replace(/^--.*$/gm, "");

  assert.match(source, /CREATE TABLE public\.home_product_click_events/i);
  assert.match(source, /id uuid PRIMARY KEY/i);
  assert.match(source, /product_id text NOT NULL REFERENCES public\.catalog_products\(id\) ON DELETE RESTRICT/i);
  assert.doesNotMatch(statements, /user_id|session_id|device|ip_address|user_agent/i);
  assert.match(source, /CREATE TRIGGER home_product_click_events_immutable/i);
  assert.match(source, /ALTER TABLE public\.home_product_click_events ENABLE ROW LEVEL SECURITY/i);
  assert.match(source, /REVOKE ALL ON TABLE public\.home_product_click_events FROM PUBLIC/i);
  assert.match(source, /GRANT SELECT, INSERT ON TABLE public\.home_product_click_events TO dabboba_runtime/i);
  assert.doesNotMatch(source, /GRANT[^;]*(?:UPDATE|DELETE)[^;]*home_product_click_events/i);
});
