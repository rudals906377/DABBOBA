import type { DatabasePool } from "@dabboba/db";
import { withTransaction } from "@dabboba/db";
import type { Logger } from "./logger.js";

export const MEDIA_STAGING_OBJECT_KEY_PATTERN = String.raw`^uploads/[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$`;
const MEDIA_STAGING_OBJECT_KEY_REGEX = new RegExp(MEDIA_STAGING_OBJECT_KEY_PATTERN);
const UUID_PATTERN = String.raw`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`;
export const MEDIA_FINAL_OBJECT_KEY_PATTERN = String.raw`^media/${UUID_PATTERN}/[0-9a-f]{64}(-${UUID_PATTERN})?\.webp$`;
const MEDIA_FINAL_OBJECT_KEY_REGEX = new RegExp(MEDIA_FINAL_OBJECT_KEY_PATTERN);
const CLEANUP_CHECK_TIME_PATTERN = String.raw`^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$`;
const CLEANUP_CHECK_TIME_REGEX = new RegExp(CLEANUP_CHECK_TIME_PATTERN);
export const MEDIA_ORPHAN_RECHECK_MS = 5 * 60_000;

export type MediaStore = {
  deleteObject(objectKey: string, metadata?: unknown): Promise<"deleted" | "skipped">;
};

type MediaRow = {
  id: string;
  owner_id: string;
  object_key: string;
  status: "PENDING_UPLOAD" | "PROCESSING" | "READY" | "REJECTED" | "DELETED";
  metadata: Record<string, unknown>;
  updated_at: Date;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function mediaCleanupObjectKeys(objectKey: string, metadata: Record<string, unknown>): string[] {
  const processing = record(metadata.processing);
  const processingFailure = record(metadata.processingFailure);
  const finalObjectKey = processing?.finalObjectKey ?? processingFailure?.finalObjectKey;
  const keys = [objectKey];
  if (
    typeof finalObjectKey === "string"
    && /^media\/[0-9a-f-]{36}\/[0-9a-f]{64}(?:-[0-9a-f-]{36})?\.webp$/.test(finalObjectKey)
  ) {
    keys.push(finalObjectKey);
  }
  return [...new Set(keys)];
}

export function mediaNeedsImmediateCleanup(metadata: Record<string, unknown>): boolean {
  return typeof metadata.uploadIntentExpiredAt === "string" || record(metadata.processingFailure) !== null;
}

export function mediaPendingFinalObjectKeys(
  mediaId: string,
  objectKey: string,
  status: string,
  metadata: Record<string, unknown>,
): string[] {
  const pending = record(metadata.storageCleanup)?.pendingFinalObjectKeys;
  if (!Array.isArray(pending)) return [];
  return [...new Set(pending.filter((key): key is string => (
    typeof key === "string"
    && MEDIA_FINAL_OBJECT_KEY_REGEX.test(key)
    && key.startsWith(`media/${mediaId}/`)
    && (status !== "READY" || key !== objectKey)
  )))];
}

export function isMediaOrphanCleanupDue(
  status: string,
  updatedAt: Date,
  metadata: Record<string, unknown>,
  now: Date,
  pendingTtlMinutes: number,
  rejectedTtlHours: number,
  hasPendingReadyStaging = false,
): boolean {
  // A metadata update advances updated_at. Wait for ordinary retention first so
  // rechecks cannot keep postponing a pending/rejected row's terminal cleanup.
  if (status !== "READY" && status !== "DELETED"
    && !isMediaCleanupCandidate(status, updatedAt, now, pendingTtlMinutes, rejectedTtlHours,
      mediaNeedsImmediateCleanup(metadata))) return false;
  if (status === "READY" && hasPendingReadyStaging
    && now.getTime() - updatedAt.getTime() < pendingTtlMinutes * 60_000) return false;
  const checkedAt = record(metadata.storageCleanup)?.checkedAt;
  let lastChecked = updatedAt.getTime();
  if (checkedAt !== undefined && checkedAt !== null) {
    if (typeof checkedAt !== "string" || !CLEANUP_CHECK_TIME_REGEX.test(checkedAt)) return false;
    const parsed = Date.parse(checkedAt);
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== checkedAt) return false;
    lastChecked = Math.max(lastChecked, parsed);
  }
  return now.getTime() - lastChecked >= MEDIA_ORPHAN_RECHECK_MS;
}

export function mediaReadyStagingObjectKey(
  metadata: Record<string, unknown>,
  ownerId: string,
  mediaId: string,
): string | null {
  const original = record(metadata.original);
  const stagingObjectKey = original?.stagingObjectKey;
  return typeof stagingObjectKey === "string"
    && MEDIA_STAGING_OBJECT_KEY_REGEX.test(stagingObjectKey)
    && stagingObjectKey.startsWith(`uploads/${ownerId}/${mediaId}/`)
    ? stagingObjectKey
    : null;
}

