import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const store = fileURLToPath(new URL('../node_modules/.pnpm/', import.meta.url));
const packageRequire = entry => createRequire(realpathSync(entry));

for (const version of ['5.1.9', '8.0.7']) {
  const caller = packageRequire(`${store}/minimatch@${version}/node_modules/minimatch/package.json`);
  const minimatch = caller('./');
  test(`minimatch ${version} uses genuine brace-expansion 2.1.7 and preserves ordinary expansion`, () => {
    assert.equal(caller('brace-expansion/package.json').version, '2.1.7');
    assert.deepEqual(minimatch.braceExpand('file-{a,b}-{1..3}.js'), [
      'file-a-1.js', 'file-a-2.js', 'file-a-3.js', 'file-b-1.js', 'file-b-2.js', 'file-b-3.js',
    ]);
    assert.deepEqual(minimatch.braceExpand('{01..03}'), ['01', '02', '03']);
    assert.deepEqual(minimatch.braceExpand('x\\{a,b\\}'), ['x{a,b}']);
    assert.deepEqual(minimatch.braceExpand('{a,b}', { nobrace: true }), ['{a,b}']);
  });
  for (const [label, input] of [
    ['nested groups', '{'.repeat(6000) + 'a,b' + '}'.repeat(6000)],
    ['comma parser tail', '{a,' + '{x}'.repeat(10000) + ',b}'],
  ]) {
    test(`minimatch ${version} handles ${label} without native stack exhaustion`, () => {
      const expanded = minimatch.braceExpand(input);
      assert.ok(Array.isArray(expanded) && expanded.length > 0);
      assert.ok(expanded.length <= 100000);
      assert.ok(expanded.reduce((total, item) => total + item.length, 0) <= 4000000);
    });
  }
  test(`minimatch ${version} bounds malformed-brace rewrites and preserves literal input`, () => {
    const source = readFileSync(caller.resolve('brace-expansion'), 'utf8');
    assert.match(source, /EXPANSION_MAX_REWRITES\s*=\s*1000/);
    assert.match(source, /rewrites\s*<\s*maxRewrites/);
    const script = `
      const assert = require('node:assert/strict');
      const minimatch = require(${JSON.stringify(caller.resolve('minimatch'))});
      const input = '{a}' + '}'.repeat(60000) + ',z}';
      assert.deepEqual(minimatch.braceExpand(input), [input]);
      console.log('bounded literal fallback');
    `;
    const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /bounded literal fallback/);
  });
}

const miniflare = readdirSync(store).filter(name => name.startsWith('miniflare@'));
assert.equal(miniflare.length, 1, 'Review additional Miniflare callers before extending these controls');
const caller = packageRequire(`${store}/${miniflare[0]}/node_modules/miniflare/package.json`);
const undici = caller('undici');

test('Miniflare uses the genuine same-patch undici fix, without changing supply-chain gates', () => {
  assert.equal(caller('undici/package.json').version, '7.29.1');
  const workspace = readFileSync(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8');
  assert.match(workspace, /undici@>=7\.0\.0 <7\.29\.1: 7\.29\.1/);
  assert.match(workspace, /brace-expansion@>=2\.0\.0 <2\.1\.7: 2\.1\.7/);
  assert.doesNotMatch(workspace, /auditConfig:|ignoreCves:|ignoredAdvisories:/);
});

test('BalancedPool preserves custom connect/TLS callbacks through its actual factory boundary', async () => {
  for (const functionConnector of [false, true]) {
    const identity = () => new Error('fixture rejection');
    const connector = () => {};
    let forwarded;
    const pool = new undici.BalancedPool('https://127.0.0.1:1', {
      connect: functionConnector ? connector : { checkServerIdentity: identity },
      tls: { checkServerIdentity: identity },
      factory(origin, options) {
        forwarded = options;
        return new undici.Pool(origin, options);
      },
    });
    try {
      assert.equal(functionConnector ? forwarded.connect : forwarded.connect.checkServerIdentity,
        functionConnector ? connector : identity);
      assert.equal(forwarded.tls.checkServerIdentity, identity);
    } finally { await pool.destroy(); }
  }
});

test('Miniflare caller fetch and Pool remain functional against loopback only', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('local fixture');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const pool = new undici.Pool(origin);
  try {
    assert.equal(await (await undici.fetch(origin)).text(), 'local fixture');
    const response = await pool.request({ path: '/', method: 'GET' });
    assert.equal(response.statusCode, 200);
    assert.equal(await response.body.text(), 'local fixture');
    assert.equal(new undici.Headers({ 'x-fixture': 'ok' }).get('x-fixture'), 'ok');
    assert.equal(new undici.Request(origin).method, 'GET');
    assert.equal(await new undici.Response('fixture').text(), 'fixture');
  } finally {
    await pool.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('an unrequested WebSocket subprotocol fails cleanly in an isolated process', () => {
  const entry = caller.resolve('undici');
  const script = `
    const { createHash } = require('node:crypto');
    const { createServer } = require('node:http');
    const { WebSocket } = require(${JSON.stringify(entry)});
    const server = createServer();
    const sockets = new Set();
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    server.on('upgrade', (request, socket) => {
      const accept = createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      socket.write('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: ' + accept + '\\r\\nSec-WebSocket-Protocol: unsolicited\\r\\n\\r\\n');
    });
    let errors = 0;
    server.listen(0, '127.0.0.1', () => {
      const websocket = new WebSocket('ws://127.0.0.1:' + server.address().port);
      websocket.addEventListener('open', () => { process.exitCode = 1; websocket.close(); });
      websocket.addEventListener('error', () => errors++);
      websocket.addEventListener('close', () => {
        for (const socket of sockets) socket.destroy();
        server.close(() => { if (errors !== 1) process.exitCode = 1; console.log('clean handshake rejection'); });
      });
    });
  `;
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.error, undefined);
  assert.match(result.stdout, /clean handshake rejection/);
  assert.doesNotMatch(result.stderr, /TypeError|uncaughtException/);
});
