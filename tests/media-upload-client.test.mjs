import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DabbobaApiClient } from "../src/services/dabbobaApi.ts";

test("authenticated media upload binds the exact file to the signed form before completion", async () => {
  const calls = [];
  const fileBytes = new TextEncoder().encode("small deterministic image fixture");
  const file = new File([fileBytes], "my photo.png", { type: "image/png" });
  const checksumSha256 = createHash("sha256").update(fileBytes).digest("hex");
  const mediaId = "11111111-1111-4111-8111-111111111111";
  const client = new DabbobaApiClient({
    configuration: {
      mode: "remote",
      baseUrl: "https://api.dabboba.test",
      token: "opaque-user-token",
    },
    createId: () => "media-request-correlation-id",
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (url === "https://api.dabboba.test/v1/media/uploads") {
        return Response.json({
          mediaId,
          uploadUrl: "https://storage.example.test/upload",
          method: "POST",
          fields: {
            key: "uploads/user/media/my-photo.png",
            policy: "signed-policy",
            "x-goog-meta-sha256": checksumSha256,
          },
          fileFieldName: "file",
          expiresAt: "2099-08-24T00:02:00.000Z",
          maxBytes: file.size,
        }, { status: 201 });
      }
      if (url === "https://storage.example.test/upload") {
        return new Response("", { status: 201 });
      }
      if (url === `https://api.dabboba.test/v1/media/${mediaId}/complete`) {
        return Response.json({ mediaId, status: "READY", mimeType: "image/webp" });
      }
      return new Response("not found", { status: 404 });
    },
  });

  const result = await client.uploadMedia(file, "POST", "same-media-action-key");

  assert.deepEqual(result, { mediaId, status: "READY", mimeType: "image/webp" });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].init.headers.get("authorization"), "Bearer opaque-user-token");
  assert.equal(calls[0].init.headers.get("idempotency-key"), "same-media-action-key");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    purpose: "POST",
    filename: "my photo.png",
    mimeType: "image/png",
    byteSize: file.size,
    checksumSha256,
    acceptedUploadMethods: ["POST", "PUT"],
  });

  assert.equal(calls[1].init.method, "POST");
  assert.equal(calls[1].init.credentials, "omit");
  assert.equal(calls[1].init.redirect, "error");
  assert.equal(calls[1].init.headers, undefined);
  assert.ok(calls[1].init.body instanceof FormData);
  assert.equal(calls[1].init.body.get("key"), "uploads/user/media/my-photo.png");
  assert.equal(calls[1].init.body.get("policy"), "signed-policy");
  assert.equal(calls[1].init.body.get("x-goog-meta-sha256"), checksumSha256);
  assert.equal(calls[1].init.body.get("file").name, "my photo.png");

  assert.equal(calls[2].init.headers.get("authorization"), "Bearer opaque-user-token");
  assert.equal(calls[2].init.headers.get("idempotency-key"), "same-media-action-key");
});

test("media upload rejects unsupported or oversized files before any network request", async () => {
  let fetched = false;
  const client = new DabbobaApiClient({
    configuration: {
      mode: "remote",
      baseUrl: "https://api.dabboba.test",
      token: "opaque-user-token",
    },
    fetch: async () => {
      fetched = true;
      return new Response();
    },
  });

  await assert.rejects(
    () => client.uploadMedia(new File(["plain text"], "note.txt", { type: "text/plain" }), "POST"),
    (error) => error.code === "MEDIA_TYPE_UNSUPPORTED" && error.status === 400,
  );
  await assert.rejects(
    () => client.uploadMedia(new File([new Uint8Array(10 * 1024 * 1024 + 1)], "huge.png", { type: "image/png" }), "POST"),
    (error) => error.code === "MEDIA_FILE_TOO_LARGE" && error.status === 400,
  );
  assert.equal(fetched, false);
});

