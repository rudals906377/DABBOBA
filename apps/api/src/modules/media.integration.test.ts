import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import { Storage } from "@google-cloud/storage";
import sharp from "sharp";
import { buildApp } from "../app.js";
import { acceptRequiredPoliciesForIntegrationTest } from "../integration-test-fixtures.js";
import { issueSession } from "../plugins/auth.js";
import { sanitizeImage } from "../lib/image-sanitizer-node.js";
import {
  mediaUploadCompleteFingerprint,
  reserveMediaUploadIntent,
  type MediaUploadReservationInput,
} from "./media.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;

test(
  "media upload reservations serialize per-user quotas and replace expired pending intents",
  { skip: !databaseUrl },
  async (t) => {
    const pool = createDatabasePool(databaseUrl!, "dabboba-media-integration");
    t.after(async () => pool.end());

    const createUser = async (label: string) => {
      const suffix = randomUUID();
      const result = await pool.query<{ id: string }>(
        "INSERT INTO users(email,nickname) VALUES($1,$2) RETURNING id",
        [`media-${label}-${suffix}@example.test`, `미디어 ${label}`],
      );
      return result.rows[0]!.id;
    };
    const inputFor = (ownerId: string, sequence: number, byteSize: number): MediaUploadReservationInput => {
      const id = randomUUID();
      return {
        id,
        ownerId,
        purpose: "POST",
        objectKey: `uploads/${ownerId}/${id}/image.png`,
        filename: "image.png",
        mimeType: "image/png",
        byteSize,
        checksumSha256: sequence.toString(16).padStart(64, "0"),
      };
    };

    const countOwnerId = await createUser("count");
    const concurrent = await Promise.all(
      Array.from({ length: 11 }, (_, index) => reserveMediaUploadIntent(
        pool,
        inputFor(countOwnerId, index + 1, 1),
      )),
    );
    assert.equal(concurrent.filter((result) => result.reserved).length, 10);
    assert.equal(concurrent.filter((result) => !result.reserved).length, 1);
    const pending = await pool.query<{ id: string; object_key: string }>(
      "SELECT id,object_key FROM media_assets WHERE owner_id=$1 AND status='PENDING_UPLOAD' ORDER BY id LIMIT 1",
      [countOwnerId],
    );
    assert.equal(pending.rowCount, 1);
    const replacement = await reserveMediaUploadIntent(
      pool,
      inputFor(countOwnerId, 20, 1),
      new Date(Date.now() + 20 * 60_000),
    );
    assert.equal(replacement.reserved, true);
    assert.equal(replacement.expiredObjectKeys.length, 10);
    assert.equal(replacement.expiredObjectKeys.includes(pending.rows[0]!.object_key), true);
    const expired = await pool.query<{ status: string }>(
      "SELECT status FROM media_assets WHERE id=$1",
      [pending.rows[0]!.id],
    );
    assert.equal(expired.rows[0]!.status, "REJECTED");

    const bytesOwnerId = await createUser("bytes");
    const tenMiB = 10 * 1024 * 1024;
    for (let index = 0; index < 3; index += 1) {
      const result = await reserveMediaUploadIntent(pool, inputFor(bytesOwnerId, index + 100, tenMiB));
      assert.equal(result.reserved, true);
    }
    const exceedsBytes = await reserveMediaUploadIntent(pool, inputFor(bytesOwnerId, 104, 1));
    assert.equal(exceedsBytes.reserved, false);
    assert.equal(exceedsBytes.activeBytes, 30 * 1024 * 1024);

    const dailyOwnerId = await createUser("daily");
    await pool.query(
      `INSERT INTO media_assets
        (owner_id,purpose,object_key,original_filename,declared_mime_type,byte_size,checksum_sha256,status)
       SELECT $1::uuid,'POST','uploads/' || $1::text || '/' || gen_random_uuid()::text || '/daily.png',
              'daily.png','image/png',1,$2,'REJECTED'
         FROM generate_series(1,50)`,
      [dailyOwnerId, "d".repeat(64)],
    );
    const dailyLimit = await reserveMediaUploadIntent(pool, inputFor(dailyOwnerId, 105, 1));
    assert.equal(dailyLimit.reserved, false);
    assert.equal(dailyLimit.dailyCount, 50);

    const readyOwnerId = await createUser("ready");
    const readyMediaId = randomUUID();
    await pool.query(
      `INSERT INTO media_assets
        (id,owner_id,purpose,object_key,object_generation,original_filename,declared_mime_type,
         detected_mime_type,byte_size,checksum_sha256,status,width,height)
       VALUES($1,$2,'POST',$3,1,'ready.webp','image/webp','image/webp',$4,$5,'READY',1,1)`,
      [
        readyMediaId,
        readyOwnerId,
        `media/${readyMediaId}/${"e".repeat(64)}.webp`,
        512 * 1024 * 1024,
        "e".repeat(64),
      ],
    );
    const readyLimit = await reserveMediaUploadIntent(pool, inputFor(readyOwnerId, 106, 1));
    assert.equal(readyLimit.reserved, false);
    assert.equal(readyLimit.readyBytes, 512 * 1024 * 1024);
  },
);

