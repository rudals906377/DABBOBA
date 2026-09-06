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

    // An old claim may write again even after a successful delete. Each new
    // sweep below is restricted to this test's IDs, using the real SQL predicate.
    const orphanReadyId = randomUUID();
    const orphanDeletedId = randomUUID();
    const activeId = randomUUID();
    const invalidArrayId = randomUUID();
    const foreignOnlyId = randomUUID();
    fixtureMediaIds.push(orphanReadyId, orphanDeletedId, activeId, invalidArrayId, foreignOnlyId);
    const winner = `media/${orphanReadyId}/${"e".repeat(64)}-${randomUUID()}.webp`;
    const readyOrphan = `media/${orphanReadyId}/${"f".repeat(64)}-${randomUUID()}.webp`;
    const deletedOrphan = `media/${orphanDeletedId}/${"a".repeat(64)}-${randomUUID()}.webp`;
    const activeFinal = `media/${activeId}/${"b".repeat(64)}-${randomUUID()}.webp`;
    const foreignKey = `media/${randomUUID()}/${"c".repeat(64)}-${randomUUID()}.webp`;
    const checkTime = new Date(Date.now() + 60_000);
    const completedAt = new Date("1999-01-01T00:00:00.000Z").toISOString();
    const pendingList = [readyOrphan, readyOrphan, winner, foreignKey, "uploads/invalid", 123];
    for (const fixture of [
      { id: orphanReadyId, status: "READY", key: winner, pending: pendingList, updatedAt: new Date("1800-01-01T00:00:00Z") },
      { id: orphanDeletedId, status: "DELETED", key: deletedOrphan, pending: [deletedOrphan], updatedAt: new Date("1800-01-01T00:00:00Z") },
      { id: activeId, status: "PROCESSING", key: activeFinal, pending: [activeFinal], updatedAt: new Date(checkTime.getTime() - 6 * 60_000) },
      { id: invalidArrayId, status: "READY", key: `media/${invalidArrayId}/${"d".repeat(64)}.webp`, pending: readyOrphan, updatedAt: new Date("1700-01-01T00:00:00Z") },
      { id: foreignOnlyId, status: "READY", key: `media/${foreignOnlyId}/${"d".repeat(64)}.webp`, pending: [foreignKey, 42, null], updatedAt: new Date("1700-01-01T00:00:00Z") },
    ]) {
      await fixturePool.query(
        `INSERT INTO media_assets
          (id,owner_id,purpose,object_key,original_filename,declared_mime_type,
           byte_size,checksum_sha256,status,metadata,created_at,updated_at)
         VALUES($1,$2,'POST',$3,'orphan.png','image/png',100,$4,$5,$6::jsonb,$7,$7)`,
        [fixture.id, ownerId, fixture.key, "a".repeat(64), fixture.status, JSON.stringify({
          storage: { provider: "supabase", bucket: "worker-fixture", version: randomUUID() },
          ...(fixture.status !== "PROCESSING" ? { cleanup: { completedAt } } : {}),
          stagingCleanup: { completedAt },
          storageCleanup: { pendingFinalObjectKeys: fixture.pending },
        }), fixture.updatedAt],
      );
    }
    const objects = new Set([winner, readyOrphan, deletedOrphan, activeFinal, foreignKey]);
    const orphanDeletions: string[] = [];
    const orphanStore: MediaStore = {
      async deleteObject(key, metadata) {
        assert.ok(key === readyOrphan || key === deletedOrphan, `unexpected cleanup key: ${key}`);
        assert.equal((metadata as { storage: { provider: string } }).storage.provider, "supabase");
        orphanDeletions.push(key);
        objects.delete(key);
        return "deleted";
      },
    };
    // This adds only a fixture-ID conjunct; selection, JSON validation, locking,
    // privileges and updates still execute on PostgreSQL as the actual worker.
    const candidateScope = new Proxy(workerPool, {
      get(target, property) {
        if (property === "query") return (sql: string, values: unknown[]) => {
          assert.ok(sql.includes("WHERE (metadata"));
          return target.query(
            sql.replace("WHERE (metadata", "WHERE id=ANY($9::uuid[]) AND ((metadata")
              .replace("ORDER BY updated_at,id", ") ORDER BY updated_at,id"),
            [...values, [orphanReadyId, orphanDeletedId, activeId, invalidArrayId, foreignOnlyId]],
          );
        };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const cleanupOptions = { batchSize: 2, pendingTtlMinutes: 60, rejectedTtlHours: 24 };
    assert.deepEqual(await cleanupMediaBatch(candidateScope, orphanStore, cleanupOptions, checkTime),
      { examined: 2, deleted: 2, skipped: 0 });
    assert.deepEqual(new Set(orphanDeletions), new Set([readyOrphan, deletedOrphan]));
    assert.deepEqual(objects, new Set([winner, activeFinal, foreignKey]));
    const orphanRows = await fixturePool.query<{ id: string; status: string; object_key: string; metadata: {
      storageCleanup: { checkedAt: string; pendingFinalObjectKeys: unknown[] }; cleanup: { completedAt: string };
    } }>("SELECT id,status,object_key,metadata FROM media_assets WHERE id=ANY($1::uuid[])",
    [[orphanReadyId, orphanDeletedId]]);
    const readyOrphanRow = orphanRows.rows.find((row) => row.id === orphanReadyId)!;
    assert.equal(readyOrphanRow.status, "READY");
    assert.equal(readyOrphanRow.object_key, winner);
    assert.deepEqual(readyOrphanRow.metadata.storageCleanup.pendingFinalObjectKeys, pendingList);
    for (const row of orphanRows.rows) {
      assert.equal(row.metadata.storageCleanup.checkedAt, checkTime.toISOString());
      assert.equal(row.metadata.cleanup.completedAt, completedAt);
    }

    // Use the same worker transaction and selector against only our rows here:
    // completed cleanup rows with invalid JSON or foreign keys must not starve
    // the valid candidates, and checkedAt must throttle actual repeated checks.
    const fourMinutesLater = new Date(checkTime.getTime() + 4 * 60_000);
    assert.deepEqual(await cleanupMediaBatch(candidateScope, orphanStore, cleanupOptions, fourMinutesLater),
      { examined: 0, deleted: 0, skipped: 0 });
    objects.add(readyOrphan); // A stale process resumes after the first deletion.
    const fiveMinutesLater = new Date(checkTime.getTime() + 5 * 60_000);
    assert.deepEqual(await cleanupMediaBatch(candidateScope, orphanStore, cleanupOptions, fiveMinutesLater),
      { examined: 2, deleted: 2, skipped: 0 });
    assert.deepEqual(objects, new Set([winner, activeFinal, foreignKey]));
    assert.equal(orphanDeletions.length, 4);
  },
);
