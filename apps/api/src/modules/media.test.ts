import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { Storage } from "@google-cloud/storage";
import sharp from "sharp";
import { AppError } from "../lib/errors.js";
import { sanitizeImage } from "../lib/image-sanitizer-node.js";
import {
  buildUploadPostPolicyOptions,
  createMediaProcessingLimiter,
  detectedImageMimeType,
  mediaDeleteFingerprint,
  mediaUploadCompleteFingerprint,
  mediaUploadBudgetAllows,
  mediaUploadIntentExpiredError,
  mediaUploadIntentFingerprint,
  mediaUploadQuotaAllows,
  normalizeFilename,
} from "./media.js";

test("media idempotency fingerprints normalize upload metadata and bind actor, payload, and media id", () => {
  const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const base = {
    actorId,
    purpose: "POST" as const,
    filename: "  Sample Image.PNG  ",
    mimeType: "image/png" as const,
    byteSize: 12_345,
    checksumSha256: "A".repeat(64),
  };
  assert.equal(
    mediaUploadIntentFingerprint(base),
    mediaUploadIntentFingerprint({ ...base, filename: "Sample-Image.png", checksumSha256: "a".repeat(64) }),
  );
  assert.notEqual(mediaUploadIntentFingerprint(base), mediaUploadIntentFingerprint({ ...base, byteSize: 12_346 }));
  assert.notEqual(mediaUploadIntentFingerprint(base), mediaUploadIntentFingerprint({
    ...base,
    actorId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  }));
  assert.equal(
    mediaUploadCompleteFingerprint(actorId, "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB"),
    mediaUploadCompleteFingerprint(actorId, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
  );
  assert.notEqual(
    mediaUploadCompleteFingerprint(actorId, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
    mediaUploadCompleteFingerprint(actorId, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
  );
  assert.equal(
    mediaDeleteFingerprint(actorId, "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB"),
    mediaDeleteFingerprint(actorId, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
  );
  assert.notEqual(
    mediaDeleteFingerprint(actorId, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
    mediaDeleteFingerprint(actorId, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
  );
});

test("expired media completion uses the client-recognizable 410 contract", () => {
  const error = mediaUploadIntentExpiredError();
  assert.equal(error.statusCode, 410);
  assert.equal(error.code, "MEDIA_UPLOAD_INTENT_EXPIRED");
});

test("media filenames are normalized before entering object keys", () => {
  assert.equal(normalizeFilename("  내 사진 (1).PNG  "), "1.png");
  assert.equal(normalizeFilename("safe-file.webp"), "safe-file.webp");
  assert.equal(normalizeFilename("../../evil.PNG"), "evil.png");
});

test("image magic bytes determine the accepted mime type", () => {
  assert.equal(detectedImageMimeType(Buffer.from([0xff, 0xd8, 0xff, 0x00])), "image/jpeg");
  assert.equal(detectedImageMimeType(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])), "image/png");
  assert.equal(detectedImageMimeType(Buffer.from("not-an-image")), null);
});

test("signed POST policy binds type, checksum, media id, and the exact declared byte length", () => {
  const expiresAt = new Date("2026-08-24T12:10:00.000Z");
  const options = buildUploadPostPolicyOptions({
    mediaId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    mimeType: "image/png",
    byteSize: 12_345,
    checksumSha256: "a".repeat(64),
    expiresAt,
  });
  assert.equal(options.expires, expiresAt);
  assert.deepEqual(options.fields, {
    "Content-Type": "image/png",
    "x-goog-meta-sha256": "a".repeat(64),
    "x-goog-meta-media-id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    success_action_status: "201",
  });
  assert.deepEqual(options.conditions, [["content-length-range", 12_345, 12_345]]);
});

test("GCS V4 policy output fixes the bucket and full object key instead of allowing a prefix", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 1_024 });
  const storage = new Storage({
    projectId: "media-policy-test",
    credentials: {
      client_email: "media-policy-test@example.test",
      private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    },
  });
  const objectKey = "uploads/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/image.png";
  const [policy] = await storage.bucket("dabboba-media-policy-test").file(objectKey).generateSignedPostPolicyV4(
    buildUploadPostPolicyOptions({
      mediaId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      mimeType: "image/png",
      byteSize: 12_345,
      checksumSha256: "a".repeat(64),
      expiresAt: new Date(Date.now() + 60_000),
    }),
  );
  const document = JSON.parse(Buffer.from(policy.fields.policy!, "base64").toString("utf8")) as {
    conditions: unknown[];
  };
  const exactConditions = Object.assign(
    {},
    ...document.conditions.filter((condition) => (
      typeof condition === "object" && condition !== null && !Array.isArray(condition)
    )),
  ) as Record<string, string>;

  assert.equal(policy.fields.key, objectKey);
  assert.equal(exactConditions.bucket, "dabboba-media-policy-test");
  assert.equal(exactConditions.key, objectKey);
  assert.equal(exactConditions["Content-Type"], "image/png");
  assert.equal(exactConditions["x-goog-meta-sha256"], "a".repeat(64));
  assert.equal(exactConditions["x-goog-meta-media-id"], "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  assert.equal(document.conditions.some((condition) => (
    Array.isArray(condition)
    && condition[0] === "content-length-range"
    && condition[1] === 12_345
    && condition[2] === 12_345
  )), true);
});

