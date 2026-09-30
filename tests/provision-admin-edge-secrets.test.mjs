import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  parseProvisionOptions,
  provisionAdminEdgeSecrets,
  readRecoveryFile,
  writePrivateEnvFile,
} from '../scripts/provision-admin-edge-secrets.mjs';

const source = readFileSync(
  fileURLToPath(new URL('../scripts/provision-admin-edge-secrets.mjs', import.meta.url)),
  'utf8',
);
const accountId = 'a'.repeat(32);
const recoveryRoot = mkdtempSync(path.join(os.tmpdir(), 'dabboba-admin-recovery-'));
test.after(() => rmSync(recoveryRoot, { recursive: true, force: true }));
const env = {
  DABBOBA_FRIEND_CLOUDFLARE_XDG_CONFIG_HOME: '/secure/cloudflare',
  DABBOBA_FRIEND_CLOUDFLARE_ACCOUNT_ID: accountId,
  DABBOBA_FRIEND_CLOUDFLARE_EMAIL: 'Owner@Example.org',
  DABBOBA_ADMIN_SECRET_RECOVERY_DIR: recoveryRoot,
};

test('the provisioning script contains no hard-coded personal account identity', () => {
  assert.doesNotMatch(source, /@naver\.com|e2e1645ee7006824232a8b657bd784f5/);
  assert.doesNotMatch(source, /=\$\{(?:proxyIdentitySecret|serviceSecret)\}/);
});

test('Cloudflare account and owner email come from flags or the environment', () => {
  assert.deepEqual(parseProvisionOptions(['--apply'], env), {
    cloudflareConfigHome: '/secure/cloudflare',
    cloudflareAccountId: accountId,
    cloudflareEmail: 'owner@example.org',
    resumeFile: null,
    recoveryDirectory: recoveryRoot,
  });
  assert.throws(() => parseProvisionOptions(['--apply'], { ...env, DABBOBA_ADMIN_SECRET_RECOVERY_DIR: '' }), /RECOVERY_DIR/);
  assert.throws(() => parseProvisionOptions(['--apply'], {
    ...env,
    DABBOBA_ADMIN_SECRET_RECOVERY_DIR: fileURLToPath(new URL('../', import.meta.url)),
  }), /outside the repository/);
  assert.throws(() => parseProvisionOptions(['--apply', '--resume', 'relative.env'], env), /absolute path/);
  assert.equal(parseProvisionOptions(['--apply', '--resume', '/private/admin.env'], {
    ...env,
    DABBOBA_ADMIN_SECRET_RECOVERY_DIR: '',
  }).resumeFile, '/private/admin.env');
  const flagged = parseProvisionOptions([
    '--apply', '--cloudflare-account-id', 'b'.repeat(32), '--cloudflare-email', 'ops@example.net',
  ], env);
  assert.equal(flagged.cloudflareAccountId, 'b'.repeat(32));
  assert.equal(flagged.cloudflareEmail, 'ops@example.net');
  assert.throws(() => parseProvisionOptions([], env), /Usage/);
  assert.throws(() => parseProvisionOptions(['--apply'], { ...env, DABBOBA_FRIEND_CLOUDFLARE_ACCOUNT_ID: '' }), /account ID/);
  assert.throws(() => parseProvisionOptions(['--apply'], { ...env, DABBOBA_FRIEND_CLOUDFLARE_EMAIL: '' }), /owner email/);
  assert.throws(() => parseProvisionOptions(['--apply', '--unknown'], env), /Unknown argument/);
  assert.throws(() => parseProvisionOptions(['--apply', '--cloudflare-email'], env), /requires a value/);
});

