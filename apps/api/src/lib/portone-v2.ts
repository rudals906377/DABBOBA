import type {
  CancelPaymentResponse,
  Payment,
  PaymentCancellation,
} from "@portone/server-sdk/payment";

const PORTONE_API_ORIGIN = "https://api.portone.io";
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_REASON_LENGTH = 500;

const PAYMENT_STATUSES = [
  "READY",
  "PAY_PENDING",
  "VIRTUAL_ACCOUNT_ISSUED",
  "PAID",
  "PARTIAL_CANCELLED",
  "CANCELLED",
  "FAILED",
] as const;

export type PortOnePaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type PortOneChannelEnvironment = "LIVE" | "TEST";
export type PortOneCardPgProvider = "INICIS_V2" | "KCP_V2";
export type PortOneCancelRequester = "CUSTOMER" | "ADMIN";
export type PortOneCancellationOutcome = "SUCCEEDED" | "PENDING" | "FAILED";

export type PortOneFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type PortOneV2ErrorCode =
  | "INVALID_CONFIGURATION"
  | "INVALID_REQUEST"
  | "UPSTREAM_REJECTED"
  | "UPSTREAM_UNAVAILABLE"
  | "UNEXPECTED_RESPONSE"
  | "PAYMENT_CONTRACT_MISMATCH"
  | "CANCELLATION_INDETERMINATE";

export class PortOneV2Error extends Error {
  readonly code: PortOneV2ErrorCode;
  readonly indeterminate: boolean;
  readonly httpStatus: number | null;
  readonly providerErrorType: string | null;

  constructor(
    code: PortOneV2ErrorCode,
    message: string,
    options: {
      indeterminate?: boolean;
      httpStatus?: number;
      providerErrorType?: string | undefined;
    } = {},
  ) {
    super(message);
    Object.setPrototypeOf(this, PortOneV2Error.prototype);
    this.name = "PortOneV2Error";
    this.code = code;
    this.indeterminate = options.indeterminate ?? false;
    this.httpStatus = options.httpStatus ?? null;
    this.providerErrorType = options.providerErrorType ?? null;
  }
}

/**
 * True only when PortOne authoritatively rejected a lookup because it has no
 * payment for this ID (the customer never submitted the payment window).
 * Network failures, timeouts and any other rejection stay indeterminate.
 */
export function isPortOnePaymentNotFound(error: unknown): boolean {
  return error instanceof PortOneV2Error
    && error.code === "UPSTREAM_REJECTED"
    && error.httpStatus === 404
    && error.providerErrorType === "PAYMENT_NOT_FOUND";
}

export type PortOneCancellation = {
  outcome: PortOneCancellationOutcome;
  cancellationId: string;
  pgCancellationId: string | null;
  totalAmount: number;
  requestedAt: string;
  cancelledAt: string | null;
};

export type PortOneCardPayment = {
  paymentId: string;
  portOneTransactionId: string;
  pgTransactionId: string | null;
  status: PortOnePaymentStatus;
  version: "V2";
  merchantId: string;
  storeId: string;
  channel: {
    key: string;
    environment: PortOneChannelEnvironment;
    pgProvider: PortOneCardPgProvider;
  } | null;
  method: "CARD" | null;
  amount: {
    total: number;
    paid: number;
    cancelled: number;
  };
  currency: "KRW";
  requestedAt: string;
  statusChangedAt: string;
  paidAt: string | null;
  failedAt: string | null;
  /** Allowlisted PG failure code only; never retain provider free-text messages. */
  failureCode?: "01" | undefined;
  cancelledAt: string | null;
  cancellations: PortOneCancellation[];
};

/**
 * Observed KG Inicis READY response: amount.paid may equal the requested total
 * even before a card was selected. Keep the raw amount, but distinguish this
 * exact unsubmitted shape from settlement evidence. Only the INICIS channel
 * qualifies; KCP has no such evidence and stays fail-closed. Any PG
 * transaction, payment method, terminal time, cancellation or partial amount
 * keeps the existing fail-closed behavior.
 */
export function isPortOneUnsubmittedReady(payment: PortOneCardPayment): boolean {
  return payment.status === "READY"
    && payment.channel?.pgProvider === "INICIS_V2"
    && payment.method === null
    && payment.pgTransactionId === null
    && payment.paidAt === null
    && payment.failedAt === null
    && payment.cancelledAt === null
    && payment.cancellations.length === 0
    && payment.amount.cancelled === 0
    && payment.amount.paid === payment.amount.total;
}

