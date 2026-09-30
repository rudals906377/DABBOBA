import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { GenerateSignedPostPolicyV4Options } from "@google-cloud/storage";
import { storedMediaLocation } from "@dabboba/config";
import { withTransaction, type DatabaseClient, type DatabasePool, type Queryable } from "@dabboba/db";
import { isAdminRole } from "@dabboba/domain";
import { adminMutationHeaders, writeAdminAudit, writeOutbox } from "../lib/audit.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { beginIdempotency, completeIdempotency, idempotencyKey, requestHash } from "../lib/idempotency.js";
import { enumInput, integerInput, objectInput, stringInput, uuidInput } from "../lib/input.js";
import type { ApiContext } from "../types.js";
import { validMediaObjectVersion, type MediaObject, type MediaObjectInfo } from "../lib/media-object.js";
import type { SanitizedImage } from "../lib/media-runtime.js";

const USER_MEDIA_PURPOSES = ["PROFILE", "POST", "COMMENT", "INQUIRY", "EXCHANGE", "CATALOG_REQUEST", "WANTED_REQUEST"] as const;
const MEDIA_PURPOSES = [...USER_MEDIA_PURPOSES, "CATALOG"] as const;
const SUPPORTED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_ACTIVE_UPLOAD_COUNT = 10;

export function mediaUploadTooLarge(maxBytes: number): AppError {
  return new AppError(413, "MEDIA_TOO_LARGE", "사진 파일이 너무 큽니다.", { maxBytes });
}
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
const MAX_OUTPUT_DIMENSION = 4_096;
const MEDIA_UPLOAD_ADVISORY_NAMESPACE = 1_296_384_177;
const MEDIA_UPLOAD_INTENT_SCOPE = "MEDIA_UPLOAD_INTENT_CREATE";
const MEDIA_UPLOAD_COMPLETE_SCOPE = "MEDIA_UPLOAD_COMPLETE";
const MEDIA_DELETE_SCOPE = "MEDIA_DELETE";

