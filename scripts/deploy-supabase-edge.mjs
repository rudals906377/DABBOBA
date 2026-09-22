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

const SUPABASE_CLI_VERSION = '2.117.0';

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: new URL('../', import.meta.url),
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) throw new Error('Supabase deployment command failed.');
}

function supabase(...args) {
  run('npx', ['--yes', `supabase@${SUPABASE_CLI_VERSION}`, ...args]);
}

export async function deploySupabaseEdge({
  prepareProfile = prepareSupabaseEdgeProfile,
  readEdgeProfile = () => parseEnv(readFileSync(SUPABASE_EDGE_PROFILE_FILE, 'utf8')),
  preflight = ({ edgeProfile }) => runSupabaseEdgeReleasePreflight({ edgeProfile }),
  run: runCommand = run,
  supabase: runSupabase = supabase,
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
  runCommand('corepack', ['pnpm', '--filter', '@dabboba/api', 'build:supabase']);
  runCommand('corepack', ['pnpm', '--filter', '@dabboba/worker', 'build:edge']);
  runSupabase('secrets', 'set', '--env-file', SUPABASE_EDGE_PROFILE_FILE, '--project-ref', SUPABASE_INTEGRATION_PROJECT_REF);
  runSupabase('functions', 'deploy', 'dabboba-api', '--no-verify-jwt', '--project-ref', SUPABASE_INTEGRATION_PROJECT_REF);
  runSupabase('functions', 'deploy', 'dabboba-worker', '--no-verify-jwt', '--project-ref', SUPABASE_INTEGRATION_PROJECT_REF);
  process.stdout.write(`Database release ${release.targetHash.slice(0, 12)} and source ${release.sourceHead.slice(0, 12)} passed preflight.\n`);
  process.stdout.write(`Customer auth providers: ${release.releaseConfiguration.customerAuthProviders.join(',')}; Apple revocation: ${release.releaseConfiguration.appleRevocationConfigured ? 'configured' : 'not required'}; remote push: ${release.releaseConfiguration.remotePushConfigured ? 'configured' : 'disabled (in-app notifications remain available)'}.\n`);
  process.stdout.write('DABBOBA Supabase Edge Functions were deployed with the reviewed profile.\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  deploySupabaseEdge().catch(() => {
    process.stderr.write('DABBOBA Supabase Edge deployment failed; no secret values were printed.\n');
    process.exitCode = 1;
  });
}
