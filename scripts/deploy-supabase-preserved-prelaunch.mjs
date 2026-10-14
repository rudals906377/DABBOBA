// Code-only deployment to the existing production project. Never reads,
// rewrites, rotates or uploads remote secrets; LIVE cutover uses its own gate.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { checkDatabaseReleaseSource } from './check-database-release-source.mjs';
import { defaultReleaseCheck } from './supabase-edge-release-preflight.mjs';
import { SUPABASE_INTEGRATION_PROJECT_REF as PROJECT, assertSupabaseIntegrationSource } from './supabase-integration-profile.mjs';
import { assertProductionWorkerCredential, LIVE_PAYMENT_PROFILE_KEYS, PAYMENT_REVIEW_EDGE_KEYS, STORE_REVIEW_EDGE_KEYS } from './prepare-supabase-edge-profile.mjs';
import { run, supabase, supabaseCommandArgs, verifySupabaseTargetProjectAccess } from './deploy-supabase-edge.mjs';
import { verifyMobilePublicApiSurface } from './verify-public-edge-surface.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const apiBaseUrl = `https://${PROJECT}.supabase.co/functions/v1/dabboba-api`;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const requiredOpaque = [
  'DABBOBA_API_SESSION_TOKEN_PEPPER', 'DABBOBA_STORAGE_S3_ACCESS_KEY_ID',
  'DABBOBA_STORAGE_S3_SECRET_ACCESS_KEY', 'DABBOBA_API_SUPABASE_PUBLISHABLE_KEY',
  'DABBOBA_ADMIN_PROXY_IDENTITY_SECRET', 'DABBOBA_ADMIN_SERVICE_SECRET',
];

