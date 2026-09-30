import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import {
  assertSupabaseIntegrationSecrets,
  assertSupabaseIntegrationSource,
  SUPABASE_INTEGRATION_PROJECT_REF,
} from './supabase-integration-profile.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const launchDirectory = resolve(repositoryRoot, '../.dabboba-launch');
const sourceFile = resolve(repositoryRoot, '.env');
const integrationFile = resolve(launchDirectory, 'supabase-integration.env');
// The historical supabase-edge.env belongs to the retired QA project. Keep it
// intact, but never read or upload it for the friend-owned production project.
export const SUPABASE_EDGE_PROFILE_FILE = resolve(launchDirectory, 'supabase-edge-production.env');
export const SUPABASE_PRODUCTION_WORKER_CREDENTIAL_FILE = resolve(launchDirectory, 'supabase-production-worker.env');

const CUSTOMER_AUTH_PROVIDERS = ['PHONE', 'KAKAO', 'NAVER', 'GOOGLE', 'APPLE'];
// LIVE always requires the social logins. PHONE (SMS OTP) depends on a
// separately contracted and verified SMS provider, so it is required only when
// the operator explicitly attests readiness with DABBOBA_PHONE_LOGIN_READY=true.
export const LIVE_REQUIRED_SOCIAL_LOGIN_METHODS = Object.freeze(['KAKAO', 'NAVER', 'GOOGLE', 'APPLE']);
export const PHONE_LOGIN_READY_KEY = 'DABBOBA_PHONE_LOGIN_READY';
const LIVE_API_BASE_URL = `https://${SUPABASE_INTEGRATION_PROJECT_REF}.supabase.co/functions/v1/dabboba-api`;
const LIVE_PAYMENT_SECRETS = [
  'DABBOBA_API_PAYMENT_WEBHOOK_SECRET',
  'DABBOBA_API_PAYMENT_RECONCILIATION_WORKER_SECRET',
  'DABBOBA_API_PORTONE_API_SECRET',
  'DABBOBA_API_PORTONE_WEBHOOK_SECRET',
];
const LIVE_PAYMENT_IDENTIFIERS = [
  'DABBOBA_API_PORTONE_MERCHANT_ID',
  'DABBOBA_API_PORTONE_STORE_ID',
  'DABBOBA_API_PORTONE_CHANNEL_KEY',
];

const GENERATED_REQUIRED_KEYS = [
  'DABBOBA_ENVIRONMENT_TIER',
  'DABBOBA_API_DATABASE_URL',
  'DABBOBA_API_SESSION_TOKEN_PEPPER',
  'DABBOBA_API_WEB_ORIGINS',
  'DABBOBA_API_PAYMENT_PROVIDER',
  'DABBOBA_API_COMMERCE_MODE',
  'DABBOBA_API_SUPABASE_JWT_AUDIENCE',
  'DABBOBA_API_LOG_LEVEL',
  'DABBOBA_API_CATALOG_MEDIA_BASE_URL',
  'DABBOBA_WORKER_INVOKE_SECRET',
  'DABBOBA_WORKER_DATABASE_URL',
  'DABBOBA_ENABLE_PRODUCTION_WORKER',
  'DABBOBA_STORAGE_BUCKET',
  'DABBOBA_STORAGE_S3_ENDPOINT',
  'DABBOBA_STORAGE_S3_REGION',
];

// These values depend on provider-console and real-device verification, so the
// profile generator must never invent them. A production release stays blocked
// until at least one reviewed customer login method is explicitly supplied.
export const SUPABASE_EDGE_EXTERNAL_REQUIRED_KEYS = Object.freeze([
  'DABBOBA_API_CUSTOMER_AUTH_ENABLED_PROVIDERS',
]);

