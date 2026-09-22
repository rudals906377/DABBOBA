import assert from "node:assert/strict";
import test from "node:test";

import {
  areCustomerVisibleExchangeProducts,
  isCustomerEligibleExchangeInventory,
  isCustomerVisibleExchangeBundle,
} from "../apps/mobile/src/features/exchange/exchange-visibility.ts";

function inventory({ category = "gacha", sourceType = "GACHA", status = "OWNED" } = {}) {
  return {
    id: `${category}-${sourceType}-${status}`,
    sourceType,
    status,
    product: { category },
  };
}

test("only current customer categories can be newly listed or offered", () => {
  for (const category of ["gacha", "kuji"]) {
    assert.equal(isCustomerEligibleExchangeInventory(inventory({ category })), true);
  }

  for (const category of ["figure", "tcg"]) {
    assert.equal(isCustomerEligibleExchangeInventory(inventory({ category })), false);
  }

  assert.equal(isCustomerEligibleExchangeInventory(inventory({ sourceType: "KUJI" })), false);
  assert.equal(isCustomerEligibleExchangeInventory(inventory({ status: "SHIPPING" })), false);
});

test("live exchange discovery hides bundles containing removed categories", () => {
  assert.equal(isCustomerVisibleExchangeBundle([
    inventory({ category: "gacha", status: "EXCHANGE_LISTED" }),
  ]), true);
  assert.equal(isCustomerVisibleExchangeBundle([
    inventory({ category: "gacha", status: "EXCHANGE_LISTED" }),
    inventory({ category: "figure", status: "EXCHANGE_LISTED" }),
  ]), false);
  assert.equal(isCustomerVisibleExchangeBundle([
    inventory({ category: "gacha", status: "EXCHANGE_LISTED" }),
    inventory({ category: "tcg", status: "EXCHANGE_LISTED" }),
  ]), false);
  assert.equal(isCustomerVisibleExchangeBundle([]), false);
});

test("cached exchange projections also reject removed categories", () => {
  assert.equal(areCustomerVisibleExchangeProducts([
    { category: "gacha" },
    { category: "kuji" },
  ]), true);
  assert.equal(areCustomerVisibleExchangeProducts([
    { category: "gacha" },
    { category: "figure" },
  ]), false);
  assert.equal(areCustomerVisibleExchangeProducts([
    { category: "gacha" },
    { category: "tcg" },
  ]), false);
  assert.equal(areCustomerVisibleExchangeProducts([]), false);
});