test("media upload retries completion without creating a new intent or re-uploading the file", async () => {
  const counts = { intent: 0, storage: 0, complete: 0 };
  const mediaId = "22222222-2222-4222-8222-222222222222";
  const file = new File(["retry completion"], "retry.png", { type: "image/png" });
  const client = new DabbobaApiClient({
    configuration: { mode: "remote", baseUrl: "https://api.dabboba.test", token: "opaque-user-token" },
    fetch: async (url) => {
      if (url.endsWith("/v1/media/uploads")) {
        counts.intent += 1;
        return Response.json({
          mediaId,
          uploadUrl: "https://storage.example.test/retry-complete",
          method: "POST",
          fields: { key: "retry-complete" },
          fileFieldName: "file",
          expiresAt: "2099-01-01T00:00:00.000Z",
          maxBytes: file.size,
        }, { status: 201 });
      }
      if (url === "https://storage.example.test/retry-complete") {
        counts.storage += 1;
        return new Response("", { status: 201 });
      }
      counts.complete += 1;
      if (counts.complete === 1) throw new TypeError("response lost after commit");
      return Response.json({ mediaId, status: "READY", mimeType: "image/webp" });
    },
  });

  await assert.rejects(() => client.uploadMedia(file, "POST", "complete-retry-key"));
  assert.deepEqual(await client.uploadMedia(file, "POST", "complete-retry-key"), {
    mediaId,
    status: "READY",
    mimeType: "image/webp",
  });
  assert.deepEqual(counts, { intent: 1, storage: 1, complete: 2 });
});

test("media upload retries the same unexpired signed form after a storage failure", async () => {
  const counts = { intent: 0, storage: 0, complete: 0 };
  const mediaId = "33333333-3333-4333-8333-333333333333";
  const file = new File(["retry storage"], "storage.png", { type: "image/png" });
  const client = new DabbobaApiClient({
    configuration: { mode: "remote", baseUrl: "https://api.dabboba.test", token: "opaque-user-token" },
    fetch: async (url) => {
      if (url.endsWith("/v1/media/uploads")) {
        counts.intent += 1;
        return Response.json({
          mediaId,
          uploadUrl: "https://storage.example.test/retry-storage",
          method: "POST",
          fields: { key: "retry-storage" },
          fileFieldName: "file",
          expiresAt: "2099-01-01T00:00:00.000Z",
          maxBytes: file.size,
        }, { status: 201 });
      }
      if (url === "https://storage.example.test/retry-storage") {
        counts.storage += 1;
        if (counts.storage === 1) throw new TypeError("temporary storage failure");
        return new Response(null, { status: 204 });
      }
      counts.complete += 1;
      return Response.json({ mediaId, status: "READY", mimeType: "image/webp" });
    },
  });

  await assert.rejects(
    () => client.uploadMedia(file, "INQUIRY", "storage-retry-key"),
    (error) => error.code === "MEDIA_UPLOAD_FAILED",
  );
  await client.uploadMedia(file, "INQUIRY", "storage-retry-key");
  assert.deepEqual(counts, { intent: 1, storage: 2, complete: 1 });
});

