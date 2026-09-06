import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { createDatabasePool } from "@dabboba/db";
import type { ApiConfig, SupabaseStorageConfiguration } from "@dabboba/config";
import { buildApp } from "../app.js";
import { SupabaseMediaStorage } from "@dabboba/media-storage";
import { issueSession } from "../plugins/auth.js";

// This is deliberately not part of a silently skipped *.test suite. The
// dedicated command requires the real, isolated local Storage service.
function localDatabase(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing local conformance setting ${key}`);
  const url = new URL(value);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/dabboba_integration") throw new Error("Storage conformance refuses a non-fixture database");
  return value;
}

const ownerUrl = localDatabase("DABBOBA_TEST_DATABASE_URL");
const runtimeUrl = localDatabase("DABBOBA_RUNTIME_TEST_DATABASE_URL");
const storageConfig = JSON.parse(process.env.DABBOBA_TEST_STORAGE_CONFIG ?? "null") as SupabaseStorageConfiguration | null;
if (!storageConfig || new URL(storageConfig.url).hostname !== "127.0.0.1"
  || new URL(storageConfig.s3Endpoint).hostname !== "127.0.0.1" || !storageConfig.allowLocalHttp) {
  throw new Error("Storage conformance requires explicit loopback-only Storage configuration");
}
const storage = storageConfig;
const digest = (data: Buffer) => createHash("sha256").update(data).digest("hex");

test("real Supabase Storage through authenticated API preserves upload, immutable finalize, read, and delete invariants", { timeout: 90_000 }, async (t) => {
  const ownerPool = createDatabasePool(ownerUrl, "dabboba-storage-conformance-setup");
  const runtimePool = createDatabasePool(runtimeUrl, "dabboba-storage-conformance-runtime");
  const config: ApiConfig = {
    environment: "test", host: "127.0.0.1", port: 8788, databaseUrl: runtimeUrl, redisUrl: null,
    webOrigins: [], adminOrigins: [], sessionTokenPepper: "local-storage-api-conformance-only",
    adminProxyIdentitySecret: null, sessionTtlDays: 1, paymentProvider: "UNCONFIGURED", paymentWebhookSecret: null,
    gcsBucket: null, gcsProjectId: null, mediaStorageProvider: "supabase", supabaseStorage: storage, logLevel: "silent",
  };
  const { app } = await buildApp({ config, pool: runtimePool, redis: null });
  t.after(async () => { await app.close(); await runtimePool.end(); await ownerPool.end(); });
  const createActor = async () => {
    const row = await ownerPool.query<{ id: string }>("INSERT INTO users(email,nickname,status) VALUES($1,$2,'ACTIVE') RETURNING id", [
      `storage-${randomUUID()}@example.test`, "Storage conformance",
    ]);
    const id = row.rows[0]!.id;
    const session = await issueSession(runtimePool, config, { userId: id, kind: "USER", ip: "127.0.0.1", userAgent: "local-storage-conformance" });
    return { id, token: session.token };
  };
  const owner = await createActor();
  const other = await createActor();
  const image = await sharp({ create: { width: 8, height: 6, channels: 3, background: { r: 80, g: 160, b: 75 } } }).png().toBuffer();
  const headers = (actor = owner, key = randomUUID()) => ({ authorization: `Bearer ${actor.token}`, "idempotency-key": key });
  const payload = { purpose: "WANTED_REQUEST", filename: "photo.png", mimeType: "image/png", byteSize: image.length, checksumSha256: digest(image), acceptedUploadMethods: ["POST", "PUT"] };
  type Intent = { mediaId: string; uploadUrl: string; method: "PUT"; headers: Record<string, string>; maxBytes: number };
  const createIntent = async (overrides = {}, key = randomUUID()) => {
    const result = await app.inject({ method: "POST", url: "/v1/media/uploads", headers: headers(owner, key), payload: { ...payload, ...overrides } });
    assert.equal(result.statusCode, 201, result.json().error?.code);
    const intent = result.json<Intent>();
    assert.equal(intent.method, "PUT");
    assert.equal(intent.maxBytes, image.length);
    assert.equal(new URL(intent.uploadUrl).searchParams.get("X-Amz-Expires"), "120");
    return intent;
  };
  const upload = async (intent: Intent, data = image) => {
    const response = await fetch(intent.uploadUrl, { method: "PUT", headers: intent.headers, body: data, redirect: "error", signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200);
  };
  const complete = (id: string, key = randomUUID(), actor = owner) => app.inject({ method: "POST", url: `/v1/media/${id}/complete`, headers: headers(actor, key), payload: {} });
  const read = (id: string, actor = owner) => app.inject({ method: "GET", url: `/v1/media/${id}/url`, headers: headers(actor) });

  await t.test("requires compatible client and refuses foreign access", async () => {
    const legacy = await app.inject({ method: "POST", url: "/v1/media/uploads", headers: headers(), payload: { ...payload, acceptedUploadMethods: undefined } });
    assert.equal(legacy.statusCode, 426);
    const intent = await createIntent();
    assert.equal((await complete(intent.mediaId, randomUUID(), other)).statusCode, 403);
  });

  let readyId: string;
  await t.test("direct upload, idempotent intent, concurrent completion, version-pinned WebP read", async () => {
    const key = randomUUID();
    const intent = await createIntent({}, key);
    const replay = await createIntent({}, key);
    assert.equal(replay.mediaId, intent.mediaId);
    assert.equal(digest(Buffer.from(replay.uploadUrl)), digest(Buffer.from(intent.uploadUrl)));
    await upload(intent);
    const completionKey = randomUUID();
    const results = await Promise.all([complete(intent.mediaId, completionKey), complete(intent.mediaId, completionKey)]);
    assert.ok(results.some((result) => result.statusCode === 200));
    assert.ok(results.every((result) => [200, 409].includes(result.statusCode)));
    const row = (await ownerPool.query("SELECT * FROM media_assets WHERE id=$1", [intent.mediaId])).rows[0]!;
    assert.equal(row.status, "READY");
    assert.equal(row.object_generation, null);
    assert.equal(row.metadata.storage.provider, "supabase");
    assert.match(row.metadata.storage.version, /^[a-f0-9-]{36}$/);
    assert.match(row.object_key, new RegExp(`^media/${intent.mediaId}/[a-f0-9]{64}-[a-f0-9-]{36}\\.webp$`));
    assert.equal((await read(intent.mediaId, other)).statusCode, 403);
    const signed = await read(intent.mediaId);
    assert.equal(signed.statusCode, 200, signed.json().error?.code);
    const response = await fetch(signed.json().url, { redirect: "error", signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200);
    const output = Buffer.from(await response.arrayBuffer());
    assert.equal(digest(output), row.checksum_sha256);
    assert.equal((await sharp(output).metadata()).format, "webp");
    assert.equal((await sharp(output).metadata()).exif, undefined);
    // Original signed staging authority may still be replayable. A replay
    // cannot change the server-only final object or its pinned read result.
    await upload(intent);
    const afterReplay = await fetch(signed.json().url, { redirect: "error", signal: AbortSignal.timeout(10_000) });
    assert.equal(digest(Buffer.from(await afterReplay.arrayBuffer())), row.checksum_sha256);
    readyId = intent.mediaId;
  });

  await t.test("matching declarations cannot forge actual content hash", async () => {
    const intent = await createIntent({ checksumSha256: "0".repeat(64) });
    await upload(intent);
    const result = await complete(intent.mediaId);
    assert.equal(result.statusCode, 400);
    assert.equal(result.json().error.code, "MEDIA_IMAGE_INVALID");
    const row = (await ownerPool.query("SELECT status FROM media_assets WHERE id=$1", [intent.mediaId])).rows[0]!;
    assert.equal(row.status, "REJECTED");
  });

  await t.test("expired reservation rejects completion and preserves deletion authority", async () => {
    const intent = await createIntent();
    await upload(intent);
    await ownerPool.query("UPDATE media_assets SET metadata=jsonb_set(metadata,'{uploadIntentExpiresAt}',to_jsonb((now()-interval '1 second')::text)) WHERE id=$1", [intent.mediaId]);
    assert.equal((await complete(intent.mediaId)).statusCode, 410);
  });

  await t.test("owner delete withdraws reads and uses the stored provider", async () => {
    assert.ok(readyId!);
    const result = await app.inject({ method: "DELETE", url: `/v1/media/${readyId!}`, headers: headers() });
    assert.equal(result.statusCode, 204);
    assert.equal((await read(readyId!)).statusCode, 404);
    const row = (await ownerPool.query("SELECT status,metadata FROM media_assets WHERE id=$1", [readyId!])).rows[0]!;
    assert.equal(row.status, "DELETED");
    assert.equal(row.metadata.storage.provider, "supabase");
  });

  await t.test("a reclaimed writer retains durable loser cleanup without replacing the winner", async () => {
    const { app: raceApp } = await buildApp({ config, pool: runtimePool, redis: null });
    const originalWrite = SupabaseMediaStorage.prototype.writeFinal;
    let resume!: () => void;
    let written!: () => void;
    const paused = new Promise<void>((resolve) => { resume = resolve; });
    const didWrite = new Promise<void>((resolve) => { written = resolve; });
    let first = true;
    let loserKey = "";
    SupabaseMediaStorage.prototype.writeFinal = async function (...args) {
      const result = await originalWrite.apply(this, args);
      if (first) { first = false; loserKey = args[0]; written(); await paused; }
      return result;
    };
    let firstRequest: Promise<unknown> | undefined;
    try {
      const created = await raceApp.inject({ method: "POST", url: "/v1/media/uploads", headers: headers(), payload });
      assert.equal(created.statusCode, 201);
      const intent = created.json<Intent>();
      await upload(intent);
      const key = randomUUID();
      firstRequest = raceApp.inject({ method: "POST", url: `/v1/media/${intent.mediaId}/complete`, headers: headers(owner, key), payload: {} }).then((response) => {
        assert.equal(response.statusCode, 200, response.json().error?.code);
      });
      await Promise.race([didWrite, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("First writer never reached the real Storage boundary")), 10_000); timer.unref(); })]);
      const during = (await ownerPool.query("SELECT metadata FROM media_assets WHERE id=$1", [intent.mediaId])).rows[0]!;
      assert.deepEqual(during.metadata.storageCleanup.pendingFinalObjectKeys, [loserKey]);
      await ownerPool.query(`UPDATE media_assets SET metadata=jsonb_set(metadata,'{processing}',
        metadata->'processing' || jsonb_build_object('claimedAt',(now()-interval '6 minutes')::text,'trackedAt',(now()-interval '6 minutes')::text)) WHERE id=$1`, [intent.mediaId]);
      const winner = await raceApp.inject({ method: "POST", url: `/v1/media/${intent.mediaId}/complete`, headers: headers(owner, key), payload: {} });
      assert.equal(winner.statusCode, 200, winner.json().error?.code);
      const settled = (await ownerPool.query("SELECT object_key,metadata FROM media_assets WHERE id=$1", [intent.mediaId])).rows[0]!;
      assert.notEqual(settled.object_key, loserKey);
      assert.deepEqual(settled.metadata.storageCleanup.pendingFinalObjectKeys, [loserKey]);
      resume();
      await firstRequest;
      const client = new SupabaseMediaStorage(storage);
      assert.equal((await client.stat(settled.object_key)).version, settled.metadata.storage.version);
      await assert.rejects(client.stat(loserKey), (error: unknown) => {
        const status = (error as { statusCode?: number }).statusCode;
        return status === 400 || status === 404;
      });
      const after = (await ownerPool.query("SELECT object_key,metadata FROM media_assets WHERE id=$1", [intent.mediaId])).rows[0]!;
      assert.equal(after.object_key, settled.object_key);
      assert.deepEqual(after.metadata.storageCleanup.pendingFinalObjectKeys, [loserKey]);
    } finally {
      resume();
      await firstRequest;
      SupabaseMediaStorage.prototype.writeFinal = originalWrite;
      await raceApp.close();
    }
  });
});
