import assert from "node:assert/strict";
import test from "node:test";
import { IdempotencyStrategy, Storage } from "@google-cloud/storage";
import {
  GCS_DELETE_OPTIONS,
  GCS_REQUEST_TIMEOUT_MS,
  GCS_RETRY_OPTIONS,
  MEDIA_STAGING_OBJECT_KEY_PATTERN,
  gcsStorageOptions,
  isMediaCleanupCandidate,
  mediaCleanupObjectKeys,
  mediaNeedsImmediateCleanup,
  mediaReadyStagingObjectKey,
} from "./media.js";

const now = new Date("2026-08-24T12:00:00.000Z");

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
