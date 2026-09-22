#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./health-snapshot.sql', import.meta.url), 'utf8');
const executable = source.replace(/--[^\n]*/g, '');
const container = process.env.DABBOBA_HEALTH_TEST_CONTAINER;
const expectedContainer = 'dabboba-backend-integration-20260905';
const database = 'dabboba_integration';
const metrics = [
  'outbox_pending', 'outbox_due', 'outbox_retry_pending',
  'queue_total', 'queue_visible', 'queue_not_visible', 'queue_read_more_than_once',
  'worker_dead_letters', 'reservations_active', 'reservations_expired_active',
  'payments_pending', 'payments_authorized', 'payments_refund_review',
  'payment_reconciliation_schedule_due', 'payments_without_current_reconciliation_schedule',
  'draw_consumed_without_result', 'draw_results_without_consumed_entitlement',
  'draw_result_identity_or_version_mismatch', 'draw_available_on_unpaid_order',
].sort();

if (container && container !== expectedContainer) {
  throw new Error('Only the explicitly approved local DABBOBA integration container is allowed.');
}

function runSql(statement) {
  assert.equal(container, expectedContainer, 'live checks require an explicit dedicated local container');
  const result = spawnSync('docker', [
    'exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', database,
    '-qAt', '-v', 'ON_ERROR_STOP=1', '-f', '-',
  ], { input: statement, encoding: 'utf8', timeout: 20_000, maxBuffer: 1024 * 1024 });
  assert.ifError(result.error);
  return result;
}

function parseSnapshot(result) {
  assert.equal(result.status, 0, 'read-only snapshot failed; inspect schema/permissions separately');
  const output = JSON.parse(result.stdout.trim());
  assert.deepEqual(Object.keys(output).sort(), ['metrics', 'schema_version']);
  assert.equal(output.schema_version, 1);
  assert.deepEqual(Object.keys(output.metrics).sort(), metrics);
  for (const metric of Object.values(output.metrics)) {
    assert.deepEqual(Object.keys(metric).sort(), ['count', 'oldest_age_seconds']);
    assert.ok(Number.isSafeInteger(metric.count) && metric.count >= 0);
    if (metric.count === 0) assert.equal(metric.oldest_age_seconds, null);
    else assert.ok(Number.isSafeInteger(metric.oldest_age_seconds) && metric.oldest_age_seconds >= 0);
  }
  return output.metrics;
}

test('snapshot uses one bounded read-only transaction with RLS filtering errors', () => {
  assert.match(executable, /^\s*BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;/);
  assert.match(executable, /SET LOCAL row_security = off;/);
  assert.match(executable, /SET LOCAL statement_timeout = '15s';/);
  assert.match(executable, /SET LOCAL lock_timeout = '2s';/);
  assert.match(executable, /COMMIT;\s*$/);
  assert.equal((executable.match(/\bBEGIN\b/g) ?? []).length, 1);
});

test('snapshot has no writes, locking reads, queue calls, or sensitive columns', () => {
  assert.doesNotMatch(executable, /\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|EXECUTE|FOR\s+SHARE)\b/i);
  assert.doesNotMatch(executable, /\bpgmq\.\w+\s*\(/i);
  assert.doesNotMatch(executable, /\b(?:payload|job_payload|message|headers|phone|email|token|entropy_hex|selection_snapshot|last_error|error_message)\b/i);
  assert.doesNotMatch(executable, /SELECT\s+\*/i);
});

test('every published metric has one source aggregate and no silent fallback', () => {
  const actual = [...executable.matchAll(/SELECT\s+'([a-z_]+)'\s*,\s*count\(\*\)/g)].map((match) => match[1]).sort();
  assert.deepEqual(actual, metrics);
  assert.doesNotMatch(executable, /to_regclass|EXCEPTION|WHEN OTHERS|has_table_privilege/i);
});

const localOnly = { skip: !container && 'set DABBOBA_HEALTH_TEST_CONTAINER to the exact dedicated local container' };

test('local snapshot returns aggregate contract and consistent subsets', localOnly, () => {
  const actual = parseSnapshot(runSql(source));
  assert.equal(actual.queue_total.count, actual.queue_visible.count + actual.queue_not_visible.count);
  assert.ok(actual.queue_read_more_than_once.count <= actual.queue_total.count);
  assert.ok(actual.outbox_due.count <= actual.outbox_pending.count);
  assert.ok(actual.outbox_retry_pending.count <= actual.outbox_pending.count);
  assert.ok(actual.reservations_expired_active.count <= actual.reservations_active.count);
});

test('missing required relation fails with no successful snapshot', localOnly, () => {
  const result = runSql(source.replaceAll('public.outbox_events', 'public.dabboba_health_missing_fixture'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not exist/);
  assert.equal(result.stdout.trim(), '');
});

test('application role cannot receive a misleading zero snapshot', localOnly, () => {
  const result = runSql(`SET ROLE dabboba_runtime;\n${source}`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /permission denied|row-level security/);
  assert.equal(result.stdout.trim(), '');
});

test('snapshot preserves queue visibility and read counters', localOnly, () => {
  // Internal comparison uses queue metadata only, never message payloads/IDs.
  const metadata = `BEGIN READ ONLY;
    SET LOCAL row_security=off;
    SELECT jsonb_build_object('count',count(*),'reads',COALESCE(sum(read_ct),0),
      'visibility_checksum',md5(COALESCE(string_agg(vt::text,',' ORDER BY vt),'')))
    FROM pgmq.q_dabboba_worker;
    COMMIT;`;
  const before = runSql(metadata);
  assert.equal(before.status, 0);
  parseSnapshot(runSql(source));
  const after = runSql(metadata);
  assert.equal(after.status, 0);
  assert.equal(after.stdout, before.stdout, 'run against an idle local fixture; queue metadata changed');
});
