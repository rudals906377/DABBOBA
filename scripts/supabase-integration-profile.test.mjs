import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { LOCAL_BACKEND_PROFILE } from './local-backend-profile.mjs';
import {
  SUPABASE_DEMO_PROFILE,
  SUPABASE_DEMO_PROJECT_REF,
  SUPABASE_INTEGRATION_PROFILE,
  SUPABASE_INTEGRATION_PROJECT_REF,
  assertSupabaseDemoApiEnvironment,
  assertSupabaseIntegrationApiEnvironment,
  assertSupabaseIntegrationSource,
  configureBackendProfile,
  readSelectedBackendProfile,
  selectedProfileNeedsLocalPreparation,
  supabaseDemoApiEnvironment,
  supabaseIntegrationAdminEnvironment,
  supabaseIntegrationApiEnvironment,
} from './supabase-integration-profile.mjs';

const source = {
  DATABASE_URL: `postgresql://dabboba_runtime.${SUPABASE_INTEGRATION_PROJECT_REF}:fixture-password@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres`,
  SUPABASE_URL: `https://${SUPABASE_INTEGRATION_PROJECT_REF}.supabase.co`,
};
const demoSource = {
  DATABASE_URL: `postgresql://dabboba_runtime.${SUPABASE_DEMO_PROJECT_REF}:fixture-password@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres`,
  SUPABASE_URL: `https://${SUPABASE_DEMO_PROJECT_REF}.supabase.co`,
};
const secrets = {
  DABBOBA_BACKEND_PROFILE: SUPABASE_INTEGRATION_PROFILE,
  SESSION_TOKEN_PEPPER: 'integration-session-pepper-at-least-32-bytes',
  ADMIN_PROXY_IDENTITY_SECRET: 'integration-admin-proxy-secret-at-least-32-bytes',
};
const demoSecrets = {
  DABBOBA_BACKEND_PROFILE: SUPABASE_DEMO_PROFILE,
  SESSION_TOKEN_PEPPER: 'demo-session-pepper-at-least-32-bytes',
  ADMIN_PROXY_IDENTITY_SECRET: 'demo-admin-proxy-secret-at-least-32-bytes',
  PAYMENT_WEBHOOK_SECRET: 'demo-payment-webhook-secret-at-least-32-bytes',
};

test('approved session-pooler runtime role and project are required', () => {
  assert.deepEqual(assertSupabaseIntegrationSource(source), source);
  for (const invalid of [
    { ...source, DATABASE_URL: source.DATABASE_URL.replace(':5432/', ':6543/') },
    { ...source, DATABASE_URL: source.DATABASE_URL.replace('dabboba_runtime.', 'postgres.') },
    { ...source, DATABASE_URL: source.DATABASE_URL.replace('.pooler.supabase.com', '.example.test') },
    { ...source, DATABASE_URL: source.DATABASE_URL.replace('/postgres', '/other') },
    { ...source, SUPABASE_URL: source.SUPABASE_URL.replace(SUPABASE_INTEGRATION_PROJECT_REF, 'otherprojectref123456') },
  ]) assert.throws(() => assertSupabaseIntegrationSource(invalid));
});

test('API profile copies only approved connection data and generated secrets', () => {
  const env = supabaseIntegrationApiEnvironment(
    {
      PATH: '/usr/bin',
      DATABASE_MIGRATION_URL: 'must-not-leak',
      WORKER_DATABASE_URL: 'must-not-leak',
      SESSION_TOKEN_PEPPER: 'placeholder-must-not-leak',
      DABBOBA_ENABLE_DEV_SESSION: 'true',
      DABBOBA_ENABLE_MOBILE_TEST_FIXTURES: 'true',
      SUPABASE_STORAGE_SERVICE_KEY: 'must-not-leak',
      EXPO_PUBLIC_SUPABASE_URL: source.SUPABASE_URL,
      REDIS_URL: 'redis://must-not-leak:6379',
      PAYMENT_WEBHOOK_SECRET: 'must-not-leak',
      ALLOW_ADMIN_BOOTSTRAP: 'true',
    },
    { source, secrets },
  );
  assert.doesNotThrow(() => assertSupabaseIntegrationApiEnvironment(env));
  assert.equal(env.NODE_ENV, 'production');
  assert.equal(env.DABBOBA_ENVIRONMENT_TIER, 'STAGING');
  assert.equal(env.DATABASE_URL, source.DATABASE_URL);
  assert.equal(env.SESSION_TOKEN_PEPPER, secrets.SESSION_TOKEN_PEPPER);
  assert.equal(env.DATABASE_MIGRATION_URL, undefined);
  assert.equal(env.WORKER_DATABASE_URL, undefined);
  assert.equal(env.DABBOBA_ENABLE_DEV_SESSION, undefined);
  assert.equal(env.DABBOBA_ENABLE_MOBILE_TEST_FIXTURES, undefined);
  assert.equal(env.SUPABASE_STORAGE_SERVICE_KEY, undefined);
  assert.equal(env.EXPO_PUBLIC_SUPABASE_URL, undefined);
  assert.equal(env.REDIS_URL, undefined);
  assert.equal(env.PAYMENT_WEBHOOK_SECRET, undefined);
  assert.equal(env.ALLOW_ADMIN_BOOTSTRAP, undefined);
  assert.throws(() => assertSupabaseIntegrationApiEnvironment({ ...env, ALLOW_ADMIN_BOOTSTRAP: 'true' }));
});

