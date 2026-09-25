type Environment = Record<string, string | undefined>;
import { loadMediaStorageConfig, type MediaStorageConfiguration } from "./media-storage.js";
import {
  assertDatabaseUrlForTier,
  assertLocalTestProviderBoundary,
  loadBackendEnvironmentTier,
  type BackendEnvironmentTier,
} from "./backend-environment.js";

export * from "./admin-proxy-identity.js";
export * from "./backend-environment.js";
export * from "./media-storage.js";

export type RuntimeEnvironment = "development" | "test" | "production";
export type ApiSurface = "customer" | "admin" | "all";
export type CommerceLaunchMode = "PRELAUNCH" | "LIVE";
export const CUSTOMER_LOGIN_PROVIDERS = ["PHONE", "KAKAO", "NAVER", "GOOGLE", "APPLE"] as const;
export type CustomerLoginProvider = (typeof CUSTOMER_LOGIN_PROVIDERS)[number];

export type ApiConfig = {
  environment: RuntimeEnvironment;
  /** Optional for programmatic fixtures; environment-loaded configs always set it. */
  environmentTier?: BackendEnvironmentTier;
  /** Optional only for backwards-compatible programmatic configs; loadApiConfig always sets it. */
  surface?: ApiSurface;
  host: string;
  port: number;
  databaseUrl: string;
  /** Loaded configs set a bounded value; optional for older programmatic test fixtures. */
  databasePoolMax?: number;
  redisUrl: string | null;
  webOrigins: string[];
  adminOrigins: string[];
  sessionTokenPepper: string;
  adminProxyIdentitySecret: string | null;
  supabaseUrl?: string | null;
  supabaseJwtAudience?: string | null;
  supabasePublishableKey?: string | null;
  customerLoginProviders?: CustomerLoginProvider[];
  /** Server-only AES-256-GCM key used to seal Apple refresh tokens before DB storage. */
  appleCredentialEncryption?: { key: string; keyVersion: number } | null;
  /** Customer Dukroom/community API exposure. Disabled by default in environment-loaded builds. */
  communityEnabled?: boolean;
  /** Server-side commerce kill switch. Production defaults to PRELAUNCH. */
  commerceMode?: CommerceLaunchMode;
  sessionTtlDays: number;
  paymentProvider: string;
  paymentWebhookSecret: string | null;
  /** Server-only PortOne V2/KG INICIS credentials. Null unless the rail is fully configured. */
  portOne?: {
    apiSecret: string;
    merchantId: string;
    storeId: string;
    channelKey: string;
    channelEnvironment: "LIVE" | "TEST";
    webhookSecret: string;
  } | null;
  gcsBucket: string | null;
  gcsProjectId: string | null;
  mediaStorageProvider?: MediaStorageConfiguration["mediaStorageProvider"];
  supabaseStorage?: MediaStorageConfiguration["supabaseStorage"];
  /** Server-trusted public API origin used to persist stable catalog media URLs. */
  catalogMediaBaseUrl?: string | null;
  logLevel: string;
};

export type AdminConfig = {
  environment: RuntimeEnvironment;
  environmentTier?: BackendEnvironmentTier;
  apiBaseUrl: string;
  publicApiBaseUrl: string;
  sessionCookieName: string;
  adminProxyIdentitySecret: string | null;
  adminEdgeClientIpHeader: string | null;
};

export type MigrationConfig = {
  environment: RuntimeEnvironment;
  environmentTier?: BackendEnvironmentTier;
  databaseUrl: string;
};

const INTERNAL_ADMIN_IDENTITY_HEADERS = new Set([
  "forwarded",
  "x-forwarded-for",
  "x-dabboba-admin-client-ip",
  "x-dabboba-admin-client-user-agent",
  "x-dabboba-admin-client-timestamp",
  "x-dabboba-admin-client-signature",
]);

