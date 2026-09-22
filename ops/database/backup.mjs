#!/usr/bin/env node
// Offline operator tooling. Never imported by API/Worker or shipped to the app.
import { execFile, spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { captureQueueManifest, packBackupBundle, queueRestoreSql, unpackBackupBundle } from './backup-pgmq.mjs';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MAGIC = Buffer.from('DABBOBA-PGDUMP-GCM1\n');
export const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const HEADER_SIZE = MAGIC.length + 12 + 16;
const fail = (message) => { throw new Error(message); };
const executeFile = promisify(execFile);

export function connectionEnvironment(raw, { restore = false } = {}) {
  let url;
  try { url = new URL(raw); } catch { fail('Invalid database connection configuration.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hash || !url.username || !url.hostname) {
    fail('Invalid database connection configuration.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const allowed = new Set(['sslmode', 'sslrootcert']);
  if ([...url.searchParams.keys()].some((key) => !allowed.has(key))) fail('Connection query overrides are prohibited.');
  const decode = (value) => {
    try { return decodeURIComponent(value); } catch { fail('Invalid database connection configuration.'); }
  };
  const database = decode(url.pathname.slice(1));
  if (!/^[a-zA-Z0-9_]+$/.test(database)) fail('An explicit database name is required.');
  if (restore && (!local || !/^dabboba_restore_drill_[a-z0-9_]+$/.test(database))) {
    fail('Restore is restricted to a local dedicated dabboba_restore_drill_* database.');
  }
  const sslMode = local ? 'disable' : 'verify-full';
  if (url.searchParams.has('sslmode') && url.searchParams.get('sslmode') !== sslMode) {
    fail('Remote connections require certificate and hostname verification.');
  }
  const rootCertificate = url.searchParams.get('sslrootcert');
  if (rootCertificate && !isAbsolute(rootCertificate)) fail('SSL root certificate path must be absolute.');
  return {
    PATH: process.env.PATH,
    PGHOST: url.hostname.replace(/^\[|\]$/g, ''),
    PGPORT: url.port || '5432',
    PGDATABASE: database,
    PGUSER: decode(url.username),
    PGPASSWORD: decode(url.password),
    PGSSLMODE: sslMode,
    ...(rootCertificate ? { PGSSLROOTCERT: rootCertificate } : {}),
    PGCONNECT_TIMEOUT: '10',
    PGAPPNAME: restore ? 'dabboba-restore-drill' : 'dabboba-backup',
    PGOPTIONS: restore ? '-c statement_timeout=120000' : '-c default_transaction_read_only=on -c statement_timeout=120000',
  };
}

export function sealArchive(archive, key) {
  if (key.length !== 32 || !archive.length || archive.length > MAX_ARCHIVE_BYTES) fail('Invalid key or archive size.');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(MAGIC);
  const ciphertext = Buffer.concat([cipher.update(archive), cipher.final()]);
  return Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), ciphertext]);
}

export function openArchive(sealed, key) {
  if (key.length !== 32 || sealed.length <= HEADER_SIZE || sealed.length > MAX_ARCHIVE_BYTES + HEADER_SIZE
    || !sealed.subarray(0, MAGIC.length).equals(MAGIC)) fail('Invalid encrypted archive.');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(MAGIC.length, MAGIC.length + 12));
    decipher.setAAD(MAGIC);
    decipher.setAuthTag(sealed.subarray(MAGIC.length + 12, HEADER_SIZE));
    // Nothing reaches pg_restore until the complete authentication tag passes.
    return Buffer.concat([decipher.update(sealed.subarray(HEADER_SIZE)), decipher.final()]);
  } catch { fail('Archive authentication failed; no database restore was attempted.'); }
}

async function privatePath(path, { existing = true, directory = false } = {}) {
  if (!isAbsolute(path || '')) fail('Use explicit absolute paths outside the repository.');
  const actual = await realpath(existing ? path : dirname(path));
  const root = await realpath(ROOT);
  const relationship = relative(root, actual);
  if (!relationship.startsWith('..' + '/') && relationship !== '..') fail('Backup and key files must stay outside the repository.');
  if (existing) {
    const info = await lstat(path);
    if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) fail('Symlinks and special files are prohibited.');
    if (info.mode & 0o077) fail('Private directory/file permissions are required (0700/0600).');
  } else {
    await privatePath(dirname(path), { directory: true });
  }
  return resolve(path);
}

