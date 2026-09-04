import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  createDatabasePool,
  createMigrationDatabasePool,
  WORKER_DATABASE_ROLE,
} from "@dabboba/db";
import type { Logger } from "./logger.js";
import { reconcilePaymentBatch } from "./payments.js";

const migrationDatabaseUrl = process.env.DATABASE_MIGRATION_URL;
const workerDatabaseUrl = process.env.DABBOBA_WORKER_TEST_DATABASE_URL;

test("payment reconciliation scheduling rotates a batch-full persistent set", {
  skip: !migrationDatabaseUrl || !workerDatabaseUrl,
  timeout: 30_000,
}, async (t) => {
  const fixturePool = createMigrationDatabasePool(
    migrationDatabaseUrl!,
    "dabboba-worker-payment-fixture-integration",
  );
  const workerPool = createDatabasePool(
    workerDatabaseUrl!,
    "dabboba-worker-payment-integration",
    { expectedRole: WORKER_DATABASE_ROLE },
  );
  const userId = randomUUID();
  const orderIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const paymentIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  t.after(async () => {
    await fixturePool.query(
      "DELETE FROM worker_payment_reconciliations WHERE payment_id=ANY($1::uuid[])",
      [paymentIds],
    ).catch(() => undefined);
    await fixturePool.query("DELETE FROM payments WHERE id=ANY($1::uuid[])", [paymentIds]).catch(() => undefined);
    await fixturePool.query("DELETE FROM orders WHERE id=ANY($1::uuid[])", [orderIds]).catch(() => undefined);
    await fixturePool.query("DELETE FROM users WHERE id=$1", [userId]).catch(() => undefined);
    await Promise.all([fixturePool.end(), workerPool.end()]);
  });

  const identity = await workerPool.query<{ current_user: string }>("SELECT current_user");
  assert.equal(identity.rows[0]?.current_user, WORKER_DATABASE_ROLE);

  await fixturePool.query(
    "INSERT INTO users(id,email,nickname) VALUES($1,$2,$3)",
    [userId, `worker-payment-${userId}@example.test`, `결제조정${userId.slice(0, 8)}`],
  );
  const now = new Date();
  const fixtureBase = new Date("2000-01-01T00:00:00.000Z");
  for (let index = 0; index < orderIds.length; index += 1) {
    await fixturePool.query(
      `INSERT INTO orders(id,user_id,subtotal,total,created_at,updated_at)
       VALUES($1,$2,1000,1000,$3,$3)`,
      [orderIds[index], userId, new Date(fixtureBase.getTime() + index * 60_000)],
    );
    await fixturePool.query(
      `INSERT INTO payments(id,order_id,provider,amount,created_at,updated_at)
       VALUES($1,$2,'TEST_PG',1000,$3,$3)`,
      [paymentIds[index], orderIds[index], new Date(fixtureBase.getTime() + index * 60_000)],
    );
  }

  const observed: string[] = [];
  const provider = {
    async observe(payment: { id: string }) {
      observed.push(payment.id);
      return { state: "UNKNOWN" as const, observedAt: now.toISOString() };
    },
  };
  const logger = { debug() {}, info() {}, warn() {}, error() {} } as Logger;

  const first = await reconcilePaymentBatch(
    workerPool,
    provider,
    { batchSize: 2, staleMinutes: 10 },
    logger,
    now,
  );
  assert.deepEqual(first, { examined: 2, unknown: 2, manualReview: 0, failed: 0 });

  const second = await reconcilePaymentBatch(
    workerPool,
    provider,
    { batchSize: 2, staleMinutes: 10 },
    logger,
    now,
  );
  assert.deepEqual(second, { examined: 2, unknown: 2, manualReview: 0, failed: 0 });
  assert.deepEqual(new Set(observed), new Set(paymentIds));

  const schedules = await fixturePool.query<{
    payment_id: string;
    attempts: number;
    last_outcome: string;
    next_attempt_at: Date;
  }>(
    `SELECT payment_id,attempts,last_outcome,next_attempt_at
       FROM worker_payment_reconciliations
      WHERE payment_id=ANY($1::uuid[])`,
    [paymentIds],
  );
  assert.equal(schedules.rowCount, 4);
  assert.equal(schedules.rows.every((row) => row.attempts === 1), true);
  assert.equal(schedules.rows.every((row) => row.last_outcome === "UNKNOWN"), true);
  assert.equal(schedules.rows.every((row) => row.next_attempt_at.getTime() > now.getTime()), true);

  const resetPaymentId = paymentIds[0]!;
  await fixturePool.query(
    `UPDATE worker_payment_reconciliations
        SET payment_version=payment_version+1,attempts=8
      WHERE payment_id=$1`,
    [resetPaymentId],
  );
  const afterVersionChange = await reconcilePaymentBatch(
    workerPool,
    provider,
    { batchSize: 1, staleMinutes: 10 },
    logger,
    now,
  );
  assert.deepEqual(afterVersionChange, { examined: 1, unknown: 1, manualReview: 0, failed: 0 });
  assert.equal(observed.at(-1), resetPaymentId);
  const resetSchedule = await fixturePool.query<{ payment_version: number; attempts: number }>(
    `SELECT payment_version,attempts
       FROM worker_payment_reconciliations
      WHERE payment_id=$1`,
    [resetPaymentId],
  );
  assert.deepEqual(resetSchedule.rows, [{ payment_version: 1, attempts: 1 }]);
});
