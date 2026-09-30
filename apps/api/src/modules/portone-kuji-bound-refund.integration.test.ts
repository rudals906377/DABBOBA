import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import { buildApp } from "../app.js";
import { acceptRequiredPoliciesForIntegrationTest } from "../integration-test-fixtures.js";
import { issueSession } from "../plugins/auth.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;

test("a full refund of a paid kuji order releases its bound but unopened ticket numbers", {
  skip: !databaseUrl,
  timeout: 60_000,
}, async (t) => {
  const pool = createDatabasePool(databaseUrl!, "dabboba-portone-kuji-bound-refund-integration");
  const config: ApiConfig = {
    environment: "test", host: "127.0.0.1", port: 8788, databaseUrl: databaseUrl!, redisUrl: "redis://127.0.0.1:6379",
    webOrigins: ["http://127.0.0.1:4174"], adminOrigins: ["http://127.0.0.1:4180"],
    sessionTokenPepper: "portone-kuji-bound-refund-pepper", adminProxyIdentitySecret: null,
    sessionTtlDays: 1, commerceMode: "LIVE", paymentProvider: "PORTONE_V2_INICIS",
    paymentWebhookSecret: "portone-kuji-bound-refund-webhook-secret",
    portOne: {
      apiSecret: "synthetic-secret", merchantId: "synthetic-merchant", storeId: "synthetic-store",
      channelKey: "synthetic-channel", channelEnvironment: "TEST",
      webhookSecret: "portone-kuji-bound-refund-webhook-secret",
    },
    gcsBucket: null, gcsProjectId: null, logLevel: "silent",
  };
  const { app } = await buildApp({ config, pool, redis: null });
  t.after(async () => { await app.close(); await pool.end(); });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const customerUser = await pool.query<{ id: string }>(
    "INSERT INTO users(email,nickname,role,status) VALUES($1,'Kuji refund customer','USER','ACTIVE') RETURNING id",
    [`kuji-bound-refund-${suffix}@example.test`],
  );
  const customerId = customerUser.rows[0]!.id;
  await acceptRequiredPoliciesForIntegrationTest(pool, customerId);
  const customer = await issueSession(pool, config, {
    userId: customerId, kind: "USER", ip: "203.0.113.95", userAgent: "Kuji bound refund test",
  });
  const adminUser = await pool.query<{ id: string }>(
    "INSERT INTO users(email,nickname,role,status) VALUES($1,'Kuji refund supervisor','SUPER_ADMIN','ACTIVE') RETURNING id",
    [`kuji-bound-refund-admin-${suffix}@example.test`],
  );
  const admin = await issueSession(pool, config, {
    userId: adminUser.rows[0]!.id, kind: "ADMIN", ip: "203.0.113.96", userAgent: "Kuji bound refund test",
  });
  const auth = { authorization: `Bearer ${customer.token}` };
  const ipId = `kuji-bound-refund-ip-${suffix}`;
  const productId = `kuji-bound-refund-${suffix}`;
  const prizeId = `kuji-bound-refund-prize-${suffix}`;
  await pool.query("INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$3)", [ipId, ipId, `쿠지 환불 ${suffix}`]);
  await pool.query(
    "INSERT INTO catalog_products(id,sku,ip_id,category,name,price,is_prize_only) VALUES($1,$2,$3,'figure',$4,0,true)",
    [prizeId, `KBR-PRIZE-${suffix}`.toUpperCase(), ipId, `쿠지 환불 경품 ${suffix}`],
  );
  await pool.query(
    "INSERT INTO catalog_products(id,sku,ip_id,category,name,price,image_url) VALUES($1,$2,$3,'kuji',$4,1000,$5)",
    [productId, `KBR-${suffix}`.toUpperCase(), ipId, `쿠지 환불 상품 ${suffix}`, `https://cdn.example.test/${productId}.png`],
  );
  await pool.query("INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,2,0)", [productId]);
  const version = await pool.query<{ id: string }>(
    "INSERT INTO draw_probability_versions(product_id,version) VALUES($1,1) RETURNING id", [productId],
  );
  const versionId = version.rows[0]!.id;
  const poolEntry = await pool.query<{ id: string }>(
    `INSERT INTO draw_pool_entries(
      probability_version_id,prize_product_id,prize_name_snapshot,prize_sku_snapshot,
      prize_ip_id_snapshot,prize_category_snapshot,rarity,weight,initial_quantity,remaining_quantity
    ) VALUES($1,$2,$3,$4,$5,'figure','A',1,2,2) RETURNING id`,
    [versionId, prizeId, `쿠지 환불 경품 ${suffix}`, `KBR-PRIZE-${suffix}`.toUpperCase(), ipId],
  );
  await pool.query("INSERT INTO kuji_decks(probability_version_id,total_slots) VALUES($1,2)", [versionId]);
  await pool.query(
    "INSERT INTO kuji_deck_tiers(probability_version_id,pool_entry_id,tier_code,tier_rank) VALUES($1,$2,'A',0)",
    [versionId, poolEntry.rows[0]!.id],
  );
  await pool.query(
    `INSERT INTO kuji_slot_assignments(probability_version_id,slot_number,pool_entry_id)
     SELECT $1,slot_number,$2 FROM generate_series(1,2) AS slot_number`,
    [versionId, poolEntry.rows[0]!.id],
  );
  await pool.query(
    "UPDATE draw_probability_versions SET status='ACTIVE',published_by=$2,published_at=now() WHERE id=$1",
    [versionId, adminUser.rows[0]!.id],
  );
  await pool.query("UPDATE catalog_products SET sale_status='ON_SALE' WHERE id=$1", [productId]);

  const room = await app.inject({ method: "POST", url: `/v1/kuji/rooms/${productId}/entries`, headers: auth });
  assert.ok([200, 201].includes(room.statusCode), room.body);
  const entryId = (room.json() as { viewer: { entryId: string } }).viewer.entryId;
  const ordered = await app.inject({
    method: "POST", url: "/v1/orders",
    headers: { ...auth, "idempotency-key": randomUUID() },
    payload: { items: [{ productId, quantity: 2, expectedDrawVersion: 1 }], pointAmount: 0, kujiRoomEntryId: entryId },
  });
  assert.equal(ordered.statusCode, 201, ordered.body);
  const order = ordered.json() as { id: string; paymentId: string };
  const attempt = await app.inject({ method: "POST", url: `/v1/payments/${order.paymentId}/attempt`, headers: auth });
  assert.equal(attempt.statusCode, 200, attempt.body);

  const providerTimestamp = (await pool.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now.toISOString();
  let cancelled = false;
  let cancelCalls = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    assert.match(String(input), new RegExp(order.paymentId));
    if (init?.method === "POST") {
      cancelCalls += 1;
      cancelled = true;
      return new Response(JSON.stringify({ cancellation: {
        status: "SUCCEEDED", id: `cancel-kuji-${suffix}`, totalAmount: 2_000,
        taxFreeAmount: 0, vatAmount: 182, reason: "고객 요청 전액 환불",
        requestedAt: providerTimestamp, cancelledAt: providerTimestamp,
      } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      id: order.paymentId, transactionId: `portone-${suffix}`, pgTxId: `kg-${suffix}`,
      merchantId: "synthetic-merchant", storeId: "synthetic-store", version: "V2",
      channel: { key: "synthetic-channel", type: "TEST", pgProvider: "INICIS_V2" },
      method: { type: "PaymentMethodCard" }, status: cancelled ? "CANCELLED" : "PAID",
      amount: { total: 2_000, paid: 2_000, cancelled: cancelled ? 2_000 : 0 }, currency: "KRW",
      requestedAt: providerTimestamp, statusChangedAt: providerTimestamp, paidAt: providerTimestamp,
      cancelledAt: cancelled ? providerTimestamp : null, cancellations: [],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const confirmed = await app.inject({ method: "POST", url: `/v1/payments/${order.paymentId}/confirm`, headers: auth });
  assert.equal(confirmed.statusCode, 200, confirmed.body);

  // Bind both ticket numbers, then refund before either ticket is opened.
  const selected = await app.inject({
    method: "POST", url: `/v1/kuji/rooms/${productId}/entries/${entryId}/slots`,
    headers: { ...auth, "idempotency-key": randomUUID() },
    payload: { probabilityVersion: 1, slotNumbers: [1, 2] },
  });
  assert.equal(selected.statusCode, 201, selected.body);
  const reason = "고객 요청 전액 환불";
  const refunded = await app.inject({
    method: "POST", url: `/v1/admin/commerce/payments/${order.paymentId}/refund`,
    headers: { authorization: `Bearer ${admin.token}`, "x-admin-reason": reason, "idempotency-key": randomUUID() },
    payload: { reason },
  });
  assert.equal(refunded.statusCode, 202, refunded.body);
  assert.equal((refunded.json() as { status: string }).status, "RECONCILED");
  assert.equal(cancelCalls, 1);

  const state = await pool.query<{
    order_status: string; cancelled_entitlements: string; reserved_bindings: string;
    released_bindings: string; on_hand: number; reserved: number;
  }>(
    `SELECT o.status AS order_status,
       (SELECT count(*)::text FROM draw_entitlements e JOIN order_lines l ON l.id=e.order_line_id
         WHERE l.order_id=o.id AND e.status='CANCELLED') AS cancelled_entitlements,
       (SELECT count(*)::text FROM kuji_slot_bindings b WHERE b.room_entry_id=$2 AND b.state='RESERVED') AS reserved_bindings,
       (SELECT count(*)::text FROM kuji_slot_bindings b
         WHERE b.room_entry_id=$2 AND b.state='RELEASED' AND b.release_reason='ENTITLEMENT_CANCELLED') AS released_bindings,
       s.on_hand,s.reserved
     FROM orders o JOIN product_stock s ON s.product_id=$3 WHERE o.id=$1`,
    [order.id, entryId, productId],
  );
  assert.deepEqual(state.rows[0], {
    order_status: "REFUNDED", cancelled_entitlements: "2", reserved_bindings: "0",
    released_bindings: "2", on_hand: 2, reserved: 0,
  });
  const deck = await app.inject({ method: "GET", url: `/v1/catalog/products/${productId}/kuji-slots` });
  assert.equal(deck.statusCode, 200, deck.body);
  assert.deepEqual(
    (deck.json() as { slots: Array<{ slotNumber: number; available: boolean }> }).slots,
    [{ slotNumber: 1, available: true }, { slotNumber: 2, available: true }],
  );
});
