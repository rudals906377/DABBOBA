#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Artifact-only proof. No host files/env are mounted, no network is available,
// and the deliberately public signing fixture cannot access any real service.
const execute = promisify(execFile);
const [image, ...extra] = process.argv.slice(2);
if (extra.length || !/^dabboba-(?:api|worker):storage-local-\d{8}$/.test(image ?? '')) {
  throw new Error('Usage: node scripts/verify-local-storage-image.mjs dabboba-{api|worker}:storage-local-YYYYMMDD');
}
const kind = image.startsWith('dabboba-worker:') ? 'worker' : 'api';

const probe = String.raw`
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { loadApiConfig } from '@dabboba/config';
import { SupabaseMediaStorage } from '@dabboba/media-storage';
const kind = process.argv[1];

const entries = await readdir('/app', { recursive: true, withFileTypes: true });
let checkedFiles = 0;
for (const entry of entries) {
  if (!entry.isFile()) continue;
  checkedFiles += 1;
  assert.ok(!/^\.env(?:\.|$)|\.(?:[cm]?ts|map|tsbuildinfo)$|\.(?:test|spec|conformance)\.[cm]?js$/.test(entry.name), 'Forbidden development artifact in runtime image');
  const path = entry.parentPath + '/' + entry.name;
  assert.ok(!/\/migrations\/|\/dist\/(?:migrate|seed|provision-runtime-role|provision-worker-role)\.js$/.test(path), 'Operator-only artifact in runtime image');
  if (/\.[cm]?js$/.test(entry.name)) {
    const source = await readFile(path, 'utf8');
    assert.ok(!/ALTER ROLE %I WITH LOGIN PASSWORD|provision(Runtime|Worker)DatabaseRole/.test(source), 'Operator-only logic in runtime image');
  }
}
assert.ok(checkedFiles > 0);
const base = {
  NODE_ENV: 'production', API_SURFACE: 'customer', PORT: '8080', WEB_ORIGINS: 'https://app.example.test',
  DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
  WORKER_DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
  SESSION_TOKEN_PEPPER: 'public-artifact-probe-value-not-a-production-secret',
  PAYMENT_PROVIDER: 'UNCONFIGURED', MEDIA_STORAGE_PROVIDER: 'supabase',
  SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  SUPABASE_STORAGE_BUCKET: 'private-artifact-probe',
  SUPABASE_STORAGE_S3_ENDPOINT: 'https://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/s3',
  SUPABASE_STORAGE_S3_REGION: 'ap-northeast-2',
  SUPABASE_STORAGE_SERVICE_KEY: 'public-artifact-probe-service-key',
  SUPABASE_STORAGE_S3_ACCESS_KEY_ID: 'public_artifact_probe',
  SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY: 'public-artifact-probe-signing-key',
};
const loadConfig = kind === 'worker' ? (await import('./dist/config.js')).loadWorkerConfig : loadApiConfig;
const config = loadConfig(base);
if (kind === 'worker') {
  assert.equal(config.queueName, 'dabboba_worker');
  assert.equal(config.maxRunSeconds, 45);
  assert.equal(config.queueVisibilitySeconds, 900);
  const { RoutedMediaStore, mediaPendingFinalObjectKeys } = await import('./dist/media.js');
  assert.equal(typeof RoutedMediaStore, 'function');
  assert.equal(typeof mediaPendingFinalObjectKeys, 'function');
} else {
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 8080);
  assert.equal(config.surface, 'customer');
}
assert.equal(config.mediaStorageProvider, 'supabase');
const storage = new SupabaseMediaStorage(config.supabaseStorage);
const id = randomUUID();
const intent = await storage.createUpload({ key: 'uploads/' + id + '/image.png', mediaId: id,
  mimeType: 'image/png', byteSize: 7, checksumSha256: 'a'.repeat(64), expiresAt: new Date(Date.now() + 120000) });
assert.equal(intent.method, 'PUT');
assert.equal(intent.bodyEncoding, 'raw');
assert.equal(intent.headers['content-length'], '7');
const signed = new URL(intent.uploadUrl);
assert.ok(Number(signed.searchParams.get('X-Amz-Expires')) <= 120);
assert.equal(signed.searchParams.get('X-Amz-SignedHeaders'), 'content-length;content-type;host;x-amz-content-sha256;x-amz-meta-media-id;x-amz-meta-sha256');
assert.throws(() => loadConfig({ ...base, SUPABASE_STORAGE_ALLOW_LOCAL_HTTP: 'true' }), /forbidden/);
assert.throws(() => loadConfig({ ...base, SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY: '' }), /Missing or invalid/);
const rollback = loadConfig({ ...base, MEDIA_STORAGE_PROVIDER: 'gcs', GCS_BUCKET: 'legacy-artifact-probe' });
assert.equal(rollback.mediaStorageProvider, 'gcs');
assert.ok(rollback.supabaseStorage);
console.log(JSON.stringify({ kind, checkedFiles, artifactBoundaries: 'passed', productionConfig: 'passed', offlineSigV4: 'passed', network: 'disabled' }));
`;

try {
  const { stdout } = await execute('docker', ['image', 'inspect', image], { maxBuffer: 1024 * 1024 });
  const [metadata] = JSON.parse(stdout);
  assert.match(metadata.Id, /^sha256:[a-f0-9]{64}$/);
  assert.equal(metadata.Config.User, 'node');
  assert.deepEqual(metadata.Config.Cmd, ['node', 'dist/index.js']);
  assert.ok(metadata.Config.Env.includes('NODE_ENV=production'));
  assert.ok(metadata.Config.Env.every((item) => !/^(?:DATABASE_.*|WORKER_DATABASE_URL|SUPABASE_.*|SESSION_TOKEN_PEPPER|GCP_.*)=/.test(item)));
  const result = await execute('docker', ['run', '--rm', '--pull=never', '--network=none', '--cpus=1', '--memory=512m',
    '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--entrypoint=node', metadata.Id, '--input-type=module', '-e', probe, kind],
  { timeout: 60000, maxBuffer: 1024 * 1024 });
  process.stdout.write(result.stdout);
  console.log(JSON.stringify({ imageId: metadata.Id, sizeBytes: metadata.Size, user: metadata.Config.User,
    scope: 'Local image artifact/config/signing only; no API, DB, hosted Storage or deployment proof.' }));
} catch {
  // Never echo child arguments, provider URLs, tokens or environment values.
  console.error('Local Storage image verification failed; no cloud deployment was attempted.');
  process.exitCode = 1;
}
