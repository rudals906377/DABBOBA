import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { SUPABASE_LIVE_CANDIDATE_FILE } from '../scripts/check-supabase-live-candidate.mjs';
import { deploySupabaseEdge, listSupabaseSecretNames, projectHoldsLiveSettings } from '../scripts/deploy-supabase-edge.mjs';
import {
  assertLiveProfileKeepsProductionBaseline,
  deploySupabaseLiveEdge,
  LIVE_CONFIRMATION,
  ROLLBACK_CONFIRMATION,
  rollbackSupabaseLiveEdge,
} from '../scripts/deploy-supabase-live-edge.mjs';
import { LIVE_PAYMENT_PROFILE_KEYS, SUPABASE_EDGE_PROFILE_FILE } from '../scripts/prepare-supabase-edge-profile.mjs';
import { SUPABASE_INTEGRATION_PROJECT_REF } from '../scripts/supabase-integration-profile.mjs';

const ref = SUPABASE_INTEGRATION_PROJECT_REF;
const prelaunch = {
  DABBOBA_ENVIRONMENT_TIER: 'PRODUCTION',
  DABBOBA_API_DATABASE_URL: 'postgresql://runtime:fixture@pooler.example.test:6543/postgres',
  DABBOBA_WORKER_DATABASE_URL: 'postgresql://worker:fixture@pooler.example.test:5432/postgres',
  DABBOBA_API_SESSION_TOKEN_PEPPER: 'production-session-pepper-fixture',
  DABBOBA_API_COMMERCE_MODE: 'PRELAUNCH',
  DABBOBA_API_PAYMENT_PROVIDER: 'UNCONFIGURED',
  DABBOBA_API_CUSTOMER_AUTH_ENABLED_PROVIDERS: 'KAKAO,NAVER,GOOGLE,APPLE',
  DABBOBA_STORAGE_S3_ACCESS_KEY_ID: 's3-fixture-access',
  DABBOBA_STORAGE_S3_SECRET_ACCESS_KEY: 's3-fixture-secret',
};
const live = {
  ...prelaunch,
  DABBOBA_API_COMMERCE_MODE: 'LIVE',
  DABBOBA_API_PAYMENT_PROVIDER: 'PORTONE_V2_INICIS',
  DABBOBA_API_PORTONE_CHANNEL_KEY: 'channel-key-live-fixture',
  DABBOBA_API_PORTONE_CHANNEL_ENVIRONMENT: 'LIVE',
  PAYMENT_RECONCILIATION_PROVIDER: 'PORTONE_API',
};
const release = { sourceHead: 'a'.repeat(40), latestMigration: '0085_session_review_access_deadline.sql', targetHash: 'b'.repeat(64) };

function harness({ liveSecrets = [], verifyLive, rollback, adminAccess } = {}) {
  const calls = [];
  const options = {
    readLiveProfile: () => { calls.push('read-live'); return live; },
    prepareProfile: () => { calls.push('read-prelaunch'); return prelaunch; },
    preflight: async ({ edgeProfile }) => { calls.push('preflight'); assert.equal(edgeProfile, live); return release; },
    verifyAdminAccess: adminAccess ?? (async () => calls.push('admin-access')),
    verifyProjectAccess: () => calls.push('project-access'),
    listSecretNames: () => { calls.push('list-secrets'); return new Set(['DABBOBA_API_DATABASE_URL', ...liveSecrets]); },
    run: (command, args) => calls.push(`run:${command} ${args.join(' ')}`),
    supabase: (...args) => calls.push(`supabase:${args.join(' ')}`),
    verifyLive: verifyLive ?? (async (profile) => { calls.push('verify-live'); assert.equal(profile, live); }),
    verifyPrelaunch: async ({ expectedCommerceMode }) => calls.push(`verify:${expectedCommerceMode}`),
    log: () => {},
    ...(rollback ? { rollback } : {}),
  };
  return { calls, options };
}

test('the LIVE profile may add payment settings but must keep every production baseline value', () => {
  assert.doesNotThrow(() => assertLiveProfileKeepsProductionBaseline(live, prelaunch));
  for (const key of ['DABBOBA_API_DATABASE_URL', 'DABBOBA_API_SESSION_TOKEN_PEPPER', 'DABBOBA_STORAGE_S3_SECRET_ACCESS_KEY']) {
    assert.throws(
      () => assertLiveProfileKeepsProductionBaseline({ ...live, [key]: 'changed-secret-value' }, prelaunch),
      (error) => error.message.includes(key) && !error.message.includes('changed-secret-value'),
    );
  }
  assert.throws(() => assertLiveProfileKeepsProductionBaseline({ ...live, UNREVIEWED: 'x' }, prelaunch), /UNREVIEWED/);
});

