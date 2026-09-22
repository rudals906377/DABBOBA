import assert from "node:assert/strict";
import { test } from "node:test";

import {
  filterSoldOutProducts,
  sortShopProducts,
} from "../apps/mobile/src/features/shop/shop-filter.ts";

const products = [
  { id: "older-popular", price: 9_900, availableQuantity: 8, metadata: { popularityScore: 90 }, createdAt: "2026-08-20T00:00:00.000Z" },
  { id: "new-low", price: 2_000, availableQuantity: 4, metadata: { popularityScore: 20 }, createdAt: "2026-08-29T00:00:00.000Z" },
  { id: "sold-out", price: 18_000, availableQuantity: 0, metadata: { popularityScore: 40 }, createdAt: "2026-08-27T00:00:00.000Z" },
];

test("sold-out exclusion is independent from product sorting", () => {
  assert.deepEqual(filterSoldOutProducts(products, false).map((product) => product.id), ["older-popular", "new-low", "sold-out"]);
  assert.deepEqual(filterSoldOutProducts(products, true).map((product) => product.id), ["older-popular", "new-low"]);
});

test("shop sorting supports latest, popular, and both price directions", () => {
  assert.deepEqual(sortShopProducts(products, "latest").map((product) => product.id), ["new-low", "sold-out", "older-popular"]);
  assert.deepEqual(sortShopProducts(products, "popular").map((product) => product.id), ["older-popular", "sold-out", "new-low"]);
  assert.deepEqual(sortShopProducts(products, "price-high").map((product) => product.id), ["sold-out", "older-popular", "new-low"]);
  assert.deepEqual(sortShopProducts(products, "price-low").map((product) => product.id), ["new-low", "older-popular", "sold-out"]);
});

test("shop sorting never mutates the API catalog array", () => {
  const originalOrder = products.map((product) => product.id);
  sortShopProducts(products, "price-high");
  assert.deepEqual(products.map((product) => product.id), originalOrder);
});
