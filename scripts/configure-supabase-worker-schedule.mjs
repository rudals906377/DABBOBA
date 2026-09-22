import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { databaseTargetIdentity } from '../packages/db/dist/check-release.js';
import { createMigrationDatabasePool } from '../packages/db/dist/index.js';
import { assertWorkerProvisioningTarget } from '../packages/db/dist/provision-worker-role.js';
import { SUPABASE_INTEGRATION_PROJECT_REF } from './supabase-integration-profile.mjs';
import { prepareSupabaseEdgeProfile } from './prepare-supabase-edge-profile.mjs';

const JOB_NAME = 'dabboba-worker-every-minute';
const SECRET_NAME = 'dabboba_worker_invoke_secret';

function scheduledCommand() {
  const functionUrl = `https://${SUPABASE_INTEGRATION_PROJECT_REF}.supabase.co/functions/v1/dabboba-worker`;
  return `SELECT net.http_post(
    url := '${functionUrl}',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'authorization', 'Bearer ' || (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = '${SECRET_NAME}'
      )
    ),
    body := jsonb_build_object('source', 'supabase-cron'),
    timeout_milliseconds := 120000
  ) AS request_id`;
}

async function upsertVaultSecret(client, value) {
  const existing = await client.query(
    'SELECT id FROM vault.secrets WHERE name = $1',
    [SECRET_NAME],
  );
  if (existing.rowCount === 0) {
    await client.query(
      'SELECT vault.create_secret($1, $2, $3)',
      [value, SECRET_NAME, 'DABBOBA Edge worker Cron bearer secret'],
    );
    return;
  }
  if (existing.rowCount !== 1) throw new Error('Worker invoke secret name is not unique.');
  await client.query(
    'SELECT vault.update_secret($1, new_secret := $2, new_description := $3)',
    [existing.rows[0].id, value, 'DABBOBA Edge worker Cron bearer secret'],
  );
}

async function main() {
  const expectedTargetHash = process.argv[2];
  if (!expectedTargetHash || !/^[0-9a-f]{64}$/.test(expectedTargetHash) || process.argv.length !== 3) {
    throw new Error('Usage: configure-supabase-worker-schedule.mjs <expected-target-sha256>');
  }
  const source = parseEnv(readFileSync('.env', 'utf8'));
  const migrationUrl = source.DATABASE_MIGRATION_URL;
  if (!migrationUrl) throw new Error('Migration database URL is missing.');
  const identity = databaseTargetIdentity(migrationUrl);
  if (!identity || identity.hash !== expectedTargetHash) throw new Error('Database target does not match.');
  assertWorkerProvisioningTarget(migrationUrl, 'PRODUCTION', expectedTargetHash);
  const edge = prepareSupabaseEdgeProfile();
  const command = scheduledCommand();

  const pool = createMigrationDatabasePool(migrationUrl, 'dabboba-configure-edge-worker-schedule');
  const client = await pool.connect();
  let phase = 'begin';
  try {
    await client.query('BEGIN');
    phase = 'advisory-lock';
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('dabboba-worker-schedule', 0))");
    phase = 'pg-net-extension';
    await client.query('CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions');
    phase = 'pg-cron-extension';
    await client.query('CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog');
    phase = 'vault-secret';
    await upsertVaultSecret(client, edge.DABBOBA_WORKER_INVOKE_SECRET);

    phase = 'existing-job';
    const existing = await client.query(
      'SELECT jobid, schedule, command, active FROM cron.job WHERE jobname = $1',
      [JOB_NAME],
    );
    if (existing.rowCount === 0) {
      phase = 'schedule-job';
      await client.query('SELECT cron.schedule($1, $2, $3)', [JOB_NAME, '* * * * *', command]);
    } else if (
      existing.rowCount !== 1
      || existing.rows[0].schedule !== '* * * * *'
      || existing.rows[0].command.trim() !== command.trim()
      || existing.rows[0].active !== true
    ) {
      throw new Error('An existing DABBOBA worker schedule differs from the reviewed definition.');
    }
    await client.query('COMMIT');
    process.stdout.write('DABBOBA Supabase worker schedule is active.\n');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    const code = error && typeof error === 'object' && typeof error.code === 'string'
      && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : 'UNKNOWN';
    process.stderr.write(`Scheduler phase failed: ${phase} (${code}).\n`);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(() => {
  process.stderr.write('DABBOBA worker schedule configuration failed; inspect the project privately.\n');
  process.exitCode = 1;
});
