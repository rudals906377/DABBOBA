import { createHash } from "node:crypto";
import type { DatabaseClient, DatabasePool, Queryable } from "@dabboba/db";
import { withTransaction } from "@dabboba/db";
import type { OutboxPublisher } from "./outbox.js";
import type { WorkerJob } from "./types.js";

const DEAD_LETTER_PAYLOAD_LIMIT_BYTES = 1_048_576;
const FORENSIC_HINT_MAX_CHARACTERS = 200;

type DeadLetterForensicEnvelope = {
  schema: "dabboba.dead-letter-payload/v1";
  omitted: true;
  reason: "payload_too_large" | "payload_serialization_failed";
  byteLength: number | null;
  sha256: string | null;
  kind?: string;
  outboxEventId?: string;
};

export type PgmqMessage = {
  id: string;
  readCount: number;
  enqueuedAt: Date;
  visibleAt: Date;
  payload: unknown;
};

type PgmqRow = {
  msg_id: string;
  read_ct: number;
  enqueued_at: Date;
  vt: Date;
  message: unknown;
};

export function createPgmqOutboxPublisher(queueName: string): OutboxPublisher {
  return {
    async add(client: DatabaseClient, _name: string, data: WorkerJob) {
      // pgmq 1.5+ overloads delay as integer and timestamptz. Keep the cast
      // explicit so node-postgres never sends an ambiguous unknown parameter.
      await client.query(
        "SELECT * FROM pgmq.send($1::text, $2::jsonb, $3::integer)",
        [queueName, data, 0],
      );
    },
  };
}

export async function assertPgmqRuntime(pool: DatabasePool): Promise<string> {
  const result = await pool.query<{
    extversion: string | null;
    has_required_api: boolean;
    has_required_privileges: boolean;
    has_exact_function_privileges: boolean;
    has_reconciliation_schedule: boolean;
  }>(
    `SELECT
       (SELECT extversion FROM pg_extension WHERE extname='pgmq') AS extversion,
       to_regprocedure('pgmq.send(text,jsonb,integer)') IS NOT NULL
       AND to_regprocedure('pgmq.send(text,jsonb,jsonb,timestamp with time zone)') IS NOT NULL
       AND to_regprocedure('pgmq.read(text,integer,integer,jsonb)') IS NOT NULL
       AND to_regprocedure('pgmq.delete(text,bigint)') IS NOT NULL
       AND to_regprocedure('pgmq.set_vt(text,bigint,integer)') IS NOT NULL
       AND to_regprocedure('pgmq.format_table_name(text,text)') IS NOT NULL AS has_required_api,
       has_schema_privilege(current_user,'pgmq','USAGE')
       AND has_function_privilege(current_user,'pgmq.send(text,jsonb,integer)','EXECUTE')
       AND has_function_privilege(current_user,'pgmq.send(text,jsonb,jsonb,timestamp with time zone)','EXECUTE')
       AND has_function_privilege(current_user,'pgmq.read(text,integer,integer,jsonb)','EXECUTE')
       AND has_function_privilege(current_user,'pgmq.delete(text,bigint)','EXECUTE')
       AND has_function_privilege(current_user,'pgmq.set_vt(text,bigint,integer)','EXECUTE')
       AND has_function_privilege(current_user,'pgmq.format_table_name(text,text)','EXECUTE')
       AND has_table_privilege(current_user,'pgmq.q_dabboba_worker','SELECT')
       AND has_table_privilege(current_user,'pgmq.q_dabboba_worker','INSERT')
       AND has_table_privilege(current_user,'pgmq.q_dabboba_worker','UPDATE')
       AND has_table_privilege(current_user,'pgmq.q_dabboba_worker','DELETE')
       AND has_sequence_privilege(current_user,'pgmq.q_dabboba_worker_msg_id_seq','USAGE')
       AND has_table_privilege(current_user,'public.worker_dead_letters','INSERT')
       AS has_required_privileges,
       NOT EXISTS (
         SELECT 1
           FROM pg_proc AS routine
          WHERE routine.pronamespace=to_regnamespace('pgmq')
            AND has_function_privilege(current_user,routine.oid,'EXECUTE')
            AND NOT (
              routine.oid = ANY(ARRAY[
                to_regprocedure('pgmq.send(text,jsonb,integer)')::oid,
                to_regprocedure('pgmq.send(text,jsonb,jsonb,timestamp with time zone)')::oid,
                to_regprocedure('pgmq.read(text,integer,integer,jsonb)')::oid,
                to_regprocedure('pgmq.delete(text,bigint)')::oid,
                to_regprocedure('pgmq.set_vt(text,bigint,integer)')::oid,
                to_regprocedure('pgmq.format_table_name(text,text)')::oid
              ])
            )
       ) AS has_exact_function_privileges,
       to_regclass('public.worker_payment_reconciliations') IS NOT NULL
       AND COALESCE(
         has_table_privilege(
           current_user,
           to_regclass('public.worker_payment_reconciliations'),
           'SELECT'
         ),
         false
       )
       AND COALESCE(
         has_table_privilege(
           current_user,
           to_regclass('public.worker_payment_reconciliations'),
           'INSERT'
         ),
         false
       )
       AND COALESCE(
         has_table_privilege(
           current_user,
           to_regclass('public.worker_payment_reconciliations'),
           'UPDATE'
         ),
         false
       )
       AND NOT COALESCE(
         has_table_privilege(
           current_user,
           to_regclass('public.worker_payment_reconciliations'),
           'DELETE'
         ),
         false
       )
       AND NOT COALESCE(
         has_table_privilege(
           current_user,
           to_regclass('public.worker_payment_reconciliations'),
           'TRUNCATE'
         ),
         false
       )
       AND NOT COALESCE(
         has_table_privilege(
           current_user,
           to_regclass('public.worker_payment_reconciliations'),
           'REFERENCES'
         ),
         false
       )
       AND NOT COALESCE(
         has_table_privilege(
           current_user,
           to_regclass('public.worker_payment_reconciliations'),
           'TRIGGER'
         ),
         false
       ) AS has_reconciliation_schedule`,
  );
  const row = result.rows[0];
  if (
    !row?.extversion
    || !row.has_required_api
    || !row.has_required_privileges
    || !row.has_exact_function_privileges
    || !row.has_reconciliation_schedule
  ) {
    throw new Error("Supabase pgmq or its least-privilege runtime ACL is not ready; run the migration job first");
  }
  return row.extversion;
}

