import type { DatabasePool } from "@dabboba/db";
import { errorFields, persistedErrorIdentity, type Logger } from "./logger.js";

const MAX_PAYMENT_RECONCILIATION_DELAY_MS = 24 * 60 * 60 * 1_000;
export const DEFAULT_PAYMENT_WINDOW_VALIDITY_MINUTES = 30;
/**
 * Provider statuses that prove only that a PG window was opened: no money was
 * taken and no approval completed. After the window's validity they can never
 * turn into a charge through that window, so the reconciliation may close.
 */
const NO_CHARGE_WINDOW_PROVIDER_STATUSES = new Set(["READY", "PAY_PENDING", "PAYMENT_NOT_FOUND"]);
/**
 * An expired, never-charged PG window is recorded as RECONCILED with this
 * observed state (the PENDING_EXPIRED closure). The schedule table's check
 * constraint has no distinct literal, so PENDING + RECONCILED on the current
 * payment version is that closure.
 */
export const PENDING_EXPIRED_OBSERVED_STATE = "PENDING" as const;

export type PaymentRecord = {
  id: string;
  orderId: string;
  provider: string;
  providerPaymentId: string | null;
  status: string;
  amount: number;
  currency: string;
  updatedAt: string;
};

export type PaymentObservation = {
  state: "UNKNOWN" | "PENDING" | "AUTHORIZED" | "PAID" | "FAILED" | "CANCELLED" | "REFUNDED";
  providerEventId?: string;
  observedAt: string;
  /** API state after a verified provider requery and canonical event dispatch. */
  canonicalStatus?: string;
  /**
   * Raw provider status from a verified requery, or PAYMENT_NOT_FOUND when the
   * provider authoritatively has no payment for this ID. Absent for adapters
   * that cannot report it.
   */
  providerStatus?: string;
};

export type PaymentReconciliationProvider = {
  observe(payment: PaymentRecord): Promise<PaymentObservation>;
};

type PaymentRow = {
  id: string;
  order_id: string;
  provider: string;
  provider_payment_id: string | null;
  status: string;
  amount: number;
  currency: string;
  version: number;
  updated_at: Date;
  pg_attempt_started_at?: Date | null;
  reconciliation_version?: number | null;
  reconciliation_attempts?: number | null;
};

type PaymentReconciliationOutcome = "UNKNOWN" | "MANUAL_REVIEW" | "RECONCILED" | "ERROR";

export function requiresManualPaymentAction(currentStatus: string, observedState: PaymentObservation["state"]): boolean {
  if (observedState === "UNKNOWN" || observedState === currentStatus) return false;
  return true;
}

export class ManualReviewPaymentProvider implements PaymentReconciliationProvider {
  async observe(): Promise<PaymentObservation> {
    return { state: "UNKNOWN", observedAt: new Date().toISOString() };
  }
}

function mapPayment(row: PaymentRow): PaymentRecord {
  return {
    id: row.id,
    orderId: row.order_id,
    provider: row.provider,
    providerPaymentId: row.provider_payment_id,
    status: row.status,
    amount: Number(row.amount),
    currency: row.currency,
    updatedAt: row.updated_at.toISOString(),
  };
}

async function observePayment(
  payment: PaymentRecord,
  provider: PaymentReconciliationProvider,
  logger: Logger,
): Promise<{ outcome: "unknown" | "manual_review" | "reconciled"; observation: PaymentObservation }> {
  const observation = await provider.observe(payment);
  if (observation.canonicalStatus && observation.canonicalStatus !== payment.status
    && ["PAID", "FAILED", "CANCELLED", "REFUNDED"].includes(observation.canonicalStatus)) {
    return { outcome: "reconciled", observation };
  }
  // A reservation can expire after the customer opened PortOne. The local
  // cancellation is not evidence that PortOne took no money; keep querying
  // until the provider confirms a terminal no-charge state or reports a charge.
  if (payment.status === "CANCELLED" && observation.canonicalStatus === "CANCELLED"
    && (observation.state === "FAILED" || observation.state === "CANCELLED")) {
    return { outcome: "reconciled", observation };
  }
  if (!requiresManualPaymentAction(payment.status, observation.state)) {
    logger.warn(
      { paymentId: payment.id, orderId: payment.orderId, provider: payment.provider, status: payment.status },
      "Payment needs a configured provider reconciliation adapter or a verified webhook",
    );
    return { outcome: "unknown", observation };
  }

  logger.warn(
    {
      paymentId: payment.id,
      orderId: payment.orderId,
      currentStatus: payment.status,
      observedState: observation.state,
      providerEventId: observation.providerEventId || null,
    },
    "Provider observation differs from the ledger; state was not mutated without a verified webhook",
  );
  return { outcome: "manual_review", observation };
}

