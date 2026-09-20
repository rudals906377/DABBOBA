export type BackendEnvironmentTier = "LOCAL" | "TEST" | "STAGING" | "PRODUCTION";

type Environment = Record<string, string | undefined>;
type RuntimeEnvironment = "development" | "test" | "production";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function inferredTier(runtime: RuntimeEnvironment): BackendEnvironmentTier {
  if (runtime === "development") return "LOCAL";
  if (runtime === "test") return "TEST";
  return "PRODUCTION";
}

export function loadBackendEnvironmentTier(
  env: Environment,
  runtime: RuntimeEnvironment,
  requireExplicit = false,
): BackendEnvironmentTier {
  const raw = env.DABBOBA_ENVIRONMENT_TIER?.trim();
  if (!raw) {
    if (requireExplicit) {
      throw new Error("Missing required environment variable: DABBOBA_ENVIRONMENT_TIER");
    }
    return inferredTier(runtime);
  }
  if (raw !== "LOCAL" && raw !== "TEST" && raw !== "STAGING" && raw !== "PRODUCTION") {
    throw new Error("DABBOBA_ENVIRONMENT_TIER must be LOCAL, TEST, STAGING, or PRODUCTION");
  }
  if (
    (raw === "LOCAL" && runtime !== "development")
    || (raw === "TEST" && runtime !== "test")
    || ((raw === "STAGING" || raw === "PRODUCTION") && runtime !== "production")
  ) {
    throw new Error("DABBOBA_ENVIRONMENT_TIER does not match NODE_ENV");
  }
  return raw;
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return LOOPBACK_HOSTS.has(normalized) || normalized === "[::1]";
}

function safeUrl(value: string, key: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${key} must be a valid URL`);
  }
}

export function assertDatabaseUrlForTier(
  value: string,
  key: string,
  tier: BackendEnvironmentTier,
): string {
  const parsed = safeUrl(value, key);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`${key} must use postgres:// or postgresql://`);
  }
  if (!parsed.pathname || parsed.pathname === "/" || parsed.hash) {
    throw new Error(`${key} must identify one database without a fragment`);
  }
  if (tier === "LOCAL" || tier === "TEST") {
    if (!isLoopbackHostname(parsed.hostname)) {
      throw new Error(`${key} must use a loopback database in ${tier}`);
    }
    if (parsed.search) {
      throw new Error(`${key} must not use query parameters in ${tier}`);
    }
  }
  return value;
}

function assertLoopbackHttpUrl(value: string, key: string): void {
  const parsed = safeUrl(value, key);
  if (!/^https?:$/.test(parsed.protocol) || !isLoopbackHostname(parsed.hostname)
    || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${key} must use a loopback HTTP(S) fixture in LOCAL or TEST`);
  }
}

export function assertLocalTestProviderBoundary(
  env: Environment,
  tier: BackendEnvironmentTier,
): void {
  if (tier !== "LOCAL" && tier !== "TEST") return;

  const paymentProvider = env.PAYMENT_PROVIDER?.trim() || "UNCONFIGURED";
  if (
    paymentProvider !== "UNCONFIGURED"
    && paymentProvider !== "INTERNAL_ZERO"
    && !/^(?:LOCAL|TEST)_/.test(paymentProvider)
  ) {
    throw new Error("PAYMENT_PROVIDER must be disabled or identify a LOCAL/TEST fixture");
  }

  const loopbackUrls = [
    "SUPABASE_URL",
    "SUPABASE_STORAGE_S3_ENDPOINT",
    "NOTIFICATION_DELIVERY_URL",
  ] as const;
  for (const key of loopbackUrls) {
    const value = env[key]?.trim();
    if (value) assertLoopbackHttpUrl(value, key);
  }

  if (env.GCS_BUCKET?.trim() || env.GCS_PROJECT_ID?.trim() || env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
    throw new Error("Google Cloud provider credentials are not allowed in LOCAL or TEST");
  }
  const hasSupabaseStorageSecret = [
    "SUPABASE_STORAGE_SERVICE_KEY",
    "SUPABASE_STORAGE_S3_ACCESS_KEY_ID",
    "SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY",
  ].some((key) => Boolean(env[key]?.trim()));
  if (hasSupabaseStorageSecret && !env.SUPABASE_STORAGE_S3_ENDPOINT?.trim()) {
    throw new Error("Supabase Storage credentials require a loopback fixture endpoint in LOCAL or TEST");
  }
}

export function assertTestDatabaseEnvironment(env: Environment): void {
  const tier = env.DABBOBA_ENVIRONMENT_TIER?.trim();
  if (tier && tier !== "TEST") {
    throw new Error("Test commands require DABBOBA_ENVIRONMENT_TIER=TEST when the tier is set");
  }
  const keys = [
    "DABBOBA_TEST_DATABASE_URL",
    "DABBOBA_RUNTIME_TEST_DATABASE_URL",
    "DABBOBA_WORKER_TEST_DATABASE_URL",
    "DATABASE_MIGRATION_URL",
    "DATABASE_URL",
    "WORKER_DATABASE_URL",
  ] as const;
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) assertDatabaseUrlForTier(value, key, "TEST");
  }
  const roleUrls = [
    env.DABBOBA_TEST_DATABASE_URL,
    env.DABBOBA_RUNTIME_TEST_DATABASE_URL,
    env.DABBOBA_WORKER_TEST_DATABASE_URL,
  ].map((value) => value?.trim()).filter((value): value is string => Boolean(value));
  if (roleUrls.length === 3) {
    const identities = roleUrls.map((value) => {
      const parsed = new URL(value);
      return `loopback:${parsed.port || "5432"}:${decodeURIComponent(parsed.pathname.slice(1))}`;
    });
    if (new Set(identities).size !== 1) {
      throw new Error("Owner, runtime, and worker test URLs must identify the same local database");
    }
  }
  assertLocalTestProviderBoundary(env, "TEST");
}
