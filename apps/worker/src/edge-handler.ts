import { createHash, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  assertProductionRuntimeDatabaseRole,
  createDatabasePool,
  WORKER_DATABASE_ROLE,
} from "@dabboba/db";
import { runCommerceRetentionBatch, type CommerceRetentionResult } from "./commerce-retention.js";
import { loadWorkerConfig, type WorkerConfig } from "./config.js";
import { createLogger, errorFields, type Logger } from "./logger.js";
import { createSupabaseOnlyMediaStore } from "./media-supabase.js";
import {
  runWorkerOnceCore,
  type WorkerRunSummary,
} from "./runner-core.js";

export type EdgeWorkerEnvironment = Record<string, string | undefined>;

export type EdgeWorkerHandlerDependencies = {
  readInvokeSecret(): string | undefined;
  readEnvironment(): EdgeWorkerEnvironment;
  loadConfig?: (env: EdgeWorkerEnvironment) => WorkerConfig;
  runWorker?: (config: WorkerConfig, logger: Logger) => Promise<WorkerRunSummary>;
  runCommerceRetention?: (config: WorkerConfig, logger: Logger) => Promise<CommerceRetentionResult>;
  createLogger?: (level: WorkerConfig["logLevel"]) => Logger;
};

const EDGE_DATABASE_URL_KEY = "DABBOBA_WORKER_DATABASE_URL";
const MIN_INVOKE_SECRET_BYTES = 32;
const MAX_INVOKE_SECRET_BYTES = 512;

const PASSTHROUGH_WORKER_KEYS = [
  "DABBOBA_ENVIRONMENT_TIER",
  "DABBOBA_ENABLE_PRODUCTION_WORKER",
  "WORKER_QUEUE_NAME",
  "WORKER_OUTBOX_BATCH_SIZE",
  "WORKER_PAYMENT_STALE_MINUTES",
  "WORKER_PAYMENT_WINDOW_VALIDITY_MINUTES",
  "WORKER_MEDIA_PENDING_TTL_MINUTES",
  "WORKER_MEDIA_REJECTED_TTL_HOURS",
  "WORKER_JOB_ATTEMPTS",
  "WORKER_JOB_BACKOFF_MS",
  "WORKER_QUEUE_VISIBILITY_SECONDS",
  "WORKER_MAX_MESSAGES_PER_RUN",
  "WORKER_MAX_RUN_SECONDS",
  "WORKER_DATABASE_OPERATION_TIMEOUT_MS",
  // Storage-expiry reminders and holds stay DISABLED unless the owner turns
  // them on (decision due within 60 days of the first LIVE sale).
  "WORKER_INVENTORY_STORAGE_EXPIRY_MODE",
  // Commerce retention stays DISABLED until the operator approves the policy
  // (docs/commerce-retention-components.md); PREVIEW then EXECUTE are set only
  // for an approved run and removed afterwards. EXECUTE applies only to an
  // explicit one-shot request (see requestsCommerceRetentionExecute).
  "WORKER_COMMERCE_RETENTION_MODE",
  "WORKER_COMMERCE_RETENTION_BATCH_SIZE",
  "DATABASE_POOL_MAX",
  "NOTIFICATION_DELIVERY_URL",
  "NOTIFICATION_DELIVERY_TOKEN",
  "PAYMENT_RECONCILIATION_PROVIDER",
  "PORTONE_RECONCILIATION_API_BASE_URL",
  "PAYMENT_RECONCILIATION_WORKER_SECRET",
  "KG_INICIS_ENVIRONMENT",
  "KG_INICIS_MID",
  "KG_INICIS_INIAPI_KEY",
  "KG_INICIS_CLIENT_IP",
  "LOG_LEVEL",
] as const;

const EDGE_STORAGE_MAPPING = {
  DABBOBA_STORAGE_BUCKET: "SUPABASE_STORAGE_BUCKET",
  DABBOBA_STORAGE_SERVICE_KEY: "SUPABASE_STORAGE_SERVICE_KEY",
  DABBOBA_STORAGE_S3_ENDPOINT: "SUPABASE_STORAGE_S3_ENDPOINT",
  DABBOBA_STORAGE_S3_REGION: "SUPABASE_STORAGE_S3_REGION",
  DABBOBA_STORAGE_S3_ACCESS_KEY_ID: "SUPABASE_STORAGE_S3_ACCESS_KEY_ID",
  DABBOBA_STORAGE_S3_SECRET_ACCESS_KEY: "SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY",
} as const;

const EDGE_APPLE_MAPPING = {
  DABBOBA_WORKER_APPLE_CLIENT_ID: "APPLE_CLIENT_ID",
  DABBOBA_WORKER_APPLE_CLIENT_SECRET: "APPLE_CLIENT_SECRET",
  DABBOBA_WORKER_APPLE_TOKEN_ENCRYPTION_KEY: "APPLE_TOKEN_ENCRYPTION_KEY",
  DABBOBA_WORKER_APPLE_TOKEN_ENCRYPTION_KEY_VERSION: "APPLE_TOKEN_ENCRYPTION_KEY_VERSION",
} as const;

