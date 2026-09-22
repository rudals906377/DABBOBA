import assert from "node:assert/strict";
import { test } from "node:test";

import {
  customerProductCategoryAvailability,
  DEFAULT_CUSTOMER_CATEGORY_AVAILABILITY,
  isCustomerBrowsableCatalogCategory,
  isCustomerProductCategoryComingSoon,
  isCustomerVisibleProductCategory,
  PRODUCT_CATEGORY_OPTIONS,
  PRODUCT_CATEGORY_VALUES,
  productCategoryLabel,
} from "../apps/mobile/src/features/catalog/product-categories.ts";

const EXPECTED_CATEGORY_OPTIONS = [
  { value: "gacha", label: "가챠", availability: "active" },
  { value: "kuji", label: "쿠지", availability: "active" },
];

test("the customer app exposes only the top-level gacha and kuji shops", () => {
  assert.deepEqual(PRODUCT_CATEGORY_OPTIONS, EXPECTED_CATEGORY_OPTIONS);
  assert.deepEqual(PRODUCT_CATEGORY_VALUES, EXPECTED_CATEGORY_OPTIONS.map(({ value }) => value));

  for (const { value, label } of EXPECTED_CATEGORY_OPTIONS) {
    assert.equal(productCategoryLabel(value), label);
  }

  assert.equal(isCustomerVisibleProductCategory("gacha"), true);
  assert.equal(isCustomerVisibleProductCategory("kuji"), true);
  assert.equal(isCustomerVisibleProductCategory("figure"), false);
  assert.equal(isCustomerVisibleProductCategory("tcg"), false);
  assert.equal(isCustomerBrowsableCatalogCategory("gacha"), true);
  assert.equal(isCustomerBrowsableCatalogCategory("kuji"), true);
  assert.equal(isCustomerBrowsableCatalogCategory("figure"), false);
  assert.equal(isCustomerBrowsableCatalogCategory("tcg"), false);
  assert.equal(customerProductCategoryAvailability("gacha"), "active");
  assert.equal(customerProductCategoryAvailability("kuji"), "active");
  assert.equal(customerProductCategoryAvailability("figure"), "hidden");
  assert.equal(customerProductCategoryAvailability("tcg"), "hidden");
  assert.equal(isCustomerProductCategoryComingSoon("figure"), false);
  assert.equal(isCustomerProductCategoryComingSoon("gacha"), false);
  assert.equal(isCustomerProductCategoryComingSoon(undefined), false);
  assert.equal(DEFAULT_CUSTOMER_CATEGORY_AVAILABILITY.figure, "hidden");
  assert.equal(productCategoryLabel("figure"), "피규어", "figure stays available to internal domain/admin code");
  assert.equal(productCategoryLabel("tcg"), "카드");
});
