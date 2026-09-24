import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
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
  LOCAL_BACKEND_PORTS,
  LOCAL_BACKEND_PROFILE,
  localAdminEnvironment,
  localApiEnvironment,
  localWorkerEnvironment,
} from './local-backend-profile.mjs';

export const SUPABASE_INTEGRATION_PROFILE = 'supabase-integration';
export const SUPABASE_DEMO_PROFILE = 'supabase-demo';
export const SUPABASE_INTEGRATION_PROJECT_REF = 'rconfxsykttfvznakile';
// TEST_PG remains bound to the historical QA project and must never target production.
export const SUPABASE_DEMO_PROJECT_REF = 'yxkmvgfruphgghowzvmo';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const launchDirectory = resolve(repositoryRoot, '../.dabboba-launch');
export const BACKEND_PROFILE_SELECTION_FILE = resolve(launchDirectory, 'backend-profile');
export const SUPABASE_INTEGRATION_SECRETS_FILE = resolve(launchDirectory, 'supabase-integration.env');
export const SUPABASE_DEMO_SECRETS_FILE = resolve(launchDirectory, 'supabase-demo.env');
export const SUPABASE_INTEGRATION_SOURCE_FILE = resolve(repositoryRoot, '.env');

const SYSTEM_ENV_ALLOWLIST = [
  'PATH', 'HOME', 'TMPDIR', 'SHELL', 'USER', 'LOGNAME', 'LANG', 'LC_ALL',
  'TERM', 'COLORTERM', 'FORCE_COLOR', 'NO_COLOR', 'COREPACK_HOME',
];
const SECRET_KEYS = Object.freeze([
  'SESSION_TOKEN_PEPPER',
  'ADMIN_PROXY_IDENTITY_SECRET',
]);

function systemEnvironment(hostEnv) {
  const result = {};
  for (const key of SYSTEM_ENV_ALLOWLIST) {
    if (typeof hostEnv[key] === 'string') result[key] = hostEnv[key];
  }
  return result;
}

function sourceError() {
  return new Error('Supabase integration source settings are missing or do not match the approved DABBOBA project and runtime role.');
}

export function assertSupabaseIntegrationSource(source, expectedProjectRef = SUPABASE_INTEGRATION_PROJECT_REF) {
  let database;
  let supabase;
  try {
    database = new URL(source.DATABASE_URL);
    supabase = new URL(source.SUPABASE_URL);
  } catch {
    throw sourceError();
  }
  const username = decodeURIComponent(database.username);
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol)
    || !database.hostname.endsWith('.pooler.supabase.com')
    || database.port !== '5432'
    || database.pathname !== '/postgres'
    || username !== `dabboba_runtime.${expectedProjectRef}`
    || !database.password
    || database.search
    || database.hash
    || supabase.protocol !== 'https:'
    || supabase.origin !== `https://${expectedProjectRef}.supabase.co`
    || supabase.pathname !== '/'
    || supabase.username
    || supabase.password
    || supabase.search
    || supabase.hash
  ) throw sourceError();
  return {
    DATABASE_URL: source.DATABASE_URL,
    SUPABASE_URL: supabase.origin,
  };
}

function assertPrivateFile(path) {
  const mode = statSync(path).mode & 0o777;
  if (mode !== 0o600) {
    throw new Error('Supabase integration secret settings must be readable only by the current user.');
  }
}

export function assertSupabaseIntegrationSecrets(secrets) {
  if (secrets.DABBOBA_BACKEND_PROFILE?.trim() !== SUPABASE_INTEGRATION_PROFILE) {
    throw new Error('Supabase integration secret settings do not match the selected profile.');
  }
  for (const key of SECRET_KEYS) {
    const value = secrets[key]?.trim();
    if (!value || Buffer.byteLength(value, 'utf8') < 32 || /(?:change-me|local-development)/i.test(value)) {
      throw new Error('Supabase integration secret settings are incomplete.');
    }
  }
  if (secrets.SESSION_TOKEN_PEPPER === secrets.ADMIN_PROXY_IDENTITY_SECRET) {
    throw new Error('Supabase integration secrets must be distinct.');
  }
  return secrets;
}

