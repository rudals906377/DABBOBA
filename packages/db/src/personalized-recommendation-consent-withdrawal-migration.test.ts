import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createMigrationDatabasePool } from "./index.js";

const migration = readFile(
  new URL("../migrations/0091_personalized_recommendation_consent_withdrawal.sql", import.meta.url),
  "utf8",
);

// The withdrawal statement (step 2) is replayed inside a rolled-back
// transaction so the test can stage a pre-migration consent first.
async function withdrawalStatement(): Promise<string> {
  const source = await migration;
  const start = source.indexOf("WITH withdrawn AS (");
  assert.ok(start > 0, "migration must contain the withdrawal CTE");
  return source.slice(start);
}

test("0091 admits a system-recorded withdrawal event and withdraws every stored consent", async () => {
  const source = await migration;
  assert.match(source, /CHECK \(event_type IN \('INITIALIZED','UPDATED','SYSTEM_WITHDRAWN'\)\)/);
  assert.match(source, /event_type = 'SYSTEM_WITHDRAWN'\s+AND before_state IS NOT NULL\s+AND actor_user_id IS NULL\s+AND idempotency_key IS NOT NULL\s+AND request_id IS NOT NULL/);
  assert.match(source, /SET personalized_recommendations = false,\s+version = preference\.version \+ 1\s+WHERE preference\.personalized_recommendations = true/);
  assert.match(source, /'policy-2026-10-07:personalized-recommendations-withdrawn'/);
  assert.doesNotMatch(source, /ON CONFLICT/);
  assert.doesNotMatch(source, /DROP COLUMN/i);
});

test("0091: a staged personalized-recommendation consent is withdrawn once with append-only evidence", {
  skip: !process.env.DATABASE_MIGRATION_URL,
}, async () => {
  const pool = createMigrationDatabasePool(
    process.env.DATABASE_MIGRATION_URL!,
    "dabboba-personalized-recommendation-withdrawal-integration",
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const member = await client.query<{ id: string }>(
      "INSERT INTO users(email,nickname,role,status) VALUES($1,'동의 철회 검증','USER','ACTIVE') RETURNING id",
      [`consent-withdrawal-${randomUUID()}@example.test`],
    );
    const userId = member.rows[0]!.id;

    // Stage the pre-migration state: the customer had opted in through the app.
    await client.query(
      "UPDATE notification_preferences SET personalized_recommendations=true, version=version+1 WHERE user_id=$1",
      [userId],
    );
    await client.query(
      `INSERT INTO notification_preference_events(user_id,event_type,before_state,after_state,version,actor_user_id,idempotency_key,request_id)
       VALUES($1,'UPDATED','{"personalizedRecommendations":false,"version":1}','{"personalizedRecommendations":true,"version":2}',2,$1,'staged-opt-in','staged-request')`,
      [userId],
    );

    const statement = await withdrawalStatement();
    await client.query(statement);

    const preference = await client.query<{ personalized_recommendations: boolean; version: number }>(
      "SELECT personalized_recommendations,version FROM notification_preferences WHERE user_id=$1",
      [userId],
    );
    assert.deepEqual(preference.rows[0], { personalized_recommendations: false, version: 3 });

    const events = await client.query<{
      event_type: string;
      version: number;
      actor_user_id: string | null;
      idempotency_key: string | null;
      request_id: string | null;
      before_state: Record<string, unknown> | null;
      after_state: Record<string, unknown>;
    }>(
      `SELECT event_type,version,actor_user_id,idempotency_key,request_id,before_state,after_state
         FROM notification_preference_events WHERE user_id=$1 ORDER BY version`,
      [userId],
    );
    assert.deepEqual(events.rows.map((row) => [row.event_type, row.version]), [
      ["INITIALIZED", 1],
      ["UPDATED", 2],
      ["SYSTEM_WITHDRAWN", 3],
    ]);
    const withdrawn = events.rows[2]!;
    assert.equal(withdrawn.actor_user_id, null);
    assert.equal(withdrawn.idempotency_key, "policy-2026-10-07:personalized-recommendations-withdrawn");
    assert.equal(withdrawn.request_id, "migration:0091_personalized_recommendation_consent_withdrawal");
    assert.equal(withdrawn.before_state?.personalizedRecommendations, true);
    assert.equal(withdrawn.before_state?.version, 2);
    assert.equal(withdrawn.after_state.personalizedRecommendations, false);
    assert.equal(withdrawn.after_state.version, 3);
    assert.equal(withdrawn.after_state.orderUpdates, true);

    // Replaying the statement is a no-op: nothing is left to withdraw.
    await client.query(statement);
    const replayed = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM notification_preference_events WHERE user_id=$1",
      [userId],
    );
    assert.equal(replayed.rows[0]!.count, "3");

    // The evidence constraint still binds: a system withdrawal never names an
    // acting user, and a customer update always does.
    await client.query("SAVEPOINT constraint_checks");
    await assert.rejects(
      client.query(
        `INSERT INTO notification_preference_events(user_id,event_type,before_state,after_state,version,actor_user_id,idempotency_key,request_id)
         VALUES($1,'SYSTEM_WITHDRAWN','{}','{}',4,$1,'k','r')`,
        [userId],
      ),
      /notification_preference_events_evidence_check/,
    );
    await client.query("ROLLBACK TO SAVEPOINT constraint_checks");
    await assert.rejects(
      client.query(
        `INSERT INTO notification_preference_events(user_id,event_type,before_state,after_state,version,actor_user_id,idempotency_key,request_id)
         VALUES($1,'UPDATED','{}','{}',4,NULL,'k','r')`,
        [userId],
      ),
      /notification_preference_events_evidence_check/,
    );
    await client.query("ROLLBACK TO SAVEPOINT constraint_checks");
    await assert.rejects(
      client.query(
        `INSERT INTO notification_preference_events(user_id,event_type,before_state,after_state,version,actor_user_id,idempotency_key,request_id)
         VALUES($1,'REVOKED','{}','{}',4,NULL,'k','r')`,
        [userId],
      ),
      /notification_preference_events_event_type_check/,
    );
    await client.query("ROLLBACK TO SAVEPOINT constraint_checks");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
});
