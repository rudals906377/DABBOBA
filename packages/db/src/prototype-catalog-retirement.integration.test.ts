import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { PoolClient } from "pg";
import { createMigrationDatabasePool } from "./index.js";

const migrationDatabaseUrl = process.env.DATABASE_MIGRATION_URL;
const migration = readFile(
  new URL("../migrations/0039_retire_prototype_catalog.sql", import.meta.url),
  "utf8",
);

function isCheckViolation(error: unknown) {
  return typeof error === "object" && error !== null
    && "code" in error && error.code === "23514";
}

type DrawFixture = {
  ipId: string;
  saleProductId: string;
  prizeProductId: string;
  versionId: string;
  poolEntryId: string;
};

async function createPublisher(client: PoolClient, suffix: string) {
  const userId = randomUUID();
  await client.query(
    "INSERT INTO users(id,email,nickname) VALUES($1,$2,$3)",
    [userId, `retirement-${suffix}@example.test`, `퇴역 검증 ${suffix}`],
  );
  return userId;
}

async function createActiveDraw(
  client: PoolClient,
  input: {
    suffix: string;
    publisherId: string;
    prototypeSale: boolean;
    prototypePrize: boolean;
  },
): Promise<DrawFixture> {
  const ipId = `retirement-ip-${input.suffix}`;
  const saleProductId = `retirement-sale-${input.suffix}`;
  const prizeProductId = `retirement-prize-${input.suffix}`;

  await client.query(
    "INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1::text,$1::varchar(100),$2,$3)",
    [ipId, `퇴역 IP ${input.suffix}`, `Retirement IP ${input.suffix}`],
  );
  await client.query(
    `INSERT INTO catalog_products(
       id,sku,ip_id,category,name,price,is_prize_only,metadata
     ) VALUES
       ($1,$2,$5,'gacha',$6,1000,false,$8::jsonb),
       ($3,$4,$5,'figure',$7,0,true,$9::jsonb)`,
    [
      saleProductId,
      `RETIRE-SALE-${input.suffix}`.toUpperCase(),
      prizeProductId,
      `RETIRE-PRIZE-${input.suffix}`.toUpperCase(),
      ipId,
      `퇴역 판매 ${input.suffix}`,
      `퇴역 경품 ${input.suffix}`,
      JSON.stringify(input.prototypeSale ? { developmentFixture: true } : {}),
      JSON.stringify(input.prototypePrize ? { developmentFixture: true } : {}),
    ],
  );
  const version = await client.query<{ id: string }>(
    `INSERT INTO draw_probability_versions(product_id,version)
     VALUES($1,1) RETURNING id`,
    [saleProductId],
  );
  const poolEntry = await client.query<{ id: string }>(
    `INSERT INTO draw_pool_entries(
       probability_version_id,prize_product_id,rarity,weight,
       initial_quantity,remaining_quantity,prize_name_snapshot,
       prize_image_url_snapshot,prize_sku_snapshot,prize_ip_id_snapshot,
       prize_category_snapshot
     )
     SELECT $1,product.id,'A',1,NULL,NULL,product.name,product.image_url,
            product.sku,product.ip_id,product.category
       FROM catalog_products AS product
      WHERE product.id=$2
     RETURNING id`,
    [version.rows[0]!.id, prizeProductId],
  );
  await client.query(
    `UPDATE draw_probability_versions
        SET status='ACTIVE',published_by=$2,published_at=now()
      WHERE id=$1`,
    [version.rows[0]!.id, input.publisherId],
  );

  return {
    ipId,
    saleProductId,
    prizeProductId,
    versionId: version.rows[0]!.id,
    poolEntryId: poolEntry.rows[0]!.id,
  };
}

