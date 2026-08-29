import assert from "node:assert/strict";
import { test } from "node:test";

import {
  GACHA_ONLY_FREE_SHIPPING_THRESHOLD,
  MIXED_CATEGORY_FREE_SHIPPING_THRESHOLD,
  calculateShippingPolicy,
} from "../apps/mobile/src/features/profile/shipping-policy.ts";

const item = (category, price) => ({ category, price });

test("gacha-only shipping becomes free at 30,000 won", () => {
  const below = calculateShippingPolicy([
    item("gacha", 19_999),
    item("gacha", 10_000),
  ]);
  const exact = calculateShippingPolicy([
    item("gacha", 20_000),
    item("gacha", 10_000),
  ]);

  assert.equal(below.threshold, GACHA_ONLY_FREE_SHIPPING_THRESHOLD);
  assert.equal(below.qualifiesForFreeShipping, false);
  assert.equal(below.remainingForFreeShipping, 1);
  assert.equal(exact.threshold, GACHA_ONLY_FREE_SHIPPING_THRESHOLD);
  assert.equal(exact.qualifiesForFreeShipping, true);
  assert.equal(exact.remainingForFreeShipping, 0);
});

test("one non-gacha item raises the whole shipment threshold to 50,000 won", () => {
  const below = calculateShippingPolicy([
    item("gacha", 30_000),
    item("kuji", 19_999),
  ]);
  const exact = calculateShippingPolicy([
    item("gacha", 30_000),
    item("figure", 20_000),
  ]);

  assert.equal(below.threshold, MIXED_CATEGORY_FREE_SHIPPING_THRESHOLD);
  assert.equal(below.qualifiesForFreeShipping, false);
  assert.equal(below.remainingForFreeShipping, 1);
  assert.equal(exact.threshold, MIXED_CATEGORY_FREE_SHIPPING_THRESHOLD);
  assert.equal(exact.qualifiesForFreeShipping, true);
  assert.equal(exact.remainingForFreeShipping, 0);
});

test("an empty selection has no active free-shipping qualification", () => {
  const policy = calculateShippingPolicy([]);

  assert.equal(policy.subtotal, 0);
  assert.equal(policy.hasSelection, false);
  assert.equal(policy.qualifiesForFreeShipping, false);
  assert.equal(policy.remainingForFreeShipping, 0);
});
