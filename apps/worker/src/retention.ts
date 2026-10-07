import type { DatabasePool } from "@dabboba/db";
import { withTransaction } from "@dabboba/db";
import {
  DEFAULT_WORKER_RETENTION,
  MIN_HOME_CLICK_ROLLUP_DAYS,
  type WorkerRetentionConfig,
} from "./config.js";
import type { Logger } from "./logger.js";

/**
 * Bounded data-retention sweep. Every step deletes at most `batchSize` rows per
 * run using the database clock, so a backlog drains over successive one-minute
 * executions instead of holding long locks. Durable evidence is kept:
 *
 * - outbox events are removed only after publication, never while an
 *   inventory storage-expiry ledger row still references them, and never for
 *   the one-per-payment reconciliation alert whose unique index is the
 *   durable "alert once" guarantee used by the reservation sweep;
 * - CREATE_ORDER idempotency keys are durable purchase identities and are
 *   never removed here, whatever their state;
 * - a session is removed only when no newer session still names it as its
 *   rotation parent (the foreign key is ON DELETE RESTRICT);
 * - raw Home click events are folded into a daily per-product aggregate in the
 *   same statement that deletes them, and only after the API's 30-day
 *   popularity window has passed.
 */

export type RetentionBatchResult = {
  outboxEventsDeleted: number;
  idempotencyKeysDeleted: number;
  sessionsDeleted: number;
  homeClicksRolledUp: number;
  homeClickDailyRowsTouched: number;
};

const EMPTY_RESULT: RetentionBatchResult = {
  outboxEventsDeleted: 0,
  idempotencyKeysDeleted: 0,
  sessionsDeleted: 0,
  homeClicksRolledUp: 0,
  homeClickDailyRowsTouched: 0,
};

/** Durable "raise once" markers that must outlive the ordinary outbox window. */
export const RETAINED_OUTBOX_EVENT_TYPES = Object.freeze([
  "payment.reservation_expired_requires_reconciliation",
]);

/** Idempotency scopes whose completed records are durable business identity. */
export const DURABLE_IDEMPOTENCY_SCOPES = Object.freeze(["CREATE_ORDER"]);

/** Business-day bucket for the Home click rollup. */
export const HOME_CLICK_ROLLUP_TIME_ZONE = "Asia/Seoul";

function count(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Retention query returned an invalid count");
  }
  return parsed;
}

export function normalizeRetentionConfig(
  config: WorkerRetentionConfig | undefined,
): WorkerRetentionConfig {
  const resolved = config ?? DEFAULT_WORKER_RETENTION;
  const days = (value: number, minimum: number, label: string) => {
    if (!Number.isInteger(value) || value < minimum || value > 3_650) {
      throw new Error(`Retention ${label} must be an integer between ${minimum} and 3650 days`);
    }
    return value;
  };
  if (!Number.isInteger(resolved.batchSize) || resolved.batchSize < 1 || resolved.batchSize > 5_000) {
    throw new Error("Retention batch size must be an integer between 1 and 5000");
  }
  return {
    outboxPublishedDays: days(resolved.outboxPublishedDays, 30, "outbox window"),
    sessionDays: days(resolved.sessionDays, 90, "session window"),
    homeClickRollupDays: days(resolved.homeClickRollupDays, MIN_HOME_CLICK_ROLLUP_DAYS, "Home click window"),
    batchSize: resolved.batchSize,
  };
}

