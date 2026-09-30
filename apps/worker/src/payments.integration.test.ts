import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  createMigrationDatabasePool,
  type DatabasePool,
  WORKER_DATABASE_ROLE,
} from "@dabboba/db";
import { InicisInquiryPaymentProvider } from "./inicis-inquiry.js";
import type { Logger } from "./logger.js";
import { reconcilePaymentBatch } from "./payments.js";

const migrationDatabaseUrl = process.env.DATABASE_MIGRATION_URL;

async function workerRoleSession(databaseUrl: string, applicationName: string) {
  // The production worker role is deliberately NOLOGIN. Exercise its actual
  // privileges through SET ROLE instead of making it login-capable for tests.
  const pool = createMigrationDatabasePool(databaseUrl, applicationName);
  const client = await pool.connect();
  try {
    await client.query(`SET ROLE ${WORKER_DATABASE_ROLE}`);
  } catch (error) {
    client.release();
    await pool.end();
    throw error;
  }
  return {
    workerPool: { query(sql: string, values?: unknown[]) {
      return client.query(sql, values);
    } } as unknown as DatabasePool,
    async close() {
      await client.query("RESET ROLE").catch(() => undefined);
      client.release();
      await pool.end();
    },
  };
}

test("payment reconciliation scheduling rotates a batch-full persistent set", {
  skip: !migrationDatabaseUrl,
  timeout: 30_000,
}, async (t) => {
  const fixturePool = createMigrationDatabasePool(
    migrationDatabaseUrl!,
    "dabboba-worker-payment-fixture-integration",
  );
  const workerSession = await workerRoleSession(migrationDatabaseUrl!, "dabboba-worker-payment-integration");
  const workerPool = workerSession.workerPool;
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
    await Promise.all([fixturePool.end(), workerSession.close()]);
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
  assert.deepEqual(first, { examined: 2, unknown: 2, manualReview: 0, reconciled: 0, failed: 0 });

  const second = await reconcilePaymentBatch(
    workerPool,
    provider,
    { batchSize: 2, staleMinutes: 10 },
    logger,
    now,
  );
  assert.deepEqual(second, { examined: 2, unknown: 2, manualReview: 0, reconciled: 0, failed: 0 });
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
  assert.deepEqual(afterVersionChange, { examined: 1, unknown: 1, manualReview: 0, reconciled: 0, failed: 0 });
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
  skip: !migrationDatabaseUrl,
  timeout: 30_000,
}, async (t) => {
  const fixturePool = createMigrationDatabasePool(
    migrationDatabaseUrl!,
    "dabboba-worker-inicis-fixture-integration",
  );
  const workerSession = await workerRoleSession(migrationDatabaseUrl!, "dabboba-worker-inicis-integration");
  const workerPool = workerSession.workerPool;
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
    await Promise.all([fixturePool.end(), workerSession.close()]);
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
  assert.deepEqual(approved, { examined: 1, unknown: 0, manualReview: 1, reconciled: 0, failed: 0 });

  const mismatch = await reconcilePaymentBatch(
    workerPool,
    provider,
    { batchSize: 1, staleMinutes: 10 },
    logger,
    now,
  );
  assert.deepEqual(mismatch, { examined: 1, unknown: 0, manualReview: 0, reconciled: 0, failed: 1 });
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

test("restricted worker records a verified API transition but cannot directly update payments", {
  skip: !migrationDatabaseUrl,
  timeout: 30_000,
}, async (t) => {
  const pool = createMigrationDatabasePool(migrationDatabaseUrl!, "dabboba-worker-portone-requery-fixture");
  const client = await pool.connect();
  const userId = randomUUID();
  const orderId = randomUUID();
  const paymentId = randomUUID();
  t.after(async () => {
    await client.query("RESET ROLE").catch(() => undefined);
    client.release();
    await pool.query("DELETE FROM worker_payment_reconciliations WHERE payment_id=$1", [paymentId]).catch(() => undefined);
    await pool.query("DELETE FROM payments WHERE id=$1", [paymentId]).catch(() => undefined);
    await pool.query("DELETE FROM orders WHERE id=$1", [orderId]).catch(() => undefined);
    await pool.query("DELETE FROM users WHERE id=$1", [userId]).catch(() => undefined);
    await pool.end();
  });
  await pool.query("INSERT INTO users(id,email,nickname) VALUES($1,$2,$3)", [
    userId, `portone-worker-${userId}@example.test`, `재조회${userId.slice(0, 8)}`,
  ]);
  await pool.query("INSERT INTO orders(id,user_id,subtotal,total,created_at,updated_at) VALUES($1,$2,10000,10000,'2000-01-01','2000-01-01')", [orderId, userId]);
  await pool.query("INSERT INTO payments(id,order_id,provider,amount,created_at,updated_at) VALUES($1,$2,'PORTONE_V2_INICIS',10000,'2000-01-01','2000-01-01')", [paymentId, orderId]);
  await client.query("SET ROLE dabboba_worker");
  const role = await client.query<{ current_user: string }>("SELECT current_user");
  assert.equal(role.rows[0]?.current_user, WORKER_DATABASE_ROLE);
  await assert.rejects(client.query("UPDATE payments SET status='PAID' WHERE id=$1", [paymentId]), /worker cannot perform this payment transition/);
  const allowed = await client.query<{ status: string }>(
    "UPDATE payments SET status='CANCELLED',version=version+1 WHERE id=$1 AND status='PENDING' RETURNING status", [paymentId],
  );
  assert.equal(allowed.rows[0]?.status, "CANCELLED");
  await pool.query("UPDATE payments SET status='PENDING',version=version+1 WHERE id=$1", [paymentId]);
  const restrictedPool = { query(sql: string, values?: unknown[]) {
    // This local database can contain unrelated test fixtures; scope the batch
    // to the payment whose transition is being verified.
    if (sql.includes("FROM payments p") && sql.includes("ORDER BY")) {
      return client.query(sql.replace("ORDER BY", "AND p.id=$4 ORDER BY"), [...(values ?? []), paymentId]);
    }
    return client.query(sql, values);
  } } as unknown as Parameters<typeof reconcilePaymentBatch>[0];
  const logger = { debug() {}, info() {}, warn() {}, error() {} } as Logger;
  const summary = await reconcilePaymentBatch(restrictedPool, {
    async observe(payment) {
      assert.equal(payment.id, paymentId);
      // Represents the separately tested API's verified PortOne/ledger transition.
      const updated = await pool.query<{ status: string }>(
        "UPDATE payments SET status='PAID',version=version+1 WHERE id=$1 RETURNING status", [paymentId],
      );
      assert.equal(updated.rows[0]?.status, "PAID");
      const visible = await client.query<{ status: string }>("SELECT status FROM payments WHERE id=$1", [paymentId]);
      assert.equal(visible.rows[0]?.status, "PAID");
      return { state: "PAID", canonicalStatus: "PAID", observedAt: new Date().toISOString() };
    },
  }, { batchSize: 1, staleMinutes: 10 }, logger, new Date(Date.now() + 11 * 60_000));
  assert.deepEqual(summary, { examined: 1, unknown: 0, manualReview: 0, reconciled: 1, failed: 0 });
  const record = await client.query<{ last_outcome: string; last_observed_state: string }>(
    "SELECT last_outcome,last_observed_state FROM worker_payment_reconciliations WHERE payment_id=$1", [paymentId],
  );
  assert.deepEqual(record.rows, [{ last_outcome: "RECONCILED", last_observed_state: "PAID" }]);
});

test("restricted worker retries only claimed cancelled PortOne payments until a verified no-charge result", {
  skip: !migrationDatabaseUrl,
  timeout: 30_000,
}, async (t) => {
  const fixturePool = createMigrationDatabasePool(migrationDatabaseUrl!, "dabboba-cancelled-requery-fixture");
  const workerSession = await workerRoleSession(migrationDatabaseUrl!, "dabboba-cancelled-requery-worker");
  const userId = randomUUID();
  const orderIds = [randomUUID(), randomUUID()];
  const paymentIds = [randomUUID(), randomUUID()];
  t.after(async () => {
    await fixturePool.query("DELETE FROM worker_payment_reconciliations WHERE payment_id=ANY($1::uuid[])", [paymentIds]).catch(() => undefined);
    await fixturePool.query("DELETE FROM payments WHERE id=ANY($1::uuid[])", [paymentIds]).catch(() => undefined);
    await fixturePool.query("DELETE FROM orders WHERE id=ANY($1::uuid[])", [orderIds]).catch(() => undefined);
    await fixturePool.query("DELETE FROM users WHERE id=$1", [userId]).catch(() => undefined);
    await Promise.all([fixturePool.end(), workerSession.close()]);
  });
  await fixturePool.query("INSERT INTO users(id,email,nickname) VALUES($1,$2,$3)", [
    userId, `cancelled-requery-${userId}@example.test`, `만료 결제 ${userId.slice(0, 8)}`,
  ]);
  for (let index = 0; index < orderIds.length; index += 1) {
    await fixturePool.query(
      "INSERT INTO orders(id,user_id,status,subtotal,total,cancelled_at,created_at,updated_at) VALUES($1,$2,'CANCELLED',10000,10000,'2000-01-01','2000-01-01','2000-01-01')",
      [orderIds[index], userId],
    );
    await fixturePool.query(
      `INSERT INTO payments(id,order_id,provider,status,amount,pg_attempt_started_at,created_at,updated_at)
       VALUES($1,$2,'PORTONE_V2_INICIS','CANCELLED',10000,$3,'2000-01-01','2000-01-01')`,
      [paymentIds[index], orderIds[index], index === 0 ? new Date("2000-01-01T00:00:00.000Z") : null],
    );
  }
  const scopedPool = { query(sql: string, values?: unknown[]) {
    if (sql.includes("FROM payments p") && sql.includes("ORDER BY")) {
      return workerSession.workerPool.query(sql.replace("ORDER BY", "AND p.id=ANY($4::uuid[]) ORDER BY"), [
        ...(values ?? []), paymentIds,
      ]);
    }
    return workerSession.workerPool.query(sql, values);
  } } as unknown as DatabasePool;
  const observed: string[] = [];
  const logger = { debug() {}, info() {}, warn() {}, error() {} } as Logger;
  const provider = { async observe(payment: { id: string }) {
    observed.push(payment.id);
    return { state: "CANCELLED" as const, canonicalStatus: "CANCELLED", observedAt: new Date().toISOString() };
  } };
  const now = new Date();
  const first = await reconcilePaymentBatch(scopedPool, provider, { batchSize: 2, staleMinutes: 10 }, logger, now);
  assert.deepEqual(first, { examined: 1, unknown: 0, manualReview: 0, reconciled: 1, failed: 0 });
  assert.deepEqual(observed, [paymentIds[0]]);
  const second = await reconcilePaymentBatch(scopedPool, provider, { batchSize: 2, staleMinutes: 10 }, logger, new Date(now.getTime() + 24 * 60 * 60_000));
  assert.deepEqual(second, { examined: 0, unknown: 0, manualReview: 0, reconciled: 0, failed: 0 });
  const ledger = await fixturePool.query<{ id: string; status: string; last_outcome: string | null }>(
    `SELECT p.id,p.status,r.last_outcome FROM payments p
     LEFT JOIN worker_payment_reconciliations r ON r.payment_id=p.id
     WHERE p.id=ANY($1::uuid[]) ORDER BY p.id`, [paymentIds],
  );
  assert.equal(ledger.rows.every((row) => row.status === "CANCELLED"), true);
  assert.equal(ledger.rows.find((row) => row.id === paymentIds[0])?.last_outcome, "RECONCILED");
  assert.equal(ledger.rows.find((row) => row.id === paymentIds[1])?.last_outcome, null);
});

test("restricted worker closes expired READY PG windows as PENDING_EXPIRED without touching payments", {
  skip: !migrationDatabaseUrl,
  timeout: 30_000,
}, async (t) => {
  const fixturePool = createMigrationDatabasePool(migrationDatabaseUrl!, "dabboba-expired-window-fixture");
  const workerSession = await workerRoleSession(migrationDatabaseUrl!, "dabboba-expired-window-worker");
  const userId = randomUUID();
  const orderIds = [randomUUID(), randomUUID(), randomUUID()];
  const paymentIds = [randomUUID(), randomUUID(), randomUUID()];
  t.after(async () => {
    await fixturePool.query("DELETE FROM worker_payment_reconciliations WHERE payment_id=ANY($1::uuid[])", [paymentIds]).catch(() => undefined);
    await fixturePool.query("DELETE FROM payments WHERE id=ANY($1::uuid[])", [paymentIds]).catch(() => undefined);
    await fixturePool.query("DELETE FROM orders WHERE id=ANY($1::uuid[])", [orderIds]).catch(() => undefined);
    await fixturePool.query("DELETE FROM users WHERE id=$1", [userId]).catch(() => undefined);
    await Promise.all([fixturePool.end(), workerSession.close()]);
  });
  await fixturePool.query("INSERT INTO users(id,email,nickname) VALUES($1,$2,$3)", [
    userId, `expired-window-${userId}@example.test`, `만료 창 ${userId.slice(0, 8)}`,
  ]);
  const now = new Date();
  const longAgo = new Date(now.getTime() - 2 * 60 * 60_000);
  const recently = new Date(now.getTime() - 5 * 60_000);
  // [0] cancelled by the sweep after a claim, [1] still pending after a claim,
  // [2] claimed only five minutes ago (inside the 30-minute validity).
  const fixtures = [
    { status: "CANCELLED", orderStatus: "CANCELLED", claimedAt: longAgo },
    { status: "PENDING", orderStatus: "PENDING_PAYMENT", claimedAt: longAgo },
    { status: "CANCELLED", orderStatus: "CANCELLED", claimedAt: recently },
  ];
  for (let index = 0; index < fixtures.length; index += 1) {
    const fixture = fixtures[index]!;
    await fixturePool.query(
      "INSERT INTO orders(id,user_id,status,subtotal,total,created_at,updated_at) VALUES($1,$2,$3,10000,10000,'2000-01-01','2000-01-01')",
      [orderIds[index], userId, fixture.orderStatus],
    );
    await fixturePool.query(
      `INSERT INTO payments(id,order_id,provider,status,amount,pg_attempt_started_at,created_at,updated_at)
       VALUES($1,$2,'PORTONE_V2_INICIS',$3,10000,$4,'2000-01-01','2000-01-01')`,
      [paymentIds[index], orderIds[index], fixture.status, fixture.claimedAt],
    );
  }
  const scopedPool = { query(sql: string, values?: unknown[]) {
    if (sql.includes("FROM payments p") && sql.includes("ORDER BY")) {
      return workerSession.workerPool.query(sql.replace("ORDER BY", "AND p.id=ANY($4::uuid[]) ORDER BY"), [
        ...(values ?? []), paymentIds,
      ]);
    }
    return workerSession.workerPool.query(sql, values);
  } } as unknown as DatabasePool;
  const observed: string[] = [];
  const logger = { debug() {}, info() {}, warn() {}, error() {} } as Logger;
  // PortOne keeps reporting READY: the API reconciled nothing.
  const provider = { async observe(payment: { id: string; status: string }) {
    observed.push(payment.id);
    return {
      state: "PENDING" as const, canonicalStatus: payment.status, providerStatus: "READY",
      observedAt: new Date().toISOString(),
    };
  } };
  const options = { batchSize: 5, staleMinutes: 10, paymentWindowValidityMinutes: 30 };
  const first = await reconcilePaymentBatch(scopedPool, provider, options, logger, now);
  assert.deepEqual(first, { examined: 3, unknown: 0, manualReview: 1, reconciled: 2, failed: 0 });
  const records = async () => new Map((await fixturePool.query<{ payment_id: string; last_outcome: string; last_observed_state: string }>(
    "SELECT payment_id,last_outcome,last_observed_state FROM worker_payment_reconciliations WHERE payment_id=ANY($1::uuid[])",
    [paymentIds],
  )).rows.map((row) => [row.payment_id, `${row.last_outcome}/${row.last_observed_state}`]));
  const afterFirst = await records();
  assert.equal(afterFirst.get(paymentIds[0]!), "RECONCILED/PENDING");
  assert.equal(afterFirst.get(paymentIds[1]!), "RECONCILED/PENDING");
  assert.equal(afterFirst.get(paymentIds[2]!), "MANUAL_REVIEW/PENDING");

  // The closures are final for this payment version; only the in-validity
  // window is revisited once its own validity has passed.
  observed.length = 0;
  const later = new Date(now.getTime() + 24 * 60 * 60_000);
  const second = await reconcilePaymentBatch(scopedPool, provider, options, logger, later);
  assert.deepEqual(second, { examined: 1, unknown: 0, manualReview: 0, reconciled: 1, failed: 0 });
  assert.deepEqual(observed, [paymentIds[2]]);

  // The sweep cancelling the still-pending order bumps its version, which
  // re-opens exactly one verification before closing again.
  await fixturePool.query("UPDATE payments SET status='CANCELLED',version=version+1 WHERE id=$1", [paymentIds[1]]);
  observed.length = 0;
  const third = await reconcilePaymentBatch(scopedPool, provider, options, logger, later);
  assert.deepEqual(third, { examined: 1, unknown: 0, manualReview: 0, reconciled: 1, failed: 0 });
  assert.deepEqual(observed, [paymentIds[1]]);
  const fourth = await reconcilePaymentBatch(scopedPool, provider, options, logger, new Date(later.getTime() + 24 * 60 * 60_000));
  assert.equal(fourth.examined, 0);

  const ledger = await fixturePool.query<{ status: string }>(
    "SELECT status FROM payments WHERE id=ANY($1::uuid[])", [paymentIds],
  );
  assert.ok(ledger.rows.every((row) => row.status === "CANCELLED"));
});