function toolCommand(tool, args, env, container) {
  let executable = tool;
  let parameters = args;
  if (container) {
    if (!/^dabboba-[a-z0-9-]+$/.test(container) || !['127.0.0.1', 'localhost', '::1'].includes(env.PGHOST)) {
      fail('Container clients require an explicit DABBOBA-local container and loopback target.');
    }
    executable = 'docker';
    parameters = ['exec', '-i', ...Object.keys(env).filter((name) => name.startsWith('PG')).flatMap((name) => ['-e', name]), container, tool, ...args];
  }
  return { executable, parameters };
}

async function pgTool(tool, args, env, input, container) {
  const { executable, parameters } = toolCommand(tool, args, env, container);
  try {
    const result = executeFile(executable, parameters, { env, encoding: 'buffer', maxBuffer: MAX_ARCHIVE_BYTES, timeout: 180_000 });
    result.child.stdin.on('error', () => {});
    result.child.stdin.end(input);
    return (await result).stdout;
  } catch { fail(`${tool} failed. Check tool version, permissions, target and connectivity privately; raw DB diagnostics were suppressed.`); }
}

function readOnlySnapshotSession(env, container) {
  const command = toolCommand('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-f', '-'], env, container);
  const child = spawn(command.executable, command.parameters, { env, stdio: ['pipe','pipe','pipe'] });
  let pending = null;
  let closed = false;
  let failure = null;
  const reject = () => {
    failure = new Error('Read-only backup snapshot failed; raw DB diagnostics were suppressed.');
    pending?.reject(failure);
    pending = null;
    child.kill();
  };
  const timeout = setTimeout(reject, 180_000);
  child.on('error', reject);
  child.stdin.on('error', reject);
  // Consume diagnostics without retaining potentially sensitive SQL/payloads.
  child.stderr.on('data', () => {});
  child.stdout.on('data', (chunk) => {
    if (!pending) return reject();
    pending.bytes += chunk.length;
    if (pending.bytes > MAX_ARCHIVE_BYTES) return reject();
    pending.chunks.push(chunk);
    pending.tail = Buffer.concat([pending.tail, chunk.subarray(-pending.marker.length)]).subarray(-pending.marker.length);
    if (!pending.tail.equals(pending.marker)) return;
    const result = Buffer.concat(pending.chunks, pending.bytes).subarray(0, pending.bytes - pending.marker.length).toString('utf8').trim();
    const complete = pending.resolve;
    pending = null;
    complete(result);
  });
  const exited = new Promise((resolveExit) => child.on('close', (code) => {
    closed = true;
    clearTimeout(timeout);
    if (pending || code !== 0) reject();
    resolveExit();
  }));
  const query = (sql) => {
    if (closed || failure || pending) return Promise.reject(failure ?? new Error('Invalid backup snapshot session.'));
    const markerText = `DBB_SNAPSHOT_${randomBytes(16).toString('hex')}`;
    return new Promise((resolveQuery, rejectQuery) => {
      pending = { resolve: resolveQuery, reject: rejectQuery, chunks: [], bytes: 0, tail: Buffer.alloc(0), marker: Buffer.from(`\n${markerText}\n`) };
      child.stdin.write(`${sql}\n\\echo\n\\echo ${markerText}\n`);
    });
  };
  return {
    query,
    async close() {
      try { if (!closed && !failure) await query('ROLLBACK;'); } catch {}
      child.stdin.end('\\q\n');
      if (failure) child.kill();
      await exited;
    },
  };
}