function required(env: Environment, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function optional(env: Environment, key: string): string | null {
  return env[key]?.trim() || null;
}

function adminProxySecret(
  env: Environment,
  runtime: RuntimeEnvironment,
  enabled = true,
): string | null {
  if (!enabled) return null;
  const value = optional(env, "ADMIN_PROXY_IDENTITY_SECRET");
  if (runtime === "production") {
    if (!value || Buffer.byteLength(value, "utf8") < 32 || Buffer.byteLength(value, "utf8") > 512 || /(?:change-me|local-development)/i.test(value)) {
      throw new Error("ADMIN_PROXY_IDENTITY_SECRET must be a unique 32-512 byte secret in production");
    }
  }
  return value;
}

function supabaseAuthConfig(
  env: Environment,
  runtime: RuntimeEnvironment,
  enabled = true,
): Pick<ApiConfig, "supabaseUrl" | "supabaseJwtAudience" | "supabasePublishableKey" | "customerLoginProviders" | "appleCredentialEncryption"> {
  if (!enabled) {
    return {
      supabaseUrl: null,
      supabaseJwtAudience: null,
      supabasePublishableKey: null,
      customerLoginProviders: [],
      appleCredentialEncryption: null,
    };
  }
  const rawUrl = optional(env, "SUPABASE_URL");
  const rawAudience = optional(env, "SUPABASE_JWT_AUDIENCE");
  const publishableKey = optional(env, "SUPABASE_PUBLISHABLE_KEY") || optional(env, "SUPABASE_ANON_KEY");
  const rawProviders = optional(env, "CUSTOMER_AUTH_ENABLED_PROVIDERS");
  if (!rawUrl) {
    if (rawAudience) throw new Error("SUPABASE_JWT_AUDIENCE requires SUPABASE_URL");
    if (publishableKey) throw new Error("SUPABASE_PUBLISHABLE_KEY requires SUPABASE_URL");
    if (rawProviders) throw new Error("CUSTOMER_AUTH_ENABLED_PROVIDERS requires SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY");
    if (optional(env, "APPLE_TOKEN_ENCRYPTION_KEY") || optional(env, "APPLE_TOKEN_ENCRYPTION_KEY_VERSION")) {
      throw new Error("Apple token encryption requires SUPABASE_URL");
    }
    if (runtime === "production") throw new Error("SUPABASE_URL is required in production");
    return {
      supabaseUrl: null,
      supabaseJwtAudience: null,
      supabasePublishableKey: null,
      customerLoginProviders: [],
      appleCredentialEncryption: null,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("SUPABASE_URL must be a valid HTTP(S) origin");
  }
  if (
    !/^https?:$/.test(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) {
    throw new Error("SUPABASE_URL must be an HTTP(S) origin without credentials, path, query, or fragment");
  }
  if (runtime === "production" && parsed.protocol !== "https:") {
    throw new Error("SUPABASE_URL must use HTTPS in production");
  }

  const audience = rawAudience || "authenticated";
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(audience)) {
    throw new Error("SUPABASE_JWT_AUDIENCE must be a 1-128 character token");
  }
  if (publishableKey && (
    publishableKey.length < 20
    || publishableKey.length > 4_096
    || /^sb_secret_/i.test(publishableKey)
    || legacyJwtRole(publishableKey) === "service_role"
  )) {
    throw new Error("SUPABASE_PUBLISHABLE_KEY must be a public Supabase key");
  }
  if (rawProviders && !publishableKey) {
    throw new Error("CUSTOMER_AUTH_ENABLED_PROVIDERS requires SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY");
  }
  const customerLoginProviders = rawProviders
    ? parseCustomerLoginProviders(rawProviders)
    : [];
  const appleEncryptionKey = optional(env, "APPLE_TOKEN_ENCRYPTION_KEY");
  const appleEncryptionKeyVersion = optional(env, "APPLE_TOKEN_ENCRYPTION_KEY_VERSION");
  if (Boolean(appleEncryptionKey) !== Boolean(appleEncryptionKeyVersion)) {
    throw new Error("APPLE_TOKEN_ENCRYPTION_KEY and APPLE_TOKEN_ENCRYPTION_KEY_VERSION are required together");
  }
  let appleCredentialEncryption: ApiConfig["appleCredentialEncryption"] = null;
  if (appleEncryptionKey && appleEncryptionKeyVersion) {
    if (!/^[A-Za-z0-9+/_-]{43}={0,2}$/.test(appleEncryptionKey)
      || Buffer.from(appleEncryptionKey, appleEncryptionKey.includes("-") || appleEncryptionKey.includes("_") ? "base64url" : "base64").length !== 32) {
      throw new Error("APPLE_TOKEN_ENCRYPTION_KEY must encode exactly 32 random bytes");
    }
    const keyVersion = Number(appleEncryptionKeyVersion);
    if (!Number.isInteger(keyVersion) || keyVersion < 1 || keyVersion > 2_147_483_647) {
      throw new Error("APPLE_TOKEN_ENCRYPTION_KEY_VERSION must be a positive integer");
    }
    appleCredentialEncryption = { key: appleEncryptionKey, keyVersion };
  }
  if (customerLoginProviders.includes("APPLE") && !appleCredentialEncryption) {
    throw new Error("APPLE login requires encrypted token storage configuration");
  }
  return {
    supabaseUrl: parsed.origin,
    supabaseJwtAudience: audience,
    supabasePublishableKey: publishableKey,
    customerLoginProviders,
    appleCredentialEncryption,
  };
}

function parseCustomerLoginProviders(raw: string): CustomerLoginProvider[] {
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  const allowed = new Set<string>(CUSTOMER_LOGIN_PROVIDERS);
  if (
    values.length === 0
    || values.length > CUSTOMER_LOGIN_PROVIDERS.length
    || values.some((value) => !allowed.has(value))
    || new Set(values).size !== values.length
  ) {
    throw new Error(
      `CUSTOMER_AUTH_ENABLED_PROVIDERS must be a unique comma-separated subset of ${CUSTOMER_LOGIN_PROVIDERS.join(",")}`,
    );
  }
  return CUSTOMER_LOGIN_PROVIDERS.filter((provider) => values.includes(provider));
}

function legacyJwtRole(value: string): string | null {
  const payload = value.split(".")[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as { role?: unknown };
    return typeof decoded.role === "string" ? decoded.role : null;
  } catch {
    return null;
  }
}

function paymentConfig(
  env: Environment,
  runtime: RuntimeEnvironment,
  sessionTokenPepper: string,
  proxyIdentitySecret: string | null,
): Pick<ApiConfig, "paymentProvider" | "paymentWebhookSecret" | "portOne"> {
  const paymentProvider = env.PAYMENT_PROVIDER?.trim() || "UNCONFIGURED";
  const paymentWebhookSecret = optional(env, "PAYMENT_WEBHOOK_SECRET");
  const portOneValues = {
    apiSecret: optional(env, "PORTONE_API_SECRET"),
    merchantId: optional(env, "PORTONE_MERCHANT_ID"),
    storeId: optional(env, "PORTONE_STORE_ID"),
    channelKey: optional(env, "PORTONE_CHANNEL_KEY"),
    channelEnvironment: optional(env, "PORTONE_CHANNEL_ENVIRONMENT"),
    webhookSecret: optional(env, "PORTONE_WEBHOOK_SECRET"),
  };
  const portOneConfigured = Object.values(portOneValues).some(Boolean);
  const portOneComplete = Object.values(portOneValues).every(Boolean);
  const explicitSupabaseDemoTestRail = (
    env.DABBOBA_BACKEND_PROFILE?.trim() === "supabase-demo"
    && env.DABBOBA_ENVIRONMENT_TIER?.trim() === "STAGING"
    && env.DABBOBA_RELEASE_ENVIRONMENT_TIER?.trim() === "STAGING"
    && env.DABBOBA_ENABLE_DEMO_TESTING?.trim() === "true"
    && env.DABBOBA_DEMO_FIXTURE_TAG?.trim() === "supabase-demo-v1"
    && env.API_HOST?.trim() === "127.0.0.1"
  );
  const explicitPortOneStagingRail = (
    env.DABBOBA_ENVIRONMENT_TIER?.trim() === "STAGING"
    && env.DABBOBA_RELEASE_ENVIRONMENT_TIER?.trim() === "STAGING"
  );

  if (runtime === "production" && paymentProvider === "UNCONFIGURED" && paymentWebhookSecret) {
    throw new Error("PAYMENT_WEBHOOK_SECRET must be unset when PAYMENT_PROVIDER is UNCONFIGURED in production");
  }
  if (runtime === "production" && paymentProvider === "INTERNAL_ZERO") {
    throw new Error("PAYMENT_PROVIDER cannot use the reserved INTERNAL_ZERO payment rail in production");
  }
  if (runtime === "production" && paymentProvider === "TEST_PG" && !explicitSupabaseDemoTestRail) {
    throw new Error("PAYMENT_PROVIDER=TEST_PG requires the explicit loopback supabase-demo STAGING profile");
  }
  if (runtime === "production" && paymentProvider !== "UNCONFIGURED") {
    const secretLength = paymentWebhookSecret ? Buffer.byteLength(paymentWebhookSecret, "utf8") : 0;
    if (!paymentWebhookSecret || secretLength < 32 || secretLength > 512 || /(?:change-me|local-development)/i.test(paymentWebhookSecret)) {
      throw new Error("PAYMENT_WEBHOOK_SECRET must be a unique 32-512 byte secret in production when PAYMENT_PROVIDER is configured");
    }
    if (paymentWebhookSecret === sessionTokenPepper || paymentWebhookSecret === proxyIdentitySecret) {
      throw new Error("PAYMENT_WEBHOOK_SECRET must be distinct from SESSION_TOKEN_PEPPER and ADMIN_PROXY_IDENTITY_SECRET");
    }
  }

  if (portOneConfigured && !portOneComplete) {
    throw new Error("PORTONE_API_SECRET, PORTONE_MERCHANT_ID, PORTONE_STORE_ID, PORTONE_CHANNEL_KEY, PORTONE_CHANNEL_ENVIRONMENT, and PORTONE_WEBHOOK_SECRET must be configured together");
  }
  if (
    portOneValues.channelEnvironment
    && portOneValues.channelEnvironment !== "LIVE"
    && portOneValues.channelEnvironment !== "TEST"
  ) {
    throw new Error("PORTONE_CHANNEL_ENVIRONMENT must be LIVE or TEST");
  }
  if (paymentProvider === "PORTONE_V2_INICIS" && !portOneComplete) {
    throw new Error("PAYMENT_PROVIDER=PORTONE_V2_INICIS requires a complete PortOne configuration");
  }
  if (paymentProvider !== "PORTONE_V2_INICIS" && portOneConfigured) {
    throw new Error("PortOne credentials require PAYMENT_PROVIDER=PORTONE_V2_INICIS");
  }
  if (
    runtime === "production"
    && portOneValues.channelEnvironment === "TEST"
    && !explicitPortOneStagingRail
  ) {
    throw new Error("PORTONE_CHANNEL_ENVIRONMENT=TEST requires the explicit STAGING release tier");
  }
  if (portOneComplete) {
    const serverSecrets = [
      portOneValues.apiSecret!,
      portOneValues.webhookSecret!,
      paymentWebhookSecret,
    ];
    if (serverSecrets.some((value) => !value || Buffer.byteLength(value, "utf8") < 20)) {
      throw new Error("PortOne and payment webhook secrets must be at least 20 bytes");
    }
    if (new Set(serverSecrets).size !== serverSecrets.length) {
      throw new Error("PortOne and normalized payment webhook secrets must be distinct");
    }
  }

  return {
    paymentProvider,
    paymentWebhookSecret,
    portOne: portOneComplete
      ? {
          apiSecret: portOneValues.apiSecret!,
          merchantId: portOneValues.merchantId!,
          storeId: portOneValues.storeId!,
          channelKey: portOneValues.channelKey!,
          channelEnvironment: portOneValues.channelEnvironment as "LIVE" | "TEST",
          webhookSecret: portOneValues.webhookSecret!,
        }
      : null,
  };
}

function adminClientIpHeader(env: Environment, runtime: RuntimeEnvironment, secret: string | null): string | null {
  const value = optional(env, "ADMIN_EDGE_CLIENT_IP_HEADER")?.toLowerCase() || null;
  if (value && (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(value) || INTERNAL_ADMIN_IDENTITY_HEADERS.has(value))) {
    throw new Error("ADMIN_EDGE_CLIENT_IP_HEADER must be a valid dedicated HTTP header name");
  }
  if (runtime === "production" && !value) {
    throw new Error("ADMIN_EDGE_CLIENT_IP_HEADER is required in production");
  }
  if ((value && !secret) || (!value && secret)) {
    throw new Error("ADMIN_EDGE_CLIENT_IP_HEADER and ADMIN_PROXY_IDENTITY_SECRET must be configured together");
  }
  return value;
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

function environment(env: Environment): RuntimeEnvironment {
  const value = env.NODE_ENV?.trim() || "development";
  if (value !== "development" && value !== "test" && value !== "production") {
    throw new Error("NODE_ENV must be development, test, or production");
  }
  return value;
}

function apiSurface(env: Environment, runtime: RuntimeEnvironment): ApiSurface {
  const value = env.API_SURFACE?.trim() || (runtime === "production" ? "customer" : "all");
  if (value !== "customer" && value !== "admin" && value !== "all") {
    throw new Error("API_SURFACE must be customer, admin, or all");
  }
  return value;
}

function migrationDatabaseUrl(env: Environment, runtime: RuntimeEnvironment): string {
  const dedicatedUrl = optional(env, "DATABASE_MIGRATION_URL");
  if (runtime === "production" && !dedicatedUrl) {
    throw new Error("Missing required environment variable: DATABASE_MIGRATION_URL");
  }

  const value = dedicatedUrl || required(env, "DATABASE_URL");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("DATABASE_MIGRATION_URL must be a valid PostgreSQL URL");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_MIGRATION_URL must use postgres:// or postgresql://");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (
    runtime === "production"
    && !hostname.endsWith(".supabase.com")
    && !hostname.endsWith(".supabase.co")
  ) {
    throw new Error("DATABASE_MIGRATION_URL must use an approved Supabase hostname in production");
  }
  if (hostname.endsWith(".pooler.supabase.com") && parsed.port === "6543") {
    throw new Error(
      "DATABASE_MIGRATION_URL must use the Supabase Session pooler on port 5432, not Transaction mode on port 6543",
    );
  }

  return value;
}

function httpOrigin(value: string, key: string, runtime: RuntimeEnvironment): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid HTTP(S) origin`);
  }
  if (
    !/^https?:$/.test(url.protocol)
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    throw new Error(`${key} must be an HTTP(S) origin without credentials, path, query, or fragment`);
  }
  if (runtime === "production" && url.protocol !== "https:") {
    throw new Error(`${key} must use HTTPS in production`);
  }
  return url.origin;
}

function httpBaseUrl(value: string, key: string, runtime: RuntimeEnvironment): string {
  if (/(?:^|[/\\])\.{1,2}(?:[/\\]|$)/.test(value) || /%(?:2e|2f|5c)/i.test(value)) {
    throw new Error(`${key} must not contain path traversal or encoded path separators`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid HTTP(S) base URL`);
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${key} must be an HTTP(S) base URL without credentials, query, or fragment`);
  }
  if (runtime === "production" && url.protocol !== "https:") {
    throw new Error(`${key} must use HTTPS in production`);
  }
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}`;
}

