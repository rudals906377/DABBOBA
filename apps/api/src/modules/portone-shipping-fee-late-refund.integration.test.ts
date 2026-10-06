import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import { buildApp } from "../app.js";
import { acceptRequiredPoliciesForIntegrationTest } from "../integration-test-fixtures.js";
import { selectCardChannel } from "../lib/portone-channel-binding.js";
import { issueSession } from "../plugins/auth.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;

test("a late paid shipping fee for a cancelled request is cancelled once without reclaiming the customer's item", {
  skip: !databaseUrl,
  timeout: 60_000,
}, async (t) => {
  const pool = createDatabasePool(databaseUrl!, "dabboba-shipping-fee-late-refund-test");
  const config: ApiConfig = {
    environment: "test", host: "127.0.0.1", port: 8788, databaseUrl: databaseUrl!, redisUrl: "redis://127.0.0.1:6379",
    webOrigins: ["http://127.0.0.1:4174"], adminOrigins: ["http://127.0.0.1:4180"],
    sessionTokenPepper: "shipping-late-refund-test-pepper", adminProxyIdentitySecret: null,
    sessionTtlDays: 1, commerceMode: "LIVE", paymentProvider: "PORTONE_V2_INICIS",
    paymentWebhookSecret: "shipping-late-refund-test-webhook-secret",
    portOne: {
      apiSecret: "synthetic-secret", merchantId: "synthetic-merchant", storeId: "synthetic-store",
      channelKey: "synthetic-channel", channelEnvironment: "TEST",
      webhookSecret: "shipping-late-refund-test-webhook-secret",
    },
    gcsBucket: null, gcsProjectId: null, logLevel: "silent",
  };
  const { app } = await buildApp({ config, pool, redis: null });
  t.after(async () => { await app.close(); await pool.end(); });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const admin = await pool.query<{ id: string }>(
    "INSERT INTO users(email,nickname,role,status) VALUES($1,'Shipping refund supervisor','SUPER_ADMIN','ACTIVE') RETURNING id",
    [`shipping-refund-admin-${suffix}@example.test`],
  );
  const owner = await pool.query<{ id: string }>(
    "INSERT INTO users(email,nickname,role,status) VALUES($1,'Shipping refund customer','USER','ACTIVE') RETURNING id",
    [`shipping-refund-owner-${suffix}@example.test`],
  );
  await acceptRequiredPoliciesForIntegrationTest(pool, owner.rows[0]!.id);
  const adminSession = await issueSession(pool, config, {
    userId: admin.rows[0]!.id, kind: "ADMIN", ip: "203.0.113.41", userAgent: "Shipping refund test",
  });
  const customerSession = await issueSession(pool, config, {
    userId: owner.rows[0]!.id, kind: "USER", ip: "203.0.113.42", userAgent: "Shipping retry test",
  });
  const ipId = `shipping-refund-ip-${suffix}`;
  const productId = `shipping-refund-gacha-${suffix}`;
  await pool.query("INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$3)", [ipId, ipId, `배송비 환불 테스트 ${suffix}`]);
  await pool.query(
    "INSERT INTO catalog_products(id,sku,ip_id,category,name,price) VALUES($1,$2,$3,'gacha',$4,10000)",
    [productId, `SHIP-REFUND-${suffix}`.toUpperCase(), ipId, `배송비 환불 가챠 ${suffix}`],
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
  await pool.query("UPDATE shipping_requests SET status='CANCELLED' WHERE id=$1", [shippingRequestId]);
  const order = await pool.query<{ id: string }>(
    `INSERT INTO orders(user_id,status,subtotal,total,order_kind,shipping_request_id,paid_at,cancelled_at)
     VALUES($1,'REFUND_REVIEW',3000,3000,'SHIPPING_FEE',$2,now(),now()) RETURNING id`,
    [owner.rows[0]!.id, shippingRequestId],
  );
  const payment = await pool.query<{ id: string }>(
    `INSERT INTO payments(order_id,provider,status,amount,paid_at)
     VALUES($1,'PORTONE_V2_INICIS','REFUND_REVIEW',3000,now()) RETURNING id`,
    [order.rows[0]!.id],
  );
  const paymentId = payment.rows[0]!.id;
  await pool.query(
    "INSERT INTO payment_ledger_entries(payment_id,order_id,entry_type,amount,reference_id) VALUES($1,$2,'PAYMENT',3000,$3)",
    [paymentId, order.rows[0]!.id, `shipping-late-paid-${suffix}`],
  );

  let lookups = 0;
  let cancellations = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    assert.match(String(input), new RegExp(`/payments/${paymentId}`));
    if (init?.method === "POST") {
      cancellations += 1;
      const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      assert.equal(sent.amount, 3_000);
      return new Response(JSON.stringify({ cancellation: {
        status: "SUCCEEDED", id: `cancel-shipping-${suffix}`, totalAmount: 3_000,
        taxFreeAmount: 0, vatAmount: 273, reason: "시간 초과 후 승인된 배송비 환불",
        requestedAt: "2026-09-20T00:01:00.000Z", cancelledAt: "2026-09-20T00:01:01.000Z",
      } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    lookups += 1;
    const cancelled = lookups > 1;
    return new Response(JSON.stringify({
      id: paymentId, transactionId: `portone-${suffix}`, pgTxId: `kg-${suffix}`,
      merchantId: "synthetic-merchant", storeId: "synthetic-store", version: "V2",
      channel: { key: "synthetic-channel", type: "TEST", pgProvider: "INICIS_V2" },
      method: { type: "PaymentMethodCard" }, status: cancelled ? "CANCELLED" : "PAID",
      amount: { total: 3_000, paid: 3_000, cancelled: cancelled ? 3_000 : 0 }, currency: "KRW",
      requestedAt: "2026-09-20T00:00:00.000Z",
      statusChangedAt: cancelled ? "2026-09-20T00:01:01.000Z" : "2026-09-20T00:00:02.000Z",
      paidAt: "2026-09-20T00:00:02.000Z", cancelledAt: cancelled ? "2026-09-20T00:01:01.000Z" : null,
      cancellations: [],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const reason = "시간 초과 후 승인된 배송비 환불";
  const key = `shipping-late-refund-${randomUUID()}`;
  const cancel = () => app.inject({
    method: "POST", url: `/v1/admin/commerce/refund-reviews/${paymentId}/cancel`,
    headers: { authorization: `Bearer ${adminSession.token}`, "x-admin-reason": reason, "idempotency-key": key },
    payload: { reason },
  });
  const detailBefore = await app.inject({
    method: "GET", url: `/v1/admin/commerce/refund-reviews/${paymentId}`,
    headers: { authorization: `Bearer ${adminSession.token}` },
  });
  assert.equal(detailBefore.statusCode, 200, detailBefore.body);
  assert.equal((detailBefore.json() as { providerActionAvailable: boolean }).providerActionAvailable, true);
  const first = await cancel();
  assert.equal(first.statusCode, 202, first.body);
  assert.equal((first.json() as { status: string }).status, "RECONCILED");
  const replay = await cancel();
  assert.equal(replay.statusCode, 202, replay.body);
  assert.equal(cancellations, 1);
  assert.equal(lookups, 2);
  const detailAfter = await app.inject({
    method: "GET", url: `/v1/admin/commerce/refund-reviews/${paymentId}`,
    headers: { authorization: `Bearer ${adminSession.token}` },
  });
  assert.equal(detailAfter.statusCode, 200, detailAfter.body);
  assert.equal((detailAfter.json() as { providerActionAvailable: boolean }).providerActionAvailable, false);
  const state = await pool.query<{
    payment_status: string; order_status: string; shipping_status: string; inventory_status: string;
    refund_ledger: string;
  }>(`SELECT p.status AS payment_status,o.status AS order_status,s.status AS shipping_status,
      i.status AS inventory_status,
      (SELECT COALESCE(sum(l.amount),0)::text FROM payment_ledger_entries l
       WHERE l.payment_id=p.id AND l.entry_type='REFUND') AS refund_ledger
     FROM payments p JOIN orders o ON o.id=p.order_id
     JOIN shipping_requests s ON s.id=o.shipping_request_id
     JOIN shipping_request_items item ON item.shipping_request_id=s.id
     JOIN inventory_units i ON i.id=item.inventory_unit_id WHERE p.id=$1`, [paymentId]);
  assert.deepEqual(state.rows[0], {
    payment_status: "REFUNDED", order_status: "REFUNDED", shipping_status: "CANCELLED",
    inventory_status: "OWNED", refund_ledger: "-3000",
  });

  await pool.query(
    `INSERT INTO default_shipping_addresses(user_id,recipient,phone,postal_code,address_line1)
     VALUES($1,'배송 재신청','01012345678','06236','서울특별시 강남구 테헤란로 1')`,
    [owner.rows[0]!.id],
  );
  const quoteResponse = await app.inject({
    method: "POST", url: "/v1/account/shipping-quotes",
    headers: { authorization: `Bearer ${customerSession.token}` },
    payload: { inventoryUnitIds: [inventory.rows[0]!.id] },
  });
  assert.equal(quoteResponse.statusCode, 200, quoteResponse.body);
  const quote = quoteResponse.json() as { id: string; addressVersion: number; shippingFee: number };
  assert.equal(quote.shippingFee, 3_000);
  const retry = await app.inject({
    method: "POST", url: "/v1/account/shipping-requests",
    headers: {
      authorization: `Bearer ${customerSession.token}`,
      "idempotency-key": `shipping-retry-${randomUUID()}`,
    },
    payload: { quoteId: quote.id, addressVersion: quote.addressVersion },
  });
  assert.equal(retry.statusCode, 201, retry.body);
  const retryBody = retry.json() as { id: string; status: string; paymentId: string };
  assert.notEqual(retryBody.id, shippingRequestId);
  assert.equal(retryBody.status, "PAYMENT_PENDING");
  assert.ok(retryBody.paymentId);
  // A new shipping-fee payment is bound to the primary card channel snapshot.
  const binding = await pool.query("SELECT provider,portone_channel_binding FROM payments WHERE id=$1", [retryBody.paymentId]);
  assert.deepEqual(binding.rows[0], {
    provider: "PORTONE_V2_INICIS",
    portone_channel_binding: selectCardChannel(config, "INICIS"),
  });
  const history = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM shipping_request_items WHERE inventory_unit_id=$1",
    [inventory.rows[0]!.id],
  );
  assert.equal(history.rows[0]!.count, "2");
});