/**
 * Observed authenticated KG Inicis response after closing the unsubmitted
 * window: FAILED / pgCode 01 (user cancelled), still carrying the requested
 * amount. Any approval, card method, PG transaction, refund, other failure or
 * non-INICIS channel keeps the existing fail-closed handling. Do not infer
 * this from a client callback.
 */
export function isPortOneUnsubmittedFailure(payment: PortOneCardPayment): boolean {
  return payment.status === "FAILED"
    && payment.failureCode === "01"
    && payment.channel?.pgProvider === "INICIS_V2"
    && payment.method === null
    && payment.pgTransactionId === null
    && payment.paidAt === null
    && payment.failedAt !== null
    && payment.cancelledAt === null
    && payment.cancellations.length === 0
    && payment.amount.cancelled === 0
    && (payment.amount.paid === 0 || payment.amount.paid === payment.amount.total);
}

export type PortOneV2AdapterOptions = {
  apiSecret: string;
  merchantId: string;
  storeId: string;
  channelKey: string;
  channelEnvironment: PortOneChannelEnvironment;
  /** Trusted persisted channel binding; legacy callers remain INICIS-only. */
  pgProvider?: PortOneCardPgProvider;
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetchImpl?: PortOneFetch;
};

export type PortOnePaymentLookupInput = {
  paymentId: string;
  expectedTotalAmount: number;
};

export type PortOneCancellationInput = {
  paymentId: string;
  currentCancellableAmount: number;
  amount?: number;
  reason: string;
  requester: PortOneCancelRequester;
};

export type PortOneV2Adapter = {
  getPayment(input: PortOnePaymentLookupInput): Promise<PortOneCardPayment>;
  cancelPayment(input: PortOneCancellationInput): Promise<PortOneCancellation>;
};

class ResponseLimitError extends Error {}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredIdentifier(value: unknown, label: string): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > MAX_IDENTIFIER_LENGTH
    || value === "."
    || value === ".."
    || /[^\x20-\x7e]/.test(value)
  ) {
    throw new PortOneV2Error("INVALID_REQUEST", `${label} is invalid.`);
  }
  return value;
}

function configuredIdentifier(value: unknown, label: string): string {
  try {
    return requiredIdentifier(value, label);
  } catch {
    throw new PortOneV2Error("INVALID_CONFIGURATION", `${label} is invalid.`);
  }
}

function positiveSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new PortOneV2Error("INVALID_REQUEST", `${label} must be a positive safe integer.`);
  }
  return value as number;
}

function nonNegativeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new PortOneV2Error("UNEXPECTED_RESPONSE", `${label} is invalid.`);
  }
  return value as number;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length < 1) {
    throw new PortOneV2Error("UNEXPECTED_RESPONSE", `${label} is missing.`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  return requiredString(value, label);
}

function timestamp(value: unknown, label: string): string {
  const text = requiredString(value, label);
  if (Number.isNaN(Date.parse(text))) {
    throw new PortOneV2Error("UNEXPECTED_RESPONSE", `${label} is invalid.`);
  }
  return text;
}

function optionalTimestamp(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  return timestamp(value, label);
}

function paymentStatus(value: unknown): PortOnePaymentStatus {
  if (typeof value === "string" && PAYMENT_STATUSES.includes(value as PortOnePaymentStatus)) {
    return value as PortOnePaymentStatus;
  }
  throw new PortOneV2Error("UNEXPECTED_RESPONSE", "PortOne returned an unrecognized payment status.");
}

function cancellationOutcome(value: unknown): PortOneCancellationOutcome {
  if (value === "SUCCEEDED") return "SUCCEEDED";
  if (value === "REQUESTED") return "PENDING";
  if (value === "FAILED") return "FAILED";
  throw new PortOneV2Error("UNEXPECTED_RESPONSE", "PortOne returned an unrecognized cancellation status.");
}

function normalizeCancellation(value: unknown): PortOneCancellation {
  const raw = record(value);
  if (!raw) {
    throw new PortOneV2Error("UNEXPECTED_RESPONSE", "PortOne returned an invalid cancellation.");
  }
  return {
    outcome: cancellationOutcome(raw.status),
    cancellationId: requiredString(raw.id, "cancellation.id"),
    pgCancellationId: optionalString(raw.pgCancellationId, "cancellation.pgCancellationId"),
    totalAmount: nonNegativeSafeInteger(raw.totalAmount, "cancellation.totalAmount"),
    requestedAt: timestamp(raw.requestedAt, "cancellation.requestedAt"),
    cancelledAt: optionalTimestamp(raw.cancelledAt, "cancellation.cancelledAt"),
  };
}

function cancellationList(value: unknown): PortOneCancellation[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new PortOneV2Error("UNEXPECTED_RESPONSE", "PortOne returned invalid cancellations.");
  }
  return value.map(normalizeCancellation);
}

