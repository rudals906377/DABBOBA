type Environment = Record<string, string | undefined>;
import {
  assertDatabaseUrlForTier,
  assertLocalTestProviderBoundary,
  loadBackendEnvironmentTier,
  loadMediaStorageConfig,
  type BackendEnvironmentTier,
  type MediaStorageConfiguration,
} from "@dabboba/config";
import {
  assertInicisInquiryConfig,
  type InicisInquiryConfig,
} from "./inicis-inquiry.js";
import type { PortOneApiRequeryConfig } from "./portone-api-requery.js";

export type RuntimeEnvironment = "development" | "test" | "production";

// Cloud Run deploys the one-shot task with a 600-second timeout. Keep queue
// visibility beyond the platform deadline so a killed task cannot be claimed
// concurrently by the next execution while it is still shutting down.
export const CLOUD_RUN_TASK_TIMEOUT_SECONDS = 600;
export const QUEUE_VISIBILITY_SAFETY_MARGIN_SECONDS = 300;
export const MIN_QUEUE_VISIBILITY_SECONDS =
  CLOUD_RUN_TASK_TIMEOUT_SECONDS + QUEUE_VISIBILITY_SAFETY_MARGIN_SECONDS;
// The production scheduler starts a run each minute. Stop starting work after
// 45 seconds so normal runs release the session advisory lock before the next
// tick; the lock still rejects a delayed overlap safely. The larger platform
// timeout remains a fail-safe for one already-started bounded operation.
export const MAX_WORKER_RUN_SECONDS = 45;

export type WorkerConfig = {
  environment: RuntimeEnvironment;
  environmentTier?: BackendEnvironmentTier;
  databaseUrl: string;
  queueName: string;
  outboxBatchSize: number;
  paymentStaleMinutes: number;
  /**
   * How long a claimed PortOne window may stay READY/PAY_PENDING before the
   * worker closes its reconciliation as PENDING_EXPIRED. Optional only for
   * backwards-compatible programmatic fixtures; loaded configs always set it.
   */
  paymentWindowValidityMinutes?: number;
  mediaPendingTtlMinutes: number;
  mediaRejectedTtlHours: number;
  jobAttempts: number;
  jobBackoffMs: number;
  queueVisibilitySeconds: number;
  maxMessagesPerRun: number;
  maxRunSeconds: number;
  databasePoolMax: number;
  databaseOperationTimeoutMs: number;
  gcsBucket: string | null;
  gcsProjectId: string | null;
  mediaStorageProvider?: MediaStorageConfiguration["mediaStorageProvider"];
  supabaseStorage?: MediaStorageConfiguration["supabaseStorage"];
  supabaseAuthAdmin: { url: string; secretKey: string } | null;
  /** Optional only for backwards-compatible programmatic fixtures; loaded configs always set it. */
  appleRevocation?: {
    clientId: string;
    clientSecret: string;
    encryptionKey: string;
    keyVersion: number;
  } | null;
  notificationDeliveryUrl: string | null;
  notificationDeliveryToken: string | null;
  /** Optional only for backwards-compatible programmatic fixtures; loaded configs always set it. */
  expoPushAccessToken?: string | null;
  /** Optional only for backwards-compatible programmatic fixtures; loaded configs always set it. */
  paymentReconciliation?:
    | { provider: "MANUAL_REVIEW" }
    | ({ provider: "KG_INICIS" } & InicisInquiryConfig)
    | ({ provider: "PORTONE_API" } & PortOneApiRequeryConfig);
  logLevel: "debug" | "info" | "warn" | "error";
};

