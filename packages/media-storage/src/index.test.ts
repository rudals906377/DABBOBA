import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import test from "node:test";
import {
  MAX_MEDIA_BYTES, MediaStorageError, SupabaseMediaStorage, type SupabaseMediaStorageConfig,
} from "./index.js";

const mediaId = "8a8753bd-f8c4-48ea-935a-747ed464cd77";
const version = "f5e92c8f-2b2c-4ac5-9059-4e87157d53d3";
const claim = "751ab12c-c8da-49bd-9e4b-bd6c5dde884e";
const bytes = Buffer.from("bounded local protocol fixture");
const checksum = createHash("sha256").update(bytes).digest("hex");
const key = `media/${mediaId}/${checksum}-${claim}.webp`;
const serviceKey = "test-only-service-key-must-never-appear-in-errors";
const secretKey = "test-only-s3-secret-must-never-appear-in-errors";
const config = (url: string): SupabaseMediaStorageConfig => ({
  url, s3Endpoint: `${url}/storage/v1/s3`, bucket: "test-media", serviceKey,
  s3Region: "us-east-1", s3AccessKeyId: "test-access-key", s3SecretAccessKey: secretKey,
  allowLocalHttp: true,
});
const info = (overrides: Record<string, unknown> = {}) => ({
  name: key, bucket_id: "test-media", version, size: bytes.length, content_type: "image/webp",
  cache_control: "no-store", metadata: { sha256: checksum, "media-id": mediaId, sanitized: "true" },
  ...overrides,
});
const json = (res: ServerResponse, body: unknown, status = 200) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
async function requestBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
async function fixture(
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
  run: (storage: SupabaseMediaStorage, origin: string) => Promise<void>,
): Promise<void> {
  const server = createServer((req, res) => {
    void Promise.resolve(handler(req, res)).catch(() => { res.destroy(); });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  try { await run(new SupabaseMediaStorage(config(origin)), origin); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
}
function safeFailure(error: unknown): boolean {
  assert.ok(error instanceof MediaStorageError);
  assert.doesNotMatch(`${error.stack} ${JSON.stringify(error)}`, /https?:|test-only|Bearer|token=/);
  return true;
}
async function collect(storage: SupabaseMediaStorage): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of storage.read(key, version)) chunks.push(chunk);
  return Buffer.concat(chunks);
}

test("configuration is restricted to matching HTTPS Supabase endpoints or explicit same-origin loopback", () => {
  const hosted = { ...config("https://abcdefghijklmnopqrst.supabase.co"), allowLocalHttp: false };
  assert.doesNotThrow(() => new SupabaseMediaStorage(hosted));
  assert.doesNotThrow(() => new SupabaseMediaStorage({ ...hosted, s3Endpoint: "https://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/s3" }));
  for (const patch of [
    { allowLocalHttp: false }, { url: "http://example.com" }, { url: "http://127.0.0.1:1/path" },
    { url: "http://user:password@127.0.0.1:1" }, { url: "http://127.0.0.1:1?token=secret" },
    { s3Endpoint: "http://127.0.0.1:2/storage/v1/s3" }, { s3Endpoint: "http://127.0.0.1:1/storage/v1/../s3" },
    { bucket: "../other" }, { serviceKey: "bad\r\nheader" }, { s3Region: "region/injection" },
  ]) assert.throws(() => new SupabaseMediaStorage({ ...config("http://127.0.0.1:1"), ...patch }), safeFailure);
  assert.throws(() => new SupabaseMediaStorage({ ...hosted, s3Endpoint: "https://otherabcdefghijklmnop.storage.supabase.co/storage/v1/s3" }), safeFailure);
});

test("SDK PUT signs exact size/type/identity/UNSIGNED-PAYLOAD and verifies against an independent SigV4 oracle", async () => {
  const storage = new SupabaseMediaStorage(config("http://127.0.0.1:12345"));
  const deadline = new Date(Date.now() + 600_000);
  const upload = await storage.createUpload({ key, mediaId, checksumSha256: checksum, byteSize: bytes.length, mimeType: "image/webp", expiresAt: deadline });
  assert.equal(upload.method, "PUT");
  assert.equal(upload.bodyEncoding, "raw");
  assert.equal(upload.maxBytes, bytes.length);
  assert.deepEqual(upload.headers, {
    "content-length": String(bytes.length), "content-type": "image/webp",
    "x-amz-content-sha256": "UNSIGNED-PAYLOAD", "x-amz-meta-media-id": mediaId, "x-amz-meta-sha256": checksum,
  });
  const url = new URL(upload.uploadUrl);
  const signedHeaders = "content-length;content-type;host;x-amz-content-sha256;x-amz-meta-media-id;x-amz-meta-sha256";
  assert.equal(url.searchParams.get("X-Amz-SignedHeaders"), signedHeaders);
  assert.equal(url.searchParams.get("X-Amz-Expires"), "120");
  assert.equal(url.searchParams.has("X-Amz-Content-Sha256"), false);
  const amzDate = url.searchParams.get("X-Amz-Date")!;
  const signingTime = Date.UTC(+amzDate.slice(0, 4), +amzDate.slice(4, 6) - 1, +amzDate.slice(6, 8), +amzDate.slice(9, 11), +amzDate.slice(11, 13), +amzDate.slice(13, 15));
  assert.equal(Date.parse(upload.expiresAt), signingTime + 120_000);
  const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  const query = [...url.searchParams.entries()].filter(([name]) => name !== "X-Amz-Signature")
    .map(([name, value]) => [encode(name), encode(value)] as const).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([name, value]) => `${name}=${value}`).join("&");
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const hmac = (secret: string | Buffer, value: string) => createHmac("sha256", secret).update(value).digest();
  const allHeaders: Record<string, string> = { ...upload.headers, host: url.host };
  const canonicalHeaders = signedHeaders.split(";").map((name) => `${name}:${allHeaders[name]}\n`).join("");
  const canonical = ["PUT", url.pathname, query, canonicalHeaders, signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
  const scope = `${amzDate.slice(0, 8)}/us-east-1/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, hash(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, amzDate.slice(0, 8)), "us-east-1"), "s3"), "aws4_request");
  assert.equal(url.searchParams.get("X-Amz-Signature"), hmac(signingKey, stringToSign).toString("hex"));
});

test("S3 read URL is short-lived and bound to the immutable object key and stored version", async () => {
  const storage = new SupabaseMediaStorage(config("http://127.0.0.1:12345"));
  const signed = new URL(await storage.signedS3Read(key, version, 300));
  assert.equal(signed.origin, "http://127.0.0.1:12345");
  assert.equal(signed.pathname, `/storage/v1/s3/test-media/${key}`);
  assert.equal(signed.searchParams.get("versionId"), version);
  assert.equal(signed.searchParams.get("X-Amz-Expires"), "300");
  assert.ok(signed.searchParams.get("X-Amz-Signature"));
  await assert.rejects(storage.signedS3Read(key, version, 301), safeFailure);
  await assert.rejects(storage.signedS3Read("../foreign", version, 300), safeFailure);
  await assert.rejects(storage.signedS3Read(key, "invalid", 300), safeFailure);
});

test("invalid paths, sizes, hashes and expired deadlines are rejected before signing", async () => {
  const storage = new SupabaseMediaStorage(config("http://127.0.0.1:1"));
  const input = { key, mediaId, checksumSha256: checksum, byteSize: bytes.length, mimeType: "image/webp", expiresAt: new Date(Date.now() + 60_000) };
  for (const patch of [{ key: "a/../b" }, { key: "a/%2f/b" }, { key: "a//b" }, { byteSize: MAX_MEDIA_BYTES + 1 }, { byteSize: 0 }, { byteSize: 1.5 }, { checksumSha256: "0" }, { mediaId: "invalid" }, { mimeType: "text/html" }, { expiresAt: new Date(0) }]) {
    await assert.rejects(storage.createUpload({ ...input, ...patch }), safeFailure);
  }
});

test("REST info uses service auth and maps only validated object identity and metadata", async () => {
  await fixture((req, res) => {
    assert.equal(req.url, `/storage/v1/object/info/authenticated/test-media/${key}`);
    assert.equal(req.headers.authorization, `Bearer ${serviceKey}`);
    assert.equal(req.headers.apikey, serviceKey);
    assert.equal(req.headers["accept-encoding"], "identity");
    json(res, info());
  }, async (storage) => {
    assert.deepEqual(await storage.stat(key), { version, size: bytes.length, contentType: "image/webp", metadata: { "media-id": mediaId, sanitized: "true", sha256: checksum } });
  });
});

test("malformed, foreign, oversized and unsafe info responses fail closed without raw errors", async () => {
  for (const body of [info({ name: "foreign" }), info({ bucket_id: "foreign" }), info({ version: "etag-not-version" }), info({ size: MAX_MEDIA_BYTES + 1 }), info({ content_type: "text/html" }), info({ metadata: { bad: "value\nheader" } })]) {
    await fixture((_req, res) => json(res, body), async (storage) => { await assert.rejects(storage.stat(key), safeFailure); });
  }
  await fixture((_req, res) => { res.end("not-json-secret"); }, async (storage) => { await assert.rejects(storage.stat(key), safeFailure); });
  await fixture((_req, res) => { res.end("x".repeat(65_537)); }, async (storage) => { await assert.rejects(storage.stat(key), safeFailure); });
});

test("redirects never forward service authorization to a second request", async () => {
  let requests = 0;
  await fixture((req, res) => {
    requests += 1;
    res.writeHead(302, { location: "/credential-destination" }); res.end();
  }, async (storage) => { await assert.rejects(storage.stat(key), safeFailure); });
  assert.equal(requests, 1);
});

test("the request deadline also aborts a response stalled after its headers", { timeout: 60_000 }, async () => {
  const started = Date.now();
  await fixture((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.write("{"); // Deliberately never finish this bounded local response.
  }, async (storage) => { await assert.rejects(storage.stat(key), safeFailure); });
  assert.ok(Date.now() - started >= 14_000);
});

test("read pins the exact native UUID on both info and bytes, preserving bounded identity", async () => {
  const paths: string[] = [];
  await fixture((req, res) => {
    paths.push(req.url!);
    if (req.url!.includes("/info/")) return json(res, info());
    res.writeHead(200, { "content-type": "image/webp", "content-length": bytes.length }); res.end(bytes);
  }, async (storage) => { assert.deepEqual(await collect(storage), bytes); });
  assert.equal(paths.length, 2);
  assert.ok(paths.every((path) => path.endsWith(`?versionId=${version}`)));
});

test("read rejects changed UUID, size overflow, truncation and wrong content type", async () => {
  for (const scenario of ["version", "overflow", "truncated", "type", "encoding"]) {
    await fixture((req, res) => {
      if (req.url!.includes("/info/")) return json(res, info(scenario === "version" ? { version: claim } : {}));
      res.writeHead(200, { "content-type": scenario === "type" ? "image/png" : "image/webp", ...(scenario === "encoding" ? { "content-encoding": "gzip" } : {}) });
      res.write(scenario === "overflow" ? Buffer.concat([bytes, bytes]) : scenario === "truncated" ? bytes.subarray(1) : bytes);
      res.end();
    }, async (storage) => { await assert.rejects(collect(storage), safeFailure); });
  }
});

test("final upload is no-store, non-upsert, unique-claim and verified using actual pinned bytes", async () => {
  let posted = 0;
  let infoReads = 0;
  await fixture(async (req, res) => {
    if (req.method === "POST") {
      posted += 1;
      assert.equal(req.headers["x-upsert"], "false");
      assert.equal(req.headers["cache-control"], "no-store");
      assert.equal(req.headers["content-type"], "image/webp");
      assert.equal(req.headers["content-length"], String(bytes.length));
      assert.deepEqual(JSON.parse(Buffer.from(String(req.headers["x-metadata"]), "base64").toString()), info().metadata);
      assert.deepEqual(await requestBody(req), bytes);
      return json(res, { Key: `test-media/${key}` });
    }
    if (req.url!.includes("/info/")) { infoReads += 1; return json(res, info()); }
    assert.ok(req.url!.endsWith(`?versionId=${version}`));
    res.writeHead(200, { "content-type": "image/webp" }); res.end(bytes);
  }, async (storage) => { assert.equal((await storage.writeFinal(key, bytes, { mediaId, checksumSha256: checksum })).version, version); });
  assert.equal(posted, 1); assert.equal(infoReads, 3);
});

test("final verification never trusts checksum metadata instead of actual bytes", async () => {
  for (const scenario of ["hash", "cache", "metadata", "version"]) {
    let infoReads = 0;
    await fixture((req, res) => {
      if (req.method === "POST") return json(res, {});
      if (req.url!.includes("/info/")) {
        infoReads += 1;
        return json(res, info(scenario === "cache" ? { cache_control: "max-age=3600" } : scenario === "metadata" ? { metadata: {} } : scenario === "version" && infoReads > 1 ? { version: claim } : {}));
      }
      res.writeHead(200, { "content-type": "image/webp" });
      res.end(scenario === "hash" ? Buffer.alloc(bytes.length, 1) : bytes);
    }, async (storage) => { await assert.rejects(storage.writeFinal(key, bytes, { mediaId, checksumSha256: checksum }), safeFailure); });
  }
  const storage = new SupabaseMediaStorage(config("http://127.0.0.1:1"));
  await assert.rejects(storage.writeFinal(`media/${mediaId}/${checksum}.webp`, bytes, { mediaId, checksumSha256: checksum }), safeFailure);
  await assert.rejects(storage.writeFinal(key, bytes, { mediaId, checksumSha256: "0".repeat(64) }), safeFailure);
});

test("ambiguous upload failure succeeds only after exact committed-object readback", async () => {
  await fixture((req, res) => {
    if (req.method === "POST") { res.destroy(); return; }
    if (req.url!.includes("/info/")) return json(res, info());
    res.writeHead(200, { "content-type": "image/webp" }); res.end(bytes);
  }, async (storage) => { assert.equal((await storage.writeFinal(key, bytes, { mediaId, checksumSha256: checksum })).version, version); });
});

test("signed reads carry native versionId and bounded TTL and accept only the exact local download path", async () => {
  await fixture(async (req, res) => {
    if (req.url!.includes("/info/")) return json(res, info());
    assert.deepEqual(JSON.parse((await requestBody(req)).toString()), { expiresIn: 300, versionId: version });
    json(res, { signedURL: `/object/sign/test-media/${key}?token=aaaa.bbbb.cccc` });
  }, async (storage, origin) => {
    assert.equal(await storage.signedRead(key, version, 300), `${origin}/storage/v1/object/sign/test-media/${key}?token=aaaa.bbbb.cccc`);
    await assert.rejects(storage.signedRead(key, version, 301), safeFailure);
  });
});

test("signed reads reject unsafe URLs, extra parameters, missing no-store and mismatched versions", async () => {
  for (const signedURL of ["https://evil.test/?token=secret", `/object/sign/test-media/${key}?token=aaaa.bbbb.cccc&redirect=evil`, `/object/sign/test-media/${key}?token=not-jwt`, `/object/sign/test-media/other?token=aaaa.bbbb.cccc`]) {
    await fixture((req, res) => json(res, req.url!.includes("/info/") ? info() : { signedURL }), async (storage) => { await assert.rejects(storage.signedRead(key, version, 60), safeFailure); });
  }
  await fixture((_req, res) => json(res, info({ cache_control: "max-age=3600" })), async (storage) => { await assert.rejects(storage.signedRead(key, version, 60), safeFailure); });
});

test("delete is idempotent only for success and known missing-object responses", async () => {
  for (const status of [200, 204, 404, 400]) {
    await fixture((req, res) => {
      assert.equal(req.method, "DELETE");
      json(res, { code: "NoSuchKey" }, status);
    }, async (storage) => { await storage.deleteObject(key); });
  }
  for (const status of [400, 401, 403, 404, 500]) {
    await fixture((_req, res) => json(res, { code: "OtherError", message: `${serviceKey} token=raw-provider-url` }, status), async (storage) => { await assert.rejects(storage.deleteObject(key), safeFailure); });
  }
});
