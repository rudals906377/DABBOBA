import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { SupabaseMediaStorage, MediaStorageError } from '../dist/index.js';
import { accessKey, secretKey, region, serviceToken } from '../../../scripts/storage-conformance/local-fixture.mjs';

// Explicit, disposable loopback fixture only. Never reads project .env.
const argument = process.argv[2];
if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}$/.test(argument ?? '') || process.argv.length !== 3) {
  console.error('Usage: node packages/media-storage/scripts/local-conformance.mjs http://127.0.0.1:<fixture-port>');
  process.exit(64);
}
const origin = new URL(argument).origin;
const bucket = `adapter-${randomUUID()}`;
const serviceKey = serviceToken();
const storage = new SupabaseMediaStorage({
  url: origin, s3Endpoint: `${origin}/storage/v1/s3`, bucket, serviceKey,
  s3AccessKeyId: accessKey, s3SecretAccessKey: secretKey, s3Region: region, allowLocalHttp: true,
});
const mediaId = randomUUID();
const rawKey = `uploads/${mediaId}/original.webp`;
const data = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
const checksumSha256 = createHash('sha256').update(data).digest('hex');
const finalKey = `media/${mediaId}/${checksumSha256}-${randomUUID()}.webp`;
const observations = [];
let stage = 'private fixture bucket creation';
let created = false;
async function request(path, init = {}) {
  return fetch(`${origin}/storage/v1${path}`, {
    ...init, redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { authorization: `Bearer ${serviceKey}`, apikey: serviceKey, ...init.headers },
  });
}
async function collect(key, version) {
  const chunks = [];
  for await (const part of storage.read(key, version)) chunks.push(part);
  return Buffer.concat(chunks);
}
try {
  const createdResponse = await request('/bucket', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: bucket, name: bucket, public: false }),
  });
  assert.equal(createdResponse.status, 200); await createdResponse.arrayBuffer(); created = true;
  stage = 'SDK signed raw PUT';
  const upload = await storage.createUpload({ key: rawKey, mediaId, checksumSha256, byteSize: data.length, mimeType: 'image/webp', expiresAt: new Date(Date.now() + 120_000) });
  const put = await fetch(upload.uploadUrl, { method: upload.method, headers: upload.headers, body: data, redirect: 'error', signal: AbortSignal.timeout(15_000) });
  assert.equal(put.status, 200); await put.arrayBuffer();
  observations.push('SDK-signed PUT accepted by real v1.73.0');
  stage = 'signed header tampering rejection';
  const tampered = await fetch(upload.uploadUrl, { method: 'PUT', headers: { ...upload.headers, 'x-amz-meta-media-id': randomUUID() }, body: data, redirect: 'error', signal: AbortSignal.timeout(15_000) });
  assert.equal(tampered.status, 403); await tampered.arrayBuffer();
  observations.push('modified signed metadata rejected with 403');
  stage = 'native stat and UUID-pinned read';
  const raw = await storage.stat(rawKey);
  assert.equal(raw.size, data.length); assert.equal(raw.metadata.sha256, checksumSha256);
  assert.deepEqual(await collect(rawKey, raw.version), data);
  observations.push('native info and authenticated read preserve exact UUID and bytes');
  stage = 'missing UUID fails closed';
  await assert.rejects(collect(rawKey, randomUUID()), error => error instanceof MediaStorageError);
  observations.push('unknown UUID rejected safely');
  stage = 'native unique-claim final upload and actual-byte verification';
  const final = await storage.writeFinal(finalKey, data, { mediaId, checksumSha256 });
  assert.equal(final.metadata['media-id'], mediaId); assert.equal(final.metadata.sha256, checksumSha256);
  assert.deepEqual(await collect(finalKey, final.version), data);
  observations.push('native final upload verifies no-store metadata plus actual pinned SHA/size/type');
  stage = 'native UUID-pinned signed read';
  const signed = await storage.signedRead(finalKey, final.version, 30);
  const download = await fetch(signed, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  stage = `native signed read HTTP ${download.status}`;
  assert.equal(download.status, 200);
  stage = 'native signed read expiry header matches pinned token expiry';
  // v1.73.0 renderer sets Expires instead of Cache-Control for signed downloads.
  // This is a measured limitation, not proof of hosted CDN cache behavior.
  const claims = JSON.parse(Buffer.from(new URL(signed).searchParams.get('token').split('.')[1], 'base64url').toString());
  assert.equal(claims.versionId, final.version);
  assert.equal(Date.parse(download.headers.get('expires')), claims.exp * 1000);
  assert.equal(download.headers.get('cache-control'), null);
  stage = 'native signed read body identity';
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), data);
  observations.push('native versionId signed read returns exact bytes; Expires equals token exp, Cache-Control absent in v1.73.0');
  stage = 'idempotent delete';
  await storage.deleteObject(rawKey); await storage.deleteObject(rawKey);
  await storage.deleteObject(finalKey); await storage.deleteObject(finalKey);
  observations.push('both own keys deleted twice safely');
} catch (error) {
  console.error(JSON.stringify({ stage, status: 'failed', code: error instanceof MediaStorageError ? error.code : 'ASSERTION_OR_FIXTURE_FAILURE', httpStatus: error instanceof MediaStorageError ? error.statusCode : undefined }));
  process.exitCode = 1;
} finally {
  if (created) {
    try {
      await storage.deleteObject(rawKey); await storage.deleteObject(finalKey);
      const removed = await request(`/bucket/${bucket}`, { method: 'DELETE' });
      assert.equal(removed.status, 200); await removed.arrayBuffer();
      observations.push('only this run\'s fresh private bucket removed');
    } catch { console.error(JSON.stringify({ stage: 'own fixture cleanup', status: 'failed', bucket })); process.exitCode = 1; }
  }
}
console.log(JSON.stringify({ evidence: 'real local Supabase Storage v1.73.0 file backend; not hosted/CDN conformance', observations }, null, 2));
