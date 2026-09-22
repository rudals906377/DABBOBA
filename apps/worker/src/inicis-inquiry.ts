import { createHash } from "node:crypto";
import type {
  PaymentObservation,
  PaymentRecord,
  PaymentReconciliationProvider,
} from "./payments.js";

export type InicisInquiryEnvironment = "TEST" | "LIVE";

export type InicisInquiryConfig = {
  environment: InicisInquiryEnvironment;
  mid: string;
  iniApiKey: string;
  clientIp: string;
};

export type InicisInquiryFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type InicisInquiryDependencies = {
  fetch?: InicisInquiryFetch;
  now?: () => Date;
  timeoutMs?: number;
};

export const INICIS_INQUIRY_TIMEOUT_MS = 5_000;
export const INICIS_INQUIRY_MAX_RESPONSE_BYTES = 64 * 1_024;

const INICIS_INQUIRY_URLS: Record<InicisInquiryEnvironment, string> = {
  TEST: "https://stginiapi.inicis.com/api/v1/extra",
  LIVE: "https://iniapi.inicis.com/api/v1/extra",
};

type InicisInquiryErrorCode =
  | "INVALID_CONFIGURATION"
  | "INVALID_RESPONSE"
  | "PAYMENT_MISMATCH"
  | "REQUEST_FAILED";

/** Safe to persist or log: it never retains a URL, credential, TID, or response body. */
export class InicisInquiryError extends Error {
  readonly code: InicisInquiryErrorCode;

  constructor(code: InicisInquiryErrorCode) {
    const messages: Record<InicisInquiryErrorCode, string> = {
      INVALID_CONFIGURATION: "KG INICIS inquiry configuration is invalid.",
      INVALID_RESPONSE: "KG INICIS inquiry returned an invalid response.",
      PAYMENT_MISMATCH: "KG INICIS inquiry did not match the canonical payment.",
      REQUEST_FAILED: "KG INICIS inquiry request failed.",
    };
    super(messages[code]);
    this.name = "InicisInquiryError";
    this.code = code;
  }
}

function requireValue(condition: unknown, code: InicisInquiryErrorCode): asserts condition {
  if (!condition) throw new InicisInquiryError(code);
}

export function assertInicisInquiryConfig(config: InicisInquiryConfig): void {
  requireValue(config.environment === "TEST" || config.environment === "LIVE", "INVALID_CONFIGURATION");
  requireValue(/^[A-Za-z0-9]{10}$/.test(config.mid), "INVALID_CONFIGURATION");
  requireValue(
    typeof config.iniApiKey === "string"
      && Buffer.byteLength(config.iniApiKey, "utf8") >= 1
      && Buffer.byteLength(config.iniApiKey, "utf8") <= 512
      && /^[\x21-\x7e]+$/.test(config.iniApiKey),
    "INVALID_CONFIGURATION",
  );
  requireValue(isCanonicalIpv4(config.clientIp), "INVALID_CONFIGURATION");
}

function isCanonicalIpv4(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) => {
    if (!/^(?:0|[1-9][0-9]{0,2})$/.test(part)) return false;
    const octet = Number(part);
    return octet >= 0 && octet <= 255;
  });
}

function timestampInKorea(now: Date): string {
  requireValue(Number.isFinite(now.getTime()), "INVALID_CONFIGURATION");
  const korea = new Date(now.getTime() + 9 * 60 * 60 * 1_000);
  const part = (value: number, width = 2) => String(value).padStart(width, "0");
  return [
    part(korea.getUTCFullYear(), 4),
    part(korea.getUTCMonth() + 1),
    part(korea.getUTCDate()),
    part(korea.getUTCHours()),
    part(korea.getUTCMinutes()),
    part(korea.getUTCSeconds()),
  ].join("");
}

function validTid(value: string): boolean {
  return value.length > 0
    && Buffer.byteLength(value, "utf8") <= 40
    && /^[\x21-\x7e]+$/.test(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function responseAmount(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,11})$/.test(value)) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) ? amount : null;
}

async function boundedBody(response: Response, limit: number): Promise<string> {
  const contentLength = response.headers.get("content-length");
  requireValue(
    contentLength === null || (/^[0-9]+$/.test(contentLength) && Number(contentLength) <= limit),
    "INVALID_RESPONSE",
  );
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      requireValue(size <= limit, "INVALID_RESPONSE");
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size).toString("utf8");
}

function observation(state: PaymentObservation["state"], observedAt: string): PaymentObservation {
  return { state, observedAt };
}