export function isMediaCleanupCandidate(
  status: string,
  updatedAt: Date,
  now: Date,
  pendingTtlMinutes: number,
  rejectedTtlHours: number,
  immediateCleanup = false,
): boolean {
  const ageMs = now.getTime() - updatedAt.getTime();
  if (status === "PENDING_UPLOAD" || status === "PROCESSING") return ageMs >= pendingTtlMinutes * 60_000;
  if (status === "REJECTED" && immediateCleanup) return true;
  if (status === "REJECTED" || status === "DELETED") return ageMs >= rejectedTtlHours * 3_600_000;
  return false;
}

export class DisabledMediaStore implements MediaStore {
  constructor(private readonly logger: Logger) {}

  async deleteObject(objectKey: string): Promise<"skipped"> {
    this.logger.warn({ objectKey, mediaCleanup: "not_configured" }, "Media cleanup skipped because its storage is not configured");
    return "skipped";
  }
}

export async function cleanupMediaBatch(
  pool: DatabasePool,
  mediaStore: MediaStore,
  options: { batchSize: number; pendingTtlMinutes: number; rejectedTtlHours: number },
  now = new Date(),
  shouldContinue: () => boolean = () => true,
): Promise<{ examined: number; deleted: number; skipped: number }> {
  if (!shouldContinue()) return { examined: 0, deleted: 0, skipped: 0 };
  const candidates = await pool.query<{ id: string }>(
    `SELECT id
       FROM media_assets
      WHERE (metadata->'cleanup'->>'completedAt' IS NULL
        AND (
          (status IN ('PENDING_UPLOAD','PROCESSING') AND updated_at <= $1::timestamptz - ($2::int * interval '1 minute'))
          OR (status='REJECTED' AND (metadata ? 'uploadIntentExpiredAt' OR metadata ? 'processingFailure'))
          OR (status IN ('REJECTED','DELETED') AND updated_at <= $1::timestamptz - ($3::int * interval '1 hour'))
          OR (
            status='READY'
            AND metadata->'stagingCleanup'->>'completedAt' IS NULL
            AND metadata->'original'->>'stagingObjectKey' ~ $5::text
            AND metadata->'original'->>'stagingObjectKey'
                LIKE 'uploads/' || owner_id::text || '/' || id::text || '/%'
            AND updated_at <= $1::timestamptz - ($2::int * interval '1 minute')
          )
        ))
        OR (
          updated_at <= $1::timestamptz - interval '5 minutes'
          AND (
            status IN ('READY','DELETED')
            OR (status IN ('PENDING_UPLOAD','PROCESSING') AND updated_at <= $1::timestamptz - ($2::int * interval '1 minute'))
            OR (status='REJECTED' AND (
              metadata ? 'uploadIntentExpiredAt' OR metadata ? 'processingFailure'
              OR updated_at <= $1::timestamptz - ($3::int * interval '1 hour')
            ))
          )
          AND NOT (
            status='READY'
            AND metadata->'stagingCleanup'->>'completedAt' IS NULL
            AND COALESCE(metadata->'original'->>'stagingObjectKey' ~ $5::text, false)
            AND COALESCE(metadata->'original'->>'stagingObjectKey'
                LIKE 'uploads/' || owner_id::text || '/' || id::text || '/%', false)
            AND updated_at > $1::timestamptz - ($2::int * interval '1 minute')
          )
          AND (
            metadata->'storageCleanup'->>'checkedAt' IS NULL
            OR (
              metadata->'storageCleanup'->>'checkedAt' ~ $8::text
              AND metadata->'storageCleanup'->>'checkedAt' <= $7::text
            )
          )
          AND EXISTS (
            SELECT 1
              FROM jsonb_array_elements(CASE
                WHEN jsonb_typeof(metadata->'storageCleanup'->'pendingFinalObjectKeys')='array'
                THEN metadata->'storageCleanup'->'pendingFinalObjectKeys'
                ELSE '[]'::jsonb END) AS pending(value)
             WHERE jsonb_typeof(pending.value)='string'
               AND pending.value #>> '{}' ~ $6::text
               AND pending.value #>> '{}' LIKE 'media/' || id::text || '/%'
               AND (status<>'READY' OR pending.value #>> '{}' <> object_key)
          )
        )
      ORDER BY updated_at,id
      LIMIT $4`,
    [
      now,
      options.pendingTtlMinutes,
      options.rejectedTtlHours,
      options.batchSize,
      MEDIA_STAGING_OBJECT_KEY_PATTERN,
      MEDIA_FINAL_OBJECT_KEY_PATTERN,
      new Date(now.getTime() - MEDIA_ORPHAN_RECHECK_MS).toISOString(),
      CLEANUP_CHECK_TIME_PATTERN,
    ],
  );

  const summary = { examined: 0, deleted: 0, skipped: 0 };
  for (const candidate of candidates.rows) {
    if (!shouldContinue()) break;
    summary.examined += 1;
    const outcome = await withTransaction(pool, async (client) => {
      if (!shouldContinue()) throw new Error("Worker run deadline reached before media cleanup transaction");
      const locked = await client.query<MediaRow>(
        `SELECT id,owner_id,object_key,status,metadata,updated_at
           FROM media_assets
          WHERE id=$1
          FOR UPDATE`,
        [candidate.id],
      );
      if (!locked.rowCount) return "skipped" as const;
      const media = locked.rows[0]!;
      const stagingObjectKey = media.status === "READY"
        ? mediaReadyStagingObjectKey(media.metadata, media.owner_id, media.id) : null;
      let deletedOrphans = false;
      if (isMediaOrphanCleanupDue(media.status, media.updated_at, media.metadata, now,
        options.pendingTtlMinutes, options.rejectedTtlHours,
        stagingObjectKey !== null && record(media.metadata.stagingCleanup)?.completedAt == null)) {
        const pendingKeys = mediaPendingFinalObjectKeys(media.id, media.object_key, media.status, media.metadata);
        for (const objectKey of pendingKeys) {
          if (!shouldContinue()) throw new Error("Worker run deadline reached between media orphan deletions");
          if (await mediaStore.deleteObject(objectKey, media.metadata) === "skipped") return "skipped" as const;
        }
        if (pendingKeys.length) {
          if (!shouldContinue()) throw new Error("Worker run deadline reached after media orphan deletion");
          // Keep every key: a superseded process can finish writing after this
          // deletion. completedAt must never disable these periodic rechecks.
          await client.query(
            `UPDATE media_assets
                SET metadata=jsonb_set(metadata,'{storageCleanup}',
                  metadata->'storageCleanup' || jsonb_build_object('checkedAt',$2::text))
              WHERE id=$1`,
            [media.id, now.toISOString()],
          );
          deletedOrphans = true;
        }
      }
      if (record(media.metadata.cleanup)?.completedAt != null) return deletedOrphans ? "deleted" as const : "skipped" as const;
      if (media.status === "READY") {
        const ageMs = now.getTime() - media.updated_at.getTime();
        if (record(media.metadata.stagingCleanup)?.completedAt != null
          || !stagingObjectKey || ageMs < options.pendingTtlMinutes * 60_000) {
          return deletedOrphans ? "deleted" as const : "skipped" as const;
        }
        if (!shouldContinue()) throw new Error("Worker run deadline reached before media object deletion");
        const deletion = await mediaStore.deleteObject(stagingObjectKey, media.metadata);
        if (deletion === "skipped") return "skipped" as const;
        if (!shouldContinue()) throw new Error("Worker run deadline reached after media object deletion");
        await client.query(
          `UPDATE media_assets
              SET metadata=metadata || jsonb_build_object(
                'stagingCleanup',jsonb_build_object('completedAt',$2::text,'reason','post_policy_replay_window_closed')
              )
            WHERE id=$1 AND status='READY'`,
          [media.id, now.toISOString()],
        );
        return "deleted" as const;
      }
      if (!isMediaCleanupCandidate(
        media.status,
        media.updated_at,
        now,
        options.pendingTtlMinutes,
        options.rejectedTtlHours,
        mediaNeedsImmediateCleanup(media.metadata),
      )) {
        return deletedOrphans ? "deleted" as const : "skipped" as const;
      }

      for (const objectKey of mediaCleanupObjectKeys(media.object_key, media.metadata)) {
        if (!shouldContinue()) throw new Error("Worker run deadline reached between media object deletions");
        const deletion = await mediaStore.deleteObject(objectKey, media.metadata);
        if (deletion === "skipped") return "skipped" as const;
      }
      if (!shouldContinue()) throw new Error("Worker run deadline reached after media object deletion");
      await client.query(
        `UPDATE media_assets
            SET status='DELETED',
                metadata=metadata || jsonb_build_object(
                  'cleanup',jsonb_build_object('completedAt',$2::text,'previousStatus',$3::text)
                )
          WHERE id=$1`,
        [media.id, now.toISOString(), media.status],
      );
      return "deleted" as const;
    });
    summary[outcome] += 1;
  }
  return summary;
}
