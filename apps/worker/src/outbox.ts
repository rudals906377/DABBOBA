import type { DatabaseClient, DatabasePool } from "@dabboba/db";
import { withTransaction } from "@dabboba/db";
import type { Logger } from "./logger.js";
import type { OutboxEvent, WorkerJob } from "./types.js";

type OutboxRow = {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  correlation_id: string;
  attempts: number;
  created_at: Date;
};

export type OutboxPublisher = {
  add(
    client: DatabaseClient,
    name: string,
    data: WorkerJob,
    options: { jobId: string; attempts: number; backoff: { type: "exponential"; delay: number } },
  ): Promise<unknown>;
};

export type DispatchOptions = {
  batchSize: number;
  jobAttempts: number;
  jobBackoffMs: number;
};

export type DispatchResult = { published: number; deferred: number; skipped: number };

const MAX_OUTBOX_RETRY_DELAY_MS = 15 * 60 * 1_000;

export function outboxRetryDelayMs(attempt: number, baseDelayMs: number): number {
  const exponent = Math.max(0, Math.min(attempt - 1, 20));
  return Math.min(baseDelayMs * 2 ** exponent, MAX_OUTBOX_RETRY_DELAY_MS);
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
}

function mapEvent(row: OutboxRow): OutboxEvent {
  return {
    id: row.id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    payload: row.payload,
    correlationId: row.correlation_id,
    createdAt: row.created_at.toISOString(),
  };
}

export async function publishClaimedOutboxEvent(
  client: DatabaseClient,
  publisher: OutboxPublisher,
  row: OutboxRow,
  options: Pick<DispatchOptions, "jobAttempts" | "jobBackoffMs">,
  now = new Date(),
  shouldContinue: () => boolean = () => true,
): Promise<"published" | "deferred"> {
  if (!shouldContinue()) throw new Error("Worker run deadline reached before outbox publication");
  const attemptResult = await client.query<{ attempts: number }>(
    "UPDATE outbox_events SET attempts=attempts+1,last_error=NULL WHERE id=$1 AND published_at IS NULL RETURNING attempts",
    [row.id],
  );
  if (!attemptResult.rowCount) return "published";
  const attempt = attemptResult.rows[0]!.attempts;
  const event = mapEvent(row);

  await client.query("SAVEPOINT dabboba_outbox_publish");
  try {
    if (!shouldContinue()) throw new Error("Worker run deadline reached before queue publication");
    await publisher.add(client, "outbox.event", { kind: "outbox.event", event }, {
      jobId: `outbox-${row.id}`,
      attempts: options.jobAttempts,
      backoff: { type: "exponential", delay: options.jobBackoffMs },
    });
    if (!shouldContinue()) throw new Error("Worker run deadline reached after queue publication");
    await client.query(
      "UPDATE outbox_events SET published_at=$2,last_error=NULL WHERE id=$1 AND published_at IS NULL",
      [row.id, now],
    );
    await client.query("RELEASE SAVEPOINT dabboba_outbox_publish");
    return "published";
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT dabboba_outbox_publish");
    await client.query("RELEASE SAVEPOINT dabboba_outbox_publish");
    const retryAt = new Date(now.getTime() + outboxRetryDelayMs(attempt, options.jobBackoffMs));
    await client.query(
      "UPDATE outbox_events SET available_at=$2,last_error=$3 WHERE id=$1 AND published_at IS NULL",
      [row.id, retryAt, errorMessage(error)],
    );
    return "deferred";
  }
}

export async function dispatchOutboxBatch(
  pool: DatabasePool,
  publisher: OutboxPublisher,
  options: DispatchOptions,
  logger: Logger,
  shouldContinue: () => boolean = () => true,
): Promise<DispatchResult> {
  const result: DispatchResult = { published: 0, deferred: 0, skipped: 0 };
  if (!shouldContinue()) return result;
  const candidates = await pool.query<{ id: string }>(
    `SELECT id
       FROM outbox_events
      WHERE published_at IS NULL AND available_at <= now()
      ORDER BY available_at, created_at, id
      LIMIT $1`,
    [options.batchSize],
  );

  for (const candidate of candidates.rows) {
    if (!shouldContinue()) break;
    const outcome = await withTransaction(pool, async (client) => {
      if (!shouldContinue()) throw new Error("Worker run deadline reached before claiming an outbox event");
      const claimed = await client.query<OutboxRow>(
        `SELECT id,aggregate_type,aggregate_id,event_type,payload,correlation_id,attempts,created_at
           FROM outbox_events
          WHERE id=$1 AND published_at IS NULL AND available_at <= now()
          FOR UPDATE SKIP LOCKED`,
        [candidate.id],
      );
      if (!claimed.rowCount) return "skipped" as const;
      return publishClaimedOutboxEvent(client, publisher, claimed.rows[0]!, options, new Date(), shouldContinue);
    });

    result[outcome] += 1;
    if (outcome === "deferred") {
      logger.warn({ outboxEventId: candidate.id }, "Outbox delivery was deferred after a queue error");
    }
  }
  return result;
}
