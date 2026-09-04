import assert from "node:assert/strict";
import test from "node:test";
import {
  EXCHANGE_BUNDLE_MAX_ITEMS,
  toggleExchangeInventorySelection,
} from "../apps/mobile/src/features/exchange/exchange-selection.ts";

test("exchange bundle selection supports one or two items and never exceeds the limit", () => {
  assert.equal(EXCHANGE_BUNDLE_MAX_ITEMS, 2);
  assert.deepEqual(toggleExchangeInventorySelection([], "inventory-a"), ["inventory-a"]);
  assert.deepEqual(toggleExchangeInventorySelection(["inventory-a"], "inventory-b"), [
    "inventory-a",
    "inventory-b",
  ]);
  assert.deepEqual(
    toggleExchangeInventorySelection(["inventory-a", "inventory-b"], "inventory-c"),
    ["inventory-a", "inventory-b"],
  );
});

test("tapping a selected exchange item removes it so another item can be chosen", () => {
  assert.deepEqual(
    toggleExchangeInventorySelection(["inventory-a", "inventory-b"], "inventory-a"),
    ["inventory-b"],
  );
});
