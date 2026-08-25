type Environment = Record<string, string | undefined>;

export type RuntimeEnvironment = "development" | "test" | "production";

export type WorkerConfig = {
  environment: RuntimeEnvironment;
  databaseUrl: string;
  redisUrl: string;
  queueName: string;
  concurrency: number;
  outboxPollMs: number;
  outboxBatchSize: number;
  healthHost: string;
  healthPort: number;
  reservationSweepMs: number;
  paymentReconciliationMs: number;
  paymentStaleMinutes: number;
  mediaCleanupMs: number;
  mediaPendingTtlMinutes: number;
  mediaRejectedTtlHours: number;
  jobAttempts: number;
  jobBackoffMs: number;
  shutdownTimeoutMs: number;
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
  const databaseUrl = validateUrl(required(env, "DATABASE_URL"), "DATABASE_URL", ["postgres:", "postgresql:"]);
  const redisUrl = validateUrl(required(env, "REDIS_URL"), "REDIS_URL", ["redis:", "rediss:"]);
  const queueName = env.WORKER_QUEUE_NAME?.trim() || "dabboba-worker";
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(queueName)) {
    throw new Error("WORKER_QUEUE_NAME may contain only letters, numbers, underscores, and hyphens");
  }

  const gcsBucket = optional(env, "GCS_BUCKET");
  const notificationDeliveryUrlRaw = optional(env, "NOTIFICATION_DELIVERY_URL");
  const notificationDeliveryUrl = notificationDeliveryUrlRaw
    ? validateUrl(notificationDeliveryUrlRaw, "NOTIFICATION_DELIVERY_URL", ["http:", "https:"])
    : null;

  if (environment === "production") {
    if (!gcsBucket) throw new Error("GCS_BUCKET is required in production");
    if (notificationDeliveryUrl && !notificationDeliveryUrl.startsWith("https://")) {
      throw new Error("NOTIFICATION_DELIVERY_URL must use HTTPS in production");
    }
  }

  return {
    environment,
    databaseUrl,
    redisUrl,
    queueName,
    concurrency: integer(env, "WORKER_CONCURRENCY", 8, 1, 64),
    outboxPollMs: integer(env, "WORKER_OUTBOX_POLL_MS", 1_000, 100, 60_000),
    outboxBatchSize: integer(env, "WORKER_OUTBOX_BATCH_SIZE", 50, 1, 500),
    healthHost: env.WORKER_HEALTH_HOST?.trim() || "127.0.0.1",
    healthPort: integer(env, "WORKER_HEALTH_PORT", 8_791, 1, 65_535),
    reservationSweepMs: integer(env, "WORKER_RESERVATION_SWEEP_MS", 30_000, 1_000, 3_600_000),
    paymentReconciliationMs: integer(env, "WORKER_PAYMENT_RECONCILIATION_MS", 300_000, 10_000, 86_400_000),
    paymentStaleMinutes: integer(env, "WORKER_PAYMENT_STALE_MINUTES", 10, 1, 10_080),
    mediaCleanupMs: integer(env, "WORKER_MEDIA_CLEANUP_MS", 60_000, 10_000, 86_400_000),
    mediaPendingTtlMinutes: integer(env, "WORKER_MEDIA_PENDING_TTL_MINUTES", 5, 5, 10_080),
    mediaRejectedTtlHours: integer(env, "WORKER_MEDIA_REJECTED_TTL_HOURS", 24, 1, 8_760),
    jobAttempts: integer(env, "WORKER_JOB_ATTEMPTS", 8, 1, 50),
    jobBackoffMs: integer(env, "WORKER_JOB_BACKOFF_MS", 1_000, 100, 3_600_000),
    shutdownTimeoutMs: integer(env, "WORKER_SHUTDOWN_TIMEOUT_MS", 30_000, 1_000, 300_000),
    gcsBucket,
    gcsProjectId: optional(env, "GCS_PROJECT_ID"),
    notificationDeliveryUrl,
    notificationDeliveryToken: optional(env, "NOTIFICATION_DELIVERY_TOKEN"),
    logLevel: logLevel(env),
  };
}
