import { Webhook } from "@portone/server-sdk";

const MAX_WEBHOOK_BODY_BYTES = 65_536;
const MAX_WEBHOOK_ID_LENGTH = 200;
const MAX_WEBHOOK_SIGNATURE_LENGTH = 4_096;
const MAX_WEBHOOK_TIMESTAMP_LENGTH = 32;

const PAYMENT_NOTIFICATION_TYPES = [
  "Transaction.Ready",
  "Transaction.Paid",
  "Transaction.VirtualAccountIssued",
  "Transaction.PartialCancelled",
  "Transaction.Cancelled",
  "Transaction.Failed",
  "Transaction.PayPending",
  "Transaction.DisputeCreated",
  "Transaction.DisputeResolved",
  "Transaction.CancelPending",
  "Transaction.Confirm",
] as const;

export type PortOneWebhookHeaders = Record<string, string | string[] | undefined>;

export type PortOnePaymentLookupTrigger = {
  requiresFreshPaymentLookup: true;
  eventId: string;
  notificationType: string;
  occurredAt: string;
  paymentId: string;
  storeId: string;
  portOneTransactionId: string;
  cancellationId: string | null;
};

export type PortOneWebhookErrorCode =
  | "INVALID_WEBHOOK"
  | "WEBHOOK_TOO_LARGE"
  | "UNSUPPORTED_WEBHOOK"
  | "WEBHOOK_CONTRACT_MISMATCH";

export class PortOneWebhookError extends Error {
  readonly code: PortOneWebhookErrorCode;

  constructor(code: PortOneWebhookErrorCode, message: string) {
    super(message);
    Object.setPrototypeOf(this, PortOneWebhookError.prototype);
    this.name = "PortOneWebhookError";
    this.code = code;
  }
}

function singleHeader(
  headers: PortOneWebhookHeaders,
  name: string,
  maxLength: number,
): string {
  const matches = Object.entries(headers).filter(([key]) => key.toLowerCase() === name);
  if (matches.length !== 1) {
    throw new PortOneWebhookError("INVALID_WEBHOOK", "PortOne webhook headers are invalid.");
  }
  const value = matches[0]![1];
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength) {
    throw new PortOneWebhookError("INVALID_WEBHOOK", "PortOne webhook headers are invalid.");
  }
  return value;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 500) {
    throw new PortOneWebhookError("UNSUPPORTED_WEBHOOK", "PortOne webhook data is unsupported.");
  }
  return value;
}

function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return requiredString(value);
}

export async function verifyPortOnePaymentWebhook(input: {
  webhookSecret: string;
  rawBody: string;
  headers: PortOneWebhookHeaders;
  expectedStoreId: string;
}): Promise<PortOnePaymentLookupTrigger> {
  if (
    typeof input.webhookSecret !== "string"
    || input.webhookSecret.length < 1
    || input.webhookSecret.length > 4_096
    || typeof input.expectedStoreId !== "string"
    || input.expectedStoreId.length < 1
    || input.expectedStoreId.length > 200
  ) {
    throw new PortOneWebhookError("INVALID_WEBHOOK", "PortOne webhook configuration is invalid.");
  }
  if (typeof input.rawBody !== "string") {
    throw new PortOneWebhookError("INVALID_WEBHOOK", "PortOne webhook body must be raw text.");
  }
  if (Buffer.byteLength(input.rawBody, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
    throw new PortOneWebhookError("WEBHOOK_TOO_LARGE", "PortOne webhook body is too large.");
  }

  const eventId = singleHeader(input.headers, "webhook-id", MAX_WEBHOOK_ID_LENGTH);
  const signature = singleHeader(
    input.headers,
    "webhook-signature",
    MAX_WEBHOOK_SIGNATURE_LENGTH,
  );
  const webhookTimestamp = singleHeader(
    input.headers,
    "webhook-timestamp",
    MAX_WEBHOOK_TIMESTAMP_LENGTH,
  );
  if (!/^[0-9]{1,16}$/.test(webhookTimestamp) || !Number.isSafeInteger(Number(webhookTimestamp))) {
    throw new PortOneWebhookError("INVALID_WEBHOOK", "PortOne webhook timestamp is invalid.");
  }

  let verified: unknown;
  try {
    verified = await Webhook.verify(input.webhookSecret, input.rawBody, {
      "webhook-id": eventId,
      "webhook-signature": signature,
      "webhook-timestamp": webhookTimestamp,
    });
  } catch {
    throw new PortOneWebhookError("INVALID_WEBHOOK", "PortOne webhook verification failed.");
  }

  const webhook = object(verified);
  const data = webhook ? object(webhook.data) : null;
  if (
    !webhook
    || !data
    || typeof webhook.type !== "string"
    || !PAYMENT_NOTIFICATION_TYPES.includes(
      webhook.type as (typeof PAYMENT_NOTIFICATION_TYPES)[number],
    )
  ) {
    throw new PortOneWebhookError(
      "UNSUPPORTED_WEBHOOK",
      "Only PortOne transaction webhooks can trigger a payment lookup.",
    );
  }

  const storeId = requiredString(data.storeId);
  if (storeId !== input.expectedStoreId) {
    throw new PortOneWebhookError(
      "WEBHOOK_CONTRACT_MISMATCH",
      "PortOne webhook store does not match the configured store.",
    );
  }
  const occurredAt = requiredString(webhook.timestamp);
  if (Number.isNaN(Date.parse(occurredAt))) {
    throw new PortOneWebhookError("UNSUPPORTED_WEBHOOK", "PortOne webhook timestamp is invalid.");
  }

  return {
    requiresFreshPaymentLookup: true,
    eventId,
    notificationType: webhook.type,
    occurredAt,
    paymentId: requiredString(data.paymentId),
    storeId,
    portOneTransactionId: requiredString(data.transactionId),
    cancellationId: optionalString(data.cancellationId),
  };
}