test("expired upload intents require a new action key and keys cannot move to another file", async () => {
  const calls = [];
  const firstFile = new File(["first"], "first.png", { type: "image/png" });
  const secondFile = new File(["second"], "second.png", { type: "image/png" });
  const client = new DabbobaApiClient({
    configuration: { mode: "remote", baseUrl: "https://api.dabboba.test", token: "opaque-user-token" },
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/v1/media/uploads")) {
        const key = init.headers.get("idempotency-key");
        return Response.json({
          mediaId: key === "expired-key"
            ? "44444444-4444-4444-8444-444444444444"
            : "55555555-5555-4555-8555-555555555555",
          uploadUrl: "https://storage.example.test/new-action",
          method: "POST",
          fields: { key: "new-action" },
          fileFieldName: "file",
          expiresAt: key === "expired-key" ? "2000-01-01T00:00:00.000Z" : "2099-01-01T00:00:00.000Z",
          maxBytes: firstFile.size,
        }, { status: 201 });
      }
      if (url === "https://storage.example.test/new-action") return new Response("", { status: 201 });
      return Response.json({
        mediaId: "55555555-5555-4555-8555-555555555555",
        status: "READY",
        mimeType: "image/webp",
      });
    },
  });

  await assert.rejects(
    () => client.uploadMedia(firstFile, "POST", "expired-key"),
    (error) => error.code === "MEDIA_UPLOAD_INTENT_EXPIRED" && error.status === 410,
  );
  await assert.rejects(
    () => client.uploadMedia(firstFile, "POST", "expired-key"),
    (error) => error.code === "MEDIA_UPLOAD_INTENT_EXPIRED" && error.status === 410,
  );
  assert.equal(calls.filter(({ url }) => url.endsWith("/v1/media/uploads")).length, 1);
  await client.uploadMedia(firstFile, "POST", "fresh-key");
  await assert.rejects(
    () => client.uploadMedia(secondFile, "POST", "fresh-key"),
    (error) => error.code === "MEDIA_UPLOAD_KEY_REUSED" && error.status === 409,
  );
  assert.equal(calls.filter(({ url }) => url.endsWith("/v1/media/uploads")).length, 2);
  assert.equal(calls.filter(({ url }) => url === "https://storage.example.test/new-action").length, 1);
});

test("server-expired upload actions are retired without replaying the same idempotency key", async () => {
  let intentCalls = 0;
  const file = new File(["expired"], "expired.png", { type: "image/png" });
  const client = new DabbobaApiClient({
    configuration: { mode: "remote", baseUrl: "https://api.dabboba.test", token: "opaque-user-token" },
    fetch: async (url) => {
      assert.ok(url.endsWith("/v1/media/uploads"));
      intentCalls += 1;
      return Response.json({
        error: { code: "MEDIA_UPLOAD_INTENT_EXPIRED", message: "expired" },
      }, { status: 410 });
    },
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      () => client.uploadMedia(file, "INQUIRY", "server-expired-key"),
      (error) => error.code === "MEDIA_UPLOAD_INTENT_EXPIRED" && error.status === 410,
    );
  }
  assert.equal(intentCalls, 1);
});

test("a complete 410 retires the upload action without creating or completing it again", async () => {
  const counts = { intent: 0, storage: 0, complete: 0 };
  const mediaId = "66666666-6666-4666-8666-666666666666";
  const file = new File(["complete expired"], "complete-expired.png", { type: "image/png" });
  const client = new DabbobaApiClient({
    configuration: { mode: "remote", baseUrl: "https://api.dabboba.test", token: "opaque-user-token" },
    fetch: async (url) => {
      if (url.endsWith("/v1/media/uploads")) {
        counts.intent += 1;
        return Response.json({
          mediaId,
          uploadUrl: "https://storage.example.test/complete-expired",
          method: "POST",
          fields: { key: "complete-expired" },
          fileFieldName: "file",
          expiresAt: "2099-01-01T00:00:00.000Z",
          maxBytes: file.size,
        }, { status: 201 });
      }
      if (url === "https://storage.example.test/complete-expired") {
        counts.storage += 1;
        return new Response("", { status: 201 });
      }
      counts.complete += 1;
      return Response.json({
        error: { code: "MEDIA_UPLOAD_INTENT_EXPIRED", message: "complete intent expired" },
      }, { status: 410 });
    },
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      () => client.uploadMedia(file, "INQUIRY", "complete-expired-key"),
      (error) => error.code === "MEDIA_UPLOAD_INTENT_EXPIRED" && error.status === 410,
    );
  }
  assert.deepEqual(counts, { intent: 1, storage: 1, complete: 1 });
});

test("duckroom composer uploads a selected image before binding it to the post", () => {
  const prototypeSource = readFileSync(new URL("../src/Prototype.tsx", import.meta.url), "utf8");

  assert.match(prototypeSource, /accept="image\/jpeg,image\/png,image\/webp,image\/gif"/);
  assert.match(prototypeSource, /uploadMedia\(draftMediaFile, "POST", pending\.mediaKey\)/);
  assert.match(prototypeSource, /uploaded\.code === "MEDIA_UPLOAD_INTENT_EXPIRED"[\s\S]*?mediaKey: createSessionId\("community-post-media"\)/);
  assert.match(prototypeSource, /mediaIds: pending\.mediaId \? \[pending\.mediaId\] : \[\]/);
  assert.match(prototypeSource, /URL\.revokeObjectURL\(previewUrl\)/);
});