// These are preserved when present but are not universal release requirements.
// Apple becomes an all-or-none requirement when APPLE is advertised. Expo push
// remains optional because database-backed in-app notifications do not depend
// on a remote-push credential.
export const SUPABASE_EDGE_EXTERNAL_OPTIONAL_KEYS = Object.freeze([
  'DABBOBA_API_SUPABASE_PUBLISHABLE_KEY',
  'DABBOBA_API_APPLE_TOKEN_ENCRYPTION_KEY',
  'DABBOBA_API_APPLE_TOKEN_ENCRYPTION_KEY_VERSION',
  'DABBOBA_WORKER_APPLE_CLIENT_ID',
  'DABBOBA_WORKER_APPLE_CLIENT_SECRET',
  'DABBOBA_WORKER_APPLE_TOKEN_ENCRYPTION_KEY',
  'DABBOBA_WORKER_APPLE_TOKEN_ENCRYPTION_KEY_VERSION',
  'DABBOBA_WORKER_EXPO_PUSH_ACCESS_TOKEN',
  PHONE_LOGIN_READY_KEY,
]);

const REQUIRED_KEYS = [
  ...GENERATED_REQUIRED_KEYS,
  ...SUPABASE_EDGE_EXTERNAL_REQUIRED_KEYS,
];

const APPLE_EDGE_KEYS = [
  'DABBOBA_API_APPLE_TOKEN_ENCRYPTION_KEY',
  'DABBOBA_API_APPLE_TOKEN_ENCRYPTION_KEY_VERSION',
  'DABBOBA_WORKER_APPLE_CLIENT_ID',
  'DABBOBA_WORKER_APPLE_CLIENT_SECRET',
  'DABBOBA_WORKER_APPLE_TOKEN_ENCRYPTION_KEY',
  'DABBOBA_WORKER_APPLE_TOKEN_ENCRYPTION_KEY_VERSION',
];

function privateFile(path) {
  if ((statSync(path).mode & 0o777) !== 0o600) {
    throw new Error('Supabase Edge profile must be readable only by the current user.');
  }
}

function parsePrivate(path) {
  privateFile(path);
  return parseEnv(readFileSync(path, 'utf8'));
}

