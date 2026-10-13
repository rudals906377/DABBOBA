import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createDatabasePool } from "@dabboba/db";
import { historicalOrderFixture } from "../legacy-order.integration-fixtures.js";
import type { ApiConfig } from "@dabboba/config";
import { buildApp } from "../app.js";
import { acceptRequiredPoliciesForIntegrationTest, acceptUgcOperationsPolicyForIntegrationTest } from "../integration-test-fixtures.js";
import { applyCanonicalPaymentEventInTransaction, parseCanonicalPaymentEvent } from "./commerce.js";

type SessionForExchange = {token:string;actor:{userId:string}};
const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;
test("historical DIRECT orders recover, refund and exchange without reopening new exact-item sales", {skip: !databaseUrl, timeout: 60_000}, async t => {
  const pool = createDatabasePool(databaseUrl!, "dabboba-direct-purchase-test");
  const config: ApiConfig = {
    environment: "test", host: "127.0.0.1", port: 8788, databaseUrl: databaseUrl!,
    redisUrl: "redis://127.0.0.1:6379", webOrigins: ["http://127.0.0.1:4174"], adminOrigins: ["http://127.0.0.1:4180"],
    sessionTokenPepper: "direct-purchase-test-pepper", adminProxyIdentitySecret: null, sessionTtlDays: 1,
    paymentProvider: "TEST_PG", paymentWebhookSecret: "direct-purchase-test-webhook", gcsBucket: null, gcsProjectId: null, logLevel: "silent",
  };
  const {app} = await buildApp({config, pool, redis: null});
  t.after(async () => { await app.close(); await pool.end(); });
  const suffix = randomUUID().slice(0, 8);
  const ip = `direct-test-${suffix}`;
  await pool.query("INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1::text,$1::text,'선택 구매 검증','Direct purchase')", [ip]);
  const response = await app.inject({method: "POST", url: "/v1/auth/dev-session", payload: {email: `${suffix}@example.test`}});
  assert.equal(response.statusCode, 201, response.body);
  const session = response.json() as {token: string; actor: {userId: string}};
  await acceptRequiredPoliciesForIntegrationTest(pool, session.actor.userId);
  await pool.query("INSERT INTO point_accounts(user_id,balance) VALUES($1,10000) ON CONFLICT(user_id) DO UPDATE SET balance=10000", [session.actor.userId]);
  async function product(label: string, direct = true, stock = 2) {
    const id = `direct-test-${label}-${suffix}`;
    await pool.query(`INSERT INTO catalog_products(id,sku,ip_id,category,name,price,image_url,metadata,sale_status)
      VALUES($1::text,$1::text,$2,'gacha',$3,100,'https://example.test/product.webp',$4::jsonb,'COMING_SOON')`, [id, ip, label, JSON.stringify({purchaseMode: "DIRECT"})]);
    await pool.query("INSERT INTO product_stock(product_id,on_hand) VALUES($1,$2)", [id, stock]);
    await pool.query("UPDATE catalog_products SET sale_status='ON_SALE' WHERE id=$1", [id]);
    if (!direct) await pool.query("UPDATE catalog_products SET metadata='{}'::jsonb WHERE id=$1", [id]);
    return id;
  }
  const chosen = await product("chosen");
  const other = await product("other");
  const oldRandom = await product("legacy", false);
  const create = (productId: string, key: string, quantity = 1, pointAmount = quantity * 100, extra = {}) => app.inject({
    method: "POST", url: "/v1/orders", headers: {authorization: `Bearer ${session.token}`, "idempotency-key": key},
    payload: {items: [{productId, quantity, ...extra}], pointAmount},
  });
  const legacy = await create(oldRandom, `direct-legacy-${suffix}`);
  assert.equal(legacy.statusCode, 409, legacy.body);
  const odds = await create(chosen, `direct-odds-${suffix}`, 1, 100, {expectedDrawVersion: 1});
  assert.equal(odds.statusCode, 409, odds.body);
  const key = `direct-chosen-${suffix}`;
  const oldCreate = (productId:string, key:string, quantity=1, pointAmount=quantity*100) => historicalOrderFixture(app,pool,config,{headers:{authorization:`Bearer ${session.token}`,"idempotency-key":key},payload:{items:[{productId,quantity}],pointAmount}});
  const paid = await oldCreate(chosen, key, 2);
  assert.equal(paid.statusCode, 201, paid.body);
  const order = paid.json();
  assert.equal(order.status, "PAID");
  assert.deepEqual(order.drawEntitlementIds, []);
  assert.equal(order.lines[0].productId, chosen);
  assert.equal(order.lines[0].quantity, 2);
  const stored=await app.inject({method:"GET",url:"/v1/account/inventory",headers:{authorization:`Bearer ${session.token}`}});
  assert.equal(stored.statusCode,200,stored.body);
  assert.ok(stored.json().items.filter((item:{product:{id:string}})=>item.product.id===chosen).length===2);
  const ownedDetail=await app.inject({method:"GET",url:`/v1/account/owned-products/${chosen}`,headers:{authorization:`Bearer ${session.token}`}});
  assert.equal(ownedDetail.statusCode,200,ownedDetail.body);
  assert.equal(ownedDetail.json().id,chosen);

  const replay = await create(chosen, key, 2);
  assert.equal(replay.statusCode, 201, replay.body);
  assert.equal(replay.json().id, order.id);
  const inventory = await pool.query("SELECT product_id,source_type,status FROM inventory_units WHERE owner_id=$1", [session.actor.userId]);
  assert.equal(inventory.rowCount, 2);
  assert.ok(inventory.rows.every(row => row.product_id === chosen && row.source_type === "PURCHASE" && row.status === "OWNED"));
  assert.equal((await pool.query("SELECT on_hand FROM product_stock WHERE product_id=$1", [other])).rows[0].on_hand, 2);
  assert.equal((await create(chosen, `direct-soldout-${suffix}`)).statusCode, 409);
  // Provider reconciliation uses the immutable line binding, not the gacha merchandise label.
  const {withTransaction} = await import("@dabboba/db");
  const refundEvent = parseCanonicalPaymentEvent("INTERNAL_ZERO", {paymentId: order.paymentId, eventId: `direct-refund-${suffix}`, eventType: "REFUND_SUCCEEDED", amount: 0, occurredAt: new Date().toISOString()}, "test-verified");
  await withTransaction(pool, client => applyCanonicalPaymentEventInTransaction(client, refundEvent, randomUUID()));
  const refunded = await pool.query("SELECT status FROM orders WHERE id=$1", [order.id]);
  assert.equal(refunded.rows[0].status, "REFUNDED");
  assert.equal((await pool.query("SELECT on_hand FROM product_stock WHERE product_id=$1", [chosen])).rows[0].on_hand, 2);
  assert.equal((await pool.query("SELECT balance FROM point_accounts WHERE user_id=$1", [session.actor.userId])).rows[0].balance, 10000);
  // Concurrent purchases of the final unit cannot create two units of inventory.
  const last = await product("last", true, 1);
  await oldCreate(last,`historical-last-${suffix}`);
  const concurrent = await Promise.all([create(last, `direct-last-a-${suffix}`), create(last, `direct-last-b-${suffix}`)]);
  assert.deepEqual(concurrent.map(result => result.statusCode).sort(), [409, 409]);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM inventory_units WHERE product_id=$1", [last])).rows[0].count, 1);
  await acceptUgcOperationsPolicyForIntegrationTest(pool, session.actor.userId);
  const buyerResponse = await app.inject({method:"POST",url:"/v1/auth/dev-session",payload:{email:`other-${suffix}@example.test`}});
  assert.equal(buyerResponse.statusCode,201,buyerResponse.body);
  const buyer = buyerResponse.json() as SessionForExchange;
  await acceptRequiredPoliciesForIntegrationTest(pool,buyer.actor.userId);
  await acceptUgcOperationsPolicyForIntegrationTest(pool,buyer.actor.userId);
  await pool.query("INSERT INTO point_accounts(user_id,balance) VALUES($1,10000) ON CONFLICT(user_id) DO UPDATE SET balance=10000",[buyer.actor.userId]);
  const buyerOrder=await historicalOrderFixture(app,pool,config,{headers:{authorization:`Bearer ${buyer.token}`,"idempotency-key":`direct-buyer-${suffix}`},payload:{items:[{productId:other,quantity:1}],pointAmount:100}});
  assert.equal(buyerOrder.statusCode,201,buyerOrder.body);
  const ownInventory=(await pool.query("SELECT id FROM inventory_units WHERE product_id=$1 AND owner_id=$2 AND status='OWNED'",[last,session.actor.userId])).rows[0].id;
  const otherInventory=(await pool.query("SELECT id FROM inventory_units WHERE product_id=$1 AND owner_id=$2 AND status='OWNED'",[other,buyer.actor.userId])).rows[0].id;
  const mutate=(token:string,url:string,payload:Record<string,unknown>={})=>app.inject({method:"POST",url,headers:{authorization:`Bearer ${token}`,"idempotency-key":`exchange-${randomUUID()}`},payload});
  const choices=await app.inject({method:"GET",url:"/v1/exchange/inventory",headers:{authorization:`Bearer ${session.token}`}});
  assert.equal(choices.statusCode,200,choices.body);
  assert.ok(choices.json().items.some((item:{id:string})=>item.id===ownInventory));
  const listing=await mutate(session.token,"/v1/exchange/listings",{title:"선택 상품 교환",details:"구매한 상품끼리 교환합니다.",offeredInventoryUnitIds:[ownInventory]});
  assert.equal(listing.statusCode,201,listing.body);
  const listingId=listing.json().id;
  const visible=await app.inject({method:"GET",url:`/v1/exchange/listings/${listingId}`});
  assert.equal(visible.statusCode,200,visible.body);
  const offer=await mutate(buyer.token,`/v1/exchange/listings/${listingId}/offers`,{offeredInventoryUnitIds:[otherInventory]});
  assert.equal(offer.statusCode,201,offer.body);
  const decision=await mutate(session.token,`/v1/exchange/listings/${listingId}/offers/${offer.json().id}/decision`,{decision:"ACCEPTED"});
  assert.equal(decision.statusCode,200,decision.body);
  assert.equal((await mutate(session.token,`/v1/exchange/listings/${listingId}/completion-confirmation`)).statusCode,200);
  const completed=await mutate(buyer.token,`/v1/exchange/listings/${listingId}/completion-confirmation`);
  assert.equal(completed.statusCode,200,completed.body);
  assert.equal(completed.json().status,"COMPLETED");
  const transferred=(await pool.query("SELECT owner_id,status FROM inventory_units WHERE id=$1",[ownInventory])).rows[0];
  assert.equal(transferred.owner_id,buyer.actor.userId);
  assert.equal(transferred.status,"OWNED");
  const notOriginal=await app.inject({method:"GET",url:"/v1/exchange/inventory",headers:{authorization:`Bearer ${buyer.token}`}});
  assert.ok(!notOriginal.json().items.some((item:{id:string})=>item.id===ownInventory));
  const pointReturn=await mutate(buyer.token,"/v1/account/point-returns",{inventoryUnitIds:[ownInventory]});
  assert.equal(pointReturn.statusCode,503,pointReturn.body);
  assert.equal(pointReturn.json().error.code,"FEATURE_UNAVAILABLE");
  const cardProduct=await product("card");
  const cardOrder=await oldCreate(cardProduct,`direct-card-${suffix}`,1,0);
  assert.equal(cardOrder.statusCode,201,cardOrder.body);
  assert.equal(cardOrder.json().status,"PENDING_PAYMENT");
  const cardEvent=parseCanonicalPaymentEvent("TEST_PG",{eventId:`direct-card-paid-${suffix}`,eventType:"PAYMENT_SUCCEEDED",paymentId:cardOrder.json().paymentId,providerPaymentId:`simulated-direct-card-${suffix}`,amount:100,occurredAt:new Date().toISOString()},"fixture-verified-provider");
  await withTransaction(pool,client=>applyCanonicalPaymentEventInTransaction(client,cardEvent,randomUUID()));
  await withTransaction(pool,client=>applyCanonicalPaymentEventInTransaction(client,cardEvent,randomUUID()));
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM inventory_units WHERE product_id=$1",[cardProduct])).rows[0].count,1);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM draw_entitlements e JOIN order_lines l ON l.id=e.order_line_id WHERE l.order_id=$1",[cardOrder.json().id])).rows[0].count,0);
  const cardInventory=(await pool.query("SELECT id FROM inventory_units WHERE product_id=$1",[cardProduct])).rows[0].id;
  await pool.query("INSERT INTO default_shipping_addresses(user_id,recipient,phone,postal_code,address_line1) VALUES($1,'구매 검증','01012345678','06236','서울특별시 강남구 테헤란로 1')",[session.actor.userId]);
  await pool.query("UPDATE orders SET status='REFUND_REVIEW' WHERE id=$1",[cardOrder.json().id]);
  const frozenQuote=await mutate(session.token,"/v1/account/shipping-quotes",{inventoryUnitIds:[cardInventory]});
  assert.equal(frozenQuote.statusCode,409,frozenQuote.body);
  await pool.query("UPDATE orders SET status='PAID' WHERE id=$1",[cardOrder.json().id]);
  const shippingQuote=await mutate(session.token,"/v1/account/shipping-quotes",{inventoryUnitIds:[cardInventory]});
  assert.equal(shippingQuote.statusCode,200,shippingQuote.body);
  assert.equal(shippingQuote.json().referenceSubtotal,100);
  const shipping=await mutate(session.token,"/v1/account/shipping-requests",{quoteId:shippingQuote.json().id,addressVersion:shippingQuote.json().addressVersion});
  assert.equal(shipping.statusCode,201,shipping.body);
  assert.equal((await pool.query("SELECT status FROM inventory_units WHERE id=$1",[cardInventory])).rows[0].status,"SHIPPING");
});

