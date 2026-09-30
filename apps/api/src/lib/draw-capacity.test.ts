import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseClient } from "@dabboba/db";
import { AppError } from "./errors.js";
import { assertDrawCapacity } from "./draw-capacity.js";

function capacityClient(entries: Array<number | null>, outstanding: number, weight = 1) {
  return {
    async query(sql: string) {
      if (sql.includes("pg_advisory_xact_lock")) return { rowCount: 1, rows: [{}] };
      if (sql.includes("FROM draw_pool_entries")) {
        return { rowCount: entries.length, rows: entries.map((remaining_quantity) => ({ weight, remaining_quantity })) };
      }
      if (sql.includes("FROM draw_entitlements")) return { rowCount: 1, rows: [{ count: String(outstanding) }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as DatabaseClient;
}

test("finite draw stock cannot exceed prizes left after paid outstanding entitlements", async () => {
  await assert.rejects(
    assertDrawCapacity(capacityClient([3, 2], 2), {
      probabilityVersionId: "11111111-1111-4111-8111-111111111111",
      productId: "finite-draw",
      onHand: 4,
    }),
    (error: unknown) => error instanceof AppError && error.statusCode === 409,
  );
  const capacity = await assertDrawCapacity(capacityClient([3, 2], 2), {
    probabilityVersionId: "11111111-1111-4111-8111-111111111111",
    productId: "finite-draw",
    onHand: 3,
  });
  assert.deepEqual(capacity, {
    unlimited: false,
    remainingPrizeUnits: 5,
    outstandingEntitlements: 2,
    sellableUnits: 3,
  });
});

test("an unlimited draw entry permits stock without a finite cap", async () => {
  const capacity = await assertDrawCapacity(capacityClient([null, 1], 99), {
    probabilityVersionId: "11111111-1111-4111-8111-111111111111",
    productId: "unlimited-draw",
    onHand: 10_000,
  });
  assert.equal(capacity.unlimited, true);
  assert.equal(capacity.sellableUnits, null);
});

test("quantity-ratio gacha rejects legacy weights and unlimited entries before checkout", async () => {
  for (const [entries, weight] of [[[5, 5], 2], [[null, 5], 1]] as const) {
    await assert.rejects(assertDrawCapacity(capacityClient([...entries], 0, weight), {
      probabilityVersionId: "11111111-1111-4111-8111-111111111111",
      productId: "gacha",
      onHand: 1,
      requireQuantityRatio: true,
    }), (error: unknown) => error instanceof AppError && error.statusCode === 409);
  }
});
