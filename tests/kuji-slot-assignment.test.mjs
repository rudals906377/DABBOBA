import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assignSealedKujiSlots,
  projectPublicKujiSlotAvailability,
} from "../apps/api/src/lib/kuji-slot-assignment.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const fiftySlotTiers = Object.freeze([
  Object.freeze({ poolEntryId: "pool-s", tierCode: "S", tierRank: 0, quantity: 1 }),
  Object.freeze({ poolEntryId: "pool-a", tierCode: "A", tierRank: 1, quantity: 4 }),
  Object.freeze({ poolEntryId: "pool-b", tierCode: "B", tierRank: 2, quantity: 10 }),
  Object.freeze({ poolEntryId: "pool-c", tierCode: "C", tierRank: 3, quantity: 35 }),
]);

function createDeterministicRandomInt() {
  let cursor = 0;
  return (maxExclusive) => {
    const value = (cursor * 17 + 7) % maxExclusive;
    cursor += 1;
    return value;
  };
}

test("deterministically assigns one immutable sealed result to each of 50 slots", () => {
  const assignments = assignSealedKujiSlots(50, fiftySlotTiers, createDeterministicRandomInt());

  assert.equal(assignments.length, 50);
  assert.deepEqual(assignments.map(({ slotNumber }) => slotNumber), Array.from({ length: 50 }, (_, index) => index + 1));
  assert.equal(new Set(assignments.map(({ slotNumber }) => slotNumber)).size, 50);
  assert.deepEqual(
    Object.fromEntries(
      ["S", "A", "B", "C"].map((tierCode) => [
        tierCode,
        assignments.filter((assignment) => assignment.tierCode === tierCode).length,
      ]),
    ),
    { S: 1, A: 4, B: 10, C: 35 },
  );
  assert.deepEqual(
    assignments.slice(0, 10).map(({ tierCode }) => tierCode),
    ["S", "C", "A", "C", "B", "C", "B", "A", "B", "C"],
  );
  assert.equal(Object.isFrozen(assignments), true);
  assert.equal(assignments.every(Object.isFrozen), true);
  assert.equal(fiftySlotTiers[0].tierRank, 0, "lower tierRank means a higher prize tier");
});

test("rejects invalid totals, tier definitions, ranks, and quantity sums", () => {
  const valid = [{ poolEntryId: "pool-a", tierCode: "A", tierRank: 0, quantity: 1 }];
  const invalidInputs = [
    [0, valid],
    [10_001, valid],
    [1.5, valid],
    [1, [{ poolEntryId: "", tierCode: "A", tierRank: 0, quantity: 1 }]],
    [2, [{ poolEntryId: "pool-a", tierCode: "A", tierRank: 0, quantity: 1 }, { poolEntryId: " pool-a ", tierCode: "B", tierRank: 1, quantity: 1 }]],
    [1, [{ poolEntryId: "pool-a", tierCode: "", tierRank: 0, quantity: 1 }]],
    [2, [{ poolEntryId: "pool-a", tierCode: "A", tierRank: 0, quantity: 1 }, { poolEntryId: "pool-b", tierCode: " A ", tierRank: 1, quantity: 1 }]],
    [1, [{ poolEntryId: "pool-a", tierCode: "A", tierRank: 0, quantity: 0 }]],
    [1, [{ poolEntryId: "pool-a", tierCode: "A", tierRank: 0, quantity: 1.5 }]],
    [2, [{ poolEntryId: "pool-a", tierCode: "A", tierRank: 0, quantity: 1 }, { poolEntryId: "pool-b", tierCode: "B", tierRank: 0, quantity: 1 }]],
    [1, [{ poolEntryId: "pool-a", tierCode: "A", tierRank: -1, quantity: 1 }]],
    [1, [{ poolEntryId: "pool-a", tierCode: "A", tierRank: 0.5, quantity: 1 }]],
    [2, valid],
  ];

  for (const [total, tiers] of invalidInputs) {
    assert.throws(() => assignSealedKujiSlots(total, tiers, () => 0), RangeError);
  }
  assert.throws(
    () => assignSealedKujiSlots(
      2,
      [{ poolEntryId: "pool-a", tierCode: "A", tierRank: 0, quantity: 1 }, { poolEntryId: "pool-b", tierCode: "B", tierRank: 1, quantity: 1 }],
      () => 2,
    ),
    RangeError,
  );
});

test("public availability never leaks the sealed tier mapping", () => {
  const assignments = assignSealedKujiSlots(50, fiftySlotTiers, createDeterministicRandomInt());
  const projection = projectPublicKujiSlotAvailability(assignments, new Set([2, 17, 50]));

  assert.equal(projection.length, 50);
  assert.deepEqual(projection[0], { slotNumber: 1, available: true });
  assert.deepEqual(projection[1], { slotNumber: 2, available: false });
  assert.deepEqual(projection[49], { slotNumber: 50, available: false });
  assert.equal(Object.isFrozen(projection), true);
  assert.equal(projection.every(Object.isFrozen), true);
  assert.equal(projection.every((slot) => Object.keys(slot).sort().join(",") === "available,slotNumber"), true);
  assert.doesNotMatch(JSON.stringify(projection), /tier|rank|prize|pool|entry/i);
});

test("production randomness uses node crypto instead of client-style randomness", () => {
  const source = readFileSync(path.join(root, "apps/api/src/lib/kuji-slot-assignment.ts"), "utf8");

  assert.match(source, /from "node:crypto"/);
  assert.match(source, /cryptoRandomInt/);
  assert.doesNotMatch(source, /Math\.random/);
});
