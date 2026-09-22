import { createServer, request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { names, prefix, docker, storageEnvironment, storageImage, localOrigin } from './local-fixture.mjs';

// A second API uses the same isolated fixture database but a separate file store.
// Tests must create fresh buckets; never reuse object rows from the direct API.
const name = `${prefix}-gateway-api`;
if (docker(['ps', '-a', '--format', '{{.Names}}']).split('\n').includes(name)) throw new Error('Gateway fixture already exists; refusing to replace it');
const env = { ...storageEnvironment(), S3_PROTOCOL_PREFIX: '/storage/v1' };
docker(['run', '-d', '--name', name, '--network', names.network, '--label', `dabboba.conformance=${prefix}`, '--memory', '768m', '--cpus', '2', '--tmpfs', '/var/lib/storage:rw,mode=1777', '-p', '127.0.0.1::5000', ...Object.entries(env).flatMap(([k,v]) => ['-e', `${k}=${v}`]), storageImage]);
const upstream = localOrigin(name);
let ready = false;
for (let i = 0; i < 30; i++) {
  try { if ((await fetch(`${upstream}/status`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch { /* startup only */ }
  await delay(1000);
}
if (!ready) throw new Error('Local gateway Storage API did not start');
const server = createServer((req, res) => {
  if (!req.url?.startsWith('/storage/v1/')) { res.writeHead(404).end(); return; }
  // Preserve the signed Host header and exact query; only remove gateway prefix.
  const target = new URL(upstream);
  const forwarded = httpRequest({ hostname: target.hostname, port: target.port, method: req.method, path: req.url.slice('/storage/v1'.length), headers: req.headers }, response => {
    res.writeHead(response.statusCode, response.headers);
    response.pipe(res);
  });
  forwarded.setTimeout(15_000, () => forwarded.destroy(new Error('local proxy timeout')));
  forwarded.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.on('aborted', () => forwarded.destroy());
  req.pipe(forwarded);
});
server.listen(0, '127.0.0.1', () => {
  const origin = `http://127.0.0.1:${server.address().port}`;
  console.log(JSON.stringify({ pid: process.pid, gatewayContainer: name, upstream, projectUrl: origin, s3Endpoint: `${origin}/storage/v1/s3`, note: 'LOCAL ONLY; fresh bucket required for each test' }, null, 2));
});