function readProfileFiles(sourceFile = SUPABASE_INTEGRATION_SOURCE_FILE, secretsFile = SUPABASE_INTEGRATION_SECRETS_FILE) {
  let sourceText;
  let secretsText;
  try {
    sourceText = readFileSync(sourceFile, 'utf8');
    assertPrivateFile(secretsFile);
    secretsText = readFileSync(secretsFile, 'utf8');
  } catch (error) {
    if (error instanceof Error && error.message.includes('readable only')) throw error;
    throw new Error('Supabase integration profile is not prepared. Select the local profile or prepare this profile explicitly.');
  }
  return {
    source: assertSupabaseIntegrationSource(parseEnv(sourceText)),
    secrets: assertSupabaseIntegrationSecrets(parseEnv(secretsText)),
  };
}

export function supabaseIntegrationApiEnvironment(
  hostEnv = process.env,
  files = readProfileFiles(),
) {
  const { source, secrets } = files;
  return {
    ...systemEnvironment(hostEnv),
    DABBOBA_BACKEND_PROFILE: SUPABASE_INTEGRATION_PROFILE,
    DABBOBA_ENVIRONMENT_TIER: 'STAGING',
    DABBOBA_RELEASE_ENVIRONMENT_TIER: 'STAGING',
    NODE_ENV: 'production',
    LOG_LEVEL: 'info',
    PAYMENT_PROVIDER: 'UNCONFIGURED',
    MEDIA_STORAGE_PROVIDER: 'gcs',
    API_HOST: '127.0.0.1',
    API_PORT: String(LOCAL_BACKEND_PORTS.api),
    PORT: String(LOCAL_BACKEND_PORTS.api),
    API_SURFACE: 'all',
    DATABASE_URL: source.DATABASE_URL,
    SUPABASE_URL: source.SUPABASE_URL,
    SESSION_TOKEN_PEPPER: secrets.SESSION_TOKEN_PEPPER,
    ADMIN_PROXY_IDENTITY_SECRET: secrets.ADMIN_PROXY_IDENTITY_SECRET,
    DATABASE_POOL_MAX: '5',
    WEB_ORIGINS: 'https://localhost:4174',
    ADMIN_ORIGINS: 'https://localhost:4180',
    SESSION_TTL_DAYS: '30',
  };
}

export function supabaseIntegrationAdminEnvironment(
  hostEnv = process.env,
  files = readProfileFiles(),
) {
  return {
    ...systemEnvironment(hostEnv),
    DABBOBA_BACKEND_PROFILE: SUPABASE_INTEGRATION_PROFILE,
    DABBOBA_ENVIRONMENT_TIER: 'LOCAL',
    NODE_ENV: 'development',
    DABBOBA_API_URL: `http://127.0.0.1:${LOCAL_BACKEND_PORTS.api}`,
    NEXT_PUBLIC_DABBOBA_API_URL: `http://127.0.0.1:${LOCAL_BACKEND_PORTS.api}`,
    ADMIN_SESSION_COOKIE_NAME: 'dabboba_admin_session',
    ADMIN_PROXY_IDENTITY_SECRET: files.secrets.ADMIN_PROXY_IDENTITY_SECRET,
    // Browsers do not supply this trusted ingress-only header locally, so login
    // stays fail-closed until a real admin edge and credential are configured.
    ADMIN_EDGE_CLIENT_IP_HEADER: 'x-dabboba-trusted-client-ip',
  };
}

function assertSupabaseDemoSecrets(secrets) {
  if (secrets.DABBOBA_BACKEND_PROFILE?.trim() !== SUPABASE_DEMO_PROFILE) {
    throw new Error('Supabase demo secret settings do not match the selected profile.');
  }
  for (const key of [...SECRET_KEYS, 'PAYMENT_WEBHOOK_SECRET']) {
    const value = secrets[key]?.trim();
    if (!value || Buffer.byteLength(value, 'utf8') < 32 || /(?:change-me|local-development)/i.test(value)) {
      throw new Error('Supabase demo secret settings are incomplete.');
    }
  }
  if (new Set([...SECRET_KEYS, 'PAYMENT_WEBHOOK_SECRET'].map((key) => secrets[key])).size !== 3) {
    throw new Error('Supabase demo secrets must be distinct.');
  }
  return secrets;
}