export function secretDigests() {
  const result = spawnSync('npx', supabaseCommandArgs('secrets', 'list', '--project-ref', PROJECT, '--output', 'json'), {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  let values;
  try { values = JSON.parse(result.stdout); } catch {}
  if (result.status !== 0 || !Array.isArray(values)
    || values.some((v) => typeof v.name !== 'string' || !/^[a-f0-9]{64}$/.test(v.value))) {
    throw new Error('Cannot verify existing production secret digests.');
  }
  return Object.fromEntries(values.map((v) => [v.name, v.value]));
}

export function assertPreservedPrelaunch(digests, knownValues) {
  for (const [name, value] of Object.entries(knownValues)) {
    if (!value || digests[name] !== sha256(value)) throw new Error(`Existing production setting does not match: ${name}`);
  }
  for (const name of requiredOpaque) {
    if (!/^[a-f0-9]{64}$/.test(digests[name] ?? '')) throw new Error(`Missing existing production setting: ${name}`);
  }
  for (const name of [...LIVE_PAYMENT_PROFILE_KEYS, ...PAYMENT_REVIEW_EDGE_KEYS, ...STORE_REVIEW_EDGE_KEYS]) {
    if (name in digests) throw new Error('Payment or reviewer credentials require the full deployment profile.');
  }
  for (const [name, value] of Object.entries({
    DABBOBA_ENABLE_PRODUCTION_WORKER: 'false', WORKER_INVENTORY_STORAGE_EXPIRY_MODE: 'DISABLED',
    WORKER_COMMERCE_RETENTION_MODE: 'DISABLED', DABBOBA_PHONE_LOGIN_READY: 'false',
  })) {
    if (name in digests && digests[name] !== sha256(value)) throw new Error(`Code-only deployment cannot enable ${name}.`);
  }
}

export function assertUnchangedSecrets(before, after) {
  const canonical = (values) => JSON.stringify(Object.entries(values)
    .filter(([name]) => !name.startsWith('SUPABASE_')).sort(([a], [b]) => a.localeCompare(b)));
  if (canonical(before) !== canonical(after)) throw new Error('Production custom secrets changed during deployment.');
}

export async function deployPreservedPrelaunch({ apply = false } = {}) {
  const source = parseEnv(readFileSync(new URL('../.env', import.meta.url), 'utf8'));
  assertSupabaseIntegrationSource(source);
  const worker = assertProductionWorkerCredential(parseEnv(readFileSync(new URL('../../.dabboba-launch/supabase-production-worker.env', import.meta.url), 'utf8')), source.DATABASE_URL);
  const apple = parseEnv(readFileSync(new URL('../../.dabboba-launch/apple/apple-revocation-secrets.env', import.meta.url), 'utf8'));
  const runtime = new URL(source.DATABASE_URL);
  runtime.port = '6543';
  const before = secretDigests();
  assertPreservedPrelaunch(before, {
    DABBOBA_ENVIRONMENT_TIER: 'PRODUCTION', DABBOBA_API_PAYMENT_PROVIDER: 'UNCONFIGURED',
    DABBOBA_API_COMMERCE_MODE: 'PRELAUNCH', DABBOBA_API_DATABASE_URL: runtime.toString(),
    DABBOBA_API_SUPABASE_JWT_AUDIENCE: 'authenticated',
    DABBOBA_API_CUSTOMER_AUTH_ENABLED_PROVIDERS: 'GOOGLE,KAKAO,NAVER,APPLE',
    DABBOBA_STORAGE_BUCKET: 'dabboba-media',
    DABBOBA_STORAGE_S3_ENDPOINT: `https://${PROJECT}.storage.supabase.co/storage/v1/s3`,
    DABBOBA_STORAGE_S3_REGION: 'ap-northeast-2',
    ...worker, ...apple,
  });
  verifySupabaseTargetProjectAccess();
  const sourceReport = await checkDatabaseReleaseSource({ repositoryRoot: root });
  if (sourceReport.status !== 'pass' || sourceReport.worktreeClean !== true) throw new Error('Reviewed clean committed source is required.');
  const database = defaultReleaseCheck({ repositoryRoot: root, environment: {
    DABBOBA_RELEASE_ENVIRONMENT_TIER: 'PRODUCTION', DATABASE_MIGRATION_URL: source.DATABASE_MIGRATION_URL,
    DATABASE_URL: source.DATABASE_URL, WORKER_DATABASE_URL: worker.DABBOBA_WORKER_DATABASE_URL,
  } });
  let databaseReport;
  try { databaseReport = JSON.parse(database.stdout); } catch {}
  if (database.status !== 0 || databaseReport?.status !== 'pass'
    || databaseReport.scope !== 'database-release-check/v1' || databaseReport.environmentTier !== 'PRODUCTION') {
    throw new Error('Production database release check did not pass.');
  }
  await verifyMobilePublicApiSurface({ apiBaseUrl, expectedCommerceMode: 'PRELAUNCH' });
  const report = { sourceHead: sourceReport.head, targetHash: databaseReport.targetHash, commerceMode: 'PRELAUNCH', secretsPreserved: true, applied: apply };
  if (!apply) return report;
  run('corepack', ['pnpm', '--filter', '@dabboba/api', 'build:supabase']);
  run('corepack', ['pnpm', '--filter', '@dabboba/api', 'build:supabase:admin']);
  run('corepack', ['pnpm', '--filter', '@dabboba/worker', 'build:edge']);
  // Recheck immediately before the first mutation; never invoke `secrets set`.
  assertUnchangedSecrets(before, secretDigests());
  for (const name of ['dabboba-api', 'dabboba-admin-api', 'dabboba-worker']) {
    supabase('functions', 'deploy', name, '--no-verify-jwt', '--project-ref', PROJECT);
  }
  assertUnchangedSecrets(before, secretDigests());
  await verifyMobilePublicApiSurface({ apiBaseUrl, expectedCommerceMode: 'PRELAUNCH' });
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some((arg) => arg !== '--apply')) throw new Error('Only --apply is supported.');
  deployPreservedPrelaunch({ apply: process.argv.includes('--apply') })
    .then((report) => process.stdout.write(`${JSON.stringify(report)}\n`))
    .catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
