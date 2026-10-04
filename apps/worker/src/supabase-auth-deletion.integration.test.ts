import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { assertDatabaseUrlForTier } from "@dabboba/config";
import {
  createDatabasePool,
  createMigrationDatabasePool,
  WORKER_DATABASE_ROLE,
} from "@dabboba/db";
import type { WorkerConfig } from "./config.js";
import type { Logger } from "./logger.js";
import type { MediaStore } from "./media.js";
import { cleanupSupabaseAuthUsers } from "./supabase-auth-deletion.js";

const migrationDatabaseUrl = process.env.DATABASE_MIGRATION_URL;
const workerDatabaseUrl = process.env.DABBOBA_WORKER_TEST_DATABASE_URL;

test("Auth deletion retries external failure without erasing identity, then finalizes once", {
  skip: !migrationDatabaseUrl || !workerDatabaseUrl,
  timeout: 60_000,
}, async (t) => {
  assertDatabaseUrlForTier(migrationDatabaseUrl!, "DATABASE_MIGRATION_URL", "TEST");
  assertDatabaseUrlForTier(workerDatabaseUrl!, "DABBOBA_WORKER_TEST_DATABASE_URL", "TEST");
  const databaseName = new URL(migrationDatabaseUrl!).pathname.slice(1);
  // CI provisions dabboba_ci; all allowed fixtures must still pass the TEST loopback guard above.
  assert.match(databaseName, /^dabboba_(?:ci|integration|auth_goal_\d{8})$/);
  assert.equal(new URL(workerDatabaseUrl!).pathname.slice(1), databaseName);

  const fixturePool = createMigrationDatabasePool(migrationDatabaseUrl!, "auth-deletion-fixture");
  const workerPool = createDatabasePool(workerDatabaseUrl!, "auth-deletion-worker", {
    expectedRole: WORKER_DATABASE_ROLE,
  });
  let userId: string | null = null;
  t.after(async () => {
    try {
      if (userId) {
        const client = await fixturePool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SET LOCAL session_replication_role=replica");
          await client.query("DELETE FROM account_auth_deletion_jobs WHERE user_id=$1", [userId]);
          await client.query("DELETE FROM account_deletion_request_events WHERE user_id=$1", [userId]);
          await client.query("DELETE FROM account_deletion_requests WHERE user_id=$1", [userId]);
          await client.query("DELETE FROM auth_identities WHERE user_id=$1", [userId]);
          await client.query("DELETE FROM point_accounts WHERE user_id=$1", [userId]);
          await client.query("DELETE FROM user_profiles WHERE user_id=$1", [userId]);
          await client.query("DELETE FROM users WHERE id=$1", [userId]);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
      }
    } finally {
      await Promise.allSettled([workerPool.end(), fixturePool.end()]);
    }
  });

  const role = await workerPool.query<{ current_user: string }>("SELECT current_user");
  assert.equal(role.rows[0]?.current_user, WORKER_DATABASE_ROLE);

  const supabaseUserId = randomUUID();
  const fixtureEmail = `auth-deletion-${randomUUID()}@example.test`;
  const user = await fixturePool.query<{ id: string }>(
    "INSERT INTO users(email,nickname,role,status) VALUES($1,'삭제 검증 계정','USER','ACTIVE') RETURNING id",
    [fixtureEmail],
  );
  userId = user.rows[0]!.id;
  await fixturePool.query(
    "INSERT INTO auth_identities(user_id,provider,provider_subject,verified_at) VALUES($1,'PHONE',$2,now())",
    [userId, `https://fixture.supabase.co/auth/v1#${supabaseUserId}`],
  );
  const request = await fixturePool.query<{ id: string }>(
    `INSERT INTO account_deletion_requests
       (user_id,status,processing_started_at,auth_deletion_status)
     VALUES($1,'PROCESSING',now(),'PENDING') RETURNING id`,
    [userId],
  );
  await fixturePool.query(
    `INSERT INTO account_auth_deletion_jobs
       (deletion_request_id,user_id,supabase_user_id,available_at)
     VALUES($1,$2,$3,'2000-01-01T00:00:00Z')`,
    [request.rows[0]!.id, userId, supabaseUserId],
  );

  const config = {
    outboxBatchSize: 1,
    jobBackoffMs: 1_000,
    supabaseAuthAdmin: null,
    appleRevocation: null,
  } as WorkerConfig;
  const logger = { debug() {}, info() {}, warn() {}, error() {} } as Logger;
  const mediaStore = { async deleteObject() { return "deleted"; } } as MediaStore;
  const first = await cleanupSupabaseAuthUsers(
    workerPool, config, logger, () => true,
    { async deleteUser(id) { assert.equal(id, supabaseUserId); throw new Error("temporary Auth failure"); } },
    mediaStore,
  );
  assert.deepEqual(first, { completed: 0, deferred: 1 });
  const pending = await fixturePool.query<{
    status: string; email: string; identity_count: number; job_status: string;
  }>(
    `SELECT d.status,u.email,
            (SELECT count(*)::integer FROM auth_identities WHERE user_id=u.id) AS identity_count,
            j.status AS job_status
       FROM account_deletion_requests d
       JOIN users u ON u.id=d.user_id
       JOIN account_auth_deletion_jobs j ON j.deletion_request_id=d.id
      WHERE d.id=$1`,
    [request.rows[0]!.id],
  );
  assert.deepEqual(pending.rows[0], {
    status: "PROCESSING",
    email: fixtureEmail,
    identity_count: 1,
    job_status: "PENDING",
  });

  await fixturePool.query(
    `UPDATE account_auth_deletion_jobs
        SET available_at='2000-01-01T00:00:00Z'
      WHERE deletion_request_id=$1`,
    [request.rows[0]!.id],
  );
  let deleteCalls = 0;
  const second = await cleanupSupabaseAuthUsers(
    workerPool, config, logger, () => true,
    { async deleteUser(id) { assert.equal(id, supabaseUserId); deleteCalls += 1; } },
    mediaStore,
  );
  const retryState = await fixturePool.query<{ status: string; last_error: string | null }>(
    "SELECT status,last_error FROM account_auth_deletion_jobs WHERE deletion_request_id=$1",
    [request.rows[0]!.id],
  );
  assert.deepEqual(second, { completed: 1, deferred: 0 }, JSON.stringify(retryState.rows[0] ?? null));
  assert.equal(deleteCalls, 1);
  const completed = await fixturePool.query<{
    request_status: string; auth_deletion_status: string; user_status: string;
    email: string | null; phone_e164: string | null; identity_count: number; job_count: number;
  }>(
    `SELECT d.status AS request_status,d.auth_deletion_status,
            u.status AS user_status,u.email,u.phone_e164,
            (SELECT count(*)::integer FROM auth_identities WHERE user_id=u.id) AS identity_count,
            (SELECT count(*)::integer FROM account_auth_deletion_jobs WHERE user_id=u.id) AS job_count
       FROM account_deletion_requests d JOIN users u ON u.id=d.user_id
      WHERE d.id=$1`,
    [request.rows[0]!.id],
  );
  assert.deepEqual(completed.rows[0], {
    request_status: "COMPLETED",
    auth_deletion_status: "COMPLETED",
    user_status: "DELETED",
    email: null,
    phone_e164: null,
    identity_count: 0,
    job_count: 0,
  });
  const audit = await fixturePool.query<{ has_marker: boolean; revoked_at: string | null }>(
    `SELECT metadata ? 'appleTokenRevokedAt' AS has_marker,
            metadata->>'appleTokenRevokedAt' AS revoked_at
       FROM account_deletion_request_events
      WHERE deletion_request_id=$1 AND status='COMPLETED'`,
    [request.rows[0]!.id],
  );
  // This fixture is PHONE, so finalization must not invent an Apple revocation.
  // The nullable marker must survive deletion of the transient job row.
  assert.deepEqual(audit.rows, [{ has_marker: true, revoked_at: null }]);
});
