import assert from "node:assert/strict";
import test from "node:test";
import type { DatabasePool } from "@dabboba/db";
import type { Logger } from "./logger.js";
import {
  paymentReconciliationDelayMs,
  reconcilePaymentBatch,
  requiresManualPaymentAction,
} from "./payments.js";

test("reconciliation observations never imply an automatic ledger mutation", () => {
  assert.equal(requiresManualPaymentAction("PENDING", "UNKNOWN"), false);
  assert.equal(requiresManualPaymentAction("PENDING", "PENDING"), false);
  assert.equal(requiresManualPaymentAction("PENDING", "PAID"), true);
  assert.equal(requiresManualPaymentAction("REFUND_REVIEW", "REFUNDED"), true);
});

test("payment reconciliation cadence backs off exponentially and caps at one day", () => {
  assert.equal(paymentReconciliationDelayMs(1, 10), 10 * 60_000);
  assert.equal(paymentReconciliationDelayMs(4, 10), 80 * 60_000);
  assert.equal(paymentReconciliationDelayMs(50, 10), 24 * 60 * 60_000);
  assert.equal(paymentReconciliationDelayMs(1, 10_080), 24 * 60 * 60_000);
});

test("payment batches select only due versions and persist the next attempt", async () => {
  const now = new Date("2026-09-04T00:00:00.000Z");
  const queries: Array<{ sql: string; values: unknown[] | undefined }> = [];
  const pool = {
    async query(sql: string, values?: unknown[]) {
      queries.push({ sql, values });
      if (sql.includes("FROM payments p")) {
        return {
          rowCount: 1,
          rows: [{
            id: "11111111-1111-4111-8111-111111111111",
            order_id: "22222222-2222-4222-8222-222222222222",
            provider: "TEST_PG",
            provider_payment_id: null,
            status: "PENDING",
            amount: 1_000,
            currency: "KRW",
            version: 3,
            updated_at: new Date("2026-09-03T00:00:00.000Z"),
            reconciliation_version: 3,
            reconciliation_attempts: 2,
          }],
        };
      }
      return { rowCount: 1, rows: [] };
    },
  } as unknown as DatabasePool;
  const logger = { debug() {}, info() {}, warn() {}, error() {} } as Logger;

  const result = await reconcilePaymentBatch(
    pool,
    { async observe() { return { state: "UNKNOWN", observedAt: now.toISOString() }; } },
    { batchSize: 5, staleMinutes: 10 },
    logger,
    now,
  );

  assert.deepEqual(result, { examined: 1, unknown: 1, manualReview: 0, failed: 0 });
  assert.match(queries[0]!.sql, /LEFT JOIN worker_payment_reconciliations/i);
  assert.match(queries[0]!.sql, /r\.payment_version <> p\.version/i);
  assert.match(queries[0]!.sql, /r\.next_attempt_at <= \$2/i);
  assert.equal(queries[0]!.values?.[2], 5);
  const schedule = queries[1]!;
  assert.match(schedule.sql, /ON CONFLICT \(payment_id\) DO UPDATE/i);
  assert.equal(schedule.values?.[2], 3);
  assert.equal(schedule.values?.[3], "UNKNOWN");
  assert.equal((schedule.values?.[7] as Date).toISOString(), "2026-09-04T00:40:00.000Z");
});

test("provider errors are durably deferred without blocking the rest of a batch", async () => {
  const now = new Date("2026-09-04T00:00:00.000Z");
  const scheduledOutcomes: unknown[] = [];
  const pool = {
    async query(sql: string, values?: unknown[]) {
      if (sql.includes("FROM payments p")) {
        return {
          rowCount: 2,
          rows: ["1", "2"].map((suffix) => ({
            id: `11111111-1111-4111-8111-11111111111${suffix}`,
            order_id: `22222222-2222-4222-8222-22222222222${suffix}`,
            provider: "TEST_PG",
            provider_payment_id: null,
            status: "PENDING",
            amount: 1_000,
            currency: "KRW",
            version: 1,
            updated_at: new Date("2026-09-03T00:00:00.000Z"),
            reconciliation_version: null,
            reconciliation_attempts: null,
          })),
        };
      }
      scheduledOutcomes.push(values?.[3]);
      return { rowCount: 1, rows: [] };
    },
  } as unknown as DatabasePool;
  const logger = { debug() {}, info() {}, warn() {}, error() {} } as Logger;
  let observations = 0;

  const result = await reconcilePaymentBatch(
    pool,
    {
      async observe() {
        observations += 1;
        if (observations === 1) throw new Error("provider unavailable");
        return { state: "UNKNOWN", observedAt: now.toISOString() };
      },
    },
    { batchSize: 2, staleMinutes: 10 },
    logger,
    now,
  );

  assert.deepEqual(result, { examined: 2, unknown: 1, manualReview: 0, failed: 1 });
  assert.deepEqual(scheduledOutcomes, ["ERROR", "UNKNOWN"]);
});