function required(env: Environment, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function optional(env: Environment, key: string): string | null {
  return env[key]?.trim() || null;
}

function integer(env: Environment, key: string, fallback: number, minimum: number, maximum: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${key} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function runtimeEnvironment(env: Environment): RuntimeEnvironment {
  const value = env.NODE_ENV?.trim() || "development";
  if (value !== "development" && value !== "test" && value !== "production") {
    throw new Error("NODE_ENV must be development, test, or production");
  }
  return value;
}

function validateUrl(value: string, key: string, protocols: readonly string[]): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid URL`);
  }
  if (!protocols.includes(parsed.protocol)) throw new Error(`${key} must use ${protocols.join(" or ")}`);
  return parsed.toString().replace(/\/$/, "");
}

function logLevel(env: Environment): WorkerConfig["logLevel"] {
  const value = env.LOG_LEVEL?.trim() || (env.NODE_ENV === "production" ? "info" : "debug");
  if (value !== "debug" && value !== "info" && value !== "warn" && value !== "error") {
    throw new Error("LOG_LEVEL must be debug, info, warn, or error");
  }
  return value;
}

function paymentReconciliationConfig(
  env: Environment,
  environmentTier: BackendEnvironmentTier,
): NonNullable<WorkerConfig["paymentReconciliation"]> {
  const provider = env.PAYMENT_RECONCILIATION_PROVIDER?.trim() || "MANUAL_REVIEW";
  if (provider !== "MANUAL_REVIEW" && provider !== "KG_INICIS" && provider !== "PORTONE_API") {
    throw new Error("PAYMENT_RECONCILIATION_PROVIDER must be MANUAL_REVIEW, KG_INICIS, or PORTONE_API");
  }

  const environment = optional(env, "KG_INICIS_ENVIRONMENT");
  const mid = optional(env, "KG_INICIS_MID");
  const iniApiKey = optional(env, "KG_INICIS_INIAPI_KEY");
  const clientIp = optional(env, "KG_INICIS_CLIENT_IP");
  const hasInicisConfig = Boolean(environment || mid || iniApiKey || clientIp);
  const apiBaseUrl = optional(env, "PORTONE_RECONCILIATION_API_BASE_URL");
  const workerSecret = optional(env, "PAYMENT_RECONCILIATION_WORKER_SECRET");
  if (provider === "MANUAL_REVIEW") {
    if (hasInicisConfig || apiBaseUrl || workerSecret) {
      throw new Error("Payment reconciliation settings must be unset when using MANUAL_REVIEW");
    }
    return { provider };
  }

  if (provider === "PORTONE_API") {
    if (hasInicisConfig) throw new Error("KG INICIS inquiry settings must be unset when using PORTONE_API");
    if (!env.DABBOBA_ENVIRONMENT_TIER?.trim()
      || (environmentTier !== "STAGING" && environmentTier !== "PRODUCTION")) {
      throw new Error("PortOne API reconciliation requires an explicit STAGING or PRODUCTION worker tier");
    }
    if (!apiBaseUrl || !workerSecret) {
      throw new Error("PortOne API reconciliation requires a base URL and worker secret");
    }
    const parsed = new URL(apiBaseUrl);
    if ((env.NODE_ENV === "production" && parsed.protocol !== "https:")
      || !["https:", "http:"].includes(parsed.protocol)
      || parsed.username || parsed.password || parsed.search || parsed.hash
      || !["/", "/functions/v1/dabboba-api"].includes(parsed.pathname)) {
      throw new Error("PORTONE_RECONCILIATION_API_BASE_URL must identify the dedicated API origin or Supabase function");
    }
    const secretSize = Buffer.byteLength(workerSecret, "utf8");
    if (secretSize < 32 || secretSize > 512 || /[\r\n]/.test(workerSecret)
      || /(?:change-me|local-development)/i.test(workerSecret)) {
      throw new Error("PAYMENT_RECONCILIATION_WORKER_SECRET must be a 32-512 byte server-only secret");
    }
    return { provider, apiBaseUrl: parsed.href.replace(/\/$/, ""), secret: workerSecret };
  }

  if (apiBaseUrl || workerSecret) {
    throw new Error("PortOne API reconciliation settings must be unset when using KG_INICIS");
  }

  if (!env.DABBOBA_ENVIRONMENT_TIER?.trim()) {
    throw new Error("KG INICIS inquiry requires an explicit DABBOBA_ENVIRONMENT_TIER");
  }
  if (!environment || !mid || !iniApiKey || !clientIp) {
    throw new Error("KG INICIS inquiry requires environment, MID, INIAPI key, and client IPv4");
  }
  if (
    (environmentTier === "STAGING" && environment !== "TEST")
    || (environmentTier === "PRODUCTION" && environment !== "LIVE")
    || (environmentTier !== "STAGING" && environmentTier !== "PRODUCTION")
  ) {
    throw new Error("KG INICIS inquiry is allowed only for STAGING+TEST or PRODUCTION+LIVE");
  }

  const config: InicisInquiryConfig = {
    environment: environment as InicisInquiryConfig["environment"],
    mid,
    iniApiKey,
    clientIp,
  };
  assertInicisInquiryConfig(config);
  return {
    provider,
    ...config,
  };
}

export function loadWorkerConfig(env: Environment = process.env): WorkerConfig {
  const environment = runtimeEnvironment(env);
  const explicitTier = Boolean(env.DABBOBA_ENVIRONMENT_TIER?.trim());
  const environmentTier = loadBackendEnvironmentTier(env, environment, env === process.env);
  if (environmentTier === "PRODUCTION" && (explicitTier || env === process.env)
    && env.DABBOBA_ENABLE_PRODUCTION_WORKER !== "true") {
    throw new Error("Production worker execution is disabled unless DABBOBA_ENABLE_PRODUCTION_WORKER=true");
  }
  const databaseUrl = validateUrl(
    required(env, "WORKER_DATABASE_URL"),
    "WORKER_DATABASE_URL",
    ["postgres:", "postgresql:"],
  );
  if (explicitTier) {
    assertDatabaseUrlForTier(databaseUrl, "WORKER_DATABASE_URL", environmentTier);
    assertLocalTestProviderBoundary(env, environmentTier);
  }
  const queueName = env.WORKER_QUEUE_NAME?.trim() || "dabboba_worker";
  if (queueName !== "dabboba_worker") {
    throw new Error("WORKER_QUEUE_NAME must be dabboba_worker to match the migrated least-privilege queue ACL");
  }

  const gcsBucket = optional(env, "GCS_BUCKET");
  const mediaStorage = loadMediaStorageConfig(env, environment);
  const notificationDeliveryUrlRaw = optional(env, "NOTIFICATION_DELIVERY_URL");
  const notificationDeliveryUrl = notificationDeliveryUrlRaw
    ? validateUrl(notificationDeliveryUrlRaw, "NOTIFICATION_DELIVERY_URL", ["http:", "https:"])
    : null;
  const expoPushAccessToken = optional(env, "EXPO_PUSH_ACCESS_TOKEN");
  if (expoPushAccessToken && (
    expoPushAccessToken.length < 20
    || expoPushAccessToken.length > 4_096
    || /[\s\u0000-\u001f\u007f]/.test(expoPushAccessToken)
  )) {
    throw new Error("EXPO_PUSH_ACCESS_TOKEN must be a valid server-only Expo access token");
  }
  if (notificationDeliveryUrl && expoPushAccessToken) {
    throw new Error("Configure either EXPO_PUSH_ACCESS_TOKEN or NOTIFICATION_DELIVERY_URL, not both");
  }
  const paymentReconciliation = paymentReconciliationConfig(env, environmentTier);
  const supabaseUrl = optional(env, "SUPABASE_URL");
  const supabaseAuthAdminSecretKey = optional(env, "SUPABASE_AUTH_ADMIN_SECRET_KEY");
  if (Boolean(supabaseUrl) !== Boolean(supabaseAuthAdminSecretKey)) {
    throw new Error("Supabase Auth deletion requires SUPABASE_URL and SUPABASE_AUTH_ADMIN_SECRET_KEY together");
  }
  if (supabaseAuthAdminSecretKey && (
    supabaseAuthAdminSecretKey.length < 20
    || supabaseAuthAdminSecretKey.length > 4_096
    || /[\r\n]/.test(supabaseAuthAdminSecretKey)
    || /^sb_publishable_/i.test(supabaseAuthAdminSecretKey)
  )) {
    throw new Error("SUPABASE_AUTH_ADMIN_SECRET_KEY must be a server-only Supabase secret key");
  }
  const supabaseAuthAdmin = supabaseUrl && supabaseAuthAdminSecretKey
    ? {
        url: validateUrl(supabaseUrl, "SUPABASE_URL", environment === "production" ? ["https:"] : ["http:", "https:"]),
        secretKey: supabaseAuthAdminSecretKey,
      }
    : null;

  const appleClientId = optional(env, "APPLE_CLIENT_ID");
  const appleClientSecret = optional(env, "APPLE_CLIENT_SECRET");
  const appleEncryptionKey = optional(env, "APPLE_TOKEN_ENCRYPTION_KEY");
  const appleEncryptionKeyVersion = optional(env, "APPLE_TOKEN_ENCRYPTION_KEY_VERSION");
  const appleValues = [appleClientId, appleClientSecret, appleEncryptionKey, appleEncryptionKeyVersion];
  if (appleValues.some(Boolean) && !appleValues.every(Boolean)) {
    throw new Error("Apple revocation requires APPLE_CLIENT_ID, APPLE_CLIENT_SECRET, and token encryption key configuration together");
  }
  let appleRevocation: WorkerConfig["appleRevocation"] = null;
  if (appleClientId && appleClientSecret && appleEncryptionKey && appleEncryptionKeyVersion) {
    if (appleClientId.length > 255 || /[\s\u0000-\u001f\u007f]/.test(appleClientId)) {
      throw new Error("APPLE_CLIENT_ID is invalid");
    }
    if (appleClientSecret.length < 32 || appleClientSecret.length > 16_384 || /[\r\n]/.test(appleClientSecret)) {
      throw new Error("APPLE_CLIENT_SECRET is invalid");
    }
    if (!/^[A-Za-z0-9+/_-]{43}={0,2}$/.test(appleEncryptionKey)
      || Buffer.from(appleEncryptionKey, appleEncryptionKey.includes("-") || appleEncryptionKey.includes("_") ? "base64url" : "base64").length !== 32) {
      throw new Error("APPLE_TOKEN_ENCRYPTION_KEY must encode exactly 32 random bytes");
    }
    const keyVersion = Number(appleEncryptionKeyVersion);
    if (!Number.isInteger(keyVersion) || keyVersion < 1 || keyVersion > 2_147_483_647) {
      throw new Error("APPLE_TOKEN_ENCRYPTION_KEY_VERSION must be a positive integer");
    }
    appleRevocation = {
      clientId: appleClientId,
      clientSecret: appleClientSecret,
      encryptionKey: appleEncryptionKey,
      keyVersion,
    };
  }

  if (environment === "production") {
    if (!gcsBucket && !mediaStorage.supabaseStorage) throw new Error("GCS_BUCKET or Supabase Storage is required in production");
    if (notificationDeliveryUrl) {
      throw new Error(
        "NOTIFICATION_DELIVERY_URL is disabled in production until receiver-enforced idempotency is implemented",
      );
    }
  }

  const queueVisibilitySeconds = integer(env, "WORKER_QUEUE_VISIBILITY_SECONDS", 900, 30, 3_600);
  const maxRunSeconds = integer(
    env,
    "WORKER_MAX_RUN_SECONDS",
    MAX_WORKER_RUN_SECONDS,
    10,
    MAX_WORKER_RUN_SECONDS,
  );
  if (queueVisibilitySeconds < MIN_QUEUE_VISIBILITY_SECONDS) {
    throw new Error(
      `WORKER_QUEUE_VISIBILITY_SECONDS must be at least ${MIN_QUEUE_VISIBILITY_SECONDS} `
      + `(${CLOUD_RUN_TASK_TIMEOUT_SECONDS}s Cloud Run task timeout plus `
      + `${QUEUE_VISIBILITY_SAFETY_MARGIN_SECONDS}s safety margin)`,
    );
  }

  return {
    environment,
    environmentTier,
    databaseUrl,
    queueName,
    outboxBatchSize: integer(env, "WORKER_OUTBOX_BATCH_SIZE", 50, 1, 500),
    paymentStaleMinutes: integer(env, "WORKER_PAYMENT_STALE_MINUTES", 10, 1, 10_080),
    paymentWindowValidityMinutes: integer(env, "WORKER_PAYMENT_WINDOW_VALIDITY_MINUTES", 30, 10, 1_440),
    mediaPendingTtlMinutes: integer(env, "WORKER_MEDIA_PENDING_TTL_MINUTES", 5, 5, 10_080),
    mediaRejectedTtlHours: integer(env, "WORKER_MEDIA_REJECTED_TTL_HOURS", 24, 1, 8_760),
    jobAttempts: integer(env, "WORKER_JOB_ATTEMPTS", 8, 1, 50),
    jobBackoffMs: integer(env, "WORKER_JOB_BACKOFF_MS", 1_000, 100, 3_600_000),
    queueVisibilitySeconds,
    maxMessagesPerRun: integer(env, "WORKER_MAX_MESSAGES_PER_RUN", 100, 1, 5_000),
    maxRunSeconds,
    databasePoolMax: integer(env, "DATABASE_POOL_MAX", 3, 2, 15),
    databaseOperationTimeoutMs: integer(env, "WORKER_DATABASE_OPERATION_TIMEOUT_MS", 30_000, 1_000, 30_000),
    gcsBucket,
    gcsProjectId: optional(env, "GCS_PROJECT_ID"),
    ...mediaStorage,
    supabaseAuthAdmin,
    appleRevocation,
    notificationDeliveryUrl,
    notificationDeliveryToken: optional(env, "NOTIFICATION_DELIVERY_TOKEN"),
    expoPushAccessToken,
    paymentReconciliation,
    logLevel: logLevel(env),
  };
}