function originList(env: Environment, key: string, fallback: string, runtime: RuntimeEnvironment): string[] {
  const values = (env[key] || fallback)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (values.length === 0) {
    throw new Error(`${key} must contain at least one HTTP(S) origin`);
  }

  return [...new Set(values.map((value) => httpOrigin(value, `${key} entries`, runtime)))];
}

export function loadApiConfig(env: Environment = process.env): ApiConfig {
  const runtime = environment(env);
  const explicitTier = Boolean(env.DABBOBA_ENVIRONMENT_TIER?.trim());
  const environmentTier = loadBackendEnvironmentTier(env, runtime, env === process.env);
  if (explicitTier) {
    assertDatabaseUrlForTier(required(env, "DATABASE_URL"), "DATABASE_URL", environmentTier);
    assertLocalTestProviderBoundary(env, environmentTier);
  }
  const surface = apiSurface(env, runtime);
  const includesCustomer = surface === "customer" || surface === "all";
  const includesAdmin = surface === "admin" || surface === "all";
  const pepper = required(env, "SESSION_TOKEN_PEPPER");
  const proxyIdentitySecret = adminProxySecret(env, runtime, includesAdmin);
  const webOrigins = includesCustomer
    ? originList(env, "WEB_ORIGINS", env.WEB_ORIGIN || "http://127.0.0.1:4174", runtime)
    : [];
  const adminOrigins = includesAdmin
    ? originList(env, "ADMIN_ORIGINS", "http://127.0.0.1:4180", runtime)
    : [];
  const supabaseAuth = supabaseAuthConfig(env, runtime, includesCustomer);
  const communityFlag = env.DABBOBA_ENABLE_DUKROOM?.trim() || "false";
  if (communityFlag !== "true" && communityFlag !== "false") {
    throw new Error("DABBOBA_ENABLE_DUKROOM must be true or false");
  }
  const commerceMode = env.DABBOBA_COMMERCE_MODE?.trim()
    || (runtime === "production" ? "PRELAUNCH" : "LIVE");
  if (commerceMode !== "PRELAUNCH" && commerceMode !== "LIVE") {
    throw new Error("DABBOBA_COMMERCE_MODE must be PRELAUNCH or LIVE");
  }

  if (runtime === "production") {
    if (pepper.length < 32 || pepper.includes("local-development")) {
      throw new Error("SESSION_TOKEN_PEPPER must be a unique high-entropy value in production");
    }
    if (proxyIdentitySecret === pepper) {
      throw new Error("ADMIN_PROXY_IDENTITY_SECRET must be distinct from SESSION_TOKEN_PEPPER");
    }
  }
  const payment = paymentConfig(env, runtime, pepper, proxyIdentitySecret);
  if (runtime === "production" && commerceMode === "PRELAUNCH" && payment.paymentProvider !== "UNCONFIGURED") {
    throw new Error("PRELAUNCH requires PAYMENT_PROVIDER=UNCONFIGURED in production");
  }
  if (runtime === "production" && commerceMode === "LIVE" && payment.paymentProvider === "UNCONFIGURED") {
    throw new Error("LIVE requires a configured payment provider in production");
  }

  return {
    environment: runtime,
    environmentTier,
    surface,
    host: env.API_HOST?.trim() || (runtime === "production" ? "0.0.0.0" : "127.0.0.1"),
    port: env.PORT?.trim()
      ? integer(env, "PORT", 8788, 1, 65_535)
      : integer(env, "API_PORT", 8788, 1, 65_535),
    databaseUrl: required(env, "DATABASE_URL"),
    databasePoolMax: integer(env, "DATABASE_POOL_MAX", runtime === "production" ? 5 : 15, 1, 15),
    redisUrl: optional(env, "REDIS_URL"),
    webOrigins,
    adminOrigins,
    sessionTokenPepper: pepper,
    adminProxyIdentitySecret: proxyIdentitySecret,
    ...supabaseAuth,
    communityEnabled: communityFlag === "true",
    commerceMode,
    sessionTtlDays: integer(env, "SESSION_TTL_DAYS", 30, 1, 365),
    ...payment,
    gcsBucket: optional(env, "GCS_BUCKET"),
    gcsProjectId: optional(env, "GCS_PROJECT_ID"),
    ...loadMediaStorageConfig(env, runtime),
    catalogMediaBaseUrl: optional(env, "DABBOBA_CATALOG_MEDIA_BASE_URL")
      ? httpBaseUrl(required(env, "DABBOBA_CATALOG_MEDIA_BASE_URL"), "DABBOBA_CATALOG_MEDIA_BASE_URL", runtime)
      : null,
    logLevel: env.LOG_LEVEL?.trim() || (runtime === "production" ? "info" : "debug"),
  };
}

