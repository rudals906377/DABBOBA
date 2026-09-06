import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";

const mobileRequire = createRequire(new URL("../apps/mobile/package.json", import.meta.url));
const ts = mobileRequire("typescript");
const code = ts.transpileModule(readFileSync(new URL("../apps/mobile/src/features/profile/wanted-request-api.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Exercise the installed SDK's actual multipart serializer: SDK 57 rejects URI-only
// React Native parts, even though FormData.append still accepts them.
const expoMultipartCode = ts.transpileModule(readFileSync(new URL("../apps/mobile/node_modules/expo/src/winter/fetch/convertFormData.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const expoMultipartScope = {
  exports: {}, Blob, TextEncoder, Uint8Array,
  require: (name) => {
    assert.equal(name, "../../utils/blobUtils");
    return { blobToArrayBufferAsync: (blob) => blob.arrayBuffer() };
  },
};
runInNewContext(expoMultipartCode, expoMultipartScope);

function harness(method = "PUT", change = () => {}, development = false, storageResponse = { ok: true, redirected: false }) {
  const calls = [];
  const bytes = new Uint8Array([0, 1, 127, 128, 255]);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const mediaId = "88888888-8888-4888-8888-888888888888";
  const image = { uri: "file:///private/local-reference.jpg", filename: "reference.jpg", mimeType: "image/jpeg", width: 4, height: 4 };
  const common = { mediaId, method, uploadUrl: "https://storage.example.test/upload?signed=capability", expiresAt: "2099-01-01T00:00:00.000Z", maxBytes: bytes.length };
  const intent = method === "POST"
    ? { ...common, fileFieldName: "file", fields: { policy: "legacy-policy", key: "opaque-staging-key" } }
    : { ...common, bodyEncoding: "raw", headers: {
      "content-type": image.mimeType, "content-length": String(bytes.length), "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
      "x-amz-meta-sha256": checksum, "x-amz-meta-media-id": mediaId,
    } };
  change(intent);
  let localReads = 0;
  class NativeFormData {
    parts = [];
    append(...entry) { this.parts.push(entry); }
    entries() { return this.parts.values(); }
  }
  const expoFetch = async (url, init) => {
    if (url === image.uri) {
      localReads += 1;
      return new Response(bytes, { headers: { "content-type": "application/octet-stream" } });
    }
    const call = { kind: "storage", transport: "expo/fetch", url, init };
    calls.push(call);
    if (init.body instanceof NativeFormData) {
      call.multipart = await expoMultipartScope.exports.convertFormDataAsync(init.body);
    }
    return storageResponse;
  };
  const modules = {
    "expo/fetch": { fetch: expoFetch },
    "expo-crypto": { CryptoDigestAlgorithm: { SHA256: "SHA256" }, randomUUID, digest: async (_algorithm, body) => {
      const hash = createHash("sha256").update(new Uint8Array(body)).digest();
      return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength);
    } },
    "expo-image-manipulator": {}, "expo-image-picker": {},
    "@dabboba/api-client": { errorMessage: (_error, message) => message },
    "@/lib/mobile-api-client": { createMobileDabbobaClient: (options) => ({ POST: async (path, request) => {
      calls.push({ kind: "api", path, request, token: options.token() });
      if (path === "/v1/media/uploads") return { data: intent };
      assert.equal(path, "/v1/media/{mediaId}/complete");
      return { data: { mediaId, status: "READY", mimeType: "image/webp" } };
    } }) },
  };
  const scope = {
    exports: {}, __DEV__: development, URL, FormData: NativeFormData,
    require: (name) => { assert.ok(Object.hasOwn(modules, name), name); return modules[name]; },
    fetch: expoFetch,
  };
  runInNewContext(code, scope);
  return { calls, bytes, image, intent, NativeFormData, get localReads() { return localReads; }, run: () => scope.exports.uploadWantedRequestImage("https://api.dabboba.test", "app-bearer-only-for-api", image) };
}

test("native POST serializes the exact hashed JPEG as an SDK 57 compatible Blob after signed fields", async () => {
  const h = harness("POST");
  assert.equal(await h.run(), h.intent.mediaId);
  assert.deepEqual(Array.from(h.calls[0].request.body.acceptedUploadMethods), ["POST", "PUT"]);
  const sent = h.calls[1].init;
  assert.equal(h.calls[1].transport, "expo/fetch");
  assert.equal(sent.method, "POST");
  assert.ok(sent.body instanceof h.NativeFormData);
  assert.deepEqual(sent.body.parts.map(([key]) => key), ["policy", "key", "file"]);
  const blob = sent.body.parts.at(-1)[1];
  assert.ok(blob instanceof Blob);
  assert.equal(blob.name, h.image.filename);
  assert.equal(blob.type, h.image.mimeType);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), h.bytes);
  assert.equal(h.localReads, 1, "multipart and checksum must share one local read");
  const multipart = h.calls[1].multipart;
  const parsed = await new Response(multipart.body, { headers: { "content-type": `multipart/form-data; boundary=${multipart.boundary}` } }).formData();
  assert.equal(parsed.get("policy"), h.intent.fields.policy);
  assert.equal(parsed.get("key"), h.intent.fields.key);
  assert.equal(parsed.get("file").name, h.image.filename);
  assert.equal(parsed.get("file").type, h.image.mimeType);
  const uploadedBytes = new Uint8Array(await parsed.get("file").arrayBuffer());
  assert.deepEqual(uploadedBytes, h.bytes);
  assert.equal(createHash("sha256").update(uploadedBytes).digest("hex"), h.calls[0].request.body.checksumSha256);
  assert.equal(sent.headers, undefined);
  assert.equal(sent.credentials, "omit");
  assert.equal(sent.redirect, "error");
});

test("native PUT sends the exact existing ArrayBuffer with signed headers and no credentials", async () => {
  const h = harness();
  assert.equal(await h.run(), h.intent.mediaId);
  const sent = h.calls[1].init;
  assert.equal(h.calls[1].transport, "expo/fetch", "explicit Expo transport enforces redirect:error independently of global fetch");
  assert.equal(sent.method, "PUT");
  assert.equal(sent.body instanceof h.NativeFormData, false);
  assert.deepEqual(new Uint8Array(sent.body), h.bytes);
  const headers = new Headers(sent.headers);
  assert.equal(headers.get("content-type"), h.image.mimeType);
  assert.equal(headers.get("x-amz-content-sha256"), "UNSIGNED-PAYLOAD");
  assert.equal(headers.has("content-length"), false);
  assert.equal(headers.has("authorization"), false);
  assert.equal(headers.has("cookie"), false);
  assert.equal(headers.has("apikey"), false);
  assert.equal(sent.credentials, "omit");
  assert.equal(sent.redirect, "error");
  assert.equal(h.calls[2].kind, "api");
  assert.equal(h.calls[2].token, "app-bearer-only-for-api");
});

test("native refuses malformed PUT policies before upload or complete", async () => {
  for (const change of [
    (i) => { i.maxBytes += 1; }, (i) => { i.bodyEncoding = "multipart"; },
    (i) => { i.fields = {}; }, (i) => { i.fileFieldName = "file"; },
    (i) => { i.headers["content-type"] = "text/plain"; },
    (i) => { i.headers["content-length"] = "999"; },
    (i) => { i.headers["x-amz-content-sha256"] = "wrong"; },
    (i) => { i.headers["x-amz-meta-sha256"] = "0".repeat(64); },
    (i) => { i.headers["x-amz-meta-media-id"] = "wrong"; },
    (i) => { i.headers.Authorization = "secret"; }, (i) => { i.headers.Cookie = "secret"; },
    (i) => { i.headers.apikey = "secret"; }, (i) => { i.headers["Content-Type"] = "image/jpeg"; },
    (i) => { delete i.headers["content-length"]; },
    (i) => { i.uploadUrl = "https://user:password@storage.example.test/upload"; },
    (i) => { i.uploadUrl = "http://storage.example.test/upload"; },
    (i) => { i.expiresAt = "invalid"; }, (i) => { i.expiresAt = "2000-01-01T00:00:00.000Z"; },
  ]) {
    const h = harness("PUT", change);
    await assert.rejects(h.run());
    assert.equal(h.calls.length, 1, "only the authenticated intent request may run");
  }
});

test("native rejects expired legacy POST policies before uploading file data", async () => {
  const h = harness("POST", (i) => { i.expiresAt = "2000-01-01T00:00:00.000Z"; });
  await assert.rejects(h.run(), /만료/);
  assert.equal(h.calls.length, 1);
});

test("native loopback HTTP capability is development-only", async () => {
  const change = (i) => { i.uploadUrl = "http://127.0.0.1:55433/signed-put"; };
  const release = harness("PUT", change);
  await assert.rejects(release.run());
  assert.equal(release.calls.length, 1);
  const local = harness("PUT", change, true);
  await local.run();
  assert.equal(local.calls[1].init.method, "PUT");
});

test("native never completes after failed or redirected storage responses", async () => {
  for (const method of ["POST", "PUT"]) {
    for (const response of [{ ok: false, redirected: false }, { ok: true, redirected: true }]) {
      const h = harness(method, undefined, false, response);
      await assert.rejects(h.run(), /업로드하지 못했습니다/);
      assert.equal(h.calls.length, 2);
    }
  }
});
