type Environment = Record<string, string | undefined>;

export * from "./admin-proxy-identity.js";

export type RuntimeEnvironment = "development" | "test" | "production";

export type ApiConfig = {
  environment: RuntimeEnvironment;
  host: string;
  port: number;
  databaseUrl: string;
  redisUrl: string;
  webOrigins: string[];
  adminOrigins: string[];
  sessionTokenPepper: string;
  adminProxyIdentitySecret: string | null;
  supabaseUrl?: string | null;
  supabaseJwtAudience?: string | null;
  sessionTtlDays: number;
  paymentProvider: string;
  paymentWebhookSecret: string | null;
  gcsBucket: string | null;
  gcsProjectId: string | null;
  logLevel: string;
};

export type AdminConfig = {
  environment: RuntimeEnvironment;
  apiBaseUrl: string;
  publicApiBaseUrl: string;
  sessionCookieName: string;
  adminProxyIdentitySecret: string | null;
  adminEdgeClientIpHeader: string | null;
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

function adminProxySecret(env: Environment, runtime: RuntimeEnvironment): string | null {
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
): Pick<ApiConfig, "supabaseUrl" | "supabaseJwtAudience"> {
  const rawUrl = optional(env, "SUPABASE_URL");
  const rawAudience = optional(env, "SUPABASE_JWT_AUDIENCE");
  if (!rawUrl) {
    if (rawAudience) throw new Error("SUPABASE_JWT_AUDIENCE requires SUPABASE_URL");
    if (runtime === "production") throw new Error("SUPABASE_URL is required in production");
    return { supabaseUrl: null, supabaseJwtAudience: null };
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
  return {
    supabaseUrl: parsed.origin,
    supabaseJwtAudience: audience,
  };
}

function paymentConfig(
  env: Environment,
  runtime: RuntimeEnvironment,
  sessionTokenPepper: string,
  proxyIdentitySecret: string | null,
): Pick<ApiConfig, "paymentProvider" | "paymentWebhookSecret"> {
  const paymentProvider = env.PAYMENT_PROVIDER?.trim() || "UNCONFIGURED";
  const paymentWebhookSecret = optional(env, "PAYMENT_WEBHOOK_SECRET");

  if (runtime === "production" && paymentProvider === "UNCONFIGURED" && paymentWebhookSecret) {
    throw new Error("PAYMENT_WEBHOOK_SECRET must be unset when PAYMENT_PROVIDER is UNCONFIGURED in production");
  }
  if (runtime === "production" && paymentProvider === "INTERNAL_ZERO") {
    throw new Error("PAYMENT_PROVIDER cannot use the reserved INTERNAL_ZERO payment rail in production");
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

  return { paymentProvider, paymentWebhookSecret };
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

function originList(env: Environment, key: string, fallback: string): string[] {
  const values = (env[key] || fallback)
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);

  for (const value of values) {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.pathname !== "/") {
      throw new Error(`${key} entries must be HTTP(S) origins without a path`);
    }
  }

  return [...new Set(values)];
}

export function loadApiConfig(env: Environment = process.env): ApiConfig {
  const runtime = environment(env);
  const pepper = required(env, "SESSION_TOKEN_PEPPER");
  const proxyIdentitySecret = adminProxySecret(env, runtime);
  const webOrigins = originList(env, "WEB_ORIGINS", env.WEB_ORIGIN || "http://127.0.0.1:4174");
  const adminOrigins = originList(env, "ADMIN_ORIGINS", "http://127.0.0.1:4180");
  const supabaseAuth = supabaseAuthConfig(env, runtime);

  if (runtime === "production") {
    if (pepper.length < 32 || pepper.includes("local-development")) {
      throw new Error("SESSION_TOKEN_PEPPER must be a unique high-entropy value in production");
    }
    if (proxyIdentitySecret === pepper) {
      throw new Error("ADMIN_PROXY_IDENTITY_SECRET must be distinct from SESSION_TOKEN_PEPPER");
    }
    for (const origin of [...webOrigins, ...adminOrigins]) {
      if (!origin.startsWith("https://")) throw new Error("Production origins must use HTTPS");
    }
  }
  const payment = paymentConfig(env, runtime, pepper, proxyIdentitySecret);

  return {
    environment: runtime,
    host: env.API_HOST?.trim() || "127.0.0.1",
    port: integer(env, "API_PORT", 8788, 1, 65_535),
    databaseUrl: required(env, "DATABASE_URL"),
    redisUrl: required(env, "REDIS_URL"),
    webOrigins,
    adminOrigins,
    sessionTokenPepper: pepper,
    adminProxyIdentitySecret: proxyIdentitySecret,
    ...supabaseAuth,
    sessionTtlDays: integer(env, "SESSION_TTL_DAYS", 30, 1, 365),
    ...payment,
    gcsBucket: optional(env, "GCS_BUCKET"),
    gcsProjectId: optional(env, "GCS_PROJECT_ID"),
    logLevel: env.LOG_LEVEL?.trim() || (runtime === "production" ? "info" : "debug"),
  };
}

export function loadAdminConfig(env: Environment = process.env): AdminConfig {
  const runtime = environment(env);
  const proxyIdentitySecret = adminProxySecret(env, runtime);
  const edgeClientIpHeader = adminClientIpHeader(env, runtime, proxyIdentitySecret);
  const apiBaseUrl = required(env, "DABBOBA_API_URL").replace(/\/$/, "");
  const publicApiBaseUrl = (env.NEXT_PUBLIC_DABBOBA_API_URL?.trim() || apiBaseUrl).replace(/\/$/, "");
  if (runtime === "production" && (!apiBaseUrl.startsWith("https://") || !publicApiBaseUrl.startsWith("https://"))) {
    throw new Error("Admin API URLs must use HTTPS in production");
  }
  return {
    environment: runtime,
    apiBaseUrl,
    publicApiBaseUrl,
    sessionCookieName: env.ADMIN_SESSION_COOKIE_NAME?.trim() || "dabboba_admin_session",
    adminProxyIdentitySecret: proxyIdentitySecret,
    adminEdgeClientIpHeader: edgeClientIpHeader,
  };
}
