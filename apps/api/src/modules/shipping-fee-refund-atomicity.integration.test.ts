import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import { buildApp } from "../app.js";
import { acceptRequiredPoliciesForIntegrationTest } from "../integration-test-fixtures.js";
import { issueSession } from "../plugins/auth.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;
const webhookSecret = "shipping-refund-atomicity-test-secret";

test("a shipping fee refund does not restore only some items when the request needs review", {
  skip: !databaseUrl,
  timeout: 60_000,
}, async (t) => {
  const pool = createDatabasePool(databaseUrl!, "dabboba-shipping-refund-atomicity-test");
  const config: ApiConfig = {
    environment: "test", host: "127.0.0.1", port: 8788, databaseUrl: databaseUrl!,
    redisUrl: "redis://127.0.0.1:6379", webOrigins: ["http://127.0.0.1:4174"],
    adminOrigins: ["http://127.0.0.1:4180"], sessionTokenPepper: webhookSecret,
    adminProxyIdentitySecret: null, sessionTtlDays: 1, commerceMode: "LIVE",
    paymentProvider: "PORTONE_V2_INICIS", paymentWebhookSecret: webhookSecret,
    portOne: {
      apiSecret: "synthetic-secret", merchantId: "synthetic-merchant", storeId: "synthetic-store",
      channelKey: "synthetic-channel", channelEnvironment: "TEST", webhookSecret,
    },
    gcsBucket: null, gcsProjectId: null, logLevel: "silent",
  };
  const { app } = await buildApp({ config, pool, redis: null });
  t.after(async () => { await app.close(); await pool.end(); });

  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const owner = await pool.query<{ id: string }>(
    "INSERT INTO users(email,nickname,role,status) VALUES($1,'Refund owner','USER','ACTIVE') RETURNING id",
    [`refund-atomicity-${suffix}@example.test`],
  );
  const ownerId = owner.rows[0]!.id;
  await acceptRequiredPoliciesForIntegrationTest(pool, ownerId);
  const customerSession = await issueSession(pool, config, {
    userId: ownerId, kind: "USER", ip: "203.0.113.42", userAgent: "Refund atomicity test",
  });
  const supervisor = await pool.query<{ id: string }>(
    "INSERT INTO users(email,nickname,role,status) VALUES($1,'Refund supervisor','SUPER_ADMIN','ACTIVE') RETURNING id",
    [`refund-supervisor-${suffix}@example.test`],
  );
  const adminSession = await issueSession(pool, config, {
    userId: supervisor.rows[0]!.id, kind: "ADMIN", ip: "203.0.113.41", userAgent: "Refund atomicity test",
  });
  const ipId = `refund-atomicity-ip-${suffix}`;
  const productId = `refund-atomicity-product-${suffix}`;
  await pool.query("INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$3)", [ipId, ipId, `환불 원자성 ${suffix}`]);
  await pool.query(
    "INSERT INTO catalog_products(id,sku,ip_id,category,name,price) VALUES($1,$2,$3,'gacha',$4,10000)",
    [productId, `REFUND-ATOMICITY-${suffix}`.toUpperCase(), ipId, `가챠 ${suffix}`],
  );
  const inventory = await pool.query<{ id: string }>(
    `INSERT INTO inventory_units(owner_id,product_id,source_type,source_id,status)
     VALUES($1,$2,'GACHA',$3,'OWNED'),($1,$2,'GACHA',$4,'OWNED') RETURNING id`,
    [ownerId, productId, randomUUID(), randomUUID()],
  );
  const request = await pool.query<{ id: string }>(
    `INSERT INTO shipping_requests(user_id,status,address_snapshot,reference_subtotal,free_shipping_threshold,
       qualifies_for_free_shipping,contains_kuji,shipping_fee)
     VALUES($1,'REQUESTED','{}'::jsonb,20000,24900,false,false,3000) RETURNING id`,
    [ownerId],
  );
  const shippingRequestId = request.rows[0]!.id;
  for (const item of inventory.rows) {
    await pool.query(
      `INSERT INTO shipping_request_items(shipping_request_id,inventory_unit_id,product_snapshot)
       SELECT $1,$2,jsonb_build_object('productId',p.id,'productName',p.name,'ipId',p.ip_id,
         'ipNameKo',ip.name_ko,'category',p.category,'imageUrl',p.image_url,'productVersion',p.version)
       FROM catalog_products p JOIN catalog_ips ip ON ip.id=p.ip_id WHERE p.id=$3`,
      [shippingRequestId, item.id, productId],
    );
  }
  await pool.query(
    "UPDATE inventory_units SET status=CASE WHEN id=$1 THEN 'SHIPPING' ELSE 'DELIVERED' END WHERE id=ANY($2::uuid[])",
    [inventory.rows[0]!.id, inventory.rows.map((item) => item.id)],
  );
  const order = await pool.query<{ id: string }>(
    `INSERT INTO orders(user_id,status,subtotal,total,order_kind,shipping_request_id,paid_at)
     VALUES($1,'PAID',3000,3000,'SHIPPING_FEE',$2,now()) RETURNING id`,
    [ownerId, shippingRequestId],
  );
  const payment = await pool.query<{ id: string }>(
    "INSERT INTO payments(order_id,provider,status,amount,paid_at) VALUES($1,'PORTONE_V2_INICIS','PAID',3000,now()) RETURNING id",
    [order.rows[0]!.id],
  );
  const paymentId = payment.rows[0]!.id;
  await pool.query(
    "INSERT INTO payment_ledger_entries(payment_id,order_id,entry_type,amount,reference_id) VALUES($1,$2,'PAYMENT',3000,$3)",
    [paymentId, order.rows[0]!.id, `paid-${suffix}`],
  );

  const payload = JSON.stringify({
    eventId: `refund-${randomUUID()}`, eventType: "REFUND_SUCCEEDED", paymentId,
    providerPaymentId: `provider-${paymentId}`, occurredAt: new Date().toISOString(), amount: 3000,
  });
  const signature = createHmac("sha256", webhookSecret).update(payload).digest("hex");
  const response = await app.inject({
    method: "POST", url: "/v1/payments/webhooks/PORTONE_V2_INICIS",
    headers: { "content-type": "application/json", "x-dabboba-signature": signature }, payload,
  });
  assert.equal(response.statusCode, 202, response.body);
  assert.equal((response.json() as { outcome: string }).outcome, "review");
  const state = await pool.query<{ inventory_status: string; request_status: string; payment_status: string }>(
    `SELECT i.status AS inventory_status,s.status AS request_status,p.status AS payment_status
       FROM inventory_units i
       JOIN shipping_request_items item ON item.inventory_unit_id=i.id
       JOIN shipping_requests s ON s.id=item.shipping_request_id
       JOIN orders o ON o.shipping_request_id=s.id
       JOIN payments p ON p.order_id=o.id
      WHERE p.id=$1 AND i.id=$2`,
    [paymentId, inventory.rows[0]!.id],
  );
  assert.deepEqual(state.rows[0], {
    inventory_status: "SHIPPING", request_status: "REQUESTED", payment_status: "REFUND_REVIEW",
  });
  const other = await pool.query<{ status: string }>(
    "SELECT status FROM inventory_units WHERE id=$1", [inventory.rows[1]!.id],
  );
  assert.equal(other.rows[0]!.status, "DELIVERED");
  const ledger = await pool.query<{ refunded_amount: string }>(
    `SELECT COALESCE(sum(amount),0)::text AS refunded_amount
       FROM payment_ledger_entries WHERE payment_id=$1 AND entry_type='REFUND'`, [paymentId],
  );
  assert.equal(ledger.rows[0]!.refunded_amount, "-3000");

  // The first provider requery sees the same already-refunded provider state
  // while one local item still needs manual review. It must not make a later
  // supervisor requery permanently deduplicate a safely corrected request.
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    assert.match(String(input), new RegExp(`/payments/${paymentId}`));
    return new Response(JSON.stringify({
      id: paymentId, transactionId: `portone-${suffix}`, pgTxId: `kg-${suffix}`,
      merchantId: "synthetic-merchant", storeId: "synthetic-store", version: "V2",
      channel: { key: "synthetic-channel", type: "TEST", pgProvider: "INICIS_V2" },
      method: { type: "PaymentMethodCard" }, status: "CANCELLED",
      amount: { total: 3000, paid: 3000, cancelled: 3000 }, currency: "KRW",
      requestedAt: "2026-09-26T00:00:00.000Z", statusChangedAt: "2026-09-26T00:01:00.000Z",
      paidAt: "2026-09-26T00:00:30.000Z", cancelledAt: "2026-09-26T00:01:00.000Z",
      cancellations: [],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const firstRequery = await app.inject({
    method: "POST", url: `/v1/payments/${paymentId}/confirm`,
    headers: { authorization: `Bearer ${customerSession.token}` },
  });
  assert.equal(firstRequery.statusCode, 200, firstRequery.body);
  assert.equal((firstRequery.json() as { outcome: string }).outcome, "review");
  const customerReplay = await app.inject({
    method: "POST", url: `/v1/payments/${paymentId}/confirm`,
    headers: { authorization: `Bearer ${customerSession.token}` },
  });
  assert.equal(customerReplay.statusCode, 200, customerReplay.body);
  assert.equal((customerReplay.json() as { outcome: string }).outcome, "duplicate");
  await pool.query("UPDATE inventory_units SET status='SHIPPING' WHERE id=$1", [inventory.rows[1]!.id]);
  const reason = "배송 상품 상태를 확인하고 환불을 다시 대사";
  const manualRequery = await app.inject({
    method: "POST", url: `/v1/admin/commerce/payments/${paymentId}/reconcile`,
    headers: {
      authorization: `Bearer ${adminSession.token}`, "x-admin-reason": reason,
      "idempotency-key": `refund-review-requery-${randomUUID()}`,
    },
    payload: { reason },
  });
  assert.equal(manualRequery.statusCode, 200, manualRequery.body);
  assert.equal((manualRequery.json() as { outcome: string }).outcome, "processed");
  const recovered = await pool.query<{ shipping_status: string; payment_status: string; owned_count: string }>(
    `SELECT s.status AS shipping_status,p.status AS payment_status,
       (SELECT count(*)::text FROM inventory_units i JOIN shipping_request_items item
         ON item.inventory_unit_id=i.id WHERE item.shipping_request_id=s.id AND i.status='OWNED') AS owned_count
       FROM shipping_requests s JOIN orders o ON o.shipping_request_id=s.id
       JOIN payments p ON p.order_id=o.id WHERE p.id=$1`, [paymentId],
  );
  assert.deepEqual(recovered.rows[0], {
    shipping_status: "CANCELLED", payment_status: "REFUNDED", owned_count: "2",
  });
});
