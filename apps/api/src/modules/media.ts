import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Storage, type File, type FileMetadata, type GenerateSignedPostPolicyV4Options } from "@google-cloud/storage";
import sharp from "sharp";
import { withTransaction, type DatabaseClient, type DatabasePool, type Queryable } from "@dabboba/db";
import { isAdminRole } from "@dabboba/domain";
import { writeOutbox } from "../lib/audit.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { beginIdempotency, completeIdempotency, idempotencyKey, requestHash } from "../lib/idempotency.js";
import { enumInput, integerInput, objectInput, stringInput, uuidInput } from "../lib/input.js";
import type { ApiContext } from "../types.js";

const MEDIA_PURPOSES = ["PROFILE", "POST", "COMMENT", "INQUIRY", "EXCHANGE", "CATALOG_REQUEST", "WANTED_REQUEST"] as const;
const SUPPORTED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_ACTIVE_UPLOAD_COUNT = 10;
const MAX_ACTIVE_UPLOAD_BYTES = 30 * 1024 * 1024;
const MAX_DAILY_UPLOAD_COUNT = 50;
const MAX_DAILY_UPLOAD_BYTES = 200 * 1024 * 1024;
const MAX_READY_MEDIA_COUNT = 500;
const MAX_READY_MEDIA_BYTES = 512 * 1024 * 1024;
const MAX_CONCURRENT_PROCESSING_PER_INSTANCE = 2;
const MAX_CONCURRENT_PROCESSING_PER_USER = 2;
const UPLOAD_POLICY_TTL_MS = 2 * 60_000;
const PENDING_UPLOAD_TTL_MS = 5 * 60_000;
const PROCESSING_CLAIM_TTL_MS = 5 * 60_000;
const MAX_INPUT_PIXELS = 16 * 1024 * 1024;
const MAX_INPUT_DIMENSION = 8_192;
const MAX_OUTPUT_DIMENSION = 4_096;
const MEDIA_UPLOAD_ADVISORY_NAMESPACE = 1_296_384_177;
const MEDIA_UPLOAD_INTENT_SCOPE = "MEDIA_UPLOAD_INTENT_CREATE";
const MEDIA_UPLOAD_COMPLETE_SCOPE = "MEDIA_UPLOAD_COMPLETE";
const MEDIA_DELETE_SCOPE = "MEDIA_DELETE";

type MediaRow = {
  id: string;
  owner_id: string;
  purpose: (typeof MEDIA_PURPOSES)[number];
  object_key: string;
  object_generation: number | string | null;
  declared_mime_type: string;
  detected_mime_type: string | null;
  byte_size: number | string;
  checksum_sha256: string;
  status: string;
  metadata: unknown;
  updated_at: Date;
};

export type MediaUploadReservationInput = {
  id: string;
  ownerId: string;
  purpose: (typeof MEDIA_PURPOSES)[number];
  objectKey: string;
  filename: string;
  mimeType: (typeof SUPPORTED_MIME_TYPES)[number];
  byteSize: number;
  checksumSha256: string;
  intentExpiresAt?: Date;
};

export type MediaUploadReservation = {
  reserved: boolean;
  expiredObjectKeys: string[];
  activeCount: number;
  activeBytes: number;
  dailyCount: number;
  dailyBytes: number;
  readyCount: number;
  readyBytes: number;
};

export type SanitizedImage = {
  data: Buffer;
  mimeType: "image/webp";
  checksumSha256: string;
  byteSize: number;
  width: number;
  height: number;
};

export function mediaUploadIntentFingerprint(input: {
  actorId: string;
  purpose: (typeof MEDIA_PURPOSES)[number];
  filename: string;
  mimeType: (typeof SUPPORTED_MIME_TYPES)[number];
  byteSize: number;
  checksumSha256: string;
}): string {
  return requestHash({
    actorId: input.actorId,
    operation: "POST /v1/media/uploads",
    purpose: input.purpose,
    filename: normalizeFilename(input.filename),
    mimeType: input.mimeType,
    byteSize: input.byteSize,
    checksumSha256: input.checksumSha256.toLocaleLowerCase("en-US"),
  });
}

export function mediaUploadCompleteFingerprint(actorId: string, mediaIdValue: string): string {
  return requestHash({
    actorId,
    operation: "POST /v1/media/:mediaId/complete",
    mediaId: mediaIdValue.toLocaleLowerCase("en-US"),
  });
}

export function mediaDeleteFingerprint(actorId: string, mediaIdValue: string): string {
  return requestHash({
    actorId,
    operation: "DELETE /v1/media/:mediaId",
    mediaId: mediaIdValue.toLocaleLowerCase("en-US"),
  });
}

export function mediaUploadIntentExpiredError(): AppError {
  return new AppError(410, "MEDIA_UPLOAD_INTENT_EXPIRED", "업로드 요청이 만료되었습니다. 새로 업로드해 주세요.");
}

export function normalizeFilename(value: string): string {
  const normalized = value.normalize("NFKC").trim();
  const extensionMatch = normalized.match(/\.([A-Za-z0-9]{1,10})$/);
  const extension = extensionMatch ? `.${extensionMatch[1]!.toLowerCase()}` : "";
  const rawStem = extensionMatch ? normalized.slice(0, -extensionMatch[0].length) : normalized;
  const stem = rawStem
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  return `${(stem || "upload").slice(0, 120 - extension.length)}${extension}`;
}

export function detectedImageMimeType(header: Uint8Array): (typeof SUPPORTED_MIME_TYPES)[number] | null {
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return "image/jpeg";
  if (header.length >= 8 && Buffer.from(header.subarray(0, 8)).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return "image/png";
  if (header.length >= 12 && Buffer.from(header.subarray(0, 4)).toString("ascii") === "RIFF" && Buffer.from(header.subarray(8, 12)).toString("ascii") === "WEBP") return "image/webp";
  if (header.length >= 6 && ["GIF87a", "GIF89a"].includes(Buffer.from(header.subarray(0, 6)).toString("ascii"))) return "image/gif";
  return null;
}

export function buildUploadPostPolicyOptions(input: {
  mediaId: string;
  mimeType: (typeof SUPPORTED_MIME_TYPES)[number];
  byteSize: number;
  checksumSha256: string;
  expiresAt: Date;
}): GenerateSignedPostPolicyV4Options {
  return {
    expires: input.expiresAt,
    fields: {
      "Content-Type": input.mimeType,
      "x-goog-meta-sha256": input.checksumSha256,
      "x-goog-meta-media-id": input.mediaId,
      success_action_status: "201",
    },
    conditions: [["content-length-range", input.byteSize, input.byteSize]],
  };
}

function mediaImageInvalid(message: string): AppError {
  return new AppError(400, "MEDIA_IMAGE_INVALID", message);
}

export function mediaUploadQuotaAllows(activeCount: number, activeBytes: number, requestedBytes: number): boolean {
  return activeCount < MAX_ACTIVE_UPLOAD_COUNT && activeBytes + requestedBytes <= MAX_ACTIVE_UPLOAD_BYTES;
}

export function mediaUploadBudgetAllows(
  usage: { dailyCount: number; dailyBytes: number; readyCount: number; readyBytes: number },
  requestedBytes: number,
): boolean {
  return usage.dailyCount < MAX_DAILY_UPLOAD_COUNT
    && usage.dailyBytes + requestedBytes <= MAX_DAILY_UPLOAD_BYTES
    && usage.readyCount < MAX_READY_MEDIA_COUNT
    && usage.readyBytes + requestedBytes <= MAX_READY_MEDIA_BYTES;
}

export function createMediaProcessingLimiter(maxConcurrent = MAX_CONCURRENT_PROCESSING_PER_INSTANCE): {
  acquire(): (() => void) | null;
  active(): number;
} {
  let activeCount = 0;
  return {
    acquire() {
      if (activeCount >= maxConcurrent) return null;
      activeCount += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        activeCount -= 1;
      };
    },
    active: () => activeCount,
  };
}

