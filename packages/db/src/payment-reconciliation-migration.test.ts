import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createMigrationDatabasePool } from "./index.js";

const migration = readFile(
  new URL("../migrations/0032_worker_payment_reconciliation_schedule.sql", import.meta.url),
  "utf8",
);
const migrationDatabaseUrl = process.env.DATABASE_MIGRATION_URL;

test("payment reconciliation scheduling is durable, RLS-protected, and worker-only", async () => {
  const source = await migration;

  assert.match(source, /CREATE TABLE public\.worker_payment_reconciliations/i);
  assert.match(source, /payment_id uuid PRIMARY KEY REFERENCES public\.payments\(id\) ON DELETE CASCADE/i);
  assert.match(source, /attempts BETWEEN 1 AND 1000000/i);
  assert.match(source, /next_attempt_at > last_attempted_at/i);
  assert.match(source, /CREATE INDEX worker_payment_reconciliations_due_idx/i);
  assert.match(source, /CREATE INDEX payments_worker_reconciliation_candidates_idx/i);
  assert.match(source, /WHERE status IN \('PENDING','AUTHORIZED','REFUND_REVIEW'\)/i);
  assert.match(
    source,
    /GROUP BY aggregate_id\s+HAVING count\(\*\) > 1[\s\S]*duplicate payment\.reservation_expired_requires_reconciliation outbox events must be reconciled before migration 0032/i,
  );
  assert.match(source, /CREATE UNIQUE INDEX outbox_worker_reservation_reconciliation_idx/i);
  assert.match(source, /ALTER TABLE public\.worker_payment_reconciliations ENABLE ROW LEVEL SECURITY/i);
  assert.match(source, /REVOKE ALL ON TABLE public\.worker_payment_reconciliations FROM PUBLIC/i);
  assert.match(source, /REVOKE ALL ON TABLE public\.worker_payment_reconciliations FROM dabboba_runtime/i);
  assert.match(
    source,
    /GRANT SELECT, INSERT, UPDATE\s+ON TABLE public\.worker_payment_reconciliations\s+TO dabboba_worker/i,
  );
  assert.doesNotMatch(
    source,
    /GRANT\s+(?:ALL|DELETE|TRUNCATE|REFERENCES|TRIGGER)[^;]*worker_payment_reconciliations/i,
  );
  assert.match(source, /dabboba_worker reconciliation schedule privileges are not the exact allow-list/i);
  assert.match(source, /dabboba_runtime can access the worker reconciliation schedule/i);
});

test("reservation reconciliation alerts are unique per payment after migration 0032", {
  skip: !migrationDatabaseUrl,
}, async () => {
  const pool = createMigrationDatabasePool(
    migrationDatabaseUrl!,
    "dabboba-worker-reconciliation-index-integration",
  );
  const client = await pool.connect();
  const paymentId = randomUUID();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload,correlation_id)
       VALUES('PAYMENT',$1,'payment.reservation_expired_requires_reconciliation','{}'::jsonb,$2)`,
      [paymentId, `worker-reconciliation-index-${paymentId}-1`],
    );
    await assert.rejects(
      client.query(
        `INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload,correlation_id)
         VALUES('PAYMENT',$1,'payment.reservation_expired_requires_reconciliation','{}'::jsonb,$2)`,
        [paymentId, `worker-reconciliation-index-${paymentId}-2`],
      ),
      (error: unknown) => typeof error === "object"
        && error !== null
        && "code" in error
        && (error as { code: string }).code === "23505",
    );
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
});
