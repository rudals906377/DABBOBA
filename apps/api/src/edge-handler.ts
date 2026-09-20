import type { ApiConfig } from "@dabboba/config";
import { loadApiConfig } from "@dabboba/config";
import {
  assertProductionRuntimeDatabaseRole,
  createDatabasePool,
  RUNTIME_DATABASE_ROLE,
} from "@dabboba/db";
import { buildAppCore } from "./app-core.js";
import { AppError } from "./lib/errors.js";
import { edgeMediaRuntime } from "./lib/media-runtime-edge.js";
import type { ApiMediaRuntime } from "./lib/media-runtime.js";
import { createEdgeApiLogger } from "./lib/edge-logger.js";

export type EdgeApiEnvironment = Record<string, string | undefined>;

type InjectResult = {
  statusCode: number;
  headers: Record<string, string | string[] | number | undefined>;
  rawPayload: Buffer;
};

type InjectableApi = {
  inject(options: {
    method: string;
    url: string;
    headers: Record<string, string>;
    payload?: Buffer;
    remoteAddress?: string;
  }): Promise<InjectResult>;
};

export type EdgeApiHandlerDependencies = {
  readEnvironment(): EdgeApiEnvironment;
  buildApp?: (config: ApiConfig, sanitizeImage?: ApiMediaRuntime["sanitizeImage"]) => Promise<InjectableApi>;
  sanitizeImage?: ApiMediaRuntime["sanitizeImage"];
  /** Unit-test only. Production callers always use EDGE_REQUEST_BODY_TIMEOUT_MS. */
  testOnlyBodyTimeoutMs?: number;
};

export type EdgeServeInfo = {
  remoteAddr?: { hostname?: string };
};

const MAX_BODY_BYTES = 1_048_576;
export const EDGE_REQUEST_BODY_TIMEOUT_MS = 10_000;
const MAX_TEST_BODY_TIMEOUT_MS = 1_000;
const FUNCTION_PATHS = ["/dabboba-api", "/functions/v1/dabboba-api"] as const;
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const SPOOFABLE_FORWARDING_HEADERS = new Set([
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "x-real-ip",
  "cf-connecting-ip",
]);

const API_ENVIRONMENT_MAPPING = {
  DABBOBA_API_DATABASE_URL: "DATABASE_URL",
  DABBOBA_API_SESSION_TOKEN_PEPPER: "SESSION_TOKEN_PEPPER",
  DABBOBA_API_WEB_ORIGINS: "WEB_ORIGINS",
  DABBOBA_API_SESSION_TTL_DAYS: "SESSION_TTL_DAYS",
  DABBOBA_API_DATABASE_POOL_MAX: "DATABASE_POOL_MAX",
  DABBOBA_API_PAYMENT_PROVIDER: "PAYMENT_PROVIDER",
  DABBOBA_API_COMMERCE_MODE: "DABBOBA_COMMERCE_MODE",
  DABBOBA_API_PAYMENT_WEBHOOK_SECRET: "PAYMENT_WEBHOOK_SECRET",
  DABBOBA_API_SUPABASE_JWT_AUDIENCE: "SUPABASE_JWT_AUDIENCE",
  DABBOBA_API_SUPABASE_PUBLISHABLE_KEY: "SUPABASE_PUBLISHABLE_KEY",
  DABBOBA_API_CUSTOMER_AUTH_ENABLED_PROVIDERS: "CUSTOMER_AUTH_ENABLED_PROVIDERS",
  DABBOBA_API_APPLE_TOKEN_ENCRYPTION_KEY: "APPLE_TOKEN_ENCRYPTION_KEY",
  DABBOBA_API_APPLE_TOKEN_ENCRYPTION_KEY_VERSION: "APPLE_TOKEN_ENCRYPTION_KEY_VERSION",
  DABBOBA_API_LOG_LEVEL: "LOG_LEVEL",
  DABBOBA_API_CATALOG_MEDIA_BASE_URL: "DABBOBA_CATALOG_MEDIA_BASE_URL",
  DABBOBA_STORAGE_BUCKET: "SUPABASE_STORAGE_BUCKET",
  DABBOBA_STORAGE_SERVICE_KEY: "SUPABASE_STORAGE_SERVICE_KEY",
  DABBOBA_STORAGE_S3_ENDPOINT: "SUPABASE_STORAGE_S3_ENDPOINT",
  DABBOBA_STORAGE_S3_REGION: "SUPABASE_STORAGE_S3_REGION",
  DABBOBA_STORAGE_S3_ACCESS_KEY_ID: "SUPABASE_STORAGE_S3_ACCESS_KEY_ID",
  DABBOBA_STORAGE_S3_SECRET_ACCESS_KEY: "SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY",
} as const;

