import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createMigrationDatabasePool, type DatabasePool, withTransaction } from "@dabboba/db";
import { processInventoryStorageExpiryBatch } from "./storage-expiry.js";
import { returnExpiredStoragePoints } from "./storage-point-returns.js";
import type { Logger } from "./logger.js";

const url = process.env.DATABASE_MIGRATION_URL;
const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

// This forward-clock sweep must run before other integration fixtures, never
// against a shared/preserved database. CI invokes it explicitly after migration.
test("expiry financial lifecycle on disposable PostgreSQL is atomic, worker-authorized and exactly once", { skip: !url || process.env.DABBOBA_STORAGE_POLICY_INTEGRATION !== "1" }, async (t) => {
  const pool = createMigrationDatabasePool(url!, "dabboba-storage-policy-integration");
  t.after(() => pool.end());
  // Use the actual worker grants without giving the fixture role to the API.
  const workerPool = {
    async connect() {
      const client = await pool.connect();
      return {
        async query(sql: string, params?: unknown[]) {
          const result = await client.query(sql, params);
          if (sql === "BEGIN") await client.query("SET LOCAL ROLE dabboba_worker");
          return result;
        },
        release() { client.release(); },
      };
    },
  } as unknown as DatabasePool;
  const suffix = randomUUID();
  const owner = (await pool.query<{ id: string }>(
    "INSERT INTO users(email,nickname) VALUES($1,'보관 시험') RETURNING id", [`storage-${suffix}@example.test`],
  )).rows[0]!.id;
  const ip = `storage-ip-${suffix}`;
  const product = `storage-gacha-${suffix}`;
  const prize = `storage-prize-${suffix}`;
  await pool.query("INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1::text,$1::text,'보관 시험','Storage Test')", [ip]);
  await pool.query(`INSERT INTO catalog_products(id,sku,ip_id,category,name,price,is_prize_only)
    VALUES($1::text,$1::text,$3,'gacha','가챠',9999,false),($2::text,$2::text,$3,'figure','경품',9999,true)`, [product, prize, ip]);
  const version = (await pool.query<{ id: string }>("INSERT INTO draw_probability_versions(product_id,version) VALUES($1,1) RETURNING id", [product])).rows[0]!.id;
  const entry = (await pool.query<{ id: string }>(
    `INSERT INTO draw_pool_entries(probability_version_id,prize_product_id,prize_name_snapshot,
       prize_sku_snapshot,prize_ip_id_snapshot,prize_category_snapshot,rarity,weight,initial_quantity,remaining_quantity)
     VALUES($1,$2::text,'경품',$2::text,$3,'figure','일반',1,30,30) RETURNING id`, [version, prize, ip],
  )).rows[0]!.id;
  await pool.query("INSERT INTO product_stock(product_id,on_hand) VALUES($1,30)", [product]);
  await pool.query("UPDATE draw_probability_versions SET status='ACTIVE',published_by=$2,published_at=now() WHERE id=$1", [version, owner]);

  const award = async (status = "OWNED", orderStatus = "PAID") => {
    const order = (await pool.query<{ id: string }>("INSERT INTO orders(user_id,status,subtotal,total,paid_at) VALUES($1,'PAID',9999,9999,now()) RETURNING id", [owner])).rows[0]!.id;
    const line = (await pool.query<{ id: string }>(`INSERT INTO order_lines(order_id,product_id,product_name_snapshot,category_snapshot,probability_version_id,unit_price,quantity,line_total)
      VALUES($1,$2,'가챠','gacha',$3,9999,1,9999) RETURNING id`, [order, product, version])).rows[0]!.id;
    await pool.query("UPDATE product_stock SET on_hand=on_hand-1 WHERE product_id=$1", [product]);
    const entitlement = (await pool.query<{ id: string }>("INSERT INTO draw_entitlements(order_line_id,user_id,product_id,probability_version_id) VALUES($1,$2,$3,$4) RETURNING id", [line, owner, product, version])).rows[0]!.id;
    await pool.query("UPDATE draw_pool_entries SET remaining_quantity=remaining_quantity-1 WHERE id=$1", [entry]);
    const inventory = (await pool.query<{ id: string }>("INSERT INTO inventory_units(owner_id,product_id,source_type,source_id) VALUES($1,$2,'GACHA',$3) RETURNING id", [owner, prize, entitlement])).rows[0]!.id;
    await pool.query(`INSERT INTO draw_results(entitlement_id,user_id,product_id,pool_entry_id,prize_product_id,prize_inventory_unit_id,probability_version,selection_algorithm,entropy_hex,entropy_digest,roll_value,total_weight,selection_snapshot)
      VALUES($1,$2,$3,$4,$5,$6,1,'SHA256_REJECTION_V1',$7,$8,0,30,'[]')`, [entitlement, owner, product, entry, prize, inventory, "0".repeat(64), "1".repeat(64)]);
    await pool.query("UPDATE draw_entitlements SET status='CONSUMED',consumed_at=now() WHERE id=$1", [entitlement]);
    if (status !== "OWNED") await pool.query("UPDATE inventory_units SET status=$2 WHERE id=$1", [inventory, status]);
    if (orderStatus !== "PAID") await pool.query("UPDATE orders SET status=$2 WHERE id=$1", [order, orderStatus]);
    return inventory;
  };
  const legacy = await award();
  await pool.query(`INSERT INTO user_policy_acceptance_events(user_id,policy_key,policy_version,content_sha256,source,correlation_id)
    SELECT $1,'TERMS',policy_version,content_sha256,'MOBILE_LOGIN','storage-policy-test'
    FROM legal_document_versions WHERE policy_key='TERMS' AND policy_version='2026-10-12'`, [owner]);
  const eligible = await award();
  const shipping = await award("SHIPPING");
  const exchangeLocked = await award("EXCHANGE_LISTED");
  const review = await award("OWNED", "REFUND_REVIEW");
  // Price edits after acquisition cannot change the frozen reference amount.
  await pool.query("UPDATE catalog_products SET price=1000 WHERE id=$1", [prize]);
  const future = new Date(Date.now() + 61 * 86400000);
  await pool.query("UPDATE inventory_units SET status='EXPIRED_HOLD' WHERE id=$1", [eligible]);
  await assert.rejects(() => withTransaction(workerPool, async (client) => {
    assert.equal(await returnExpiredStoragePoints(client, 100, future, () => true), 1);
    throw new Error("simulated failure before commit");
  }), /simulated failure/);
  assert.equal((await pool.query("SELECT count(*)::integer AS count FROM inventory_storage_point_returns WHERE owner_id=$1", [owner])).rows[0].count, 0);
  const results = await Promise.all([
    processInventoryStorageExpiryBatch(workerPool, 100, logger, future),
    processInventoryStorageExpiryBatch(workerPool, 100, logger, future),
  ]);
  assert.equal(results.reduce((sum, result) => sum + result.pointReturnedInventory, 0), 1);
  const states = await pool.query<{ id: string; status: string }>("SELECT id,status FROM inventory_units WHERE owner_id=$1", [owner]);
  const state = new Map(states.rows.map((row) => [row.id, row.status]));
  assert.equal(state.get(eligible), "POINT_RETURNED");
  assert.equal(state.get(legacy), "EXPIRED_HOLD");
  assert.equal(state.get(review), "EXPIRED_HOLD");
  assert.equal(state.get(shipping), "SHIPPING");
  assert.equal(state.get(exchangeLocked), "EXCHANGE_LISTED");
  assert.equal((await pool.query("SELECT balance FROM point_accounts WHERE user_id=$1", [owner])).rows[0].balance, 4999);
  assert.equal((await pool.query("SELECT count(*)::integer AS count FROM point_ledger_entries WHERE user_id=$1 AND reference_type='STORAGE_EXPIRY_RETURN'", [owner])).rows[0].count, 1);
  assert.equal((await processInventoryStorageExpiryBatch(workerPool, 100, logger, future)).pointReturnedInventory, 0);
  await assert.rejects(() => pool.query("UPDATE inventory_units SET storage_return_reference_amount=10 WHERE id=$1", [eligible]), /immutable/);
  await assert.rejects(() => pool.query("DELETE FROM inventory_storage_point_returns WHERE inventory_unit_id=$1", [eligible]), /append-only/);
});