const EDGE_PUSH_MAPPING = {
  DABBOBA_WORKER_EXPO_PUSH_ACCESS_TOKEN: "EXPO_PUSH_ACCESS_TOKEN",
} as const;

const FORBIDDEN_EDGE_KEYS = [
  "WORKER_DATABASE_URL",
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
  "APPLE_CLIENT_ID",
  "APPLE_CLIENT_SECRET",
  "APPLE_TOKEN_ENCRYPTION_KEY",
  "APPLE_TOKEN_ENCRYPTION_KEY_VERSION",
  "EXPO_PUSH_ACCESS_TOKEN",
] as const;

function present(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json;charset=utf-8",
      ...headers,
    },
  });
}

function validInvokeSecret(secret: string | undefined): secret is string {
  if (!secret || !/^[\x21-\x7e]+$/.test(secret)) return false;
  const size = Buffer.byteLength(secret, "utf8");
  return size >= MIN_INVOKE_SECRET_BYTES
    && size <= MAX_INVOKE_SECRET_BYTES
    && !/(?:change-me|local-development|fixture)/i.test(secret);
}

function authorized(request: Request, secret: string): boolean {
  const match = /^Bearer ([\x21-\x7e]{32,512})$/.exec(request.headers.get("authorization") ?? "");
  if (!match) return false;
  const expected = createHash("sha256").update(secret, "utf8").digest();
  const actual = createHash("sha256").update(match[1]!, "utf8").digest();
  return timingSafeEqual(expected, actual);
}

// The Cron invokes this function every minute, and a configured EXECUTE would
// dispose another retention batch on each of those runs. EXECUTE therefore
// takes effect only for an authenticated request whose body asks for it
// ({"commerceRetention":"EXECUTE"}): that request runs the retention batch
// alone, so no other job's failure is reported for it, and every other
// invocation, including the Cron, sees PREVIEW.
async function requestsCommerceRetentionExecute(request: Request): Promise<boolean> {
  try {
    const text = await request.text();
    if (!text || text.length > 4_096) return false;
    const body: unknown = JSON.parse(text);
    return typeof body === "object" && body !== null
      && (body as Record<string, unknown>).commerceRetention === "EXECUTE";
  } catch {
    return false;
  }
}

export function normalizeSupabaseEdgeWorkerEnvironment(
  source: EdgeWorkerEnvironment,
  options: { commerceRetentionExecuteRequested?: boolean } = {},
): EdgeWorkerEnvironment {
  if (source.NODE_ENV && source.NODE_ENV !== "production") {
    throw new Error("Supabase Edge worker requires production runtime semantics");
  }
  const tier = source.DABBOBA_ENVIRONMENT_TIER?.trim();
  if (tier !== "STAGING" && tier !== "PRODUCTION") {
    throw new Error("Supabase Edge worker requires an explicit STAGING or PRODUCTION tier");
  }
  for (const key of FORBIDDEN_EDGE_KEYS) {
    if (present(source[key])) {
      throw new Error("Supabase Edge worker received a forbidden legacy or non-Supabase setting");
    }
  }
  if (source.MEDIA_STORAGE_PROVIDER?.trim() && source.MEDIA_STORAGE_PROVIDER.trim() !== "supabase") {
    throw new Error("Supabase Edge worker requires Supabase-only media storage");
  }

  const normalized: EdgeWorkerEnvironment = {
    NODE_ENV: "production",
    MEDIA_STORAGE_PROVIDER: "supabase",
    WORKER_DATABASE_URL: source[EDGE_DATABASE_URL_KEY],
    SUPABASE_URL: source.SUPABASE_URL,
  };
  for (const key of PASSTHROUGH_WORKER_KEYS) normalized[key] = source[key];
  if (normalized.WORKER_COMMERCE_RETENTION_MODE?.trim() === "EXECUTE"
    && options.commerceRetentionExecuteRequested !== true) {
    normalized.WORKER_COMMERCE_RETENTION_MODE = "PREVIEW";
  }
  for (const [edgeKey, workerKey] of Object.entries(EDGE_STORAGE_MAPPING)) {
    normalized[workerKey] = source[edgeKey];
  }
  for (const [edgeKey, workerKey] of Object.entries(EDGE_APPLE_MAPPING)) {
    normalized[workerKey] = source[edgeKey];
  }
  for (const [edgeKey, workerKey] of Object.entries(EDGE_PUSH_MAPPING)) {
    normalized[workerKey] = source[edgeKey];
  }
  // Supabase already provides this server-only value to Edge Functions. Avoid
  // duplicating it as another long-lived custom secret unless an operator has
  // intentionally supplied a separate Storage credential.
  if (!normalized.SUPABASE_STORAGE_SERVICE_KEY) {
    normalized.SUPABASE_STORAGE_SERVICE_KEY = source.SUPABASE_SERVICE_ROLE_KEY;
  }
  normalized.SUPABASE_AUTH_ADMIN_SECRET_KEY = source.SUPABASE_SERVICE_ROLE_KEY;
  return normalized;
}

