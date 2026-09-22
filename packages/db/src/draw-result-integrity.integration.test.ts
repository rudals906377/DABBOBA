import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { PoolClient } from "pg";
import { createMigrationDatabasePool } from "./index.js";

const migrationDatabaseUrl = process.env.DATABASE_MIGRATION_URL;

function isCheckViolation(error: unknown) {
  return typeof error === "object" && error !== null
    && "code" in error && error.code === "23514";
}

function replaceAt<T>(values: T[], index: number, value: T) {
  const copy = [...values];
  copy[index] = value;
  return copy;
}

test("draw result inserts are cross-checked against authoritative gacha and sealed kuji rows", {
  skip: !migrationDatabaseUrl,
  timeout: 60_000,
}, async () => {
  const pool = createMigrationDatabasePool(
    migrationDatabaseUrl!,
    "dabboba-draw-result-integrity-integration",
  );
  const client = await pool.connect();
  let savepointNumber = 0;

  const expectRejected = async (query: string, values: unknown[]) => {
    savepointNumber += 1;
    const savepoint = `draw_result_guard_${savepointNumber}`;
    await client.query(`SAVEPOINT ${savepoint}`);
    try {
      await assert.rejects(client.query(query, values), isCheckViolation);
    } finally {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    }
  };

  const expectRejectedAfter = async (
    setupQuery: string,
    setupValues: unknown[],
    insertQuery: string,
    insertValues: unknown[],
  ) => {
    savepointNumber += 1;
    const savepoint = `draw_result_guard_${savepointNumber}`;
    await client.query(`SAVEPOINT ${savepoint}`);
    try {
      await client.query(setupQuery, setupValues);
      await assert.rejects(client.query(insertQuery, insertValues), isCheckViolation);
    } finally {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    }
  };

  try {
    await client.query("BEGIN");

    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const ownerId = randomUUID();
    const otherUserId = randomUUID();
    const ipId = `result-integrity-${suffix}`;
    const gachaProductId = `result-gacha-${suffix}`;
    const kujiProductId = `result-kuji-${suffix}`;
    const prizeAId = `result-prize-a-${suffix}`;
    const prizeBId = `result-prize-b-${suffix}`;
    const gachaVersionId = randomUUID();
    const draftGachaVersionId = randomUUID();
    const kujiVersionId = randomUUID();
    const gachaPoolEntryId = randomUUID();
    const draftGachaPoolEntryId = randomUUID();
    const kujiPoolEntryId = randomUUID();

    await client.query(
      `INSERT INTO users(id,email,nickname,role,status)
       VALUES($1,$2,$3,'ADMIN','ACTIVE'),($4,$5,$6,'USER','ACTIVE')`,
      [
        ownerId,
        `draw-result-owner-${suffix}@example.test`,
        `원장 소유자 ${suffix}`,
        otherUserId,
        `draw-result-other-${suffix}@example.test`,
        `다른 사용자 ${suffix}`,
      ],
    );
    await client.query(
      "INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$4)",
      [ipId, ipId, `결과 무결성 ${suffix}`, `Result integrity ${suffix}`],
    );
    await client.query(
      `INSERT INTO catalog_products(id,sku,ip_id,category,name,price,is_prize_only)
       VALUES
         ($1,$2,$5,'gacha',$6,1000,false),
         ($3,$4,$5,'kuji',$7,1000,false),
         ($8,$9,$5,'figure',$10,0,true),
         ($11,$12,$5,'figure',$13,0,true)`,
      [
        gachaProductId,
        `RESULT-GACHA-${suffix}`.toUpperCase(),
        kujiProductId,
        `RESULT-KUJI-${suffix}`.toUpperCase(),
        ipId,
        `결과 검증 가챠 ${suffix}`,
        `결과 검증 쿠지 ${suffix}`,
        prizeAId,
        `RESULT-PRIZE-A-${suffix}`.toUpperCase(),
        `결과 검증 A상 ${suffix}`,
        prizeBId,
        `RESULT-PRIZE-B-${suffix}`.toUpperCase(),
        `결과 검증 B상 ${suffix}`,
      ],
    );
    await client.query(
      "INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,0,0),($2,0,0)",
      [gachaProductId, kujiProductId],
    );
    await client.query(
      `INSERT INTO draw_probability_versions(id,product_id,version)
       VALUES($1,$2,1),($3,$2,2),($4,$5,1)`,
      [gachaVersionId, gachaProductId, draftGachaVersionId, kujiVersionId, kujiProductId],
    );
    await client.query(
      `INSERT INTO draw_pool_entries(
         id,probability_version_id,prize_product_id,rarity,weight,
         initial_quantity,remaining_quantity,prize_name_snapshot,
         prize_image_url_snapshot,prize_sku_snapshot,prize_ip_id_snapshot,
         prize_category_snapshot
       )
       SELECT $1::uuid,$2::uuid,product.id,'A',1,NULL,NULL,product.name,product.image_url,
              product.sku,product.ip_id,product.category
         FROM catalog_products AS product WHERE product.id=$3::text
       UNION ALL
       SELECT $4::uuid,$5::uuid,product.id,'A',1,1,1,product.name,product.image_url,
              product.sku,product.ip_id,product.category
         FROM catalog_products AS product WHERE product.id=$3::text`,
      [gachaPoolEntryId, gachaVersionId, prizeAId, kujiPoolEntryId, kujiVersionId],
    );
    await client.query(
      `INSERT INTO draw_pool_entries(
         id,probability_version_id,prize_product_id,rarity,weight,
         initial_quantity,remaining_quantity,prize_name_snapshot,
         prize_image_url_snapshot,prize_sku_snapshot,prize_ip_id_snapshot,
         prize_category_snapshot
       )
       SELECT $1::uuid,$2::uuid,product.id,'A',1,NULL,NULL,product.name,product.image_url,
              product.sku,product.ip_id,product.category
         FROM catalog_products AS product WHERE product.id=$3::text`,
      [draftGachaPoolEntryId, draftGachaVersionId, prizeAId],
    );
    await client.query(
      "INSERT INTO kuji_decks(probability_version_id,total_slots) VALUES($1,1)",
      [kujiVersionId],
    );
    await client.query(
      `INSERT INTO kuji_deck_tiers(probability_version_id,pool_entry_id,tier_code,tier_rank)
       VALUES($1,$2,'A',0)`,
      [kujiVersionId, kujiPoolEntryId],
    );
    const assignment = await client.query<{ id: string; slot_number: number }>(
      `INSERT INTO kuji_slot_assignments(probability_version_id,slot_number,pool_entry_id)
       VALUES($1,1,$2) RETURNING id,slot_number`,
      [kujiVersionId, kujiPoolEntryId],
    );
    await client.query(
      `UPDATE draw_probability_versions
          SET status='ACTIVE',published_by=$3,published_at=now()
        WHERE id IN ($1,$2)`,
      [gachaVersionId, kujiVersionId, ownerId],
    );

    const createPaidEntitlement = async (
      productId: string,
      category: "gacha" | "kuji",
      probabilityVersionId: string,
    ) => {
      const order = await client.query<{ id: string }>(
        `INSERT INTO orders(user_id,status,subtotal,total,paid_at)
         VALUES($1,'PAID',1000,1000,now()) RETURNING id`,
        [ownerId],
      );
      const line = await client.query<{ id: string }>(
        `INSERT INTO order_lines(
           order_id,product_id,product_name_snapshot,category_snapshot,
           probability_version_id,unit_price,quantity,line_total
         ) VALUES($1,$2,$3,$4,$5,1000,1,1000) RETURNING id`,
        [order.rows[0]!.id, productId, `결과 검증 ${category}`, category, probabilityVersionId],
      );
      const entitlement = await client.query<{ id: string }>(
        `INSERT INTO draw_entitlements(
           order_line_id,user_id,product_id,probability_version_id
         ) VALUES($1,$2,$3,$4) RETURNING id`,
        [line.rows[0]!.id, ownerId, productId, probabilityVersionId],
      );
      return {
        entitlementId: entitlement.rows[0]!.id,
        lineId: line.rows[0]!.id,
        orderId: order.rows[0]!.id,
      };
    };

    const gacha = await createPaidEntitlement(gachaProductId, "gacha", gachaVersionId);
    const draftGacha = await createPaidEntitlement(gachaProductId, "gacha", draftGachaVersionId);
    const kuji = await createPaidEntitlement(kujiProductId, "kuji", kujiVersionId);

    const createInventory = async (
      owner: string,
      product: string,
      sourceType: "GACHA" | "KUJI",
      sourceId: string,
    ) => {
      const inventory = await client.query<{ id: string }>(
        `INSERT INTO inventory_units(owner_id,product_id,source_type,source_id)
         VALUES($1,$2,$3,$4) RETURNING id`,
        [owner, product, sourceType, sourceId],
      );
      return inventory.rows[0]!.id;
    };

    const validGachaInventoryId = await createInventory(
      ownerId,
      prizeAId,
      "GACHA",
      gacha.entitlementId,
    );
    const gachaInsert = `INSERT INTO draw_results(
      entitlement_id,user_id,product_id,pool_entry_id,prize_product_id,
      prize_inventory_unit_id,probability_version,selection_algorithm,
      entropy_hex,entropy_digest,roll_value,total_weight,selection_snapshot
    ) VALUES($1,$2,$3,$4,$5,$6,$7,'SHA256_REJECTION_V1',$8,$9,0,1,'[]'::jsonb)`;
    const validGachaValues = [
      gacha.entitlementId,
      ownerId,
      gachaProductId,
      gachaPoolEntryId,
      prizeAId,
      validGachaInventoryId,
      1,
      "0".repeat(64),
      "1".repeat(64),
    ];

    const draftGachaInventoryId = await createInventory(
      ownerId,
      prizeAId,
      "GACHA",
      draftGacha.entitlementId,
    );
    await expectRejected(gachaInsert, [
      draftGacha.entitlementId,
      ownerId,
      gachaProductId,
      draftGachaPoolEntryId,
      prizeAId,
      draftGachaInventoryId,
      2,
      "0".repeat(64),
      "1".repeat(64),
    ]);

    await expectRejected(gachaInsert, replaceAt(validGachaValues, 1, otherUserId));
    await expectRejected(gachaInsert, replaceAt(validGachaValues, 2, kujiProductId));
    await expectRejected(gachaInsert, replaceAt(validGachaValues, 3, kujiPoolEntryId));
    await expectRejected(gachaInsert, replaceAt(validGachaValues, 4, prizeBId));
    await expectRejected(gachaInsert, replaceAt(validGachaValues, 6, 2));
    await expectRejectedAfter(
      "UPDATE draw_entitlements SET status='CANCELLED' WHERE id=$1",
      [gacha.entitlementId],
      gachaInsert,
      validGachaValues,
    );
    await expectRejectedAfter(
      "UPDATE orders SET user_id=$2 WHERE id=$1",
      [gacha.orderId, otherUserId],
      gachaInsert,
      validGachaValues,
    );
    await expectRejectedAfter(
      "UPDATE orders SET status='CANCELLED' WHERE id=$1",
      [gacha.orderId],
      gachaInsert,
      validGachaValues,
    );
    await expectRejectedAfter(
      "UPDATE order_lines SET product_id=$2 WHERE id=$1",
      [gacha.lineId, kujiProductId],
      gachaInsert,
      validGachaValues,
    );
    await expectRejectedAfter(
      "UPDATE order_lines SET probability_version_id=$2 WHERE id=$1",
      [gacha.lineId, kujiVersionId],
      gachaInsert,
      validGachaValues,
    );
    await expectRejectedAfter(
      "UPDATE order_lines SET category_snapshot='kuji' WHERE id=$1",
      [gacha.lineId],
      gachaInsert,
      validGachaValues,
    );
    await expectRejectedAfter(
      "UPDATE inventory_units SET status='SHIPPING' WHERE id=$1",
      [validGachaInventoryId],
      gachaInsert,
      validGachaValues,
    );

    const wrongOwnerInventoryId = await createInventory(
      otherUserId,
      prizeAId,
      "GACHA",
      gacha.entitlementId,
    );
    await expectRejected(gachaInsert, replaceAt(validGachaValues, 5, wrongOwnerInventoryId));
    const wrongProductInventoryId = await createInventory(
      ownerId,
      prizeBId,
      "GACHA",
      gacha.entitlementId,
    );
    await expectRejected(gachaInsert, replaceAt(validGachaValues, 5, wrongProductInventoryId));
    const wrongSourceInventoryId = await createInventory(
      ownerId,
      prizeAId,
      "KUJI",
      gacha.entitlementId,
    );
    await expectRejected(gachaInsert, replaceAt(validGachaValues, 5, wrongSourceInventoryId));
    const wrongSourceIdInventoryId = await createInventory(
      ownerId,
      prizeAId,
      "GACHA",
      randomUUID(),
    );
    await expectRejected(gachaInsert, replaceAt(validGachaValues, 5, wrongSourceIdInventoryId));
    await client.query(gachaInsert, validGachaValues);

    await client.query("INSERT INTO kuji_rooms(product_id) VALUES($1)", [kujiProductId]);
    const roomEntry = await client.query<{ id: string }>(
      `INSERT INTO kuji_room_entries(product_id,user_id,order_id,state,resolved_at)
       VALUES($1,$2,$3,'EXPIRED',now()) RETURNING id`,
      [kujiProductId, ownerId, kuji.orderId],
    );
    const binding = await client.query<{ id: string }>(
      `INSERT INTO kuji_slot_bindings(slot_assignment_id,entitlement_id,room_entry_id)
       VALUES($1,$2,$3) RETURNING id`,
      [assignment.rows[0]!.id, kuji.entitlementId, roomEntry.rows[0]!.id],
    );
    const validKujiInventoryId = await createInventory(
      ownerId,
      prizeAId,
      "KUJI",
      kuji.entitlementId,
    );
    const kujiInsert = `INSERT INTO draw_results(
      entitlement_id,user_id,product_id,pool_entry_id,prize_product_id,
      prize_inventory_unit_id,probability_version,selection_algorithm,
      entropy_hex,entropy_digest,roll_value,total_weight,selection_snapshot,
      kuji_slot_binding_id
    ) VALUES($1,$2,$3,$4,$5,$6,1,'KUJI_SEALED_SLOT_V1',NULL,NULL,NULL,NULL,$7,$8)`;
    const exactSnapshot = JSON.stringify([{
      slotId: assignment.rows[0]!.id,
      slotNumber: Number(assignment.rows[0]!.slot_number),
    }]);
    const kujiValues = [
      kuji.entitlementId,
      ownerId,
      kujiProductId,
      kujiPoolEntryId,
      prizeAId,
      validKujiInventoryId,
      exactSnapshot,
      binding.rows[0]!.id,
    ];
    await expectRejected(
      kujiInsert,
      replaceAt(kujiValues, 6, JSON.stringify([{
        slotId: assignment.rows[0]!.id,
        slotNumber: Number(assignment.rows[0]!.slot_number) + 1,
      }])),
    );
    await expectRejected(
      kujiInsert,
      replaceAt(kujiValues, 6, JSON.stringify([{
        slotId: randomUUID(),
        slotNumber: Number(assignment.rows[0]!.slot_number),
      }])),
    );
    await expectRejected(kujiInsert, replaceAt(kujiValues, 7, randomUUID()));
    await client.query(kujiInsert, kujiValues);

    const consumedBinding = await client.query<{ state: string }>(
      "SELECT state FROM kuji_slot_bindings WHERE id=$1",
      [binding.rows[0]!.id],
    );
    assert.deepEqual(consumedBinding.rows, [{ state: "CONSUMED" }]);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
});
