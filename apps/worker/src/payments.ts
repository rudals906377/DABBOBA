import type { DatabasePool } from "@dabboba/db";
import type { Logger } from "./logger.js";

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
  updated_at: Date;
};

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
): Promise<"unknown" | "manual_review"> {
  const observation = await provider.observe(payment);
  if (!requiresManualPaymentAction(payment.status, observation.state)) {
    logger.warn(
      { paymentId: payment.id, orderId: payment.orderId, provider: payment.provider, status: payment.status },
      "Payment needs a configured provider reconciliation adapter or a verified webhook",
    );
    return "unknown";
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
  return "manual_review";
}

export async function reconcilePayment(
  pool: DatabasePool,
  paymentId: string,
  provider: PaymentReconciliationProvider,
  logger: Logger,
): Promise<"missing" | "unknown" | "manual_review"> {
  const result = await pool.query<PaymentRow>(
    `SELECT id,order_id,provider,provider_payment_id,status,amount,currency,updated_at
       FROM payments
      WHERE id=$1`,
    [paymentId],
  );
  if (!result.rowCount) return "missing";
  return observePayment(mapPayment(result.rows[0]!), provider, logger);
}

export async function reconcilePaymentBatch(
  pool: DatabasePool,
  provider: PaymentReconciliationProvider,
  options: { batchSize: number; staleMinutes: number },
  logger: Logger,
  now = new Date(),
): Promise<{ examined: number; unknown: number; manualReview: number }> {
  const staleBefore = new Date(now.getTime() - options.staleMinutes * 60_000);
  const rows = await pool.query<PaymentRow>(
    `SELECT id,order_id,provider,provider_payment_id,status,amount,currency,updated_at
       FROM payments
      WHERE status IN ('PENDING','AUTHORIZED','REFUND_REVIEW') AND updated_at <= $1
      ORDER BY updated_at,id
      LIMIT $2`,
    [staleBefore, options.batchSize],
  );

  const summary = { examined: rows.rows.length, unknown: 0, manualReview: 0 };
  for (const row of rows.rows) {
    const payment = mapPayment(row);
    const outcome = await observePayment(payment, provider, logger);
    if (outcome === "unknown") {
      summary.unknown += 1;
      continue;
    }
    summary.manualReview += 1;
  }
  return summary;
}