function providerErrorType(value: unknown): string | undefined {
  const raw = record(value);
  if (!raw || typeof raw.type !== "string" || !/^[A-Z0-9_]{1,100}$/.test(raw.type)) {
    return undefined;
  }
  return raw.type;
}

async function readBoundedResponse(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const declared = Number(declaredLength);
    if (!Number.isSafeInteger(declared) || declared < 0 || declared > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new ResponseLimitError();
    }
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  const cancelReader = () => {
    void reader.cancel().catch(() => undefined);
  };
  if (signal.aborted) cancelReader();
  else signal.addEventListener("abort", cancelReader, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new Error("PortOne response timed out.");
      const chunk = await reader.read();
      if (signal.aborted) throw new Error("PortOne response timed out.");
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ResponseLimitError();
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    if (signal.aborted) throw new Error("PortOne response timed out.");
    body += decoder.decode();
    return body;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    signal.removeEventListener("abort", cancelReader);
    reader.releaseLock();
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new PortOneV2Error("UNEXPECTED_RESPONSE", "PortOne returned an invalid JSON response.");
  }
}

function normalizePayment(
  value: unknown,
  expected: {
    paymentId: string;
    totalAmount: number;
    merchantId: string;
    storeId: string;
    channelKey: string;
    channelEnvironment: PortOneChannelEnvironment;
    pgProvider: PortOneCardPgProvider;
  },
): PortOneCardPayment {
  const raw = record(value) as (Payment & Record<string, unknown>) | null;
  const amount = raw ? record(raw.amount) : null;
  const channel = raw ? record(raw.channel) : null;
  const method = raw ? record(raw.method) : null;
  if (!raw || !amount) {
    throw new PortOneV2Error("UNEXPECTED_RESPONSE", "PortOne returned an incomplete payment.");
  }

  const status = paymentStatus(raw.status);
  const paid = nonNegativeSafeInteger(amount.paid, "payment.amount.paid");
  const cancelled = nonNegativeSafeInteger(amount.cancelled, "payment.amount.cancelled");
  const mismatched = (
    raw.id !== expected.paymentId
    || raw.version !== "V2"
    || raw.merchantId !== expected.merchantId
    || raw.storeId !== expected.storeId
    || (channel && (channel.key !== expected.channelKey
      || channel.type !== expected.channelEnvironment
      || channel.pgProvider !== expected.pgProvider))
    || (method && method.type !== "PaymentMethodCard")
    || raw.currency !== "KRW"
    || amount.total !== expected.totalAmount
  );
  if (mismatched) {
    throw new PortOneV2Error(
      "PAYMENT_CONTRACT_MISMATCH",
      "The PortOne payment does not match the expected V2 card channel contract.",
    );
  }

  const rawCancellations = (raw as Record<string, unknown>).cancellations;
  const payment: PortOneCardPayment = {
    paymentId: requiredString(raw.id, "payment.id"),
    portOneTransactionId: requiredString(raw.transactionId, "payment.transactionId"),
    pgTransactionId: optionalString(raw.pgTxId, "payment.pgTxId"),
    status,
    version: "V2",
    merchantId: requiredString(raw.merchantId, "payment.merchantId"),
    storeId: requiredString(raw.storeId, "payment.storeId"),
    channel: channel ? {
      key: requiredString(channel.key, "payment.channel.key"),
      environment: channel.type as PortOneChannelEnvironment,
      pgProvider: expected.pgProvider,
    } : null,
    method: method ? "CARD" : null,
    amount: {
      total: nonNegativeSafeInteger(amount.total, "payment.amount.total"),
      paid,
      cancelled,
    },
    currency: "KRW",
    requestedAt: timestamp(raw.requestedAt, "payment.requestedAt"),
    statusChangedAt: timestamp(raw.statusChangedAt, "payment.statusChangedAt"),
    paidAt: optionalTimestamp(raw.paidAt, "payment.paidAt"),
    failedAt: optionalTimestamp(raw.failedAt, "payment.failedAt"),
    ...(status === "FAILED" && record(raw.failure)?.pgCode === "01" ? { failureCode: "01" as const } : {}),
    cancelledAt: optionalTimestamp(raw.cancelledAt, "payment.cancelledAt"),
    cancellations: cancellationList(rawCancellations),
  };
  // READY/PAY_PENDING may omit details before submission. Positive amounts
  // are accepted only for the observed INICIS shapes, never inferred for KCP.
  const awaitingPg = paid === 0 && cancelled === 0;
  if ((!channel && !(status === "READY" && awaitingPg))
    || (!method && !(["READY", "PAY_PENDING"].includes(status) && awaitingPg)
      && !isPortOneUnsubmittedReady(payment) && !isPortOneUnsubmittedFailure(payment))) {
    throw new PortOneV2Error("UNEXPECTED_RESPONSE", "PortOne returned an incomplete payment.");
  }
  return payment;
}

