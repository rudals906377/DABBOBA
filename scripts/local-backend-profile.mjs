import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export const LOCAL_BACKEND_PROFILE = 'local-development';
export const LOCAL_BACKEND_DATABASE = 'dabboba_development';
export const LOCAL_BACKEND_PORTS = Object.freeze({
  api: 8788,
  postgres: 55433,
  redis: 56380,
});
export const LOCAL_BACKEND_ENVIRONMENT_TIER = 'LOCAL';
export const LOCAL_RELEASE_ENVIRONMENT_TIER = 'DEVELOPMENT';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
export const LOCAL_BACKEND_ENV_FILE = `${repositoryRoot}.env.development.local`;
const SYSTEM_ENV_ALLOWLIST = [
  'PATH', 'HOME', 'TMPDIR', 'SHELL', 'USER', 'LOGNAME', 'LANG', 'LC_ALL',
  'TERM', 'COLORTERM', 'FORCE_COLOR', 'NO_COLOR', 'COREPACK_HOME',
];

function systemEnvironment(hostEnv) {
  const result = {};
  for (const key of SYSTEM_ENV_ALLOWLIST) {
    if (typeof hostEnv[key] === 'string') result[key] = hostEnv[key];
  }
  return result;
}

function parseDatabaseUrl(value, key, expectedUser) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${key} in .env.development.local must be a valid local PostgreSQL URL.`);
  }
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol)
    || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname)
    || parsed.port !== String(LOCAL_BACKEND_PORTS.postgres)
    || parsed.pathname !== `/${LOCAL_BACKEND_DATABASE}`
    || decodeURIComponent(parsed.username) !== expectedUser
    || !parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new Error(`${key} in .env.development.local does not match the isolated local backend profile.`);
  }
  return value;
}

export function assertLocalBackendProfileEnv(env) {
  const exact = {
    DABBOBA_LOCAL_BACKEND_PROFILE: LOCAL_BACKEND_PROFILE,
    DABBOBA_ENVIRONMENT_TIER: LOCAL_BACKEND_ENVIRONMENT_TIER,
    DABBOBA_RELEASE_ENVIRONMENT_TIER: LOCAL_RELEASE_ENVIRONMENT_TIER,
    NODE_ENV: 'development',
    PAYMENT_PROVIDER: 'UNCONFIGURED',
  };
  for (const [key, expected] of Object.entries(exact)) {
    if (env[key]?.trim() !== expected) {
      throw new Error(`${key} in .env.development.local must be ${expected}.`);
    }
  }
  parseDatabaseUrl(env.DATABASE_URL, 'DATABASE_URL', 'dabboba_runtime');
  if (env.DATABASE_MIGRATION_URL !== undefined) {
    parseDatabaseUrl(env.DATABASE_MIGRATION_URL, 'DATABASE_MIGRATION_URL', 'dabboba');
  }
  if (env.WORKER_DATABASE_URL !== undefined) {
    parseDatabaseUrl(env.WORKER_DATABASE_URL, 'WORKER_DATABASE_URL', 'dabboba_worker');
  }
  if (!env.SESSION_TOKEN_PEPPER || Buffer.byteLength(env.SESSION_TOKEN_PEPPER, 'utf8') < 32) {
    throw new Error('SESSION_TOKEN_PEPPER in .env.development.local must contain at least 32 bytes.');
  }
  if (env.ADMIN_PROXY_IDENTITY_SECRET?.trim()) {
    throw new Error('ADMIN_PROXY_IDENTITY_SECRET must be empty in .env.development.local.');
  }
  for (const key of [
    'SUPABASE_URL', 'SUPABASE_STORAGE_SERVICE_KEY', 'SUPABASE_STORAGE_S3_ENDPOINT',
    'SUPABASE_STORAGE_S3_ACCESS_KEY_ID', 'SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY',
    'GCS_BUCKET', 'GCS_PROJECT_ID', 'GOOGLE_APPLICATION_CREDENTIALS',
    'PAYMENT_WEBHOOK_SECRET', 'NOTIFICATION_DELIVERY_URL', 'NOTIFICATION_DELIVERY_TOKEN',
  ]) {
    if (env[key]?.trim()) throw new Error(`${key} must be empty in .env.development.local.`);
  }
  return env;
}

export function readLocalBackendProfileEnv() {
  let source;
  try {
    source = readFileSync(LOCAL_BACKEND_ENV_FILE, 'utf8');
  } catch {
    throw new Error('Local backend profile is missing. Run corepack pnpm local:backend:prepare first.');
  }
  const profile = assertLocalBackendProfileEnv(parseEnv(source));
  if (!profile.DATABASE_MIGRATION_URL || !profile.WORKER_DATABASE_URL) {
    throw new Error('.env.development.local must contain dedicated migration and worker database URLs.');
  }
  return profile;
}

function sharedLocalEnvironment(hostEnv) {
  return {
    ...systemEnvironment(hostEnv),
    DABBOBA_LOCAL_BACKEND_PROFILE: LOCAL_BACKEND_PROFILE,
    DABBOBA_ENVIRONMENT_TIER: LOCAL_BACKEND_ENVIRONMENT_TIER,
    DABBOBA_RELEASE_ENVIRONMENT_TIER: LOCAL_RELEASE_ENVIRONMENT_TIER,
    NODE_ENV: 'development',
    LOG_LEVEL: 'debug',
    PAYMENT_PROVIDER: 'UNCONFIGURED',
    MEDIA_STORAGE_PROVIDER: 'gcs',
  };
}

export function localApiEnvironment(hostEnv = process.env) {
  const profile = readLocalBackendProfileEnv();
  return {
    ...sharedLocalEnvironment(hostEnv),
    API_HOST: '127.0.0.1',
    API_PORT: String(LOCAL_BACKEND_PORTS.api),
    PORT: String(LOCAL_BACKEND_PORTS.api),
    API_SURFACE: 'all',
    DATABASE_URL: profile.DATABASE_URL,
    SESSION_TOKEN_PEPPER: profile.SESSION_TOKEN_PEPPER,
    ADMIN_PROXY_IDENTITY_SECRET: '',
    DATABASE_POOL_MAX: '5',
    REDIS_URL: `redis://127.0.0.1:${LOCAL_BACKEND_PORTS.redis}`,
    WEB_ORIGINS: 'http://127.0.0.1:4174,http://localhost:4174',
    ADMIN_ORIGINS: 'http://127.0.0.1:4180,http://localhost:4180',
    SESSION_TTL_DAYS: '30',
    DABBOBA_ENABLE_DEV_SESSION: 'true',
    DABBOBA_ENABLE_MOBILE_TEST_FIXTURES: 'false',
  };
}