export async function backupMain(args, env = process.env) {
  const [action, archiveFile, keyFile, ...extra] = args;
  if (!['backup', 'verify', 'restore'].includes(action) || !archiveFile || !keyFile || extra.length) {
    fail('Usage: node ops/database/backup.mjs backup|verify|restore /absolute/archive.dbbenc /absolute/key-file');
  }
  const keyPath = await privatePath(keyFile);
  if ((await lstat(keyPath)).size !== 32) fail('Key file must contain exactly 32 random bytes; never a password.');
  const key = await readFile(keyPath);
  try {
    if (key.length !== 32) fail('Key file must contain exactly 32 random bytes; never a password.');
    const archivePath = await privatePath(archiveFile, { existing: action !== 'backup' });
    if (archivePath === keyPath) fail('Key and archive paths must differ.');
    const container = env.DABBOBA_DB_TOOL_CONTAINER;
    if (action === 'backup') {
      const connection = connectionEnvironment(env.DABBOBA_BACKUP_SOURCE_URL);
      const session = readOnlySnapshotSession(connection, container);
      let archive;
      let bundle;
      try {
        await session.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL row_security=off; SET LOCAL idle_in_transaction_session_timeout='180s';");
        const version = Number(await session.query('SHOW server_version_num;'));
        if (!Number.isSafeInteger(version) || version < 170000) fail('PostgreSQL 17 or newer is required.');
        const snapshot = await session.query('SELECT pg_export_snapshot();');
        if (!/^[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+$/.test(snapshot)) fail('Invalid exported database snapshot.');
        archive = await pgTool('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--no-password', '--lock-wait-timeout=5000', `--snapshot=${snapshot}`], connection, undefined, container);
        const manifest = await captureQueueManifest(session.query);
        bundle = packBackupBundle(archive, manifest);
        await writeFile(archivePath, sealArchive(bundle, key), { flag: 'wx', mode: 0o600 });
        return { status: 'encrypted-backup-created', queueSnapshotIncluded: true, automaticBackup: false, platformRestoreVerified: false };
      } finally {
        archive?.fill(0);
        bundle?.fill(0);
        await session.close();
      }
    }
    const stat = await lstat(archivePath);
    if (stat.size > MAX_ARCHIVE_BYTES + HEADER_SIZE) fail('Archive exceeds the 256 MiB offline-tool limit.');
    const archive = openArchive(await readFile(archivePath), key);
    try {
      const { manifest, dump } = unpackBackupBundle(archive);
      if (action === 'verify') return { status: 'archive-authenticated', databaseRestored: false };
      if (env.DABBOBA_APPROVE_LOCAL_RESTORE !== 'YES') fail('Set DABBOBA_APPROVE_LOCAL_RESTORE=YES for a disposable local restore.');
      const connection = connectionEnvironment(env.DABBOBA_RESTORE_DRILL_URL, { restore: true });
      const identity = await pgTool('psql', ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', 'SELECT current_database()'], connection, undefined, container);
      if (identity.toString().trim() !== connection.PGDATABASE) fail('Restore target identity mismatch.');
      const objects = await pgTool('psql', ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c',
        `WITH user_namespaces AS (
           SELECT oid,nspname FROM pg_namespace
           WHERE nspname NOT IN ('pg_catalog','information_schema') AND nspname !~ '^pg_'
         ) SELECT
           (SELECT count(*) FROM pg_class WHERE relnamespace IN (SELECT oid FROM user_namespaces)) +
           (SELECT count(*) FROM pg_proc WHERE pronamespace IN (SELECT oid FROM user_namespaces)) +
           (SELECT count(*) FROM pg_type WHERE typnamespace IN (SELECT oid FROM user_namespaces)) +
           (SELECT count(*) FROM user_namespaces WHERE nspname <> 'public') +
           (SELECT count(*) FROM pg_event_trigger) +
           (SELECT count(*) FROM pg_extension WHERE extname <> 'plpgsql')`], connection, undefined, container);
      if (objects.toString().trim() !== '0') fail('Restore target is not empty; no data was overwritten.');
      // Decode all SQL before opening a write transaction. No queue payload is
      // interpolated as SQL or psql syntax; the supplement uses hexadecimal JSON.
      const supplement = Buffer.from(queueRestoreSql(manifest));
      const sql = await pgTool('pg_restore', ['--exit-on-error', '--no-owner', '--no-acl', '--no-password', '--file=-'], connection, dump, container);
      let restore;
      try {
        if (sql.length + supplement.length + 2 > MAX_ARCHIVE_BYTES) fail('Decoded restore SQL exceeds the 256 MiB offline-tool limit.');
        restore = Buffer.concat([sql, Buffer.from('\n'), supplement, Buffer.from('\n')]);
        await pgTool('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', '-'], connection, restore, container);
      } finally {
        sql.fill(0);
        supplement.fill(0);
        restore?.fill(0);
      }
      return { status: 'local-restore-completed', queueSnapshotRestored: true, productionRestored: false, permissionsRevalidated: false };
    } finally { archive.fill(0); }
  } finally { key.fill(0); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  backupMain(process.argv.slice(2)).then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => {
    // Filesystem errors may contain private paths; never stringify raw errors.
    const message = error.code ? 'Backup operation failed; check private file paths and permissions.' : error.message;
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
