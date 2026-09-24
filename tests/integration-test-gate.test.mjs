import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('required database integration URLs reach Turbo tests without replaying cached results', async () => {
  const turbo = JSON.parse(await readFile(new URL('../turbo.json', import.meta.url), 'utf8'));
  for (const key of [
    'NODE_ENV',
    'DABBOBA_ENVIRONMENT_TIER',
    'DATABASE_MIGRATION_URL',
    'DABBOBA_TEST_DATABASE_URL',
    'DABBOBA_RUNTIME_TEST_DATABASE_URL',
    'DABBOBA_WORKER_TEST_DATABASE_URL',
  ]) {
    assert.ok(turbo.globalEnv?.includes(key), `${key} must reach Turbo test tasks`);
  }
  assert.equal(turbo.tasks?.test?.cache, false, 'integration tests must execute on every required run');
});
