#!/usr/bin/env node

// LIVE cutover, LIVE redeploy, and the explicit return to PRELAUNCH for the
// production Supabase Edge project. See docs/live-cutover-runbook.md.
import { pathToFileURL } from 'node:url';
import {
  readSupabaseLiveCandidateProfile,
  SUPABASE_LIVE_CANDIDATE_FILE,
} from './check-supabase-live-candidate.mjs';
import {
  fetchDeployedCommerceMode,
  listSupabaseSecretNames,
  liveOnlySecretNames,
  projectHoldsLiveSettings,
  run as runCommandDefault,
  supabase as supabaseDefault,
  verifySupabaseTargetProjectAccess,
} from './deploy-supabase-edge.mjs';
import {
  LIVE_PAYMENT_PROFILE_KEYS,
  phoneLoginReady,
  prepareSupabaseEdgeProfile,
  STORE_REVIEW_EDGE_KEYS,
  SUPABASE_EDGE_PROFILE_FILE,
} from './prepare-supabase-edge-profile.mjs';
import { runSupabaseEdgeReleasePreflight } from './supabase-edge-release-preflight.mjs';
import { SUPABASE_INTEGRATION_PROJECT_REF } from './supabase-integration-profile.mjs';
import { verifyLiveEdgeWorkerBoundary } from './verify-live-edge-worker-boundary.mjs';
import {
  verifyMobilePublicApiSurface,
  waitForPublicEdgeSurface,
} from './verify-public-edge-surface.mjs';

const PRODUCTION_API_BASE_URL = `https://${SUPABASE_INTEGRATION_PROJECT_REF}.supabase.co/functions/v1/dabboba-api`;
export const LIVE_CONFIRMATION = `LIVE:${SUPABASE_INTEGRATION_PROJECT_REF}`;
export const ROLLBACK_CONFIRMATION = `PRELAUNCH:${SUPABASE_INTEGRATION_PROJECT_REF}`;

// The LIVE profile is the reviewed PRELAUNCH production profile plus payment
// settings. Everything else (database roles, session pepper, storage, worker
// and Apple credentials) must stay identical, or the cutover would also log out
// every customer or point the API at another database.
const LIVE_PROFILE_MAY_DIFFER = new Set([
  'DABBOBA_API_COMMERCE_MODE',
  'DABBOBA_API_PAYMENT_PROVIDER',
  'DABBOBA_API_CUSTOMER_AUTH_ENABLED_PROVIDERS',
  'DABBOBA_PHONE_LOGIN_READY',
  'DABBOBA_API_LOG_LEVEL',
  'DABBOBA_WORKER_EXPO_PUSH_ACCESS_TOKEN',
  ...STORE_REVIEW_EDGE_KEYS,
  ...LIVE_PAYMENT_PROFILE_KEYS,
]);

export function assertLiveProfileKeepsProductionBaseline(live, prelaunch) {
  const keys = new Set([...Object.keys(live), ...Object.keys(prelaunch)]);
  const changed = [...keys].filter((key) => !LIVE_PROFILE_MAY_DIFFER.has(key) && live[key] !== prelaunch[key]).sort();
  if (changed.length) {
    throw new Error(`The LIVE profile must keep the production PRELAUNCH values for: ${changed.join(', ')}.`);
  }
}

function confirmed(argv, flag, expected) {
  return argv.some((argument) => argument === `${flag}=${expected}`);
}

async function verifyLiveSurface(profile) {
  await waitForPublicEdgeSurface({
    expectedCommerceMode: 'LIVE',
    verify: ({ expectedCommerceMode }) => verifyMobilePublicApiSurface({
      apiBaseUrl: PRODUCTION_API_BASE_URL,
      expectedCommerceMode,
      requirePhoneLogin: phoneLoginReady(profile),
    }),
  });
  await verifyLiveEdgeWorkerBoundary();
}

/**
 * Returns the project to the reviewed PRELAUNCH profile: removes every LIVE-only
 * payment secret, uploads the PRELAUNCH profile and verifies the PRELAUNCH
 * public surface. Function code is left as deployed; only the commerce mode
 * and payment settings change.
 */
export async function rollbackSupabaseLiveEdge({
  prepareProfile = prepareSupabaseEdgeProfile,
  verifyProjectAccess = verifySupabaseTargetProjectAccess,
  listSecretNames = listSupabaseSecretNames,
  supabase = supabaseDefault,
  verifyPublicSurface = waitForPublicEdgeSurface,
  log = (message) => process.stderr.write(`${message}\n`),
} = {}) {
  const profile = prepareProfile();
  if (profile.DABBOBA_API_COMMERCE_MODE !== 'PRELAUNCH') {
    throw new Error('The rollback profile must be the reviewed PRELAUNCH production profile.');
  }
  verifyProjectAccess();
  let liveKeys;
  try {
    liveKeys = liveOnlySecretNames(listSecretNames());
  } catch {
    // Unlisted is not proof of absence: remove every LIVE-only key name.
    liveKeys = [...LIVE_PAYMENT_PROFILE_KEYS];
  }
  if (liveKeys.length) {
    supabase('secrets', 'unset', ...liveKeys, '--project-ref', SUPABASE_INTEGRATION_PROJECT_REF, '--yes');
  }
  supabase('secrets', 'set', '--env-file', SUPABASE_EDGE_PROFILE_FILE, '--project-ref', SUPABASE_INTEGRATION_PROJECT_REF);
  log(`Removed ${liveKeys.length} LIVE payment setting(s) and restored the PRELAUNCH profile.`);
  await verifyPublicSurface({ expectedCommerceMode: 'PRELAUNCH' });
  return { commerceMode: 'PRELAUNCH', removedLiveSettings: liveKeys.length };
}

