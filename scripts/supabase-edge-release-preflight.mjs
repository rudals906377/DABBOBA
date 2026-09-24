import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import {
  checkDatabaseReleaseSource,
  MINIMUM_DATABASE_RELEASE_VERSION,
} from './check-database-release-source.mjs';
import { assertSupabaseEdgeReleaseConfiguration } from './prepare-supabase-edge-profile.mjs';

const defaultRepositoryRoot = fileURLToPath(new URL('../', import.meta.url));

export function defaultReleaseCheck({ repositoryRoot, environment }) {
  return spawnSync(
    resolve(repositoryRoot, 'packages/db/node_modules/.bin/tsx'),
    ['src/check-release.ts'],
    {
      cwd: resolve(repositoryRoot, 'packages/db'),
      env: { ...process.env, ...environment },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

function required(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Supabase Edge database release preflight is missing ${name}.`);
  }
  return value.trim();
}

export async function runSupabaseEdgeReleasePreflight({
  edgeProfile,
  repositoryRoot = defaultRepositoryRoot,
  sourceEnvironment = null,
  checkSource = checkDatabaseReleaseSource,
  runReleaseCheck = defaultReleaseCheck,
} = {}) {
  const releaseConfiguration = assertSupabaseEdgeReleaseConfiguration(edgeProfile ?? {});
  const sourceReport = await checkSource({ repositoryRoot });
  if (
    !sourceReport
    || sourceReport.status !== 'pass'
    || !/^[0-9a-f]{40,64}$/.test(sourceReport.head ?? '')
    || sourceReport.latestMigration?.slice(0, 4) < MINIMUM_DATABASE_RELEASE_VERSION
    || sourceReport.worktreeClean !== true
  ) {
    throw new Error(
      `Supabase Edge source is not a reviewed Git commit with migration ${MINIMUM_DATABASE_RELEASE_VERSION}.`,
    );
  }

  const source = sourceEnvironment ?? parseEnv(readFileSync(resolve(repositoryRoot, '.env'), 'utf8'));
  const environment = {
    DABBOBA_RELEASE_ENVIRONMENT_TIER: 'PRODUCTION',
    DATABASE_MIGRATION_URL: required(source.DATABASE_MIGRATION_URL, 'DATABASE_MIGRATION_URL'),
    DATABASE_URL: required(edgeProfile?.DABBOBA_API_DATABASE_URL, 'DABBOBA_API_DATABASE_URL'),
    WORKER_DATABASE_URL: required(edgeProfile?.DABBOBA_WORKER_DATABASE_URL, 'DABBOBA_WORKER_DATABASE_URL'),
  };
  const result = await runReleaseCheck({ repositoryRoot, environment });
  let databaseReport = null;
  try {
    databaseReport = JSON.parse(result?.stdout ?? '');
  } catch {
    // The release gate remains blocked when its machine-readable evidence is absent.
  }
  if (
    result?.error
    || result?.status !== 0
    || databaseReport?.scope !== 'database-release-check/v1'
    || databaseReport?.status !== 'pass'
    || databaseReport?.environmentTier !== 'PRODUCTION'
    || !/^[0-9a-f]{64}$/.test(databaseReport?.targetHash ?? '')
  ) {
    throw new Error('Supabase Edge target database did not pass the read-only release check.');
  }
  return {
    sourceHead: sourceReport.head,
    latestMigration: sourceReport.latestMigration,
    targetHash: databaseReport.targetHash,
    releaseConfiguration,
  };
}