test("catalog transition copies exact choices without inventing individual stock or changing prize history", {skip: !databaseUrl}, async t => {
  const pool = createDatabasePool(databaseUrl!, "dabboba-direct-catalog-test");
  t.after(() => pool.end());
  const suffix = randomUUID().slice(0, 8);
  const parent = `direct-parent-${suffix}`, prize = `${parent}-prize-01`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1::text,$1::text,'선택 전환','Choice')", [parent]);
    await client.query("INSERT INTO catalog_products(id,sku,ip_id,category,name,price,sale_status) VALUES($1::text,$1::text,$1,'gacha','시리즈',5000,'COMING_SOON')", [parent]);
    await client.query("INSERT INTO product_stock(product_id,on_hand) VALUES($1,100)", [parent]);
    await client.query("INSERT INTO catalog_products(id,sku,ip_id,category,name,price,is_prize_only,metadata) VALUES($1::text,$1::text,$2,'gacha','선택 종류',5000,true,$3)", [prize, parent, JSON.stringify({parentProductId: parent})]);
    const sql = await readFile(new URL("../../../../packages/db/migrations/0098_direct_product_purchase.sql", import.meta.url), "utf8");
    await client.query(sql);
    const choice = (await client.query("SELECT p.*,s.on_hand FROM catalog_products p JOIN product_stock s ON s.product_id=p.id WHERE p.id=$1", [`direct-${prize}`])).rows[0];
    assert.equal(choice.price, 5000);
    assert.equal(choice.metadata.purchaseMode, "DIRECT");
    assert.equal(choice.sale_status, "COMING_SOON");
    assert.equal(choice.on_hand, 0);
    assert.equal((await client.query("SELECT is_prize_only FROM catalog_products WHERE id=$1", [prize])).rows[0].is_prize_only, true);
    assert.equal((await client.query("SELECT on_hand FROM product_stock WHERE product_id=$1", [parent])).rows[0].on_hand, 100);
    await client.query("ROLLBACK");
  } finally { await client.query("ROLLBACK"); client.release(); }
});

