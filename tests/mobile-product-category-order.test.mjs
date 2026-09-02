import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PRODUCT_CATEGORY_OPTIONS,
  PRODUCT_CATEGORY_VALUES,
  productCategoryLabel,
} from "../apps/mobile/src/features/catalog/product-categories.ts";

const EXPECTED_CATEGORY_OPTIONS = [
  { value: "gacha", label: "가챠" },
  { value: "kuji", label: "쿠지" },
  { value: "figure", label: "피규어" },
  { value: "tcg", label: "카드" },
];

test("the customer app keeps one fixed product-category order", () => {
  assert.deepEqual(PRODUCT_CATEGORY_OPTIONS, EXPECTED_CATEGORY_OPTIONS);
  assert.deepEqual(PRODUCT_CATEGORY_VALUES, EXPECTED_CATEGORY_OPTIONS.map(({ value }) => value));

  for (const { value, label } of EXPECTED_CATEGORY_OPTIONS) {
    assert.equal(productCategoryLabel(value), label);
  }
});