test('private env files are 0600 and removed by cleanup', () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), 'dabboba-envfile-test-'));
  try {
    const envFile = writePrivateEnvFile([['A_SECRET', 'value-1'], ['B', 'two']], { parent });
    assert.equal(statSync(envFile.file).mode & 0o777, 0o600);
    assert.equal(readFileSync(envFile.file, 'utf8'), 'A_SECRET=value-1\nB=two\n');
    envFile.cleanup();
    assert.equal(existsSync(envFile.file), false);
    assert.deepEqual(readdirSync(parent), []);
    assert.throws(() => writePrivateEnvFile([['A', 'multi\nline']], { parent }), /single-line/);
    assert.deepEqual(readdirSync(parent), []);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

async function runProvisioning({ failSecretsSet = false, failSecondPut = false, argv = ['--apply'] } = {}) {
  const parent = mkdtempSync(path.join(os.tmpdir(), 'dabboba-provision-test-'));
  const calls = [];
  const logs = [];
  let envFileSnapshot = null;
  let puts = 0;
  const run = async (command, args, options = {}) => {
    calls.push({ command, args, input: options.input });
    if (args.includes('whoami')) return `Account ${accountId} owner@example.org`;
    if (args.includes('projects')) return JSON.stringify([{ id: 'rconfxsykttfvznakile' }]);
    if (args.includes('secrets') && args.includes('set')) {
      const file = args[args.indexOf('--env-file') + 1];
      envFileSnapshot = { mode: statSync(file).mode & 0o777, text: readFileSync(file, 'utf8'), file };
      if (failSecretsSet) throw new Error('npx operation failed');
    }
    if (args.includes('put')) {
      puts += 1;
      if (failSecondPut && puts === 2) throw new Error('wrangler operation failed');
    }
    return '';
  };
  try {
    const promise = provisionAdminEdgeSecrets({
      argv,
      env,
      run,
      envFileParent: parent,
      fetchImpl: async () => new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED' } }), { status: 401 }),
      loadSigner: async () => () => ({ 'x-signature': 'fixture' }),
      log: (message) => logs.push(message),
      pause: async () => {},
    });
    return { promise, calls, logs, parent, snapshot: () => envFileSnapshot };
  } catch (error) {
    rmSync(parent, { recursive: true, force: true });
    throw error;
  }
}

test('Supabase secrets are passed through a 0600 env file, never command arguments, and the file is deleted', async () => {
  const { promise, calls, parent, snapshot } = await runProvisioning();
  try {
    await promise;
    const secretsSet = calls.find(({ args }) => args.includes('secrets') && args.includes('set'));
    assert.ok(secretsSet);
    assert.deepEqual(secretsSet.args.slice(-4), ['--env-file', snapshot().file, '--project-ref', 'rconfxsykttfvznakile']);
    assert.equal(snapshot().mode, 0o600);
    const secrets = Object.fromEntries(snapshot().text.trim().split('\n').map((line) => line.split('=')));
    assert.match(secrets.DABBOBA_ADMIN_PROXY_IDENTITY_SECRET, /^[0-9a-f]{96}$/);
    assert.match(secrets.DABBOBA_ADMIN_SERVICE_SECRET, /^[0-9a-f]{96}$/);
    const allArgs = calls.flatMap(({ args }) => args).join(' ');
    assert.equal(allArgs.includes(secrets.DABBOBA_ADMIN_PROXY_IDENTITY_SECRET), false);
    assert.equal(allArgs.includes(secrets.DABBOBA_ADMIN_SERVICE_SECRET), false);
    assert.deepEqual(
      calls.filter(({ args }) => args.includes('put')).map(({ input }) => input),
      [secrets.DABBOBA_ADMIN_PROXY_IDENTITY_SECRET, secrets.DABBOBA_ADMIN_SERVICE_SECRET],
    );
    assert.equal(existsSync(snapshot().file), false);
    assert.deepEqual(readdirSync(parent), []);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('the temporary env file is deleted even when the Supabase CLI fails', async () => {
  const { promise, parent, snapshot } = await runProvisioning({ failSecretsSet: true });
  try {
    await assert.rejects(promise, /operation failed/);
    assert.equal(existsSync(snapshot().file), false);
    assert.deepEqual(readdirSync(parent), []);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('an unapproved Wrangler identity stops before any secret is generated or set', async () => {
  const calls = [];
  await assert.rejects(provisionAdminEdgeSecrets({
    argv: ['--apply'],
    env,
    run: async (command, args) => {
      calls.push(args);
      return args.includes('whoami') ? `Account ${accountId} someone-else@example.org` : '';
    },
    log: () => {},
  }), /not authenticated to the approved/);
  assert.equal(calls.length, 1);
});

test('a split rotation keeps its generation in a private recovery file and --resume reapplies exactly it', async () => {
  const failed = await runProvisioning({ failSecondPut: true });
  let recoveryFile;
  try {
    await assert.rejects(failed.promise, /wrangler operation failed/);
    const hint = failed.logs.find((message) => message.includes('--resume'));
    assert.ok(hint, 'the operator is told how to finish the same generation');
    recoveryFile = hint.slice(hint.indexOf('--resume ') + '--resume '.length).split(' ')[0];
    assert.equal(statSync(recoveryFile).mode & 0o777, 0o600);
    const pair = readRecoveryFile(recoveryFile);
    assert.equal(failed.logs.some((message) => message.includes(pair.serviceSecret) || message.includes(pair.proxyIdentitySecret)), false);
    const firstPuts = failed.calls.filter(({ args }) => args.includes('put')).map(({ input }) => input);
    assert.deepEqual(firstPuts, [pair.proxyIdentitySecret, pair.serviceSecret]);

    const resumed = await runProvisioning({ argv: ['--apply', '--resume', recoveryFile] });
    try {
      await resumed.promise;
      const secrets = Object.fromEntries(resumed.snapshot().text.trim().split('\n').map((line) => line.split('=')));
      assert.equal(secrets.DABBOBA_ADMIN_PROXY_IDENTITY_SECRET, pair.proxyIdentitySecret);
      assert.equal(secrets.DABBOBA_ADMIN_SERVICE_SECRET, pair.serviceSecret);
      assert.deepEqual(
        resumed.calls.filter(({ args }) => args.includes('put')).map(({ input }) => input),
        [pair.proxyIdentitySecret, pair.serviceSecret],
      );
      assert.equal(existsSync(recoveryFile), false, 'a verified generation removes its recovery file');
    } finally {
      rmSync(resumed.parent, { recursive: true, force: true });
    }
  } finally {
    rmSync(failed.parent, { recursive: true, force: true });
  }
});

test('a successful fresh rotation leaves no recovery file behind', async () => {
  const before = new Set(readdirSync(recoveryRoot));
  const { promise, parent } = await runProvisioning();
  try {
    await promise;
    assert.deepEqual(readdirSync(recoveryRoot).filter((name) => !before.has(name)), []);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
