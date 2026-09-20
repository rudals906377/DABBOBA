import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { databaseTargetIdentity } from '../packages/db/dist/check-release.js';
import { createMigrationDatabasePool } from '../packages/db/dist/index.js';
import { assertWorkerProvisioningTarget } from '../packages/db/dist/provision-worker-role.js';
import { provisionWorkerDatabaseRole } from '../packages/db/dist/role-provisioning.js';
import {
  assertSupabaseIntegrationSource,
  SUPABASE_INTEGRATION_PROJECT_REF,
} from './supabase-integration-profile.mjs';
import { prepareSupabaseEdgeProfile } from './prepare-supabase-edge-profile.mjs';

async function main() {
  const expectedTargetHash = process.argv[2];
  if (!expectedTargetHash || !/^[0-9a-f]{64}$/.test(expectedTargetHash) || process.argv.length !== 3) {
    throw new Error('Usage: provision-supabase-worker-role.mjs <expected-target-sha256>');
  }

  const source = assertSupabaseIntegrationSource(parseEnv(readFileSync('.env', 'utf8')));
  const migrationEnvironment = parseEnv(readFileSync('.env', 'utf8'));
  const migrationUrl = migrationEnvironment.DATABASE_MIGRATION_URL;
  if (!migrationUrl) throw new Error('Migration database URL is missing.');
  const identity = databaseTargetIdentity(migrationUrl);
  if (!identity || identity.hash !== expectedTargetHash) {
    throw new Error('Migration database target does not match the approved target.');
  }
  assertWorkerProvisioningTarget(migrationUrl, 'PRODUCTION', expectedTargetHash);

  const edge = prepareSupabaseEdgeProfile();
  const workerUrl = new URL(edge.DABBOBA_WORKER_DATABASE_URL);
  const sourceUrl = new URL(source.DATABASE_URL);
  if (
    workerUrl.hostname !== sourceUrl.hostname
    || workerUrl.port !== '5432'
    || workerUrl.pathname !== '/postgres'
    || decodeURIComponent(workerUrl.username) !== `dabboba_worker.${SUPABASE_INTEGRATION_PROJECT_REF}`
    || !workerUrl.password
  ) throw new Error('Worker database URL does not match the approved Supabase project.');

  const pool = createMigrationDatabasePool(migrationUrl, 'dabboba-provision-edge-worker-role');
  try {
    await provisionWorkerDatabaseRole(pool, workerUrl.password);
    process.stdout.write('DABBOBA worker database role login is configured.\n');
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  process.stderr.write('DABBOBA worker role provisioning failed; inspect the target privately.\n');
  process.exitCode = 1;
});
