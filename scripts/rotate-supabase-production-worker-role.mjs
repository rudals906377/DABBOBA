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
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { databaseTargetIdentity } from '../packages/db/dist/check-release.js';
import { createDatabasePool, createMigrationDatabasePool } from '../packages/db/dist/index.js';
import { assertWorkerProvisioningTarget } from '../packages/db/dist/provision-worker-role.js';
import { workerDatabaseUrl } from '../packages/db/dist/role-credentials.js';
import { provisionWorkerDatabaseRole } from '../packages/db/dist/role-provisioning.js';
import {
  assertSupabaseIntegrationSource,
  SUPABASE_INTEGRATION_PROJECT_REF,
} from './supabase-integration-profile.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const privateFile = resolve(repositoryRoot, '../.dabboba-launch/supabase-production-worker.env');

function saveCredential(values, createOnly) {
  const body = [
    `DABBOBA_SUPABASE_PROJECT_REF=${SUPABASE_INTEGRATION_PROJECT_REF}`,
    `DABBOBA_WORKER_CREDENTIAL_STATUS=${values.status}`,
    `DABBOBA_WORKER_DATABASE_URL=${values.databaseUrl}`,
    `DABBOBA_WORKER_INVOKE_SECRET=${values.invokeSecret}`,
    '',
  ].join('\n');
  const path = createOnly
    ? privateFile
    : `${privateFile}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  const descriptor = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    0o600,
  );
  try {
    writeFileSync(descriptor, body, 'utf8');
  } finally {
    closeSync(descriptor);
  }
  if (!createOnly) renameSync(path, privateFile);
  if ((statSync(privateFile).mode & 0o777) !== 0o600) {
    throw new Error('Worker credential file permissions are invalid');
  }
}

async function main() {
  const approvedHash = process.argv[2];
  if (!/^[0-9a-f]{64}$/.test(approvedHash ?? '') || process.argv.length !== 3) {
    throw new Error('Usage: rotate-supabase-production-worker-role.mjs <approved-target-sha256>');
  }
  if (existsSync(privateFile)) {
    throw new Error('Production worker credential file already exists; refuse repeat rotation');
  }

  const source = parseEnv(readFileSync(resolve(repositoryRoot, '.env'), 'utf8'));
  assertSupabaseIntegrationSource(source);
  const migrationUrl = source.DATABASE_MIGRATION_URL;
  if (!migrationUrl) throw new Error('Production migration connection is missing');
  const migrationUser = decodeURIComponent(new URL(migrationUrl).username);
  if (migrationUser !== `postgres.${SUPABASE_INTEGRATION_PROJECT_REF}`) {
    throw new Error('Production migration role or project is not approved');
  }
  const identity = databaseTargetIdentity(migrationUrl);
  if (!identity || identity.hash !== approvedHash) {
    throw new Error('Production migration target hash differs from approved target');
  }
  assertWorkerProvisioningTarget(migrationUrl, 'PRODUCTION', approvedHash);

  const password = randomBytes(48).toString('base64url');
  const databaseUrl = workerDatabaseUrl(migrationUrl, password);
  const worker = new URL(databaseUrl);
  if (
    worker.port !== '5432'
    || decodeURIComponent(worker.username) !== `dabboba_worker.${SUPABASE_INTEGRATION_PROJECT_REF}`
    || worker.hostname !== new URL(migrationUrl).hostname
    || worker.pathname !== '/postgres'
  ) throw new Error('Generated worker connection does not match the production project');

  const values = {
    status: 'PENDING',
    databaseUrl,
    invokeSecret: randomBytes(48).toString('base64url'),
  };
  // Store first so an interrupted DB rotation never loses the new password.
  saveCredential(values, true);
  const ownerPool = createMigrationDatabasePool(migrationUrl, 'dabboba-production-worker-rotation');
  try {
    await provisionWorkerDatabaseRole(ownerPool, password, {
      allowExistingLoginRotation: true,
    });
  } finally {
    await ownerPool.end();
  }
  process.stdout.write('Production worker role password rotated; verifying restricted login.\n');

  const workerPool = createDatabasePool(databaseUrl, 'dabboba-production-worker-verify', {
    expectedRole: 'dabboba_worker',
    runtimeEnvironment: 'production',
    max: 1,
  });
  try {
    const result = await workerPool.query('SELECT current_user AS role, current_database() AS database');
    if (result.rows[0]?.role !== 'dabboba_worker' || result.rows[0]?.database !== 'postgres') {
      throw new Error('Worker login did not resolve to the restricted role');
    }
  } finally {
    await workerPool.end();
  }
  saveCredential({ ...values, status: 'VERIFIED' }, false);
  process.stdout.write('Production worker role login verified; credential kept in a private local file.\n');
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(() => {
    process.stderr.write('Production worker rotation did not complete; inspect private status before retrying.\n');
    process.exitCode = 1;
  });
}
