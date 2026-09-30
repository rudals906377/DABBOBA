import { createHmac } from "node:crypto";
import type { PaymentObservation, PaymentRecord, PaymentReconciliationProvider } from "./payments.js";

export type PortOneApiRequeryConfig = { apiBaseUrl: string; secret: string };
export type PortOneApiRequeryDependencies = {
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  timeoutMs?: number;
};

const RESPONSE_LIMIT = 8 * 1_024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_STATUSES = new Set(["PENDING", "AUTHORIZED", "PAID", "FAILED", "CANCELLED", "REFUND_REVIEW", "REFUNDED"]);
const PROVIDER_STATUSES = new Set(["READY", "PAY_PENDING", "VIRTUAL_ACCOUNT_ISSUED", "PAID", "FAILED", "CANCELLED", "PARTIAL_CANCELLED"]);
const CANONICAL_OUTCOMES = new Set(["processed", "duplicate", "review", "ignored", "pending", "already_settled", "provider_not_found"]);

export class PortOneApiRequeryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortOneApiRequeryError";
  }
}

function fail(message: string): never {
  throw new PortOneApiRequeryError(message);
}

async function boundedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared && (!/^[0-9]+$/.test(declared) || Number(declared) > RESPONSE_LIMIT)) {
    fail("PortOne requery API returned an invalid canonical response");
  }
  const reader = response.body?.getReader();
  if (!reader) fail("PortOne requery API returned an invalid canonical response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > RESPONSE_LIMIT) fail("PortOne requery API returned an invalid canonical response");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks, size).toString("utf8")) as unknown;
  } catch {
    fail("PortOne requery API returned an invalid canonical response");
  }
}

function observedState(providerStatus: string | null, localStatus: string, outcome: string): PaymentObservation["state"] {
  if (providerStatus === null && outcome === "provider_not_found") return "PENDING";
  if (providerStatus === "PAID") return "PAID";
  if (providerStatus === "FAILED") return "FAILED";
  if (providerStatus === "CANCELLED") return localStatus === "REFUNDED" ? "REFUNDED" : "CANCELLED";
  if (providerStatus === "PARTIAL_CANCELLED") return "REFUNDED";
  if (providerStatus === "READY" || providerStatus === "PAY_PENDING" || providerStatus === "VIRTUAL_ACCOUNT_ISSUED") return "PENDING";
  return "UNKNOWN";
}

/** The API, not this worker, reads PortOne and runs the canonical webhook handler. */
export class PortOneApiReconciliationProvider implements PaymentReconciliationProvider {
  readonly #config: PortOneApiRequeryConfig;
  readonly #fetch: typeof globalThis.fetch;
  readonly #now: () => Date;
  readonly #timeoutMs: number;

  constructor(config: PortOneApiRequeryConfig, dependencies: PortOneApiRequeryDependencies = {}) {
    this.#config = config;
    this.#fetch = dependencies.fetch ?? globalThis.fetch;
    this.#now = dependencies.now ?? (() => new Date());
    this.#timeoutMs = dependencies.timeoutMs ?? 15_000;
  }

  async observe(payment: PaymentRecord): Promise<PaymentObservation> {
    const now = this.#now();
    if (payment.provider !== "PORTONE_V2_INICIS") return { state: "UNKNOWN", observedAt: now.toISOString() };
    if (!UUID.test(payment.id) || !UUID.test(payment.orderId)) fail("PortOne requery payment identity is invalid");
    const path = `/v1/internal/payments/${payment.id}/reconcile`;
    const timestamp = String(Math.floor(now.getTime() / 1_000));
    const signature = createHmac("sha256", this.#config.secret)
      .update(`POST\n${path}\n${timestamp}`).digest("hex");
    const url = `${this.#config.apiBaseUrl.replace(/\/$/, "")}${path}`;
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "POST",
        headers: {
          "x-dabboba-worker-timestamp": timestamp,
          "x-dabboba-worker-signature": `sha256=${signature}`,
        },
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      fail("PortOne requery API request failed");
    }
    if (!response.ok) fail("PortOne requery API request failed");
    const body = await boundedJson(response) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)
      || body.accepted !== true || body.paymentId !== payment.id || body.orderId !== payment.orderId
      || typeof body.localStatus !== "string" || !LOCAL_STATUSES.has(body.localStatus)
      || !(body.providerStatus === null || (typeof body.providerStatus === "string" && PROVIDER_STATUSES.has(body.providerStatus)))
      || typeof body.outcome !== "string" || !CANONICAL_OUTCOMES.has(body.outcome)) {
      fail("PortOne requery API returned an invalid canonical response");
    }
    if (body.outcome === "provider_not_found" && body.providerStatus !== null) {
      fail("PortOne requery API returned an invalid canonical response");
    }
    const providerStatus = body.outcome === "provider_not_found"
      ? "PAYMENT_NOT_FOUND"
      : typeof body.providerStatus === "string" ? body.providerStatus : undefined;
    return {
      state: observedState(body.providerStatus, body.localStatus, body.outcome),
      observedAt: now.toISOString(),
      canonicalStatus: body.localStatus,
      ...(providerStatus ? { providerStatus } : {}),
    };
  }
}