async function createEntitlement(
  client: PoolClient,
  input: {
    fixture: DrawFixture;
    userId: string;
    orderStatus: "PENDING_PAYMENT" | "FULFILLED";
    paymentStatus: "AUTHORIZED" | "PAID";
  },
) {
  const order = await client.query<{ id: string }>(
    `INSERT INTO orders(user_id,status,subtotal,total,paid_at)
     VALUES($1,$2,1000,1000,CASE WHEN $2='FULFILLED' THEN now() ELSE NULL END)
     RETURNING id`,
    [input.userId, input.orderStatus],
  );
  await client.query(
    `INSERT INTO payments(order_id,provider,status,amount,paid_at)
     VALUES($1,'TEST',$2,1000,CASE WHEN $2='PAID' THEN now() ELSE NULL END)`,
    [order.rows[0]!.id, input.paymentStatus],
  );
  const line = await client.query<{ id: string }>(
    `INSERT INTO order_lines(
       order_id,product_id,product_name_snapshot,category_snapshot,
       probability_version_id,unit_price,quantity,line_total
     ) VALUES($1,$2,'퇴역 판매','gacha',$3,1000,1,1000)
     RETURNING id`,
    [order.rows[0]!.id, input.fixture.saleProductId, input.fixture.versionId],
  );
  const entitlement = await client.query<{ id: string }>(
    `INSERT INTO draw_entitlements(
       order_line_id,user_id,product_id,probability_version_id
     ) VALUES($1,$2,$3,$4) RETURNING id`,
    [line.rows[0]!.id, input.userId, input.fixture.saleProductId, input.fixture.versionId],
  );
  return { orderId: order.rows[0]!.id, entitlementId: entitlement.rows[0]!.id };
}

async function expectMigrationRejected(client: PoolClient, sql: string, savepoint: string) {
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await assert.rejects(client.query(sql), isCheckViolation);
  } finally {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  }
}