export class InicisInquiryPaymentProvider implements PaymentReconciliationProvider {
  readonly #config: InicisInquiryConfig;
  readonly #fetch: InicisInquiryFetch;
  readonly #now: () => Date;
  readonly #timeoutMs: number;

  constructor(config: InicisInquiryConfig, dependencies: InicisInquiryDependencies = {}) {
    assertInicisInquiryConfig(config);
    const timeoutMs = dependencies.timeoutMs ?? INICIS_INQUIRY_TIMEOUT_MS;
    requireValue(Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 30_000, "INVALID_CONFIGURATION");
    this.#config = { ...config };
    this.#fetch = dependencies.fetch ?? globalThis.fetch;
    this.#now = dependencies.now ?? (() => new Date());
    this.#timeoutMs = timeoutMs;
  }

  async observe(payment: PaymentRecord): Promise<PaymentObservation> {
    const now = this.#now();
    requireValue(now instanceof Date && Number.isFinite(now.getTime()), "INVALID_CONFIGURATION");
    const observedAt = now.toISOString();
    if (
      payment.provider !== "KG_INICIS"
      || payment.currency !== "KRW"
      || !Number.isSafeInteger(payment.amount)
      || payment.amount < 0
    ) {
      return observation("UNKNOWN", observedAt);
    }

    const originalTid = payment.providerPaymentId;
    if (!originalTid) return observation("UNKNOWN", observedAt);
    if (!validTid(originalTid)) throw new InicisInquiryError("PAYMENT_MISMATCH");

    const timestamp = timestampInKorea(now);
    const type = "Extra";
    const paymethod = "Inquiry";
    const hashData = createHash("sha512")
      .update(`${this.#config.iniApiKey}${type}${paymethod}${timestamp}${this.#config.clientIp}${this.#config.mid}`, "utf8")
      .digest("hex");
    const body = new URLSearchParams({
      type,
      paymethod,
      timestamp,
      clientIp: this.#config.clientIp,
      mid: this.#config.mid,
      originalTid,
      hashData,
    });

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new InicisInquiryError("REQUEST_FAILED"));
      }, this.#timeoutMs);
    });

    try {
      return await Promise.race([this.#request(body, payment, observedAt, controller.signal), timeout]);
    } catch (error) {
      if (error instanceof InicisInquiryError) throw error;
      throw new InicisInquiryError("REQUEST_FAILED");
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
    }
  }

  async #request(
    body: URLSearchParams,
    payment: PaymentRecord,
    observedAt: string,
    signal: AbortSignal,
  ): Promise<PaymentObservation> {
    const response = await this.#fetch(INICIS_INQUIRY_URLS[this.#config.environment], {
      method: "POST",
      headers: {
        accept: "application/json",
        "accept-encoding": "identity",
        "cache-control": "no-store",
        "content-type": "application/x-www-form-urlencoded;charset=utf-8",
      },
      body: body.toString(),
      cache: "no-store",
      redirect: "error",
      signal,
    });
    if (!response.ok) throw new InicisInquiryError("REQUEST_FAILED");
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    requireValue(contentType.startsWith("application/json"), "INVALID_RESPONSE");

    let payload: unknown;
    try {
      payload = JSON.parse(await boundedBody(response, INICIS_INQUIRY_MAX_RESPONSE_BYTES));
    } catch (error) {
      if (signal.aborted) throw new InicisInquiryError("REQUEST_FAILED");
      if (error instanceof InicisInquiryError) throw error;
      throw new InicisInquiryError("INVALID_RESPONSE");
    }
    requireValue(record(payload) && typeof payload.resultCode === "string", "INVALID_RESPONSE");
    if (payload.resultCode !== "00") return observation("UNKNOWN", observedAt);
    const status = typeof payload.status === "number" ? String(payload.status) : payload.status;
    if (status === "9" || !["0", "1", "N", "Y", "C"].includes(String(status))) {
      return observation("UNKNOWN", observedAt);
    }
    requireValue(typeof payload.tid === "string" && validTid(payload.tid), "INVALID_RESPONSE");
    const amount = responseAmount(payload.price);
    requireValue(amount !== null, "INVALID_RESPONSE");
    if (payload.tid !== payment.providerPaymentId || amount !== payment.amount) {
      throw new InicisInquiryError("PAYMENT_MISMATCH");
    }

    if (status === "0" || status === "Y") return observation("PAID", observedAt);
    if (status === "N") return observation("PENDING", observedAt);
    if (status === "1" || status === "C") return observation("CANCELLED", observedAt);
    return observation("UNKNOWN", observedAt);
  }
}
