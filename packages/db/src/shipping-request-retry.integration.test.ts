import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createMigrationDatabasePool } from "./index.js";

const databaseUrl = process.env.DATABASE_MIGRATION_URL;

test("a cancelled shipping request preserves its history but allows one new active request for the item", {
  skip: !databaseUrl,
  timeout: 60_000,
}, async () => {
  const pool = createMigrationDatabasePool(databaseUrl!, "dabboba-shipping-retry-integration");
  const client = await pool.connect();
  let savepoint = 0;
  const rejected = async (sql: string, values: unknown[], code: string) => {
    const name = `shipping_retry_guard_${++savepoint}`;
    await client.query(`SAVEPOINT ${name}`);
    try {
      await assert.rejects(client.query(sql, values), (error: unknown) => (
        typeof error === "object" && error !== null && "code" in error && error.code === code
      ));
    } finally {
      await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      await client.query(`RELEASE SAVEPOINT ${name}`);
    }
  };
  try {
    await client.query("BEGIN");
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const owner = await client.query<{ id: string }>(
      "INSERT INTO users(email,nickname) VALUES($1,$2) RETURNING id",
      [`shipping-retry-${suffix}@example.test`, `배송 재신청 ${suffix}`],
    );
    const other = await client.query<{ id: string }>(
      "INSERT INTO users(email,nickname) VALUES($1,$2) RETURNING id",
      [`shipping-other-${suffix}@example.test`, `다른 회원 ${suffix}`],
    );
    const ipId = `shipping-retry-ip-${suffix}`;
    const productId = `shipping-retry-product-${suffix}`;
    await client.query("INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$3)", [ipId, ipId, `배송 재신청 ${suffix}`]);
    await client.query(
      "INSERT INTO catalog_products(id,sku,ip_id,category,name,price) VALUES($1,$2,$3,'gacha',$4,10000)",
      [productId, `SHIPPING-RETRY-${suffix}`.toUpperCase(), ipId, `재신청 가챠 ${suffix}`],
    );
    const inventory = await client.query<{ id: string }>(
      "INSERT INTO inventory_units(owner_id,product_id,source_type,status) VALUES($1,$2,'GACHA','OWNED') RETURNING id",
      [owner.rows[0]!.id, productId],
    );
    const newRequest = async (userId: string) => {
      const result = await client.query<{ id: string }>(
        "INSERT INTO shipping_requests(user_id,status,address_snapshot) VALUES($1,'PAYMENT_PENDING','{}'::jsonb) RETURNING id",
        [userId],
      );
      return result.rows[0]!.id;
    };
    const addItemSql = `INSERT INTO shipping_request_items(shipping_request_id,inventory_unit_id,product_snapshot)
       SELECT $1,i.id,jsonb_build_object('productId',p.id,'productName',p.name,'ipId',p.ip_id,
         'ipNameKo',ip.name_ko,'category',p.category,'imageUrl',p.image_url,'productVersion',p.version)
       FROM inventory_units i JOIN catalog_products p ON p.id=i.product_id
       JOIN catalog_ips ip ON ip.id=p.ip_id WHERE i.id=$2`;
    const addItem = (requestId: string) => client.query(
      addItemSql,
      [requestId, inventory.rows[0]!.id],
    );

    const first = await newRequest(owner.rows[0]!.id);
    await addItem(first);
    const overlapping = await newRequest(owner.rows[0]!.id);
    await rejected(addItemSql, [overlapping, inventory.rows[0]!.id], "23505");
    await client.query("UPDATE shipping_requests SET status='CANCELLED' WHERE id=$1", [first]);
    await addItem(overlapping);
    const wrongOwner = await newRequest(other.rows[0]!.id);
    await rejected(addItemSql, [wrongOwner, inventory.rows[0]!.id], "23514");
    const history = await client.query<{ shipping_request_id: string }>(
      "SELECT shipping_request_id FROM shipping_request_items WHERE inventory_unit_id=$1 ORDER BY shipping_request_id",
      [inventory.rows[0]!.id],
    );
    assert.deepEqual(history.rows.map((row) => row.shipping_request_id).sort(), [first, overlapping].sort());
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
});
