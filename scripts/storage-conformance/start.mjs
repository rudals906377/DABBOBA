import { setTimeout as delay } from 'node:timers/promises';
import { names, prefix, docker, storageEnvironment, storageImage, localOrigin } from './local-fixture.mjs';

// Released official Storage compose selects pgvector:pg15. The resolved digest is
// passed explicitly to make this local run reproducible without editing a lockfile.
const pgImage = process.argv[2];
if (!/^pgvector\/pgvector@sha256:[a-f0-9]{64}$/.test(pgImage ?? '')) throw new Error('Supply the resolved official pgvector:pg15 image digest');
const existing = new Set(docker(['ps', '-a', '--format', '{{.Names}}']).split('\n'));
if (Object.values(names).some(name => existing.has(name)) || docker(['network', 'ls', '--format', '{{.Name}}']).split('\n').includes(names.network)) {
  throw new Error('Fixture handle already exists; refusing to reuse or change it');
}
docker(['network', 'create', '--label', `dabboba.conformance=${prefix}`, names.network]);
docker(['run', '-d', '--name', names.db, '--network', names.network, '--network-alias', 'conformance-db', '--label', `dabboba.conformance=${prefix}`, '--memory', '768m', '--cpus', '2', '--tmpfs', '/var/lib/postgresql/data:rw', '-e', 'POSTGRES_PASSWORD=local-conformance-postgres', pgImage]);
let ready = false;
for (let i = 0; i < 30; i++) {
  try { docker(['exec', names.db, 'pg_isready', '-U', 'postgres']); ready = true; break; } catch { await delay(1000); }
}
if (!ready) throw new Error('Isolated PostgreSQL did not become ready');
const env = storageEnvironment();
docker(['run', '-d', '--name', names.storage, '--network', names.network, '--label', `dabboba.conformance=${prefix}`, '--memory', '768m', '--cpus', '2', '--tmpfs', '/var/lib/storage:rw,mode=1777', '-p', '127.0.0.1::5000', ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]), storageImage]);
const origin = localOrigin();
for (let i = 0; i < 45; i++) {
  try { if ((await fetch(`${origin}/status`, { signal: AbortSignal.timeout(1000) })).ok) {
    console.log(JSON.stringify({ names, origin, storageImage, pgImage, backend: 'file', database: 'new isolated tmpfs PostgreSQL', network: 'dedicated bridge; only loopback port published' }, null, 2));
    process.exit(0);
  } } catch { /* Start-up only, never a failed conformance retry. */ }
  await delay(1000);
}
throw new Error('Storage startup failed; inspect only this fixture container logs');
