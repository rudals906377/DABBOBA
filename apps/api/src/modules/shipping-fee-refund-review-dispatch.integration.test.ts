import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import { buildApp } from "../app.js";
import { issueSession } from "../plugins/auth.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;

test("a shipping request whose paid fee is under refund review cannot be dispatched, only cancelled", {
  skip: !databaseUrl,
  timeout: 60_000,
}, async (t) => {
  const pool = createDatabasePool(databaseUrl!, "dabboba-shipping-fee-review-dispatch-test");
  const config: ApiConfig = {
    environment: "test", host: "127.0.0.1", port: 8788, databaseUrl: databaseUrl!, redisUrl: "redis://127.0.0.1:6379",
    webOrigins: ["http://127.0.0.1:4174"], adminOrigins: ["http://127.0.0.1:4180"],
    sessionTokenPepper: "shipping-fee-review-dispatch-pepper", adminProxyIdentitySecret: null,
    sessionTtlDays: 1, commerceMode: "LIVE", paymentProvider: "UNCONFIGURED", paymentWebhookSecret: null,
    gcsBucket: null, gcsProjectId: null, logLevel: "silent",
  };
  const { app } = await buildApp({ config, pool, redis: null });
  t.after(async () => { await app.close(); await pool.end(); });

  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const admin = await pool.query<{ id: string }>(
    "INSERT INTO users(email,nickname,role,status) VALUES($1,'Shipping review supervisor','SUPER_ADMIN','ACTIVE') RETURNING id",
    [`shipping-review-admin-${suffix}@example.test`],
  );
  const owner = await pool.query<{ id: string }>(
    "INSERT INTO users(email,nickname,role,status) VALUES($1,'Shipping review customer','USER','ACTIVE') RETURNING id",
    [`shipping-review-owner-${suffix}@example.test`],
  );
  const adminSession = await issueSession(pool, config, {
    userId: admin.rows[0]!.id, kind: "ADMIN", ip: "203.0.113.61", userAgent: "Shipping review dispatch test",
  });
  const ipId = `shipping-review-ip-${suffix}`;
  const productId = `shipping-review-gacha-${suffix}`;
  await pool.query("INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$3)", [ipId, ipId, `배송비 검토 ${suffix}`]);
  await pool.query(
    "INSERT INTO catalog_products(id,sku,ip_id,category,name,price) VALUES($1,$2,$3,'gacha',$4,10000)",
    [productId, `SHIP-REVIEW-${suffix}`.toUpperCase(), ipId, `배송비 검토 가챠 ${suffix}`],
  );
  const inventory = await pool.query<{ id: string }>(
    "INSERT INTO inventory_units(owner_id,product_id,source_type,source_id,status) VALUES($1,$2,'GACHA',$3,'OWNED') RETURNING id",
    [owner.rows[0]!.id, productId, randomUUID()],
  );
  const request = await pool.query<{ id: string }>(
    `INSERT INTO shipping_requests(user_id,status,address_snapshot,reference_subtotal,free_shipping_threshold,
       qualifies_for_free_shipping,contains_kuji,shipping_fee)
     VALUES($1,'PAYMENT_PENDING','{}'::jsonb,10000,24900,false,false,3000) RETURNING id`,
    [owner.rows[0]!.id],
  );
  const shippingRequestId = request.rows[0]!.id;
  await pool.query(
    `INSERT INTO shipping_request_items(shipping_request_id,inventory_unit_id,product_snapshot)
     SELECT $1,$2,jsonb_build_object('productId',p.id,'productName',p.name,'ipId',p.ip_id,
       'ipNameKo',ip.name_ko,'category',p.category,'imageUrl',p.image_url,'productVersion',p.version)
     FROM catalog_products p JOIN catalog_ips ip ON ip.id=p.ip_id WHERE p.id=$3`,
    [shippingRequestId, inventory.rows[0]!.id, productId],
  );
  await pool.query("UPDATE inventory_units SET status='SHIPPING' WHERE id=$1", [inventory.rows[0]!.id]);
  // The fee was paid (request promoted) and then a provider partial cancel moved it to review.
  await pool.query("UPDATE shipping_requests SET status='REQUESTED' WHERE id=$1", [shippingRequestId]);
  await pool.query(
    `INSERT INTO orders(user_id,status,subtotal,total,order_kind,shipping_request_id,paid_at)
     VALUES($1,'REFUND_REVIEW',3000,3000,'SHIPPING_FEE',$2,now())`,
    [owner.rows[0]!.id, shippingRequestId],
  );

  const transition = (status: "PROCESSING" | "CANCELLED", expectedVersion: number) => {
    const reason = status === "CANCELLED" ? "배송비 환불 검토로 배송 취소" : "배송 준비 시작";
    return app.inject({
      method: "POST",
      url: `/v1/admin/commerce/shipping/${shippingRequestId}/status`,
      headers: {
        authorization: `Bearer ${adminSession.token}`,
        "x-admin-reason": reason,
        "idempotency-key": `shipping-review-${randomUUID()}`,
      },
      payload: { status, expectedVersion, reason },
    });
  };
  const version = async () => (await pool.query<{ version: number }>(
    "SELECT version FROM shipping_requests WHERE id=$1",
    [shippingRequestId],
  )).rows[0]!.version;

  const blocked = await transition("PROCESSING", await version());
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.match(blocked.body, /환불 검토/);
  const unchanged = await pool.query<{ status: string }>("SELECT status FROM shipping_requests WHERE id=$1", [shippingRequestId]);
  assert.equal(unchanged.rows[0]!.status, "REQUESTED");

  const cancelled = await transition("CANCELLED", await version());
  assert.equal(cancelled.statusCode, 200, cancelled.body);
  const released = await pool.query<{ status: string }>("SELECT status FROM inventory_units WHERE id=$1", [inventory.rows[0]!.id]);
  assert.equal(released.rows[0]!.status, "OWNED");
});
