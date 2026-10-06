import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import {
  LIVE_PAYMENT_PROFILE_KEYS,
  prepareSupabaseEdgeProfile,
  SUPABASE_EDGE_PROFILE_FILE,
} from './prepare-supabase-edge-profile.mjs';
import { SUPABASE_INTEGRATION_PROJECT_REF } from './supabase-integration-profile.mjs';
import { runSupabaseEdgeReleasePreflight } from './supabase-edge-release-preflight.mjs';
import { waitForPublicEdgeSurface } from './verify-public-edge-surface.mjs';

const SUPABASE_CLI_VERSION = '2.117.0';

export function supabaseCommandArgs(...args) {
  return ['--yes', `supabase@${SUPABASE_CLI_VERSION}`, ...args];
}

export function verifySupabaseTargetProjectAccess({
  projectRef = SUPABASE_INTEGRATION_PROJECT_REF,
  runCommand = spawnSync,
} = {}) {
  const result = runCommand('npx', supabaseCommandArgs('projects', 'list', '--output', 'json'), {
    cwd: new URL('../', import.meta.url),
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let projects;
  try {
    projects = JSON.parse(result.stdout);
  } catch {
    throw new Error('Supabase CLI project access could not be verified.');
  }
  if (result.error || result.status !== 0 || !Array.isArray(projects)
    // The pinned CLI serializes the project reference as `id`; older output used `ref`.
    || !projects.some((project) => (project.id === projectRef || project.ref === projectRef)
      && project.status === 'ACTIVE_HEALTHY')) {
    throw new Error('Supabase CLI is not authenticated for the expected active production project.');
  }
}

/** Names (never values) of the custom secrets currently set on the target project. */
export function listSupabaseSecretNames({
  projectRef = SUPABASE_INTEGRATION_PROJECT_REF,
  runCommand = spawnSync,
} = {}) {
  const result = runCommand('npx', supabaseCommandArgs('secrets', 'list', '--project-ref', projectRef, '--output', 'json'), {
    cwd: new URL('../', import.meta.url),
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error('Supabase project secrets could not be listed.');
  }
  const secrets = Array.isArray(parsed) ? parsed : parsed?.secrets;
  const names = Array.isArray(secrets) ? secrets.map((secret) => secret?.name ?? secret?.Name) : null;
  if (result.error || result.status !== 0 || !names || names.some((name) => typeof name !== 'string' || !name)) {
    throw new Error('Supabase project secrets could not be listed.');
  }
  return new Set(names);
}

/** Commerce mode reported by the deployed production API, or null when unreachable. */
export async function fetchDeployedCommerceMode({
  fetchImpl = globalThis.fetch,
  baseUrl = `https://${SUPABASE_INTEGRATION_PROJECT_REF}.supabase.co/functions/v1/dabboba-api`,
} = {}) {
  try {
    const response = await fetchImpl(`${baseUrl}/v1/public/config`, {
      headers: { accept: 'application/json', 'cache-control': 'no-cache' },
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status !== 200) return null;
    const mode = (await response.json())?.commerceMode;
    return mode === 'PRELAUNCH' || mode === 'LIVE' ? mode : null;
  } catch {
    return null;
  }
}

/**
 * Whether the project still holds LIVE payment secrets. Uses the CLI secret
 * names; if they cannot be listed, a running API that reports PRELAUNCH proves
 * none are set (PortOne credentials without a PortOne provider stop the API).
 */
export async function projectHoldsLiveSettings({
  listSecretNames = listSupabaseSecretNames,
  fetchCommerceMode = fetchDeployedCommerceMode,
} = {}) {
  try {
    return liveOnlySecretNames(listSecretNames()).length > 0;
  } catch {
    const mode = await fetchCommerceMode();
    if (mode === 'PRELAUNCH') return false;
    if (mode === 'LIVE') return true;
    throw new Error('Could not confirm whether the project holds LIVE payment secrets; nothing was changed.');
  }
}

/** LIVE-only payment settings currently present on the project (names only). */
export function liveOnlySecretNames(names) {
  return LIVE_PAYMENT_PROFILE_KEYS.filter((key) => names.has(key));
}

export function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: new URL('../', import.meta.url),
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) throw new Error('Supabase deployment command failed.');
}

export function supabase(...args) {
  run('npx', supabaseCommandArgs(...args));
}

export async function deploySupabaseEdge({
  prepareProfile = prepareSupabaseEdgeProfile,
  readEdgeProfile = () => parseEnv(readFileSync(SUPABASE_EDGE_PROFILE_FILE, 'utf8')),
  preflight = ({ edgeProfile }) => runSupabaseEdgeReleasePreflight({ edgeProfile }),
  verifyProjectAccess = verifySupabaseTargetProjectAccess,
  listSecretNames = listSupabaseSecretNames,
  fetchCommerceMode = fetchDeployedCommerceMode,
  run: runCommand = run,
  supabase: runSupabase = supabase,
  verifyPublicSurface = waitForPublicEdgeSurface,
} = {}) {
  const profile = prepareProfile();
  // The post-deploy smoke must expect the mode being deployed; resolve it before any mutation.
  const expectedCommerceMode = profile.DABBOBA_API_COMMERCE_MODE;
  if (expectedCommerceMode !== 'PRELAUNCH' && expectedCommerceMode !== 'LIVE') {
    throw new Error('The Edge profile must set DABBOBA_API_COMMERCE_MODE to PRELAUNCH or LIVE.');
  }
  if (!profile.DABBOBA_STORAGE_S3_ACCESS_KEY_ID || !profile.DABBOBA_STORAGE_S3_SECRET_ACCESS_KEY) {
    throw new Error('Supabase Storage S3 access key is not prepared.');
  }
  const parsed = readEdgeProfile();
  if (Object.keys(parsed).some((key) => key.startsWith('SUPABASE_'))) {
    throw new Error('Reserved Supabase secrets must not be duplicated in the custom Edge profile.');
  }

  const release = await preflight({ edgeProfile: profile });
  verifyProjectAccess();
  // A LIVE project keeps its PortOne secrets. Uploading this PRELAUNCH profile
  // over them would leave an API that refuses to start, so a LIVE project is
  // updated with supabase:edge:live:deploy and returned to PRELAUNCH only by
  // the explicit supabase:edge:live:rollback command.
  if (await projectHoldsLiveSettings({ listSecretNames, fetchCommerceMode })) {
    throw new Error('The project has LIVE payment secrets; use supabase:edge:live:deploy or supabase:edge:live:rollback.');
  }
  runCommand('corepack', ['pnpm', '--filter', '@dabboba/api', 'build:supabase']);
  runCommand('corepack', ['pnpm', '--filter', '@dabboba/api', 'build:supabase:admin']);
  runCommand('corepack', ['pnpm', '--filter', '@dabboba/worker', 'build:edge']);
  runSupabase('secrets', 'set', '--env-file', SUPABASE_EDGE_PROFILE_FILE, '--project-ref', SUPABASE_INTEGRATION_PROJECT_REF);
  runSupabase('functions', 'deploy', 'dabboba-api', '--no-verify-jwt', '--project-ref', SUPABASE_INTEGRATION_PROJECT_REF);
  runSupabase('functions', 'deploy', 'dabboba-admin-api', '--no-verify-jwt', '--project-ref', SUPABASE_INTEGRATION_PROJECT_REF);
  runSupabase('functions', 'deploy', 'dabboba-worker', '--no-verify-jwt', '--project-ref', SUPABASE_INTEGRATION_PROJECT_REF);
  await verifyPublicSurface({ expectedCommerceMode });
  process.stdout.write(`Database release ${release.targetHash.slice(0, 12)} and source ${release.sourceHead.slice(0, 12)} passed preflight.\n`);
  process.stdout.write(`Customer auth providers: ${release.releaseConfiguration.customerAuthProviders.join(',')}; Apple revocation: ${release.releaseConfiguration.appleRevocationConfigured ? 'configured' : 'not required'}; remote push: ${release.releaseConfiguration.remotePushConfigured ? 'configured' : 'disabled (in-app notifications remain available)'}.\n`);
  process.stdout.write('DABBOBA Supabase Edge Functions were deployed and the public mobile API surface passed verification.\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  deploySupabaseEdge().catch(() => {
    process.stderr.write('DABBOBA Supabase Edge deployment failed; no secret values were printed.\n');
    process.exitCode = 1;
  });
}
