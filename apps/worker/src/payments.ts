import type { DatabasePool } from "@dabboba/db";
import { errorFields, type Logger } from "./logger.js";

const MAX_PAYMENT_RECONCILIATION_DELAY_MS = 24 * 60 * 60 * 1_000;

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
  reconciliation_version?: number | null;
  reconciliation_attempts?: number | null;
};

type PaymentReconciliationOutcome = "UNKNOWN" | "MANUAL_REVIEW" | "ERROR";

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
): Promise<{ outcome: "unknown" | "manual_review"; observation: PaymentObservation }> {
  const observation = await provider.observe(payment);
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
): Promise<"missing" | "unknown" | "manual_review"> {
  const result = await pool.query<PaymentRow>(
    `SELECT id,order_id,provider,provider_payment_id,status,amount,currency,version,updated_at
       FROM payments
      WHERE id=$1`,
    [paymentId],
  );
  if (!result.rowCount) return "missing";
  return (await observePayment(mapPayment(result.rows[0]!), provider, logger)).outcome;
}

export async function reconcilePaymentBatch(
  pool: DatabasePool,
  provider: PaymentReconciliationProvider,
  options: { batchSize: number; staleMinutes: number },
  logger: Logger,
  now = new Date(),
  shouldContinue: () => boolean = () => true,
): Promise<{ examined: number; unknown: number; manualReview: number; failed: number }> {
  if (!shouldContinue()) return { examined: 0, unknown: 0, manualReview: 0, failed: 0 };
  const staleBefore = new Date(now.getTime() - options.staleMinutes * 60_000);
  const rows = await pool.query<PaymentRow>(
    `SELECT p.id,p.order_id,p.provider,p.provider_payment_id,p.status,p.amount,p.currency,
            p.version,p.updated_at,r.payment_version AS reconciliation_version,
            r.attempts AS reconciliation_attempts
       FROM payments p
       LEFT JOIN worker_payment_reconciliations r ON r.payment_id=p.id
      WHERE p.status IN ('PENDING','AUTHORIZED','REFUND_REVIEW')
        AND p.updated_at <= $1
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

  const summary = { examined: 0, unknown: 0, manualReview: 0, failed: 0 };
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
      if (!shouldContinue()) throw new Error("Worker run deadline reached after payment observation");
      await recordPaymentReconciliation(pool, {
        paymentId: row.id,
        paymentVersion: row.version,
        attempt,
        outcome: result.outcome === "unknown" ? "UNKNOWN" : "MANUAL_REVIEW",
        observedState: result.observation.state,
        errorMessage: null,
        attemptedAt: now,
        nextAttemptAt,
      });
      if (result.outcome === "unknown") summary.unknown += 1;
      else summary.manualReview += 1;
    } catch (error) {
      if (!shouldContinue()) throw error;
      await recordPaymentReconciliation(pool, {
        paymentId: row.id,
        paymentVersion: row.version,
        attempt,
        outcome: "ERROR",
        observedState: null,
        errorMessage: (error instanceof Error ? error.message : String(error)).slice(0, 1_000),
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
