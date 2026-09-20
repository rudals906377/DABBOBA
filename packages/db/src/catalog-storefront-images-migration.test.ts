import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL("../migrations/0047_catalog_storefront_images.sql", import.meta.url);

test("catalog storefront image migration adds a nullable list-image column", async () => {
  const source = await readFile(migration, "utf8");

  assert.match(source, /ALTER TABLE public\.catalog_products[\s\S]*ADD COLUMN storefront_image_url text/i);
  assert.doesNotMatch(source, /storefront_image_url text\s+NOT NULL/i);
  assert.doesNotMatch(source, /UPDATE\s+public\.catalog_products|INSERT\s+INTO\s+public\.catalog_products/i);
});

test("catalog storefront image migration accepts only absolute HTTP(S) URLs when present", async () => {
  const source = await readFile(migration, "utf8");

  assert.match(source, /catalog_products_storefront_image_url_http_check/i);
  assert.match(source, /storefront_image_url IS NULL/i);
  assert.match(source, /storefront_image_url\s*~\s*'\^https\?\:\/\//i);
  assert.match(source, /\[\^\[:space:\]\]\+\$'/i);
});