test("active media quota enforces both count and aggregate declared bytes", () => {
  assert.equal(mediaUploadQuotaAllows(9, 20 * 1024 * 1024, 10 * 1024 * 1024), true);
  assert.equal(mediaUploadQuotaAllows(10, 0, 1), false);
  assert.equal(mediaUploadQuotaAllows(1, 30 * 1024 * 1024, 1), false);
  assert.equal(mediaUploadBudgetAllows({ dailyCount: 49, dailyBytes: 0, readyCount: 0, readyBytes: 0 }, 1), true);
  assert.equal(mediaUploadBudgetAllows({ dailyCount: 50, dailyBytes: 0, readyCount: 0, readyBytes: 0 }, 1), false);
  assert.equal(mediaUploadBudgetAllows({ dailyCount: 0, dailyBytes: 200 * 1024 * 1024, readyCount: 0, readyBytes: 0 }, 1), false);
  assert.equal(mediaUploadBudgetAllows({ dailyCount: 0, dailyBytes: 0, readyCount: 500, readyBytes: 0 }, 1), false);
  assert.equal(mediaUploadBudgetAllows({ dailyCount: 0, dailyBytes: 0, readyCount: 0, readyBytes: 512 * 1024 * 1024 }, 1), false);
});

test("image processing limiter bounds instance memory and releases slots exactly once", () => {
  const limiter = createMediaProcessingLimiter(2);
  const first = limiter.acquire();
  const second = limiter.acquire();
  assert.ok(first);
  assert.ok(second);
  assert.equal(limiter.active(), 2);
  assert.equal(limiter.acquire(), null);
  first();
  first();
  assert.equal(limiter.active(), 1);
  const replacement = limiter.acquire();
  assert.ok(replacement);
  second();
  replacement();
  assert.equal(limiter.active(), 0);
});

test("untrusted images are auto-oriented, metadata-stripped, and re-encoded as WebP", async () => {
  const input = await sharp({
    create: { width: 4, height: 2, channels: 3, background: { r: 145, g: 233, b: 142 } },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const sanitized = await sanitizeImage(input, "image/jpeg");
  const outputMetadata = await sharp(sanitized.data).metadata();

  assert.equal(sanitized.mimeType, "image/webp");
  assert.equal(sanitized.width, 2);
  assert.equal(sanitized.height, 4);
  assert.equal(outputMetadata.format, "webp");
  assert.equal(outputMetadata.orientation, undefined);
  assert.equal(outputMetadata.exif, undefined);
  assert.equal(outputMetadata.xmp, undefined);
  assert.match(sanitized.checksumSha256, /^[0-9a-f]{64}$/);
});

test("pixel-heavy compressed images are rejected before publication", async () => {
  const oversized = await sharp({
    create: { width: 4_097, height: 4_097, channels: 3, background: { r: 0, g: 0, b: 0 } },
  }).png({ compressionLevel: 9 }).toBuffer();

  await assert.rejects(
    sanitizeImage(oversized, "image/png"),
    (error: unknown) => error instanceof AppError && error.code === "MEDIA_IMAGE_INVALID",
  );
});