async function lockMediaUploadOwner(queryable: Queryable, ownerId: string): Promise<void> {
  await queryable.query(
    "SELECT pg_advisory_xact_lock($1::int,hashtext($2))",
    [MEDIA_UPLOAD_ADVISORY_NAMESPACE, ownerId],
  );
}

async function lockAccountMutation(queryable: Queryable, actorId: string): Promise<void> {
  await queryable.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))",
    [`account-mutation:${actorId}`],
  );
}

export async function reserveMediaUploadIntent(
  pool: DatabasePool,
  input: MediaUploadReservationInput,
  now = new Date(),
): Promise<MediaUploadReservation> {
  return withTransaction(pool, (client) => reserveMediaUploadIntentWithClient(client, input, now));
}

async function reserveMediaUploadIntentWithClient(
  queryable: Queryable,
  input: MediaUploadReservationInput,
  now: Date,
): Promise<MediaUploadReservation> {
  await lockMediaUploadOwner(queryable, input.ownerId);
  const expiresBefore = new Date(now.getTime() - PENDING_UPLOAD_TTL_MS);
  const expired = await queryable.query<{ object_key: string }>(
    `UPDATE media_assets
        SET status='REJECTED',
            metadata=metadata || jsonb_build_object(
              'uploadIntentExpiredAt',$2::text,
              'uploadIntentExpiryReason','signed_policy_expired'
            )
      WHERE owner_id=$1 AND status='PENDING_UPLOAD' AND updated_at < $3
      RETURNING object_key`,
    [input.ownerId, now.toISOString(), expiresBefore],
  );
  const usage = await queryable.query<{
    active_count: number | string;
    active_bytes: number | string;
    daily_count: number | string;
    daily_bytes: number | string;
    ready_count: number | string;
    ready_bytes: number | string;
  }>(
    `SELECT
         count(*) FILTER (WHERE status IN ('PENDING_UPLOAD','UPLOADED','PROCESSING'))::int AS active_count,
         COALESCE(sum(byte_size) FILTER (WHERE status IN ('PENDING_UPLOAD','UPLOADED','PROCESSING')),0)::bigint AS active_bytes,
         count(*) FILTER (WHERE created_at >= $2::timestamptz - interval '24 hours')::int AS daily_count,
         COALESCE(sum(byte_size) FILTER (WHERE created_at >= $2::timestamptz - interval '24 hours'),0)::bigint AS daily_bytes,
         count(*) FILTER (WHERE status='READY')::int AS ready_count,
         COALESCE(sum(byte_size) FILTER (WHERE status='READY'),0)::bigint AS ready_bytes
       FROM media_assets WHERE owner_id=$1`,
    [input.ownerId, now],
  );
  const activeCount = Number(usage.rows[0]?.active_count ?? 0);
  const activeBytes = Number(usage.rows[0]?.active_bytes ?? 0);
  const dailyCount = Number(usage.rows[0]?.daily_count ?? 0);
  const dailyBytes = Number(usage.rows[0]?.daily_bytes ?? 0);
  const readyCount = Number(usage.rows[0]?.ready_count ?? 0);
  const readyBytes = Number(usage.rows[0]?.ready_bytes ?? 0);
  const reserved = mediaUploadQuotaAllows(activeCount, activeBytes, input.byteSize)
    && mediaUploadBudgetAllows({ dailyCount, dailyBytes, readyCount, readyBytes }, input.byteSize);
  if (reserved) {
    await queryable.query(
      `INSERT INTO media_assets
          (id,owner_id,purpose,object_key,original_filename,declared_mime_type,byte_size,checksum_sha256,metadata)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,
           jsonb_strip_nulls(jsonb_build_object('uploadIntentExpiresAt',$9::text)))`,
      [
        input.id,
        input.ownerId,
        input.purpose,
        input.objectKey,
        input.filename,
        input.mimeType,
        input.byteSize,
        input.checksumSha256,
        input.intentExpiresAt?.toISOString() ?? null,
      ],
    );
  }
  return {
    reserved,
    expiredObjectKeys: expired.rows.map((row) => row.object_key),
    activeCount,
    activeBytes,
    dailyCount,
    dailyBytes,
    readyCount,
    readyBytes,
  };
}

async function readAndVerify(
  file: File,
  expectedBytes: number,
  expectedSha256: string,
  expectedMimeType: string,
): Promise<{ data: Buffer; detectedMimeType: (typeof SUPPORTED_MIME_TYPES)[number] }> {
  const hash = createHash("sha256");
  const chunks: Buffer[] = [];
  let size = 0;
  let header = Buffer.alloc(0);
  for await (const rawChunk of file.createReadStream()) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk as Uint8Array);
    size += chunk.length;
    if (size > MAX_UPLOAD_BYTES || size > expectedBytes) {
      throw mediaImageInvalid("업로드된 파일 크기가 신청 값과 일치하지 않습니다.");
    }
    if (header.length < 16) header = Buffer.concat([header, chunk.subarray(0, 16 - header.length)]);
    chunks.push(chunk);
    hash.update(chunk);
  }
  if (size !== expectedBytes) throw mediaImageInvalid("업로드된 파일 크기가 신청 값과 일치하지 않습니다.");
  const checksum = hash.digest("hex");
  if (checksum !== expectedSha256) throw mediaImageInvalid("업로드된 파일 체크섬이 일치하지 않습니다.");
  const detectedMimeType = detectedImageMimeType(header);
  if (!detectedMimeType || detectedMimeType !== expectedMimeType) {
    throw mediaImageInvalid("선언한 형식과 실제 이미지 형식이 일치하지 않습니다.");
  }
  return { data: Buffer.concat(chunks, size), detectedMimeType };
}

function expectedSharpFormat(mimeType: (typeof SUPPORTED_MIME_TYPES)[number]): "jpeg" | "png" | "webp" | "gif" {
  if (mimeType === "image/jpeg") return "jpeg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "gif";
}

