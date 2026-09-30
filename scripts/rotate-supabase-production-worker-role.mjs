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

const USAGE = 'Usage: rotate-supabase-production-worker-role.mjs [--resume] <approved-target-sha256>';

export function parseRotationArguments(argv) {
  const resume = argv[0] === '--resume';
  const rest = resume ? argv.slice(1) : argv;
  if (rest.length !== 1 || !/^[0-9a-f]{64}$/.test(rest[0] ?? '')) throw new Error(USAGE);
  return { resume, approvedHash: rest[0] };
}

export function assertWorkerConnectionMatchesProject(databaseUrl, migrationUrl) {
  const worker = new URL(databaseUrl);
  if (
    worker.port !== '5432'
    || decodeURIComponent(worker.username) !== `dabboba_worker.${SUPABASE_INTEGRATION_PROJECT_REF}`
    || worker.hostname !== new URL(migrationUrl).hostname
    || worker.pathname !== '/postgres'
    || !worker.password
  ) throw new Error('Worker connection does not match the production project');
  return decodeURIComponent(worker.password);
}

export function parseStoredWorkerCredential(text) {
  const values = parseEnv(text);
  const status = values.DABBOBA_WORKER_CREDENTIAL_STATUS;
  if (values.DABBOBA_SUPABASE_PROJECT_REF !== SUPABASE_INTEGRATION_PROJECT_REF
    || !['PENDING', 'VERIFIED'].includes(status)
    || !values.DABBOBA_WORKER_DATABASE_URL || !values.DABBOBA_WORKER_INVOKE_SECRET) {
    throw new Error('Stored worker credential is incomplete');
  }
  return {
    status,
    databaseUrl: values.DABBOBA_WORKER_DATABASE_URL,
    invokeSecret: values.DABBOBA_WORKER_INVOKE_SECRET,
  };
}

/**
 * Finishes a stored PENDING credential without generating a new password. If
 * the earlier rotation already applied it, only the login check and promotion
 * remain; otherwise the same stored password is applied again (idempotent).
 */
export async function resumePendingWorkerCredential({ values, password, rotate, verifyLogin, save }) {
  if (values.status !== 'PENDING') throw new Error('Only a PENDING worker credential can be resumed');
  let loginVerified = false;
  try {
    await verifyLogin(values.databaseUrl);
    loginVerified = true;
  } catch {
    // The stored password has not reached the database yet; apply it again below.
  }
  if (!loginVerified) {
    await rotate(password);
    await verifyLogin(values.databaseUrl);
  }
  save({ ...values, status: 'VERIFIED' });
}

async function verifyWorkerLogin(databaseUrl) {
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
}

async function rotateWorkerPassword(migrationUrl, password) {
  const ownerPool = createMigrationDatabasePool(migrationUrl, 'dabboba-production-worker-rotation');
  try {
    await provisionWorkerDatabaseRole(ownerPool, password, {
      allowExistingLoginRotation: true,
    });
  } finally {
    await ownerPool.end();
  }
}

async function main() {
  const { resume, approvedHash } = parseRotationArguments(process.argv.slice(2));
  if (!resume && existsSync(privateFile)) {
    throw new Error('Production worker credential file already exists; use --resume to finish a PENDING rotation');
  }
  if (resume && !existsSync(privateFile)) {
    throw new Error('No stored production worker credential to resume');
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

  if (resume) {
    if ((statSync(privateFile).mode & 0o777) !== 0o600) {
      throw new Error('Worker credential file permissions are invalid');
    }
    const values = parseStoredWorkerCredential(readFileSync(privateFile, 'utf8'));
    if (values.status === 'VERIFIED') {
      process.stdout.write('Production worker credential is already VERIFIED; nothing to resume.\n');
      return;
    }
    const password = assertWorkerConnectionMatchesProject(values.databaseUrl, migrationUrl);
    await resumePendingWorkerCredential({
      values,
      password,
      rotate: (storedPassword) => rotateWorkerPassword(migrationUrl, storedPassword),
      verifyLogin: verifyWorkerLogin,
      save: (next) => saveCredential(next, false),
    });
    process.stdout.write('Stored production worker credential verified and promoted; no new password was generated.\n');
    return;
  }

  const password = randomBytes(48).toString('base64url');
  const databaseUrl = workerDatabaseUrl(migrationUrl, password);
  assertWorkerConnectionMatchesProject(databaseUrl, migrationUrl);

  const values = {
    status: 'PENDING',
    databaseUrl,
    invokeSecret: randomBytes(48).toString('base64url'),
  };
  // Store first so an interrupted DB rotation never loses the new password;
  // a failed or interrupted run is finished with --resume, not a new rotation.
  saveCredential(values, true);
  await rotateWorkerPassword(migrationUrl, password);
  process.stdout.write('Production worker role password rotated; verifying restricted login.\n');
  await verifyWorkerLogin(databaseUrl);
  saveCredential({ ...values, status: 'VERIFIED' }, false);
  process.stdout.write('Production worker role login verified; credential kept in a private local file.\n');
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(() => {
    process.stderr.write('Production worker rotation did not complete; finish the stored PENDING credential with --resume.\n');
    process.exitCode = 1;
  });
}