test('LIVE cutover checks everything before uploading LIVE secrets, then deploys and verifies LIVE', async () => {
  const { calls, options } = harness();
  const result = await deploySupabaseLiveEdge(options);
  assert.deepEqual(result, { commerceMode: 'LIVE', transition: 'PRELAUNCH to LIVE cutover', ...release });
  assert.deepEqual(calls.slice(0, 6), ['read-live', 'read-prelaunch', 'preflight', 'admin-access', 'project-access', 'list-secrets']);
  const secretsSet = calls.indexOf(`supabase:secrets set --env-file ${SUPABASE_LIVE_CANDIDATE_FILE} --project-ref ${ref}`);
  assert.ok(secretsSet > calls.indexOf('run:corepack pnpm --filter @dabboba/worker build:edge'));
  for (const fn of ['dabboba-api', 'dabboba-admin-api', 'dabboba-worker']) {
    assert.ok(calls.indexOf(`supabase:functions deploy ${fn} --no-verify-jwt --project-ref ${ref}`) > secretsSet, fn);
  }
  assert.equal(calls.at(-1), 'verify-live');
  assert.equal(calls.some((call) => call.includes('secrets unset')), false);
});

test('a project that already has LIVE payment settings is reported as a LIVE redeploy', async () => {
  const { options } = harness({ liveSecrets: ['DABBOBA_API_PORTONE_API_SECRET'] });
  assert.equal((await deploySupabaseLiveEdge(options)).transition, 'LIVE redeploy');
});

test('a changed baseline or failed preflight stops before any build, secret or deploy', async () => {
  const changed = harness();
  changed.options.readLiveProfile = () => ({ ...live, DABBOBA_WORKER_DATABASE_URL: 'postgresql://elsewhere' });
  await assert.rejects(deploySupabaseLiveEdge(changed.options), /DABBOBA_WORKER_DATABASE_URL/);
  const blocked = harness();
  blocked.options.preflight = async () => { throw new Error('database release blocked'); };
  await assert.rejects(deploySupabaseLiveEdge(blocked.options), /database release blocked/);
  for (const { calls } of [changed, blocked]) {
    assert.equal(calls.some((call) => call.startsWith('run:') || call.startsWith('supabase:')), false);
  }
});

test('an administrator console without Cloudflare Access stops the cutover before anything changes', async () => {
  const { calls, options } = harness({ adminAccess: async () => { calls.push('admin-access'); throw new Error('admin.dabboba.net answered 200'); } });
  await assert.rejects(deploySupabaseLiveEdge(options), /answered 200/);
  assert.deepEqual(calls, ['read-live', 'read-prelaunch', 'preflight', 'admin-access']);
});

test('a failed LIVE verification returns the project to PRELAUNCH and removes LIVE payment secrets', async () => {
  const present = ['DABBOBA_API_PORTONE_API_SECRET', 'PAYMENT_RECONCILIATION_PROVIDER'];
  const { calls, options } = harness({
    verifyLive: async () => { calls.push('verify-live'); throw new Error('no purchasable gacha'); },
  });
  options.listSecretNames = () => { calls.push('list-secrets'); return new Set(calls.includes('verify-live') ? present : []); };
  await assert.rejects(deploySupabaseLiveEdge(options), (error) => {
    assert.match(error.message, /returned to PRELAUNCH/);
    assert.equal(error.cause.message, 'no purchasable gacha');
    return true;
  });
  const afterFailure = calls.slice(calls.indexOf('verify-live'));
  assert.deepEqual(afterFailure, [
    'verify-live',
    'list-secrets',
    `supabase:secrets unset ${present.join(' ')} --project-ref ${ref} --yes`,
    `supabase:secrets set --env-file ${SUPABASE_EDGE_PROFILE_FILE} --project-ref ${ref}`,
    'verify:PRELAUNCH',
  ]);
});

test('a failed function deploy also rolls back, and a failed rollback says to run it manually', async () => {
  const { calls, options } = harness({ rollback: async () => { calls.push('rollback'); throw new Error('cli down'); } });
  const supabase = options.supabase;
  options.supabase = (...args) => {
    supabase(...args);
    if (args[0] === 'functions') throw new Error('deploy failed');
  };
  await assert.rejects(deploySupabaseLiveEdge(options), /run supabase:edge:live:rollback now/);
  assert.ok(calls.includes('rollback'));
});

