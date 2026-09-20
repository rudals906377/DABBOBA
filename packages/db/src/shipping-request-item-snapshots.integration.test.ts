import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createMigrationDatabasePool } from "./index.js";

const databaseUrl = process.env.DATABASE_MIGRATION_URL;

function hasCode(expectedCode: string) {
  return (error: unknown) => typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === expectedCode;
}

test("shipping item snapshots match the request-time catalog and cannot be rewritten", {
  skip: !databaseUrl,
  timeout: 60_000,
}, async () => {
  const pool = createMigrationDatabasePool(
    databaseUrl!,
    "dabboba-shipping-snapshot-integration",
  );
  const client = await pool.connect();
  let savepointNumber = 0;

  const expectRejected = async (
    query: string,
    values: unknown[],
    expectedCode: string,
  ) => {
    savepointNumber += 1;
    const savepoint = `shipping_snapshot_guard_${savepointNumber}`;
    await client.query(`SAVEPOINT ${savepoint}`);
    try {
      await assert.rejects(client.query(query, values), hasCode(expectedCode));
    } finally {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    }
  };

  try {
    await client.query("BEGIN");
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const userId = randomUUID();
    const ipId = `shipping-snapshot-ip-${suffix}`;
    const productId = `shipping-snapshot-product-${suffix}`;

    await client.query(
      "INSERT INTO users(id,email,nickname) VALUES($1,$2,$3)",
      [userId, `shipping-snapshot-${suffix}@example.test`, `배송 스냅샷 ${suffix}`],
    );
    await client.query(
      "INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$4)",
      [ipId, ipId, `배송 IP ${suffix}`, `Shipping IP ${suffix}`],
    );
    await client.query(
      `INSERT INTO catalog_products(id,sku,ip_id,category,name,price,image_url)
       VALUES($1,$2,$3,'figure',$4,12000,$5)`,
      [
        productId,
        `SHIPPING-SNAPSHOT-${suffix}`.toUpperCase(),
        ipId,
        `배송 피규어 ${suffix}`,
        "https://example.test/original-product.webp",
      ],
    );
    const inventory = await client.query<{ id: string }>(
      `INSERT INTO inventory_units(owner_id,product_id,source_type,status)
       VALUES($1,$2,'ADMIN_ADJUSTMENT','OWNED') RETURNING id`,
      [userId, productId],
    );
    const shippingRequest = await client.query<{ id: string }>(
      `INSERT INTO shipping_requests(user_id,address_snapshot)
       VALUES($1,'{}'::jsonb) RETURNING id`,
      [userId],
    );

    await expectRejected(
      `INSERT INTO shipping_request_items(
         shipping_request_id,inventory_unit_id,product_snapshot
       ) VALUES($1,$2,$3::jsonb)`,
      [shippingRequest.rows[0]!.id, inventory.rows[0]!.id, JSON.stringify({ productId: "forged" })],
      "23514",
    );

    await client.query(
      `INSERT INTO shipping_request_items(shipping_request_id,inventory_unit_id,product_snapshot)
       SELECT $1,inventory.id,jsonb_build_object(
         'productId',product.id,
         'productName',product.name,
         'ipId',product.ip_id,
         'ipNameKo',ip.name_ko,
         'category',product.category,
         'imageUrl',product.image_url,
         'productVersion',product.version
       )
       FROM inventory_units AS inventory
       JOIN catalog_products AS product ON product.id=inventory.product_id
       JOIN catalog_ips AS ip ON ip.id=product.ip_id
       WHERE inventory.id=$2`,
      [shippingRequest.rows[0]!.id, inventory.rows[0]!.id],
    );

    const original = await client.query<{ product_snapshot: Record<string, unknown> }>(
      "SELECT product_snapshot FROM shipping_request_items WHERE inventory_unit_id=$1",
      [inventory.rows[0]!.id],
    );
    assert.equal(original.rows[0]!.product_snapshot.productName, `배송 피규어 ${suffix}`);
    assert.equal(original.rows[0]!.product_snapshot.ipNameKo, `배송 IP ${suffix}`);
    assert.equal(original.rows[0]!.product_snapshot.productVersion, 1);

    await client.query(
      "UPDATE catalog_ips SET name_ko=$2 WHERE id=$1",
      [ipId, `변경 IP ${suffix}`],
    );
    await client.query(
      "UPDATE catalog_products SET name=$2,version=version+1 WHERE id=$1",
      [productId, `변경 피규어 ${suffix}`],
    );
    const preserved = await client.query<{ product_snapshot: Record<string, unknown> }>(
      "SELECT product_snapshot FROM shipping_request_items WHERE inventory_unit_id=$1",
      [inventory.rows[0]!.id],
    );
    assert.deepEqual(preserved.rows[0]!.product_snapshot, original.rows[0]!.product_snapshot);

    await expectRejected(
      `UPDATE shipping_request_items
       SET product_snapshot=jsonb_set(product_snapshot,'{productName}','"tampered"')
       WHERE inventory_unit_id=$1`,
      [inventory.rows[0]!.id],
      "55000",
    );
    await expectRejected(
      "DELETE FROM shipping_request_items WHERE inventory_unit_id=$1",
      [inventory.rows[0]!.id],
      "55000",
    );

    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
});
