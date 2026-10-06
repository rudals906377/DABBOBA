import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createMigrationDatabasePool } from "./index.js";

const migration = readFile(
  new URL("../migrations/0086_deleted_account_record_separation.sql", import.meta.url),
  "utf8",
);

test("0086 keeps separated deletion records owner-only and lets the worker only call the separation", async () => {
  const source = await migration;
  assert.match(source, /ENABLE ROW LEVEL SECURITY/);
  assert.match(
    source,
    /REVOKE ALL ON TABLE public\.deleted_account_retained_records\s+FROM PUBLIC, anon, authenticated, service_role, dabboba_runtime, dabboba_worker;/,
  );
  assert.match(source, /FUNCTION public\.separate_deleted_account_records[\s\S]*SECURITY DEFINER\s+SET search_path = pg_catalog, public/);
  assert.match(source, /GRANT EXECUTE ON FUNCTION public\.separate_deleted_account_records\(uuid, uuid\) TO dabboba_worker;/);
  assert.doesNotMatch(source, /GRANT [A-Z, ]+ ON TABLE public\.deleted_account_retained_records/);
  // Only a request that is already being processed may separate records.
  assert.match(source, /request\.status IN \('PROCESSING','APPROVED'\)/);
  assert.match(source, /AFTER INSERT ON public\.commerce_retention_disposals/);
  assert.match(source, /point_forfeiture_acknowledged > 0/);
});

test("0086 separates a deleted member's address and inquiry text, and retention disposal destroys the copy", {
  skip: !process.env.DATABASE_MIGRATION_URL,
}, async () => {
  const pool = createMigrationDatabasePool(
    process.env.DATABASE_MIGRATION_URL!,
    "dabboba-deleted-account-record-separation-integration",
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const member = await client.query<{ id: string }>(
      "INSERT INTO users(email,nickname,role,status) VALUES($1,'분리 검증','USER','ACTIVE') RETURNING id",
      [`separation-${randomUUID()}@example.test`],
    );
    const admin = await client.query<{ id: string }>(
      "INSERT INTO users(email,nickname,role,status) VALUES($1,'보관 검토','ADMIN','ACTIVE') RETURNING id",
      [`separation-admin-${randomUUID()}@example.test`],
    );
    const userId = member.rows[0]!.id;
    const shipping = await client.query<{ id: string }>(
      `INSERT INTO shipping_requests(user_id,status,address_snapshot)
       VALUES($1,'CANCELLED',$2::jsonb) RETURNING id`,
      [userId, JSON.stringify({ recipient: "수령인", phone: "01000000000", addressLine1: "주소" })],
    );
    const pending = await client.query<{ id: string }>(
      "INSERT INTO account_deletion_requests(user_id,status) VALUES($1,'PENDING_REVIEW') RETURNING id",
      [userId],
    );
    await assert.rejects(
      client.query("SAVEPOINT not_ready").then(() =>
        client.query("SELECT public.separate_deleted_account_records($1,$2)", [pending.rows[0]!.id, userId])),
      /not ready for record separation/,
    );
    await client.query("ROLLBACK TO SAVEPOINT not_ready");
    await client.query("UPDATE account_deletion_requests SET status='PROCESSING' WHERE id=$1", [pending.rows[0]!.id]);

    const separated = await client.query<{ separated: number }>(
      "SELECT public.separate_deleted_account_records($1,$2) AS separated",
      [pending.rows[0]!.id, userId],
    );
    assert.equal(separated.rows[0]!.separated, 1);
    const repeated = await client.query<{ separated: number }>(
      "SELECT public.separate_deleted_account_records($1,$2) AS separated",
      [pending.rows[0]!.id, userId],
    );
    assert.equal(repeated.rows[0]!.separated, 0);
    const blanked = await client.query<{ address_snapshot: unknown }>(
      "SELECT address_snapshot FROM shipping_requests WHERE id=$1",
      [shipping.rows[0]!.id],
    );
    assert.deepEqual(blanked.rows[0]!.address_snapshot, { retainedSeparately: true });

    const policy = await client.query<{ id: string }>(
      `INSERT INTO commerce_retention_policies(record_kind,policy_version,retention_months,evidence_reference)
       VALUES('SHIPPING_ADDRESS','2099-01-01',60,'separation-test') RETURNING id`,
    );
    const review = await client.query<{ id: string }>(
      `INSERT INTO commerce_retention_reviews(policy_id,reviewed_by_admin_id,evidence_reference)
       VALUES($1,$2,'separation-test') RETURNING id`,
      [policy.rows[0]!.id, admin.rows[0]!.id],
    );
    await client.query(
      `INSERT INTO commerce_retention_disposals(record_kind,record_id,policy_id,review_id,source_anchor_at,eligible_at,message_count)
       VALUES('SHIPPING_ADDRESS',$1,$2,$3,now()-interval '61 months',now()-interval '1 day',0)`,
      [shipping.rows[0]!.id, policy.rows[0]!.id, review.rows[0]!.id],
    );
    const remaining = await client.query(
      "SELECT 1 FROM deleted_account_retained_records WHERE record_kind='SHIPPING_ADDRESS' AND record_id=$1",
      [shipping.rows[0]!.id],
    );
    assert.equal(remaining.rowCount, 0);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
});
