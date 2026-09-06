import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCommittedDrawResultMatchesRoute,
  isCommittedDrawSequenceConsumed,
  resolveCommittedDrawSequence,
} from "../apps/mobile/src/features/draw/draw-reveal-sequence.ts";

const FIRST_ENTITLEMENT_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ENTITLEMENT_ID = "22222222-2222-4222-8222-222222222222";
const THIRD_ENTITLEMENT_ID = "33333333-3333-4333-8333-333333333333";

test("checkout completion requires proof of every authoritative entitlement, not just the last route", () => {
  const expected = [FIRST_ENTITLEMENT_ID, SECOND_ENTITLEMENT_ID];
  assert.equal(isCommittedDrawSequenceConsumed(expected, [SECOND_ENTITLEMENT_ID]), false);
  assert.equal(isCommittedDrawSequenceConsumed(expected, [FIRST_ENTITLEMENT_ID, THIRD_ENTITLEMENT_ID]), false);
  assert.equal(isCommittedDrawSequenceConsumed(expected, expected), true);
  assert.equal(isCommittedDrawSequenceConsumed(expected, [...expected, FIRST_ENTITLEMENT_ID]), true);
  assert.equal(isCommittedDrawSequenceConsumed([], []), false);
  assert.equal(isCommittedDrawSequenceConsumed([FIRST_ENTITLEMENT_ID, FIRST_ENTITLEMENT_ID], expected), false);
  assert.equal(isCommittedDrawSequenceConsumed(["not-an-entitlement"], ["not-an-entitlement"]), false);
});

test("a committed draw sequence keeps the server entitlement order and resumes from the URL entitlement", () => {
  const encodedSequence = [
    FIRST_ENTITLEMENT_ID,
    SECOND_ENTITLEMENT_ID,
    THIRD_ENTITLEMENT_ID,
  ].join(",");

  assert.deepEqual(resolveCommittedDrawSequence(SECOND_ENTITLEMENT_ID, encodedSequence), {
    entitlementIds: [FIRST_ENTITLEMENT_ID, SECOND_ENTITLEMENT_ID, THIRD_ENTITLEMENT_ID],
    activeIndex: 1,
    activeEntitlementId: SECOND_ENTITLEMENT_ID,
    nextEntitlementId: THIRD_ENTITLEMENT_ID,
    total: 3,
  });
});

test("an invalid, duplicated, or mismatched entitlement list safely falls back to the path entitlement", () => {
  assert.deepEqual(
    resolveCommittedDrawSequence(FIRST_ENTITLEMENT_ID, `${FIRST_ENTITLEMENT_ID},${FIRST_ENTITLEMENT_ID}`),
    {
      entitlementIds: [FIRST_ENTITLEMENT_ID],
      activeIndex: 0,
      activeEntitlementId: FIRST_ENTITLEMENT_ID,
      nextEntitlementId: null,
      total: 1,
    },
  );
  assert.deepEqual(
    resolveCommittedDrawSequence(FIRST_ENTITLEMENT_ID, SECOND_ENTITLEMENT_ID),
    {
      entitlementIds: [FIRST_ENTITLEMENT_ID],
      activeIndex: 0,
      activeEntitlementId: FIRST_ENTITLEMENT_ID,
      nextEntitlementId: null,
      total: 1,
    },
  );
  assert.deepEqual(resolveCommittedDrawSequence("not-a-uuid", SECOND_ENTITLEMENT_ID), {
    entitlementIds: [],
    activeIndex: -1,
    activeEntitlementId: null,
    nextEntitlementId: null,
    total: 0,
  });
});

test("the client rejects a response for another entitlement, product, or sealed kuji slot", () => {
  const committed = {
    entitlementId: SECOND_ENTITLEMENT_ID,
    productId: "evangelion-kuji",
    kujiSlotNumber: 12,
  };

  assert.doesNotThrow(() => assertCommittedDrawResultMatchesRoute(committed, {
    entitlementId: SECOND_ENTITLEMENT_ID,
    productId: "evangelion-kuji",
    kujiSlotNumber: 12,
  }));
  assert.throws(() => assertCommittedDrawResultMatchesRoute(committed, {
    entitlementId: FIRST_ENTITLEMENT_ID,
    productId: "evangelion-kuji",
    kujiSlotNumber: 12,
  }), /추첨권/);
  assert.throws(() => assertCommittedDrawResultMatchesRoute(committed, {
    entitlementId: SECOND_ENTITLEMENT_ID,
    productId: "gundam-kuji",
    kujiSlotNumber: 12,
  }), /상품/);
  assert.throws(() => assertCommittedDrawResultMatchesRoute(committed, {
    entitlementId: SECOND_ENTITLEMENT_ID,
    productId: "evangelion-kuji",
    kujiSlotNumber: 13,
  }), /번호/);
});