export async function sanitizeImage(
  input: Buffer,
  detectedMimeType: (typeof SUPPORTED_MIME_TYPES)[number],
): Promise<SanitizedImage> {
  try {
    const pipeline = sharp(input, {
      animated: false,
      failOn: "warning",
      limitInputChannels: 4,
      limitInputPixels: MAX_INPUT_PIXELS,
      pages: 1,
      sequentialRead: true,
    });
    const metadata = await pipeline.metadata();
    if (metadata.format !== expectedSharpFormat(detectedMimeType)) {
      throw mediaImageInvalid("이미지 디코더가 확인한 형식이 업로드 형식과 일치하지 않습니다.");
    }
    if (!metadata.width || !metadata.height) throw mediaImageInvalid("이미지 크기를 확인할 수 없습니다.");
    if (
      metadata.width > MAX_INPUT_DIMENSION
      || metadata.height > MAX_INPUT_DIMENSION
      || metadata.width * metadata.height > MAX_INPUT_PIXELS
    ) {
      throw mediaImageInvalid("이미지 해상도가 허용 범위를 초과합니다.");
    }
    const { data, info } = await pipeline
      .rotate()
      .resize({
        width: MAX_OUTPUT_DIMENSION,
        height: MAX_OUTPUT_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82, alphaQuality: 90, effort: 4, smartSubsample: true })
      .toBuffer({ resolveWithObject: true });
    if (!info.width || !info.height || info.width > MAX_OUTPUT_DIMENSION || info.height > MAX_OUTPUT_DIMENSION) {
      throw mediaImageInvalid("안전 이미지 변환 결과를 확인할 수 없습니다.");
    }
    if (data.length > MAX_UPLOAD_BYTES) throw mediaImageInvalid("변환된 이미지 크기가 허용 범위를 초과합니다.");
    return {
      data,
      mimeType: "image/webp",
      checksumSha256: createHash("sha256").update(data).digest("hex"),
      byteSize: data.length,
      width: info.width,
      height: info.height,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw mediaImageInvalid("이미지를 안전하게 처리할 수 없습니다.");
  }
}

function storageFor(context: ApiContext): { storage: Storage; bucket: string } {
  if (!context.config.gcsBucket) throw new AppError(503, "MEDIA_NOT_CONFIGURED", "미디어 저장소가 구성되지 않았습니다.");
  return {
    storage: new Storage(context.config.gcsProjectId ? { projectId: context.config.gcsProjectId } : {}),
    bucket: context.config.gcsBucket,
  };
}

function verifiedStagingGeneration(metadata: FileMetadata, asset: MediaRow): string {
  const generation = String(metadata.generation ?? "");
  const customMetadata = metadata.metadata ?? {};
  if (!/^\d+$/.test(generation)) throw mediaImageInvalid("업로드 객체 세대를 확인할 수 없습니다.");
  if (Number(metadata.size) !== Number(asset.byte_size)) {
    throw mediaImageInvalid("업로드된 파일 크기가 신청 값과 일치하지 않습니다.");
  }
  if (metadata.contentType !== asset.declared_mime_type) {
    throw mediaImageInvalid("업로드 객체의 Content-Type이 신청 값과 일치하지 않습니다.");
  }
  if (customMetadata.sha256 !== asset.checksum_sha256 || customMetadata["media-id"] !== asset.id) {
    throw mediaImageInvalid("업로드 객체의 서명 메타데이터가 신청 값과 일치하지 않습니다.");
  }
  return generation;
}

async function deleteObjectsBestEffort(files: File[]): Promise<void> {
  await Promise.all(files.map((file) => file.delete({ ignoreNotFound: true }).catch(() => undefined)));
}

async function deleteMediaObjectKeysBestEffort(context: ApiContext, objectKeys: string[]): Promise<void> {
  if (!context.config.gcsBucket || objectKeys.length === 0) return;
  const { storage, bucket } = storageFor(context);
  await deleteObjectsBestEffort(
    [...new Set(objectKeys)].map((objectKey) => storage.bucket(bucket).file(objectKey)),
  );
}

function mediaUploadQuotaError(reservation: MediaUploadReservation, requestedBytes: number): AppError {
  const activeQuotaExceeded = !mediaUploadQuotaAllows(
    reservation.activeCount,
    reservation.activeBytes,
    requestedBytes,
  );
  const dailyQuotaExceeded = reservation.dailyCount >= MAX_DAILY_UPLOAD_COUNT
    || reservation.dailyBytes + requestedBytes > MAX_DAILY_UPLOAD_BYTES;
  const code = activeQuotaExceeded
    ? "MEDIA_UPLOAD_ACTIVE_QUOTA_EXCEEDED"
    : dailyQuotaExceeded
      ? "MEDIA_UPLOAD_DAILY_QUOTA_EXCEEDED"
      : "MEDIA_READY_QUOTA_EXCEEDED";
  const message = activeQuotaExceeded
    ? "처리 중인 첨부 파일이 너무 많습니다. 기존 업로드를 완료한 뒤 다시 시도해 주세요."
    : dailyQuotaExceeded
      ? "오늘 업로드할 수 있는 첨부 파일 한도를 초과했습니다. 잠시 후 다시 시도해 주세요."
      : "첨부 파일 보관 한도를 초과했습니다. 고객센터에 문의해 주세요.";
  return new AppError(429, code, message, {
    maxActiveUploads: MAX_ACTIVE_UPLOAD_COUNT,
    maxActiveBytes: MAX_ACTIVE_UPLOAD_BYTES,
    maxDailyUploads: MAX_DAILY_UPLOAD_COUNT,
    maxDailyBytes: MAX_DAILY_UPLOAD_BYTES,
    maxReadyMedia: MAX_READY_MEDIA_COUNT,
    maxReadyBytes: MAX_READY_MEDIA_BYTES,
  });
}

type RecoverableMediaIdempotency =
  | { kind: "FRESH"; id: string }
  | { kind: "PENDING"; id: string }
  | { kind: "REPLAY"; statusCode: number; body: unknown };

async function beginRecoverableMediaIdempotency(
  client: DatabaseClient,
  input: { actorId: string; scope: string; key: string; hash: string },
): Promise<RecoverableMediaIdempotency> {
  try {
    const started = await beginIdempotency(client, input);
    return started.fresh
      ? { kind: "FRESH", id: started.id }
      : { kind: "REPLAY", statusCode: started.statusCode, body: started.body };
  } catch (error) {
    if (!(error instanceof AppError) || error.statusCode !== 409) throw error;
    const existing = await client.query<{ id: string; request_hash: string; state: string }>(
      `SELECT id,request_hash,state
         FROM idempotency_keys
        WHERE actor_id=$1 AND scope=$2 AND idempotency_key=$3 AND expires_at>now()
        FOR UPDATE`,
      [input.actorId, input.scope, input.key],
    );
    const row = existing.rows[0];
    if (!row || row.request_hash !== input.hash || row.state !== "PROCESSING") throw error;
    return { kind: "PENDING", id: row.id };
  }
}

function mediaProcessingClaimToken(asset: MediaRow): string | null {
  if (!asset.metadata || typeof asset.metadata !== "object" || Array.isArray(asset.metadata)) return null;
  const processing = (asset.metadata as Record<string, unknown>).processing;
  if (!processing || typeof processing !== "object" || Array.isArray(processing)) return null;
  const token = (processing as Record<string, unknown>).claimToken;
  return typeof token === "string" ? token : null;
}

function mediaProcessingIdempotencyId(asset: MediaRow): string | null {
  if (!asset.metadata || typeof asset.metadata !== "object" || Array.isArray(asset.metadata)) return null;
  const processing = (asset.metadata as Record<string, unknown>).processing;
  if (!processing || typeof processing !== "object" || Array.isArray(processing)) return null;
  const id = (processing as Record<string, unknown>).idempotencyId;
  return typeof id === "string" ? id : null;
}

function mediaProcessingFinalObjectKey(asset: MediaRow): string | null {
  if (!asset.metadata || typeof asset.metadata !== "object" || Array.isArray(asset.metadata)) return null;
  const processing = (asset.metadata as Record<string, unknown>).processing;
  if (!processing || typeof processing !== "object" || Array.isArray(processing)) return null;
  const objectKey = (processing as Record<string, unknown>).finalObjectKey;
  return typeof objectKey === "string" && objectKey.length > 0 ? objectKey : null;
}

function mediaProcessingPreviousStatus(asset: MediaRow): "PENDING_UPLOAD" | "UPLOADED" {
  if (!asset.metadata || typeof asset.metadata !== "object" || Array.isArray(asset.metadata)) return "UPLOADED";
  const processing = (asset.metadata as Record<string, unknown>).processing;
  if (!processing || typeof processing !== "object" || Array.isArray(processing)) return "UPLOADED";
  return (processing as Record<string, unknown>).previousStatus === "PENDING_UPLOAD" ? "PENDING_UPLOAD" : "UPLOADED";
}

function mediaProcessingHeartbeatMs(asset: MediaRow): number {
  if (!asset.metadata || typeof asset.metadata !== "object" || Array.isArray(asset.metadata)) {
    return asset.updated_at.getTime();
  }
  const processing = (asset.metadata as Record<string, unknown>).processing;
  if (!processing || typeof processing !== "object" || Array.isArray(processing)) return asset.updated_at.getTime();
  const record = processing as Record<string, unknown>;
  const timestamps = [record.claimedAt, record.trackedAt]
    .filter((value): value is string => typeof value === "string")
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  return timestamps.length ? Math.max(...timestamps) : asset.updated_at.getTime();
}

function mediaUploadIntentWasExpired(asset: MediaRow): boolean {
  if (!asset.metadata || typeof asset.metadata !== "object" || Array.isArray(asset.metadata)) return false;
  const reason = (asset.metadata as Record<string, unknown>).uploadIntentExpiryReason;
  return reason === "complete_after_policy_expiry" || reason === "signed_policy_expired";
}

function mediaUploadIntentExpiresNow(asset: MediaRow): boolean {
  if (asset.metadata && typeof asset.metadata === "object" && !Array.isArray(asset.metadata)) {
    const raw = (asset.metadata as Record<string, unknown>).uploadIntentExpiresAt;
    if (typeof raw === "string") {
      const expiresAt = Date.parse(raw);
      if (Number.isFinite(expiresAt)) return expiresAt <= Date.now();
    }
  }
  return asset.updated_at.getTime() < Date.now() - PENDING_UPLOAD_TTL_MS;
}

function mediaUploadIntentExpiredBody(requestId: string) {
  const error = mediaUploadIntentExpiredError();
  return { error: { code: error.code, message: error.message, requestId } };
}

function terminalMediaProcessingError(error: unknown): boolean {
  return error instanceof AppError && error.code === "MEDIA_IMAGE_INVALID";
}

function verifiedFinalGeneration(metadata: FileMetadata, sanitized: SanitizedImage, mediaIdValue: string): string {
  const generation = String(metadata.generation ?? "");
  const customMetadata = metadata.metadata ?? {};
  if (
    !/^\d+$/.test(generation)
    || Number(metadata.size) !== sanitized.byteSize
    || metadata.contentType !== sanitized.mimeType
    || customMetadata.sha256 !== sanitized.checksumSha256
    || customMetadata["media-id"] !== mediaIdValue
  ) {
    throw new AppError(502, "MEDIA_FINALIZE_FAILED", "안전 변환된 첨부 파일의 저장 결과를 확인할 수 없습니다.");
  }
  return generation;
}

async function saveSanitizedImage(file: File, sanitized: SanitizedImage, mediaIdValue: string): Promise<string> {
  try {
    await file.save(sanitized.data, {
      contentType: sanitized.mimeType,
      metadata: {
        cacheControl: "private, max-age=31536000, immutable",
        contentDisposition: "inline",
        contentType: sanitized.mimeType,
        metadata: {
          sha256: sanitized.checksumSha256,
          "media-id": mediaIdValue,
          sanitized: "true",
        },
      },
      preconditionOpts: { ifGenerationMatch: 0 },
      resumable: false,
      validation: "crc32c",
    });
  } catch (saveError) {
    try {
      const [existingMetadata] = await file.getMetadata();
      return verifiedFinalGeneration(existingMetadata, sanitized, mediaIdValue);
    } catch {
      throw saveError;
    }
  }
  const [metadata] = await file.getMetadata();
  return verifiedFinalGeneration(metadata, sanitized, mediaIdValue);
}

function accountDeletionApprovedError(): AppError {
  return new AppError(403, "ACCOUNT_DELETION_APPROVED", "탈퇴가 승인된 계정은 더 이상 변경할 수 없습니다.");
}

async function accountDeletionIsApproved(queryable: Queryable, actorId: string): Promise<boolean> {
  const result = await queryable.query<{ approved: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM account_deletion_requests WHERE user_id=$1 AND status='APPROVED'
     ) AS approved`,
    [actorId],
  );
  return result.rows[0]?.approved === true;
}

async function terminalizeMediaForApprovedAccount(
  client: DatabaseClient,
  requestId: string,
  asset: MediaRow,
  idempotencyId: string,
): Promise<{ objectKeys: string[] }> {
  const finalObjectKey = mediaProcessingFinalObjectKey(asset);
  if (asset.status !== "DELETED") {
    const deleted = await client.query(
      `UPDATE media_assets
          SET status='DELETED',
              metadata=metadata || jsonb_build_object(
                'deletion',jsonb_build_object(
                  'requestedAt',now()::text,
                  'previousStatus',$3::text,
                  'reason','ACCOUNT_DELETION_APPROVED'
                )
              )
        WHERE id=$1 AND owner_id=$2 AND status<>'DELETED'`,
      [asset.id, asset.owner_id, asset.status],
    );
    if (deleted.rowCount !== 1) throw conflict("첨부 파일의 탈퇴 승인 정리 상태가 이미 변경되었습니다.");
    await writeOutbox(client, requestId, {
      aggregateType: "MEDIA",
      aggregateId: asset.id,
      eventType: "media.deleted",
      payload: {
        mediaId: asset.id,
        userId: asset.owner_id,
        previousStatus: asset.status,
        reason: "ACCOUNT_DELETION_APPROVED",
      },
    });
  }
  await client.query(
    "DELETE FROM idempotency_keys WHERE id=$1 AND state='PROCESSING'",
    [idempotencyId],
  );
  return { objectKeys: [asset.object_key, ...(finalObjectKey ? [finalObjectKey] : [])] };
}

async function settleMediaProcessingFailure(
  context: ApiContext,
  input: {
    id: string;
    ownerId: string;
    idempotencyId: string;
    claimToken: string;
    previousStatus: "PENDING_UPLOAD" | "UPLOADED";
    requestId: string;
    error: unknown;
    finalObjectKey: string | null;
  },
): Promise<
  | { kind: "READY"; body: { mediaId: string; status: "READY"; mimeType: string | null } }
  | { kind: "ACCOUNT_DELETION_APPROVED"; objectKeys: string[] }
  | { kind: "DELETED" }
  | { kind: "FAILED"; terminal: boolean }
  | { kind: "SUPERSEDED" }
> {
  return withTransaction(context.pool, async (client) => {
    await lockAccountMutation(client, input.ownerId);
    await lockMediaUploadOwner(client, input.ownerId);
    const current = await client.query<MediaRow>("SELECT * FROM media_assets WHERE id=$1 FOR UPDATE", [input.id]);
    const asset = current.rows[0];
    if (!asset || asset.owner_id !== input.ownerId) return { kind: "SUPERSEDED" as const };
    if (await accountDeletionIsApproved(client, input.ownerId)) {
      const terminal = await terminalizeMediaForApprovedAccount(
        client,
        input.requestId,
        asset,
        input.idempotencyId,
      );
      return { kind: "ACCOUNT_DELETION_APPROVED" as const, objectKeys: terminal.objectKeys };
    }
    if (asset.status === "READY") {
      const body = { mediaId: input.id, status: "READY" as const, mimeType: asset.detected_mime_type };
      await completeIdempotency(client, input.idempotencyId, {
        statusCode: 200,
        body,
        resourceType: "MEDIA",
        resourceId: input.id,
      });
      return { kind: "READY" as const, body };
    }
    if (asset.status === "DELETED") {
      await client.query(
        "DELETE FROM idempotency_keys WHERE id=$1 AND state='PROCESSING'",
        [input.idempotencyId],
      );
      return { kind: "DELETED" as const };
    }
    if (asset.status !== "PROCESSING" || mediaProcessingClaimToken(asset) !== input.claimToken) {
      return { kind: "SUPERSEDED" as const };
    }
    const terminal = terminalMediaProcessingError(input.error);
    const failureCode = input.error instanceof AppError ? input.error.code : "MEDIA_PROCESSING_FAILED";
    const reset = await client.query(
      `UPDATE media_assets
          SET status=$5,
              metadata=(metadata - 'processing') || jsonb_build_object(
                'processingFailure',jsonb_strip_nulls(jsonb_build_object(
                  'code',$6::text,'at',now()::text,'finalObjectKey',$7::text,'retryable',$8::boolean
                ))
              )
        WHERE id=$1 AND owner_id=$2 AND status='PROCESSING'
          AND metadata->'processing'->>'claimToken'=$3
          AND metadata->'processing'->>'idempotencyId'=$4`,
      [
        input.id,
        input.ownerId,
        input.claimToken,
        input.idempotencyId,
        terminal ? "REJECTED" : input.previousStatus,
        failureCode,
        input.finalObjectKey,
        !terminal,
      ],
    );
    if (reset.rowCount !== 1) return { kind: "SUPERSEDED" as const };
    const released = await client.query(
      "DELETE FROM idempotency_keys WHERE id=$1 AND state='PROCESSING'",
      [input.idempotencyId],
    );
    if (released.rowCount !== 1) throw conflict("첨부 처리 재시도 상태를 복구하지 못했습니다.");
    return { kind: "FAILED" as const, terminal };
  });
}

async function mediaHasReferences(queryable: Queryable, id: string): Promise<boolean> {
  const references = await queryable.query<{
    inquiry_message: boolean;
    community_post: boolean;
    catalog_request: boolean;
    wanted_request: boolean;
  }>(
    `SELECT
       EXISTS(SELECT 1 FROM inquiry_message_media WHERE media_id=$1) AS inquiry_message,
       EXISTS(SELECT 1 FROM community_post_media WHERE media_id=$1) AS community_post,
       EXISTS(SELECT 1 FROM catalog_requests WHERE media_id=$1) AS catalog_request,
       EXISTS(SELECT 1 FROM wanted_requests WHERE media_id=$1) AS wanted_request`,
    [id],
  );
  const row = references.rows[0];
  return row?.inquiry_message === true
    || row?.community_post === true
    || row?.catalog_request === true
    || row?.wanted_request === true;
}

export async function assertReadyOwnedMedia(
  queryable: Queryable,
  ownerId: string,
  mediaIds: string[],
  purposes: readonly (typeof MEDIA_PURPOSES)[number][],
): Promise<void> {
  if (!mediaIds.length) return;
  const uniqueIds = [...new Set(mediaIds)];
  if (uniqueIds.length !== mediaIds.length) throw badRequest("같은 첨부 파일을 중복해서 사용할 수 없습니다.");
  const result = await queryable.query<{ id: string }>(
    `SELECT id FROM media_assets
     WHERE id = ANY($1::uuid[]) AND owner_id=$2 AND status='READY' AND purpose = ANY($3::text[])
     FOR SHARE`,
    [uniqueIds, ownerId, purposes],
  );
  if (result.rowCount !== uniqueIds.length) {
    throw badRequest("첨부 파일의 소유자, 용도 또는 업로드 완료 상태를 확인해 주세요.");
  }
}

function mediaId(request: FastifyRequest): string {
  return uuidInput((request.params as Record<string, unknown>).mediaId, "mediaId");
}

async function signAsset(context: ApiContext, asset: MediaRow) {
  const { storage, bucket } = storageFor(context);
  const expiresAt = new Date(Date.now() + 5 * 60_000);
  const file = storage.bucket(bucket).file(
    asset.object_key,
    asset.object_generation === null ? undefined : { generation: String(asset.object_generation) },
  );
  const [url] = await file.getSignedUrl({ version: "v4", action: "read", expires: expiresAt });
  return { mediaId: asset.id, url, expiresAt: expiresAt.toISOString(), mimeType: asset.detected_mime_type };
}

async function signedReadUrl(context: ApiContext, request: FastifyRequest, adminAccess: boolean) {
  const id = mediaId(request);
  const row = await context.pool.query<MediaRow>("SELECT * FROM media_assets WHERE id=$1 AND status='READY'", [id]);
  if (!row.rowCount) throw notFound("사용 가능한 첨부 파일을 찾을 수 없습니다.");
  const asset = row.rows[0]!;
  if (!adminAccess && asset.owner_id !== request.actor!.userId) throw forbidden();
  return signAsset(context, asset);
}

export async function registerMediaRoutes(app: FastifyInstance, context: ApiContext) {
  const processingLimiter = createMediaProcessingLimiter();

  app.post("/v1/media/uploads", {
    preHandler: context.auth.requireUser,
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const body = objectInput(request.body);
    const purpose = enumInput(body, "purpose", MEDIA_PURPOSES)!;
    const filename = normalizeFilename(stringInput(body, "filename", { max: 255 })!);
    const mimeType = enumInput(body, "mimeType", SUPPORTED_MIME_TYPES)!;
    const byteSize = integerInput(body, "byteSize", { min: 1, max: MAX_UPLOAD_BYTES })!;
    const checksumSha256 = stringInput(body, "checksumSha256", { min: 64, max: 64 })!.toLocaleLowerCase("en-US");
    if (!/^[0-9a-f]{64}$/.test(checksumSha256)) throw badRequest("checksumSha256 형식을 확인해 주세요.");
    const actorId = request.actor!.userId;
    const key = idempotencyKey(request.headers);
    const hash = mediaUploadIntentFingerprint({
      actorId,
      purpose,
      filename,
      mimeType,
      byteSize,
      checksumSha256,
    });
    const { storage, bucket } = storageFor(context);
    const id = randomUUID();
    const objectKey = `uploads/${actorId}/${id}/${filename}`;
    const expiresAt = new Date(Date.now() + UPLOAD_POLICY_TTL_MS);
    const intentExpiresAt = new Date(Date.now() + PENDING_UPLOAD_TTL_MS);
    const stagingFile = storage.bucket(bucket).file(objectKey);
    const [postPolicy] = await stagingFile.generateSignedPostPolicyV4(buildUploadPostPolicyOptions({
      mediaId: id,
      mimeType,
      byteSize,
      checksumSha256,
      expiresAt,
    }));
    const responseBody = {
      mediaId: id,
      uploadUrl: postPolicy.url,
      method: "POST" as const,
      fields: postPolicy.fields,
      fileFieldName: "file" as const,
      expiresAt: expiresAt.toISOString(),
      maxBytes: byteSize,
    };
    const result = await withTransaction(context.pool, async (client) => {
      const idem = await beginIdempotency(client, {
        actorId,
        scope: MEDIA_UPLOAD_INTENT_SCOPE,
        key,
        hash,
      });
      if (!idem.fresh) {
        return { replay: true, statusCode: idem.statusCode, body: idem.body, expiredObjectKeys: [] as string[] };
      }
      const reservation = await reserveMediaUploadIntentWithClient(client, {
        id,
        ownerId: actorId,
        purpose,
        objectKey,
        filename,
        mimeType,
        byteSize,
        checksumSha256,
        intentExpiresAt,
      }, new Date());
      if (!reservation.reserved) throw mediaUploadQuotaError(reservation, byteSize);
      await completeIdempotency(client, idem.id, {
        statusCode: 201,
        body: responseBody,
        resourceType: "MEDIA",
        resourceId: id,
      });
      return { replay: false, statusCode: 201, body: responseBody, expiredObjectKeys: reservation.expiredObjectKeys };
    });
    await deleteObjectsBestEffort(result.expiredObjectKeys.map((expiredKey) => storage.bucket(bucket).file(expiredKey)));
    if (result.replay) reply.header("x-idempotent-replay", "true");
    return reply.code(result.statusCode).send(result.body);
  });

  app.post("/v1/media/:mediaId/complete", {
    preHandler: context.auth.requireUser,
    config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const id = mediaId(request);
    const ownerId = request.actor!.userId;
    const key = idempotencyKey(request.headers);
    const hash = mediaUploadCompleteFingerprint(ownerId, id);
    const { storage, bucket } = storageFor(context);
    const releaseProcessingSlot = processingLimiter.acquire();
    if (!releaseProcessingSlot) {
      throw new AppError(503, "MEDIA_PROCESSING_BUSY", "이미지 처리 요청이 많습니다. 잠시 후 다시 시도해 주세요.");
    }
    try {
    const claim = await withTransaction(context.pool, async (client) => {
      await lockAccountMutation(client, ownerId);
      await lockMediaUploadOwner(client, ownerId);
      const row = await client.query<MediaRow>("SELECT * FROM media_assets WHERE id=$1 FOR UPDATE", [id]);
      if (!row.rowCount) throw notFound();
      const asset = row.rows[0]!;
      if (asset.owner_id !== ownerId) throw forbidden();
      if (asset.status === "READY") {
        const idem = await beginRecoverableMediaIdempotency(client, {
          actorId: ownerId,
          scope: MEDIA_UPLOAD_COMPLETE_SCOPE,
          key,
          hash,
        });
        if (idem.kind === "REPLAY") {
          return { kind: "REPLAY" as const, statusCode: idem.statusCode, body: idem.body };
        }
        const body = { mediaId: id, status: "READY" as const, mimeType: asset.detected_mime_type };
        await completeIdempotency(client, idem.id, {
          statusCode: 200,
          body,
          resourceType: "MEDIA",
          resourceId: id,
        });
        if (idem.kind === "PENDING") {
          return { kind: "REPLAY" as const, statusCode: 200, body };
        }
        return { kind: "READY" as const, body };
      }
      if (asset.status === "PROCESSING") {
        const idem = await beginRecoverableMediaIdempotency(client, {
          actorId: ownerId,
          scope: MEDIA_UPLOAD_COMPLETE_SCOPE,
          key,
          hash,
        });
        if (idem.kind === "REPLAY") {
          return { kind: "REPLAY" as const, statusCode: idem.statusCode, body: idem.body };
        }
        if (idem.kind === "FRESH") throw badRequest("다른 요청이 첨부 파일을 처리하고 있습니다.");
        const staleBefore = Date.now() - PROCESSING_CLAIM_TTL_MS;
        const heartbeatMs = mediaProcessingHeartbeatMs(asset);
        if (heartbeatMs >= staleBefore) {
          throw conflict("동일한 첨부 완료 요청이 처리 중입니다. 잠시 후 같은 키로 다시 시도해 주세요.", {
            retryAfterSeconds: Math.max(1, Math.ceil((heartbeatMs - staleBefore) / 1_000)),
          });
        }
        const claimToken = randomUUID();
        const reclaimed = await client.query<MediaRow>(
          `UPDATE media_assets
              SET metadata=jsonb_set(
                    metadata,
                    '{processing}',
                    COALESCE(metadata->'processing','{}'::jsonb) || jsonb_build_object(
                      'idempotencyId',$3::text,
                      'idempotencyKey',$4::text,
                      'claimToken',$5::text,
                      'claimedAt',now()::text,
                      'reclaimed',true
                    ),
                    true
                  )
            WHERE id=$1 AND owner_id=$2 AND status='PROCESSING' RETURNING *`,
          [id, ownerId, idem.id, key, claimToken],
        );
        if (reclaimed.rowCount !== 1) throw conflict("첨부 처리 권한을 다시 확보하지 못했습니다.");
        return {
          kind: "PROCESSING" as const,
          asset: reclaimed.rows[0]!,
          idempotencyId: idem.id,
          claimToken,
          previousStatus: mediaProcessingPreviousStatus(asset),
        };
      }
      const expiresNow = asset.status === "PENDING_UPLOAD" && mediaUploadIntentExpiresNow(asset);
      if (expiresNow || (asset.status === "REJECTED" && mediaUploadIntentWasExpired(asset))) {
        const idem = await beginRecoverableMediaIdempotency(client, {
          actorId: ownerId,
          scope: MEDIA_UPLOAD_COMPLETE_SCOPE,
          key,
          hash,
        });
        if (idem.kind === "REPLAY") {
          return { kind: "REPLAY" as const, statusCode: idem.statusCode, body: idem.body };
        }
        if (expiresNow) {
          await client.query(
            `UPDATE media_assets
                SET status='REJECTED',
                    metadata=metadata || jsonb_build_object(
                      'uploadIntentExpiredAt',now()::text,
                      'uploadIntentExpiryReason','complete_after_policy_expiry'
                    )
              WHERE id=$1`,
            [id],
          );
        }
        const body = mediaUploadIntentExpiredBody(request.id);
        await completeIdempotency(client, idem.id, {
          statusCode: 410,
          body,
          resourceType: "MEDIA",
          resourceId: id,
        });
        return { kind: "EXPIRED" as const, asset, body };
      }
      if (asset.status !== "PENDING_UPLOAD" && asset.status !== "UPLOADED") {
        throw badRequest("완료 처리할 수 없는 첨부 상태입니다.");
      }
      const idem = await beginRecoverableMediaIdempotency(client, {
        actorId: ownerId,
        scope: MEDIA_UPLOAD_COMPLETE_SCOPE,
        key,
        hash,
      });
      if (idem.kind === "REPLAY") {
        return { kind: "REPLAY" as const, statusCode: idem.statusCode, body: idem.body };
      }
      const processingUsage = await client.query<{ active_count: number | string }>(
        "SELECT count(*)::int AS active_count FROM media_assets WHERE owner_id=$1 AND status='PROCESSING'",
        [ownerId],
      );
      if (Number(processingUsage.rows[0]?.active_count ?? 0) >= MAX_CONCURRENT_PROCESSING_PER_USER) {
        throw new AppError(429, "MEDIA_PROCESSING_QUOTA_EXCEEDED", "이미 처리 중인 첨부 파일이 있습니다. 완료 후 다시 시도해 주세요.");
      }
      const claimToken = randomUUID();
      const claimed = await client.query<MediaRow>(
        `UPDATE media_assets
            SET status='PROCESSING',
                metadata=metadata || jsonb_build_object(
                  'processing',jsonb_build_object(
                    'idempotencyId',$3::text,
                    'idempotencyKey',$4::text,
                    'claimToken',$5::text,
                    'claimedAt',now()::text,
                    'previousStatus',$6::text
                  )
                )
         WHERE id=$1 AND owner_id=$2 AND status IN ('PENDING_UPLOAD','UPLOADED') RETURNING *`,
        [id, ownerId, idem.id, key, claimToken, asset.status],
      );
      if (!claimed.rowCount) throw badRequest("다른 요청이 첨부 파일을 처리하고 있습니다.");
      return {
        kind: "PROCESSING" as const,
        asset: claimed.rows[0]!,
        idempotencyId: idem.id,
        claimToken,
        previousStatus: asset.status as "PENDING_UPLOAD" | "UPLOADED",
      };
    });
    if (claim.kind === "REPLAY") {
      reply.header("x-idempotent-replay", "true");
      return reply.code(claim.statusCode).send(claim.body);
    }
    if (claim.kind === "READY") {
      return reply.code(200).send(claim.body);
    }

    const stagingFile = storage.bucket(bucket).file(claim.asset.object_key);
    if (claim.kind === "EXPIRED") {
      await deleteObjectsBestEffort([stagingFile]);
      throw mediaUploadIntentExpiredError();
    }

    let finalFile: File | null = null;
    try {
      const [stagingMetadata] = await stagingFile.getMetadata();
      const stagingGeneration = verifiedStagingGeneration(stagingMetadata, claim.asset);
      const immutableStagingFile = storage.bucket(bucket).file(claim.asset.object_key, { generation: stagingGeneration });
      const verified = await readAndVerify(
        immutableStagingFile,
        Number(claim.asset.byte_size),
        claim.asset.checksum_sha256,
        claim.asset.declared_mime_type,
      );
      const sanitized = await sanitizeImage(verified.data, verified.detectedMimeType);
      const finalObjectKey = `media/${id}/${sanitized.checksumSha256}.webp`;
      finalFile = storage.bucket(bucket).file(finalObjectKey);
      const trackedFinalObject = await context.pool.query(
        `UPDATE media_assets
            SET metadata=jsonb_set(
                  metadata,
                  '{processing}',
                  COALESCE(metadata->'processing','{}'::jsonb) || jsonb_build_object(
                    'finalObjectKey',$3::text,'trackedAt',now()::text
                  ),
                  true
                )
          WHERE id=$1 AND owner_id=$2 AND status='PROCESSING'
            AND metadata->'processing'->>'claimToken'=$4`,
        [id, ownerId, finalObjectKey, claim.claimToken],
      );
      if (trackedFinalObject.rowCount !== 1) throw conflict("첨부 처리 권한이 이미 변경되었습니다.");
      const finalGeneration = await saveSanitizedImage(finalFile, sanitized, id);

      const result = await withTransaction(context.pool, async (client) => {
        await lockAccountMutation(client, ownerId);
        await lockMediaUploadOwner(client, ownerId);
        const current = await client.query<MediaRow>("SELECT * FROM media_assets WHERE id=$1 FOR UPDATE", [id]);
        const currentAsset = current.rows[0];
        if (!currentAsset || currentAsset.owner_id !== ownerId) throw notFound();
        if (await accountDeletionIsApproved(client, ownerId)) {
          const terminal = await terminalizeMediaForApprovedAccount(
            client,
            request.id,
            currentAsset,
            claim.idempotencyId,
          );
          return { kind: "ACCOUNT_DELETION_APPROVED" as const, objectKeys: terminal.objectKeys };
        }
        if (currentAsset.status === "READY") {
          const body = { mediaId: id, status: "READY" as const, mimeType: currentAsset.detected_mime_type };
          await completeIdempotency(client, claim.idempotencyId, {
            statusCode: 200,
            body,
            resourceType: "MEDIA",
            resourceId: id,
          });
          return { kind: "READY" as const, replay: true, body };
        }
        if (currentAsset.status !== "PROCESSING" || mediaProcessingClaimToken(currentAsset) !== claim.claimToken) {
          throw conflict("첨부 처리 권한이 이미 변경되었습니다.");
        }
        const readyUsage = await client.query<{
          ready_count: number | string;
          ready_bytes: number | string;
          daily_bytes_without_current: number | string;
        }>(
          `SELECT
             count(*) FILTER (WHERE status='READY')::int AS ready_count,
             COALESCE(sum(byte_size) FILTER (WHERE status='READY'),0)::bigint AS ready_bytes,
             COALESCE(sum(byte_size) FILTER (
               WHERE created_at >= now() - interval '24 hours' AND id<>$2
             ),0)::bigint AS daily_bytes_without_current
           FROM media_assets WHERE owner_id=$1`,
          [ownerId, id],
        );
        if (Number(readyUsage.rows[0]?.daily_bytes_without_current ?? 0) + sanitized.byteSize > MAX_DAILY_UPLOAD_BYTES) {
          throw new AppError(429, "MEDIA_UPLOAD_DAILY_QUOTA_EXCEEDED", "오늘 업로드할 수 있는 첨부 파일 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.");
        }
        if (
          Number(readyUsage.rows[0]?.ready_count ?? 0) >= MAX_READY_MEDIA_COUNT
          || Number(readyUsage.rows[0]?.ready_bytes ?? 0) + sanitized.byteSize > MAX_READY_MEDIA_BYTES
        ) {
          throw new AppError(429, "MEDIA_READY_QUOTA_EXCEEDED", "첨부 파일 보관 한도를 초과했습니다. 고객센터에 문의해 주세요.");
        }
        const updated = await client.query<{ id: string }>(
          `UPDATE media_assets
              SET status='READY',
                  detected_mime_type=$3,
                  object_key=$4,
                  object_generation=$5,
                  checksum_sha256=$6,
                  byte_size=$7,
                  width=$8,
                  height=$9,
                  metadata=(metadata - 'processing') || $10::jsonb
            WHERE id=$1 AND owner_id=$2 AND status='PROCESSING'
              AND metadata->'processing'->>'claimToken'=$11
            RETURNING id`,
          [
            id,
            ownerId,
            sanitized.mimeType,
            finalObjectKey,
            finalGeneration,
            sanitized.checksumSha256,
            sanitized.byteSize,
            sanitized.width,
            sanitized.height,
            JSON.stringify({
              original: {
                byteSize: Number(claim.asset.byte_size),
                checksumSha256: claim.asset.checksum_sha256,
                detectedMimeType: verified.detectedMimeType,
                stagingObjectKey: claim.asset.object_key,
              },
              sanitization: {
                autoOriented: true,
                metadataStripped: true,
                outputFormat: "webp",
                maxOutputDimension: MAX_OUTPUT_DIMENSION,
                completedAt: new Date().toISOString(),
              },
            }),
            claim.claimToken,
          ],
        );
        if (!updated.rowCount) throw badRequest("첨부 상태가 이미 변경되었습니다.");
        await writeOutbox(client, request.id, {
          aggregateType: "MEDIA",
          aggregateId: id,
          eventType: "media.ready",
          payload: {
            mediaId: id,
            userId: ownerId,
            purpose: claim.asset.purpose,
            mimeType: sanitized.mimeType,
            width: sanitized.width,
            height: sanitized.height,
          },
        });
        const body = { mediaId: id, status: "READY" as const, mimeType: sanitized.mimeType };
        await completeIdempotency(client, claim.idempotencyId, {
          statusCode: 200,
          body,
          resourceType: "MEDIA",
          resourceId: id,
        });
        return { kind: "READY" as const, replay: false, body };
      });
      if (result.kind === "ACCOUNT_DELETION_APPROVED") {
        throw accountDeletionApprovedError();
      }
      await deleteObjectsBestEffort([stagingFile]);
      if (result.replay) reply.header("x-idempotent-replay", "true");
      return reply.code(200).send(result.body);
    } catch (error) {
      const settlement = await settleMediaProcessingFailure(context, {
        id,
        ownerId,
        idempotencyId: claim.idempotencyId,
        claimToken: claim.claimToken,
        previousStatus: claim.previousStatus,
        requestId: request.id,
        error,
        finalObjectKey: finalFile?.name ?? null,
      }).catch(() => ({ kind: "SUPERSEDED" as const }));
      if (settlement.kind === "READY") {
        await deleteObjectsBestEffort([stagingFile]);
        reply.header("x-idempotent-replay", "true");
        return reply.code(200).send(settlement.body);
      }
      if (settlement.kind === "ACCOUNT_DELETION_APPROVED") {
        await deleteMediaObjectKeysBestEffort(context, [
          stagingFile.name,
          ...(finalFile ? [finalFile.name] : []),
          ...settlement.objectKeys,
        ]);
        throw accountDeletionApprovedError();
      }
      if (settlement.kind === "DELETED") {
        await deleteObjectsBestEffort([stagingFile, ...(finalFile ? [finalFile] : [])]);
        throw conflict("삭제된 첨부 파일은 완료 처리할 수 없습니다.");
      }
      if (settlement.kind === "FAILED") {
        await deleteObjectsBestEffort([
          ...(settlement.terminal ? [stagingFile] : []),
          ...(finalFile ? [finalFile] : []),
        ]);
      }
      throw error;
    }
    } finally {
      releaseProcessingSlot();
    }
  });

  app.delete("/v1/media/:mediaId", {
    preHandler: context.auth.requireUser,
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const id = mediaId(request);
    const ownerId = request.actor!.userId;
    const key = idempotencyKey(request.headers);
    const hash = mediaDeleteFingerprint(ownerId, id);
    const result = await withTransaction(context.pool, async (client) => {
      await lockAccountMutation(client, ownerId);
      await lockMediaUploadOwner(client, ownerId);
      const media = await client.query<MediaRow>(
        "SELECT * FROM media_assets WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        [id, ownerId],
      );
      if (!media.rowCount) throw notFound("첨부 파일을 찾을 수 없습니다.");
      const asset = media.rows[0]!;
      const idem = await beginIdempotency(client, {
        actorId: ownerId,
        scope: MEDIA_DELETE_SCOPE,
        key,
        hash,
      });
      if (!idem.fresh) {
        return { replay: true, statusCode: idem.statusCode, body: idem.body, objectKeys: [] as string[] };
      }
      const responseBody = { mediaId: id, status: "DELETED" as const };
      if (asset.status === "DELETED") {
        await completeIdempotency(client, idem.id, {
          statusCode: 204,
          body: responseBody,
          resourceType: "MEDIA",
          resourceId: id,
        });
        return { replay: false, statusCode: 204, body: responseBody, objectKeys: [] as string[] };
      }
      if (await mediaHasReferences(client, id)) {
        throw conflict("게시물, 문의, 신청 또는 카탈로그 요청에 사용 중인 첨부 파일은 삭제할 수 없습니다.");
      }
      const previousStatus = asset.status;
      const processingIdempotencyId = mediaProcessingIdempotencyId(asset);
      const finalObjectKey = mediaProcessingFinalObjectKey(asset);
      const deleted = await client.query(
        `UPDATE media_assets
            SET status='DELETED',
                metadata=metadata || jsonb_build_object(
                  'deletion',jsonb_build_object(
                    'requestedAt',now()::text,
                    'previousStatus',$3::text
                  )
                )
          WHERE id=$1 AND owner_id=$2 AND status<>'DELETED'`,
        [id, ownerId, previousStatus],
      );
      if (deleted.rowCount !== 1) throw conflict("첨부 파일 상태가 이미 변경되었습니다.");
      if (processingIdempotencyId) {
        await client.query(
          "DELETE FROM idempotency_keys WHERE id=$1 AND state='PROCESSING'",
          [processingIdempotencyId],
        );
      }
      await writeOutbox(client, request.id, {
        aggregateType: "MEDIA",
        aggregateId: id,
        eventType: "media.deleted",
        payload: { mediaId: id, userId: ownerId, previousStatus },
      });
      await completeIdempotency(client, idem.id, {
        statusCode: 204,
        body: responseBody,
        resourceType: "MEDIA",
        resourceId: id,
      });
      return {
        replay: false,
        statusCode: 204,
        body: responseBody,
        objectKeys: [asset.object_key, ...(finalObjectKey ? [finalObjectKey] : [])],
      };
    });
    await deleteMediaObjectKeysBestEffort(context, result.objectKeys);
    if (result.replay) reply.header("x-idempotent-replay", "true");
    return reply.code(204).send();
  });

  app.get("/v1/media/:mediaId/url", { preHandler: context.auth.requireUser }, async (request) => signedReadUrl(context, request, false));
  app.get("/v1/media/:mediaId/public-url", async (request) => {
    const id = mediaId(request);
    const row = await context.pool.query<MediaRow>(
      `SELECT m.* FROM media_assets m
       WHERE m.id=$1 AND m.status='READY'
         AND (
           (m.purpose='POST' AND EXISTS (
             SELECT 1 FROM community_post_media pm
             JOIN community_posts p ON p.id=pm.post_id
             WHERE pm.media_id=m.id AND p.status='ACTIVE'
           ))
           OR
           (m.purpose='WANTED_REQUEST' AND EXISTS (
             SELECT 1 FROM wanted_requests
             WHERE media_id=$1 AND status='ACTIVE'
           ))
         )`,
      [id],
    );
    if (!row.rowCount) throw notFound("공개된 첨부 파일을 찾을 수 없습니다.");
    return signAsset(context, row.rows[0]!);
  });
  app.get("/v1/admin/media/:mediaId/url", { preHandler: context.auth.requireAdmin }, async (request) => {
    if (!isAdminRole(request.actor!.role)) throw forbidden();
    return signedReadUrl(context, request, true);
  });
}
