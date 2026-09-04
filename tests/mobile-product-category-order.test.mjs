import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isCustomerBrowsableCatalogCategory,
  isCustomerVisibleProductCategory,
  PRODUCT_CATEGORY_OPTIONS,
  PRODUCT_CATEGORY_VALUES,
  productCategoryLabel,
} from "../apps/mobile/src/features/catalog/product-categories.ts";

const EXPECTED_CATEGORY_OPTIONS = [
  { value: "gacha", label: "가챠" },
  { value: "kuji", label: "쿠지" },
  { value: "figure", label: "피규어" },
];

test("the customer app exposes gacha, kuji, and coming-soon figure while card stays hidden", () => {
  assert.deepEqual(PRODUCT_CATEGORY_OPTIONS, EXPECTED_CATEGORY_OPTIONS);
  assert.deepEqual(PRODUCT_CATEGORY_VALUES, EXPECTED_CATEGORY_OPTIONS.map(({ value }) => value));

  for (const { value, label } of EXPECTED_CATEGORY_OPTIONS) {
    assert.equal(productCategoryLabel(value), label);
  }

  assert.equal(isCustomerVisibleProductCategory("gacha"), true);
  assert.equal(isCustomerVisibleProductCategory("kuji"), true);
  assert.equal(isCustomerVisibleProductCategory("figure"), true);
  assert.equal(isCustomerVisibleProductCategory("tcg"), false);
  assert.equal(isCustomerBrowsableCatalogCategory("gacha"), true);
  assert.equal(isCustomerBrowsableCatalogCategory("kuji"), true);
  assert.equal(isCustomerBrowsableCatalogCategory("figure"), false);
  assert.equal(isCustomerBrowsableCatalogCategory("tcg"), false);
  assert.equal(productCategoryLabel("tcg"), "카드");
});