async function verifyCanonicalPaymentTransition(
  pool: DatabasePool,
  payment: PaymentRecord,
  observation: PaymentObservation,
  logger: Logger,
): Promise<void> {
  const current = await pool.query<{ status: string }>("SELECT status FROM payments WHERE id=$1", [payment.id]);
  if (current.rows[0]?.status !== observation.canonicalStatus) {
    throw new Error("Canonical payment status did not match the verified API response");
  }
  logger.info(
    { paymentId: payment.id, orderId: payment.orderId, before: payment.status, after: observation.canonicalStatus },
    "API reconciled the payment from a verified PortOne provider read",
  );
}

/**
 * A claimed PG window whose validity has passed while the provider still only
 * reports READY / PAY_PENDING (or no payment at all) is closed as
 * PENDING_EXPIRED. The worker never changes the payment here: a still-PENDING
 * order is cancelled by the reservation sweep or the customer's abandon, and
 * that version change re-opens this schedule for one more verification.
 */
export function paymentWindowExpired(
  payment: { status: string; pgAttemptStartedAt: Date | null },
  observation: PaymentObservation,
  now: Date,
  windowValidityMinutes: number,
): boolean {
  if (!payment.pgAttemptStartedAt) return false;
  if (payment.status !== "PENDING" && payment.status !== "CANCELLED") return false;
  if (!observation.providerStatus || !NO_CHARGE_WINDOW_PROVIDER_STATUSES.has(observation.providerStatus)) return false;
  // The canonical API must agree that nothing changed locally.
  if (observation.canonicalStatus !== undefined && observation.canonicalStatus !== payment.status) return false;
  const validityMs = Math.max(1, Math.trunc(windowValidityMinutes)) * 60_000;
  return now.getTime() - payment.pgAttemptStartedAt.getTime() >= validityMs;
}

export function paymentReconciliationDelayMs(attempt: number, baseMinutes: number): number {
  const boundedAttempt = Math.max(1, Math.min(Math.trunc(attempt), 20));
  const boundedBaseMs = Math.max(60_000, Math.trunc(baseMinutes) * 60_000);
  return Math.min(boundedBaseMs * 2 ** (boundedAttempt - 1), MAX_PAYMENT_RECONCILIATION_DELAY_MS);
}