test("0039 safely retires prototype draw versions and fails closed without rewriting history", {
  skip: !migrationDatabaseUrl,
  timeout: 60_000,
}, async () => {
  const sql = await migration;
  const pool = createMigrationDatabasePool(
    migrationDatabaseUrl!,
    "dabboba-prototype-retirement-integration",
  );
  const client = await pool.connect();

  try {
    // Completed weighted-draw history is preserved while the active prototype
    // version is retired before its sale and prize products are deactivated.
    await client.query("BEGIN");
    let suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    let publisherId = await createPublisher(client, suffix);
    const prototype = await createActiveDraw(client, {
      suffix,
      publisherId,
      prototypeSale: true,
      prototypePrize: true,
    });
    suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const retained = await createActiveDraw(client, {
      suffix,
      publisherId,
      prototypeSale: false,
      prototypePrize: false,
    });
    const completed = await createEntitlement(client, {
      fixture: prototype,
      userId: publisherId,
      orderStatus: "FULFILLED",
      paymentStatus: "PAID",
    });
    const inventory = await client.query<{ id: string }>(
      `INSERT INTO inventory_units(owner_id,product_id,source_type,source_id)
       VALUES($1,$2,'GACHA',$3) RETURNING id`,
      [publisherId, prototype.prizeProductId, completed.entitlementId],
    );
    await client.query(
      `INSERT INTO draw_results(
         entitlement_id,user_id,product_id,pool_entry_id,prize_product_id,
         prize_inventory_unit_id,probability_version,selection_algorithm,
         entropy_hex,entropy_digest,roll_value,total_weight,selection_snapshot
       ) VALUES($1,$2,$3,$4,$5,$6,1,'SHA256_REJECTION_V1',$7,$8,0,1,'[]'::jsonb)`,
      [
        completed.entitlementId,
        publisherId,
        prototype.saleProductId,
        prototype.poolEntryId,
        prototype.prizeProductId,
        inventory.rows[0]!.id,
        "0".repeat(64),
        "1".repeat(64),
      ],
    );
    await client.query(
      "UPDATE draw_entitlements SET status='CONSUMED',consumed_at=now() WHERE id=$1",
      [completed.entitlementId],
    );

    await client.query(sql);
    assert.deepEqual((await client.query(
      "SELECT status FROM draw_probability_versions WHERE id=$1",
      [prototype.versionId],
    )).rows, [{ status: "RETIRED" }]);
    assert.deepEqual((await client.query(
      "SELECT id,is_active FROM catalog_products WHERE id=ANY($1::text[]) ORDER BY id",
      [[prototype.prizeProductId, prototype.saleProductId]],
    )).rows, [
      { id: prototype.prizeProductId, is_active: false },
      { id: prototype.saleProductId, is_active: false },
    ]);
    assert.equal((await client.query<{ is_active: boolean }>(
      "SELECT is_active FROM catalog_ips WHERE id=$1",
      [prototype.ipId],
    )).rows[0]!.is_active, false);
    assert.deepEqual((await client.query(
      `SELECT version.status,product.is_active,ip.is_active AS ip_active
         FROM draw_probability_versions AS version
         JOIN catalog_products AS product ON product.id=version.product_id
         JOIN catalog_ips AS ip ON ip.id=product.ip_id
        WHERE version.id=$1`,
      [retained.versionId],
    )).rows, [{ status: "ACTIVE", is_active: true, ip_active: true }]);
    assert.deepEqual((await client.query(
      `SELECT entitlement.status,orders.status AS order_status,payment.status AS payment_status,
              inventory.status AS inventory_status,count(result.id)::integer AS result_count
         FROM draw_entitlements AS entitlement
         JOIN order_lines AS line ON line.id=entitlement.order_line_id
         JOIN orders ON orders.id=line.order_id
         JOIN payments AS payment ON payment.order_id=orders.id
         JOIN draw_results AS result ON result.entitlement_id=entitlement.id
         JOIN inventory_units AS inventory ON inventory.id=result.prize_inventory_unit_id
        WHERE entitlement.id=$1
        GROUP BY entitlement.status,orders.status,payment.status,inventory.status`,
      [completed.entitlementId],
    )).rows, [{
      status: "CONSUMED",
      order_status: "FULFILLED",
      payment_status: "PAID",
      inventory_status: "OWNED",
      result_count: 1,
    }]);
    await client.query("ROLLBACK");

    // An available entitlement is a live customer right and aborts before any
    // version, product, or IP state can change.
    await client.query("BEGIN");
    suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    publisherId = await createPublisher(client, suffix);
    const blocked = await createActiveDraw(client, {
      suffix,
      publisherId,
      prototypeSale: true,
      prototypePrize: true,
    });
    await createEntitlement(client, {
      fixture: blocked,
      userId: publisherId,
      orderStatus: "FULFILLED",
      paymentStatus: "PAID",
    });
    await expectMigrationRejected(client, sql, "available_entitlement_block");
    assert.deepEqual((await client.query(
      `SELECT version.status,sale.is_active AS sale_active,prize.is_active AS prize_active,
              ip.is_active AS ip_active
         FROM draw_probability_versions AS version
         JOIN catalog_products AS sale ON sale.id=version.product_id
         JOIN catalog_products AS prize ON prize.id=$2
         JOIN catalog_ips AS ip ON ip.id=sale.ip_id
        WHERE version.id=$1`,
      [blocked.versionId, blocked.prizeProductId],
    )).rows, [{ status: "ACTIVE", sale_active: true, prize_active: true, ip_active: true }]);
    await client.query("ROLLBACK");

    // A non-prototype sale version that references a prototype prize is an
    // operator data error, not permission for this migration to retire it.
    await client.query("BEGIN");
    suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    publisherId = await createPublisher(client, suffix);
    const mixed = await createActiveDraw(client, {
      suffix,
      publisherId,
      prototypeSale: false,
      prototypePrize: true,
    });
    await expectMigrationRejected(client, sql, "mixed_catalog_block");
    assert.deepEqual((await client.query(
      `SELECT version.status,sale.is_active AS sale_active,prize.is_active AS prize_active
         FROM draw_probability_versions AS version
         JOIN catalog_products AS sale ON sale.id=version.product_id
         JOIN catalog_products AS prize ON prize.id=$2
        WHERE version.id=$1`,
      [mixed.versionId, mixed.prizeProductId],
    )).rows, [{ status: "ACTIVE", sale_active: true, prize_active: true }]);
    await client.query("ROLLBACK");

    // A deliberately late trigger failure proves that the earlier version
    // retirement rolls back with the later product update.
    await client.query("BEGIN");
    suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    publisherId = await createPublisher(client, suffix);
    const lateFailure = await createActiveDraw(client, {
      suffix,
      publisherId,
      prototypeSale: true,
      prototypePrize: true,
    });
    await client.query(`CREATE FUNCTION pg_temp.reject_0039_product_update()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'injected late migration failure' USING ERRCODE='23514';
      END
      $$`);
    await client.query(`CREATE TRIGGER reject_0039_product_update
      BEFORE UPDATE OF is_active ON catalog_products
      FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_0039_product_update()`);
    await expectMigrationRejected(client, sql, "late_update_block");
    assert.equal((await client.query<{ status: string }>(
      "SELECT status FROM draw_probability_versions WHERE id=$1",
      [lateFailure.versionId],
    )).rows[0]!.status, "ACTIVE");
    assert.equal((await client.query<{ is_active: boolean }>(
      "SELECT is_active FROM catalog_products WHERE id=$1",
      [lateFailure.saleProductId],
    )).rows[0]!.is_active, true);
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
});