function readDemoProfileFiles(sourceFile = SUPABASE_INTEGRATION_SOURCE_FILE, secretsFile = SUPABASE_DEMO_SECRETS_FILE) {
  let sourceText;
  let secretsText;
  try {
    sourceText = readFileSync(sourceFile, 'utf8');
    assertPrivateFile(secretsFile);
    secretsText = readFileSync(secretsFile, 'utf8');
  } catch (error) {
    if (error instanceof Error && error.message.includes('readable only')) throw error;
    throw new Error('Supabase demo profile is not prepared. Select another profile or prepare it explicitly.');
  }
  return {
    source: assertSupabaseIntegrationSource(parseEnv(sourceText), SUPABASE_DEMO_PROJECT_REF),
    secrets: assertSupabaseDemoSecrets(parseEnv(secretsText)),
  };
}

export function supabaseDemoApiEnvironment(hostEnv = process.env, files = readDemoProfileFiles()) {
  const base = supabaseIntegrationApiEnvironment(hostEnv, {
    source: files.source,
    secrets: {
      ...files.secrets,
      DABBOBA_BACKEND_PROFILE: SUPABASE_INTEGRATION_PROFILE,
    },
  });
  return {
    ...base,
    DABBOBA_BACKEND_PROFILE: SUPABASE_DEMO_PROFILE,
    DABBOBA_COMMERCE_MODE: 'LIVE',
    PAYMENT_PROVIDER: 'TEST_PG',
    PAYMENT_WEBHOOK_SECRET: files.secrets.PAYMENT_WEBHOOK_SECRET,
    DABBOBA_ENABLE_DEMO_TESTING: 'true',
    DABBOBA_DEMO_FIXTURE_TAG: 'supabase-demo-v1',
  };
}

export function supabaseDemoAdminEnvironment(hostEnv = process.env, files = readDemoProfileFiles()) {
  const base = supabaseIntegrationAdminEnvironment(hostEnv, {
    source: files.source,
    secrets: {
      ...files.secrets,
      DABBOBA_BACKEND_PROFILE: SUPABASE_INTEGRATION_PROFILE,
    },
  });
  return { ...base, DABBOBA_BACKEND_PROFILE: SUPABASE_DEMO_PROFILE };
}

export function assertSupabaseDemoApiEnvironment(env) {
  if (
    env.DABBOBA_BACKEND_PROFILE !== SUPABASE_DEMO_PROFILE
    || env.DABBOBA_ENVIRONMENT_TIER !== 'STAGING'
    || env.DABBOBA_RELEASE_ENVIRONMENT_TIER !== 'STAGING'
    || env.NODE_ENV !== 'production'
    || env.DABBOBA_COMMERCE_MODE !== 'LIVE'
    || env.PAYMENT_PROVIDER !== 'TEST_PG'
    || env.DABBOBA_ENABLE_DEMO_TESTING !== 'true'
    || env.DABBOBA_DEMO_FIXTURE_TAG !== 'supabase-demo-v1'
  ) throw new Error('Supabase demo API settings do not match the approved profile.');
  assertSupabaseIntegrationSource(env, SUPABASE_DEMO_PROJECT_REF);
  assertSupabaseDemoSecrets(env);
  for (const key of [
    'DATABASE_MIGRATION_URL', 'WORKER_DATABASE_URL', 'DABBOBA_ENABLE_DEV_SESSION',
    'DABBOBA_ENABLE_MOBILE_TEST_FIXTURES', 'ALLOW_ADMIN_BOOTSTRAP',
    'REDIS_URL',
    'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SECRET_KEY', 'SUPABASE_STORAGE_SERVICE_KEY',
    'SUPABASE_STORAGE_S3_ACCESS_KEY_ID', 'SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY',
    'GCS_BUCKET', 'GCS_PROJECT_ID', 'GOOGLE_APPLICATION_CREDENTIALS',
    'NOTIFICATION_DELIVERY_URL', 'NOTIFICATION_DELIVERY_TOKEN',
  ]) {
    if (env[key]?.trim()) throw new Error('Supabase demo API settings contain an unapproved capability.');
  }
  return env;
}

