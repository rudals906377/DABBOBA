#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { accessKey, secretKey, region, serviceToken } from './storage-conformance/local-fixture.mjs';

const execute = promisify(execFile);
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--storage-url' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(args[1])) {
  throw new Error('Usage: node scripts/verify-local-storage.mjs --storage-url http://127.0.0.1:PORT');
}
const fixtureContainer = 'dabboba-backend-integration-20260905';
const { stdout } = await execute('docker', ['inspect', '--format', '{{json .NetworkSettings.Ports}}', fixtureContainer]);
const binding = JSON.parse(stdout)['5432/tcp'];
if (!Array.isArray(binding) || binding.length !== 1 || binding[0].HostIp !== '127.0.0.1') throw new Error('Not the dedicated loopback database');
const port = binding[0].HostPort;
await execute('docker', ['exec', fixtureContainer, 'pg_isready', '-U', 'postgres', '-d', 'dabboba_integration']);
const storage = {
  url: args[1], s3Endpoint: `${args[1]}/storage/v1/s3`, serviceKey: serviceToken(),
  s3AccessKeyId: accessKey, s3SecretAccessKey: secretKey, s3Region: region,
  bucket: `api-conformance-${randomUUID()}`, allowLocalHttp: true,
};
const bucket = await fetch(`${storage.url}/storage/v1/bucket`, {
  method: 'POST', headers: { authorization: `Bearer ${storage.serviceKey}`, 'content-type': 'application/json' },
  body: JSON.stringify({ id: storage.bucket, name: storage.bucket, public: false }),
  redirect: 'error', signal: AbortSignal.timeout(10_000),
});
if (bucket.status !== 200) throw new Error(`Local fixture bucket creation failed (${bucket.status})`);
try {
  const result = await execute('corepack', ['pnpm', '--filter', '@dabboba/api', 'test:storage'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), timeout: 180_000, maxBuffer: 4 * 1024 * 1024,
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test',
      DABBOBA_TEST_DATABASE_URL: `postgresql://postgres:dabboba-disposable-local-only-20260905@127.0.0.1:${port}/dabboba_integration`,
      DABBOBA_RUNTIME_TEST_DATABASE_URL: `postgresql://dabboba_runtime:dabboba-runtime-disposable-only-20260905@127.0.0.1:${port}/dabboba_integration`,
      DABBOBA_TEST_STORAGE_CONFIG: JSON.stringify(storage),
    },
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
} catch (error) {
  // Only disposable fixture inputs are used; test assertions intentionally
  // print status/codes, never signed URLs, tokens, provider bodies or config.
  process.stdout.write(error.stdout ?? '');
  process.stderr.write(error.stderr ?? 'Local Storage integration failed.');
  process.exitCode = 1;
}
