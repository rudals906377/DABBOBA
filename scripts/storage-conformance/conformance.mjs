import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { accessKey, secretKey, region, serviceToken, localOrigin } from './local-fixture.mjs';

const origin = process.argv[2] ?? localOrigin();
if (!/^http:\/\/127\.0\.0\.1:\d+(?:\/storage\/v1)?$/.test(origin)) throw new Error('Conformance refuses non-loopback targets');
const bucket = `conformance-${randomUUID()}`;
const observations = [];
const sha = value => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const payload = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
const mediaId = randomUUID();
function signingKey(day) { return hmac(hmac(hmac(hmac(`AWS4${secretKey}`, day), region), 's3'), 'aws4_request'); }
function signed(method, key, headers = {}, ageSeconds = 0, expires = 120) {
  const date = new Date(Date.now() - ageSeconds * 1000).toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = date.slice(0, 8);
  const scope = `${day}/${region}/s3/aws4_request`;
  const path = `/s3/${bucket}/${key.split('/').map(encode).join('/')}`;
  const allHeaders = { host: new URL(origin).host, ...headers };
  const signedHeaders = Object.keys(allHeaders).sort();
  const params = { 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${accessKey}/${scope}`, 'X-Amz-Date': date, 'X-Amz-Expires': `${expires}`, 'X-Amz-SignedHeaders': signedHeaders.join(';'), 'X-Amz-Content-Sha256': 'UNSIGNED-PAYLOAD' };
  const query = Object.keys(params).sort().map(k => `${encode(k)}=${encode(params[k])}`).join('&');
  const canonicalPath = `${new URL(origin).pathname.replace(/\/$/, '')}${path}`;
  const canonical = `${method}\n${canonicalPath}\n${query}\n${signedHeaders.map(k => `${k}:${allHeaders[k]}`).join('\n')}\n\n${signedHeaders.join(';')}\nUNSIGNED-PAYLOAD`;
  const signature = hmac(signingKey(day), `AWS4-HMAC-SHA256\n${date}\n${scope}\n${sha(canonical)}`).toString('hex');
  return { url: `${origin}${path}?${query}&X-Amz-Signature=${signature}`, headers };
}
function uploadHeaders(data = payload) { return { 'content-type': 'image/png', 'content-length': `${data.length}`, 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD', 'x-amz-meta-sha256': sha(data), 'x-amz-meta-media-id': mediaId }; }
async function call(path, options = {}) {
  return fetch(`${origin}${path}`, { ...options, headers: { authorization: `Bearer ${serviceToken()}`, ...options.headers }, signal: AbortSignal.timeout(10_000) });
}
async function info(key, version) {
  const response = await call(`/object/info/authenticated/${bucket}/${key}${version ? `?versionId=${encode(version)}` : ''}`);
  return { status: response.status, data: await response.json() };
}
async function expectStatus(label, response, allowed) {
  assert.ok(allowed.includes(response.status), `${label}: expected ${allowed}, received ${response.status}`);
  const body = response.status >= 400 ? await response.clone().text() : '';
  let errorCode = body.match(/<Code>([^<]+)<\/Code>/)?.[1];
  try { errorCode ??= JSON.parse(body).code; } catch { /* S3 errors are XML */ }
  observations.push({ check: label, status: response.status, ...(errorCode ? { errorCode } : {}) });
  return response;
}
async function put(request, body = payload, headers = request.headers) {
  return fetch(request.url, { method: 'PUT', body, headers, signal: AbortSignal.timeout(10_000) });
}
function malformedPut(request, body) {
  return new Promise(resolve => {
    const req = httpRequest(request.url, { method: 'PUT', headers: request.headers }, res => {
      res.resume(); res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.setTimeout(2000, () => req.destroy(new Error('local malformed-body deadline')));
    req.on('error', error => resolve({ transportError: error.code ?? error.message }));
    req.end(body);
  });
}

await expectStatus('private bucket created', await call('/bucket', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: bucket, name: bucket, public: false }) }), [200]);
const key = 'uploads/exact.png';
const request = signed('PUT', key, uploadHeaders());
assert.equal(new URL(request.url).searchParams.get('X-Amz-Expires'), '120');
await expectStatus('120-second exact SigV4 PUT accepted', await put(request), [200]);
const original = await info(key);
assert.equal(original.status, 200);
assert.match(original.data.version, /^[a-f0-9-]{36}$/);
assert.equal(original.data.size, payload.length);
assert.equal(original.data.content_type, 'image/png');
assert.equal(original.data.metadata.sha256, sha(payload));
assert.equal(original.data.metadata['media-id'], mediaId);
observations.push({ check: 'REST info exposes exact metadata and UUID version', status: 200 });
let response = await call(`/object/authenticated/${bucket}/${key}?versionId=${original.data.version}`);
assert.equal(response.status, 200);
assert.equal(sha(Buffer.from(await response.arrayBuffer())), sha(payload));
observations.push({ check: 'authenticated version-pinned bytes match', status: 200 });
response = await call(`/object/sign/${bucket}/${key}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expiresIn: 300, versionId: original.data.version }) });
assert.equal(response.status, 200);
const signedRead = (await response.json()).signedURL;
await expectStatus('REST signed version-pinned read accepted', await fetch(`${origin}${signedRead}`), [200]);
await expectStatus('missing version fails closed', await call(`/object/authenticated/${bucket}/${key}?versionId=${randomUUID()}`), [400, 404]);
for (const [label, header, value] of [
  ['MIME tamper rejected', 'content-type', 'image/jpeg'],
  ['metadata hash tamper rejected', 'x-amz-meta-sha256', '0'.repeat(64)],
  ['media identity tamper rejected', 'x-amz-meta-media-id', randomUUID()],
  ['payload mode tamper rejected', 'x-amz-content-sha256', 'STREAMING-UNSIGNED-PAYLOAD-TRAILER'],
]) await expectStatus(label, await put(request, payload, { ...request.headers, [header]: value }), [400, 403]);
for (const [label, data] of [['short length header rejected', payload.subarray(1)], ['long length header rejected', Buffer.concat([payload, Buffer.from([0])])]]) {
  await expectStatus(label, await put(request, data, { ...request.headers, 'content-length': `${data.length}` }), [400, 403]);
}
await expectStatus('key tamper rejected', await put({ ...request, url: request.url.replace('exact.png', 'other.png') }), [400, 403]);
await expectStatus('120-second URL older than expiry rejected', await put(signed('PUT', 'uploads/expired.png', uploadHeaders(), 121)), [400, 403]);
for (const [label, data] of [['short body under fixed signed length', payload.subarray(1)], ['extra bytes under fixed signed length', Buffer.concat([payload, Buffer.from([0])])]]) {
  const malformedKey = `uploads/${randomUUID()}.png`;
  const result = await malformedPut(signed('PUT', malformedKey, uploadHeaders()), data);
  await delay(100);
  const after = await info(malformedKey);
  if (after.status === 200) assert.equal(after.data.size, payload.length, `${label}: must not persist an object of a different size`);
  observations.push({ check: label, ...result, objectStatus: after.status, storedBytes: after.status === 200 ? after.data.size : null });
}
const changed = Buffer.from(payload); changed[changed.length - 1] ^= 1;
await expectStatus('same-length wrong bytes accepted by provider (application hash check required)', await put(signed('PUT', 'uploads/wrong-hash.png', uploadHeaders()), changed), [200]);
response = await call(`/object/authenticated/${bucket}/uploads/wrong-hash.png`);
assert.notEqual(sha(Buffer.from(await response.arrayBuffer())), sha(payload));
response = await call(`/object/sign/${bucket}/${key}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expiresIn: 1, versionId: original.data.version }) });
const shortRead = (await response.json()).signedURL;
await delay(1500);
await expectStatus('native signed read real-time expiry enforced without CDN', await fetch(`${origin}${shortRead}`), [400, 403]);
await expectStatus('replay overwrites staging key', await put(request, changed), [200]);
const replaced = await info(key);
assert.notEqual(replaced.data.version, original.data.version);
await expectStatus('old authenticated version rejected after replacement', await call(`/object/authenticated/${bucket}/${key}?versionId=${original.data.version}`), [400, 404]);
await expectStatus('old signed version rejected after replacement', await fetch(`${origin}${signedRead}`), [400, 404]);
const ifMatch = await fetch(signed('GET', key, { 'if-match': '"not-the-real-etag"' }).url, { headers: { 'if-match': '"not-the-real-etag"' } });
observations.push({ check: 'S3 mismatched If-Match probe (200 means unsupported)', status: ifMatch.status });
const postKey = 'uploads/post-policy-range.png';
const postDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
const postDay = postDate.slice(0, 8);
const policyFields = { key: postKey, 'Content-Type': 'image/png', 'x-amz-meta-sha256': sha(payload), 'x-amz-meta-media-id': mediaId };
const policy = Buffer.from(JSON.stringify({ expiration: new Date(Date.now() + 120_000).toISOString(), conditions: [{ bucket }, ...Object.entries(policyFields).map(([k,v]) => ({ [k]:v })), ['content-length-range', payload.length, payload.length]] })).toString('base64');
const form = new FormData();
for (const [k,v] of Object.entries({ ...policyFields, 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${accessKey}/${postDay}/${region}/s3/aws4_request`, 'X-Amz-Date': postDate, Policy: policy, 'X-Amz-Signature': hmac(signingKey(postDay), policy).toString('hex') })) form.append(k,v);
form.append('file', new Blob([Buffer.concat([payload, Buffer.from([0])])], { type: 'image/png' }), 'oversize.png');
await expectStatus('S3 POST exact-size policy accepts one extra byte (unsupported range enforcement)', await fetch(`${origin}/s3/${bucket}`, { method: 'POST', body: form }), [200]);
assert.equal((await info(postKey)).data.size, payload.length + 1);
response = await call(`/object/upload/sign/${bucket}/uploads/native.png`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expiresIn: 1 }) });
assert.equal(response.status, 200);
const nativeUpload = await response.json();
const claims = JSON.parse(Buffer.from(nativeUpload.token.split('.')[1], 'base64url').toString());
assert.equal(claims.exp - claims.iat, 120);
assert.equal(claims.url, `${bucket}/uploads/native.png`);
assert.equal(claims.upsert, false);
assert.equal(claims.sha256, undefined);
observations.push({ check: 'native upload TTL uses local server config, ignores per-request expiresIn', ttlSeconds: 120, boundClaims: Object.keys(claims).sort() });
const deletion = signed('DELETE', key);
await expectStatus('S3 first delete', await fetch(deletion.url, { method: 'DELETE' }), [204]);
await expectStatus('S3 repeated missing-object delete', await fetch(deletion.url, { method: 'DELETE' }), [204]);
console.log(JSON.stringify({ origin, bucket, evidence: 'real local Storage v1.73.0 + isolated PostgreSQL, file backend; NOT hosted/CDN proof', observations }, null, 2));
