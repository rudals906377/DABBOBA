import assert from "node:assert/strict";
import test from "node:test";
import type { DatabasePool } from "@dabboba/db";
import { IdempotencyStrategy, Storage } from "@google-cloud/storage";
import {
  GCS_DELETE_OPTIONS,
  GCS_REQUEST_TIMEOUT_MS,
  GCS_RETRY_OPTIONS,
  gcsStorageOptions,
} from "./media-providers.js";
import {
  MEDIA_STAGING_OBJECT_KEY_PATTERN,
  cleanupMediaBatch,
  isMediaCleanupCandidate,
  isMediaOrphanCleanupDue,
  mediaCleanupObjectKeys,
  mediaPendingFinalObjectKeys,
  mediaNeedsImmediateCleanup,
  mediaReadyStagingObjectKey,
} from "./media.js";

const now = new Date("2026-08-24T12:00:00.000Z");

const mediaId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const winningKey = `media/${mediaId}/${"a".repeat(64)}.webp`;
const orphanKey = `media/${mediaId}/${"b".repeat(64)}-cccccccc-cccc-4ccc-8ccc-cccccccccccc.webp`;

function cleanupFixture(overrides: Record<string, unknown> = {}) {
  const row = {
    id: mediaId,
    owner_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    object_key: winningKey,
    status: "READY",
    updated_at: new Date(now.getTime() - 60 * 60_000),
    metadata: {
      stagingCleanup: { completedAt: "2026-08-24T10:00:00.000Z" },
      storageCleanup: { pendingFinalObjectKeys: [orphanKey, winningKey] },
    },
    ...overrides,
  };
  const statements: string[] = [];
  const client = {
    async query(sql: string) {
      statements.push(sql);
      return sql.includes("FOR UPDATE") ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const pool = {
    async query() { return { rows: [{ id: mediaId }], rowCount: 1 }; },
    async connect() { return client; },
  } as unknown as DatabasePool;
  return { pool, row, statements };
}

test("READY cleanup retries durable orphan keys after staging cleanup while protecting the winner", async () => {
  const fixture = cleanupFixture();
  const deleted: string[] = [];
  const result = await cleanupMediaBatch(fixture.pool, {
    async deleteObject(key, metadata) {
      assert.equal(metadata, fixture.row.metadata);
      deleted.push(key);
      return "deleted";
    },
  }, { batchSize: 1, pendingTtlMinutes: 5, rejectedTtlHours: 24 }, now);
  assert.deepEqual(deleted, [orphanKey]);
  assert.deepEqual(result, { examined: 1, deleted: 1, skipped: 0 });
  assert.equal(fixture.statements.some((sql) => sql.includes("'checkedAt'")), true);
  assert.equal(fixture.statements.some((sql) => sql.includes("SET status='DELETED'")), false);
});

test("orphan cleanup accepts only canonical same-asset final keys and never the READY winner", () => {
  const foreign = `media/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/${"b".repeat(64)}.webp`;
  assert.deepEqual(mediaPendingFinalObjectKeys(mediaId, winningKey, "READY", {
    storageCleanup: { pendingFinalObjectKeys: [
      orphanKey, orphanKey, winningKey, foreign, 1, null, { key: orphanKey },
      `media/${mediaId}/../${"b".repeat(64)}.webp`, orphanKey.replace("cccccccc-cccc", "cccc-cccccccc"),
      `${orphanKey}?versionId=anything`, `uploads/${mediaId}/test.png`,
    ] },
  }), [orphanKey]);
  assert.deepEqual(mediaPendingFinalObjectKeys(mediaId, winningKey, "DELETED", {
    storageCleanup: { pendingFinalObjectKeys: [winningKey] },
  }), [winningKey]);
  for (const invalid of [orphanKey, null, {}, 1]) {
    assert.deepEqual(mediaPendingFinalObjectKeys(mediaId, winningKey, "READY", {
      storageCleanup: { pendingFinalObjectKeys: invalid },
    }), []);
  }
});

test("orphan rechecks are throttled and preserve configured pending/rejected retention", () => {
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
  assert.equal(isMediaOrphanCleanupDue("READY", ago(5), {}, now, 5, 24), true);
  assert.equal(isMediaOrphanCleanupDue("READY", ago(4), {}, now, 5, 24), false);
  assert.equal(isMediaOrphanCleanupDue("PROCESSING", ago(59), {}, now, 60, 24), false);
  assert.equal(isMediaOrphanCleanupDue("PROCESSING", ago(60), {}, now, 60, 24), true);
  assert.equal(isMediaOrphanCleanupDue("READY", ago(59), {}, now, 60, 24, true), false);
  assert.equal(isMediaOrphanCleanupDue("READY", ago(60), {}, now, 60, 24, true), true);
  assert.equal(isMediaOrphanCleanupDue("REJECTED", ago(60), {}, now, 5, 24), false);
  assert.equal(isMediaOrphanCleanupDue("REJECTED", ago(60), { processingFailure: {} }, now, 5, 24), true);
  assert.equal(isMediaOrphanCleanupDue("DELETED", ago(5), { cleanup: { completedAt: ago(5).toISOString() } }, now, 5, 24), true);
  for (const checkedAt of [ago(4).toISOString(), new Date(now.getTime() + 1).toISOString(),
    "tomorrow", "2026-02-31T12:00:00.000Z", 0, {}]) {
    assert.equal(isMediaOrphanCleanupDue("READY", ago(60), { storageCleanup: { checkedAt } }, now, 5, 24), false);
  }
  assert.equal(isMediaOrphanCleanupDue("READY", ago(60), {
    storageCleanup: { checkedAt: ago(5).toISOString() },
  }, now, 5, 24), true);
});

test("skipped storage and stale locked claims cannot mark an orphan recheck successful", async () => {
  const fixture = cleanupFixture();
  const result = await cleanupMediaBatch(fixture.pool, { async deleteObject() { return "skipped"; } },
    { batchSize: 1, pendingTtlMinutes: 5, rejectedTtlHours: 24 }, now);
  assert.deepEqual(result, { examined: 1, deleted: 0, skipped: 1 });
  assert.equal(fixture.statements.some((sql) => sql.startsWith("UPDATE")), false);
  const active = cleanupFixture({ status: "PROCESSING", updated_at: now });
  await cleanupMediaBatch(active.pool, { async deleteObject() { assert.fail("fresh claim cannot be deleted"); } },
    { batchSize: 1, pendingTtlMinutes: 5, rejectedTtlHours: 24 }, now);
  assert.equal(active.statements.some((sql) => sql.startsWith("UPDATE")), false);
});

test("deadline loss after an orphan delete rolls back without recording successful cleanup", async () => {
  const fixture = cleanupFixture();
  let continuing = true;
  await assert.rejects(cleanupMediaBatch(fixture.pool, {
    async deleteObject() { continuing = false; return "deleted"; },
  }, { batchSize: 1, pendingTtlMinutes: 5, rejectedTtlHours: 24 }, now, () => continuing),
  /deadline reached after media orphan deletion/);
  assert.equal(fixture.statements.includes("ROLLBACK"), true);
  assert.equal(fixture.statements.some((sql) => sql.startsWith("UPDATE")), false);
});

test("terminal cleanup completion does not disable durable orphan retries", async () => {
  const fixture = cleanupFixture({ status: "DELETED", metadata: {
    cleanup: { completedAt: "2026-08-24T10:00:00.000Z" },
    storageCleanup: { pendingFinalObjectKeys: [orphanKey] },
  } });
  const deleted: string[] = [];
  await cleanupMediaBatch(fixture.pool, { async deleteObject(key) { deleted.push(key); return "deleted"; } },
    { batchSize: 1, pendingTtlMinutes: 5, rejectedTtlHours: 24 }, now);
  assert.deepEqual(deleted, [orphanKey]);
  assert.equal(fixture.statements.some((sql) => sql.includes("SET status='DELETED'")), false);
});

test("orphan bookkeeping cannot keep postponing the READY staging replay cleanup", async () => {
  const staging = `uploads/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/${mediaId}/image.png`;
  const fixture = cleanupFixture({ updated_at: new Date(now.getTime() - 6 * 60_000), metadata: {
    original: { stagingObjectKey: staging },
    storageCleanup: { pendingFinalObjectKeys: [orphanKey] },
  } });
  const deleted: string[] = [];
  const store = { async deleteObject(key: string): Promise<"deleted"> { deleted.push(key); return "deleted"; } };
  const options = { batchSize: 1, pendingTtlMinutes: 60, rejectedTtlHours: 24 };
  await cleanupMediaBatch(fixture.pool, store, options, now);
  assert.deepEqual(deleted, []);
  assert.equal(fixture.statements.some((sql) => sql.startsWith("UPDATE")), false);
  await cleanupMediaBatch(fixture.pool, store, options, new Date(now.getTime() + 54 * 60_000));
  assert.deepEqual(deleted, [orphanKey, staging]);
});

test("GCS cleanup has a bounded retry window and retry-safe delete semantics", () => {
  const options = gcsStorageOptions("dabboba-test");
  const storage = new Storage(options);

  assert.equal(options.projectId, "dabboba-test");
  assert.equal(options.timeout, GCS_REQUEST_TIMEOUT_MS);
  assert.equal(storage.retryOptions.autoRetry, true);
  assert.equal(storage.retryOptions.maxRetries, 2);
  assert.equal(storage.retryOptions.maxRetryDelay, 5);
  assert.equal(storage.retryOptions.totalTimeout, 20);
  assert.equal(storage.retryOptions.idempotencyStrategy, IdempotencyStrategy.RetryAlways);
  assert.equal(GCS_RETRY_OPTIONS.totalTimeout, 20);
  assert.deepEqual(GCS_DELETE_OPTIONS, { ignoreNotFound: true });
  assert.equal("projectId" in gcsStorageOptions(null), false);
});

test("media cleanup respects separate pending and rejected retention windows", () => {
  assert.equal(isMediaCleanupCandidate("PENDING_UPLOAD", new Date("2026-08-24T10:59:59.000Z"), now, 60, 24), true);
  assert.equal(isMediaCleanupCandidate("PENDING_UPLOAD", new Date("2026-08-24T11:30:00.000Z"), now, 60, 24), false);
  assert.equal(isMediaCleanupCandidate("PROCESSING", new Date("2026-08-24T10:59:59.000Z"), now, 60, 24), true);
  assert.equal(isMediaCleanupCandidate("REJECTED", new Date("2026-08-23T11:59:59.000Z"), now, 60, 24), true);
  assert.equal(isMediaCleanupCandidate("REJECTED", now, now, 60, 24, true), true);
  assert.equal(isMediaCleanupCandidate("READY", new Date("2020-01-01T00:00:00.000Z"), now, 60, 24), false);
});

test("media cleanup retries both staging and tracked sanitized objects after processing failure", () => {
  const staging = "uploads/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/image.png";
  const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const mediaId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const finalObject = `media/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/${"a".repeat(64)}.webp`;
  const failureMetadata = {
    processingFailure: { code: "MEDIA_PROCESSING_FAILED", finalObjectKey: finalObject },
  };
  assert.deepEqual(mediaCleanupObjectKeys(staging, failureMetadata), [staging, finalObject]);
  assert.equal(mediaNeedsImmediateCleanup(failureMetadata), true);
  assert.deepEqual(mediaCleanupObjectKeys(staging, {
    processingFailure: { finalObjectKey: "uploads/another-user/object" },
  }), [staging]);
  assert.equal(mediaReadyStagingObjectKey({ original: { stagingObjectKey: staging } }, ownerId, mediaId), staging);
  assert.equal(
    mediaReadyStagingObjectKey(
      { original: { stagingObjectKey: "uploads/another-user/object" } },
      ownerId,
      mediaId,
    ),
    null,
  );
  assert.equal(
    mediaReadyStagingObjectKey(
      {
        original: {
          stagingObjectKey: "uploads/cccccccc-cccc-4ccc-8ccc-cccccccccccc/dddddddd-dddd-4ddd-8ddd-dddddddddddd/image.png",
        },
      },
      ownerId,
      mediaId,
    ),
    null,
  );
  assert.equal(new RegExp(MEDIA_STAGING_OBJECT_KEY_PATTERN).test(staging), true);
  assert.equal(new RegExp(MEDIA_STAGING_OBJECT_KEY_PATTERN).test("uploads/another-user/object"), false);
});
