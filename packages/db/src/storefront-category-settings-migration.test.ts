import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const source = readFileSync(
  fileURLToPath(new URL("../migrations/0042_storefront_category_settings.sql", import.meta.url)),
  "utf8",
);

test("storefront category settings keep fixed domain IDs and operator presentation fields", () => {
  assert.match(source, /CREATE TABLE public\.storefront_category_settings/i);
  assert.match(source, /category IN \('gacha', 'figure', 'kuji', 'tcg'\)/i);
  assert.match(source, /availability IN \('active', 'coming-soon', 'hidden'\)/i);
  for (const field of ["show_on_home", "show_on_catalog", "show_on_exchange", "show_on_wanted"]) {
    assert.match(source, new RegExp(`${field} boolean NOT NULL`, "i"));
  }
  assert.match(source, /ON CONFLICT \(category\) DO NOTHING/i);
});

test("storefront category settings are API-only, update-only, and RLS protected", () => {
  assert.match(source, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(source, /REVOKE ALL ON TABLE public\.storefront_category_settings FROM PUBLIC/i);
  assert.match(source, /GRANT SELECT, UPDATE ON TABLE public\.storefront_category_settings TO dabboba_runtime/i);
  assert.doesNotMatch(source, /GRANT[^;]*(?:INSERT|DELETE)[^;]*storefront_category_settings/i);
});