export async function readPgmqMessages(
  pool: DatabasePool,
  queueName: string,
  visibilitySeconds: number,
  quantity: number,
): Promise<PgmqMessage[]> {
  const result = await pool.query<PgmqRow>(
    `SELECT msg_id::text AS msg_id, read_ct, enqueued_at, vt, message
       FROM pgmq.read($1::text, $2::integer, $3::integer)`,
    [queueName, visibilitySeconds, quantity],
  );
  return result.rows.map((row) => ({
    id: row.msg_id,
    readCount: row.read_ct,
    enqueuedAt: row.enqueued_at,
    visibleAt: row.vt,
    payload: row.message,
  }));
}

export async function deletePgmqMessage(
  queryable: Queryable,
  queueName: string,
  messageId: string,
): Promise<boolean> {
  const result = await queryable.query<{ deleted: boolean }>(
    "SELECT pgmq.delete($1::text, $2::bigint) AS deleted",
    [queueName, messageId],
  );
  return result.rows[0]?.deleted === true;
}

export async function deferPgmqMessage(
  queryable: Queryable,
  queueName: string,
  messageId: string,
  delaySeconds: number,
): Promise<void> {
  const result = await queryable.query(
    "SELECT * FROM pgmq.set_vt($1::text, $2::bigint, $3::integer)",
    [queueName, messageId, delaySeconds],
  );
  if (!result.rowCount) throw new Error(`pgmq message disappeared before retry deferral: ${messageId}`);
}

function boundedStringProperty(value: unknown, key: string): string | undefined {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate !== "string" || candidate.length === 0) return undefined;
    return candidate.slice(0, FORENSIC_HINT_MAX_CHARACTERS);
  } catch {
    return undefined;
  }
}

function nestedProperty(value: unknown, key: string): unknown {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function serializePayloadForDeadLetter(payload: unknown): {
  payloadText: string;
  forensicEnvelopeText: string;
} {
  let serialized: string | undefined;
  try {
    const candidate = JSON.stringify(payload);
    if (typeof candidate === "string") serialized = candidate;
  } catch {
    // A malformed test double or future decoder must not strand a poison
    // message merely because its in-memory representation is not serializable.
  }

  const byteLength = serialized === undefined ? null : Buffer.byteLength(serialized, "utf8");
  const sha256 = serialized === undefined
    ? null
    : createHash("sha256").update(serialized, "utf8").digest("hex");
  const event = nestedProperty(payload, "event");
  const kind = boundedStringProperty(payload, "kind");
  const outboxEventId = boundedStringProperty(event, "id")
    ?? boundedStringProperty(payload, "outboxEventId");
  const envelope: DeadLetterForensicEnvelope = {
    schema: "dabboba.dead-letter-payload/v1",
    omitted: true,
    reason: serialized === undefined ? "payload_serialization_failed" : "payload_too_large",
    byteLength,
    sha256,
    ...(kind ? { kind } : {}),
    ...(outboxEventId ? { outboxEventId } : {}),
  };
  const forensicEnvelopeText = JSON.stringify(envelope);

  return {
    payloadText: serialized !== undefined && byteLength !== null && byteLength <= DEAD_LETTER_PAYLOAD_LIMIT_BYTES
      ? serialized
      : forensicEnvelopeText,
    forensicEnvelopeText,
  };
}

export async function deadLetterPgmqMessage(
  pool: DatabasePool,
  queueName: string,
  message: PgmqMessage,
  error: unknown,
): Promise<void> {
  const errorMessage = (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
  const payload = serializePayloadForDeadLetter(message.payload);
  await withTransaction(pool, async (client) => {
    await client.query(
      `INSERT INTO worker_dead_letters
         (queue_name,message_id,read_count,job_payload,error_message,failed_at)
       VALUES (
         $1,$2::bigint,$3,
         CASE
           WHEN octet_length(($4::jsonb)::text) <= $6::integer THEN $4::jsonb
           ELSE $7::jsonb
         END,
         $5,now()
       )
       ON CONFLICT DO NOTHING`,
      [
        queueName,
        message.id,
        message.readCount,
        payload.payloadText,
        errorMessage,
        DEAD_LETTER_PAYLOAD_LIMIT_BYTES,
        payload.forensicEnvelopeText,
      ],
    );
    const deleted = await deletePgmqMessage(client, queueName, message.id);
    if (!deleted) throw new Error(`pgmq message disappeared before dead-letter commit: ${message.id}`);
  });
}
