import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDrawPaymentConfirmation,
  buildGachaPreviewParams,
} from "../apps/mobile/src/features/kuji/kuji-selection-state.ts";

test("gacha and kuji payment confirmations share one current-price calculation", () => {
  assert.deepEqual(buildDrawPaymentConfirmation(9_900, 3, "개"), {
    count: 3,
    total: 29_700,
    message: "3개 · 29,700원",
  });
  assert.deepEqual(buildDrawPaymentConfirmation(9_900, 3, "장"), {
    count: 3,
    total: 29_700,
    message: "3장 · 29,700원",
  });
});

test("draw payment confirmation safely normalizes invalid price and count input", () => {
  assert.deepEqual(buildDrawPaymentConfirmation(-100, -2, "개"), {
    count: 0,
    total: 0,
    message: "0개 · 0원",
  });
  assert.deepEqual(buildDrawPaymentConfirmation(Number.NaN, Number.NaN, "개"), {
    count: 0,
    total: 0,
    message: "0개 · 0원",
  });
});

test("gacha payment confirmation opens the requested quantity directly", () => {
  assert.deepEqual(buildGachaPreviewParams(1), {
    category: "gacha",
    count: "1",
    mode: "single",
  });
  assert.deepEqual(buildGachaPreviewParams(3), {
    category: "gacha",
    count: "3",
    mode: "all",
  });
});