test('explicit demo profile adds only TEST_PG and fixed demo capability settings', () => {
  const env = supabaseDemoApiEnvironment({
    ALLOW_ADMIN_BOOTSTRAP: 'true',
    DABBOBA_ENABLE_DEV_SESSION: 'true',
    SUPABASE_SERVICE_ROLE_KEY: 'must-not-leak',
    REDIS_URL: 'redis://must-not-leak:6379',
  }, { source: demoSource, secrets: demoSecrets });
  assert.doesNotThrow(() => assertSupabaseDemoApiEnvironment(env));
  assert.equal(env.DABBOBA_BACKEND_PROFILE, SUPABASE_DEMO_PROFILE);
  assert.equal(env.DABBOBA_COMMERCE_MODE, 'LIVE');
  assert.equal(env.PAYMENT_PROVIDER, 'TEST_PG');
  assert.equal(env.DABBOBA_ENABLE_DEMO_TESTING, 'true');
  assert.equal(env.DABBOBA_DEMO_FIXTURE_TAG, 'supabase-demo-v1');
  assert.equal(env.ALLOW_ADMIN_BOOTSTRAP, undefined);
  assert.equal(env.DABBOBA_ENABLE_DEV_SESSION, undefined);
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(env.REDIS_URL, undefined);
  assert.throws(() => assertSupabaseDemoApiEnvironment({ ...env, DABBOBA_ENVIRONMENT_TIER: 'PRODUCTION' }));
  assert.throws(() => assertSupabaseDemoApiEnvironment({ ...env, DABBOBA_COMMERCE_MODE: 'PRELAUNCH' }));
  assert.throws(() => assertSupabaseDemoApiEnvironment({ ...env, ALLOW_ADMIN_BOOTSTRAP: 'true' }));
  assert.throws(() => assertSupabaseDemoApiEnvironment({ ...env, DATABASE_URL: source.DATABASE_URL, SUPABASE_URL: source.SUPABASE_URL }));
});

test('admin profile points at the same loopback API without database or mobile auth settings', () => {
  const env = supabaseIntegrationAdminEnvironment(
    { PATH: '/usr/bin', DATABASE_URL: 'must-not-leak', EXPO_PUBLIC_SUPABASE_URL: source.SUPABASE_URL },
    { source, secrets },
  );
  assert.equal(env.DABBOBA_API_URL, 'http://127.0.0.1:8788');
  assert.equal(env.NEXT_PUBLIC_DABBOBA_API_URL, env.DABBOBA_API_URL);
  assert.equal(env.ADMIN_PROXY_IDENTITY_SECRET, secrets.ADMIN_PROXY_IDENTITY_SECRET);
  assert.equal(env.ADMIN_EDGE_CLIENT_IP_HEADER, 'x-dabboba-trusted-client-ip');
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.EXPO_PUBLIC_SUPABASE_URL, undefined);
});

test('missing selector keeps the existing isolated local profile', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dabboba-profile-selector-'));
  try {
    const selection = join(directory, 'backend-profile');
    assert.equal(readSelectedBackendProfile(selection), LOCAL_BACKEND_PROFILE);
    assert.equal(selectedProfileNeedsLocalPreparation(readSelectedBackendProfile(selection)), true);
    await writeFile(selection, `${SUPABASE_INTEGRATION_PROFILE}\n`, { mode: 0o600 });
    assert.equal(readSelectedBackendProfile(selection), SUPABASE_INTEGRATION_PROFILE);
    assert.equal(selectedProfileNeedsLocalPreparation(readSelectedBackendProfile(selection)), false);
    await writeFile(selection, `${SUPABASE_DEMO_PROFILE}\n`, { mode: 0o600 });
    assert.equal(readSelectedBackendProfile(selection), SUPABASE_DEMO_PROFILE);
    assert.equal(selectedProfileNeedsLocalPreparation(readSelectedBackendProfile(selection)), false);
    await writeFile(selection, 'unknown\n', { mode: 0o600 });
    assert.throws(() => readSelectedBackendProfile(selection));
  } finally { await rm(directory, { recursive: true }); }
});