test("inquiry composer rotates only the expired media action key", () => {
  const prototypeSource = readFileSync(new URL("../src/Prototype.tsx", import.meta.url), "utf8");
  assert.match(prototypeSource, /uploadMedia\(replyMediaFile, "INQUIRY", pending\.mediaKey\)/);
  assert.match(prototypeSource, /uploaded\.code === "MEDIA_UPLOAD_INTENT_EXPIRED"[\s\S]*?mediaKey: createSessionId\("inquiry-reply-media"\)/);
});

test("public Duckroom media is resolved through the public media contract after reload", async () => {
  const prototypeSource = readFileSync(new URL("../src/Prototype.tsx", import.meta.url), "utf8");
  const calls = [];
  const mediaId = "11111111-1111-4111-8111-111111111111";
  const client = new DabbobaApiClient({
    configuration: { mode: "remote", baseUrl: "http://127.0.0.1:8791", token: null },
    fetch: async (url, init) => {
      calls.push({ url, init });
      return Response.json({
        mediaId,
        url: "https://storage.example.test/signed-photo",
        expiresAt: "2026-08-24T10:05:00.000Z",
        mimeType: "image/webp",
      });
    },
  });

  const media = await client.getPublicMediaUrl(mediaId);
  assert.equal(media.url, "https://storage.example.test/signed-photo");
  assert.equal(calls[0].url, `http://127.0.0.1:8791/v1/media/${mediaId}/public-url`);
  assert.equal(calls[0].init.headers.has("authorization"), false);
  assert.match(prototypeSource, /apiRuntime\.client\.getPublicMediaUrl\(id, controller\.signal\)/);
  assert.match(prototypeSource, /src=\{showcase\.mediaUrl \?\? product\?\.asset \?\? EMPTY_PRODUCT_IMAGE_SRC\}/);
});

function rawUploadHarness(change = () => {}, options = {}) {
  const calls = [];
  const bytes = new Uint8Array([0, 1, 2, 127, 128, 255]);
  const file = new File([bytes], "raw.png", { type: "image/png" });
  const mediaId = "77777777-7777-4777-8777-777777777777";
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const intent = {
    mediaId, uploadUrl: "https://storage.example.test/signed-put?signature=opaque-capability", method: "PUT", bodyEncoding: "raw",
    expiresAt: "2099-01-01T00:00:00.000Z", maxBytes: file.size,
    headers: {
      "content-type": file.type, "content-length": String(file.size), "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
      "x-amz-meta-sha256": checksum, "x-amz-meta-media-id": mediaId,
    },
  };
  change(intent);
  let completionCalls = 0;
  const client = new DabbobaApiClient({
    configuration: { mode: "remote", baseUrl: "https://api.dabboba.test", token: "application-bearer-not-for-storage" },
    ...options,
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/v1/media/uploads")) return Response.json(intent, { status: 201 });
      if (url.endsWith("/complete")) {
        if (options.failFirstComplete && completionCalls++ === 0) throw new TypeError("completion response lost");
        return Response.json({ mediaId, status: "READY", mimeType: "image/webp" });
      }
      if (options.storageResponse) return options.storageResponse;
      return new Response(null, { status: 204 });
    },
  });
  return { client, file, bytes, calls, intent };
}