const FORBIDDEN_EDGE_KEYS = [
  "DATABASE_URL",
  "SESSION_TOKEN_PEPPER",
  "REDIS_URL",
  "GCS_BUCKET",
  "GCS_PROJECT_ID",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "SUPABASE_STORAGE_BUCKET",
  "SUPABASE_STORAGE_SERVICE_KEY",
  "SUPABASE_STORAGE_S3_ENDPOINT",
  "SUPABASE_STORAGE_S3_REGION",
  "SUPABASE_STORAGE_S3_ACCESS_KEY_ID",
  "SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY",
  "SUPABASE_STORAGE_ALLOW_LOCAL_HTTP",
  "SUPABASE_PUBLISHABLE_KEY",
  "CUSTOMER_AUTH_ENABLED_PROVIDERS",
  "APPLE_TOKEN_ENCRYPTION_KEY",
  "APPLE_TOKEN_ENCRYPTION_KEY_VERSION",
  "DABBOBA_COMMERCE_MODE",
  "ADMIN_PROXY_IDENTITY_SECRET",
  "ADMIN_EDGE_CLIENT_IP_HEADER",
] as const;

function present(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function fixedJson(status: number, code: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: { code, message: "요청을 처리할 수 없습니다." } }), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json;charset=utf-8",
      ...headers,
    },
  });
}

function edgeFailureCode(error: unknown): string {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  if (typeof candidate?.code === "string" && /^[A-Z0-9_]{2,32}$/.test(candidate.code)) {
    return `DATABASE_${candidate.code}`;
  }
  const message = typeof candidate?.message === "string" ? candidate.message : "";
  const missing = /Missing required environment variable: ([A-Z0-9_]+)/.exec(message);
  if (missing) return `CONFIG_MISSING_${missing[1]}`;
  if (/certificate|self[- ]signed|TLS|SSL/i.test(message)) return "DATABASE_TLS";
  if (/password authentication|authentication failed/i.test(message)) return "DATABASE_AUTH";
  if (/connection terminated|connection refused|ECONN|ENOTFOUND/i.test(message)) return "DATABASE_CONNECTION";
  if (/timeout|timed out/i.test(message)) return "DATABASE_TIMEOUT";
  if (/permission denied|insufficient privilege/i.test(message)) return "DATABASE_PERMISSION";
  if (/Cannot find|module not found|failed to import/i.test(message)) return "RUNTIME_IMPORT";
  if (/Dynamic require|not supported|unsupported/i.test(message)) return "RUNTIME_UNSUPPORTED";
  for (const [pattern, code] of [
    [/\brequire is not defined/i, "RUNTIME_REQUIRE_REFERENCE"],
    [/\bprocess is not defined/i, "RUNTIME_PROCESS_REFERENCE"],
    [/\bBuffer is not defined/i, "RUNTIME_BUFFER_REFERENCE"],
    [/\bsetImmediate is not defined/i, "RUNTIME_SET_IMMEDIATE_REFERENCE"],
    [/\bclearImmediate is not defined/i, "RUNTIME_CLEAR_IMMEDIATE_REFERENCE"],
    [/\b__filename is not defined/i, "RUNTIME_FILENAME_REFERENCE"],
    [/\b__dirname is not defined/i, "RUNTIME_DIRNAME_REFERENCE"],
  ] as const) {
    if (pattern.test(message)) return code;
  }
  const missingReference = /\b([A-Za-z_$][A-Za-z0-9_$]{0,39}) is not defined\b/.exec(message);
  if (missingReference) return `RUNTIME_REFERENCE_${missingReference[1]!.toUpperCase()}`;
  if (/is not defined|ReferenceError/i.test(message)) return "RUNTIME_REFERENCE";
  if (/is not a function|TypeError/i.test(message)) return "RUNTIME_API";
  if (/Supabase Edge API|Invalid |must |cannot |requires /i.test(message)) return "CONFIG_INVALID";
  return "UNKNOWN";
}

function apiPath(url: URL): string | null {
  if (/%2f/i.test(url.pathname)) return null;
  for (const prefix of FUNCTION_PATHS) {
    if (url.pathname === prefix) return `/${url.search}`;
    if (url.pathname.startsWith(`${prefix}/`)) return `${url.pathname.slice(prefix.length)}${url.search}`;
  }
  return null;
}

function requestHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  const nominated = new Set((headers.get("connection") ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean));
  for (const [rawName, value] of headers) {
    const name = rawName.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(name) || nominated.has(name) || SPOOFABLE_FORWARDING_HEADERS.has(name) || name === "host") continue;
    result[name] = value;
  }
  return result;
}

type BodyRead = { kind: "ok"; body?: Buffer } | { kind: "error"; response: Response };