export function assertSupabaseIntegrationApiEnvironment(env) {
  if (
    env.DABBOBA_BACKEND_PROFILE !== SUPABASE_INTEGRATION_PROFILE
    || env.DABBOBA_ENVIRONMENT_TIER !== 'STAGING'
    || env.DABBOBA_RELEASE_ENVIRONMENT_TIER !== 'STAGING'
    || env.NODE_ENV !== 'production'
    || env.PAYMENT_PROVIDER !== 'UNCONFIGURED'
    || env.API_HOST !== '127.0.0.1'
    || env.API_PORT !== String(LOCAL_BACKEND_PORTS.api)
    || env.PORT !== String(LOCAL_BACKEND_PORTS.api)
    || env.API_SURFACE !== 'all'
    || env.WEB_ORIGINS !== 'https://localhost:4174'
    || env.ADMIN_ORIGINS !== 'https://localhost:4180'
  ) throw new Error('Supabase integration API settings do not match the approved fail-closed profile.');
  assertSupabaseIntegrationSource(env);
  assertSupabaseIntegrationSecrets({
    DABBOBA_BACKEND_PROFILE: env.DABBOBA_BACKEND_PROFILE,
    SESSION_TOKEN_PEPPER: env.SESSION_TOKEN_PEPPER,
    ADMIN_PROXY_IDENTITY_SECRET: env.ADMIN_PROXY_IDENTITY_SECRET,
  });
  for (const key of [
    'DATABASE_MIGRATION_URL', 'WORKER_DATABASE_URL', 'DABBOBA_ENABLE_DEV_SESSION',
    'DABBOBA_ENABLE_MOBILE_TEST_FIXTURES', 'PAYMENT_WEBHOOK_SECRET',
    'ALLOW_ADMIN_BOOTSTRAP',
    'REDIS_URL',
    'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SECRET_KEY', 'SUPABASE_STORAGE_SERVICE_KEY',
    'SUPABASE_STORAGE_S3_ACCESS_KEY_ID', 'SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY',
    'GCS_BUCKET', 'GCS_PROJECT_ID', 'GOOGLE_APPLICATION_CREDENTIALS',
    'NOTIFICATION_DELIVERY_URL', 'NOTIFICATION_DELIVERY_TOKEN',
  ]) {
    if (env[key]?.trim()) throw new Error('Supabase integration API settings contain an unapproved capability.');
  }
  return env;
}

export function readSelectedBackendProfile(selectionFile = BACKEND_PROFILE_SELECTION_FILE) {
  let selected;
  try { selected = readFileSync(selectionFile, 'utf8').trim(); }
  catch (error) {
    if (error?.code === 'ENOENT') return LOCAL_BACKEND_PROFILE;
    throw new Error('The DABBOBA backend profile selection could not be read.');
  }
  if ([LOCAL_BACKEND_PROFILE, SUPABASE_INTEGRATION_PROFILE, SUPABASE_DEMO_PROFILE].includes(selected)) return selected;
  throw new Error('The DABBOBA backend profile selection is invalid.');
}

export function selectedApiEnvironment(hostEnv = process.env) {
  const profile = readSelectedBackendProfile();
  if (profile === SUPABASE_DEMO_PROFILE) return supabaseDemoApiEnvironment(hostEnv);
  if (profile === SUPABASE_INTEGRATION_PROFILE) return supabaseIntegrationApiEnvironment(hostEnv);
  return localApiEnvironment(hostEnv);
}

export function selectedAdminEnvironment(hostEnv = process.env) {
  const profile = readSelectedBackendProfile();
  if (profile === SUPABASE_DEMO_PROFILE) return supabaseDemoAdminEnvironment(hostEnv);
  if (profile === SUPABASE_INTEGRATION_PROFILE) return supabaseIntegrationAdminEnvironment(hostEnv);
  return localAdminEnvironment(hostEnv);
}