async function recordPaymentReconciliation(
  pool: DatabasePool,
  input: {
    paymentId: string;
    paymentVersion: number;
    attempt: number;
    outcome: PaymentReconciliationOutcome;
    observedState: PaymentObservation["state"] | null;
    errorMessage: string | null;
    attemptedAt: Date;
    nextAttemptAt: Date;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO worker_payment_reconciliations(
       payment_id,payment_version,attempts,last_outcome,last_observed_state,
       last_error,last_attempted_at,next_attempt_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (payment_id) DO UPDATE SET
       payment_version=EXCLUDED.payment_version,
       attempts=EXCLUDED.attempts,
       last_outcome=EXCLUDED.last_outcome,
       last_observed_state=EXCLUDED.last_observed_state,
       last_error=EXCLUDED.last_error,
       last_attempted_at=EXCLUDED.last_attempted_at,
       next_attempt_at=EXCLUDED.next_attempt_at`,
    [
      input.paymentId,
      input.paymentVersion,
      input.attempt,
      input.outcome,
      input.observedState,
      input.errorMessage,
      input.attemptedAt,
      input.nextAttemptAt,
    ],
  );
}

export async function reconcilePayment(
  pool: DatabasePool,
  paymentId: string,
  provider: PaymentReconciliationProvider,
  logger: Logger,
): Promise<"missing" | "unknown" | "manual_review" | "reconciled"> {
  const result = await pool.query<PaymentRow>(
    `SELECT id,order_id,provider,provider_payment_id,status,amount,currency,version,updated_at
       FROM payments
      WHERE id=$1`,
    [paymentId],
  );
  if (!result.rowCount) return "missing";
  const payment = mapPayment(result.rows[0]!);
  const observed = await observePayment(payment, provider, logger);
  if (observed.outcome === "reconciled") {
    await verifyCanonicalPaymentTransition(pool, payment, observed.observation, logger);
  }
  return observed.outcome;
}

export async function reconcilePaymentBatch(
  pool: DatabasePool,
  provider: PaymentReconciliationProvider,
  options: { batchSize: number; staleMinutes: number; paymentWindowValidityMinutes?: number },
  logger: Logger,
  now = new Date(),
  shouldContinue: () => boolean = () => true,
): Promise<{ examined: number; unknown: number; manualReview: number; reconciled: number; failed: number }> {
  if (!shouldContinue()) return { examined: 0, unknown: 0, manualReview: 0, reconciled: 0, failed: 0 };
  const staleBefore = new Date(now.getTime() - options.staleMinutes * 60_000);
  const rows = await pool.query<PaymentRow>(
    `SELECT p.id,p.order_id,p.provider,p.provider_payment_id,p.status,p.amount,p.currency,
            p.version,p.updated_at,p.pg_attempt_started_at,r.payment_version AS reconciliation_version,
            r.attempts AS reconciliation_attempts
       FROM payments p
       LEFT JOIN worker_payment_reconciliations r ON r.payment_id=p.id
      WHERE (
          p.status IN ('PENDING','AUTHORIZED','REFUND_REVIEW')
          OR (p.status='CANCELLED' AND p.provider IN ('PORTONE_V2_INICIS','PORTONE_V2_KCP')
              AND p.pg_attempt_started_at IS NOT NULL)
        )
        AND p.updated_at <= $1
        -- A RECONCILED record for the current payment version is final: a
        -- verified no-charge cancellation or an expired PG window. Any later
        -- payment transition bumps the version and re-opens it.
        AND (r.payment_id IS NULL
          OR r.payment_version IS DISTINCT FROM p.version
          OR r.last_outcome IS DISTINCT FROM 'RECONCILED')
        AND (
          r.payment_id IS NULL
          OR r.payment_version <> p.version
          OR r.next_attempt_at <= $2
        )
      ORDER BY
        CASE
          WHEN r.payment_id IS NULL OR r.payment_version <> p.version THEN p.updated_at
          ELSE r.next_attempt_at
        END,
        p.id
      LIMIT $3`,
    [staleBefore, now, options.batchSize],
  );

  const summary = { examined: 0, unknown: 0, manualReview: 0, reconciled: 0, failed: 0 };
  for (const row of rows.rows) {
    if (!shouldContinue()) break;
    summary.examined += 1;
    const payment = mapPayment(row);
    const previousAttempts = row.reconciliation_version === row.version
      ? Number(row.reconciliation_attempts ?? 0)
      : 0;
    const attempt = Math.min(previousAttempts + 1, 1_000_000);
    const nextAttemptAt = new Date(
      now.getTime() + paymentReconciliationDelayMs(attempt, options.staleMinutes),
    );
    try {
      const result = await observePayment(payment, provider, logger);
      if (result.outcome === "reconciled") {
        await verifyCanonicalPaymentTransition(pool, payment, result.observation, logger);
      }
      const expired = result.outcome !== "reconciled" && paymentWindowExpired(
        { status: payment.status, pgAttemptStartedAt: row.pg_attempt_started_at ?? null },
        result.observation,
        now,
        options.paymentWindowValidityMinutes ?? DEFAULT_PAYMENT_WINDOW_VALIDITY_MINUTES,
      );
      if (expired) {
        result.outcome = "reconciled";
        logger.info(
          {
            paymentId: payment.id, orderId: payment.orderId, status: payment.status,
            providerStatus: result.observation.providerStatus, observedState: "PENDING_EXPIRED",
          },
          "Expired PG window closed without a charge; the order is released by the reservation sweep or customer abandon",
        );
      }
      if (!shouldContinue()) throw new Error("Worker run deadline reached after payment observation");
      await recordPaymentReconciliation(pool, {
        paymentId: row.id,
        paymentVersion: row.version,
        attempt,
        outcome: result.outcome === "unknown" ? "UNKNOWN" : result.outcome === "reconciled" ? "RECONCILED" : "MANUAL_REVIEW",
        observedState: expired ? PENDING_EXPIRED_OBSERVED_STATE : result.observation.state,
        errorMessage: null,
        attemptedAt: now,
        nextAttemptAt,
      });
      if (result.outcome === "unknown") summary.unknown += 1;
      else if (result.outcome === "reconciled") summary.reconciled += 1;
      else summary.manualReview += 1;
    } catch (error) {
      if (!shouldContinue()) throw error;
      await recordPaymentReconciliation(pool, {
        paymentId: row.id,
        paymentVersion: row.version,
        attempt,
        outcome: "ERROR",
        observedState: null,
        errorMessage: persistedErrorIdentity(error),
        attemptedAt: now,
        nextAttemptAt,
      });
      summary.failed += 1;
      logger.error(
        { paymentId: row.id, orderId: row.order_id, attempt, nextAttemptAt: nextAttemptAt.toISOString(), ...errorFields(error) },
        "Payment reconciliation observation failed and was durably deferred",
      );
    }
  }
  return summary;
}
