import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "@dabboba/contracts";

export type TokenProvider = () => string | null | Promise<string | null>;

export type UnauthorizedResponse = {
  request: Request;
  response: Response;
};

export type UnauthorizedHandler = (
  context: UnauthorizedResponse,
) => void | Promise<void>;

export type DabbobaClientOptions = {
  baseUrl: string;
  token?: TokenProvider;
  fetch?: typeof globalThis.fetch;
  requestId?: () => string;
  onUnauthorized?: UnauthorizedHandler;
  /**
   * Default per-request timeout in milliseconds, applied only when the caller
   * did not pass its own `signal`. Defaults to DEFAULT_REQUEST_TIMEOUT_MS; pass
   * 0 to disable the default timeout for this client.
   */
  timeoutMs?: number;
};

export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Returns an AbortSignal that aborts after `timeoutMs`. Uses the platform
 * AbortSignal.timeout when present and otherwise an AbortController timer, so
 * React Native runtimes without AbortSignal.timeout still get a deadline.
 */
export function requestTimeoutSignal(timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(timeoutError(timeoutMs));
  }, timeoutMs);
  (timer as { unref?: () => void }).unref?.();
  return controller.signal;
}

function timeoutError(timeoutMs: number): Error {
  const message = `The request timed out after ${timeoutMs}ms.`;
  if (typeof DOMException === "function") return new DOMException(message, "TimeoutError");
  const error = new Error(message);
  error.name = "TimeoutError";
  return error;
}

const IDEMPOTENCY_KEY_MIN_LENGTH = 16;
const IDEMPOTENCY_KEY_MAX_LENGTH = 200;

/**
 * Builds an Idempotency-Key accepted by the API ([A-Za-z0-9._:-], 16-200 chars)
 * from stable parts. Unsupported characters become `_`, parts are joined with
 * `:`, short keys are padded and long keys are truncated. The same parts always
 * produce the same key, so a retry after a lost response replays one request.
 */
export function idempotencyKeyFrom(...parts: Array<string | number>): string {
  const joined = parts
    .map((part) => String(part).replace(/[^A-Za-z0-9._:-]/g, "_"))
    .join(":");
  return joined.padEnd(IDEMPOTENCY_KEY_MIN_LENGTH, "_").slice(0, IDEMPOTENCY_KEY_MAX_LENGTH);
}

/** Per-call header helper: `client.POST(path, { params: { header: idempotencyHeaders(key) } })`. */
export function idempotencyHeaders(key: string = createRequestId()): { "Idempotency-Key": string } {
  return { "Idempotency-Key": idempotencyKeyFrom(key) };
}

let fallbackRequestSequence = 0;

function createRequestId(): string {
  const runtimeCrypto = globalThis.crypto;
  if (typeof runtimeCrypto?.randomUUID === "function") return runtimeCrypto.randomUUID();
  fallbackRequestSequence = (fallbackRequestSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `client-${Date.now().toString(36)}-${fallbackRequestSequence.toString(36)}`;
}

export function createDabbobaClient(options: DabbobaClientOptions) {
  const client = createClient<paths>({
    baseUrl: options.baseUrl.replace(/\/$/, ""),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  const middleware: Middleware = {
    async onRequest({ request }) {
      const token = await options.token?.();
      if (token) request.headers.set("authorization", `Bearer ${token}`);
      request.headers.set("x-request-id", options.requestId?.() || createRequestId());
      return request;
    },
    async onResponse({ request, response }) {
      if (response.status === 401) {
        await options.onUnauthorized?.({ request, response });
      }
    },
  };

  client.use(middleware);
  return withDefaultTimeout(client, options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
}

const HTTP_METHODS = ["GET", "PUT", "POST", "DELETE", "OPTIONS", "HEAD", "PATCH", "TRACE"] as const;

type SignalInit = { signal?: AbortSignal | null } | undefined;

function withDefaultSignal<T extends SignalInit>(init: T, timeoutMs: number): T {
  if (init?.signal) return init;
  return { ...init, signal: requestTimeoutSignal(timeoutMs) } as T;
}

function withDefaultTimeout<C extends object>(client: C, timeoutMs: number): C {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return client;
  const methods = client as unknown as Record<string, (url: unknown, init?: SignalInit) => unknown>;
  for (const method of HTTP_METHODS) {
    const original = methods[method]!;
    methods[method] = (url, init) => original(url, withDefaultSignal(init, timeoutMs));
  }
  const generic = client as unknown as {
    request: (method: unknown, url: unknown, init?: SignalInit) => unknown;
  };
  const request = generic.request;
  generic.request = (method, url, init) => request(method, url, withDefaultSignal(init, timeoutMs));
  return client;
}

export function errorMessage(error: unknown, fallback = "요청을 처리하지 못했습니다."): string {
  if (!error || typeof error !== "object") return fallback;
  const envelope = error as { error?: { message?: unknown } };
  return typeof envelope.error?.message === "string" ? envelope.error.message : fallback;
}
