import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  createDatabasePool,
  createMigrationDatabasePool,
  withTransaction,
  WORKER_DATABASE_ROLE,
} from "@dabboba/db";
import { publishClaimedOutboxEvent } from "./outbox.js";
import {
  createPgmqOutboxPublisher,
  deadLetterPgmqMessage,
  deletePgmqMessage,
} from "./pgmq.js";

const migrationDatabaseUrl = process.env.DATABASE_MIGRATION_URL;
const workerDatabaseUrl = process.env.DABBOBA_WORKER_TEST_DATABASE_URL;

test("worker role publishes, acknowledges, and atomically dead-letters through real pgmq", {
  skip: !migrationDatabaseUrl || !workerDatabaseUrl,
  timeout: 30_000,
}, async (t) => {
  const fixturePool = createMigrationDatabasePool(
    migrationDatabaseUrl!,
    "dabboba-worker-pgmq-fixture-integration",
  );
  const workerPool = createDatabasePool(
    workerDatabaseUrl!,
    "dabboba-worker-pgmq-integration",
    { expectedRole: WORKER_DATABASE_ROLE },
  );
  t.after(async () => Promise.all([fixturePool.end(), workerPool.end()]));

  const identity = await workerPool.query<{ current_user: string }>("SELECT current_user");
  assert.equal(identity.rows[0]?.current_user, WORKER_DATABASE_ROLE);

  const eventId = randomUUID();
  const event = await fixturePool.query<{
    id: string;
    aggregate_type: string;
    aggregate_id: string;
    event_type: string;
    payload: Record<string, unknown>;
    correlation_id: string;
    attempts: number;
    created_at: Date;
  }>(
    `INSERT INTO outbox_events(id,aggregate_type,aggregate_id,event_type,payload,correlation_id)
     VALUES($1::uuid,'TEST',$1::text,'integration.probe',$2::jsonb,$3)
     RETURNING id,aggregate_type,aggregate_id,event_type,payload,correlation_id,attempts,created_at`,
    [eventId, JSON.stringify({ probeId: eventId }), `worker-pgmq-${eventId}`],
  );

  await withTransaction(workerPool, async (client) => {
    const result = await publishClaimedOutboxEvent(
      client,
      createPgmqOutboxPublisher("dabboba_worker"),
      event.rows[0]!,
      { jobAttempts: 8, jobBackoffMs: 1_000 },
    );
    assert.equal(result, "published");
  });

  const published = await fixturePool.query<{ published: boolean }>(
    "SELECT published_at IS NOT NULL AS published FROM outbox_events WHERE id=$1",
    [eventId],
  );
  assert.equal(published.rows[0]?.published, true);
  const queued = await workerPool.query<{ message_id: string }>(
    `SELECT msg_id::text AS message_id
       FROM pgmq.q_dabboba_worker
      WHERE message->>'kind'='outbox.event'
        AND message->'event'->>'id'=$1`,
    [eventId],
  );
  assert.equal(queued.rowCount, 1);
  assert.equal(
    await deletePgmqMessage(workerPool, "dabboba_worker", queued.rows[0]!.message_id),
    true,
  );

  const poisonPayload = { kind: "unsupported.integration", probeId: randomUUID() };
  const poison = await workerPool.query<{ message_id: string }>(
    `SELECT pgmq.send('dabboba_worker'::text,$1::jsonb,0::integer)::text AS message_id`,
    [poisonPayload],
  );
  const poisonId = poison.rows[0]!.message_id;
  await deadLetterPgmqMessage(workerPool, "dabboba_worker", {
    id: poisonId,
    readCount: 8,
    enqueuedAt: new Date(),
    visibleAt: new Date(),
    payload: poisonPayload,
  }, new Error("integration poison"));
  const deadLetter = await fixturePool.query<{ count: string }>(
    `SELECT count(*) AS count FROM worker_dead_letters
      WHERE queue_name='dabboba_worker' AND message_id=$1::bigint`,
    [poisonId],
  );
  assert.equal(deadLetter.rows[0]?.count, "1");
  const deletedPoison = await fixturePool.query<{ count: string }>(
    "SELECT count(*) AS count FROM pgmq.q_dabboba_worker WHERE msg_id=$1::bigint",
    [poisonId],
  );
  assert.equal(deletedPoison.rows[0]?.count, "0");

  const rollbackPayload = { kind: "unsupported.integration.rollback", probeId: randomUUID() };
  const rollbackProbe = await workerPool.query<{ message_id: string }>(
    `SELECT pgmq.send('dabboba_worker'::text,$1::jsonb,0::integer)::text AS message_id`,
    [rollbackPayload],
  );
  const rollbackId = rollbackProbe.rows[0]!.message_id;
  assert.equal(await deletePgmqMessage(workerPool, "dabboba_worker", rollbackId), true);
  await assert.rejects(
    () => deadLetterPgmqMessage(workerPool, "dabboba_worker", {
      id: rollbackId,
      readCount: 8,
      enqueuedAt: new Date(),
      visibleAt: new Date(),
      payload: rollbackPayload,
    }, new Error("forced missing queue row")),
    /disappeared before dead-letter commit/,
  );
  const rolledBackLedger = await fixturePool.query<{ count: string }>(
    `SELECT count(*) AS count FROM worker_dead_letters
      WHERE queue_name='dabboba_worker' AND message_id=$1::bigint`,
    [rollbackId],
  );
  assert.equal(rolledBackLedger.rows[0]?.count, "0");

  await fixturePool.query(
    `DELETE FROM worker_dead_letters
      WHERE queue_name='dabboba_worker' AND message_id=$1::bigint`,
    [poisonId],
  );
  await fixturePool.query("DELETE FROM outbox_events WHERE id=$1", [eventId]);
});