test('demo preparation creates three distinct private secrets once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dabboba-supabase-demo-profile-'));
  const paths = {
    sourceFile: join(directory, '.env'),
    secretsFile: join(directory, 'supabase-demo.env'),
    selectionFile: join(directory, 'backend-profile'),
  };
  try {
    await writeFile(paths.sourceFile, `DATABASE_URL=${demoSource.DATABASE_URL}\nSUPABASE_URL=${demoSource.SUPABASE_URL}\n`);
    assert.equal(configureBackendProfile(SUPABASE_DEMO_PROFILE, paths), SUPABASE_DEMO_PROFILE);
    const first = await readFile(paths.secretsFile, 'utf8');
    const parsed = parseEnv(first);
    assert.equal(parsed.DABBOBA_BACKEND_PROFILE, SUPABASE_DEMO_PROFILE);
    assert.equal(new Set([parsed.SESSION_TOKEN_PEPPER, parsed.ADMIN_PROXY_IDENTITY_SECRET, parsed.PAYMENT_WEBHOOK_SECRET]).size, 3);
    assert.equal((await stat(paths.secretsFile)).mode & 0o777, 0o600);
    configureBackendProfile(SUPABASE_DEMO_PROFILE, paths);
    assert.equal(await readFile(paths.secretsFile, 'utf8'), first);
  } finally { await rm(directory, { recursive: true }); }
});

test('the production project cannot be selected for TEST_PG demo commerce', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dabboba-production-demo-guard-'));
  const paths = {
    sourceFile: join(directory, '.env'),
    secretsFile: join(directory, 'supabase-demo.env'),
    selectionFile: join(directory, 'backend-profile'),
  };
  try {
    await writeFile(paths.sourceFile, `DATABASE_URL=${source.DATABASE_URL}\nSUPABASE_URL=${source.SUPABASE_URL}\n`);
    assert.throws(() => configureBackendProfile(SUPABASE_DEMO_PROFILE, paths));
    await assert.rejects(readFile(paths.selectionFile, 'utf8'));
  } finally { await rm(directory, { recursive: true }); }
});

test('explicit preparation creates private secrets once and never overwrites them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dabboba-supabase-profile-'));
  const paths = {
    sourceFile: join(directory, '.env'),
    secretsFile: join(directory, 'supabase-integration.env'),
    selectionFile: join(directory, 'backend-profile'),
  };
  try {
    await writeFile(paths.sourceFile, `DATABASE_URL=${source.DATABASE_URL}\nSUPABASE_URL=${source.SUPABASE_URL}\nSESSION_TOKEN_PEPPER=unsafe-placeholder\nDABBOBA_ENABLE_DEV_SESSION=true\n`);
    assert.equal(configureBackendProfile(SUPABASE_INTEGRATION_PROFILE, paths), SUPABASE_INTEGRATION_PROFILE);
    const firstSecrets = await readFile(paths.secretsFile, 'utf8');
    const parsed = parseEnv(firstSecrets);
    assert.notEqual(parsed.SESSION_TOKEN_PEPPER, 'unsafe-placeholder');
    assert.ok(parsed.SESSION_TOKEN_PEPPER.length >= 32);
    assert.ok(parsed.ADMIN_PROXY_IDENTITY_SECRET.length >= 32);
    assert.notEqual(parsed.SESSION_TOKEN_PEPPER, parsed.ADMIN_PROXY_IDENTITY_SECRET);
    assert.equal((await stat(paths.secretsFile)).mode & 0o777, 0o600);
    assert.equal((await stat(paths.selectionFile)).mode & 0o777, 0o600);

    configureBackendProfile(SUPABASE_INTEGRATION_PROFILE, paths);
    assert.equal(await readFile(paths.secretsFile, 'utf8'), firstSecrets);
    assert.equal(await readFile(paths.selectionFile, 'utf8'), `${SUPABASE_INTEGRATION_PROFILE}\n`);

    await chmod(paths.secretsFile, 0o644);
    assert.throws(() => configureBackendProfile(SUPABASE_INTEGRATION_PROFILE, paths), /current user/);
  } finally { await rm(directory, { recursive: true }); }
});

test('invalid source never selects Supabase or creates integration secrets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dabboba-invalid-profile-'));
  const paths = {
    sourceFile: join(directory, '.env'),
    secretsFile: join(directory, 'supabase-integration.env'),
    selectionFile: join(directory, 'backend-profile'),
  };
  try {
    await writeFile(paths.sourceFile, 'DATABASE_URL=postgresql://bad.example.test/postgres\nSUPABASE_URL=https://bad.example.test\n');
    assert.throws(() => configureBackendProfile(SUPABASE_INTEGRATION_PROFILE, paths));
    await assert.rejects(readFile(paths.secretsFile, 'utf8'));
    await assert.rejects(readFile(paths.selectionFile, 'utf8'));
  } finally { await rm(directory, { recursive: true }); }
});