async function boundedBody(request: Request, timeoutMs: number): Promise<BodyRead> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    await request.body?.cancel().catch(() => undefined);
    return { kind: "error", response: fixedJson(413, "PAYLOAD_TOO_LARGE") };
  }
  if (!request.body) return { kind: "ok" };
  if (request.signal.aborted) {
    await request.body.cancel().catch(() => undefined);
    return { kind: "error", response: fixedJson(499, "REQUEST_CANCELLED") };
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let aborted: boolean = request.signal.aborted;
  let deadlineReached = false;
  const timedOut = Symbol("body-timeout");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof timedOut>((resolve) => {
    timeout = setTimeout(() => {
      deadlineReached = true;
      void reader.cancel().catch(() => undefined);
      resolve(timedOut);
    }, timeoutMs);
  });
  const onAbort = () => {
    aborted = true;
    void reader.cancel().catch(() => undefined);
  };
  request.signal.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      const result = await Promise.race([reader.read(), deadline]);
      if (result === timedOut || deadlineReached) {
        return { kind: "error", response: fixedJson(408, "REQUEST_TIMEOUT") };
      }
      if (aborted) return { kind: "error", response: fixedJson(499, "REQUEST_CANCELLED") };
      if (result.done) break;
      size += result.value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { kind: "error", response: fixedJson(413, "PAYLOAD_TOO_LARGE") };
      }
      chunks.push(result.value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return { kind: "error", response: fixedJson(aborted ? 499 : 400, aborted ? "REQUEST_CANCELLED" : "INVALID_REQUEST_BODY") };
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    request.signal.removeEventListener("abort", onAbort);
    try { reader.releaseLock(); } catch { /* A timed-out read may still be settling after cancellation. */ }
  }
  return { kind: "ok", body: Buffer.concat(chunks, size) };
}

function webResponse(result: InjectResult, requestMethod: string): Response {
  const headers = new Headers();
  for (const [rawName, value] of Object.entries(result.headers)) {
    const name = rawName.toLowerCase();
    if (value === undefined || HOP_BY_HOP_HEADERS.has(name)) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, String(value));
    }
  }
  const bodyless = requestMethod === "HEAD" || result.statusCode === 204 || result.statusCode === 205 || result.statusCode === 304;
  return new Response(bodyless ? null : result.rawPayload, { status: result.statusCode, headers });
}

export function normalizeSupabaseEdgeApiEnvironment(source: EdgeApiEnvironment): EdgeApiEnvironment {
  if (source.NODE_ENV && source.NODE_ENV !== "production") {
    throw new Error("Supabase Edge API requires production runtime semantics");
  }
  const tier = source.DABBOBA_ENVIRONMENT_TIER?.trim();
  if (tier !== "STAGING" && tier !== "PRODUCTION") {
    throw new Error("Supabase Edge API requires an explicit STAGING or PRODUCTION tier");
  }
  for (const key of FORBIDDEN_EDGE_KEYS) {
    if (present(source[key])) throw new Error("Supabase Edge API received a forbidden legacy setting");
  }
  if (source.API_SURFACE?.trim() && source.API_SURFACE.trim() !== "customer") {
    throw new Error("Supabase Edge API serves the customer surface only");
  }
  if (source.MEDIA_STORAGE_PROVIDER?.trim() && source.MEDIA_STORAGE_PROVIDER.trim() !== "supabase") {
    throw new Error("Supabase Edge API requires Supabase-only media storage");
  }

  const normalized: EdgeApiEnvironment = {
    NODE_ENV: "production",
    DABBOBA_ENVIRONMENT_TIER: tier,
    API_SURFACE: "customer",
    MEDIA_STORAGE_PROVIDER: "supabase",
    SUPABASE_URL: source.SUPABASE_URL,
  };
  for (const [edgeKey, apiKey] of Object.entries(API_ENVIRONMENT_MAPPING)) {
    normalized[apiKey] = source[edgeKey];
  }
  // Supabase injects this server-only key into every Edge Function. Reuse the
  // managed value instead of asking operators to copy the same secret into a
  // second custom variable. A custom DABBOBA value remains available for an
  // explicitly separated Storage credential.
  if (!normalized.SUPABASE_STORAGE_SERVICE_KEY) {
    normalized.SUPABASE_STORAGE_SERVICE_KEY = source.SUPABASE_SERVICE_ROLE_KEY;
  }
  if (!normalized.SUPABASE_PUBLISHABLE_KEY) {
    normalized.SUPABASE_PUBLISHABLE_KEY = source.SUPABASE_ANON_KEY;
  }
  return normalized;
}

