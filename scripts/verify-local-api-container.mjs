#!/usr/bin/env node
// Local disposable-DB smoke only. Never loads .env, builds/pulls an image,
// migrates a database, contacts a hosted provider, or prints credentials/logs.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const args = process.argv.slice(2);
if (![2, 3].includes(args.length) || args[0] !== '--image' || !/^sha256:[a-f0-9]{64}$/.test(args[1])
  || (args.length === 3 && args[2] !== '--local-test-db')) {
  process.stderr.write('Usage: node scripts/verify-local-api-container.mjs --image sha256:<immutable-local-image-id> [--local-test-db]\n');
  process.exit(64);
}
const imageId = args[1];
const localTest = args[2] === '--local-test-db';
const dbContainer = 'dabboba-backend-integration-20260905';
const database = 'dabboba_integration';
const databasePort = '53168';
const suffix = randomBytes(6).toString('hex');
const containerName = `dabboba-api-image-smoke-${suffix}`;
const applicationName = `dabboba_image_smoke_${suffix}`;
const commandEnv = { PATH: process.env.PATH, HOME: process.env.HOME };
let createdId;
let stage = 'local fixture validation';
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function docker(args, env = commandEnv, timeout = 10_000) {
  return (await execute('docker', args, { env, timeout, maxBuffer: 1024 * 1024 })).stdout.trim();
}
async function inspect(target) { return JSON.parse(await docker(['inspect', target]))[0]; }
async function query(sql) {
  return docker(['exec', dbContainer, 'psql', '-X', '--no-psqlrc', '-U', 'postgres', '-d', database,
    '--set=ON_ERROR_STOP=1', '--tuples-only', '--no-align', '--command', sql]);
}
async function databaseFingerprint() {
  const snapshot = await query(`SELECT json_build_object(
    'migrations', (SELECT json_agg(row_to_json(m) ORDER BY m.version) FROM public.schema_migrations m),
    'relations', (SELECT json_agg(json_build_array(c.oid,c.relname,c.relkind,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity) ORDER BY c.oid)
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
    'constraints', (SELECT json_agg(json_build_array(c.oid,c.conname,pg_get_constraintdef(c.oid)) ORDER BY c.oid)
      FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public'))::text;`);
  const value = JSON.parse(snapshot);
  assert.ok(Array.isArray(value.migrations) && value.migrations.length > 0);
  return { digest: createHash('sha256').update(snapshot).digest('hex'), migrations: value.migrations.length };
}
async function connections() {
  return Number(await query(`SELECT count(*) FROM pg_stat_activity WHERE datname='${database}' AND application_name='${applicationName}';`));
}
try {
  const db = await inspect(dbContainer);
  assert.equal(db.Name, `/${dbContainer}`);
  assert.equal(db.State.Running, true);
  assert.deepEqual(db.NetworkSettings.Ports['5432/tcp'], [{ HostIp: '127.0.0.1', HostPort: databasePort }]);
  const image = JSON.parse(await docker(['image', 'inspect', imageId]))[0];
  assert.equal(image.Id, imageId);
  assert.equal(image.Config.User, 'node');
  assert.deepEqual(image.Config.Entrypoint, ['docker-entrypoint.sh']);
  assert.deepEqual(image.Config.Cmd, ['node', 'dist/index.js']);
  // Read only the existing fixed disposable fixture literal; do not import
  // its executable test runner or read any application/environment file.
  const fixture = await readFile(new URL('./verify-local-backend.mjs', import.meta.url), 'utf8');
  const password = fixture.match(/postgresql:\/\/dabboba_runtime:([^@`]+)@127\.0\.0\.1:\$\{port\}\/\$\{sourceDatabase\}/)?.[1];
  assert.ok(password && /^[A-Za-z0-9-]+$/.test(password));
  const runtimeUrl = new URL(`postgresql://dabboba_runtime:${password}@host.docker.internal:${databasePort}/${database}`);
  // This unique session label is independently checked after the GET probes.
  // Do not infer session read-only enforcement from connection-string options.
  runtimeUrl.searchParams.set('application_name', applicationName);
  const before = await databaseFingerprint();
  assert.equal(await connections(), 0);
  stage = 'restricted container creation';
  createdId = await docker(['create', '--name', containerName, '--label', 'dabboba.fixture=local-api-image-smoke',
    '--pull=never', '--cpus=1', '--memory=512m', '--memory-swap=512m', '--pids-limit=128', '--read-only',
    '--cap-drop=ALL', '--security-opt=no-new-privileges', '--publish', '127.0.0.1::8080',
    '--env', 'DATABASE_URL', '--env', 'SESSION_TOKEN_PEPPER', '--env', `NODE_ENV=${localTest ? 'test' : 'production'}`,
    '--env', 'API_HOST=0.0.0.0',
    '--env', 'API_SURFACE=customer', '--env', 'PORT=8080', '--env', 'PAYMENT_PROVIDER=UNCONFIGURED',
    '--env', 'MEDIA_STORAGE_PROVIDER=gcs', '--env', 'SUPABASE_URL=https://api-container-smoke.invalid',
    '--env', 'WEB_ORIGINS=https://customer-smoke.invalid', '--env', 'LOG_LEVEL=info', imageId],
  { ...commandEnv, DATABASE_URL: runtimeUrl.toString(), SESSION_TOKEN_PEPPER: randomBytes(48).toString('hex') });
  assert.match(createdId, /^[a-f0-9]{64}$/);
  stage = 'container start';
  await docker(['start', createdId]);
  stage = 'observed runtime confinement';
  const running = await inspect(createdId);
  assert.equal(running.Image, imageId);
  assert.equal(running.Config.User, 'node');
  assert.deepEqual(running.Config.Cmd, image.Config.Cmd);
  assert.deepEqual(running.Config.Entrypoint, image.Config.Entrypoint);
  assert.equal(running.HostConfig.NanoCpus, 1_000_000_000);
  assert.equal(running.HostConfig.Memory, 512 * 1024 * 1024);
  assert.equal(running.HostConfig.MemorySwap, 512 * 1024 * 1024);
  assert.equal(running.HostConfig.ReadonlyRootfs, true);
  assert.deepEqual(running.HostConfig.CapDrop, ['ALL']);
  assert.ok(running.HostConfig.SecurityOpt.includes('no-new-privileges'));
  assert.deepEqual(running.Mounts, []);
  if (!localTest) {
    stage = 'expected production hostname rejection';
    const exit = await docker(['wait', createdId], commandEnv, 15_000);
    const stopped = await inspect(createdId);
    assert.equal(exit, '1'); assert.equal(stopped.State.OOMKilled, false);
    const logs = await execute('docker', ['logs', '--tail=50', createdId], { env: commandEnv, timeout: 5000, maxBuffer: 128 * 1024 });
    assert.ok((logs.stdout + logs.stderr).includes('Error: Production database URLs must use an approved Supabase hostname'));
    assert.equal(await connections(), 0);
    assert.deepEqual(await databaseFingerprint(), before);
    process.stdout.write('Production boundary PASS: default CMD correctly rejects the fixed non-Supabase local DB hostname, exit 1/OOM false.\n');
    process.stdout.write('No production health/DB/TLS/provider success is claimed; hostname and TLS guards remain unchanged.\n');
  } else {
  const ports = running.NetworkSettings.Ports['8080/tcp'];
  assert.equal(ports.length, 1); assert.equal(ports[0].HostIp, '127.0.0.1');
  assert.match(ports[0].HostPort, /^[0-9]{1,5}$/);
  const baseUrl = `http://127.0.0.1:${ports[0].HostPort}`;
  const request = (path, method = 'GET') => fetch(`${baseUrl}${path}`, {
    method, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(3000),
    headers: { Accept: 'application/json' },
  });
  stage = 'test-mode readiness with the local runtime DB role';
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { const response = await request('/readyz'); ready = response.status === 200; await response.arrayBuffer(); } catch { /* bounded startup polling */ }
    if (ready) break;
    if (!(await inspect(createdId)).State.Running) throw new Error('startup-exited');
    await pause(250);
  }
  assert.ok(ready);
  stage = 'default PID 1 identity';
  const identity = JSON.parse(await docker(['exec', createdId, 'node', '--input-type=module', '-e',
    "import{readFileSync}from'node:fs';const s=readFileSync('/proc/1/status','utf8');console.log(JSON.stringify({uid:s.match(/^Uid:\\s+(\\d+)/m)?.[1],cmd:readFileSync('/proc/1/cmdline','utf8').split('\\0').filter(Boolean)}))"]));
  assert.notEqual(identity.uid, '0'); assert.match(identity.uid, /^[1-9][0-9]*$/);
  assert.deepEqual(identity.cmd, ['node', 'dist/index.js']);
  process.stdout.write('LOCAL TEST MODE: exact image/default customer CMD; nonroot PID 1; CPU 1/512 MiB; read-only filesystem, no capabilities/mounts.\n');
  stage = 'HTTP boundary probes';
  for (const [path, method, status] of [
    ['/healthz', 'GET', 200], ['/readyz', 'GET', 200], ['/v1/catalog/home-sections', 'GET', 200],
    ['/v1/catalog/products?limit=1', 'GET', 200], ['/v1/account/profile', 'GET', 401],
    ['/v1/admin/products', 'GET', 404],
  ]) {
    const response = await request(path, method);
    assert.equal(response.status, status);
    if (path.startsWith('/v1/catalog/products')) {
      const body = await response.json();
      assert.ok(Array.isArray(body.items) && body.items.length <= 1);
      assert.ok(body.nextCursor === null || typeof body.nextCursor === 'string');
      for (const item of body.items) {
        assert.equal(typeof item.id, 'string'); assert.equal(typeof item.name, 'string');
        assert.ok(['gacha', 'kuji', 'figure', 'tcg'].includes(item.category));
      }
    } else await response.arrayBuffer();
    process.stdout.write(`${method} ${path}: ${status}\n`);
  }
  assert.ok(await connections() > 0);
  const roles = await query(`SELECT coalesce(bool_and(usename='dabboba_runtime'),false) FROM pg_stat_activity WHERE datname='${database}' AND application_name='${applicationName}';`);
  assert.equal(roles, 't');
  stage = 'SIGTERM and database closure';
  const started = Date.now();
  await docker(['kill', '--signal=SIGTERM', createdId]);
  assert.equal(await docker(['wait', createdId], commandEnv, 15_000), '0');
  const stopped = await inspect(createdId);
  assert.equal(stopped.State.Running, false); assert.equal(stopped.State.ExitCode, 0); assert.equal(stopped.State.OOMKilled, false);
  assert.equal(await connections(), 0);
  assert.deepEqual(await databaseFingerprint(), before);
  process.stdout.write(`SIGTERM: exit 0 in ${Date.now() - started} ms; OOM false; runtime DB connections closed; ${before.migrations} migrations/schema unchanged.\n`);
  process.stdout.write('Local image smoke passed. No hosted storage/auth/payment call, migration, mobile service change, or production readiness proof.\n');
  }
} catch (error) {
  // Child errors may contain connection strings or full Docker environment.
  const category = error?.code === 'ERR_ASSERTION' ? 'assertion' : 'command/request';
  process.stderr.write(`Local API image smoke failed during ${stage} (${category}); no credential-bearing diagnostics were printed.\n`);
  if (createdId) {
    try {
      const logs = await execute('docker', ['logs', '--tail=50', createdId], { env: commandEnv, timeout: 5000, maxBuffer: 128 * 1024 });
      const report = logs.stdout + logs.stderr;
      const missing = report.match(/Cannot find (?:package|module) ['"]([A-Za-z0-9@_./-]+)['"]/);
      if (missing) process.stderr.write(`Startup dependency missing: ${missing[1]}\n`);
      else {
        const codes = [...new Set(report.match(/\b(?:ERR_[A-Z_]+|EACCES|EROFS|ECONNREFUSED|ENOTFOUND|ENOENT|FATAL)\b/g) || [])];
        process.stderr.write(`Sanitized startup error codes: ${codes.join(',') || 'unclassified'}\n`);
      }
      if (report.includes('Error: Production database URLs must use an approved Supabase hostname')) {
        process.stderr.write('Production database URLs must use an approved Supabase hostname; the fixed local target is correctly rejected.\n');
      }
    } catch { process.stderr.write('Sanitized startup diagnostics unavailable.\n'); }
  }
  process.exitCode = 1;
} finally {
  if (createdId && /^[a-f0-9]{64}$/.test(createdId)) {
    try {
      const own = await inspect(createdId);
      assert.equal(own.Name, `/${containerName}`);
      assert.equal(own.Config.Labels?.['dabboba.fixture'], 'local-api-image-smoke');
      await docker(['rm', '--force', createdId]);
      process.stdout.write('Removed only this temporary API smoke container; existing DB/container/images were preserved.\n');
    } catch {
      process.stderr.write('Temporary smoke container cleanup needs inspection; no other resource was removed.\n');
      process.exitCode = 1;
    }
  }
}
