import type { DatabasePool } from "@dabboba/db";
import type { Logger } from "./logger.js";

export type CommerceRetentionConfig = {
  mode: "DISABLED" | "PREVIEW" | "EXECUTE";
  batchSize: number;
};

export const DEFAULT_COMMERCE_RETENTION: Readonly<CommerceRetentionConfig> = Object.freeze({
  mode: "DISABLED", batchSize: 25,
});

export type CommerceRetentionResult = {
  mode: CommerceRetentionConfig["mode"];
  examined: number;
  eligible: number;
  disposed: number;
  blocked: Record<string, number>;
};

const BLOCKERS = new Set([
  "POLICY_MISSING", "POLICY_REVIEW_REQUIRED", "HOLD_REVIEW_REQUIRED",
  "EXTERNAL_COPIES_UNVERIFIED", "LEGAL_HOLD", "SERVICE_ACTIVE", "NOT_EXPIRED",
  "OPEN_COMMERCE_REVIEW", "PAYMENT_UNRESOLVED", "MEDIA_PRESENT", "MESSAGE_LIMIT",
]);

export function normalizeCommerceRetentionConfig(
  value: CommerceRetentionConfig | undefined,
): CommerceRetentionConfig {
  const config = value ?? DEFAULT_COMMERCE_RETENTION;
  if (!["DISABLED", "PREVIEW", "EXECUTE"].includes(config.mode)) {
    throw new Error("Commerce retention mode must be DISABLED, PREVIEW or EXECUTE");
  }
  if (!Number.isInteger(config.batchSize) || config.batchSize < 1 || config.batchSize > 100) {
    throw new Error("Commerce retention batch size must be an integer between 1 and 100");
  }
  return { mode: config.mode, batchSize: config.batchSize };
}

/**
 * Component disposal only: approved shipping address snapshots and closed
 * inquiry text. It is not a financial-ledger purge or a complete erasure claim.
 * Policies, current hold/copy reviews and authoritative source eligibility are
 * checked inside PostgreSQL; neither environment flags nor callers can supply
 * a target ID, an age override, or a no-holds assertion.
 */
export async function runCommerceRetentionBatch(
  pool: DatabasePool,
  value: CommerceRetentionConfig | undefined,
  logger: Logger,
  shouldContinue: () => boolean = () => true,
): Promise<CommerceRetentionResult> {
  const config = normalizeCommerceRetentionConfig(value);
  const result: CommerceRetentionResult = {
    mode: config.mode, examined: 0, eligible: 0, disposed: 0, blocked: {},
  };
  if (config.mode === "DISABLED" || !shouldContinue()) return result;
  const client = await pool.connect();
  let destroyClient = false;
  try {
    await client.query(config.mode === "PREVIEW" ? "BEGIN READ ONLY" : "BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL statement_timeout = '5s'");
    if (config.mode === "PREVIEW") {
      const preview = await client.query<{ blocker: string | null }>(
        "SELECT blocker FROM public.preview_commerce_retention($1)", [config.batchSize],
      );
      if (preview.rows.length > config.batchSize) throw new Error("Commerce retention returned an invalid batch");
      result.examined = preview.rows.length;
      for (const { blocker } of preview.rows) {
        if (blocker === null) result.eligible += 1;
        else {
          if (!BLOCKERS.has(blocker)) throw new Error("Commerce retention returned an unexpected blocker");
          result.blocked[blocker] = (result.blocked[blocker] ?? 0) + 1;
        }
      }
    } else {
      await client.query("SELECT set_config('dabboba.commerce_retention_execute','on',true)");
      const execution = await client.query<{ disposed: number | string }>(
        "SELECT public.execute_commerce_retention($1) AS disposed", [config.batchSize],
      );
      const disposed = Number(execution.rows[0]?.disposed);
      if (!Number.isSafeInteger(disposed) || disposed < 0 || disposed > config.batchSize) {
        throw new Error("Commerce retention returned an invalid disposal count");
      }
      result.examined = result.eligible = result.disposed = disposed;
    }
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); }
    catch { destroyClient = true; }
    throw error;
  } finally {
    client.release(destroyClient);
  }
  logger.info(result, "Commerce retention component sweep completed");
  return result;
}
