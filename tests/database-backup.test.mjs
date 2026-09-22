import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, chmod, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { backupMain, connectionEnvironment, openArchive, sealArchive } from '../ops/database/backup.mjs';
import { packBackupBundle, unpackBackupBundle, queueRestoreSql, validateQueueManifest } from '../ops/database/backup-pgmq.mjs';

const emptyManifest = () => ({ version: 2, extensions: [{ name: 'plpgsql', version: '1.0' }], queues: [] });
const fixtureBundle = () => packBackupBundle(Buffer.from('PGDMP\0unit-fixture'), emptyManifest());
function queueManifest() {
  const row = { msg_id: '9223372036854775000', read_ct: 2, enqueued_at: '2026-09-06T00:00:00.123456Z', vt: '2026-09-07T00:00:00Z', message: { text: "'); DROP DATABASE unrelated; --\\n\\! touch /tmp/never" }, headers: null };
  return { version: 2, extensions: [{ name: 'pgmq', version: '1.5.1' }], queues: [{
    name: 'dabboba_worker', createdAt: '2026-09-06T00:00:00.123456Z', isPartitioned: false, isUnlogged: false,
    live: { rowsJson: JSON.stringify([row]), rls: true, forceRls: false },
    archive: { rowsJson: '[]', rls: true, forceRls: false },
    sequence: { lastValue: '9223372036854775001', isCalled: true, increment: '1', start: '1', minimum: '1', maximum: '9223372036854775807', cache: '1', cycle: false },
  }] };
}

test('encrypted PostgreSQL archive round-trips without retaining a plaintext file', () => {
  const key = randomBytes(32);
  const original = Buffer.from('PGDMP\0private-ledger-and-token-fixture');
  const sealed = sealArchive(original, key);
  assert.equal(sealed.includes(original), false);
  assert.deepEqual(openArchive(sealed, key), original);
  assert.notDeepEqual(sealArchive(original, key), sealed, 'fresh nonce for every backup');
});

test('wrong key, altered magic, nonce, tag, ciphertext and truncation fail authentication', () => {
  const key = randomBytes(32);
  const original = sealArchive(Buffer.from('PGDMP\0private-test-content'), key);
  assert.throws(() => openArchive(original, randomBytes(32)), /authentication failed/);
  for (const index of [0, 20, 35, original.length - 1]) {
    const changed = Buffer.from(original);
    changed[index] ^= 1;
    assert.throws(() => openArchive(changed, key));
  }
  assert.throws(() => openArchive(original.subarray(0, original.length - 1), key));
  assert.throws(() => openArchive(Buffer.alloc(0), key));
  assert.throws(() => sealArchive(Buffer.from('PGDMP'), Buffer.alloc(31)));
});

test('source configuration requires verified remote TLS and ignores ambient database secrets', () => {
  const config = connectionEnvironment('postgresql://operator:p%40ss@db.example.invalid/postgres?sslmode=verify-full');
  assert.equal(config.PGPASSWORD, 'p@ss');
  assert.equal(config.PGSSLMODE, 'verify-full');
  assert.equal(config.DATABASE_URL, undefined);
  assert.match(config.PGOPTIONS, /default_transaction_read_only=on/);
  for (const query of ['sslmode=disable', 'sslmode=require', 'host=evil.invalid', 'options=evil', 'service=production']) {
    assert.throws(() => connectionEnvironment(`postgresql://u:p@db.example.invalid/postgres?${query}`));
  }
  for (const invalid of ['', 'https://user:pass@example.invalid/db', 'postgresql://localhost', 'postgresql://u:p@localhost/bad%2Fdb']) {
    assert.throws(() => connectionEnvironment(invalid));
  }
});

test('restore only admits explicitly named loopback drill databases', () => {
  assert.equal(connectionEnvironment('postgresql://u:p@127.0.0.1:55432/dabboba_restore_drill_local', { restore: true }).PGDATABASE, 'dabboba_restore_drill_local');
  for (const invalid of [
    'postgresql://u:p@127.0.0.1/postgres',
    'postgresql://u:p@localhost/dabboba_integration',
    'postgresql://u:p@db.supabase.co/dabboba_restore_drill_local',
    'postgresql://u:p@localhost.evil.invalid/dabboba_restore_drill_local',
    'postgresql://u:p@127.0.0.1/dabboba_restore_drill_local?host=remote',
  ]) assert.throws(() => connectionEnvironment(invalid, { restore: true }));
});

