import { createHash, createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { AppError, badRequest, notFound } from "../lib/errors.js";
import { requireLiveCommerce } from "../lib/commerce-mode.js";
import {
  createPortOneV2Adapter,
  PortOneV2Error,
  type PortOneCardPayment,
} from "../lib/portone-v2.js";
import {
  PortOneWebhookError,
  verifyPortOnePaymentWebhook,
} from "../lib/portone-webhook.js";
import { uuidInput } from "../lib/input.js";
import { numberValue } from "../lib/rows.js";
import type { ApiContext } from "../types.js";

const PORTONE_PROVIDER = "PORTONE_V2_INICIS";

type LocalPayment = {
  id: string;
  order_id: string;
  amount: number;
};

type NormalizedEventType =
  | "PAYMENT_SUCCEEDED"
  | "PAYMENT_FAILED"
  | "PAYMENT_CANCELLED"
  | "REFUND_SUCCEEDED";

type NormalizedProviderEvent = {
  eventId: string;
  eventType: NormalizedEventType;
  paymentId: string;
  providerPaymentId: string;
  occurredAt: string;
  amount: number;
};

function configuredContext(context: ApiContext) {
  if (
    context.config.paymentProvider !== PORTONE_PROVIDER
    || !context.config.paymentWebhookSecret
    || !context.config.portOne
  ) {
    throw new AppError(503, "PAYMENT_NOT_CONFIGURED", "포트원 결제가 구성되지 않았습니다.");
  }
  return context.config.portOne;
}

function providerError(error: unknown): AppError {
  if (error instanceof PortOneV2Error) {
    const status = error.code === "PAYMENT_CONTRACT_MISMATCH" ? 409 : 502;
    return new AppError(
      status,
      error.code === "PAYMENT_CONTRACT_MISMATCH"
        ? "PAYMENT_CONTRACT_MISMATCH"
        : "PAYMENT_PROVIDER_UNAVAILABLE",
      error.code === "PAYMENT_CONTRACT_MISMATCH"
        ? "결제사 승인 정보와 주문 정보가 일치하지 않습니다."
        : "결제사 승인 상태를 확인하지 못했습니다.",
    );
  }
  if (error instanceof PortOneWebhookError) {
    const status = error.code === "WEBHOOK_TOO_LARGE" ? 413 : 401;
    return new AppError(status, error.code, "포트원 웹훅을 검증하지 못했습니다.");
  }
  return new AppError(502, "PAYMENT_PROVIDER_UNAVAILABLE", "결제사 상태를 확인하지 못했습니다.");
}

export function normalizedPortOneEventForPayment(
  payment: PortOneCardPayment,
): NormalizedProviderEvent | null {
  let eventType: NormalizedEventType;
  let amount = payment.amount.total;

  switch (payment.status) {
    case "READY":
    case "PAY_PENDING":
    case "VIRTUAL_ACCOUNT_ISSUED":
      return null;
    case "PAID":
      eventType = "PAYMENT_SUCCEEDED";
      break;
    case "FAILED":
      eventType = "PAYMENT_FAILED";
      break;
    case "CANCELLED":
      eventType = payment.amount.paid > 0 && payment.amount.cancelled >= payment.amount.paid
        ? "REFUND_SUCCEEDED"
        : "PAYMENT_CANCELLED";
      break;
    case "PARTIAL_CANCELLED":
      // The current DABBOBA order model only supports a full-order refund.
      // Deliberately send the remaining paid amount so the canonical handler
      // detects an amount mismatch and moves the order to REFUND_REVIEW rather
      // than incorrectly revoking every asset for a partial cancellation.
      eventType = "REFUND_SUCCEEDED";
      amount = Math.max(0, payment.amount.paid - payment.amount.cancelled);
      break;
  }

  const providerPaymentId = payment.pgTransactionId || payment.portOneTransactionId;
  const stateFingerprint = JSON.stringify({
    paymentId: payment.paymentId,
    transactionId: payment.portOneTransactionId,
    status: payment.status,
    statusChangedAt: payment.statusChangedAt,
    paid: payment.amount.paid,
    cancelled: payment.amount.cancelled,
  });
  return {
    eventId: `portone-${createHash("sha256").update(stateFingerprint).digest("hex")}`,
    eventType,
    paymentId: payment.paymentId,
    providerPaymentId,
    occurredAt: payment.statusChangedAt,
    amount,
  };
}

async function dispatchCanonicalEvent(
  app: FastifyInstance,
  context: ApiContext,
  event: NormalizedProviderEvent,
) {
  const secret = context.config.paymentWebhookSecret!;
  const rawBody = JSON.stringify(event);
  const signature = createHmac("sha256", secret).update(rawBody).digest("hex");
  const response = await app.inject({
    method: "POST",
    url: `/v1/payments/webhooks/${PORTONE_PROVIDER}`,
    headers: {
      "content-type": "application/json",
      "x-dabboba-signature": `sha256=${signature}`,
    },
    payload: rawBody,
  });
  const body = response.json() as { outcome?: string; error?: { code?: string; message?: string } };
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new AppError(
      response.statusCode,
      body.error?.code || "PAYMENT_RECONCILIATION_FAILED",
      body.error?.message || "결제 승인 상태를 주문에 반영하지 못했습니다.",
    );
  }
  return body.outcome || "processed";
}

