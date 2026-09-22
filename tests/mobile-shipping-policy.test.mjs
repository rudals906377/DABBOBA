import assert from "node:assert/strict";
import { test } from "node:test";

import {
  GACHA_ONLY_FREE_SHIPPING_THRESHOLD,
  KUJI_INCLUDED_FREE_SHIPPING_THRESHOLD,
  STANDARD_SHIPPING_FEE,
  calculateShippingPolicy,
} from "../apps/mobile/src/features/profile/shipping-policy.ts";

const item = (sourceType, price) => ({ sourceType, price });

test("gacha-only shipping becomes free at 24,900 won", () => {
  const below = calculateShippingPolicy([
    item("GACHA", 14_899),
    item("GACHA", 10_000),
  ]);
  const exact = calculateShippingPolicy([
    item("GACHA", 14_900),
    item("GACHA", 10_000),
  ]);

  assert.equal(below.threshold, GACHA_ONLY_FREE_SHIPPING_THRESHOLD);
  assert.equal(below.qualifiesForFreeShipping, false);
  assert.equal(below.remainingForFreeShipping, 1);
  assert.equal(below.shippingFee, STANDARD_SHIPPING_FEE);
  assert.equal(exact.threshold, GACHA_ONLY_FREE_SHIPPING_THRESHOLD);
  assert.equal(exact.qualifiesForFreeShipping, true);
  assert.equal(exact.remainingForFreeShipping, 0);
  assert.equal(exact.shippingFee, 0);
});

test("one Kuji item raises the whole shipment threshold to 54,900 won", () => {
  const below = calculateShippingPolicy([
    item("GACHA", 30_000),
    item("KUJI", 24_899),
  ]);
  const exact = calculateShippingPolicy([
    item("GACHA", 30_000),
    item("KUJI", 24_900),
  ]);

  assert.equal(below.threshold, KUJI_INCLUDED_FREE_SHIPPING_THRESHOLD);
  assert.equal(below.qualifiesForFreeShipping, false);
  assert.equal(below.remainingForFreeShipping, 1);
  assert.equal(below.shippingFee, STANDARD_SHIPPING_FEE);
  assert.equal(exact.threshold, KUJI_INCLUDED_FREE_SHIPPING_THRESHOLD);
  assert.equal(exact.qualifiesForFreeShipping, true);
  assert.equal(exact.remainingForFreeShipping, 0);
  assert.equal(exact.shippingFee, 0);
});

test("an all-Kuji shipment also uses the 54,900 won threshold", () => {
  const policy = calculateShippingPolicy([item("KUJI", 54_900)]);

  assert.equal(policy.hasKuji, true);
  assert.equal(policy.threshold, KUJI_INCLUDED_FREE_SHIPPING_THRESHOLD);
  assert.equal(policy.qualifiesForFreeShipping, true);
  assert.equal(policy.shippingFee, 0);
});

test("an empty selection has no active free-shipping qualification", () => {
  const policy = calculateShippingPolicy([]);

  assert.equal(policy.subtotal, 0);
  assert.equal(policy.hasSelection, false);
  assert.equal(policy.qualifiesForFreeShipping, false);
  assert.equal(policy.remainingForFreeShipping, 0);
  assert.equal(policy.shippingFee, 0);
});
