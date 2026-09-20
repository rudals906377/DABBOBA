import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const compose = readFileSync(new URL('../ops/local/backend.compose.yaml', import.meta.url), 'utf8');
const prepare = readFileSync(new URL('../scripts/prepare-local-backend.mjs', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../scripts/run-local-backend.mjs', import.meta.url), 'utf8');

test('local backend preparation owns a separate PostgreSQL-only compose project', () => {
  assert.match(compose, /^name: dabboba-development$/m);
  assert.match(compose, /^services:\n  postgres:/m);
  assert.doesNotMatch(compose, /^  redis:/m);
  assert.match(compose, /127\.0\.0\.1:55433:5432/);
  assert.match(compose, /dabboba_development_postgres17_pgmq_data/);
  assert.match(prepare, /dabboba-development-postgres-1/);
  assert.match(prepare, /dabboba-development_dabboba_development_postgres17_pgmq_data/);
  assert.doesNotMatch(prepare, /ops\/local\/compose\.yaml/);
});

test('local admin development server binds only to loopback', () => {
  assert.match(runner, /'next', 'dev', '--hostname', '127\.0\.0\.1', '--port', '4180'/);
});