function normalizeCancelResponse(value: unknown, expectedAmount: number): PortOneCancellation {
  const response = record(value) as (CancelPaymentResponse & Record<string, unknown>) | null;
  if (!response) {
    throw new PortOneV2Error("UNEXPECTED_RESPONSE", "PortOne returned an invalid cancellation response.");
  }
  const cancellation = normalizeCancellation(response.cancellation as PaymentCancellation | undefined);
  if (cancellation.totalAmount !== expectedAmount) {
    throw new PortOneV2Error(
      "UNEXPECTED_RESPONSE",
      "PortOne cancellation amount does not match the requested amount.",
    );
  }
  return cancellation;
}

function validateOptions(options: PortOneV2AdapterOptions) {
  if (
    typeof options.apiSecret !== "string"
    || options.apiSecret.length < 1
    || options.apiSecret.length > 4_096
    || /[\r\n]/.test(options.apiSecret)
  ) {
    throw new PortOneV2Error("INVALID_CONFIGURATION", "PortOne API secret is invalid.");
  }
  const merchantId = configuredIdentifier(options.merchantId, "merchantId");
  const storeId = configuredIdentifier(options.storeId, "storeId");
  const channelKey = configuredIdentifier(options.channelKey, "channelKey");
  if (options.channelEnvironment !== "LIVE" && options.channelEnvironment !== "TEST") {
    throw new PortOneV2Error("INVALID_CONFIGURATION", "channelEnvironment is invalid.");
  }
  const pgProvider = options.pgProvider === undefined ? "INICIS_V2" : options.pgProvider;
  if (pgProvider !== "INICIS_V2" && pgProvider !== "KCP_V2") {
    throw new PortOneV2Error("INVALID_CONFIGURATION", "pgProvider is invalid.");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new PortOneV2Error("INVALID_CONFIGURATION", "timeoutMs is invalid.");
  }
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1_024 || maxResponseBytes > 2_097_152) {
    throw new PortOneV2Error("INVALID_CONFIGURATION", "maxResponseBytes is invalid.");
  }
  return {
    apiSecret: options.apiSecret,
    merchantId,
    storeId,
    channelKey,
    channelEnvironment: options.channelEnvironment,
    pgProvider,
    timeoutMs,
    maxResponseBytes,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
  };
}

