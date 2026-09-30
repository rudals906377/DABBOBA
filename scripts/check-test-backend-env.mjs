#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

function assertLoopbackUrl(value, key, protocols) {
  let parsed;
  try { parsed = new URL(value); }
  catch { throw new Error(`${key} must be a valid URL.`); }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  const isHttp = protocols.includes('http:');
  if (!protocols.includes(parsed.protocol) || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname)
      || (isHttp && (parsed.username || parsed.password)) || parsed.search || parsed.hash) {
    throw new Error(`${key} must use a query-free loopback test target.`);
  }
}

// Integration suites insert and delete rows, so they may only target a database
// whose name marks it as disposable (dabboba_ci, dabboba_edge_test,
// dabboba_flow_test_20260924, ...). Preserved databases such as
// dabboba_development or dabboba are refused even on loopback.
const DISPOSABLE_TEST_DATABASE = /^dabboba(?:_[a-z0-9]+)*_(?:ci|test)(?:_[a-z0-9]+)*$/;

export function isDisposableTestDatabaseName(name) {
  return DISPOSABLE_TEST_DATABASE.test(name);
}

function assertDisposableTestDatabase(value, key) {
  const name = decodeURIComponent(new URL(value).pathname.slice(1));
  if (!isDisposableTestDatabaseName(name)) {
    throw new Error(`${key} must name a disposable test database (dabboba_…_ci or dabboba_…_test).`);
  }
}

function databaseIdentity(value) {
  const parsed = new URL(value);
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname) ? 'loopback' : hostname;
  return `${loopback}:${parsed.port || '5432'}:${decodeURIComponent(parsed.pathname.slice(1))}`;
}

export function assertTestBackendEnvironment(env, { requireIntegrationDatabase = false } = {}) {
  if (env.DABBOBA_ENVIRONMENT_TIER?.trim() && env.DABBOBA_ENVIRONMENT_TIER.trim() !== 'TEST') {
    throw new Error('Test commands require DABBOBA_ENVIRONMENT_TIER=TEST when the tier is set.');
  }
  for (const key of [
    'DABBOBA_TEST_DATABASE_URL', 'DABBOBA_RUNTIME_TEST_DATABASE_URL',
    'DABBOBA_WORKER_TEST_DATABASE_URL', 'DATABASE_MIGRATION_URL',
    'DATABASE_URL', 'WORKER_DATABASE_URL',
  ]) {
    if (env[key]?.trim()) assertLoopbackUrl(env[key], key, ['postgres:', 'postgresql:']);
  }
  for (const key of [
    'DABBOBA_TEST_DATABASE_URL', 'DABBOBA_RUNTIME_TEST_DATABASE_URL',
    'DABBOBA_WORKER_TEST_DATABASE_URL', 'DATABASE_MIGRATION_URL',
  ]) {
    if (env[key]?.trim()) assertDisposableTestDatabase(env[key], key);
  }
  const roleTestUrls = [
    env.DABBOBA_TEST_DATABASE_URL,
    env.DABBOBA_RUNTIME_TEST_DATABASE_URL,
    env.DABBOBA_WORKER_TEST_DATABASE_URL,
  ].map((value) => value?.trim()).filter(Boolean);
  if (roleTestUrls.length === 3 && new Set(roleTestUrls.map(databaseIdentity)).size !== 1) {
    throw new Error('Owner, runtime, and worker test URLs must identify the same local database.');
  }
  if (requireIntegrationDatabase) {
    for (const key of [
      'DABBOBA_TEST_DATABASE_URL',
      'DABBOBA_RUNTIME_TEST_DATABASE_URL',
      'DABBOBA_WORKER_TEST_DATABASE_URL',
      'DATABASE_MIGRATION_URL',
    ]) {
      if (!env[key]?.trim()) throw new Error(`${key} is required for database integration tests.`);
    }
    const requiredDatabaseUrls = [
      env.DABBOBA_TEST_DATABASE_URL,
      env.DABBOBA_RUNTIME_TEST_DATABASE_URL,
      env.DABBOBA_WORKER_TEST_DATABASE_URL,
      env.DATABASE_MIGRATION_URL,
    ];
    if (new Set(requiredDatabaseUrls.map(databaseIdentity)).size !== 1) {
      throw new Error('Owner, runtime, worker, and migration URLs must identify the same local database.');
    }
    if (env.DABBOBA_ENVIRONMENT_TIER?.trim() !== 'TEST') {
      throw new Error('DABBOBA_ENVIRONMENT_TIER=TEST is required for database integration tests.');
    }
  }
  for (const key of ['SUPABASE_URL', 'SUPABASE_STORAGE_S3_ENDPOINT', 'NOTIFICATION_DELIVERY_URL']) {
    if (env[key]?.trim()) assertLoopbackUrl(env[key], key, ['http:', 'https:']);
  }
  for (const key of ['GCS_BUCKET', 'GCS_PROJECT_ID', 'GOOGLE_APPLICATION_CREDENTIALS']) {
    if (env[key]?.trim()) throw new Error(`${key} is not allowed in the local test environment.`);
  }
  for (const key of [
    'KG_INICIS_ENVIRONMENT', 'KG_INICIS_MID', 'KG_INICIS_INIAPI_KEY', 'KG_INICIS_CLIENT_IP',
  ]) {
    if (env[key]?.trim()) throw new Error(`${key} is not allowed in the local test environment.`);
  }
  const reconciliationProvider = env.PAYMENT_RECONCILIATION_PROVIDER?.trim();
  if (reconciliationProvider && reconciliationProvider !== 'MANUAL_REVIEW') {
    throw new Error('PAYMENT_RECONCILIATION_PROVIDER must be MANUAL_REVIEW in the local test environment.');
  }
  const paymentProvider = env.PAYMENT_PROVIDER?.trim();
  if (paymentProvider && paymentProvider !== 'UNCONFIGURED' && paymentProvider !== 'INTERNAL_ZERO'
      && !/^(?:LOCAL|TEST)_/.test(paymentProvider)) {
    throw new Error('PAYMENT_PROVIDER must be disabled or identify a local test fixture.');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const arguments_ = process.argv.slice(2);
    if (arguments_.some((argument) => argument !== '--require-integration-db')) {
      throw new Error('Unknown test preflight option.');
    }
    assertTestBackendEnvironment(process.env, {
      requireIntegrationDatabase: arguments_.includes('--require-integration-db'),
    });
  } catch {
    process.stderr.write('Test execution blocked: required local database roles are missing or the test environment is unsafe.\n');
    process.exit(78);
  }
}
