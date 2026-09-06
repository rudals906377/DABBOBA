#!/usr/bin/env node
// Opt-in, clone-only: never loads .env, contacts Supabase or drops a database.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { backupMain, openArchive, sealArchive } from './backup.mjs';
import { packBackupBundle, unpackBackupBundle } from './backup-pgmq.mjs';

const { Pool } = createRequire(new URL('../../packages/db/package.json', import.meta.url))('pg');
const run = promisify(execFile);
const container = process.env.DABBOBA_BACKUP_TEST_CONTAINER;
const source = process.env.DABBOBA_BACKUP_TEST_SOURCE_DATABASE;
if (container !== 'dabboba-backend-integration-20260905') throw new Error('Explicit dedicated test container required.');
if (!/^dabboba_restore_drill_[a-z0-9_]+$/.test(source ?? '')) throw new Error('An explicit disposable restore-clone source is required.');
const target = `dabboba_restore_drill_${Date.now()}`;
const ports = JSON.parse((await run('docker', ['inspect', container, '--format', '{{json .NetworkSettings.Ports}}'])).stdout);
const mapping = ports['5432/tcp']?.find((entry) => entry.HostIp === '127.0.0.1');
assert.ok(mapping && /^[0-9]+$/.test(mapping.HostPort), 'fixture PostgreSQL needs a known loopback port');
const pools = new Map();
const password = 'dabboba-disposable-local-only-20260905';
const ident = (name) => `"${name.replaceAll('"','""')}"`;
function pool(database) {
  if (!pools.has(database)) pools.set(database, new Pool({
    host: '127.0.0.1', port: Number(mapping.HostPort), user: 'postgres', password, database,
    ssl: false, max: 3, connectionTimeoutMillis: 5000, query_timeout: 120000,
    options: '-c statement_timeout=120000 -c search_path=pg_catalog -c timezone=UTC',
  }));
  return pools.get(database);
}
async function rows(database, statement, parameters) { return (await pool(database).query(statement, parameters)).rows; }
async function scalar(database, statement, parameters) { return Object.values((await rows(database, statement, parameters))[0])[0]; }
async function fingerprint(database) {
  const output = {};
  const tables = await rows(database, "SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','pgmq') AND c.relkind IN ('r','p') ORDER BY 1,2");
  for (const { nspname, relname } of tables) output[`${nspname}.${relname}`] = await scalar(database,
    `SELECT count(*) || ':' || md5(COALESCE(string_agg(row_hash, ',' ORDER BY row_hash),'')) FROM (SELECT md5(row_to_json(t)::text) AS row_hash FROM ${ident(nspname)}.${ident(relname)} t) hashes`);
  return output;
}
async function sequenceState(database) {
  const sequences = await rows(database, `SELECT n.nspname,c.relname,format_type(s.seqtypid,-1) AS type,
    s.seqstart::text,s.seqincrement::text,s.seqmin::text,s.seqmax::text,s.seqcache::text,s.seqcycle,
    owner_ns.nspname AS owner_schema,owner_table.relname AS owner_table,a.attname AS owner_column,d.deptype
    FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype IN ('a','i')
    LEFT JOIN pg_class owner_table ON owner_table.oid=d.refobjid
    LEFT JOIN pg_namespace owner_ns ON owner_ns.oid=owner_table.relnamespace
    LEFT JOIN pg_attribute a ON a.attrelid=d.refobjid AND a.attnum=d.refobjsubid
    WHERE n.nspname IN ('public','pgmq') ORDER BY 1,2`);
  for (const sequence of sequences) Object.assign(sequence, (await rows(database,
    `SELECT last_value::text,is_called FROM ${ident(sequence.nspname)}.${ident(sequence.relname)}`))[0]);
  return sequences;
}