function databaseUrl(sourceUrl, role, port, password = null) {
  const url = new URL(sourceUrl);
  url.username = `${role}.${SUPABASE_INTEGRATION_PROJECT_REF}`;
  url.port = port;
  if (password !== null) url.password = password;
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function assertProductionWorkerCredential(values, sourceDatabaseUrl) {
  const source = new URL(sourceDatabaseUrl);
  const worker = new URL(values.DABBOBA_WORKER_DATABASE_URL);
  if (
    values.DABBOBA_SUPABASE_PROJECT_REF !== SUPABASE_INTEGRATION_PROJECT_REF
    || values.DABBOBA_WORKER_CREDENTIAL_STATUS !== 'VERIFIED'
    || worker.hostname !== source.hostname
    || worker.port !== '5432'
    || worker.pathname !== '/postgres'
    || decodeURIComponent(worker.username) !== `dabboba_worker.${SUPABASE_INTEGRATION_PROJECT_REF}`
    || !worker.password
    || worker.search
    || worker.hash
    || Buffer.byteLength(values.DABBOBA_WORKER_INVOKE_SECRET ?? '', 'utf8') < 32
    || values.DABBOBA_WORKER_INVOKE_SECRET === worker.password
  ) throw new Error('Verified production worker credential is missing or targets another project.');
  return {
    DABBOBA_WORKER_DATABASE_URL: worker.toString(),
    DABBOBA_WORKER_INVOKE_SECRET: values.DABBOBA_WORKER_INVOKE_SECRET,
  };
}

export function serializeSupabaseEdgeProfile(values) {
  const keys = [
    ...REQUIRED_KEYS,
    ...SUPABASE_EDGE_EXTERNAL_OPTIONAL_KEYS,
    'DABBOBA_STORAGE_S3_ACCESS_KEY_ID',
    'DABBOBA_STORAGE_S3_SECRET_ACCESS_KEY',
  ];
  return `${keys
    .filter((key) => values[key])
    .map((key) => `${key}=${values[key]}`)
    .join('\n')}\n`;
}

function decodeJwtRole(value) {
  const payload = value.split('.')[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    return typeof decoded.role === 'string' ? decoded.role : null;
  } catch {
    return null;
  }
}

function parseCustomerAuthProviders(value) {
  const providers = value.split(',').map((provider) => provider.trim()).filter(Boolean);
  if (
    providers.length === 0
    || providers.length > CUSTOMER_AUTH_PROVIDERS.length
    || providers.some((provider) => !CUSTOMER_AUTH_PROVIDERS.includes(provider))
    || new Set(providers).size !== providers.length
  ) {
    throw new Error(`DABBOBA_API_CUSTOMER_AUTH_ENABLED_PROVIDERS must be a unique comma-separated subset of ${CUSTOMER_AUTH_PROVIDERS.join(',')}.`);
  }
  return providers;
}

function validEncryptionKey(value) {
  if (!/^[A-Za-z0-9+/_-]{43}={0,2}$/.test(value)) return false;
  const encoding = value.includes('-') || value.includes('_') ? 'base64url' : 'base64';
  return Buffer.from(value, encoding).length === 32;
}

function requiredLiveValue(values, key, minimumBytes) {
  const value = values[key];
  if (typeof value !== 'string' || value !== value.trim()
    || Buffer.byteLength(value, 'utf8') < minimumBytes
    || Buffer.byteLength(value, 'utf8') > 512
    || /[\r\n\u0000]/.test(value)
    || /(?:change-me|local-development)/i.test(value)) {
    throw new Error(`LIVE Edge profile requires valid ${key}.`);
  }
  return value;
}

export function phoneLoginReady(values) {
  const flag = values?.[PHONE_LOGIN_READY_KEY]?.trim();
  if (flag === undefined || flag === '' || flag === 'false') return false;
  if (flag === 'true') return true;
  throw new Error(`${PHONE_LOGIN_READY_KEY} must be true or false.`);
}

function assertLiveLoginMethods(values, providers) {
  const phoneReady = phoneLoginReady(values);
  const required = phoneReady
    ? ['PHONE', ...LIVE_REQUIRED_SOCIAL_LOGIN_METHODS]
    : LIVE_REQUIRED_SOCIAL_LOGIN_METHODS;
  if (required.some((provider) => !providers.includes(provider))) {
    throw new Error('LIVE Edge profile requires all requested customer login methods.');
  }
  if (!phoneReady && providers.includes('PHONE')) {
    throw new Error(`LIVE Edge profile enables PHONE login without ${PHONE_LOGIN_READY_KEY}=true (verified SMS delivery).`);
  }
}

function assertLivePaymentConfiguration(values, providers) {
  assertLiveLoginMethods(values, providers);
  if (values.DABBOBA_API_PORTONE_CHANNEL_ENVIRONMENT !== 'LIVE') {
    throw new Error('LIVE Edge profile requires a PortOne LIVE channel.');
  }
  if (values.PAYMENT_RECONCILIATION_PROVIDER !== 'PORTONE_API') {
    throw new Error('LIVE Edge profile requires PORTONE_API worker reconciliation.');
  }
  for (const key of LIVE_PAYMENT_IDENTIFIERS) requiredLiveValue(values, key, 1);
  const secrets = LIVE_PAYMENT_SECRETS.map((key) => requiredLiveValue(
    values, key, key.includes('PAYMENT_') ? 32 : 20,
  ));
  const workerSecret = requiredLiveValue(values, 'PAYMENT_RECONCILIATION_WORKER_SECRET', 32);
  if (workerSecret !== values.DABBOBA_API_PAYMENT_RECONCILIATION_WORKER_SECRET) {
    throw new Error('LIVE Edge API and worker require a matching worker requery secret.');
  }
  const separateSecrets = [
    ...secrets,
    values.DABBOBA_API_SESSION_TOKEN_PEPPER,
    values.DABBOBA_WORKER_INVOKE_SECRET,
  ].filter(Boolean);
  if (new Set(separateSecrets).size !== separateSecrets.length) {
    throw new Error('LIVE Edge payment secrets must be distinct from other server secrets.');
  }
  if (values.PORTONE_RECONCILIATION_API_BASE_URL !== LIVE_API_BASE_URL) {
    throw new Error('LIVE Edge worker must requery the pinned production API route.');
  }
  for (const key of ['KG_INICIS_ENVIRONMENT', 'KG_INICIS_MID', 'KG_INICIS_INIAPI_KEY', 'KG_INICIS_CLIENT_IP']) {
    if (values[key]?.trim()) throw new Error('LIVE Edge PortOne API requery cannot use the legacy KG INICIS inquiry rail.');
  }
}

export function assertSupabaseEdgeReleaseConfiguration(values, { expectedCommerceMode = 'PRELAUNCH' } = {}) {
  for (const key of SUPABASE_EDGE_EXTERNAL_REQUIRED_KEYS) {
    if (!values?.[key]?.trim()) {
      throw new Error(`Supabase Edge release profile is missing externally verified ${key}.`);
    }
  }
  if (expectedCommerceMode !== 'PRELAUNCH' && expectedCommerceMode !== 'LIVE') {
    throw new Error('Supabase Edge release commerce mode is invalid.');
  }
  if (values.DABBOBA_ENVIRONMENT_TIER !== 'PRODUCTION'
    || values.DABBOBA_API_SUPABASE_JWT_AUDIENCE !== 'authenticated') {
    throw new Error('Supabase Edge release profile must use the reviewed production authentication boundary.');
  }
  if (expectedCommerceMode === 'PRELAUNCH') {
    if (values.DABBOBA_API_COMMERCE_MODE !== 'PRELAUNCH'
      || values.DABBOBA_API_PAYMENT_PROVIDER !== 'UNCONFIGURED') {
      throw new Error('Supabase Edge release profile must use the reviewed PRELAUNCH authentication and payment boundary.');
    }
    if ([
      ...LIVE_PAYMENT_SECRETS,
      ...LIVE_PAYMENT_IDENTIFIERS,
      'DABBOBA_API_PORTONE_CHANNEL_ENVIRONMENT',
      'PAYMENT_RECONCILIATION_PROVIDER',
      'PORTONE_RECONCILIATION_API_BASE_URL',
      'PAYMENT_RECONCILIATION_WORKER_SECRET',
    ].some((key) => values[key]?.trim())) {
      throw new Error('PRELAUNCH Edge profile must not contain LIVE payment or requery settings.');
    }
  } else if (values.DABBOBA_API_COMMERCE_MODE !== 'LIVE'
    || values.DABBOBA_API_PAYMENT_PROVIDER !== 'PORTONE_V2_INICIS') {
    throw new Error('LIVE Edge profile requires LIVE commerce and PORTONE_V2_INICIS.');
  }

  const providers = parseCustomerAuthProviders(values.DABBOBA_API_CUSTOMER_AUTH_ENABLED_PROVIDERS);
  if (expectedCommerceMode === 'LIVE') assertLivePaymentConfiguration(values, providers);
  const publishableKey = values.DABBOBA_API_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (publishableKey && (
    publishableKey.length < 20
    || publishableKey.length > 4_096
    || /[\s\u0000-\u001f\u007f]/.test(publishableKey)
    || /^sb_secret_/i.test(publishableKey)
    || decodeJwtRole(publishableKey) === 'service_role'
  )) {
    throw new Error('DABBOBA_API_SUPABASE_PUBLISHABLE_KEY must be a public Supabase key.');
  }

  const configuredAppleKeys = APPLE_EDGE_KEYS.filter((key) => values[key]?.trim());
  if (configuredAppleKeys.length > 0 && configuredAppleKeys.length !== APPLE_EDGE_KEYS.length) {
    throw new Error('Supabase Edge Apple login and revocation settings must be configured together.');
  }
  if (providers.includes('APPLE') && configuredAppleKeys.length !== APPLE_EDGE_KEYS.length) {
    throw new Error('APPLE customer login requires complete API encryption and worker revocation settings.');
  }
  const appleConfigured = configuredAppleKeys.length === APPLE_EDGE_KEYS.length;
  if (appleConfigured) {
    const apiKey = values.DABBOBA_API_APPLE_TOKEN_ENCRYPTION_KEY.trim();
    const workerKey = values.DABBOBA_WORKER_APPLE_TOKEN_ENCRYPTION_KEY.trim();
    const apiVersion = values.DABBOBA_API_APPLE_TOKEN_ENCRYPTION_KEY_VERSION.trim();
    const workerVersion = values.DABBOBA_WORKER_APPLE_TOKEN_ENCRYPTION_KEY_VERSION.trim();
    const clientId = values.DABBOBA_WORKER_APPLE_CLIENT_ID.trim();
    const clientSecret = values.DABBOBA_WORKER_APPLE_CLIENT_SECRET.trim();
    const version = Number(apiVersion);
    if (
      !validEncryptionKey(apiKey)
      || apiKey !== workerKey
      || apiVersion !== workerVersion
      || !Number.isInteger(version)
      || version < 1
      || version > 2_147_483_647
    ) {
      throw new Error('Supabase Edge Apple token encryption keys and versions must be valid and identical.');
    }
    if (
      clientId.length > 255
      || /[\s\u0000-\u001f\u007f]/.test(clientId)
      || clientSecret.length < 32
      || clientSecret.length > 16_384
      || /[\r\n]/.test(clientSecret)
    ) {
      throw new Error('Supabase Edge Apple revocation credentials are invalid.');
    }
  }

  const expoPushAccessToken = values.DABBOBA_WORKER_EXPO_PUSH_ACCESS_TOKEN?.trim();
  if (expoPushAccessToken && (
    expoPushAccessToken.length < 20
    || expoPushAccessToken.length > 4_096
    || /[\s\u0000-\u001f\u007f]/.test(expoPushAccessToken)
  )) {
    throw new Error('DABBOBA_WORKER_EXPO_PUSH_ACCESS_TOKEN is invalid.');
  }

  return {
    customerAuthProviders: providers,
    appleRevocationConfigured: appleConfigured,
    remotePushConfigured: Boolean(expoPushAccessToken),
  };
}

export function edgeExternalValuesFromSource(source) {
  const values = {};
  const copy = (sourceKey, edgeKey = sourceKey) => {
    if (source[sourceKey]?.trim()) values[edgeKey] = source[sourceKey].trim();
  };
  copy('SUPABASE_PUBLISHABLE_KEY', 'DABBOBA_API_SUPABASE_PUBLISHABLE_KEY');
  copy('CUSTOMER_AUTH_ENABLED_PROVIDERS', 'DABBOBA_API_CUSTOMER_AUTH_ENABLED_PROVIDERS');
  copy('APPLE_TOKEN_ENCRYPTION_KEY', 'DABBOBA_API_APPLE_TOKEN_ENCRYPTION_KEY');
  copy('APPLE_TOKEN_ENCRYPTION_KEY_VERSION', 'DABBOBA_API_APPLE_TOKEN_ENCRYPTION_KEY_VERSION');
  copy('APPLE_CLIENT_ID', 'DABBOBA_WORKER_APPLE_CLIENT_ID');
  copy('APPLE_CLIENT_SECRET', 'DABBOBA_WORKER_APPLE_CLIENT_SECRET');
  copy('APPLE_TOKEN_ENCRYPTION_KEY', 'DABBOBA_WORKER_APPLE_TOKEN_ENCRYPTION_KEY');
  copy('APPLE_TOKEN_ENCRYPTION_KEY_VERSION', 'DABBOBA_WORKER_APPLE_TOKEN_ENCRYPTION_KEY_VERSION');
  copy('EXPO_PUSH_ACCESS_TOKEN', 'DABBOBA_WORKER_EXPO_PUSH_ACCESS_TOKEN');
  for (const key of [...SUPABASE_EDGE_EXTERNAL_REQUIRED_KEYS, ...SUPABASE_EDGE_EXTERNAL_OPTIONAL_KEYS]) {
    copy(key);
  }
  return values;
}

function validate(values, expectedCommerceMode = 'PRELAUNCH') {
  for (const key of REQUIRED_KEYS) {
    if (!values[key]?.trim()) throw new Error(`Supabase Edge profile is missing ${key}.`);
  }
  if (
    values.DABBOBA_ENVIRONMENT_TIER !== 'PRODUCTION'
    || values.DABBOBA_API_PAYMENT_PROVIDER !== (expectedCommerceMode === 'LIVE' ? 'PORTONE_V2_INICIS' : 'UNCONFIGURED')
    || values.DABBOBA_ENABLE_PRODUCTION_WORKER !== 'true'
    || values.DABBOBA_STORAGE_BUCKET !== 'dabboba-media'
    || values.DABBOBA_API_CATALOG_MEDIA_BASE_URL !== `https://${SUPABASE_INTEGRATION_PROJECT_REF}.supabase.co/functions/v1/dabboba-api`
  ) throw new Error('Supabase Edge profile does not match the reviewed production boundary.');

  const api = new URL(values.DABBOBA_API_DATABASE_URL);
  const worker = new URL(values.DABBOBA_WORKER_DATABASE_URL);
  if (
    api.hostname !== worker.hostname
    || api.port !== '6543'
    || worker.port !== '5432'
    || decodeURIComponent(api.username) !== `dabboba_runtime.${SUPABASE_INTEGRATION_PROJECT_REF}`
    || decodeURIComponent(worker.username) !== `dabboba_worker.${SUPABASE_INTEGRATION_PROJECT_REF}`
    || !api.password
    || !worker.password
    || api.password === worker.password
  ) throw new Error('Supabase Edge database roles or pooler ports are invalid.');

  const invoke = values.DABBOBA_WORKER_INVOKE_SECRET;
  if (Buffer.byteLength(invoke, 'utf8') < 32 || invoke === worker.password) {
    throw new Error('Supabase Edge worker secrets are invalid.');
  }
  for (const key of ['DABBOBA_STORAGE_S3_ACCESS_KEY_ID', 'DABBOBA_STORAGE_S3_SECRET_ACCESS_KEY']) {
    if (key in values && !values[key]?.trim()) throw new Error(`Supabase Edge profile has an empty ${key}.`);
  }
  assertSupabaseEdgeReleaseConfiguration(values, { expectedCommerceMode });
  return values;
}

export function assertSupabaseLiveEdgeProfile(values) {
  const releaseConfiguration = assertSupabaseEdgeReleaseConfiguration(values, { expectedCommerceMode: 'LIVE' });
  validate(values, 'LIVE');
  for (const key of ['DABBOBA_STORAGE_S3_ACCESS_KEY_ID', 'DABBOBA_STORAGE_S3_SECRET_ACCESS_KEY']) {
    requiredLiveValue(values, key, 1);
  }
  return releaseConfiguration;
}

function atomicWrite(path, text) {
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    writeFileSync(descriptor, text, { encoding: 'utf8' });
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  privateFile(path);
}

export function prepareSupabaseEdgeProfile() {
  const rawSource = parseEnv(readFileSync(sourceFile, 'utf8'));
  const source = assertSupabaseIntegrationSource(rawSource);
  const integration = assertSupabaseIntegrationSecrets(parsePrivate(integrationFile));
  const external = edgeExternalValuesFromSource(rawSource);
  if (!existsSync(SUPABASE_PRODUCTION_WORKER_CREDENTIAL_FILE)) {
    throw new Error('Verified production worker credential has not been provisioned.');
  }
  const workerCredential = assertProductionWorkerCredential(
    parsePrivate(SUPABASE_PRODUCTION_WORKER_CREDENTIAL_FILE),
    source.DATABASE_URL,
  );
  try {
    const existing = parsePrivate(SUPABASE_EDGE_PROFILE_FILE);
    if (
      existing.DABBOBA_WORKER_DATABASE_URL !== workerCredential.DABBOBA_WORKER_DATABASE_URL
      || existing.DABBOBA_WORKER_INVOKE_SECRET !== workerCredential.DABBOBA_WORKER_INVOKE_SECRET
    ) throw new Error('Production worker credential differs from the release profile.');
    let changed = false;
    if (!existing.DABBOBA_API_WEB_ORIGINS || !existing.DABBOBA_API_CATALOG_MEDIA_BASE_URL) {
      existing.DABBOBA_API_WEB_ORIGINS = `https://${SUPABASE_INTEGRATION_PROJECT_REF}.supabase.co`;
      existing.DABBOBA_API_CATALOG_MEDIA_BASE_URL = `https://${SUPABASE_INTEGRATION_PROJECT_REF}.supabase.co/functions/v1/dabboba-api`;
      changed = true;
    }
    if (!existing.DABBOBA_API_COMMERCE_MODE) {
      existing.DABBOBA_API_COMMERCE_MODE = 'PRELAUNCH';
      changed = true;
    }
    if (!existing.DABBOBA_API_SUPABASE_JWT_AUDIENCE) {
      existing.DABBOBA_API_SUPABASE_JWT_AUDIENCE = 'authenticated';
      changed = true;
    }
    for (const [key, value] of Object.entries(external)) {
      if (!existing[key]) {
        existing[key] = value;
        changed = true;
      }
    }
    const validated = validate(existing);
    if (changed) atomicWrite(SUPABASE_EDGE_PROFILE_FILE, serializeSupabaseEdgeProfile(validated));
    return validated;
  } catch (error) {
    if (!error || typeof error !== 'object' || error.code !== 'ENOENT') throw error;
  }

  const values = validate({
    DABBOBA_ENVIRONMENT_TIER: 'PRODUCTION',
    DABBOBA_API_DATABASE_URL: databaseUrl(source.DATABASE_URL, 'dabboba_runtime', '6543'),
    DABBOBA_API_SESSION_TOKEN_PEPPER: integration.SESSION_TOKEN_PEPPER,
    DABBOBA_API_WEB_ORIGINS: `https://${SUPABASE_INTEGRATION_PROJECT_REF}.supabase.co`,
    DABBOBA_API_PAYMENT_PROVIDER: 'UNCONFIGURED',
    DABBOBA_API_COMMERCE_MODE: 'PRELAUNCH',
    DABBOBA_API_SUPABASE_JWT_AUDIENCE: 'authenticated',
    DABBOBA_API_LOG_LEVEL: 'info',
    DABBOBA_API_CATALOG_MEDIA_BASE_URL: `https://${SUPABASE_INTEGRATION_PROJECT_REF}.supabase.co/functions/v1/dabboba-api`,
    ...workerCredential,
    DABBOBA_ENABLE_PRODUCTION_WORKER: 'true',
    DABBOBA_STORAGE_BUCKET: 'dabboba-media',
    DABBOBA_STORAGE_S3_ENDPOINT: `https://${SUPABASE_INTEGRATION_PROJECT_REF}.storage.supabase.co/storage/v1/s3`,
    DABBOBA_STORAGE_S3_REGION: 'ap-northeast-2',
    ...external,
  });
  atomicWrite(SUPABASE_EDGE_PROFILE_FILE, serializeSupabaseEdgeProfile(values));
  return values;
}

async function readOneLine() {
  process.stdin.setEncoding('utf8');
  let value = '';
  for await (const chunk of process.stdin) {
    value += chunk;
    if (Buffer.byteLength(value, 'utf8') > 4096) throw new Error('Secret input is too large.');
  }
  value = value.replace(/[\r\n]+$/, '');
  if (!value || /[\r\n]/.test(value)) throw new Error('Secret input must be one non-empty line.');
  return value;
}

async function main() {
  const command = process.argv[2] ?? '--prepare';
  const values = prepareSupabaseEdgeProfile();
  if (command === '--prepare') {
    process.stdout.write(`Prepared private Supabase Edge profile at ${SUPABASE_EDGE_PROFILE_FILE}.\n`);
    return;
  }
  if (command === '--emit-worker-password') {
    process.stdout.write(`${new URL(values.DABBOBA_WORKER_DATABASE_URL).password}\n`);
    return;
  }
  if (command === '--set-s3-access-key-id' || command === '--set-s3-secret-access-key') {
    const value = await readOneLine();
    const key = command === '--set-s3-access-key-id'
      ? 'DABBOBA_STORAGE_S3_ACCESS_KEY_ID'
      : 'DABBOBA_STORAGE_S3_SECRET_ACCESS_KEY';
    values[key] = value;
    validate(values);
    atomicWrite(SUPABASE_EDGE_PROFILE_FILE, serializeSupabaseEdgeProfile(values));
    process.stdout.write(`Stored ${key} in the private Supabase Edge profile.\n`);
    return;
  }
  throw new Error('Usage: prepare-supabase-edge-profile.mjs [--prepare|--emit-worker-password|--set-s3-access-key-id|--set-s3-secret-access-key]');
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(() => {
    process.stderr.write('Could not prepare the private Supabase Edge profile.\n');
    process.exitCode = 1;
  });
}
