import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

const searchSource = readSource("apps/mobile/src/features/search/ProductSearchScreen.tsx");
const dukroomApiSource = readSource("apps/mobile/src/features/dukroom/dukroom-api.ts");

test("native product search applies the customer-browsable category guard before rendering results", () => {
  assert.match(searchSource, /isCustomerBrowsableCatalogCategory/);
  assert.match(
    searchSource,
    /snapshot\.products\.filter\(\(product\) =>\s*isCustomerBrowsableCatalogCategory\(product\.category\)/,
  );
});

test("dukroom catalog fallbacks and examples never create a hidden-card product link", () => {
  assert.match(dukroomApiSource, /isCustomerBrowsableCatalogCategory/);
  assert.match(
    dukroomApiSource,
    /catalog\.products\.find\(\s*\(product\) =>\s*product\.ipId === post\.ipId\s*&&\s*isCustomerBrowsableCatalogCategory\(product\.category\)/,
  );
  assert.match(
    dukroomApiSource,
    /products\s*\.filter\(\(product\) =>\s*isCustomerBrowsableCatalogCategory\(product\.category\)\)/,
  );
});