test(
  "media intent and completion keys durably replay, release failures, and reclaim stale processing",
  { skip: !databaseUrl, timeout: 60_000 },
  async (t) => {
    type StoredObject = {
      data: Buffer;
      contentType: string;
      metadata: Record<string, string>;
      generation: string;
    };
    const objects = new Map<string, StoredObject>();
    const failures = new Map<string, number>();
    const calls = { signedPolicies: 0, saves: 0, reads: 0 };
    let savePause: {
      name: string;
      started: () => void;
      releasePromise: Promise<void>;
    } | null = null;
    const pauseSave = (name: string) => {
      let started!: () => void;
      let release!: () => void;
      const startedPromise = new Promise<void>((resolve) => { started = resolve; });
      const releasePromise = new Promise<void>((resolve) => { release = resolve; });
      savePause = { name, started, releasePromise };
      return { startedPromise, release };
    };
    const missing = (name: string) => Object.assign(new Error(`missing fake object: ${name}`), { code: 404 });
    const fakeBucket = {
      file(name: string) {
        return {
          name,
          async generateSignedPostPolicyV4(options: { fields?: Record<string, string> }) {
            calls.signedPolicies += 1;
            return [{
              url: "https://storage.example.test/fake-media",
              fields: { key: name, ...(options.fields ?? {}) },
            }];
          },
          async getMetadata() {
            const remainingFailures = failures.get(name) ?? 0;
            if (remainingFailures > 0) {
              failures.set(name, remainingFailures - 1);
              throw Object.assign(new Error("temporary fake storage failure"), { code: 503 });
            }
            const stored = objects.get(name);
            if (!stored) throw missing(name);
            return [{
              generation: stored.generation,
              size: String(stored.data.length),
              contentType: stored.contentType,
              metadata: stored.metadata,
            }];
          },
          createReadStream() {
            const stored = objects.get(name);
            if (!stored) return Readable.from((async function* missingObject() { throw missing(name); })());
            calls.reads += 1;
            return Readable.from([stored.data]);
          },
          async save(data: Buffer, options: {
            metadata?: { contentType?: string; metadata?: Record<string, string> };
            preconditionOpts?: { ifGenerationMatch?: number };
          }) {
            if (options.preconditionOpts?.ifGenerationMatch === 0 && objects.has(name)) {
              throw Object.assign(new Error("fake generation precondition failed"), { code: 412 });
            }
            const pause = savePause;
            if (pause?.name === name) {
              pause.started();
              await pause.releasePromise;
              if (savePause === pause) savePause = null;
            }
            calls.saves += 1;
            objects.set(name, {
              data: Buffer.from(data),
              contentType: options.metadata?.contentType ?? "application/octet-stream",
              metadata: options.metadata?.metadata ?? {},
              generation: String(objects.size + 10),
            });
          },
          async delete() {
            objects.delete(name);
          },
        };
      },
    };
    const storagePrototype = Storage.prototype as unknown as { bucket: (name: string) => unknown };
    const originalBucket = storagePrototype.bucket;
    storagePrototype.bucket = () => fakeBucket;
    t.after(() => {
      storagePrototype.bucket = originalBucket;
    });

    const pool = createDatabasePool(databaseUrl!, "dabboba-media-idempotency-integration");
    const config: ApiConfig = {
      environment: "test",
      host: "127.0.0.1",
      port: 8788,
      databaseUrl: databaseUrl!,
      redisUrl: "redis://127.0.0.1:6379",
      webOrigins: ["http://127.0.0.1:4174"],
      adminOrigins: ["http://127.0.0.1:4180"],
      sessionTokenPepper: "media-idempotency-integration-pepper",
      adminProxyIdentitySecret: null,
      sessionTtlDays: 1,
      paymentProvider: "UNCONFIGURED",
      paymentWebhookSecret: null,
      gcsBucket: "fake-media-bucket",
      gcsProjectId: "fake-media-project",
      logLevel: "silent",
    };
    const { app } = await buildApp({ config, pool, redis: null });
    const { app: recoveryApp } = await buildApp({ config, pool, redis: null });
    const { app: deleteApp } = await buildApp({ config, pool, redis: null });
    t.after(async () => {
      await app.close();
      await recoveryApp.close();
      await deleteApp.close();
      await pool.end();
    });

    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const createActor = async (label: string) => {
      const user = await pool.query<{ id: string }>(
        "INSERT INTO users(email,nickname,status) VALUES($1,$2,'ACTIVE') RETURNING id",
        [`media-${label}-${suffix}@example.test`, `미디어 ${label} ${suffix}`],
      );
      await acceptRequiredPoliciesForIntegrationTest(pool, user.rows[0]!.id);
      const session = await issueSession(pool, config, {
        userId: user.rows[0]!.id,
        kind: "USER",
        ip: "203.0.113.121",
        userAgent: "Dabboba Media Idempotency Integration/1.0",
      });
      return { id: user.rows[0]!.id, token: session.token };
    };
    const owner = await createActor("owner");
    const authHeaders = (token: string, key: string) => ({
      authorization: `Bearer ${token}`,
      "idempotency-key": key,
    });
    const inputImage = await sharp({
      create: { width: 3, height: 2, channels: 3, background: { r: 24, g: 86, b: 155 } },
    }).png().toBuffer();
    const checksumSha256 = createHash("sha256").update(inputImage).digest("hex");
    const intentPayload = (filename: string, byteSize = inputImage.length) => ({
      purpose: "POST",
      filename,
      mimeType: "image/png",
      byteSize,
      checksumSha256,
    });
    const createIntent = (token: string, key: string, filename = "media.png") => app.inject({
      method: "POST",
      url: "/v1/media/uploads",
      headers: authHeaders(token, key),
      payload: intentPayload(filename),
    });
    const stageUpload = async (mediaId: string) => {
      const media = await pool.query<{ object_key: string }>("SELECT object_key FROM media_assets WHERE id=$1", [mediaId]);
      const objectKey = media.rows[0]!.object_key;
      objects.set(objectKey, {
        data: inputImage,
        contentType: "image/png",
        metadata: { sha256: checksumSha256, "media-id": mediaId },
        generation: String(objects.size + 1),
      });
      return objectKey;
    };

    const intentKey = `media-intent-${randomUUID()}`;
    const firstIntent = await createIntent(owner.token, intentKey, "  Sample Image.PNG  ");
    assert.equal(firstIntent.statusCode, 201, firstIntent.body);
    const firstIntentBody = firstIntent.json() as { mediaId: string; expiresAt: string };
    const intentReplay = await createIntent(owner.token, intentKey, "Sample-Image.png");
    assert.equal(intentReplay.statusCode, 201, intentReplay.body);
    assert.equal(intentReplay.headers["x-idempotent-replay"], "true");
    assert.deepEqual(intentReplay.json(), firstIntent.json());
    const changedIntent = await app.inject({
      method: "POST",
      url: "/v1/media/uploads",
      headers: authHeaders(owner.token, intentKey),
      payload: intentPayload("Sample-Image.png", inputImage.length + 1),
    });
    assert.equal(changedIntent.statusCode, 409, changedIntent.body);
    const intentAssets = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM media_assets WHERE owner_id=$1",
      [owner.id],
    );
    assert.equal(intentAssets.rows[0]!.count, "1");

    const expiredContract = { ...firstIntentBody, expiresAt: "2020-01-01T00:00:00.000Z" };
    await pool.query(
      `UPDATE idempotency_keys SET response_body=$4::jsonb
        WHERE actor_id=$1 AND scope='MEDIA_UPLOAD_INTENT_CREATE' AND idempotency_key=$2 AND resource_id=$3`,
      [owner.id, intentKey, firstIntentBody.mediaId, JSON.stringify(expiredContract)],
    );
    const expiredReplay = await createIntent(owner.token, intentKey, "Sample-Image.png");
    assert.equal(expiredReplay.statusCode, 201, expiredReplay.body);
    assert.equal(expiredReplay.headers["x-idempotent-replay"], "true");
    assert.equal((expiredReplay.json() as { mediaId: string }).mediaId, firstIntentBody.mediaId);
    assert.equal((expiredReplay.json() as { expiresAt: string }).expiresAt, expiredContract.expiresAt);
    const rotatedIntentKey = `media-intent-${randomUUID()}`;
    const rotatedIntent = await createIntent(owner.token, rotatedIntentKey, "Sample-Image.png");
    assert.equal(rotatedIntent.statusCode, 201, rotatedIntent.body);
    const rotatedMediaId = (rotatedIntent.json() as { mediaId: string }).mediaId;
    assert.notEqual(rotatedMediaId, firstIntentBody.mediaId);

    await stageUpload(rotatedMediaId);
    const completeKey = rotatedIntentKey;
    const completed = await app.inject({
      method: "POST",
      url: `/v1/media/${rotatedMediaId}/complete`,
      headers: authHeaders(owner.token, completeKey),
    });
    assert.equal(completed.statusCode, 200, completed.body);
    assert.deepEqual(completed.json(), { mediaId: rotatedMediaId, status: "READY", mimeType: "image/webp" });
    const savesAfterComplete = calls.saves;
    const completeReplay = await app.inject({
      method: "POST",
      url: `/v1/media/${rotatedMediaId}/complete`,
      headers: authHeaders(owner.token, completeKey),
    });
    assert.equal(completeReplay.statusCode, 200, completeReplay.body);
    assert.equal(completeReplay.headers["x-idempotent-replay"], "true");
    assert.deepEqual(completeReplay.json(), completed.json());
    assert.equal(calls.saves, savesAfterComplete);
    const readyEvents = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM outbox_events WHERE aggregate_type='MEDIA' AND aggregate_id=$1 AND event_type='media.ready'",
      [rotatedMediaId],
    );
    assert.equal(readyEvents.rows[0]!.count, "1");

    await pool.query(
      `UPDATE idempotency_keys
          SET state='PROCESSING',response_status=NULL,response_body=NULL
        WHERE actor_id=$1 AND scope='MEDIA_UPLOAD_COMPLETE' AND idempotency_key=$2`,
      [owner.id, completeKey],
    );
    const reconstructed = await app.inject({
      method: "POST",
      url: `/v1/media/${rotatedMediaId}/complete`,
      headers: authHeaders(owner.token, completeKey),
    });
    assert.equal(reconstructed.statusCode, 200, reconstructed.body);
    assert.equal(reconstructed.headers["x-idempotent-replay"], "true");
    assert.deepEqual(reconstructed.json(), completed.json());
    assert.equal(calls.saves, savesAfterComplete);
    const reconstructedLedger = await pool.query<{ state: string; resource_id: string | null }>(
      `SELECT state,resource_id FROM idempotency_keys
        WHERE actor_id=$1 AND scope='MEDIA_UPLOAD_COMPLETE' AND idempotency_key=$2`,
      [owner.id, completeKey],
    );
    assert.deepEqual(reconstructedLedger.rows[0], { state: "COMPLETED", resource_id: rotatedMediaId });

    const changedComplete = await app.inject({
      method: "POST",
      url: `/v1/media/${firstIntentBody.mediaId}/complete`,
      headers: authHeaders(owner.token, completeKey),
    });
    assert.equal(changedComplete.statusCode, 409, changedComplete.body);

    const retryIntentKey = `media-retry-${randomUUID()}`;
    const retryIntent = await createIntent(owner.token, retryIntentKey, "retry.png");
    assert.equal(retryIntent.statusCode, 201, retryIntent.body);
    const retryMediaId = (retryIntent.json() as { mediaId: string }).mediaId;
    const retryStagingKey = await stageUpload(retryMediaId);
    failures.set(retryStagingKey, 1);
    const failedComplete = await app.inject({
      method: "POST",
      url: `/v1/media/${retryMediaId}/complete`,
      headers: authHeaders(owner.token, retryIntentKey),
    });
    assert.equal(failedComplete.statusCode, 500, failedComplete.body);
    const releasedFailure = await pool.query<{ status: string; ledger_count: string }>(
      `SELECT m.status,
         (SELECT count(*)::text FROM idempotency_keys i
           WHERE i.actor_id=m.owner_id AND i.scope='MEDIA_UPLOAD_COMPLETE' AND i.idempotency_key=$2) AS ledger_count
       FROM media_assets m WHERE m.id=$1`,
      [retryMediaId, retryIntentKey],
    );
    assert.deepEqual(releasedFailure.rows[0], { status: "PENDING_UPLOAD", ledger_count: "0" });
    const retriedComplete = await app.inject({
      method: "POST",
      url: `/v1/media/${retryMediaId}/complete`,
      headers: authHeaders(owner.token, retryIntentKey),
    });
    assert.equal(retriedComplete.statusCode, 200, retriedComplete.body);

    const staleOwner = await createActor("stale-owner");
    const staleKey = `media-stale-${randomUUID()}`;
    const staleIntent = await recoveryApp.inject({
      method: "POST",
      url: "/v1/media/uploads",
      headers: authHeaders(staleOwner.token, staleKey),
      payload: intentPayload("stale.png"),
    });
    assert.equal(staleIntent.statusCode, 201, staleIntent.body);
    const staleMediaId = (staleIntent.json() as { mediaId: string }).mediaId;
    await stageUpload(staleMediaId);
    const preexistingSanitized = await sanitizeImage(inputImage, "image/png");
    const preexistingFinalKey = `media/${staleMediaId}/${preexistingSanitized.checksumSha256}.webp`;
    objects.set(preexistingFinalKey, {
      data: preexistingSanitized.data,
      contentType: preexistingSanitized.mimeType,
      metadata: { sha256: preexistingSanitized.checksumSha256, "media-id": staleMediaId, sanitized: "true" },
      generation: String(objects.size + 1),
    });
    const savesBeforeStaleRecovery = calls.saves;
    const staleLedgerId = randomUUID();
    await pool.query(
      `INSERT INTO idempotency_keys
        (id,actor_id,scope,idempotency_key,request_hash,state,expires_at)
       VALUES($1,$2,'MEDIA_UPLOAD_COMPLETE',$3,$4,'PROCESSING',now()+interval '24 hours')`,
      [staleLedgerId, staleOwner.id, staleKey, mediaUploadCompleteFingerprint(staleOwner.id, staleMediaId)],
    );
    await pool.query(
      `UPDATE media_assets
          SET status='PROCESSING',metadata=jsonb_build_object(
            'processing',jsonb_build_object(
              'idempotencyId',$2::text,
              'idempotencyKey',$3::text,
              'claimToken',$4::text,
              'claimedAt',now()::text,
              'previousStatus','PENDING_UPLOAD'
            )
          )
        WHERE id=$1`,
      [staleMediaId, staleLedgerId, staleKey, randomUUID()],
    );
    const processingConflict = await recoveryApp.inject({
      method: "POST",
      url: `/v1/media/${staleMediaId}/complete`,
      headers: authHeaders(staleOwner.token, staleKey),
    });
    assert.equal(processingConflict.statusCode, 409, processingConflict.body);
    await pool.query(
      `UPDATE media_assets
          SET metadata=jsonb_set(metadata,'{processing,claimedAt}',to_jsonb((now()-interval '10 minutes')::text))
        WHERE id=$1`,
      [staleMediaId],
    );
    const reclaimed = await recoveryApp.inject({
      method: "POST",
      url: `/v1/media/${staleMediaId}/complete`,
      headers: authHeaders(staleOwner.token, staleKey),
    });
    assert.equal(reclaimed.statusCode, 200, reclaimed.body);
    assert.deepEqual(reclaimed.json(), { mediaId: staleMediaId, status: "READY", mimeType: "image/webp" });
    assert.equal(calls.saves, savesBeforeStaleRecovery);
    const reclaimedState = await pool.query<{ media_status: string; ledger_state: string; event_count: string }>(
      `SELECT m.status AS media_status,i.state AS ledger_state,
         (SELECT count(*)::text FROM outbox_events o
           WHERE o.aggregate_type='MEDIA' AND o.aggregate_id=m.id::text AND o.event_type='media.ready') AS event_count
       FROM media_assets m JOIN idempotency_keys i ON i.id=$2 WHERE m.id=$1`,
      [staleMediaId, staleLedgerId],
    );
    assert.deepEqual(reclaimedState.rows[0], {
      media_status: "READY",
      ledger_state: "COMPLETED",
      event_count: "1",
    });

    const deleteOwner = await createActor("delete-owner");
    const deleteOther = await createActor("delete-other");
    const insertMedia = async (
      status: "PENDING_UPLOAD" | "UPLOADED" | "PROCESSING" | "READY" | "REJECTED",
      label: string,
      metadata: Record<string, unknown> = {},
    ) => {
      const mediaId = randomUUID();
      const objectKey = `${status === "READY" ? "media" : "uploads"}/${deleteOwner.id}/${mediaId}/${label}.png`;
      await pool.query(
        `INSERT INTO media_assets
          (id,owner_id,purpose,object_key,object_generation,original_filename,declared_mime_type,
           detected_mime_type,byte_size,checksum_sha256,status,width,height,metadata)
         VALUES($1,$2,'POST',$3,$4,$5,'image/png',$6,$7,$8,$9,$10,$11,$12::jsonb)`,
        [
          mediaId,
          deleteOwner.id,
          objectKey,
          status === "READY" ? 1 : null,
          `${label}.png`,
          status === "READY" ? "image/webp" : null,
          inputImage.length,
          checksumSha256,
          status,
          status === "READY" ? 3 : null,
          status === "READY" ? 2 : null,
          JSON.stringify(metadata),
        ],
      );
      objects.set(objectKey, {
        data: inputImage,
        contentType: status === "READY" ? "image/webp" : "image/png",
        metadata: { sha256: checksumSha256, "media-id": mediaId },
        generation: String(objects.size + 1),
      });
      return { mediaId, objectKey };
    };
    const deleteMedia = (token: string, mediaId: string, key?: string) => deleteApp.inject({
      method: "DELETE",
      url: `/v1/media/${mediaId}`,
      headers: {
        authorization: `Bearer ${token}`,
        ...(key ? { "idempotency-key": key } : {}),
      },
    });

    const inquiryReference = await insertMedia("READY", "inquiry-reference");
    const inquiry = await pool.query<{ id: string }>(
      "INSERT INTO inquiries(user_id,category,title) VALUES($1,'PRODUCT',$2) RETURNING id",
      [deleteOwner.id, `미디어 삭제 문의 ${suffix}`],
    );
    const inquiryMessage = await pool.query<{ id: string }>(
      "INSERT INTO inquiry_messages(inquiry_id,author_id,author_role,content) VALUES($1,$2,'USER',$3) RETURNING id",
      [inquiry.rows[0]!.id, deleteOwner.id, "첨부 참조"],
    );
    await pool.query(
      "INSERT INTO inquiry_message_media(message_id,media_id) VALUES($1,$2)",
      [inquiryMessage.rows[0]!.id, inquiryReference.mediaId],
    );

    const postReference = await insertMedia("READY", "post-reference");
    const post = await pool.query<{ id: string }>(
      `INSERT INTO community_posts(author_id,kind,title,content)
       VALUES($1,'GENERAL',$2,$3) RETURNING id`,
      [deleteOwner.id, `미디어 삭제 게시물 ${suffix}`, "첨부 참조"],
    );
    await pool.query(
      "INSERT INTO community_post_media(post_id,media_id) VALUES($1,$2)",
      [post.rows[0]!.id, postReference.mediaId],
    );

    const catalogReference = await insertMedia("READY", "catalog-reference");
    await pool.query(
      `INSERT INTO catalog_requests(user_id,kind,name,media_id)
       VALUES($1,'PRODUCT',$2,$3)`,
      [deleteOwner.id, `미디어 삭제 카탈로그 ${suffix}`, catalogReference.mediaId],
    );

    for (const referenced of [inquiryReference, postReference, catalogReference]) {
      const denied = await deleteMedia(deleteOwner.token, referenced.mediaId, `media-delete-ref-${randomUUID()}`);
      assert.equal(denied.statusCode, 409, denied.body);
      const unchanged = await pool.query<{ status: string }>("SELECT status FROM media_assets WHERE id=$1", [referenced.mediaId]);
      assert.equal(unchanged.rows[0]!.status, "READY");
    }

    const missingKeyMedia = await insertMedia("REJECTED", "missing-key");
    const missingKey = await deleteMedia(deleteOwner.token, missingKeyMedia.mediaId);
    assert.equal(missingKey.statusCode, 409, missingKey.body);
    const hiddenMedia = await insertMedia("REJECTED", "hidden-owner");
    const hiddenOwner = await deleteMedia(deleteOther.token, hiddenMedia.mediaId, `media-delete-hidden-${randomUUID()}`);
    assert.equal(hiddenOwner.statusCode, 404, hiddenOwner.body);
    const missingMedia = await deleteMedia(deleteOwner.token, randomUUID(), `media-delete-missing-${randomUUID()}`);
    assert.equal(missingMedia.statusCode, 404, missingMedia.body);

    const deletionCases: Array<{
      status: "PENDING_UPLOAD" | "UPLOADED" | "PROCESSING" | "READY" | "REJECTED";
      mediaId: string;
      objectKey: string;
      key: string;
      finalObjectKey: string | null;
    }> = [];
    for (const status of ["PENDING_UPLOAD", "UPLOADED", "PROCESSING", "READY", "REJECTED"] as const) {
      const finalObjectKey = status === "PROCESSING"
        ? `media/${randomUUID()}/${"f".repeat(64)}.webp`
        : null;
      const inserted = await insertMedia(status, `delete-${status.toLowerCase()}`, finalObjectKey ? {
        processing: {
          idempotencyId: randomUUID(),
          idempotencyKey: `orphaned-complete-${randomUUID()}`,
          claimToken: randomUUID(),
          claimedAt: new Date().toISOString(),
          previousStatus: "UPLOADED",
          finalObjectKey,
        },
      } : {});
      if (finalObjectKey) {
        objects.set(finalObjectKey, {
          data: inputImage,
          contentType: "image/webp",
          metadata: { sha256: checksumSha256, "media-id": inserted.mediaId, sanitized: "true" },
          generation: String(objects.size + 1),
        });
      }
      deletionCases.push({
        status,
        ...inserted,
        key: `media-delete-${status.toLowerCase()}-${randomUUID()}`,
        finalObjectKey,
      });
    }
    for (const deletionCase of deletionCases) {
      const deleted = await deleteMedia(deleteOwner.token, deletionCase.mediaId, deletionCase.key);
      assert.equal(deleted.statusCode, 204, deleted.body);
      assert.equal(deleted.body, "");
      const state = await pool.query<{
        status: string;
        previous_status: string | null;
        requested_at: string | null;
        event_count: string;
      }>(
        `SELECT m.status,m.metadata->'deletion'->>'previousStatus' AS previous_status,
           m.metadata->'deletion'->>'requestedAt' AS requested_at,
           (SELECT count(*)::text FROM outbox_events o
             WHERE o.aggregate_type='MEDIA' AND o.aggregate_id=m.id::text AND o.event_type='media.deleted') AS event_count
         FROM media_assets m WHERE m.id=$1`,
        [deletionCase.mediaId],
      );
      assert.equal(state.rows[0]!.status, "DELETED");
      assert.equal(state.rows[0]!.previous_status, deletionCase.status);
      assert.ok(state.rows[0]!.requested_at && Number.isFinite(Date.parse(state.rows[0]!.requested_at!)));
      assert.equal(state.rows[0]!.event_count, "1");
      assert.equal(objects.has(deletionCase.objectKey), false);
      if (deletionCase.finalObjectKey) assert.equal(objects.has(deletionCase.finalObjectKey), false);
    }

    const firstDeletion = deletionCases[0]!;
    const deleteReplay = await deleteMedia(deleteOwner.token, firstDeletion.mediaId, firstDeletion.key);
    assert.equal(deleteReplay.statusCode, 204, deleteReplay.body);
    assert.equal(deleteReplay.headers["x-idempotent-replay"], "true");
    const deleteWithNewKey = await deleteMedia(
      deleteOwner.token,
      firstDeletion.mediaId,
      `media-delete-new-key-${randomUUID()}`,
    );
    assert.equal(deleteWithNewKey.statusCode, 204, deleteWithNewKey.body);
    const singleDeletedEvent = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM outbox_events WHERE aggregate_type='MEDIA' AND aggregate_id=$1 AND event_type='media.deleted'",
      [firstDeletion.mediaId],
    );
    assert.equal(singleDeletedEvent.rows[0]!.count, "1");
    const changedDeleteTarget = await deleteMedia(
      deleteOwner.token,
      deletionCases[1]!.mediaId,
      firstDeletion.key,
    );
    assert.equal(changedDeleteTarget.statusCode, 409, changedDeleteTarget.body);

    const approvedOwner = await createActor("approved-delete-owner");
    const gateAdmin = await pool.query<{ id: string }>(
      "INSERT INTO users(email,nickname,role,status) VALUES($1,$2,'ADMIN','ACTIVE') RETURNING id",
      [`media-gate-admin-${suffix}@example.test`, `미디어 게이트 관리자 ${suffix}`],
    );
    const approvedMediaId = randomUUID();
    await pool.query(
      `INSERT INTO media_assets
        (id,owner_id,purpose,object_key,original_filename,declared_mime_type,byte_size,checksum_sha256,status)
       VALUES($1,$2,'POST',$3,'approved.png','image/png',1,$4,'REJECTED')`,
      [approvedMediaId, approvedOwner.id, `uploads/${approvedOwner.id}/${approvedMediaId}/approved.png`, "a".repeat(64)],
    );
    await pool.query(
      `INSERT INTO account_deletion_requests(user_id,status,decided_at,decision_reason,decided_by_admin_id)
       VALUES($1,'APPROVED',now(),'integration gate',$2)`,
      [approvedOwner.id, gateAdmin.rows[0]!.id],
    );
    const gatedDelete = await deleteMedia(
      approvedOwner.token,
      approvedMediaId,
      `media-delete-approved-${randomUUID()}`,
    );
    assert.equal(gatedDelete.statusCode, 403, gatedDelete.body);

    const expiredKey = `media-expired-${randomUUID()}`;
    const expiredIntent = await deleteApp.inject({
      method: "POST",
      url: "/v1/media/uploads",
      headers: authHeaders(deleteOwner.token, expiredKey),
      payload: intentPayload("expired.png"),
    });
    assert.equal(expiredIntent.statusCode, 201, expiredIntent.body);
    const expiredMediaId = (expiredIntent.json() as { mediaId: string }).mediaId;
    const expiredStagingKey = await stageUpload(expiredMediaId);
    await pool.query(
      `UPDATE media_assets
          SET metadata=jsonb_set(metadata,'{uploadIntentExpiresAt}',to_jsonb((now()-interval '1 minute')::text))
        WHERE id=$1`,
      [expiredMediaId],
    );
    const expiredOwnerCountBefore = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM media_assets WHERE owner_id=$1",
      [deleteOwner.id],
    );
    const expiredComplete = await deleteApp.inject({
      method: "POST",
      url: `/v1/media/${expiredMediaId}/complete`,
      headers: authHeaders(deleteOwner.token, expiredKey),
    });
    assert.equal(expiredComplete.statusCode, 410, expiredComplete.body);
    assert.equal((expiredComplete.json() as { error: { code: string } }).error.code, "MEDIA_UPLOAD_INTENT_EXPIRED");
    assert.equal(objects.has(expiredStagingKey), false);
    const expiredCompleteReplay = await deleteApp.inject({
      method: "POST",
      url: `/v1/media/${expiredMediaId}/complete`,
      headers: authHeaders(deleteOwner.token, expiredKey),
    });
    assert.equal(expiredCompleteReplay.statusCode, 410, expiredCompleteReplay.body);
    assert.equal(expiredCompleteReplay.headers["x-idempotent-replay"], "true");
    assert.deepEqual(expiredCompleteReplay.json(), expiredComplete.json());
    const expiredState = await pool.query<{ status: string; owner_media_count: string; ledger_state: string }>(
      `SELECT m.status,
         (SELECT count(*)::text FROM media_assets owned WHERE owned.owner_id=m.owner_id) AS owner_media_count,
         i.state AS ledger_state
       FROM media_assets m JOIN idempotency_keys i
         ON i.actor_id=m.owner_id AND i.scope='MEDIA_UPLOAD_COMPLETE' AND i.idempotency_key=$2
       WHERE m.id=$1`,
      [expiredMediaId, expiredKey],
    );
    assert.deepEqual(expiredState.rows[0], {
      status: "REJECTED",
      owner_media_count: expiredOwnerCountBefore.rows[0]!.count,
      ledger_state: "COMPLETED",
    });

    const raceOwner = await createActor("delete-race-owner");
    const raceActionKey = `media-delete-race-complete-${randomUUID()}`;
    const raceIntent = await deleteApp.inject({
      method: "POST",
      url: "/v1/media/uploads",
      headers: authHeaders(raceOwner.token, raceActionKey),
      payload: intentPayload("race.png"),
    });
    assert.equal(raceIntent.statusCode, 201, raceIntent.body);
    const raceMediaId = (raceIntent.json() as { mediaId: string }).mediaId;
    const raceStagingKey = await stageUpload(raceMediaId);
    const raceSanitized = await sanitizeImage(inputImage, "image/png");
    const raceFinalKey = `media/${raceMediaId}/${raceSanitized.checksumSha256}.webp`;
    const raceSave = pauseSave(raceFinalKey);
    const completingRace = deleteApp.inject({
      method: "POST",
      url: `/v1/media/${raceMediaId}/complete`,
      headers: authHeaders(raceOwner.token, raceActionKey),
    });
    let saveTimeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        raceSave.startedPromise,
        new Promise<never>((_, reject) => {
          saveTimeout = setTimeout(() => reject(new Error("timed out waiting for media save")), 5_000);
        }),
      ]);
    } finally {
      if (saveTimeout) clearTimeout(saveTimeout);
    }
    const raceDeleteKey = `media-delete-race-${randomUUID()}`;
    let deletedDuringProcessing: Awaited<ReturnType<typeof deleteMedia>>;
    try {
      deletedDuringProcessing = await deleteMedia(raceOwner.token, raceMediaId, raceDeleteKey);
    } finally {
      raceSave.release();
    }
    assert.equal(deletedDuringProcessing.statusCode, 204, deletedDuringProcessing.body);
    const racedComplete = await completingRace;
    assert.equal(racedComplete.statusCode, 409, racedComplete.body);
    const racedState = await pool.query<{
      status: string;
      previous_status: string | null;
      tracked_final_object_key: string | null;
      ready_events: string;
      deleted_events: string;
      complete_ledgers: string;
    }>(
      `SELECT m.status,m.metadata->'deletion'->>'previousStatus' AS previous_status,
         m.metadata->'processing'->>'finalObjectKey' AS tracked_final_object_key,
         (SELECT count(*)::text FROM outbox_events o
           WHERE o.aggregate_type='MEDIA' AND o.aggregate_id=m.id::text AND o.event_type='media.ready') AS ready_events,
         (SELECT count(*)::text FROM outbox_events o
           WHERE o.aggregate_type='MEDIA' AND o.aggregate_id=m.id::text AND o.event_type='media.deleted') AS deleted_events,
         (SELECT count(*)::text FROM idempotency_keys i
           WHERE i.actor_id=m.owner_id AND i.scope='MEDIA_UPLOAD_COMPLETE' AND i.idempotency_key=$2) AS complete_ledgers
       FROM media_assets m WHERE m.id=$1`,
      [raceMediaId, raceActionKey],
    );
    assert.deepEqual(racedState.rows[0], {
      status: "DELETED",
      previous_status: "PROCESSING",
      tracked_final_object_key: raceFinalKey,
      ready_events: "0",
      deleted_events: "1",
      complete_ledgers: "0",
    });
    assert.equal(objects.has(raceStagingKey), false);
    assert.equal(objects.has(raceFinalKey), false);

    const approvalRaceOwner = await createActor("approval-race-owner");
    const approvalAdmin = await pool.query<{ id: string }>(
      "INSERT INTO users(email,nickname,role,status) VALUES($1,$2,'ADMIN','ACTIVE') RETURNING id",
      [`media-approval-admin-${suffix}@example.test`, `미디어 승인 관리자 ${suffix}`],
    );
    const deletionRequest = await pool.query<{ id: string }>(
      "INSERT INTO account_deletion_requests(user_id,status) VALUES($1,'PENDING_REVIEW') RETURNING id",
      [approvalRaceOwner.id],
    );
    const approvalRaceKey = `media-approval-race-${randomUUID()}`;
    const approvalRaceIntent = await deleteApp.inject({
      method: "POST",
      url: "/v1/media/uploads",
      headers: authHeaders(approvalRaceOwner.token, approvalRaceKey),
      payload: intentPayload("approval-race.png"),
    });
    assert.equal(approvalRaceIntent.statusCode, 201, approvalRaceIntent.body);
    const approvalRaceMediaId = (approvalRaceIntent.json() as { mediaId: string }).mediaId;
    const approvalRaceStagingKey = await stageUpload(approvalRaceMediaId);
    const approvalRaceSanitized = await sanitizeImage(inputImage, "image/png");
    const approvalRaceFinalKey = `media/${approvalRaceMediaId}/${approvalRaceSanitized.checksumSha256}.webp`;
    const approvalRaceSave = pauseSave(approvalRaceFinalKey);
    const completingAfterApproval = deleteApp.inject({
      method: "POST",
      url: `/v1/media/${approvalRaceMediaId}/complete`,
      headers: authHeaders(approvalRaceOwner.token, approvalRaceKey),
    });
    let approvalSaveTimeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        approvalRaceSave.startedPromise,
        new Promise<never>((_, reject) => {
          approvalSaveTimeout = setTimeout(
            () => reject(new Error("timed out waiting for approval-race media save")),
            5_000,
          );
        }),
      ]);
    } finally {
      if (approvalSaveTimeout) clearTimeout(approvalSaveTimeout);
    }
    const approvalReason = "미디어 완료 처리 중 탈퇴 승인 직렬화 검증";
    let approvedDuringProcessing: { status: string } | undefined;
    try {
      const approved = await pool.query<{ status: string }>(
        `UPDATE account_deletion_requests
            SET status='APPROVED',decided_at=now(),decision_reason=$2,decided_by_admin_id=$3
          WHERE id=$1
          RETURNING status`,
        [deletionRequest.rows[0]!.id, approvalReason, approvalAdmin.rows[0]!.id],
      );
      approvedDuringProcessing = approved.rows[0];
    } finally {
      approvalRaceSave.release();
    }
    assert.deepEqual(approvedDuringProcessing, { status: "APPROVED" });
    const blockedAfterApproval = await completingAfterApproval;
    assert.equal(blockedAfterApproval.statusCode, 403, blockedAfterApproval.body);
    assert.equal(
      (blockedAfterApproval.json() as { error: { code: string } }).error.code,
      "ACCOUNT_DELETION_APPROVED",
    );
    const approvalRaceState = await pool.query<{
      status: string;
      previous_status: string | null;
      deletion_reason: string | null;
      tracked_final_object_key: string | null;
      ready_events: string;
      deleted_events: string;
      complete_ledgers: string;
      deletion_status: string;
    }>(
      `SELECT m.status,m.metadata->'deletion'->>'previousStatus' AS previous_status,
         m.metadata->'deletion'->>'reason' AS deletion_reason,
         m.metadata->'processing'->>'finalObjectKey' AS tracked_final_object_key,
         (SELECT count(*)::text FROM outbox_events o
           WHERE o.aggregate_type='MEDIA' AND o.aggregate_id=m.id::text AND o.event_type='media.ready') AS ready_events,
         (SELECT count(*)::text FROM outbox_events o
           WHERE o.aggregate_type='MEDIA' AND o.aggregate_id=m.id::text AND o.event_type='media.deleted') AS deleted_events,
         (SELECT count(*)::text FROM idempotency_keys i
           WHERE i.actor_id=m.owner_id AND i.scope='MEDIA_UPLOAD_COMPLETE' AND i.idempotency_key=$2) AS complete_ledgers,
         d.status AS deletion_status
       FROM media_assets m JOIN account_deletion_requests d ON d.user_id=m.owner_id
       WHERE m.id=$1`,
      [approvalRaceMediaId, approvalRaceKey],
    );
    assert.deepEqual(approvalRaceState.rows[0], {
      status: "DELETED",
      previous_status: "PROCESSING",
      deletion_reason: "ACCOUNT_DELETION_APPROVED",
      tracked_final_object_key: approvalRaceFinalKey,
      ready_events: "0",
      deleted_events: "1",
      complete_ledgers: "0",
      deletion_status: "APPROVED",
    });
    assert.equal(objects.has(approvalRaceStagingKey), false);
    assert.equal(objects.has(approvalRaceFinalKey), false);
    assert.ok(calls.signedPolicies >= 7);
    assert.ok(calls.reads >= 3);
  },
);