test('rollback removes only LIVE-only settings that exist and refuses a non-PRELAUNCH profile', async () => {
  const calls = [];
  const result = await rollbackSupabaseLiveEdge({
    prepareProfile: () => prelaunch,
    verifyProjectAccess: () => calls.push('project-access'),
    listSecretNames: () => new Set(['DABBOBA_API_DATABASE_URL', 'DABBOBA_API_PORTONE_KCP_CHANNEL_KEY']),
    supabase: (...args) => calls.push(args.join(' ')),
    verifyPublicSurface: async ({ expectedCommerceMode }) => calls.push(`verify:${expectedCommerceMode}`),
    log: () => {},
  });
  assert.deepEqual(result, { commerceMode: 'PRELAUNCH', removedLiveSettings: 1 });
  assert.deepEqual(calls, [
    'project-access',
    `secrets unset DABBOBA_API_PORTONE_KCP_CHANNEL_KEY --project-ref ${ref} --yes`,
    `secrets set --env-file ${SUPABASE_EDGE_PROFILE_FILE} --project-ref ${ref}`,
    'verify:PRELAUNCH',
  ]);
  await assert.rejects(rollbackSupabaseLiveEdge({ prepareProfile: () => live }), /PRELAUNCH production profile/);
  assert.ok(LIVE_PAYMENT_PROFILE_KEYS.includes('DABBOBA_API_PORTONE_KCP_CHANNEL_KEY'));
});

test('the PRELAUNCH deploy refuses a project that still holds LIVE payment secrets', async () => {
  const commands = [];
  await assert.rejects(deploySupabaseEdge({
    prepareProfile: () => prelaunch,
    readEdgeProfile: () => ({}),
    preflight: async () => ({ sourceHead: 'a'.repeat(40), targetHash: 'b'.repeat(64), releaseConfiguration: { customerAuthProviders: [] } }),
    verifyProjectAccess: () => {},
    listSecretNames: () => new Set(['DABBOBA_API_PORTONE_CHANNEL_KEY']),
    run: (...args) => commands.push(args),
    supabase: (...args) => commands.push(args),
    verifyPublicSurface: () => commands.push('smoke'),
  }), /supabase:edge:live:rollback/);
  assert.deepEqual(commands, []);
});

test('secret listing returns names only and fails closed on unexpected CLI output', () => {
  const names = listSupabaseSecretNames({
    runCommand: () => ({ status: 0, stdout: JSON.stringify([{ name: 'A', value: 'digest' }, { name: 'B', value: 'digest' }]) }),
  });
  assert.deepEqual([...names], ['A', 'B']);
  const wrapped = listSupabaseSecretNames({
    runCommand: () => ({ status: 0, stdout: JSON.stringify({ secrets: [{ Name: 'C', Value: 'digest' }] }) }),
  });
  assert.deepEqual([...wrapped], ['C']);
  for (const output of [{ status: 1, stdout: '[]' }, { status: 0, stdout: 'not json' }, { status: 0, stdout: '[{"value":"x"}]' }]) {
    assert.throws(() => listSupabaseSecretNames({ runCommand: () => output }), /could not be listed/);
  }
});

test('the command line requires the exact project confirmation before reading any profile', () => {
  const script = fileURLToPath(new URL('../scripts/deploy-supabase-live-edge.mjs', import.meta.url));
  for (const [args, phrase] of [[[], LIVE_CONFIRMATION], [['--confirm=LIVE:other'], LIVE_CONFIRMATION], [['--rollback'], ROLLBACK_CONFIRMATION]]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 20_000 });
    assert.equal(result.status, 1, result.stderr);
    assert.ok(result.stderr.includes(`--confirm=${phrase}`), result.stderr);
  }
});

test('an unlistable project counts as LIVE-free only when its running API reports PRELAUNCH', async () => {
  const unlistable = () => { throw new Error('cli output changed'); };
  assert.equal(await projectHoldsLiveSettings({ listSecretNames: unlistable, fetchCommerceMode: async () => 'PRELAUNCH' }), false);
  assert.equal(await projectHoldsLiveSettings({ listSecretNames: unlistable, fetchCommerceMode: async () => 'LIVE' }), true);
  await assert.rejects(
    projectHoldsLiveSettings({ listSecretNames: unlistable, fetchCommerceMode: async () => null }),
    /nothing was changed/,
  );
  assert.equal(await projectHoldsLiveSettings({ listSecretNames: () => new Set(['PAYMENT_RECONCILIATION_PROVIDER']) }), true);
});

test('rollback removes every LIVE-only key name when the secret list cannot be read', async () => {
  const calls = [];
  await rollbackSupabaseLiveEdge({
    prepareProfile: () => prelaunch,
    verifyProjectAccess: () => {},
    listSecretNames: () => { throw new Error('cli output changed'); },
    supabase: (...args) => calls.push(args),
    verifyPublicSurface: async () => {},
    log: () => {},
  });
  assert.deepEqual(calls[0], ['secrets', 'unset', ...LIVE_PAYMENT_PROFILE_KEYS, '--project-ref', ref, '--yes']);
});
