import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  createDatabasePool,
  createMigrationDatabasePool,
  WORKER_DATABASE_ROLE,
} from "@dabboba/db";
import { cleanupMediaBatch, type MediaStore } from "./media.js";

const migrationDatabaseUrl = process.env.DATABASE_MIGRATION_URL;
const workerDatabaseUrl = process.env.DABBOBA_WORKER_TEST_DATABASE_URL;

test(
  "media cleanup removes replayed staging and failed final objects without deleting READY media rows",
  { skip: !migrationDatabaseUrl || !workerDatabaseUrl },
  async (t) => {
    const fixturePool = createMigrationDatabasePool(
      migrationDatabaseUrl!,
      "dabboba-worker-media-fixture-integration",
    );
    const workerPool = createDatabasePool(
      workerDatabaseUrl!,
      "dabboba-worker-media-integration",
      { expectedRole: WORKER_DATABASE_ROLE },
    );
    const fixtureMediaIds: string[] = [];
    t.after(async () => {
      try {
        if (fixtureMediaIds.length) {
          await fixturePool.query(
            "DELETE FROM media_assets WHERE id=ANY($1::uuid[])",
            [fixtureMediaIds],
          ).catch(() => undefined);
        }
      } finally {
        await Promise.all([fixturePool.end(), workerPool.end()]);
      }
    });
    const identity = await workerPool.query<{ current_user: string }>("SELECT current_user");
    assert.equal(identity.rows[0]?.current_user, WORKER_DATABASE_ROLE);

    await fixturePool.query(
      `DELETE FROM media_assets
        WHERE owner_id IN (
          SELECT id FROM users WHERE email::text LIKE 'worker-media-%@example.test'
        )`,
    );
    const suffix = randomUUID();
    const user = await fixturePool.query<{ id: string }>(
      "INSERT INTO users(email,nickname) VALUES($1,'미디어 정리') RETURNING id",
      [`worker-media-${suffix}@example.test`],
    );
    const ownerId = user.rows[0]!.id;
    const fixtureBase = new Date("2000-01-01T00:00:00.000Z");
    const readyId = randomUUID();
    fixtureMediaIds.push(readyId);
    const readyStagingKey = `uploads/${ownerId}/${readyId}/ready.png`;
    const readyFinalKey = `media/${readyId}/${"a".repeat(64)}.webp`;
    await fixturePool.query(
      `INSERT INTO media_assets
        (id,owner_id,purpose,object_key,object_generation,original_filename,declared_mime_type,
         detected_mime_type,byte_size,checksum_sha256,status,width,height,metadata,created_at,updated_at)
       VALUES($1,$2,'POST',$3,1,'ready.png','image/png','image/webp',100,$4,'READY',10,10,$5::jsonb,$6,$6)`,
      [
        readyId,
        ownerId,
        readyFinalKey,
        "a".repeat(64),
        JSON.stringify({ original: { stagingObjectKey: readyStagingKey } }),
        fixtureBase,
      ],
    );

    const rejectedId = randomUUID();
    fixtureMediaIds.push(rejectedId);
    const rejectedStagingKey = `uploads/${ownerId}/${rejectedId}/rejected.png`;
    const rejectedFinalKey = `media/${rejectedId}/${"b".repeat(64)}.webp`;
    await fixturePool.query(
      `INSERT INTO media_assets
        (id,owner_id,purpose,object_key,original_filename,declared_mime_type,
         byte_size,checksum_sha256,status,metadata,created_at,updated_at)
       VALUES($1,$2,'POST',$3,'rejected.png','image/png',100,$4,'REJECTED',$5::jsonb,$6,$6)`,
      [
        rejectedId,
        ownerId,
        rejectedStagingKey,
        "c".repeat(64),
        JSON.stringify({ processingFailure: { code: "MEDIA_PROCESSING_FAILED", finalObjectKey: rejectedFinalKey } }),
        new Date(fixtureBase.getTime() + 60_000),
      ],
    );

    const malformedReadyId = randomUUID();
    fixtureMediaIds.push(malformedReadyId);
    const malformedReadyKey = `media/${malformedReadyId}/${"d".repeat(64)}.webp`;
    const malformedStagingKey = `uploads/${randomUUID()}/${randomUUID()}/malformed.png`;
    await fixturePool.query(
      `INSERT INTO media_assets
        (id,owner_id,purpose,object_key,object_generation,original_filename,declared_mime_type,
         detected_mime_type,byte_size,checksum_sha256,status,width,height,metadata,created_at,updated_at)
       VALUES($1,$2,'POST',$3,1,'malformed.png','image/png','image/webp',100,$4,'READY',10,10,$5::jsonb,$6,$6)`,
      [
        malformedReadyId,
        ownerId,
        malformedReadyKey,
        "d".repeat(64),
        JSON.stringify({ original: { stagingObjectKey: malformedStagingKey } }),
        new Date("1990-01-01T00:00:00.000Z"),
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
      workerPool,
      mediaStore,
      { batchSize: 2, pendingTtlMinutes: 5, rejectedTtlHours: 24 },
      new Date("2001-01-01T00:00:00.000Z"),
    );

    assert.equal(deletedKeys.includes(malformedStagingKey), false);
    assert.equal(deletedKeys.includes(malformedReadyKey), false);
    assert.equal(deletedKeys.includes(readyStagingKey), true);
    assert.equal(deletedKeys.includes(readyFinalKey), false);
    assert.equal(deletedKeys.includes(rejectedStagingKey), true);
    assert.equal(deletedKeys.includes(rejectedFinalKey), true);
    const rows = await fixturePool.query<{ id: string; status: string; staging_cleanup_at: string | null }>(
      `SELECT id,status,metadata->'stagingCleanup'->>'completedAt' AS staging_cleanup_at
         FROM media_assets WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [[readyId, rejectedId, malformedReadyId]],
    );
    const ready = rows.rows.find((row) => row.id === readyId)!;
    const rejected = rows.rows.find((row) => row.id === rejectedId)!;
    const malformedReady = rows.rows.find((row) => row.id === malformedReadyId)!;
    assert.equal(ready.status, "READY");
    assert.ok(ready.staging_cleanup_at);
    assert.equal(rejected.status, "DELETED");
    assert.equal(malformedReady.status, "READY");
    assert.equal(malformedReady.staging_cleanup_at, null);
  },
);