test("owner-confirmed launch choices initialize at 20 units and never reset adjusted stock", {skip: !databaseUrl}, async t => {
  const manifest = JSON.parse(await readFile(new URL("../../../../ops/catalog/direct-launch-stock-2026-10-13.json", import.meta.url), "utf8"));
  assert.equal(manifest.items.length, 46);
  assert.equal(new Set(manifest.items.map((item: {productId: string}) => item.productId)).size, 46);
  assert.equal(manifest.items.reduce((sum: number, item: {targetOnHand: number}) => sum + item.targetOnHand, 0), 920);
  assert.ok(manifest.items.every((item: {targetOnHand: number; saleStatus: string}) => item.targetOnHand === 20 && item.saleStatus === "COMING_SOON"));
  const pool = createDatabasePool(databaseUrl!, "dabboba-direct-stock-test");
  t.after(() => pool.end());
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const choice = manifest.items[0];
    await client.query("INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES('direct-stock-test','direct-stock-test','수량 검증','Stock') ON CONFLICT DO NOTHING");
    await client.query("INSERT INTO catalog_products(id,sku,ip_id,category,name,price,sale_status) VALUES($1::text,$1::text,'direct-stock-test','gacha','시리즈',6000,'COMING_SOON') ON CONFLICT DO NOTHING", [choice.parentProductId]);
    await client.query("INSERT INTO product_stock(product_id,on_hand) VALUES($1,50) ON CONFLICT DO NOTHING", [choice.parentProductId]);
    await client.query("INSERT INTO catalog_products(id,sku,ip_id,category,name,price,is_prize_only,metadata) VALUES($1::text,$1::text,'direct-stock-test','gacha','1',6000,true,$2::jsonb) ON CONFLICT DO NOTHING", [choice.sourcePrizeProductId,JSON.stringify({parentProductId:choice.parentProductId})]);
    const before = (await client.query("SELECT on_hand FROM product_stock WHERE product_id=$1", [choice.parentProductId])).rows[0].on_hand;
    const sql = await readFile(new URL("../../../../packages/db/migrations/0098_direct_product_purchase.sql", import.meta.url), "utf8");
    await client.query(sql);
    assert.equal((await client.query("SELECT on_hand FROM product_stock WHERE product_id=$1", [choice.productId])).rows[0].on_hand,20);
    assert.equal((await client.query("SELECT sale_status FROM catalog_products WHERE id=$1", [choice.productId])).rows[0].sale_status,"COMING_SOON");
    assert.equal((await client.query("SELECT on_hand FROM product_stock WHERE product_id=$1", [choice.parentProductId])).rows[0].on_hand,before);
    await client.query("UPDATE product_stock SET on_hand=17 WHERE product_id=$1", [choice.productId]);
    await client.query(sql);
    assert.equal((await client.query("SELECT on_hand FROM product_stock WHERE product_id=$1", [choice.productId])).rows[0].on_hand,17);
  } finally {await client.query("ROLLBACK"); client.release();}
});
