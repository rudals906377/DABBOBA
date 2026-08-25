import type { DatabasePool } from "@dabboba/db";
import { withTransaction } from "@dabboba/db";
import { Storage } from "@google-cloud/storage";
import type { Logger } from "./logger.js";

export type MediaStore = {
  deleteObject(objectKey: string): Promise<"deleted" | "skipped">;
};

type MediaRow = {
  id: string;
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
    && /^media\/[0-9a-f-]{36}\/[0-9a-f]{64}\.webp$/.test(finalObjectKey)
  ) {
    keys.push(finalObjectKey);
  }
  return [...new Set(keys)];
}

export function mediaNeedsImmediateCleanup(metadata: Record<string, unknown>): boolean {
  return typeof metadata.uploadIntentExpiredAt === "string" || record(metadata.processingFailure) !== null;
}

export function mediaReadyStagingObjectKey(metadata: Record<string, unknown>): string | null {
  const original = record(metadata.original);
  const stagingObjectKey = original?.stagingObjectKey;
  return typeof stagingObjectKey === "string"
    && /^uploads\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,120}$/.test(stagingObjectKey)
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

export class GcsMediaStore implements MediaStore {
  private readonly storage: Storage;

  constructor(private readonly bucketName: string, projectId: string | null) {
    this.storage = new Storage(projectId ? { projectId } : {});
  }

  async deleteObject(objectKey: string): Promise<"deleted"> {
    await this.storage.bucket(this.bucketName).file(objectKey).delete({ ignoreNotFound: true });
    return "deleted";
  }
}

export class DisabledMediaStore implements MediaStore {
  constructor(private readonly logger: Logger) {}

  async deleteObject(objectKey: string): Promise<"skipped"> {
    this.logger.warn({ objectKey, mediaCleanup: "not_configured" }, "Media cleanup skipped because GCS is not configured");
    return "skipped";
  }
}

export async function cleanupMediaBatch(
  pool: DatabasePool,
  mediaStore: MediaStore,
  options: { batchSize: number; pendingTtlMinutes: number; rejectedTtlHours: number },
  now = new Date(),
): Promise<{ examined: number; deleted: number; skipped: number }> {
  const candidates = await pool.query<{ id: string }>(
    `SELECT id
       FROM media_assets
      WHERE metadata->'cleanup'->>'completedAt' IS NULL
        AND (
          (status IN ('PENDING_UPLOAD','PROCESSING') AND updated_at <= $1::timestamptz - ($2::int * interval '1 minute'))
          OR (status='REJECTED' AND (metadata ? 'uploadIntentExpiredAt' OR metadata ? 'processingFailure'))
          OR (status IN ('REJECTED','DELETED') AND updated_at <= $1::timestamptz - ($3::int * interval '1 hour'))
          OR (
            status='READY'
            AND metadata->'stagingCleanup'->>'completedAt' IS NULL
            AND metadata->'original'->>'stagingObjectKey' IS NOT NULL
            AND updated_at <= $1::timestamptz - ($2::int * interval '1 minute')
          )
        )
      ORDER BY updated_at,id
      LIMIT $4`,
    [now, options.pendingTtlMinutes, options.rejectedTtlHours, options.batchSize],
  );

  const summary = { examined: candidates.rows.length, deleted: 0, skipped: 0 };
  for (const candidate of candidates.rows) {
    const outcome = await withTransaction(pool, async (client) => {
      const locked = await client.query<MediaRow>(
        `SELECT id,object_key,status,metadata,updated_at
           FROM media_assets
          WHERE id=$1 AND metadata->'cleanup'->>'completedAt' IS NULL
          FOR UPDATE`,
        [candidate.id],
      );
      if (!locked.rowCount) return "skipped" as const;
      const media = locked.rows[0]!;
      if (media.status === "READY") {
        const stagingObjectKey = mediaReadyStagingObjectKey(media.metadata);
        const ageMs = now.getTime() - media.updated_at.getTime();
        if (!stagingObjectKey || ageMs < options.pendingTtlMinutes * 60_000) return "skipped" as const;
        const deletion = await mediaStore.deleteObject(stagingObjectKey);
        if (deletion === "skipped") return "skipped" as const;
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
        return "skipped" as const;
      }

      for (const objectKey of mediaCleanupObjectKeys(media.object_key, media.metadata)) {
        const deletion = await mediaStore.deleteObject(objectKey);
        if (deletion === "skipped") return "skipped" as const;
      }
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
