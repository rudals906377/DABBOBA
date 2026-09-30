import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createMigrationDatabasePool } from "./index.js";

const migrationDatabaseUrl = process.env.DATABASE_MIGRATION_URL;
const OLD_PREFIX = "https://yxkmvgfruphgghowzvmo.supabase.co/functions/v1/dabboba-api/v1/catalog/media/";
const NEW_PREFIX = "https://rconfxsykttfvznakile.supabase.co/functions/v1/dabboba-api/v1/catalog/media/";

test("0081 rebases only DRAFT prize snapshots whose sole drift is the 0067 media host", {
  skip: !migrationDatabaseUrl,
  timeout: 60_000,
}, async () => {
  const migration = await readFile(
    new URL("../migrations/0081_draft_draw_snapshot_media_rebase.sql", import.meta.url),
    "utf8",
  );
  const pool = createMigrationDatabasePool(migrationDatabaseUrl!, "dabboba-draft-snapshot-rebase-integration");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const ownerId = randomUUID();
    const ipId = `draft-rebase-${suffix}`;
    const drawProductId = `draft-rebase-gacha-${suffix}`;
    const prizeAId = `draft-rebase-prize-a-${suffix}`;
    const prizeBId = `draft-rebase-prize-b-${suffix}`;
    const mediaA = randomUUID();
    const mediaB = randomUUID();
    const activeVersionId = randomUUID();
    const draftVersionId = randomUUID();
    const staleDraftVersionId = randomUUID();
    const activeEntryId = randomUUID();
    const draftEntryId = randomUUID();
    const staleDraftEntryId = randomUUID();

    await client.query(
      "INSERT INTO users(id,email,nickname,role,status) VALUES($1,$2,$3,'ADMIN','ACTIVE')",
      [ownerId, `draft-rebase-${suffix}@example.test`, `초안 이미지 ${suffix}`],
    );
    await client.query(
      "INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$4)",
      [ipId, ipId, `초안 이미지 ${suffix}`, `Draft rebase ${suffix}`],
    );
    await client.query(
      `INSERT INTO catalog_products(id,sku,ip_id,category,name,price,is_prize_only,image_url)
       VALUES
         ($1,$2,$3,'gacha',$4,1000,false,NULL),
         ($5,$6,$3,'figure',$7,0,true,$8),
         ($9,$10,$3,'figure',$11,0,true,$12)`,
      [
        drawProductId, `DRAFT-REBASE-GACHA-${suffix}`.toUpperCase(), ipId, `초안 가챠 ${suffix}`,
        prizeAId, `DRAFT-REBASE-A-${suffix}`.toUpperCase(), `초안 A상 ${suffix}`, `${OLD_PREFIX}${mediaA}/image`,
        prizeBId, `DRAFT-REBASE-B-${suffix}`.toUpperCase(), `초안 B상 ${suffix}`, `${OLD_PREFIX}${mediaB}/image`,
      ],
    );
    await client.query("INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,0,0)", [drawProductId]);
    await client.query(
      "INSERT INTO draw_probability_versions(id,product_id,version) VALUES($1,$4,1),($2,$4,2),($3,$4,3)",
      [activeVersionId, draftVersionId, staleDraftVersionId, drawProductId],
    );
    const insertEntry = (entryId: string, versionId: string, prizeId: string) => client.query(
      `INSERT INTO draw_pool_entries(
         id,probability_version_id,prize_product_id,rarity,weight,initial_quantity,remaining_quantity,
         prize_name_snapshot,prize_image_url_snapshot,prize_sku_snapshot,prize_ip_id_snapshot,prize_category_snapshot
       )
       SELECT $1::uuid,$2::uuid,product.id,'A',1,NULL,NULL,product.name,product.image_url,
              product.sku,product.ip_id,product.category
         FROM catalog_products AS product WHERE product.id=$3::text`,
      [entryId, versionId, prizeId],
    );
    await insertEntry(activeEntryId, activeVersionId, prizeAId);
    await insertEntry(draftEntryId, draftVersionId, prizeAId);
    await insertEntry(staleDraftEntryId, staleDraftVersionId, prizeBId);
    await client.query(
      "UPDATE draw_probability_versions SET status='ACTIVE',published_by=$2,published_at=now() WHERE id=$1",
      [activeVersionId, ownerId],
    );

    // Reproduce 0067 on the prize products; prize B also changed its name after its draft was made.
    await client.query(
      `UPDATE catalog_products
          SET image_url=$2 || substring(image_url FROM char_length($1) + 1),
              name=CASE WHEN id=$4 THEN name || ' 개정' ELSE name END
        WHERE id IN ($3,$4)`,
      [OLD_PREFIX, NEW_PREFIX, prizeAId, prizeBId],
    );

    await client.query(migration);
    // The migration is safe to re-run.
    await client.query(migration);

    const snapshots = await client.query<{ id: string; prize_image_url_snapshot: string }>(
      "SELECT id,prize_image_url_snapshot FROM draw_pool_entries WHERE id = ANY($1::uuid[])",
      [[activeEntryId, draftEntryId, staleDraftEntryId]],
    );
    const byId = new Map(snapshots.rows.map((row) => [row.id, row.prize_image_url_snapshot]));
    assert.equal(byId.get(activeEntryId), `${OLD_PREFIX}${mediaA}/image`, "ACTIVE snapshots stay immutable");
    assert.equal(byId.get(draftEntryId), `${NEW_PREFIX}${mediaA}/image`, "a host-only DRAFT drift is rebased");
    assert.equal(byId.get(staleDraftEntryId), `${OLD_PREFIX}${mediaB}/image`, "a genuinely stale DRAFT is left alone");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
});
