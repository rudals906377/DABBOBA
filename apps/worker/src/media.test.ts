import assert from "node:assert/strict";
import test from "node:test";
import {
  isMediaCleanupCandidate,
  mediaCleanupObjectKeys,
  mediaNeedsImmediateCleanup,
  mediaReadyStagingObjectKey,
} from "./media.js";

const now = new Date("2026-08-24T12:00:00.000Z");

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
  const finalObject = `media/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/${"a".repeat(64)}.webp`;
  const failureMetadata = {
    processingFailure: { code: "MEDIA_PROCESSING_FAILED", finalObjectKey: finalObject },
  };
  assert.deepEqual(mediaCleanupObjectKeys(staging, failureMetadata), [staging, finalObject]);
  assert.equal(mediaNeedsImmediateCleanup(failureMetadata), true);
  assert.deepEqual(mediaCleanupObjectKeys(staging, {
    processingFailure: { finalObjectKey: "uploads/another-user/object" },
  }), [staging]);
  assert.equal(mediaReadyStagingObjectKey({ original: { stagingObjectKey: staging } }), staging);
  assert.equal(mediaReadyStagingObjectKey({ original: { stagingObjectKey: "uploads/another-user/object" } }), null);
});
