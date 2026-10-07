import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createMigrationDatabasePool } from "./index.js";

const migration = readFile(
  new URL("../migrations/0088_deletion_preserves_retention_clock.sql", import.meta.url),
  "utf8",
);

test("0088 keeps the separation owner-only and honors the transaction-local updated_at preservation", async () => {
  const source = await migration;
  assert.match(source, /current_setting\('dabboba\.preserve_updated_at', true\) = 'on'/);
  assert.match(source, /NEW\.updated_at = OLD\.updated_at/);
  assert.match(source, /set_config\('dabboba\.preserve_updated_at', 'on', true\)/);
  assert.match(source, /SECURITY DEFINER\s+SET search_path = pg_catalog, public/);
  assert.match(source, /REVOKE ALL ON FUNCTION public\.separate_deleted_account_records\(uuid, uuid\)\s+FROM PUBLIC, anon, authenticated, service_role, dabboba_runtime;/);
  assert.match(source, /GRANT EXECUTE ON FUNCTION public\.separate_deleted_account_records\(uuid, uuid\) TO dabboba_worker;/);
});

test("0088: record separation and preserved anonymization leave updated_at, the retention anchor, untouched", {
  skip: !process.env.DATABASE_MIGRATION_URL,
}, async () => {
  const pool = createMigrationDatabasePool(
    process.env.DATABASE_MIGRATION_URL!,
    "dabboba-deletion-retention-clock-integration",
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const member = await client.query<{ id: string }>(
      "INSERT INTO users(email,nickname,role,status) VALUES($1,'보존 기산 검증','USER','ACTIVE') RETURNING id",
      [`retention-clock-${randomUUID()}@example.test`],
    );
    const userId = member.rows[0]!.id;
    const shipping = await client.query<{ id: string }>(
      `INSERT INTO shipping_requests(user_id,status,address_snapshot)
       VALUES($1,'CANCELLED','{"recipient":"기산 확인","phone":"01000000000","postalCode":"04524","addressLine1":"서울","addressLine2":"","deliveryNote":""}'::jsonb)
       RETURNING id`,
      [userId],
    );
    const inquiry = await client.query<{ id: string }>(
      "INSERT INTO inquiries(user_id,category,title,status,closed_at) VALUES($1,'ORDER','기산 문의','CLOSED',now()) RETURNING id",
      [userId],
    );
    // Backdate the last customer activity past the trigger.
    const anchor = "2025-01-01T00:00:00.000Z";
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query("UPDATE shipping_requests SET updated_at=$2 WHERE id=$1", [shipping.rows[0]!.id, anchor]);
    await client.query("UPDATE inquiries SET updated_at=$2 WHERE id=$1", [inquiry.rows[0]!.id, anchor]);
    await client.query("SET LOCAL session_replication_role = DEFAULT");
    const request = await client.query<{ id: string }>(
      "INSERT INTO account_deletion_requests(user_id,status,processing_started_at) VALUES($1,'PROCESSING',now()) RETURNING id",
      [userId],
    );

    // An ordinary update still stamps now().
    await client.query("UPDATE inquiries SET status='CLOSED' WHERE id=$1", [inquiry.rows[0]!.id]);
    const stamped = await client.query<{ updated_at: Date }>("SELECT updated_at FROM inquiries WHERE id=$1", [inquiry.rows[0]!.id]);
    assert.notEqual(stamped.rows[0]!.updated_at.toISOString(), anchor);
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query("UPDATE inquiries SET updated_at=$2 WHERE id=$1", [inquiry.rows[0]!.id, anchor]);
    await client.query("SET LOCAL session_replication_role = DEFAULT");

    // The separation function preserves the shipping row's clock by itself.
    const separated = await client.query<{ separated: number }>(
      "SELECT public.separate_deleted_account_records($1,$2) AS separated",
      [request.rows[0]!.id, userId],
    );
    assert.equal(Number(separated.rows[0]!.separated), 2);
    const afterSeparation = await client.query<{ updated_at: Date; address_snapshot: unknown }>(
      "SELECT updated_at,address_snapshot FROM shipping_requests WHERE id=$1", [shipping.rows[0]!.id],
    );
    assert.deepEqual(afterSeparation.rows[0]!.address_snapshot, { retainedSeparately: true });
    assert.equal(afterSeparation.rows[0]!.updated_at.toISOString(), anchor);

    // The worker's anonymization runs under the same transaction-local setting.
    await client.query("UPDATE inquiries SET title='삭제된 문의' WHERE id=$1", [inquiry.rows[0]!.id]);
    const anonymized = await client.query<{ updated_at: Date; title: string }>(
      "SELECT updated_at,title FROM inquiries WHERE id=$1", [inquiry.rows[0]!.id],
    );
    assert.equal(anonymized.rows[0]!.title, "삭제된 문의");
    assert.equal(anonymized.rows[0]!.updated_at.toISOString(), anchor);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
});