export function createPortOneV2Adapter(options: PortOneV2AdapterOptions): PortOneV2Adapter {
  const config = validateOptions(options);

  async function request(
    operation: "lookup" | "cancel",
    url: URL,
    init: Omit<RequestInit, "signal" | "redirect">,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    let response: Response;
    let text: string;
    try {
      response = await config.fetchImpl(url, {
        ...init,
        redirect: "error",
        signal: controller.signal,
      });
      text = await readBoundedResponse(response, config.maxResponseBytes, controller.signal);
      if (controller.signal.aborted) throw new Error("PortOne request timed out.");
    } catch (error) {
      if (operation === "cancel") {
        throw new PortOneV2Error(
          "CANCELLATION_INDETERMINATE",
          "PortOne cancellation outcome is indeterminate; reconcile with a fresh payment lookup before any retry.",
          { indeterminate: true },
        );
      }
      if (error instanceof ResponseLimitError) {
        throw new PortOneV2Error("UNEXPECTED_RESPONSE", "PortOne response exceeded the size limit.");
      }
      throw new PortOneV2Error("UPSTREAM_UNAVAILABLE", "PortOne payment lookup failed.");
    } finally {
      clearTimeout(timeout);
    }

    let parsed: unknown;
    try {
      parsed = parseJson(text);
    } catch (error) {
      if (operation === "cancel") {
        throw new PortOneV2Error(
          "CANCELLATION_INDETERMINATE",
          "PortOne cancellation outcome is indeterminate; reconcile with a fresh payment lookup before any retry.",
          { indeterminate: true, httpStatus: response.status },
        );
      }
      throw error;
    }

    if (!response.ok) {
      if (operation === "cancel") {
        throw new PortOneV2Error(
          "CANCELLATION_INDETERMINATE",
          "PortOne cancellation outcome is indeterminate; reconcile with a fresh payment lookup before any retry.",
          {
            indeterminate: true,
            httpStatus: response.status,
            providerErrorType: providerErrorType(parsed),
          },
        );
      }
      throw new PortOneV2Error("UPSTREAM_REJECTED", "PortOne rejected the request.", {
        httpStatus: response.status,
        providerErrorType: providerErrorType(parsed),
      });
    }
    return parsed;
  }

  return {
    async getPayment(input) {
      const paymentId = requiredIdentifier(input.paymentId, "paymentId");
      if (!Number.isSafeInteger(input.expectedTotalAmount) || input.expectedTotalAmount < 0) {
        throw new PortOneV2Error("INVALID_REQUEST", "expectedTotalAmount is invalid.");
      }
      const url = new URL(`/payments/${encodeURIComponent(paymentId)}`, PORTONE_API_ORIGIN);
      url.searchParams.set("storeId", config.storeId);
      const response = await request("lookup", url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `PortOne ${config.apiSecret}`,
        },
      });
      return normalizePayment(response, {
        paymentId,
        totalAmount: input.expectedTotalAmount,
        merchantId: config.merchantId,
        storeId: config.storeId,
        channelKey: config.channelKey,
        channelEnvironment: config.channelEnvironment,
        pgProvider: config.pgProvider,
      });
    },

    /**
     * Low-level cancellation primitive. The caller must first bind a fresh
     * PortOne lookup to the locked local payment and retain its idempotency
     * record. This function never mutates the ledger and never retries.
     */
    async cancelPayment(input) {
      const paymentId = requiredIdentifier(input.paymentId, "paymentId");
      const currentCancellableAmount = positiveSafeInteger(
        input.currentCancellableAmount,
        "currentCancellableAmount",
      );
      if (input.amount !== undefined) {
        const amount = positiveSafeInteger(input.amount, "amount");
        if (amount > currentCancellableAmount) {
          throw new PortOneV2Error("INVALID_REQUEST", "amount exceeds currentCancellableAmount.");
        }
      }
      const reason = typeof input.reason === "string" ? input.reason.trim() : "";
      if (reason.length < 1 || reason.length > MAX_REASON_LENGTH) {
        throw new PortOneV2Error("INVALID_REQUEST", "reason is invalid.");
      }
      if (input.requester !== "CUSTOMER" && input.requester !== "ADMIN") {
        throw new PortOneV2Error("INVALID_REQUEST", "requester is invalid.");
      }

      const url = new URL(`/payments/${encodeURIComponent(paymentId)}/cancel`, PORTONE_API_ORIGIN);
      const response = await request("cancel", url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `PortOne ${config.apiSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          storeId: config.storeId,
          amount: input.amount,
          currentCancellableAmount,
          reason,
          requester: input.requester,
        }),
      });
      try {
        return normalizeCancelResponse(response, input.amount ?? currentCancellableAmount);
      } catch {
        throw new PortOneV2Error(
          "CANCELLATION_INDETERMINATE",
          "PortOne cancellation outcome is indeterminate; reconcile with a fresh payment lookup before any retry.",
          { indeterminate: true },
        );
      }
    },
  };
}