test("raw PUT advertises both transports and sends exact bytes without app credentials or forbidden length header", async () => {
  const h = rawUploadHarness();
  await h.client.uploadMedia(h.file, "POST", "raw-put-action");
  assert.deepEqual(JSON.parse(h.calls[0].init.body).acceptedUploadMethods, ["POST", "PUT"]);
  const sent = h.calls[1].init;
  assert.equal(sent.method, "PUT");
  assert.equal(sent.body instanceof FormData, false);
  const body = sent.body instanceof Blob ? await sent.body.arrayBuffer() : sent.body;
  assert.deepEqual(new Uint8Array(body), h.bytes);
  const headers = new Headers(sent.headers);
  assert.equal(headers.get("content-type"), "image/png");
  assert.equal(headers.get("x-amz-content-sha256"), "UNSIGNED-PAYLOAD");
  assert.equal(headers.has("content-length"), false, "fetch computes signed length from the exact raw body");
  assert.equal(headers.has("authorization"), false);
  assert.equal(headers.has("cookie"), false);
  assert.equal(headers.has("apikey"), false);
  assert.equal(sent.credentials, "omit");
  assert.equal(sent.redirect, "error");
});

test("raw PUT policy tampering fails before storage or completion", async () => {
  for (const change of [
    (i) => { i.maxBytes += 1; },
    (i) => { i.bodyEncoding = "multipart"; },
    (i) => { i.fields = { file: "invalid" }; },
    (i) => { i.fileFieldName = "file"; },
    (i) => { i.headers["content-length"] = "999"; },
    (i) => { i.headers["content-type"] = "text/plain"; },
    (i) => { i.headers["x-amz-content-sha256"] = "invalid"; },
    (i) => { i.headers["x-amz-meta-sha256"] = "0".repeat(64); },
    (i) => { i.headers["x-amz-meta-media-id"] = "foreign-media"; },
    (i) => { i.headers.Authorization = "secret"; },
    (i) => { i.headers.Cookie = "secret"; },
    (i) => { i.headers.apikey = "secret"; },
    (i) => { i.headers["Content-Type"] = "image/png"; },
    (i) => { delete i.headers["content-length"]; },
    (i) => { i.uploadUrl = "http://storage.example.test/upload"; },
    (i) => { i.uploadUrl = "https://user:password@storage.example.test/upload"; },
    (i) => { i.expiresAt = "invalid"; },
    (i) => { i.expiresAt = "2000-01-01T00:00:00.000Z"; },
  ]) {
    const h = rawUploadHarness(change);
    await assert.rejects(h.client.uploadMedia(h.file, "POST", "bad-put-policy"));
    assert.equal(h.calls.length, 1);
  }
});

test("raw PUT complete-only retry preserves one upload and the same idempotency key", async () => {
  const h = rawUploadHarness(undefined, { failFirstComplete: true });
  await assert.rejects(h.client.uploadMedia(h.file, "POST", "raw-complete-retry"));
  await h.client.uploadMedia(h.file, "POST", "raw-complete-retry");
  assert.equal(h.calls.filter((c) => c.init.method === "PUT").length, 1);
  assert.equal(h.calls.filter((c) => c.url.endsWith("/v1/media/uploads")).length, 1);
  const completed = h.calls.filter((c) => c.url.endsWith("/complete"));
  assert.equal(completed.length, 2);
  assert.ok(completed.every((c) => c.init.headers.get("idempotency-key") === "raw-complete-retry"));
});

test("loopback HTTP uploads require explicit development mode", async () => {
  const change = (i) => { i.uploadUrl = "http://127.0.0.1:55433/signed-put"; };
  const release = rawUploadHarness(change, { development: false });
  await assert.rejects(release.client.uploadMedia(release.file, "POST", "release-http"));
  assert.equal(release.calls.length, 1);
  const local = rawUploadHarness(change, { development: true });
  await local.client.uploadMedia(local.file, "POST", "dev-http");
  assert.equal(local.calls[1].init.method, "PUT");
});

test("raw PUT never completes after failed or redirected storage responses", async () => {
  for (const storageResponse of [{ ok: false, status: 403, redirected: false }, { ok: true, status: 200, redirected: true }]) {
    const h = rawUploadHarness(undefined, { storageResponse });
    await assert.rejects(h.client.uploadMedia(h.file, "POST", "rejected-storage-response"), { code: "MEDIA_UPLOAD_FAILED" });
    assert.equal(h.calls.length, 2);
  }
});
