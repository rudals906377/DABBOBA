type Environment = Record<string, string | undefined>;

export type RuntimeEnvironment = "development" | "test" | "production";

// Cloud Run deploys the one-shot task with a 600-second timeout. Keep queue
// visibility beyond the platform deadline so a killed task cannot be claimed
// concurrently by the next execution while it is still shutting down.
export const CLOUD_RUN_TASK_TIMEOUT_SECONDS = 600;
export const QUEUE_VISIBILITY_SAFETY_MARGIN_SECONDS = 300;
export const MIN_QUEUE_VISIBILITY_SECONDS =
  CLOUD_RUN_TASK_TIMEOUT_SECONDS + QUEUE_VISIBILITY_SAFETY_MARGIN_SECONDS;
// Stop starting work after four minutes. The remaining six minutes cover one
// already-started bounded unit, transaction rollback, and platform shutdown.
export const MAX_WORKER_RUN_SECONDS = 240;

export type WorkerConfig = {
  environment: RuntimeEnvironment;
  databaseUrl: string;
  queueName: string;
  outboxBatchSize: number;
  paymentStaleMinutes: number;
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
  notificationDeliveryUrl: string | null;
  notificationDeliveryToken: string | null;
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
  const parsed = new URL(value);
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

export function loadWorkerConfig(env: Environment = process.env): WorkerConfig {
  const environment = runtimeEnvironment(env);
  const databaseUrl = validateUrl(
    required(env, "WORKER_DATABASE_URL"),
    "WORKER_DATABASE_URL",
    ["postgres:", "postgresql:"],
  );
  const queueName = env.WORKER_QUEUE_NAME?.trim() || "dabboba_worker";
  if (queueName !== "dabboba_worker") {
    throw new Error("WORKER_QUEUE_NAME must be dabboba_worker to match the migrated least-privilege queue ACL");
  }

  const gcsBucket = optional(env, "GCS_BUCKET");
  const notificationDeliveryUrlRaw = optional(env, "NOTIFICATION_DELIVERY_URL");
  const notificationDeliveryUrl = notificationDeliveryUrlRaw
    ? validateUrl(notificationDeliveryUrlRaw, "NOTIFICATION_DELIVERY_URL", ["http:", "https:"])
    : null;

  if (environment === "production") {
    if (!gcsBucket) throw new Error("GCS_BUCKET is required in production");
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
    databaseUrl,
    queueName,
    outboxBatchSize: integer(env, "WORKER_OUTBOX_BATCH_SIZE", 50, 1, 500),
    paymentStaleMinutes: integer(env, "WORKER_PAYMENT_STALE_MINUTES", 10, 1, 10_080),
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
    notificationDeliveryUrl,
    notificationDeliveryToken: optional(env, "NOTIFICATION_DELIVERY_TOKEN"),
    logLevel: logLevel(env),
  };
}