async function reconcilePayment(
  app: FastifyInstance,
  context: ApiContext,
  localPayment: LocalPayment,
) {
  const config = configuredContext(context);
  const adapter = createPortOneV2Adapter(config);
  let payment: PortOneCardPayment;
  try {
    payment = await adapter.getPayment({
      paymentId: localPayment.id,
      expectedTotalAmount: numberValue(localPayment.amount),
    });
  } catch (error) {
    throw providerError(error);
  }
  const event = normalizedPortOneEventForPayment(payment);
  if (!event) {
    return { providerStatus: payment.status, outcome: "pending" as const };
  }
  const outcome = await dispatchCanonicalEvent(app, context, event);
  return { providerStatus: payment.status, outcome };
}

export async function registerPortOnePaymentRoutes(
  app: FastifyInstance,
  context: ApiContext,
) {
  app.post(
    "/v1/payments/:paymentId/confirm",
    { preHandler: [requireLiveCommerce(context), context.auth.requireUser] },
    async (request, reply) => {
      configuredContext(context);
      const paymentId = uuidInput(
        (request.params as Record<string, unknown>).paymentId,
        "paymentId",
      );
      const payment = await context.pool.query<LocalPayment>(
        `SELECT p.id,p.order_id,p.amount
           FROM payments p
           JOIN orders o ON o.id=p.order_id
          WHERE p.id=$1 AND o.user_id=$2`,
        [paymentId, request.actor!.userId],
      );
      if (!payment.rowCount) throw notFound("결제 정보를 찾을 수 없습니다.");
      const result = await reconcilePayment(app, context, payment.rows[0]!);
      return reply.code(200).send({
        accepted: true,
        paymentId,
        orderId: payment.rows[0]!.order_id,
        ...result,
      });
    },
  );

  app.post("/v1/payments/webhooks/portone", { preHandler: requireLiveCommerce(context) }, async (request, reply) => {
    const config = configuredContext(context);
    if (!request.rawBody) throw badRequest("웹훅 원문이 없습니다.");
    let trigger;
    try {
      trigger = await verifyPortOnePaymentWebhook({
        webhookSecret: config.webhookSecret,
        rawBody: request.rawBody.toString("utf8"),
        headers: request.headers,
        expectedStoreId: config.storeId,
      });
    } catch (error) {
      throw providerError(error);
    }
    const payment = await context.pool.query<LocalPayment>(
      "SELECT id,order_id,amount FROM payments WHERE id=$1 AND provider=$2",
      [trigger.paymentId, PORTONE_PROVIDER],
    );
    if (!payment.rowCount) throw notFound("결제 정보를 찾을 수 없습니다.");
    const result = await reconcilePayment(app, context, payment.rows[0]!);
    return reply.code(202).send({ accepted: true, ...result });
  });
}
