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
test("card choice is server-configured, immutable, idempotent and reservation-bound", { skip: !databaseUrl, timeout: 60_000 }, async (t) => {
  const pool = createDatabasePool(databaseUrl!, "dabboba-card-choice-integration");
  const config: ApiConfig = {
    environment: "test", host: "127.0.0.1", port: 8788, databaseUrl: databaseUrl!, redisUrl: "redis://127.0.0.1:6379",
    webOrigins: [], adminOrigins: [], sessionTokenPepper: "synthetic-card-choice-pepper", adminProxyIdentitySecret: null,
    sessionTtlDays: 1, commerceMode: "LIVE", paymentProvider: "PORTONE_V2_INICIS", paymentWebhookSecret: "synthetic-hook",
    portOne: { apiSecret: "synthetic-secret", merchantId: "merchant", storeId: "store", channelKey: "channel-inicis",
      kcpChannelKey: "channel-key-kcp", channelEnvironment: "TEST", webhookSecret: "synthetic-hook" },
    gcsBucket: null, gcsProjectId: null, logLevel: "silent",
  };
  const { app } = await buildApp({ config, pool, redis: null });
  t.after(async () => { await app.close(); await pool.end(); });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const user = (await pool.query<{ id: string }>("INSERT INTO users(email,nickname,role,status) VALUES($1,$2,'USER','ACTIVE') RETURNING id", [`card-${suffix}@example.test`, "Card choice"])).rows[0]!;
  const publisher = (await pool.query<{ id: string }>("INSERT INTO users(email,nickname,role,status) VALUES($1,$2,'SUPER_ADMIN','ACTIVE') RETURNING id", [`card-admin-${suffix}@example.test`, "Card publisher"])).rows[0]!;
  await acceptRequiredPoliciesForIntegrationTest(pool, user.id);
  const session = await issueSession(pool, config, { userId: user.id, kind: "USER", ip: "127.0.0.1", userAgent: "Card choice integration" });
  const headers = { authorization: `Bearer ${session.token}` };
  const ip = `card-ip-${suffix}`, product = `card-gacha-${suffix}`, prize = `card-prize-${suffix}`;
  await pool.query("INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1::text,$1::text,'Card choice','Card choice')", [ip]);
  await pool.query("INSERT INTO catalog_products(id,sku,ip_id,category,name,price) VALUES($1::text,$1::text,$2,'gacha','Card choice',6000)", [product, ip]);
  await pool.query("INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,6,0)", [product]);
  await pool.query("INSERT INTO catalog_products(id,sku,ip_id,category,name,price,is_prize_only) VALUES($1::text,$1::text,$2,'figure','Card prize',0,true)", [prize, ip]);
  const version = (await pool.query<{ id: string }>("INSERT INTO draw_probability_versions(product_id,version) VALUES($1,1) RETURNING id", [product])).rows[0]!;
  await pool.query(`INSERT INTO draw_pool_entries(probability_version_id,prize_product_id,prize_name_snapshot,prize_sku_snapshot,prize_ip_id_snapshot,prize_category_snapshot,rarity,weight,initial_quantity,remaining_quantity)
    VALUES($1,$2::text,'Card prize',$2::text,$3,'figure','A',1,6,6)`, [version.id, prize, ip]);
  await pool.query("UPDATE draw_probability_versions SET status='ACTIVE',published_by=$2,published_at=now() WHERE id=$1", [version.id, publisher.id]);
  await pool.query("UPDATE catalog_products SET image_url='https://cdn.example.test/card-choice.png',sale_status='ON_SALE' WHERE id=$1", [product]);
  const payload = { items: [{ productId: product, quantity: 1, expectedDrawVersion: 1 }] };
  for (const cardPg of ["INICIS", "KCP"] as const) {
    const key = randomUUID();
    const body = { ...payload, cardPg, channelKey: "untrusted-client-channel" };
    const create = () => app.inject({ method: "POST", url: "/v1/orders", headers: { ...headers, "idempotency-key": key }, payload: body });
    const first = await create();
    assert.equal(first.statusCode, 201, first.body);
    const order = first.json() as { id: string; paymentId: string; total: number; cardPayment: unknown };
    assert.equal(order.total, 6000);
    assert.match(order.id, /^[0-9a-f-]{36}$/);
    assert.match(order.paymentId, /^[0-9a-f-]{36}$/);
    const selected = selectCardChannel(config, cardPg);
    assert.deepEqual(order.cardPayment, selected);
    const lookup = await app.inject({ method: "GET", url: `/v1/orders/${order.id}`, headers });
    assert.equal(lookup.statusCode, 200, lookup.body);
    assert.deepEqual(lookup.json().cardPayment, selected);
    assert.equal(lookup.json().total, 6000);
    assert.equal(lookup.json().paymentId, order.paymentId);
    const replay = await create();
    assert.equal(replay.statusCode, 201, replay.body);
    assert.deepEqual(replay.json(), first.json());
    const mismatch = await app.inject({ method: "POST", url: "/v1/orders", headers: { ...headers, "idempotency-key": key }, payload: { ...body, cardPg: cardPg === "KCP" ? "INICIS" : "KCP" } });
    assert.equal(mismatch.statusCode, 409, mismatch.body);
    const persisted = await pool.query("SELECT provider,portone_channel_binding FROM payments WHERE id=$1", [order.paymentId]);
    assert.deepEqual(persisted.rows[0], { provider: selected.provider, portone_channel_binding: selected });
    await assert.rejects(pool.query("UPDATE payments SET portone_channel_binding=jsonb_set(portone_channel_binding,'{channelKey}',to_jsonb('forged'::text)) WHERE id=$1", [order.paymentId]), /immutable/);
    await assert.rejects(pool.query("UPDATE payments SET provider='TEST_PG' WHERE id=$1", [order.paymentId]), /immutable|constraint/);
    const claim = await app.inject({ method: "POST", url: `/v1/payments/${order.paymentId}/attempt`, headers });
    assert.equal(claim.statusCode, 200, claim.body);
    const again = await app.inject({ method: "POST", url: `/v1/payments/${order.paymentId}/attempt`, headers });
    assert.equal(again.statusCode, 409, again.body);
  }
  const invalid = await app.inject({ method: "POST", url: "/v1/orders", headers: { ...headers, "idempotency-key": randomUUID() }, payload: { ...payload, cardPg: "FORGED" } });
  assert.equal(invalid.statusCode, 400, invalid.body);
  const { kcpChannelKey: ignored, ...primary } = config.portOne!;
  config.portOne = primary;
  const missing = await app.inject({ method: "POST", url: "/v1/orders", headers: { ...headers, "idempotency-key": randomUUID() }, payload: { ...payload, cardPg: "KCP" } });
  assert.equal(missing.statusCode, 503, missing.body);
  const stock = await pool.query("SELECT reserved FROM product_stock WHERE product_id=$1", [product]);
  assert.equal(stock.rows[0].reserved, 2);
  const order = (await pool.query<{ id: string }>("INSERT INTO orders(user_id,subtotal,total) VALUES($1,6000,6000) RETURNING id", [user.id])).rows[0]!;
  await assert.rejects(pool.query("INSERT INTO payments(order_id,provider,amount) VALUES($1,'PORTONE_V2_KCP',6000)", [order.id]), /constraint/);
  const malformed = { ...selectCardChannel(config), provider: "PORTONE_V2_KCP", pgProvider: "KCP_V2", channelKey: null };
  await assert.rejects(pool.query("INSERT INTO payments(order_id,provider,amount,portone_channel_binding) VALUES($1,'PORTONE_V2_KCP',6000,$2)", [order.id, JSON.stringify(malformed)]), /constraint/);
});
