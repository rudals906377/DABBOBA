import assert from "node:assert/strict";
import test from "node:test";
import {
  isExchangeListingTransitionAllowed,
  isExchangeOfferTransitionAllowed,
  orderedInventoryIds,
} from "./exchange.js";

test("exchange listing lifecycle permits only forward terminal transitions", () => {
  assert.equal(isExchangeListingTransitionAllowed("OPEN", "MATCHED"), true);
  assert.equal(isExchangeListingTransitionAllowed("OPEN", "CANCELLED"), true);
  assert.equal(isExchangeListingTransitionAllowed("MATCHED", "COMPLETED"), true);
  assert.equal(isExchangeListingTransitionAllowed("MATCHED", "CANCELLED"), true);
  assert.equal(isExchangeListingTransitionAllowed("COMPLETED", "OPEN"), false);
  assert.equal(isExchangeListingTransitionAllowed("CANCELLED", "MATCHED"), false);
});

test("exchange offers cannot be reopened after a decision or withdrawal", () => {
  for (const terminal of ["ACCEPTED", "REJECTED", "WITHDRAWN"] as const) {
    assert.equal(isExchangeOfferTransitionAllowed("PENDING", terminal), true);
    assert.equal(isExchangeOfferTransitionAllowed(terminal, "PENDING"), false);
  }
});

test("inventory locks use one stable unique ordering", () => {
  assert.deepEqual(
    orderedInventoryIds([
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ]),
    [
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ],
  );
});