export function assertSupabaseEdgeWorkerConfig(config: WorkerConfig): void {
  if (
    config.environment !== "production"
    || (config.environmentTier !== "STAGING" && config.environmentTier !== "PRODUCTION")
  ) {
    throw new Error("Supabase Edge worker environment is invalid");
  }
  assertProductionRuntimeDatabaseRole(config.databaseUrl, "production", WORKER_DATABASE_ROLE);
  if (config.gcsBucket || config.gcsProjectId || config.mediaStorageProvider !== "supabase" || !config.supabaseStorage) {
    throw new Error("Supabase Edge worker media configuration is invalid");
  }
  if (!config.supabaseAuthAdmin) {
    throw new Error("Supabase Edge worker Auth deletion configuration is invalid");
  }
}

function defaultRunWorker(config: WorkerConfig, logger: Logger): Promise<WorkerRunSummary> {
  return runWorkerOnceCore(config, { createMediaStore: createSupabaseOnlyMediaStore }, logger);
}

async function defaultRunCommerceRetention(config: WorkerConfig, logger: Logger): Promise<CommerceRetentionResult> {
  const pool = createDatabasePool(config.databaseUrl, "dabboba-worker-commerce-retention", {
    expectedRole: WORKER_DATABASE_ROLE,
    max: 1,
    onIdleClientError: (fault) => logger.error(fault, "Idle worker database client failed and was removed"),
    queryTimeoutMs: config.databaseOperationTimeoutMs,
    statementTimeoutMs: config.databaseOperationTimeoutMs,
  });
  try {
    return await runCommerceRetentionBatch(pool, config.commerceRetention, logger);
  } finally {
    // The batch has already committed or rolled back; closing the pool must
    // not turn a committed batch into an error the operator would retry.
    await pool.end().catch((error: unknown) => logger.error(errorFields(error), "Commerce retention pool close failed"));
  }
}

export function createSupabaseEdgeWorkerHandler(
  dependencies: EdgeWorkerHandlerDependencies,
): (request: Request) => Promise<Response> {
  const loadConfig = dependencies.loadConfig ?? loadWorkerConfig;
  const runWorker = dependencies.runWorker ?? defaultRunWorker;
  const runCommerceRetention = dependencies.runCommerceRetention ?? defaultRunCommerceRetention;
  const loggerFactory = dependencies.createLogger ?? createLogger;

  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return jsonResponse(405, { ok: false, code: "METHOD_NOT_ALLOWED" }, { allow: "POST" });
    }

    let invokeSecret: string | undefined;
    try {
      invokeSecret = dependencies.readInvokeSecret();
    } catch {
      return jsonResponse(503, { ok: false, code: "WORKER_AUTH_UNAVAILABLE" });
    }
    if (!validInvokeSecret(invokeSecret)) {
      return jsonResponse(503, { ok: false, code: "WORKER_AUTH_UNAVAILABLE" });
    }
    if (!authorized(request, invokeSecret)) {
      return jsonResponse(401, { ok: false, code: "UNAUTHORIZED" });
    }

    const commerceRetentionExecuteRequested = await requestsCommerceRetentionExecute(request);

    let source: EdgeWorkerEnvironment;
    try {
      source = dependencies.readEnvironment();
    } catch {
      return jsonResponse(503, { ok: false, code: "WORKER_CONFIG_UNAVAILABLE" });
    }

    let logger: Logger | null = null;
    try {
      const config = loadConfig(normalizeSupabaseEdgeWorkerEnvironment(source, { commerceRetentionExecuteRequested }));
      assertSupabaseEdgeWorkerConfig(config);
      logger = loggerFactory(config.logLevel);
      if (commerceRetentionExecuteRequested) {
        if (config.commerceRetention?.mode !== "EXECUTE") {
          return jsonResponse(409, { ok: false, code: "COMMERCE_RETENTION_EXECUTE_NOT_CONFIGURED" });
        }
        // A success reports the committed count. Any failure is indeterminate:
        // the database may have committed before the acknowledgement was lost,
        // so the operator checks commerce_retention_disposals before retrying.
        let retention: CommerceRetentionResult;
        try {
          retention = await runCommerceRetention(config, logger);
        } catch (error) {
          logger.error(errorFields(error), "Commerce retention execution outcome is unknown");
          return jsonResponse(500, { ok: false, code: "COMMERCE_RETENTION_OUTCOME_UNKNOWN" });
        }
        return jsonResponse(200, {
          ok: true,
          commerceRetention: { mode: retention.mode, disposed: retention.disposed },
        });
      }
      const summary = await runWorker(config, logger);
      return jsonResponse(200, {
        ok: true,
        status: summary.status,
        pgmqVersion: summary.pgmqVersion,
        outboxPublished: summary.outboxPublished,
        outboxDeferred: summary.outboxDeferred,
        queueCompleted: summary.queueCompleted,
        queueRetried: summary.queueRetried,
        queueDeadLettered: summary.queueDeadLettered,
        periodicCompleted: summary.periodicCompleted,
        periodicFailed: summary.periodicFailed,
      });
    } catch (error) {
      logger?.error(errorFields(error), "Supabase Edge worker execution failed");
      return jsonResponse(500, { ok: false, code: "WORKER_EXECUTION_FAILED" });
    }
  };
}