export function loadMigrationConfig(env: Environment = process.env): MigrationConfig {
  const runtime = environment(env);
  const explicitTier = Boolean(env.DABBOBA_ENVIRONMENT_TIER?.trim());
  const environmentTier = loadBackendEnvironmentTier(env, runtime, env === process.env);
  const databaseUrl = migrationDatabaseUrl(env, runtime);
  if (explicitTier) assertDatabaseUrlForTier(databaseUrl, "DATABASE_MIGRATION_URL", environmentTier);
  return {
    environment: runtime,
    environmentTier,
    databaseUrl,
  };
}

export function loadAdminConfig(env: Environment = process.env): AdminConfig {
  const runtime = environment(env);
  const environmentTier = loadBackendEnvironmentTier(env, runtime, env === process.env);
  const proxyIdentitySecret = adminProxySecret(env, runtime);
  const edgeClientIpHeader = adminClientIpHeader(env, runtime, proxyIdentitySecret);
  const apiBaseUrl = httpBaseUrl(required(env, "DABBOBA_API_URL"), "DABBOBA_API_URL", runtime);
  const publicApiBaseUrl = httpBaseUrl(
    env.NEXT_PUBLIC_DABBOBA_API_URL?.trim() || apiBaseUrl,
    "NEXT_PUBLIC_DABBOBA_API_URL",
    runtime,
  );
  return {
    environment: runtime,
    environmentTier,
    apiBaseUrl,
    publicApiBaseUrl,
    sessionCookieName: env.ADMIN_SESSION_COOKIE_NAME?.trim() || "dabboba_admin_session",
    adminProxyIdentitySecret: proxyIdentitySecret,
    adminEdgeClientIpHeader: edgeClientIpHeader,
  };
}