async function compareConstraints(sourceDatabase, targetDatabase) {
  const query = `SELECT ns.nspname,t.relname,c.conname,c.contype,c.convalidated,c.condeferrable,c.condeferred,c.connoinherit,
    c.confupdtype,c.confdeltype,c.confmatchtype,fn.nspname AS foreign_schema,ft.relname AS foreign_table,
    (SELECT jsonb_agg(a.attname ORDER BY k.ordinality) FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum) AS columns,
    (SELECT jsonb_agg(a.attname ORDER BY k.ordinality) FROM unnest(c.confkey) WITH ORDINALITY k(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum) AS foreign_columns,
    pg_get_constraintdef(c.oid,false) AS definition
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=t.relnamespace
    LEFT JOIN pg_class ft ON ft.oid=c.confrelid LEFT JOIN pg_namespace fn ON fn.oid=ft.relnamespace
    WHERE ns.nspname IN ('public','pgmq') ORDER BY 1,2,3`;
  const [original, restored] = await Promise.all([rows(sourceDatabase, query), rows(targetDatabase, query)]);
  const metadata = (items) => items.map(({ definition, ...entry }) => entry);
  assert.deepEqual(metadata(restored), metadata(original), 'constraint identity/column/enforcement metadata differs');
  const client = await pool(targetDatabase).connect();
  let checkCount = 0;
  try {
    await client.query('BEGIN');
    for (const [index, constraint] of original.entries()) {
      const targetConstraint = restored[index];
      if (constraint.contype !== 'c') {
        assert.equal(targetConstraint.definition, constraint.definition);
        continue;
      }
      // Parse both CHECK definitions on the SAME empty table. Do not strip casts
      // or Boolean grouping: PostgreSQL supplies the semantic normalization.
      const probeName = `backup_check_probe_${checkCount++}`;
      const probe = ident(probeName);
      await client.query(`CREATE TEMP TABLE ${probe} (LIKE ${ident(constraint.nspname)}.${ident(constraint.relname)}) ON COMMIT DROP`);
      await client.query(`ALTER TABLE pg_temp.${probe} ADD CONSTRAINT probe_source ${constraint.definition}`);
      await client.query(`ALTER TABLE pg_temp.${probe} ADD CONSTRAINT probe_restored ${targetConstraint.definition}`);
      const expressions = (await client.query('SELECT pg_get_expr(conbin,conrelid,false) AS expression FROM pg_constraint WHERE conrelid=$1::regclass ORDER BY conname', [`pg_temp.${probeName}`])).rows;
      assert.equal(expressions.length, 2);
      assert.equal(expressions[0].expression, expressions[1].expression, `${constraint.relname}.${constraint.conname}`);
    }
  } finally { await client.query('ROLLBACK'); client.release(); }
  return { constraints: original.length, checksReparsed: checkCount };
}

