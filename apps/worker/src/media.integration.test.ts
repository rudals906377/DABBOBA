import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createDatabasePool } from "@dabboba/db";
import { cleanupMediaBatch, type MediaStore } from "./media.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;

test(
  "media cleanup removes replayed staging and failed final objects without deleting READY media rows",
  { skip: !databaseUrl },
  async (t) => {
    const pool = createDatabasePool(databaseUrl!, "dabboba-worker-media-integration");
    t.after(async () => pool.end());
    const suffix = randomUUID();
    const user = await pool.query<{ id: string }>(
      "INSERT INTO users(email,nickname) VALUES($1,'미디어 정리') RETURNING id",
      [`worker-media-${suffix}@example.test`],
    );
    const ownerId = user.rows[0]!.id;
    const readyId = randomUUID();
    const readyStagingKey = `uploads/${ownerId}/${readyId}/ready.png`;
    const readyFinalKey = `media/${readyId}/${"a".repeat(64)}.webp`;
    await pool.query(
      `INSERT INTO media_assets
        (id,owner_id,purpose,object_key,object_generation,original_filename,declared_mime_type,
         detected_mime_type,byte_size,checksum_sha256,status,width,height,metadata)
       VALUES($1,$2,'POST',$3,1,'ready.png','image/png','image/webp',100,$4,'READY',10,10,$5::jsonb)`,
      [readyId, ownerId, readyFinalKey, "a".repeat(64), JSON.stringify({ original: { stagingObjectKey: readyStagingKey } })],
    );

    const rejectedId = randomUUID();
    const rejectedStagingKey = `uploads/${ownerId}/${rejectedId}/rejected.png`;
    const rejectedFinalKey = `media/${rejectedId}/${"b".repeat(64)}.webp`;
    await pool.query(
      `INSERT INTO media_assets
        (id,owner_id,purpose,object_key,original_filename,declared_mime_type,
         byte_size,checksum_sha256,status,metadata)
       VALUES($1,$2,'POST',$3,'rejected.png','image/png',100,$4,'REJECTED',$5::jsonb)`,
      [
        rejectedId,
        ownerId,
        rejectedStagingKey,
        "c".repeat(64),
        JSON.stringify({ processingFailure: { code: "MEDIA_PROCESSING_FAILED", finalObjectKey: rejectedFinalKey } }),
      ],
    );

    const deletedKeys: string[] = [];
    const mediaStore: MediaStore = {
      async deleteObject(objectKey) {
        deletedKeys.push(objectKey);
        return "deleted";
      },
    };
    await cleanupMediaBatch(
      pool,
      mediaStore,
      { batchSize: 1_000, pendingTtlMinutes: 5, rejectedTtlHours: 24 },
      new Date(Date.now() + 10 * 60_000),
    );

    assert.equal(deletedKeys.includes(readyStagingKey), true);
    assert.equal(deletedKeys.includes(readyFinalKey), false);
    assert.equal(deletedKeys.includes(rejectedStagingKey), true);
    assert.equal(deletedKeys.includes(rejectedFinalKey), true);
    const rows = await pool.query<{ id: string; status: string; staging_cleanup_at: string | null }>(
      `SELECT id,status,metadata->'stagingCleanup'->>'completedAt' AS staging_cleanup_at
         FROM media_assets WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [[readyId, rejectedId]],
    );
    const ready = rows.rows.find((row) => row.id === readyId)!;
    const rejected = rows.rows.find((row) => row.id === rejectedId)!;
    assert.equal(ready.status, "READY");
    assert.ok(ready.staging_cleanup_at);
    assert.equal(rejected.status, "DELETED");
  },
);