/**
 * LIVE cutover or LIVE redeploy. Nothing on the project changes until the LIVE
 * profile, its PRELAUNCH baseline, the source/database preflight and CLI access
 * all pass. Any failure after the LIVE secrets are uploaded returns the project
 * to PRELAUNCH so payments fail closed instead of staying half configured.
 */
export async function deploySupabaseLiveEdge({
  readLiveProfile = readSupabaseLiveCandidateProfile,
  prepareProfile = prepareSupabaseEdgeProfile,
  preflight = ({ edgeProfile }) => runSupabaseEdgeReleasePreflight({ edgeProfile, expectedCommerceMode: 'LIVE' }),
  verifyProjectAccess = verifySupabaseTargetProjectAccess,
  listSecretNames = listSupabaseSecretNames,
  fetchCommerceMode = fetchDeployedCommerceMode,
  run = runCommandDefault,
  supabase = supabaseDefault,
  verifyLive = verifyLiveSurface,
  verifyPrelaunch = waitForPublicEdgeSurface,
  rollback = rollbackSupabaseLiveEdge,
  log = (message) => process.stderr.write(`${message}\n`),
} = {}) {
  const live = readLiveProfile();
  const prelaunch = prepareProfile();
  if (prelaunch.DABBOBA_API_COMMERCE_MODE !== 'PRELAUNCH') {
    throw new Error('The rollback baseline must be the reviewed PRELAUNCH production profile.');
  }
  assertLiveProfileKeepsProductionBaseline(live, prelaunch);
  if (!prelaunch.DABBOBA_STORAGE_S3_ACCESS_KEY_ID || !prelaunch.DABBOBA_STORAGE_S3_SECRET_ACCESS_KEY) {
    throw new Error('Supabase Storage S3 access key is not prepared.');
  }
  const release = await preflight({ edgeProfile: live });
  verifyProjectAccess();
  const wasLive = await projectHoldsLiveSettings({ listSecretNames, fetchCommerceMode });
  run('corepack', ['pnpm', '--filter', '@dabboba/api', 'build:supabase']);
  run('corepack', ['pnpm', '--filter', '@dabboba/api', 'build:supabase:admin']);
  run('corepack', ['pnpm', '--filter', '@dabboba/worker', 'build:edge']);

  try {
    supabase('secrets', 'set', '--env-file', SUPABASE_LIVE_CANDIDATE_FILE, '--project-ref', SUPABASE_INTEGRATION_PROJECT_REF);
    supabase('functions', 'deploy', 'dabboba-api', '--no-verify-jwt', '--project-ref', SUPABASE_INTEGRATION_PROJECT_REF);
    supabase('functions', 'deploy', 'dabboba-admin-api', '--no-verify-jwt', '--project-ref', SUPABASE_INTEGRATION_PROJECT_REF);
    supabase('functions', 'deploy', 'dabboba-worker', '--no-verify-jwt', '--project-ref', SUPABASE_INTEGRATION_PROJECT_REF);
    await verifyLive(live);
  } catch (error) {
    log('LIVE deployment or verification failed; returning the project to PRELAUNCH.');
    try {
      await rollback({
        prepareProfile: () => prelaunch,
        verifyProjectAccess: () => {},
        listSecretNames,
        supabase,
        verifyPublicSurface: verifyPrelaunch,
        log,
      });
    } catch {
      throw new Error('LIVE deployment failed and the automatic PRELAUNCH rollback also failed; run supabase:edge:live:rollback now.');
    }
    throw new Error('LIVE deployment failed; the project was returned to PRELAUNCH.', { cause: error });
  }
  return {
    commerceMode: 'LIVE',
    transition: wasLive ? 'LIVE redeploy' : 'PRELAUNCH to LIVE cutover',
    sourceHead: release.sourceHead,
    latestMigration: release.latestMigration,
    targetHash: release.targetHash,
  };
}

async function main(argv) {
  if (argv.includes('--rollback')) {
    if (!confirmed(argv, '--confirm', ROLLBACK_CONFIRMATION)) {
      throw new Error(`Returning production to PRELAUNCH requires --confirm=${ROLLBACK_CONFIRMATION}.`);
    }
    const result = await rollbackSupabaseLiveEdge();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (!confirmed(argv, '--confirm', LIVE_CONFIRMATION)) {
    throw new Error(`Enabling real LIVE payments requires --confirm=${LIVE_CONFIRMATION}.`);
  }
  const result = await deploySupabaseLiveEdge();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    // Messages name only steps and setting keys, never secret values.
    process.stderr.write(`${error instanceof Error ? error.message : 'LIVE Edge command failed.'}\n`);
    process.exitCode = 1;
  });
}