export function localWorkerEnvironment(hostEnv = process.env) {
  const profile = readLocalBackendProfileEnv();
  return {
    ...sharedLocalEnvironment(hostEnv),
    WORKER_DATABASE_URL: profile.WORKER_DATABASE_URL,
    WORKER_QUEUE_NAME: 'dabboba_worker',
    WORKER_QUEUE_VISIBILITY_SECONDS: '900',
    WORKER_MAX_MESSAGES_PER_RUN: '100',
    WORKER_MAX_RUN_SECONDS: '45',
    WORKER_DATABASE_OPERATION_TIMEOUT_MS: '30000',
    DATABASE_POOL_MAX: '3',
  };
}

export function localAdminEnvironment(hostEnv = process.env) {
  readLocalBackendProfileEnv();
  return {
    ...systemEnvironment(hostEnv),
    NODE_ENV: 'development',
    DABBOBA_ENVIRONMENT_TIER: LOCAL_BACKEND_ENVIRONMENT_TIER,
    DABBOBA_API_URL: `http://127.0.0.1:${LOCAL_BACKEND_PORTS.api}`,
    NEXT_PUBLIC_DABBOBA_API_URL: `http://127.0.0.1:${LOCAL_BACKEND_PORTS.api}`,
    ADMIN_SESSION_COOKIE_NAME: 'dabboba_admin_session',
    ADMIN_PROXY_IDENTITY_SECRET: '',
    ADMIN_EDGE_CLIENT_IP_HEADER: '',
  };
}

export function sanitizeLocalMobileEnvironment(hostEnv = process.env) {
  return {
    ...systemEnvironment(hostEnv),
    NODE_ENV: 'development',
    DABBOBA_LOCAL_BACKEND_PROFILE: LOCAL_BACKEND_PROFILE,
    EXPO_NO_TELEMETRY: '1',
    EXPO_NO_DOTENV: '1',
    RCT_METRO_PORT: '8084',
    REACT_NATIVE_PACKAGER_HOSTNAME: '127.0.0.1',
    EXPO_PACKAGER_PROXY_URL: 'http://127.0.0.1:8084',
    BROWSER: 'none',
    DABBOBA_ENVIRONMENT_TIER: LOCAL_BACKEND_ENVIRONMENT_TIER,
    EXPO_PUBLIC_DABBOBA_API_URL: `http://127.0.0.1:${LOCAL_BACKEND_PORTS.api}`,
    EXPO_PUBLIC_DABBOBA_ASSET_BASE_URL: 'http://127.0.0.1:4174',
    EXPO_PUBLIC_DABBOBA_WEB_URL: 'http://127.0.0.1:4174',
    EXPO_PUBLIC_DABBOBA_ALLOWED_ORIGINS: 'http://127.0.0.1:4174,http://localhost:4174',
  };
}