export function selectedWorkerEnvironment(hostEnv = process.env) {
  if (readSelectedBackendProfile() !== LOCAL_BACKEND_PROFILE) {
    throw new Error('Supabase-backed profiles never start a worker. Select local-development first.');
  }
  return localWorkerEnvironment(hostEnv);
}

export function selectedProfileNeedsLocalPreparation(profile = readSelectedBackendProfile()) {
  return profile === LOCAL_BACKEND_PROFILE;
}

function createSecretsFile(path) {
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    const profile = [
      `DABBOBA_BACKEND_PROFILE=${SUPABASE_INTEGRATION_PROFILE}`,
      `SESSION_TOKEN_PEPPER=${randomBytes(48).toString('base64url')}`,
      `ADMIN_PROXY_IDENTITY_SECRET=${randomBytes(48).toString('base64url')}`,
      '',
    ].join('\n');
    writeFileSync(descriptor, profile, { encoding: 'utf8' });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw new Error('Could not prepare private Supabase integration secrets.');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  assertPrivateFile(path);
  assertSupabaseIntegrationSecrets(parseEnv(readFileSync(path, 'utf8')));
}

function createDemoSecretsFile(path) {
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    const profile = [
      `DABBOBA_BACKEND_PROFILE=${SUPABASE_DEMO_PROFILE}`,
      `SESSION_TOKEN_PEPPER=${randomBytes(48).toString('base64url')}`,
      `ADMIN_PROXY_IDENTITY_SECRET=${randomBytes(48).toString('base64url')}`,
      `PAYMENT_WEBHOOK_SECRET=${randomBytes(48).toString('base64url')}`,
      '',
    ].join('\n');
    writeFileSync(descriptor, profile, { encoding: 'utf8' });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw new Error('Could not prepare private Supabase demo secrets.');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  assertPrivateFile(path);
  return assertSupabaseDemoSecrets(parseEnv(readFileSync(path, 'utf8')));
}

function writeSelectionFile(path, profile) {
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    writeFileSync(descriptor, `${profile}\n`, { encoding: 'utf8' });
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
  } catch {
    if (descriptor !== undefined) closeSync(descriptor);
    throw new Error('Could not persist the DABBOBA backend profile selection.');
  }
}

export function configureBackendProfile(
  profile,
  paths = {
    sourceFile: SUPABASE_INTEGRATION_SOURCE_FILE,
    secretsFile: SUPABASE_INTEGRATION_SECRETS_FILE,
    selectionFile: BACKEND_PROFILE_SELECTION_FILE,
  },
) {
  if (profile === SUPABASE_INTEGRATION_PROFILE || profile === SUPABASE_DEMO_PROFILE) {
    let sourceText;
    try { sourceText = readFileSync(paths.sourceFile, 'utf8'); }
    catch { throw new Error('Supabase integration source settings could not be read.'); }
    const source = assertSupabaseIntegrationSource(
      parseEnv(sourceText),
      profile === SUPABASE_DEMO_PROFILE ? SUPABASE_DEMO_PROJECT_REF : SUPABASE_INTEGRATION_PROJECT_REF,
    );
    if (profile === SUPABASE_DEMO_PROFILE) {
      const secrets = createDemoSecretsFile(paths.secretsFile);
      assertSupabaseDemoApiEnvironment(supabaseDemoApiEnvironment({}, { source, secrets }));
    } else {
      createSecretsFile(paths.secretsFile);
      const secrets = assertSupabaseIntegrationSecrets(parseEnv(readFileSync(paths.secretsFile, 'utf8')));
      assertSupabaseIntegrationApiEnvironment(supabaseIntegrationApiEnvironment({}, { source, secrets }));
    }
  } else if (profile !== LOCAL_BACKEND_PROFILE) {
    throw new Error('Only local-development, supabase-integration, or supabase-demo can be selected.');
  }
  if (dirname(paths.secretsFile) !== dirname(paths.selectionFile)) {
    throw new Error('Backend profile files must stay in one private launcher directory.');
  }
  writeSelectionFile(paths.selectionFile, profile);
  return profile;
}
