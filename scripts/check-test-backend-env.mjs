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

function databaseIdentity(value) {
  const parsed = new URL(value);
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname) ? 'loopback' : hostname;
  return `${loopback}:${parsed.port || '5432'}:${decodeURIComponent(parsed.pathname.slice(1))}`;
}

export function assertTestBackendEnvironment(env) {
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
  const roleTestUrls = [
    env.DABBOBA_TEST_DATABASE_URL,
    env.DABBOBA_RUNTIME_TEST_DATABASE_URL,
    env.DABBOBA_WORKER_TEST_DATABASE_URL,
  ].map((value) => value?.trim()).filter(Boolean);
  if (roleTestUrls.length === 3 && new Set(roleTestUrls.map(databaseIdentity)).size !== 1) {
    throw new Error('Owner, runtime, and worker test URLs must identify the same local database.');
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
    assertTestBackendEnvironment(process.env);
  } catch {
    process.stderr.write('Test execution blocked: database tier, target, or provider environment is not local-test safe.\n');
    process.exit(78);
  }
}