test('verify is offline; tampered restore fails before any database tool is invoked', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dabboba-backup-unit-'));
  await chmod(directory, 0o700);
  const keyFile = join(directory, 'fixture-key');
  const archiveFile = join(directory, 'fixture.dbbenc');
  try {
    const key = randomBytes(32);
    await writeFile(keyFile, key, { mode: 0o600 });
    await writeFile(archiveFile, sealArchive(fixtureBundle(), key), { mode: 0o600 });
    assert.deepEqual(await backupMain(['verify', archiveFile, keyFile], {}), { status: 'archive-authenticated', databaseRestored: false });
    await assert.rejects(backupMain(['restore', archiveFile, keyFile], {}), /APPROVE_LOCAL_RESTORE/);
    const changed = await readFile(archiveFile);
    changed[changed.length - 1] ^= 1;
    await writeFile(archiveFile, changed);
    await assert.rejects(backupMain(['restore', archiveFile, keyFile], {
      DABBOBA_APPROVE_LOCAL_RESTORE: 'YES',
      DABBOBA_RESTORE_DRILL_URL: 'postgresql://u:secret@127.0.0.1/dabboba_restore_drill_never_touched',
      DABBOBA_DB_TOOL_CONTAINER: 'dabboba-nonexistent-must-not-be-invoked',
    }), /authentication failed/);
  } finally { await rm(directory, { recursive: true }); }
});

test('snapshot bundle preserves dump bytes, bigint IDs and raw JSON numbers without SQL interpolation', () => {
  const manifest = queueManifest();
  manifest.queues[0].live.rowsJson = manifest.queues[0].live.rowsJson.replace('"headers":null', '"headers":{"large":9223372036854775002}');
  const dump = Buffer.from('PGDMP\0binary-content');
  const unpacked = unpackBackupBundle(packBackupBundle(dump, manifest));
  assert.deepEqual(unpacked.dump, dump);
  assert.deepEqual(unpacked.manifest, manifest);
  const sql = queueRestoreSql(unpacked.manifest);
  assert.match(sql, /OVERRIDING SYSTEM VALUE/);
  assert.match(sql, /setval\('pgmq.q_dabboba_worker_msg_id_seq',9223372036854775001,true\)/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql, /DROP DATABASE|\\! touch/);
  const encoded = [...sql.matchAll(/decode\('([a-f0-9]+)','hex'\)/g)].map((match) => Buffer.from(match[1], 'hex').toString());
  assert.ok(encoded.includes(manifest.queues[0].live.rowsJson));
  assert.ok(encoded.some((json) => json.includes('9223372036854775002')));
});

test('unsafe names, variants, malformed manifests and backwards sequence counters fail before restore SQL', () => {
  const alterations = [
    (m) => { m.version = 1; },
    (m) => { delete m.queues[0].name; },
    (m) => { delete m.extensions[0].version; },
    (m) => { m.queues[0].name = 'worker;DROP DATABASE x'; },
    (m) => { m.queues[0].isPartitioned = true; },
    (m) => { m.queues[0].isUnlogged = true; },
    (m) => { m.queues[0].sequence.lastValue = '1'; },
    (m) => { m.queues[0].sequence.increment = '-1'; },
    (m) => { m.queues[0].sequence.lastValue = '9223372036854775808'; },
    (m) => { m.queues[0].sequence.cycle = true; },
    (m) => { m.queues[0].live.rowsJson = '[{"message":"missing identity"}]'; },
    (m) => { m.extensions[0].version = "1.5.1';COMMIT;--"; },
  ];
  for (const alter of alterations) {
    const manifest = queueManifest();
    alter(manifest);
    assert.throws(() => validateQueueManifest(manifest));
    assert.throws(() => queueRestoreSql(manifest));
  }
  assert.throws(() => unpackBackupBundle(Buffer.from('PGDMPlegacy-missing-queue-metadata')));
  const valid = packBackupBundle(Buffer.from('PGDMPfixture'), emptyManifest());
  const corrupted = Buffer.from(valid);
  corrupted.writeUInt32BE(0xffffffff, Buffer.byteLength('DABBOBA-SNAPSHOT-BUNDLE2\n'));
  assert.throws(() => unpackBackupBundle(corrupted));
});

test('CLI refuses plaintext, repository paths, shared key permissions and symlinks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dabboba-backup-path-unit-'));
  await chmod(directory, 0o700);
  const keyFile = join(directory, 'key');
  const archiveFile = join(directory, 'archive.dbbenc');
  try {
    await writeFile(keyFile, randomBytes(32), { mode: 0o600 });
    await writeFile(archiveFile, Buffer.from('PGDMPplaintext'), { mode: 0o600 });
    await assert.rejects(backupMain(['verify', archiveFile, keyFile]), /Invalid encrypted archive/);
    await assert.rejects(backupMain(['backup', new URL('../forbidden.dbbenc', import.meta.url).pathname, keyFile]), /outside the repository/);
    await chmod(keyFile, 0o644);
    await assert.rejects(backupMain(['verify', archiveFile, keyFile]), /permissions/);
    await chmod(keyFile, 0o600);
    await writeFile(keyFile, Buffer.alloc(33));
    await assert.rejects(backupMain(['verify', archiveFile, keyFile]), /exactly 32/);
    await writeFile(keyFile, randomBytes(32));
    const link = join(directory, 'key-link');
    await symlink(keyFile, link);
    await assert.rejects(backupMain(['verify', archiveFile, link]), /Symlinks/);
  } finally { await rm(directory, { recursive: true }); }
});