export type MediaRow = {
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
  storageLocation?: { provider: "gcs" | "supabase"; bucket: string };
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

export function mediaUploadIntentFingerprint(input: {
  actorId: string;
  purpose: (typeof MEDIA_PURPOSES)[number];
  filename: string;
  mimeType: (typeof SUPPORTED_MIME_TYPES)[number];
  byteSize: number;
  checksumSha256: string;
  acceptedUploadMethods?: readonly ("POST" | "PUT")[];
  operation?: string;
  adminReason?: string;
}): string {
  return requestHash({
    actorId: input.actorId,
    operation: input.operation ?? "POST /v1/media/uploads",
    purpose: input.purpose,
    filename: normalizeFilename(input.filename),
    mimeType: input.mimeType,
    byteSize: input.byteSize,
    checksumSha256: input.checksumSha256.toLocaleLowerCase("en-US"),
    ...(input.acceptedUploadMethods?.includes("PUT") ? { acceptedUploadMethods: [...input.acceptedUploadMethods].sort() } : {}),
    ...(input.adminReason ? { adminReason: input.adminReason } : {}),
  });
}

export function mediaUploadCompleteFingerprint(
  actorId: string,
  mediaIdValue: string,
  operation = "POST /v1/media/:mediaId/complete",
  adminReason?: string,
): string {
  return requestHash({
    actorId,
    operation,
    mediaId: mediaIdValue.toLocaleLowerCase("en-US"),
    ...(adminReason ? { adminReason } : {}),
  });
}

export function mediaDeleteFingerprint(actorId: string, mediaIdValue: string, operation = "DELETE /v1/media/:mediaId"): string {
  return requestHash({
    actorId,
    operation,
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
           jsonb_strip_nulls(jsonb_build_object('uploadIntentExpiresAt',$9::text,'storage',$10::jsonb)))`,
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
        input.storageLocation ? JSON.stringify(input.storageLocation) : null,
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
  stream: AsyncIterable<Uint8Array>,
  expectedBytes: number,
  expectedSha256: string,
  expectedMimeType: string,
): Promise<{ data: Buffer; detectedMimeType: (typeof SUPPORTED_MIME_TYPES)[number] }> {
  const hash = createHash("sha256");
  const chunks: Buffer[] = [];
  let size = 0;
  let header = Buffer.alloc(0);
  for await (const rawChunk of stream) {
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

function verifiedStagingGeneration(metadata: MediaObjectInfo, asset: MediaRow, provider: "gcs" | "supabase"): string {
  const generation = metadata.version;
  const customMetadata = metadata.metadata ?? {};
  if (!validMediaObjectVersion(provider, generation)) throw mediaImageInvalid("업로드 객체 세대를 확인할 수 없습니다.");
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

async function deleteObjectsBestEffort(files: MediaObject[]): Promise<void> {
  await Promise.all(files.map((file) => file.delete().catch(() => undefined)));
}

async function deleteMediaObjectKeysBestEffort(context: ApiContext, objectKeys: string[]): Promise<void> {
  for (const objectKey of new Set(objectKeys)) {
    try {
      const result = await context.pool.query<{ metadata: unknown }>(
        `SELECT metadata FROM media_assets WHERE object_key=$1
          OR metadata->'processing'->>'finalObjectKey'=$1
          OR metadata->'processingFailure'->>'finalObjectKey'=$1
          OR metadata->'original'->>'stagingObjectKey'=$1 LIMIT 1`, [objectKey],
      );
      if (result.rowCount) await context.mediaRuntime.configuredMediaStorage(context.config, result.rows[0]!.metadata).file(objectKey).delete();
    } catch { /* Durable Worker cleanup retries against the original provider. */ }
  }
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

function verifiedFinalGeneration(metadata: MediaObjectInfo, sanitized: SanitizedImage, mediaIdValue: string, provider: "gcs" | "supabase"): string {
  const generation = metadata.version;
  const customMetadata = metadata.metadata ?? {};
  if (
    !validMediaObjectVersion(provider, generation)
    || Number(metadata.size) !== sanitized.byteSize
    || metadata.contentType !== sanitized.mimeType
    || customMetadata.sha256 !== sanitized.checksumSha256
    || customMetadata["media-id"] !== mediaIdValue
  ) {
    throw new AppError(502, "MEDIA_FINALIZE_FAILED", "안전 변환된 첨부 파일의 저장 결과를 확인할 수 없습니다.");
  }
  return generation;
}

function accountDeletionApprovedError(): AppError {
  return new AppError(403, "ACCOUNT_DELETION_APPROVED", "탈퇴가 승인된 계정은 더 이상 변경할 수 없습니다.");
}

async function accountDeletionIsApproved(queryable: Queryable, actorId: string): Promise<boolean> {
  const result = await queryable.query<{ approved: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM account_deletion_requests WHERE user_id=$1 AND status IN ('PROCESSING','APPROVED')
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
  | { kind: "READY"; body: { mediaId: string; status: "READY"; mimeType: string | null }; objectKey: string }
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
      return { kind: "READY" as const, body, objectKey: asset.object_key };
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
    catalog_attached: boolean;
    catalog_product: boolean;
    draw_snapshot: boolean;
    shipping_snapshot: boolean;
  }>(
    `WITH media AS (
       SELECT metadata->>'catalogDeliveryUrl' AS delivery_url
       FROM media_assets WHERE id=$1
     ) SELECT
       EXISTS(SELECT 1 FROM inquiry_message_media WHERE media_id=$1) AS inquiry_message,
       EXISTS(SELECT 1 FROM community_post_media WHERE media_id=$1) AS community_post,
       EXISTS(SELECT 1 FROM catalog_requests WHERE media_id=$1) AS catalog_request,
       EXISTS(SELECT 1 FROM wanted_requests WHERE media_id=$1) AS wanted_request,
       EXISTS(SELECT 1 FROM media WHERE delivery_url IS NOT NULL) AS catalog_attached,
       EXISTS(
         SELECT 1 FROM catalog_products, media
         WHERE media.delivery_url IS NOT NULL AND image_url=media.delivery_url
       ) AS catalog_product,
       EXISTS(
         SELECT 1 FROM draw_pool_entries, media
         WHERE media.delivery_url IS NOT NULL AND prize_image_url_snapshot=media.delivery_url
       ) AS draw_snapshot,
       EXISTS(
         SELECT 1 FROM shipping_request_items, media
         WHERE media.delivery_url IS NOT NULL AND product_snapshot->>'imageUrl'=media.delivery_url
       ) AS shipping_snapshot`,
    [id],
  );
  const row = references.rows[0];
  return row?.inquiry_message === true
    || row?.community_post === true
    || row?.catalog_request === true
    || row?.wanted_request === true
    || row?.catalog_attached === true
    || row?.catalog_product === true
    || row?.draw_snapshot === true
    || row?.shipping_snapshot === true;
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

export async function signMediaAsset(context: ApiContext, asset: MediaRow) {
  let storage: ReturnType<ApiContext["mediaRuntime"]["configuredMediaStorage"]>;
  try {
    storage = context.mediaRuntime.configuredMediaStorage(context.config, asset.metadata);
  } catch {
    throw new AppError(503, "MEDIA_STORAGE_CONFIGURATION_UNAVAILABLE", "상품 이미지를 잠시 불러올 수 없습니다.");
  }
  const expiresAt = new Date(Date.now() + 5 * 60_000);
  const version = storage.provider === "supabase" ? storedMediaLocation(asset.metadata).version
    : asset.object_generation === null ? null : String(asset.object_generation);
  try {
    const url = await storage.signedRead(asset.object_key, version);
    return { mediaId: asset.id, url, expiresAt: expiresAt.toISOString(), mimeType: asset.detected_mime_type };
  } catch {
    throw new AppError(503, "MEDIA_STORAGE_READ_UNAVAILABLE", "상품 이미지를 잠시 불러올 수 없습니다.");
  }
}

async function signedReadUrl(context: ApiContext, request: FastifyRequest) {
  const id = mediaId(request);
  const row = await context.pool.query<MediaRow>("SELECT * FROM media_assets WHERE id=$1 AND status='READY'", [id]);
  if (!row.rowCount) throw notFound("사용 가능한 첨부 파일을 찾을 수 없습니다.");
  const asset = row.rows[0]!;
  if (asset.owner_id !== request.actor!.userId) throw forbidden();
  return signMediaAsset(context, asset);
}

const ADMIN_MEDIA_READ_AUDIT_REASON = "관리자 첨부 파일 열람";

/**
 * Administrator media access follows the console surface that owns the
 * attachment: inquiry evidence needs inquiries.read, catalog media needs
 * catalog.read, and every other customer upload is moderated content.
 */
export function adminMediaReadPermission(purpose: string): "inquiries.read" | "catalog.read" | "moderation.read" {
  if (purpose === "INQUIRY") return "inquiries.read";
  if (purpose === "CATALOG" || purpose === "CATALOG_REQUEST") return "catalog.read";
  return "moderation.read";
}

export async function registerMediaRoutes(app: FastifyInstance, context: ApiContext) {
  const processingLimiter = createMediaProcessingLimiter();

  const createUploadIntent = async (request: FastifyRequest, reply: FastifyReply) => {
    const catalogUpload = request.routeOptions.url === "/v1/admin/catalog-media/uploads";
    if (catalogUpload && !context.mediaRuntime.completionAvailable) {
      throw new AppError(503, "MEDIA_PROCESSING_UNAVAILABLE", "현재 상품 이미지 완료 처리를 사용할 수 없습니다.");
    }
    if (catalogUpload && !context.config.catalogMediaBaseUrl) {
      throw new AppError(503, "CATALOG_MEDIA_DELIVERY_UNAVAILABLE", "상품 이미지 제공 주소가 구성되지 않았습니다.");
    }
    const adminMutation = catalogUpload ? adminMutationHeaders(request) : null;
    const body = objectInput(request.body);
    if (catalogUpload && body.purpose !== undefined && body.purpose !== "CATALOG") {
      throw badRequest("상품 이미지 업로드 용도는 CATALOG만 사용할 수 있습니다.");
    }
    const purpose = catalogUpload ? "CATALOG" : enumInput(body, "purpose", USER_MEDIA_PURPOSES)!;
    const filename = normalizeFilename(stringInput(body, "filename", { max: 255 })!);
    const mimeType = enumInput(body, "mimeType", SUPPORTED_MIME_TYPES)!;
    const byteSize = integerInput(body, "byteSize", { min: 1 })!;
    if (byteSize > MAX_UPLOAD_BYTES) throw mediaUploadTooLarge(MAX_UPLOAD_BYTES);
    const checksumSha256 = stringInput(body, "checksumSha256", { min: 64, max: 64 })!.toLocaleLowerCase("en-US");
    if (!/^[0-9a-f]{64}$/.test(checksumSha256)) throw badRequest("checksumSha256 형식을 확인해 주세요.");
    const methods = body.acceptedUploadMethods ?? ["POST"];
    if (!Array.isArray(methods) || methods.length < 1 || methods.length > 2
      || new Set(methods).size !== methods.length || methods.some((method) => method !== "POST" && method !== "PUT")) {
      throw badRequest("acceptedUploadMethods 형식을 확인해 주세요.");
    }
    const acceptedUploadMethods = methods as ("POST" | "PUT")[];
    const actorId = request.actor!.userId;
    const key = adminMutation?.idempotencyKey ?? idempotencyKey(request.headers);
    const hash = mediaUploadIntentFingerprint({
      actorId,
      purpose,
      filename,
      mimeType,
      byteSize,
      checksumSha256,
      acceptedUploadMethods,
      ...(catalogUpload ? {
        operation: "POST /v1/admin/catalog-media/uploads",
        adminReason: adminMutation!.reason,
      } : {}),
    });
    const needsLegacyPost = context.config.mediaStorageProvider === "supabase" && !acceptedUploadMethods.includes("PUT");
    if (needsLegacyPost && !context.config.gcsBucket) {
      throw new AppError(426, "MEDIA_UPLOAD_CLIENT_UPDATE_REQUIRED", "사진 업로드를 위해 앱을 업데이트해 주세요.");
    }
    const storage = context.mediaRuntime.configuredMediaStorage(needsLegacyPost ? { ...context.config, mediaStorageProvider: "gcs" } : context.config);
    if (storage.provider === "gcs" && !acceptedUploadMethods.includes("POST")) throw badRequest("지원하지 않는 업로드 방식입니다.");
    // The active adapter owns the real object-size ceiling (Supabase: 5 MiB).
    // Reject before signing so an oversized intent is a 413, not an adapter 500.
    if (byteSize > storage.maxUploadBytes) throw mediaUploadTooLarge(storage.maxUploadBytes);
    const id = randomUUID();
    const objectKey = `uploads/${actorId}/${id}/${filename}`;
    const expiresAt = new Date(Date.now() + UPLOAD_POLICY_TTL_MS);
    const intentExpiresAt = new Date(Date.now() + PENDING_UPLOAD_TTL_MS);
    const signedUpload = await storage.upload({
      key: objectKey,
      mediaId: id,
      mimeType,
      byteSize,
      checksumSha256,
      expiresAt,
      postPolicy: buildUploadPostPolicyOptions({ mediaId: id, mimeType, byteSize, checksumSha256, expiresAt }),
    });
    const responseBody = {
      mediaId: id,
      ...signedUpload,
    };
    const result = await withTransaction(context.pool, async (client) => {
      const idem = await beginIdempotency(client, {
        actorId,
        scope: catalogUpload ? "ADMIN_CATALOG_MEDIA_UPLOAD_INTENT_CREATE" : MEDIA_UPLOAD_INTENT_SCOPE,
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
        storageLocation: storage.location,
      }, new Date());
      if (!reservation.reserved) throw mediaUploadQuotaError(reservation, byteSize);
      if (catalogUpload) {
        await writeAdminAudit(client, request, request.actor!, {
          action: "CATALOG_MEDIA_UPLOAD_INTENT_CREATED",
          targetType: "MEDIA",
          targetId: id,
          after: { mediaId: id, purpose, filename, mimeType, byteSize, status: "PENDING_UPLOAD" },
        });
      }
      await completeIdempotency(client, idem.id, {
        statusCode: 201,
        body: responseBody,
        resourceType: "MEDIA",
        resourceId: id,
      });
      return { replay: false, statusCode: 201, body: responseBody, expiredObjectKeys: reservation.expiredObjectKeys };
    });
    await deleteMediaObjectKeysBestEffort(context, result.expiredObjectKeys);
    if (result.replay) reply.header("x-idempotent-replay", "true");
    return reply.code(result.statusCode).send(result.body);
  };
  app.post("/v1/media/uploads", {
    preHandler: context.auth.requireUser,
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
  }, createUploadIntent);
  app.post("/v1/admin/catalog-media/uploads", {
    preHandler: context.auth.requirePermission("catalog.write"),
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
  }, createUploadIntent);

  const completeUpload = async (request: FastifyRequest, reply: FastifyReply) => {
    const catalogUpload = request.routeOptions.url === "/v1/admin/catalog-media/:mediaId/complete";
    if (!context.mediaRuntime.completionAvailable) {
      throw new AppError(503, "MEDIA_PROCESSING_UNAVAILABLE", "현재 첨부 파일 완료 처리를 사용할 수 없습니다.");
    }
    const id = mediaId(request);
    const ownerId = request.actor!.userId;
    const adminMutation = catalogUpload ? adminMutationHeaders(request) : null;
    const key = adminMutation?.idempotencyKey ?? idempotencyKey(request.headers);
    const hash = mediaUploadCompleteFingerprint(
      ownerId,
      id,
      catalogUpload ? "POST /v1/admin/catalog-media/:mediaId/complete" : undefined,
      adminMutation?.reason,
    );
    const stored = await context.pool.query<Pick<MediaRow, "owner_id" | "purpose" | "metadata">>("SELECT owner_id,purpose,metadata FROM media_assets WHERE id=$1", [id]);
    if (!stored.rowCount) throw notFound();
    if (stored.rows[0]!.owner_id !== ownerId) throw forbidden();
    if (catalogUpload ? stored.rows[0]!.purpose !== "CATALOG" : stored.rows[0]!.purpose === "CATALOG") {
      throw forbidden("이 경로에서 완료할 수 없는 첨부 용도입니다.");
    }
    const storage = context.mediaRuntime.configuredMediaStorage(context.config, stored.rows[0]!.metadata);
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
      if (catalogUpload ? asset.purpose !== "CATALOG" : asset.purpose === "CATALOG") {
        throw forbidden("이 경로에서 완료할 수 없는 첨부 용도입니다.");
      }
      if (asset.status === "READY") {
        const idem = await beginRecoverableMediaIdempotency(client, {
          actorId: ownerId,
          scope: catalogUpload ? "ADMIN_CATALOG_MEDIA_UPLOAD_COMPLETE" : MEDIA_UPLOAD_COMPLETE_SCOPE,
          key,
          hash,
        });
        if (idem.kind === "REPLAY") {
          return { kind: "REPLAY" as const, statusCode: idem.statusCode, body: idem.body };
        }
        const body = { mediaId: id, status: "READY" as const, mimeType: asset.detected_mime_type };
        if (catalogUpload && idem.kind === "FRESH") {
          await writeAdminAudit(client, request, request.actor!, {
            action: "CATALOG_MEDIA_UPLOAD_COMPLETED",
            targetType: "MEDIA",
            targetId: id,
            before: { status: "READY", purpose: asset.purpose },
            after: body,
          });
        }
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
          scope: catalogUpload ? "ADMIN_CATALOG_MEDIA_UPLOAD_COMPLETE" : MEDIA_UPLOAD_COMPLETE_SCOPE,
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
          scope: catalogUpload ? "ADMIN_CATALOG_MEDIA_UPLOAD_COMPLETE" : MEDIA_UPLOAD_COMPLETE_SCOPE,
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
        scope: catalogUpload ? "ADMIN_CATALOG_MEDIA_UPLOAD_COMPLETE" : MEDIA_UPLOAD_COMPLETE_SCOPE,
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

    const stagingFile = storage.file(claim.asset.object_key);
    if (claim.kind === "EXPIRED") {
      await deleteObjectsBestEffort([stagingFile]);
      throw mediaUploadIntentExpiredError();
    }

    let finalFile: MediaObject | null = null;
    try {
      const stagingMetadata = await stagingFile.info();
      const stagingGeneration = verifiedStagingGeneration(stagingMetadata, claim.asset, storage.provider);
      const verified = await readAndVerify(
        stagingFile.read(stagingGeneration),
        Number(claim.asset.byte_size),
        claim.asset.checksum_sha256,
        claim.asset.declared_mime_type,
      );
      const sanitized = await context.mediaRuntime.sanitizeImage(verified.data, verified.detectedMimeType);
      // Supabase lacks GCS's atomic create-generation precondition. Each
      // processing claim therefore owns a different server-only final key;
      // stale writers can never replace the winning claim's committed object.
      const finalObjectKey = `media/${id}/${sanitized.checksumSha256}${storage.provider === "supabase" ? `-${claim.claimToken}` : ""}.webp`;
      finalFile = storage.file(finalObjectKey);
      const trackedFinalObject = await context.pool.query(
        `UPDATE media_assets
            SET metadata=jsonb_set(
                  metadata,
                  '{processing}',
                  COALESCE(metadata->'processing','{}'::jsonb) || jsonb_build_object(
                    'finalObjectKey',$3::text,'trackedAt',now()::text
                  ),
                  true
                ) || CASE WHEN $5::boolean THEN jsonb_build_object(
                  'storageCleanup', COALESCE(metadata->'storageCleanup','{}'::jsonb) || jsonb_build_object(
                    'pendingFinalObjectKeys', COALESCE(metadata->'storageCleanup'->'pendingFinalObjectKeys','[]'::jsonb)
                      || jsonb_build_array($3::text)
                  )
                ) ELSE '{}'::jsonb END
          WHERE id=$1 AND owner_id=$2 AND status='PROCESSING'
            AND metadata->'processing'->>'claimToken'=$4
            AND (NOT $5::boolean OR jsonb_array_length(COALESCE(metadata->'storageCleanup'->'pendingFinalObjectKeys','[]'::jsonb)) < 64)`,
        [id, ownerId, finalObjectKey, claim.claimToken, storage.provider === "supabase"],
      );
      if (trackedFinalObject.rowCount !== 1) throw conflict("첨부 처리 권한이 이미 변경되었습니다.");
      const finalInfo = await storage.saveFinal(finalObjectKey, sanitized.data, { mediaId: id, checksumSha256: sanitized.checksumSha256 });
      const finalGeneration = verifiedFinalGeneration(finalInfo, sanitized, id, storage.provider);

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
          return { kind: "READY" as const, replay: true, body, cleanupFinal: currentAsset.object_key !== finalObjectKey };
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
                    || CASE WHEN $12::boolean THEN jsonb_build_object(
                      'storageCleanup', COALESCE(metadata->'storageCleanup','{}'::jsonb) || jsonb_build_object(
                        'pendingFinalObjectKeys', COALESCE(metadata->'storageCleanup'->'pendingFinalObjectKeys','[]'::jsonb) - $4::text
                      )
                    ) ELSE '{}'::jsonb END
            WHERE id=$1 AND owner_id=$2 AND status='PROCESSING'
              AND metadata->'processing'->>'claimToken'=$11
            RETURNING id`,
          [
            id,
            ownerId,
            sanitized.mimeType,
            finalObjectKey,
            storage.provider === "gcs" ? finalGeneration : null,
            sanitized.checksumSha256,
            sanitized.byteSize,
            sanitized.width,
            sanitized.height,
            JSON.stringify({
              storage: { ...storage.location, version: finalGeneration },
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
            storage.provider === "supabase",
          ],
        );
        if (!updated.rowCount) throw badRequest("첨부 상태가 이미 변경되었습니다.");
        const body = { mediaId: id, status: "READY" as const, mimeType: sanitized.mimeType };
        if (catalogUpload) {
          await writeAdminAudit(client, request, request.actor!, {
            action: "CATALOG_MEDIA_UPLOAD_COMPLETED",
            targetType: "MEDIA",
            targetId: id,
            before: { status: claim.previousStatus, purpose: claim.asset.purpose },
            after: body,
          });
        }
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
        await completeIdempotency(client, claim.idempotencyId, {
          statusCode: 200,
          body,
          resourceType: "MEDIA",
          resourceId: id,
        });
        return { kind: "READY" as const, replay: false, body, cleanupFinal: false };
      });
      if (result.kind === "ACCOUNT_DELETION_APPROVED") {
        throw accountDeletionApprovedError();
      }
      await deleteObjectsBestEffort([stagingFile]);
      if (result.cleanupFinal && finalFile) await deleteObjectsBestEffort([finalFile]);
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
        await deleteObjectsBestEffort([stagingFile, ...(finalFile && finalFile.name !== settlement.objectKey ? [finalFile] : [])]);
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
      if (settlement.kind === "SUPERSEDED" && storage.provider === "supabase" && finalFile) {
        await deleteObjectsBestEffort([finalFile]);
      }
      throw error;
    }
    } finally {
      releaseProcessingSlot();
    }
  };
  app.post("/v1/media/:mediaId/complete", {
    preHandler: context.auth.requireUser,
    config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
  }, completeUpload);
  app.post("/v1/admin/catalog-media/:mediaId/complete", {
    preHandler: context.auth.requirePermission("catalog.write"),
    config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
  }, completeUpload);

  const deleteMedia = async (request: FastifyRequest, reply: FastifyReply) => {
    const catalogDelete = request.routeOptions.url === "/v1/admin/catalog-media/:mediaId";
    const id = mediaId(request);
    const ownerId = request.actor!.userId;
    const key = idempotencyKey(request.headers);
    const adminMutation = catalogDelete ? adminMutationHeaders(request) : null;
    const hash = catalogDelete
      ? requestHash({
          actorId: ownerId,
          operation: "DELETE /v1/admin/catalog-media/:mediaId",
          mediaId: id.toLocaleLowerCase("en-US"),
          reason: adminMutation!.reason,
        })
      : mediaDeleteFingerprint(ownerId, id);
    const result = await withTransaction(context.pool, async (client) => {
      await lockAccountMutation(client, ownerId);
      await lockMediaUploadOwner(client, ownerId);
      const media = await client.query<MediaRow>(
        "SELECT * FROM media_assets WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        [id, ownerId],
      );
      if (!media.rowCount) throw notFound("첨부 파일을 찾을 수 없습니다.");
      const asset = media.rows[0]!;
      if (catalogDelete ? asset.purpose !== "CATALOG" : asset.purpose === "CATALOG") {
        throw notFound("첨부 파일을 찾을 수 없습니다.");
      }
      const idem = await beginIdempotency(client, {
        actorId: ownerId,
        scope: catalogDelete ? "ADMIN_CATALOG_MEDIA_DELETE" : MEDIA_DELETE_SCOPE,
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
        throw conflict("현재 상품, 추첨 또는 배송 기록에서 사용하는 첨부 파일은 삭제할 수 없습니다.");
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
      if (catalogDelete) {
        await writeAdminAudit(client, request, request.actor!, {
          action: "CATALOG_MEDIA_DELETED",
          targetType: "MEDIA",
          targetId: id,
          before: { status: previousStatus, purpose: asset.purpose },
          after: responseBody,
        });
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
  };
  app.delete("/v1/media/:mediaId", {
    preHandler: context.auth.requireUser,
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
  }, deleteMedia);
  app.delete("/v1/admin/catalog-media/:mediaId", {
    preHandler: context.auth.requirePermission("catalog.write"),
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
  }, deleteMedia);

  app.get("/v1/media/:mediaId/url", { preHandler: context.auth.requireUser }, async (request) => signedReadUrl(context, request));
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
    return signMediaAsset(context, row.rows[0]!);
  });
  app.get("/v1/admin/media/:mediaId/url", {
    preHandler: context.auth.requireAdmin,
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const actor = request.actor!;
    if (!isAdminRole(actor.role)) throw forbidden();
    const id = mediaId(request);
    const row = await context.pool.query<MediaRow>("SELECT * FROM media_assets WHERE id=$1 AND status='READY'", [id]);
    if (!row.rowCount) throw notFound("사용 가능한 첨부 파일을 찾을 수 없습니다.");
    const asset = row.rows[0]!;
    const permission = adminMediaReadPermission(asset.purpose);
    const allowed = await context.pool.query(
      "SELECT 1 FROM admin_role_permissions WHERE role=$1 AND permission_code=$2",
      [actor.role, permission],
    );
    if (!allowed.rowCount) throw forbidden();
    // Private customer media leaves the service boundary through this URL, so
    // every issuance is recorded before the signature is created.
    await withTransaction(context.pool, async (client) => {
      const identity = await client.query<{ ip_address: string | null; user_agent: string | null }>(
        `SELECT host(ip_address) AS ip_address,user_agent FROM sessions
         WHERE id=$1 AND user_id=$2 AND session_kind='ADMIN'
         FOR SHARE`,
        [actor.sessionId, actor.userId],
      );
      if (!identity.rowCount) throw forbidden("유효한 관리자 세션의 감사 식별 정보를 확인할 수 없습니다.");
      await client.query(
        `INSERT INTO admin_audit_logs
          (admin_id,action,target_type,target_id,reason,request_id,idempotency_key,metadata,ip_address,user_agent)
         VALUES ($1,'MEDIA_SIGNED_URL_ISSUED','MEDIA',$2,$3,$4,$5,$6,$7,$8)`,
        [
          actor.userId,
          id,
          ADMIN_MEDIA_READ_AUDIT_REASON,
          request.id,
          `read:${request.id}`,
          JSON.stringify({ purpose: asset.purpose, ownerId: asset.owner_id, permission }),
          identity.rows[0]!.ip_address,
          identity.rows[0]!.user_agent,
        ],
      );
    });
    reply.header("cache-control", "no-store");
    return signMediaAsset(context, asset);
  });
}
