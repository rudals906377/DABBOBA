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

test("Auth deletion finalizes locally first, then retries the external deletion until it succeeds", {
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
  // The local step is the point of no return and already ended: the account
  // is anonymized while the broker identity deletion alone waits for a retry.
  const pending = await fixturePool.query<{
    status: string; auth_deletion_status: string; email: string | null; identity_count: number; job_status: string;
  }>(
    `SELECT d.status,d.auth_deletion_status,u.email,
            (SELECT count(*)::integer FROM auth_identities WHERE user_id=u.id) AS identity_count,
            j.status AS job_status
       FROM account_deletion_requests d
       JOIN users u ON u.id=d.user_id
       JOIN account_auth_deletion_jobs j ON j.deletion_request_id=d.id
      WHERE d.id=$1`,
    [request.rows[0]!.id],
  );
  assert.deepEqual(pending.rows[0], {
    status: "COMPLETED",
    auth_deletion_status: "PENDING",
    email: null,
    identity_count: 0,
    job_status: "PENDING",
  });
  assert.notEqual(fixtureEmail, null);

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
      WHERE deletion_request_id=$1 AND status='COMPLETED' AND metadata ? 'personalDataAnonymized'`,
    [request.rows[0]!.id],
  );
  // This fixture is PHONE, so finalization must not invent an Apple revocation.
  // The nullable marker must survive deletion of the transient job row.
  assert.deepEqual(audit.rows, [{ has_marker: true, revoked_at: null }]);
});

test("Deletion forfeits only the acknowledged points and separates retained shipping and inquiry records", {
  skip: !migrationDatabaseUrl || !workerDatabaseUrl,
  timeout: 60_000,
}, async (t) => {
  assertDatabaseUrlForTier(migrationDatabaseUrl!, "DATABASE_MIGRATION_URL", "TEST");
  assertDatabaseUrlForTier(workerDatabaseUrl!, "DABBOBA_WORKER_TEST_DATABASE_URL", "TEST");
  const fixturePool = createMigrationDatabasePool(migrationDatabaseUrl!, "deletion-separation-fixture");
  const workerPool = createDatabasePool(workerDatabaseUrl!, "deletion-separation-worker", {
    expectedRole: WORKER_DATABASE_ROLE,
  });
  t.after(async () => {
    await Promise.allSettled([workerPool.end(), fixturePool.end()]);
  });

  const config = { outboxBatchSize: 1, jobBackoffMs: 1_000, supabaseAuthAdmin: null, appleRevocation: null } as WorkerConfig;
  const logger = { debug() {}, info() {}, warn() {}, error() {} } as Logger;
  const mediaStore = { async deleteObject() { return "deleted"; } } as MediaStore;
  const address = {
    recipient: "보관 확인", phone: "01012345678", postalCode: "04524",
    addressLine1: "서울특별시 중구 세종대로 110", addressLine2: "1층", deliveryNote: "",
  };

  const seed = async (acknowledged: number | null) => {
    const user = await fixturePool.query<{ id: string }>(
      "INSERT INTO users(email,nickname,role,status) VALUES($1,'분리 보관 검증','USER','ACTIVE') RETURNING id",
      [`deletion-separation-${randomUUID()}@example.test`],
    );
    const userId = user.rows[0]!.id;
    await fixturePool.query("INSERT INTO point_accounts(user_id,balance) VALUES($1,1200)", [userId]);
    const shipping = await fixturePool.query<{ id: string }>(
      "INSERT INTO shipping_requests(user_id,status,address_snapshot) VALUES($1,'CANCELLED',$2::jsonb) RETURNING id",
      [userId, JSON.stringify(address)],
    );
    const inquiry = await fixturePool.query<{ id: string }>(
      "INSERT INTO inquiries(user_id,category,title,status,closed_at) VALUES($1,'ORDER','배송 지연 문의','CLOSED',now()) RETURNING id",
      [userId],
    );
    await fixturePool.query(
      "INSERT INTO inquiry_messages(inquiry_id,author_id,author_role,content) VALUES($1,$2,'USER','상품이 아직 오지 않았어요.')",
      [inquiry.rows[0]!.id, userId],
    );
    const request = await fixturePool.query<{ id: string }>(
      `INSERT INTO account_deletion_requests
         (user_id,status,processing_started_at,auth_deletion_status,point_forfeiture_acknowledged)
       VALUES($1,'PROCESSING',now(),'NOT_REQUIRED',$2) RETURNING id`,
      [userId, acknowledged],
    );
    await fixturePool.query(
      `INSERT INTO account_auth_deletion_jobs(deletion_request_id,user_id,supabase_user_id,available_at)
       VALUES($1,$2,NULL,'2000-01-01T00:00:00Z')`,
      [request.rows[0]!.id, userId],
    );
    return { userId, requestId: request.rows[0]!.id, shippingId: shipping.rows[0]!.id, inquiryId: inquiry.rows[0]!.id };
  };
  const run = () => cleanupSupabaseAuthUsers(
    workerPool, config, logger, () => true, { async deleteUser() { throw new Error("no Auth user"); } }, mediaStore,
  );

  // A balance without an exact agreement keeps blocking the deletion.
  const unacknowledged = await seed(1100);
  assert.deepEqual(await run(), { completed: 0, deferred: 1 });
  const blocked = await fixturePool.query<{ status: string; balance: number }>(
    `SELECT d.status,p.balance FROM account_deletion_requests d JOIN point_accounts p ON p.user_id=d.user_id WHERE d.id=$1`,
    [unacknowledged.requestId],
  );
  assert.deepEqual(blocked.rows[0], { status: "BLOCKED", balance: 1200 });

  const agreed = await seed(1200);
  assert.deepEqual(await run(), { completed: 1, deferred: 0 });
  const state = await fixturePool.query<{
    request_status: string; balance: number; ledger: Array<{ entry_type: string; amount: number; reference_type: string }>;
    shipping_snapshot: unknown; inquiry_title: string; message: string;
  }>(
    `SELECT d.status AS request_status,p.balance,
            (SELECT jsonb_agg(jsonb_build_object('entry_type',l.entry_type,'amount',l.amount,'reference_type',l.reference_type))
               FROM point_ledger_entries l WHERE l.user_id=d.user_id) AS ledger,
            (SELECT address_snapshot FROM shipping_requests WHERE id=$2) AS shipping_snapshot,
            (SELECT title FROM inquiries WHERE id=$3) AS inquiry_title,
            (SELECT content FROM inquiry_messages WHERE inquiry_id=$3) AS message
       FROM account_deletion_requests d JOIN point_accounts p ON p.user_id=d.user_id
      WHERE d.id=$1`,
    [agreed.requestId, agreed.shippingId, agreed.inquiryId],
  );
  assert.deepEqual(state.rows[0], {
    request_status: "COMPLETED",
    balance: 0,
    ledger: [{ entry_type: "EXPIRE", amount: -1200, reference_type: "ACCOUNT_DELETION" }],
    shipping_snapshot: { retainedSeparately: true },
    inquiry_title: "삭제된 문의",
    message: "삭제된 문의 내용",
  });
  const separated = await fixturePool.query<{ record_kind: string; payload: Record<string, unknown> }>(
    "SELECT record_kind,payload FROM deleted_account_retained_records WHERE user_id=$1 ORDER BY record_kind",
    [agreed.userId],
  );
  assert.deepEqual(separated.rows.map((row) => row.record_kind), ["INQUIRY_CONTENT", "SHIPPING_ADDRESS"]);
  assert.deepEqual(separated.rows[1]!.payload, address);
  assert.equal(separated.rows[0]!.payload.title, "배송 지연 문의");
  assert.equal((separated.rows[0]!.payload.messages as Array<{ content: string }>)[0]!.content, "상품이 아직 오지 않았어요.");
  const audit = await fixturePool.query<{ separated: number; forfeited: number }>(
    `SELECT (metadata->>'retainedRecordsSeparated')::integer AS separated,(metadata->>'pointsForfeited')::integer AS forfeited
       FROM account_deletion_request_events WHERE deletion_request_id=$1 AND status='COMPLETED'`,
    [agreed.requestId],
  );
  assert.deepEqual(audit.rows, [{ separated: 2, forfeited: 1200 }]);

  // The worker itself cannot read the separated copies.
  await assert.rejects(workerPool.query("SELECT 1 FROM deleted_account_retained_records LIMIT 1"), /permission denied/);
});