const started = Date.now();
try {
  assert.equal(await scalar(source, 'SELECT count(*) FROM public.schema_migrations'), '38');
  // Fixtures mutate ONLY the explicitly named disposable clone.
  await rows(source, "SELECT pgmq.create('dabboba_worker')");
  await rows(source, 'ALTER TABLE pgmq.q_dabboba_worker ENABLE ROW LEVEL SECURITY; ALTER TABLE pgmq.a_dabboba_worker ENABLE ROW LEVEL SECURITY');
  await rows(source, "SELECT pgmq.create('dabboba_backup_unused')");
  await rows(source, 'CREATE TABLE IF NOT EXISTS public.backup_snapshot_probe (id integer PRIMARY KEY, label text NOT NULL)');
  await rows(source, "INSERT INTO public.backup_snapshot_probe VALUES (1,'before snapshot') ON CONFLICT DO NOTHING");
  const payload = { fixture: "'); DROP DATABASE unrelated; --\n\\! touch /tmp/never", label: 'backup-live-fixture' };
  const fixtureId = await scalar(source, "SELECT pgmq.send('dabboba_worker',$1::jsonb,0) AS id", [JSON.stringify(payload)]);
  const archiveFixtureId = await scalar(source, "SELECT pgmq.send('dabboba_worker','{\"fixture\":\"archived-backup-row\"}'::jsonb,0)");
  await rows(source, "SELECT pgmq.archive('dabboba_worker',$1::bigint)", [archiveFixtureId]);
  await rows(source, "UPDATE pgmq.q_dabboba_worker SET read_ct=7,vt='2030-01-01T00:00:00.123456Z',headers=$2::jsonb WHERE msg_id=$1", [fixtureId, '{"large":9223372036854775002}']);
  assert.ok(Number(await scalar(source, 'SELECT count(*) FROM pgmq.q_dabboba_worker')) > 0);
  assert.ok(Number(await scalar(source, 'SELECT count(*) FROM pgmq.a_dabboba_worker')) > 0, 'clone needs an archived-message fixture');
  const before = await fingerprint(source);
  const sequencesBefore = await sequenceState(source);
  await rows('postgres', `CREATE DATABASE ${ident(target)}`);
  const directory = await mkdtemp(join(tmpdir(), 'dabboba-encrypted-restore-drill-'));
  await chmod(directory, 0o700);
  const key = join(directory, 'disposable-test-key');
  const archive = join(directory, 'fixture.dbbenc');
  await writeFile(key, randomBytes(32), { mode: 0o600 });
  const env = {
    DABBOBA_DB_TOOL_CONTAINER: container,
    DABBOBA_BACKUP_SOURCE_URL: `postgresql://postgres:${password}@127.0.0.1:5432/${source}`,
    DABBOBA_RESTORE_DRILL_URL: `postgresql://postgres:${password}@127.0.0.1:5432/${target}`,
    DABBOBA_APPROVE_LOCAL_RESTORE: 'YES',
  };
  assert.equal((await backupMain(['backup', archive, key], env)).queueSnapshotIncluded, true);
  assert.equal((await backupMain(['verify', archive, key], {})).status, 'archive-authenticated');
  const metadataTarget = `${target}_metadata`;
  await rows('postgres', `CREATE DATABASE ${ident(metadataTarget)}`);
  await rows(metadataTarget, "CREATE FUNCTION public.existing_operator_function() RETURNS integer LANGUAGE sql AS 'SELECT 7'");
  const restoreEnv = (database) => ({ ...env, DABBOBA_RESTORE_DRILL_URL: env.DABBOBA_RESTORE_DRILL_URL.replace(target, database) });
  await assert.rejects(backupMain(['restore', archive, key], restoreEnv(metadataTarget)), /not empty/);
  assert.equal(await scalar(metadataTarget, 'SELECT public.existing_operator_function()'), 7);
  assert.equal((await backupMain(['restore', archive, key], env)).queueSnapshotRestored, true);
  assert.deepEqual(await fingerprint(target), before, 'all application/PGMQ row hashes must match');
  assert.deepEqual(await sequenceState(target), sequencesBefore, 'sequence counters/is_called/ownership must match');
  assert.deepEqual(await fingerprint(source), before, 'quiescent backup must preserve source rows');
  assert.deepEqual(await sequenceState(source), sequencesBefore, 'backup must not advance source sequences');
  await assert.rejects(backupMain(['restore', archive, key], env), /not empty/);
  const constraints = await compareConstraints(source, target);
  for (const query of [
    "SELECT n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','pgmq') AND c.relkind IN ('r','p') ORDER BY 1,2",
    "SELECT * FROM pg_policies WHERE schemaname IN ('public','pgmq') ORDER BY schemaname,tablename,policyname",
    "SELECT extname,extversion FROM pg_extension ORDER BY extname",
    "SELECT ns.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,false),pg_get_functiondef(t.tgfoid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE NOT t.tgisinternal AND ns.nspname IN ('public','pgmq') ORDER BY 1,2,3",
    "SELECT ns.nspname,t.relname,i.relname AS index_name,x.indisunique,x.indisvalid,x.indisready,x.indimmediate,x.indnullsnotdistinct,pg_get_indexdef(i.oid) FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class t ON t.oid=x.indrelid JOIN pg_namespace ns ON ns.oid=t.relnamespace WHERE ns.nspname IN ('public','pgmq') ORDER BY 1,2,3",
  ]) assert.deepEqual(await rows(target, query), await rows(source, query));

  // A late supplement failure rolls back ordinary tables and extension DDL too.
  const rollbackTarget = `${target}_rollback`;
  await rows('postgres', `CREATE DATABASE ${ident(rollbackTarget)}`);
  const privateKey = await readFile(key);
  const decrypted = openArchive(await readFile(archive), privateKey);
  const unpacked = unpackBackupBundle(decrypted);
  const invalidManifest = structuredClone(unpacked.manifest);
  invalidManifest.extensions.find((extension) => extension.name === 'pgmq').version = '0.0.0';
  const invalidArchive = join(directory, 'late-error.dbbenc');
  await writeFile(invalidArchive, sealArchive(packBackupBundle(unpacked.dump, invalidManifest), privateKey), { mode: 0o600 });
  privateKey.fill(0);
  decrypted.fill(0);
  await assert.rejects(backupMain(['restore', invalidArchive, key], restoreEnv(rollbackTarget)), /psql failed/);
  assert.equal(await scalar(rollbackTarget, "SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace"), '0');
  assert.equal(await scalar(rollbackTarget, "SELECT count(*) FROM pg_extension WHERE extname<>'plpgsql'"), '0');

  // Commit a normal row and queue publish while pg_dump is held at a known lock
  // barrier. Both readers must continue using the earlier exported snapshot.
  const writer = await pool(source).connect();
  const concurrentArchive = join(directory, 'concurrent.dbbenc');
  const concurrentTarget = `${target}_snapshot`;
  const concurrentProbeId = Number(await scalar(source, 'SELECT COALESCE(max(id),0)+1 FROM public.backup_snapshot_probe'));
  const concurrentMarker = `after-snapshot-publish-${target}`;
  await rows('postgres', `CREATE DATABASE ${ident(concurrentTarget)}`);
  let concurrentBackup;
  try {
    await writer.query('BEGIN');
    await writer.query('LOCK TABLE public.backup_snapshot_probe IN ACCESS EXCLUSIVE MODE');
    await writer.query("INSERT INTO public.backup_snapshot_probe VALUES ($1,'after snapshot')", [concurrentProbeId]);
    await writer.query("SELECT pgmq.send('dabboba_worker',$1::jsonb,0)", [JSON.stringify({ fixture: concurrentMarker })]);
    concurrentBackup = backupMain(['backup', concurrentArchive, key], env);
    concurrentBackup.catch(() => {});
    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      blocked = await scalar(source, "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='dabboba-backup' AND wait_event_type='Lock' AND query LIKE 'LOCK TABLE%')");
      if (blocked) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(blocked, true, 'pg_dump must reach the snapshot/lock barrier');
    await writer.query('COMMIT');
    await concurrentBackup;
  } finally {
    await writer.query('ROLLBACK');
    writer.release();
    if (concurrentBackup) await concurrentBackup.catch(() => {});
  }
  await backupMain(['restore', concurrentArchive, key], restoreEnv(concurrentTarget));
  assert.equal(await scalar(concurrentTarget, 'SELECT count(*) FROM public.backup_snapshot_probe WHERE id=$1', [concurrentProbeId]), '0');
  assert.equal(await scalar(concurrentTarget, "SELECT count(*) FROM pgmq.q_dabboba_worker WHERE message->>'fixture'=$1", [concurrentMarker]), '0');
  assert.equal(await scalar(source, 'SELECT count(*) FROM public.backup_snapshot_probe WHERE id=$1', [concurrentProbeId]), '1');
  assert.equal(await scalar(source, "SELECT count(*) FROM pgmq.q_dabboba_worker WHERE message->>'fixture'=$1", [concurrentMarker]), '1');
  process.stdout.write(`${JSON.stringify({
    status: 'local-restore-drill-passed', tablesCompared: Object.keys(before).length, migrations: 38, ...constraints,
    queueRowsAndArchiveAndSequenceRestored: true, payloadSqlInjectionPrevented: true,
    sharedSnapshotConcurrentCommitExcluded: true, lateRestoreErrorRolledBack: true,
    constraintTriggerPolicyIndexSequenceChecksPassed: true, metadataOnlyTargetRejected: true,
    sourceUnchangedDuringQuiescentBackup: true, nonemptyTargetRejected: true,
    elapsedMs: Date.now() - started, sourceDatabase: source, targetDatabase: target, fixtureArtifacts: directory,
    automaticBackups: false, productionDataUsed: false, roleGrantsRestored: false,
  })}\n`);
} finally { await Promise.all([...pools.values()].map((entry) => entry.end())); }