export const RETENTION_SQL = Object.freeze({
  outbox: `DELETE FROM outbox_events event
            WHERE event.id IN (
              SELECT candidate.id
                FROM outbox_events candidate
               WHERE candidate.published_at IS NOT NULL
                 AND candidate.published_at < now() - make_interval(days => $1::integer)
                 AND candidate.event_type <> ALL($3::text[])
                 AND NOT EXISTS (
                   SELECT 1 FROM inventory_storage_expiry_events ledger
                    WHERE ledger.outbox_event_id=candidate.id
                 )
               ORDER BY candidate.published_at,candidate.id
               LIMIT $2
            )
              AND event.published_at IS NOT NULL
              AND event.published_at < now() - make_interval(days => $1::integer)
            RETURNING event.id`,
  idempotency: `DELETE FROM idempotency_keys stale_key
                 WHERE stale_key.id IN (
                   SELECT candidate.id
                     FROM idempotency_keys candidate
                    WHERE candidate.expires_at <= now()
                      AND candidate.scope <> ALL($2::text[])
                    ORDER BY candidate.expires_at,candidate.id
                    LIMIT $1
                 )
                   AND stale_key.expires_at <= now()
                   AND stale_key.scope <> ALL($2::text[])
                 RETURNING stale_key.id`,
  sessions: `DELETE FROM sessions stale_session
              WHERE stale_session.id IN (
                SELECT candidate.id
                  FROM sessions candidate
                 WHERE (
                     (candidate.revoked_at IS NOT NULL
                       AND candidate.revoked_at < now() - make_interval(days => $1::integer))
                     OR candidate.expires_at < now() - make_interval(days => $1::integer)
                   )
                   AND NOT EXISTS (
                     SELECT 1 FROM sessions child
                      WHERE child.rotated_from_session_id=candidate.id
                   )
                 ORDER BY candidate.id
                 LIMIT $2
              )
                AND (
                  (stale_session.revoked_at IS NOT NULL
                    AND stale_session.revoked_at < now() - make_interval(days => $1::integer))
                  OR stale_session.expires_at < now() - make_interval(days => $1::integer)
                )
              RETURNING stale_session.id`,
  homeClickRollup: `WITH doomed AS MATERIALIZED (
                      SELECT click.id
                        FROM home_product_click_events click
                       WHERE click.created_at < now() - make_interval(days => $1::integer)
                       ORDER BY click.created_at,click.id
                       LIMIT $2
                    ), deleted AS (
                      DELETE FROM home_product_click_events click
                       USING doomed
                       WHERE click.id=doomed.id
                         AND click.created_at < now() - make_interval(days => $1::integer)
                      RETURNING click.product_id,click.created_at
                    ), aggregated AS (
                      SELECT product_id,
                             timezone($3::text,created_at)::date AS click_date,
                             count(*)::bigint AS click_count
                        FROM deleted
                       GROUP BY 1,2
                    ), upserted AS (
                      INSERT INTO home_product_click_daily(product_id,click_date,click_count)
                      SELECT product_id,click_date,click_count FROM aggregated
                      ON CONFLICT (product_id,click_date) DO UPDATE
                         SET click_count=home_product_click_daily.click_count+EXCLUDED.click_count,
                             updated_at=now()
                      RETURNING 1
                    )
                    SELECT (SELECT count(*) FROM deleted)::integer AS deleted,
                           (SELECT count(*) FROM upserted)::integer AS days`,
});

export async function runRetentionBatch(
  pool: DatabasePool,
  config: WorkerRetentionConfig | undefined,
  logger: Logger,
  shouldContinue: () => boolean = () => true,
): Promise<RetentionBatchResult> {
  const retention = normalizeRetentionConfig(config);
  const result = { ...EMPTY_RESULT };
  if (!shouldContinue()) return result;

  const outbox = await pool.query(RETENTION_SQL.outbox, [
    retention.outboxPublishedDays,
    retention.batchSize,
    [...RETAINED_OUTBOX_EVENT_TYPES],
  ]);
  result.outboxEventsDeleted = outbox.rowCount ?? 0;

  if (!shouldContinue()) return result;
  const idempotency = await pool.query(RETENTION_SQL.idempotency, [
    retention.batchSize,
    [...DURABLE_IDEMPOTENCY_SCOPES],
  ]);
  result.idempotencyKeysDeleted = idempotency.rowCount ?? 0;

  if (!shouldContinue()) return result;
  const sessions = await pool.query(RETENTION_SQL.sessions, [
    retention.sessionDays,
    retention.batchSize,
  ]);
  result.sessionsDeleted = sessions.rowCount ?? 0;

  if (!shouldContinue()) return result;
  const rollup = await withTransaction(pool, async (client) => {
    // The immutability trigger admits a DELETE only for this explicitly
    // flagged, transaction-scoped rollup of events past the popularity window.
    await client.query("SELECT set_config('dabboba.home_click_rollup','on',true)");
    return client.query<{ deleted: number | string; days: number | string }>(
      RETENTION_SQL.homeClickRollup,
      [retention.homeClickRollupDays, retention.batchSize, HOME_CLICK_ROLLUP_TIME_ZONE],
    );
  });
  result.homeClicksRolledUp = count(rollup.rows[0]?.deleted);
  result.homeClickDailyRowsTouched = count(rollup.rows[0]?.days);

  logger.debug(result, "Data retention sweep processed");
  return result;
}
