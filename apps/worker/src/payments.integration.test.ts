import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  createDatabasePool,
  createMigrationDatabasePool,
  WORKER_DATABASE_ROLE,
} from "@dabboba/db";
import { InicisInquiryPaymentProvider } from "./inicis-inquiry.js";
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

test("read-only KG INICIS observations create review/error records without mutating payment or order ledgers", {
  skip: !migrationDatabaseUrl || !workerDatabaseUrl,
  timeout: 30_000,
}, async (t) => {
  const fixturePool = createMigrationDatabasePool(
    migrationDatabaseUrl!,
    "dabboba-worker-inicis-fixture-integration",
  );
  const workerPool = createDatabasePool(
    workerDatabaseUrl!,
    "dabboba-worker-inicis-integration",
    { expectedRole: WORKER_DATABASE_ROLE },
  );
  const userId = randomUUID();
  const orderIds = [randomUUID(), randomUUID()];
  const paymentIds = [randomUUID(), randomUUID()] as const;
  const tids = ["StdpayCARD19800101000000000001", "StdpayCARD19800102000000000002"];
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
    [userId, `worker-inicis-${userId}@example.test`, `이니시스조정${userId.slice(0, 8)}`],
  );
  for (let index = 0; index < orderIds.length; index += 1) {
    const createdAt = new Date(`1980-01-0${index + 1}T00:00:00.000Z`);
    await fixturePool.query(
      `INSERT INTO orders(id,user_id,subtotal,total,created_at,updated_at)
       VALUES($1,$2,12300,12300,$3,$3)`,
      [orderIds[index], userId, createdAt],
    );
    await fixturePool.query(
      `INSERT INTO payments(
         id,order_id,provider,provider_payment_id,amount,currency,created_at,updated_at
       ) VALUES($1,$2,'KG_INICIS',$3,12300,'KRW',$4,$4)`,
      [paymentIds[index], orderIds[index], tids[index], createdAt],
    );
  }

  const requestedTids: string[] = [];
  const provider = new InicisInquiryPaymentProvider({
    environment: "TEST",
    mid: "INIpayTest",
    iniApiKey: "fixture-inicis-api-key",
    clientIp: "127.0.0.1",
  }, {
    now: () => new Date("1990-01-01T00:00:00.000Z"),
    async fetch(_input, init) {
      const originalTid = new URLSearchParams(String(init?.body)).get("originalTid");
      assert.ok(originalTid);
      requestedTids.push(originalTid);
      const isMismatch = originalTid === tids[1];
      return new Response(JSON.stringify({
        resultCode: "00",
        tid: originalTid,
        price: isMismatch ? "12301" : "12300",
        status: "0",
      }), { headers: { "content-type": "application/json" } });
    },
  });
  const loggedErrors: Record<string, unknown>[] = [];
  const logger: Logger = {
    debug() {},
    info() {},
    warn() {},
    error(fields) { loggedErrors.push(fields); },
  };
  const now = new Date("1990-01-01T00:00:00.000Z");

  const approved = await reconcilePaymentBatch(
    workerPool,
    provider,
    { batchSize: 1, staleMinutes: 10 },
    logger,
    now,
  );
  assert.deepEqual(approved, { examined: 1, unknown: 0, manualReview: 1, failed: 0 });

  const mismatch = await reconcilePaymentBatch(
    workerPool,
    provider,
    { batchSize: 1, staleMinutes: 10 },
    logger,
    now,
  );
  assert.deepEqual(mismatch, { examined: 1, unknown: 0, manualReview: 0, failed: 1 });
  assert.deepEqual(requestedTids, tids);

  const reconciliation = await fixturePool.query<{
    payment_id: string;
    last_outcome: string;
    last_observed_state: string | null;
    last_error: string | null;
  }>(
    `SELECT payment_id,last_outcome,last_observed_state,last_error
       FROM worker_payment_reconciliations
      WHERE payment_id=ANY($1::uuid[])
      ORDER BY payment_id`,
    [paymentIds],
  );
  const byPayment = new Map(reconciliation.rows.map((row) => [row.payment_id, row]));
  assert.deepEqual(byPayment.get(paymentIds[0]), {
    payment_id: paymentIds[0],
    last_outcome: "MANUAL_REVIEW",
    last_observed_state: "PAID",
    last_error: null,
  });
  assert.equal(byPayment.get(paymentIds[1])?.last_outcome, "ERROR");
  assert.equal(byPayment.get(paymentIds[1])?.last_observed_state, null);
  assert.equal(byPayment.get(paymentIds[1])?.last_error, "Error");
  assert.equal(loggedErrors.length, 1);
  assert.equal(Object.values(loggedErrors[0] ?? {}).some((value) => String(value).includes(tids[1]!)), false);

  const ledgers = await fixturePool.query<{
    payment_id: string;
    payment_status: string;
    order_status: string;
  }>(
    `SELECT p.id AS payment_id,p.status AS payment_status,o.status AS order_status
       FROM payments p
       JOIN orders o ON o.id=p.order_id
      WHERE p.id=ANY($1::uuid[])
      ORDER BY p.id`,
    [paymentIds],
  );
  assert.equal(ledgers.rows.every((row) => row.payment_status === "PENDING"), true);
  assert.equal(ledgers.rows.every((row) => row.order_status === "PENDING_PAYMENT"), true);
});