export function assertSupabaseEdgeApiConfig(config: ApiConfig): void {
  if (
    config.environment !== "production"
    || (config.environmentTier !== "STAGING" && config.environmentTier !== "PRODUCTION")
    || config.surface !== "customer"
    || config.redisUrl !== null
  ) {
    throw new Error("Supabase Edge API environment is invalid");
  }
  assertProductionRuntimeDatabaseRole(config.databaseUrl, "production", RUNTIME_DATABASE_ROLE);
  let database: URL;
  try {
    database = new URL(config.databaseUrl);
  } catch {
    throw new Error("Supabase Edge API database target is invalid");
  }
  const hostname = database.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname.endsWith(".pooler.supabase.com") || database.port !== "6543" || database.search || database.hash) {
    throw new Error("Supabase Edge API requires the transaction pooler on port 6543");
  }
  if (config.gcsBucket || config.gcsProjectId || config.mediaStorageProvider !== "supabase" || !config.supabaseStorage) {
    throw new Error("Supabase Edge API media configuration is invalid");
  }
}

async function defaultBuildApp(
  config: ApiConfig,
  sanitizeImage?: ApiMediaRuntime["sanitizeImage"],
): Promise<InjectableApi> {
  const pool = createDatabasePool(config.databaseUrl, "dabboba-api-edge", {
    expectedRole: RUNTIME_DATABASE_ROLE,
    runtimeEnvironment: "production",
    max: config.databasePoolMax ?? 5,
    queryTimeoutMs: 12_000,
    statementTimeoutMs: 10_000,
  });
  const readinessPool = createDatabasePool(config.databaseUrl, "dabboba-api-edge-readiness", {
    expectedRole: RUNTIME_DATABASE_ROLE,
    runtimeEnvironment: "production",
    connectionTimeoutMs: 1_000,
    max: 1,
    queryTimeoutMs: 1_000,
    statementTimeoutMs: 1_000,
  });
  try {
    const mediaRuntime: ApiMediaRuntime = sanitizeImage
      ? {
          ...edgeMediaRuntime,
          completionAvailable: true,
          async sanitizeImage(input, detectedMimeType) {
            try {
              return await sanitizeImage(input, detectedMimeType);
            } catch {
              throw new AppError(400, "MEDIA_IMAGE_INVALID", "이미지를 안전하게 처리할 수 없습니다.");
            }
          },
        }
      : edgeMediaRuntime;
    const built = await buildAppCore({
      config,
      mediaRuntime,
      pool,
      readinessPool,
      redis: null,
      loggerInstance: createEdgeApiLogger(config.logLevel),
      edgeSafeLogging: true,
    });
    built.app.addHook("onClose", async () => {
      await readinessPool.end();
      await pool.end();
    });
    return built.app;
  } catch (error) {
    await readinessPool.end();
    await pool.end();
    throw error;
  }
}

export function createSupabaseEdgeApiHandler(
  dependencies: EdgeApiHandlerDependencies,
): (request: Request, info?: EdgeServeInfo) => Promise<Response> {
  const bodyTimeoutMs = dependencies.testOnlyBodyTimeoutMs ?? EDGE_REQUEST_BODY_TIMEOUT_MS;
  if (dependencies.testOnlyBodyTimeoutMs !== undefined) {
    if (
      process.env.NODE_ENV !== "test"
      || !Number.isInteger(bodyTimeoutMs)
      || bodyTimeoutMs < 1
      || bodyTimeoutMs > MAX_TEST_BODY_TIMEOUT_MS
    ) {
      throw new Error("Edge API body timeout override is restricted to bounded unit tests");
    }
  }
  const build = dependencies.buildApp ?? defaultBuildApp;
  let appPromise: Promise<InjectableApi> | null = null;

  const app = () => {
    if (!appPromise) {
      appPromise = Promise.resolve().then(() => {
        const config = loadApiConfig(normalizeSupabaseEdgeApiEnvironment(dependencies.readEnvironment()));
        assertSupabaseEdgeApiConfig(config);
        return build(config, dependencies.sanitizeImage);
      });
    }
    return appPromise;
  };

  return async (request, info) => {
    const url = new URL(request.url);
    const path = apiPath(url);
    if (!path) {
      await request.body?.cancel().catch(() => undefined);
      return fixedJson(404, "NOT_FOUND");
    }

    const body = await boundedBody(request, bodyTimeoutMs);
    if (body.kind === "error") return body.response;

    try {
      const response = await (await app()).inject({
        method: request.method,
        url: path,
        headers: requestHeaders(request.headers),
        ...(body.body ? { payload: body.body } : {}),
        ...(info?.remoteAddr?.hostname ? { remoteAddress: info.remoteAddr.hostname } : {}),
      });
      return webResponse(response, request.method);
    } catch (error) {
      console.error(JSON.stringify({
        level: "error",
        service: "dabboba-api-edge",
        event: "bootstrap_or_request_failed",
        code: edgeFailureCode(error),
      }));
      return fixedJson(503, "API_UNAVAILABLE");
    }
  };
}
