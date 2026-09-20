import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyStorefrontCategorySettings,
  isCustomerBrowsableCatalogCategory,
  isCustomerProductCategoryEnabledOn,
  isCustomerProductCategoryComingSoon,
  isCustomerVisibleProductCategory,
  productCategoryDescription,
  productCategoryLabel,
  storefrontCategoryOptions,
} from "../apps/mobile/src/features/catalog/product-categories.ts";

const timestamps = { createdAt: "2026-09-10T00:00:00.000Z", updatedAt: "2026-09-10T00:00:00.000Z" };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function setting(category, overrides = {}) {
  const defaults = {
    gacha: { label: "가챠", sortOrder: 10, availability: "active", showOnHome: true, showOnCatalog: true, showOnExchange: true, showOnWanted: true, description: "가챠 안내", iconKey: "capsule" },
    kuji: { label: "쿠지", sortOrder: 20, availability: "active", showOnHome: true, showOnCatalog: true, showOnExchange: true, showOnWanted: true, description: "쿠지 안내", iconKey: "ticket" },
    figure: { label: "피규어", sortOrder: 30, availability: "coming-soon", showOnHome: false, showOnCatalog: true, showOnExchange: true, showOnWanted: true, description: "피규어 안내", iconKey: "figure" },
    tcg: { label: "카드", sortOrder: 40, availability: "hidden", showOnHome: false, showOnCatalog: false, showOnExchange: false, showOnWanted: false, description: "카드 안내", iconKey: "cards" },
  }[category];
  return { category, ...defaults, imageUrl: null, version: 1, ...timestamps, ...overrides };
}

const defaults = () => [setting("gacha"), setting("kuji"), setting("figure"), setting("tcg")];

test("operator settings can reorder customer shops without exposing internal figure records", () => {
  try {
    applyStorefrontCategorySettings([
      setting("gacha", { label: "캡슐", sortOrder: 30, showOnExchange: false, version: 2 }),
      setting("kuji", { label: "럭키 쿠지", sortOrder: 5, description: "새 쿠지 안내", version: 3 }),
      setting("figure", { availability: "active", sortOrder: 20, version: 2 }),
      setting("tcg"),
    ]);

    assert.deepEqual(storefrontCategoryOptions("catalog").map((item) => item.label), ["럭키 쿠지", "캡슐"]);
    assert.deepEqual(storefrontCategoryOptions("exchange").map((item) => item.value), ["kuji"]);
    assert.equal(productCategoryLabel("gacha"), "캡슐");
    assert.equal(productCategoryDescription("kuji"), "새 쿠지 안내");
    assert.equal(isCustomerProductCategoryComingSoon("figure"), false);
    assert.equal(isCustomerBrowsableCatalogCategory("figure"), false);
    assert.equal(isCustomerVisibleProductCategory("figure"), false);
    for (const surface of ["home", "catalog", "exchange", "wanted"]) {
      assert.equal(isCustomerProductCategoryEnabledOn("figure", surface), false);
      assert.equal(storefrontCategoryOptions(surface).some((item) => item.value === "figure"), false);
    }
  } finally {
    applyStorefrontCategorySettings(defaults());
  }
});

test("incomplete remote settings never replace the safe last verified policy", () => {
  applyStorefrontCategorySettings(defaults());
  const before = storefrontCategoryOptions("catalog");
  applyStorefrontCategorySettings([setting("gacha", { label: "불완전" })]);
  assert.deepEqual(storefrontCategoryOptions("catalog"), before);
});

test("dedicated shops re-check the current catalog policy before rendering cached products", () => {
  const source = readFileSync(path.join(root, "apps/mobile/src/features/shop/ShopScreen.tsx"), "utf8");
  assert.match(source, /isCustomerProductCategoryEnabledOn\(category, "catalog"\)/);
  assert.match(source, /if \(!catalogEnabled \|\| isComingSoon\) \{[\s\S]*?setProducts\(\[\]\)[\s\S]*?return/);
  assert.match(source, /data=\{isComingSoon \|\| !catalogEnabled \? \[\] : products\}/);
  assert.match(source, /isComingSoon \|\| !catalogEnabled/);
});
