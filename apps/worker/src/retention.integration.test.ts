import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  createDatabasePool,
  createMigrationDatabasePool,
  WORKER_DATABASE_ROLE,
} from "@dabboba/db";
import { DEFAULT_WORKER_RETENTION } from "./config.js";
import type { Logger } from "./logger.js";
import { runRetentionBatch } from "./retention.js";

const migrationDatabaseUrl = process.env.DATABASE_MIGRATION_URL;
const workerDatabaseUrl = process.env.DABBOBA_WORKER_TEST_DATABASE_URL;
const logger = { debug() {}, info() {}, warn() {}, error() {} } as Logger;

test("worker retention deletes only expired, unreferenced rows and rolls Home clicks into daily totals", {
  skip: !migrationDatabaseUrl || !workerDatabaseUrl,
  timeout: 60_000,
}, async (t) => {
  const fixturePool = createMigrationDatabasePool(migrationDatabaseUrl!, "dabboba-worker-retention-fixture");
  const workerPool = createDatabasePool(workerDatabaseUrl!, "dabboba-worker-retention-integration", {
    expectedRole: WORKER_DATABASE_ROLE,
  });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const userId = randomUUID();
  const ipId = `worker-retention-ip-${suffix}`;
  const productId = `worker-retention-product-${suffix}`;
  const correlation = `worker-retention-${suffix}`;
  const sessionIds = {
    revoked: randomUUID(),
    expiredParent: randomUUID(),
    child: randomUUID(),
    active: randomUUID(),
  };
  const clickIds = { oldA: randomUUID(), oldB: randomUUID(), recent: randomUUID() };

  t.after(async () => {
    await fixturePool.query("DELETE FROM outbox_events WHERE correlation_id LIKE $1", [`${correlation}%`]).catch(() => undefined);
    await fixturePool.query("DELETE FROM idempotency_keys WHERE actor_id=$1", [userId]).catch(() => undefined);
    await fixturePool.query("DELETE FROM sessions WHERE id=$1", [sessionIds.child]).catch(() => undefined);
    await fixturePool.query("DELETE FROM sessions WHERE user_id=$1", [userId]).catch(() => undefined);
    await fixturePool.query("DELETE FROM home_product_click_daily WHERE product_id=$1", [productId]).catch(() => undefined);
    const client = await fixturePool.connect();
    try {
      // Raw click rows are immutable; the superuser CI fixture bypasses the
      // guard trigger only to remove its own test rows.
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("DELETE FROM home_product_click_events WHERE product_id=$1", [productId]);
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK").catch(() => undefined);
    } finally {
      client.release();
    }
    await fixturePool.query("DELETE FROM catalog_products WHERE id=$1", [productId]).catch(() => undefined);
    await fixturePool.query("DELETE FROM catalog_ips WHERE id=$1", [ipId]).catch(() => undefined);
    await fixturePool.query("DELETE FROM users WHERE id=$1", [userId]).catch(() => undefined);
    await Promise.all([fixturePool.end(), workerPool.end()]);
  });

  await fixturePool.query(
    "INSERT INTO users(id,email,nickname) VALUES($1,$2,$3)",
    [userId, `worker-retention-${suffix}@example.test`, `보존${suffix}`],
  );
  await fixturePool.query(
    "INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$4)",
    [ipId, ipId, `보존 ${suffix}`, `Retention ${suffix}`],
  );
  await fixturePool.query(
    `INSERT INTO catalog_products(id,sku,ip_id,category,name,price)
     VALUES($1,$2,$3,'gacha',$4,1000)`,
    [productId, `WORKER-RETENTION-${suffix.toUpperCase()}`, ipId, `보존 상품 ${suffix}`],
  );

  const outbox = await fixturePool.query<{ id: string; label: string }>(
    `INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload,correlation_id,published_at,created_at)
     VALUES
       ('ORDER',$2,'order.cancelled','{}',$1 || '-old',now()-interval '40 days',now()-interval '41 days'),
       ('PAYMENT',$3,'payment.reservation_expired_requires_reconciliation','{}',$1 || '-alert',now()-interval '40 days',now()-interval '41 days'),
       ('ORDER',$2,'order.cancelled','{}',$1 || '-recent',now()-interval '5 days',now()-interval '6 days'),
       ('ORDER',$2,'order.cancelled','{}',$1 || '-unpublished',NULL,now()-interval '41 days')
     RETURNING id,substring(correlation_id FROM '[a-z]+$') AS label`,
    [correlation, randomUUID(), randomUUID()],
  );
  assert.equal(outbox.rowCount, 4);

  await fixturePool.query(
    `INSERT INTO idempotency_keys(actor_id,scope,idempotency_key,request_hash,state,expires_at,created_at)
     VALUES
       ($1,'CREATE_EXCHANGE',$2 || '-expired','h','COMPLETED',now()-interval '2 days',now()-interval '3 days'),
       ($1,'CREATE_ORDER',$2 || '-order','h','COMPLETED',now()-interval '2 days',now()-interval '3 days'),
       ($1,'CREATE_ORDER',$2 || '-order-failed','h','FAILED',now()-interval '2 days',now()-interval '3 days'),
       ($1,'CREATE_EXCHANGE',$2 || '-live','h','PROCESSING',now()+interval '1 day',now())`,
    [userId, suffix],
  );

  await fixturePool.query(
    `INSERT INTO sessions(id,user_id,session_kind,token_digest,expires_at,revoked_at,created_at)
     VALUES
       ($1,$5,'USER',$6 || '-revoked',now()+interval '1 day',now()-interval '40 days',now()-interval '41 days'),
       ($2,$5,'USER',$6 || '-parent',now()-interval '40 days',NULL,now()-interval '60 days'),
       ($4,$5,'USER',$6 || '-active',now()+interval '1 day',NULL,now())`,
    [sessionIds.revoked, sessionIds.expiredParent, sessionIds.child, sessionIds.active, userId, suffix],
  );
  await fixturePool.query(
    `INSERT INTO sessions(id,user_id,session_kind,token_digest,expires_at,rotated_from_session_id)
     VALUES($1,$2,'USER',$3 || '-child',now()+interval '1 day',$4)`,
    [sessionIds.child, userId, suffix, sessionIds.expiredParent],
  );

  // Two old clicks on the same Seoul business day, one inside the live window.
  await fixturePool.query(
    `INSERT INTO home_product_click_events(id,product_id,created_at)
     VALUES
       ($1,$4,date_trunc('day',now()-interval '40 days')+interval '3 hours'),
       ($2,$4,date_trunc('day',now()-interval '40 days')+interval '4 hours'),
       ($3,$4,now()-interval '10 days')`,
    [clickIds.oldA, clickIds.oldB, clickIds.recent, productId],
  );

  // Ordinary paths still cannot mutate raw click evidence.
  await assert.rejects(
    fixturePool.query("DELETE FROM home_product_click_events WHERE id=$1", [clickIds.oldA]),
    /immutable outside the retention rollup/,
  );
  const flagged = await workerPool.connect();
  try {
    await flagged.query("BEGIN");
    await flagged.query("SELECT set_config('dabboba.home_click_rollup','on',true)");
    await assert.rejects(
      flagged.query("DELETE FROM home_product_click_events WHERE id=$1", [clickIds.recent]),
      /immutable outside the retention rollup/,
    );
    await flagged.query("ROLLBACK");
  } finally {
    flagged.release();
  }

  // Drain with a generous batch so pre-existing test data cannot starve ours.
  const retention = { ...DEFAULT_WORKER_RETENTION, batchSize: 5_000 };
  const first = await runRetentionBatch(workerPool, retention, logger);
  assert.ok(first.outboxEventsDeleted >= 1);
  assert.ok(first.idempotencyKeysDeleted >= 1);
  assert.ok(first.sessionsDeleted >= 1);
  assert.ok(first.homeClicksRolledUp >= 2);

  const remainingOutbox = await fixturePool.query<{ label: string }>(
    "SELECT substring(correlation_id FROM '[a-z]+$') AS label FROM outbox_events WHERE correlation_id LIKE $1 ORDER BY 1",
    [`${correlation}%`],
  );
  assert.deepEqual(remainingOutbox.rows.map((row) => row.label), ["alert", "recent", "unpublished"]);

  const remainingKeys = await fixturePool.query<{ key: string }>(
    "SELECT idempotency_key AS key FROM idempotency_keys WHERE actor_id=$1 ORDER BY 1",
    [userId],
  );
  assert.deepEqual(remainingKeys.rows.map((row) => row.key), [
    `${suffix}-live`,
    `${suffix}-order`,
    `${suffix}-order-failed`,
  ]);

  const remainingSessions = await fixturePool.query<{ id: string }>(
    "SELECT id FROM sessions WHERE user_id=$1 ORDER BY id",
    [userId],
  );
  assert.deepEqual(
    remainingSessions.rows.map((row) => row.id),
    [sessionIds.expiredParent, sessionIds.child, sessionIds.active].sort(),
  );

  const clicks = await fixturePool.query<{ id: string }>(
    "SELECT id FROM home_product_click_events WHERE product_id=$1",
    [productId],
  );
  assert.deepEqual(clicks.rows.map((row) => row.id), [clickIds.recent]);
  const daily = await fixturePool.query<{ click_count: string }>(
    "SELECT click_count::text FROM home_product_click_daily WHERE product_id=$1",
    [productId],
  );
  assert.deepEqual(daily.rows, [{ click_count: "2" }]);

  // Once the child is gone the expired rotation parent becomes deletable, and a
  // repeated run is otherwise a no-op for this fixture.
  await fixturePool.query("DELETE FROM sessions WHERE id=$1", [sessionIds.child]);
  await runRetentionBatch(workerPool, retention, logger);
  const afterSecond = await fixturePool.query<{ id: string }>(
    "SELECT id FROM sessions WHERE user_id=$1 ORDER BY id",
    [userId],
  );
  assert.deepEqual(afterSecond.rows.map((row) => row.id), [sessionIds.active]);
  const dailyAfterSecond = await fixturePool.query<{ click_count: string }>(
    "SELECT click_count::text FROM home_product_click_daily WHERE product_id=$1",
    [productId],
  );
  assert.deepEqual(dailyAfterSecond.rows, [{ click_count: "2" }]);
});
