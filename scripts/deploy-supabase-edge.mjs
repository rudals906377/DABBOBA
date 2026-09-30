import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import {
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
    || !projects.some((project) => project.ref === projectRef && project.status === 'ACTIVE_HEALTHY')) {
    throw new Error('Supabase CLI is not authenticated for the expected active production project.');
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: new URL('../', import.meta.url),
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) throw new Error('Supabase deployment command failed.');
}

function supabase(...args) {
  run('npx', supabaseCommandArgs(...args));
}

export async function deploySupabaseEdge({
  prepareProfile = prepareSupabaseEdgeProfile,
  readEdgeProfile = () => parseEnv(readFileSync(SUPABASE_EDGE_PROFILE_FILE, 'utf8')),
  preflight = ({ edgeProfile }) => runSupabaseEdgeReleasePreflight({ edgeProfile }),
  verifyProjectAccess = verifySupabaseTargetProjectAccess,
  run: runCommand = run,
  supabase: runSupabase = supabase,
  verifyPublicSurface = waitForPublicEdgeSurface,
} = {}) {
  const profile = prepareProfile();
  if (!profile.DABBOBA_STORAGE_S3_ACCESS_KEY_ID || !profile.DABBOBA_STORAGE_S3_SECRET_ACCESS_KEY) {
    throw new Error('Supabase Storage S3 access key is not prepared.');
  }
  const parsed = readEdgeProfile();
  if (Object.keys(parsed).some((key) => key.startsWith('SUPABASE_'))) {
    throw new Error('Reserved Supabase secrets must not be duplicated in the custom Edge profile.');
  }

  const release = await preflight({ edgeProfile: profile });
  verifyProjectAccess();
  runCommand('corepack', ['pnpm', '--filter', '@dabboba/api', 'build:supabase']);
  runCommand('corepack', ['pnpm', '--filter', '@dabboba/api', 'build:supabase:admin']);
  runCommand('corepack', ['pnpm', '--filter', '@dabboba/worker', 'build:edge']);
  runSupabase('secrets', 'set', '--env-file', SUPABASE_EDGE_PROFILE_FILE, '--project-ref', SUPABASE_INTEGRATION_PROJECT_REF);
  runSupabase('functions', 'deploy', 'dabboba-api', '--no-verify-jwt', '--project-ref', SUPABASE_INTEGRATION_PROJECT_REF);
  runSupabase('functions', 'deploy', 'dabboba-admin-api', '--no-verify-jwt', '--project-ref', SUPABASE_INTEGRATION_PROJECT_REF);
  runSupabase('functions', 'deploy', 'dabboba-worker', '--no-verify-jwt', '--project-ref', SUPABASE_INTEGRATION_PROJECT_REF);
  await verifyPublicSurface();
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
