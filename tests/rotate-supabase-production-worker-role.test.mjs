import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertWorkerConnectionMatchesProject,
  parseRotationArguments,
  parseStoredWorkerCredential,
  resumePendingWorkerCredential,
} from '../scripts/rotate-supabase-production-worker-role.mjs';

const hash = 'a'.repeat(64);
const migrationUrl = 'postgresql://postgres.rconfxsykttfvznakile:owner@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres';
const workerUrl = 'postgresql://dabboba_worker.rconfxsykttfvznakile:stored-pass@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres';
const stored = (status = 'PENDING') => [
  'DABBOBA_SUPABASE_PROJECT_REF=rconfxsykttfvznakile',
  `DABBOBA_WORKER_CREDENTIAL_STATUS=${status}`,
  `DABBOBA_WORKER_DATABASE_URL=${workerUrl}`,
  'DABBOBA_WORKER_INVOKE_SECRET=invoke-secret',
  '',
].join('\n');

test('rotation arguments accept a fresh rotation or an explicit resume of the approved target', () => {
  assert.deepEqual(parseRotationArguments([hash]), { resume: false, approvedHash: hash });
  assert.deepEqual(parseRotationArguments(['--resume', hash]), { resume: true, approvedHash: hash });
  for (const argv of [[], ['--resume'], ['not-a-hash'], [hash, hash], ['--resume', hash, 'extra']]) {
    assert.throws(() => parseRotationArguments(argv), /Usage/);
  }
});

test('a stored credential is parsed only for the approved project and its password is reused', () => {
  const values = parseStoredWorkerCredential(stored());
  assert.equal(values.status, 'PENDING');
  assert.equal(assertWorkerConnectionMatchesProject(values.databaseUrl, migrationUrl), 'stored-pass');
  assert.throws(() => parseStoredWorkerCredential(stored().replace('rconfxsykttfvznakile\n', 'yxkmvgfruphgghowzvmo\n')), /incomplete/);
  assert.throws(() => parseStoredWorkerCredential(stored('UNKNOWN')), /incomplete/);
  assert.throws(() => assertWorkerConnectionMatchesProject(workerUrl.replace('dabboba_worker', 'dabboba_runtime'), migrationUrl), /does not match/);
});

test('resume promotes an already-applied password without rotating again', async () => {
  const calls = [];
  await resumePendingWorkerCredential({
    values: parseStoredWorkerCredential(stored()),
    password: 'stored-pass',
    rotate: async () => { calls.push('rotate'); },
    verifyLogin: async () => { calls.push('verify'); },
    save: (next) => { calls.push(`save:${next.status}:${next.databaseUrl === workerUrl}`); },
  });
  assert.deepEqual(calls, ['verify', 'save:VERIFIED:true']);
});

test('resume reapplies the same stored password when the first rotation never reached the database', async () => {
  const calls = [];
  let applied = false;
  await resumePendingWorkerCredential({
    values: parseStoredWorkerCredential(stored()),
    password: 'stored-pass',
    rotate: async (password) => { calls.push(`rotate:${password}`); applied = true; },
    verifyLogin: async () => { calls.push('verify'); if (!applied) throw new Error('password authentication failed'); },
    save: (next) => { calls.push(`save:${next.status}`); },
  });
  assert.deepEqual(calls, ['verify', 'rotate:stored-pass', 'verify', 'save:VERIFIED']);
});

test('resume keeps the credential PENDING when the reapplied password still cannot log in', async () => {
  const saved = [];
  await assert.rejects(resumePendingWorkerCredential({
    values: parseStoredWorkerCredential(stored()),
    password: 'stored-pass',
    rotate: async () => {},
    verifyLogin: async () => { throw new Error('login refused'); },
    save: (next) => saved.push(next),
  }), /login refused/);
  assert.deepEqual(saved, []);
  await assert.rejects(resumePendingWorkerCredential({
    values: parseStoredWorkerCredential(stored('VERIFIED')),
    password: 'stored-pass',
    rotate: async () => {},
    verifyLogin: async () => {},
    save: () => {},
  }), /Only a PENDING/);
});
