import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import { buildApp } from "../app.js";
import { issueSession } from "../plugins/auth.js";
import { acceptRequiredPoliciesForIntegrationTest } from "../integration-test-fixtures.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;
test("shared NICE and Toss review issues included-product draw rights once, releases uncharged stock and holds uncertain confirmations", { skip: !databaseUrl, timeout: 60000 }, async (t) => {
  const pool = createDatabasePool(databaseUrl!, "dabboba-toss-review-test");
  const config = { environment: "test", environmentTier: "STAGING", surface: "all", host: "127.0.0.1", port: 8788,
    databaseUrl: databaseUrl!, redisUrl: null, webOrigins: [], adminOrigins: [], sessionTokenPepper: "synthetic-toss-test-pepper",
    adminProxyIdentitySecret: null, sessionTtlDays: 1, commerceMode: "LIVE", paymentProvider: "PORTONE_V2_NICE",
    paymentWebhookSecret: "synthetic-shared-payment-hook",
    portOne:{apiSecret:"synthetic-portone-secret",webhookSecret:"synthetic-portone-webhook",merchantId:"merchant-synthetic",storeId:"store-synthetic",channelKey:"channel-key-nice",kiccChannelKey:"channel-key-kicc",channelEnvironment:"TEST"}, tossPayments: { clientKey: "test_ck_synthetic_value_12345", secretKey: "test_sk_synthetic_value_12345",
      merchantId: "test_mid", environment: "TEST" }, gcsBucket: null, gcsProjectId: null, logLevel: "silent" } as ApiConfig;
  const { app } = await buildApp({ config, pool, redis: null });
  const realFetch = globalThis.fetch;
  t.after(async () => { globalThis.fetch = realFetch; await app.close(); await pool.end(); });
  const suffix = randomUUID().slice(0,8);
  const firstKey = `payment_key_first_${suffix}`, thirdKey = `payment_key_third_${suffix}`;
  const user = (await pool.query<{ id: string }>("INSERT INTO users(email,nickname) VALUES($1,'토스 심사 시험') RETURNING id", [`toss-${suffix}@example.test`])).rows[0]!;
  await acceptRequiredPoliciesForIntegrationTest(pool, user.id);
  const session = await issueSession(pool, config, { userId: user.id, kind: "USER", ip: "127.0.0.1", userAgent: "Toss integration" });
  const headers = { authorization: `Bearer ${session.token}` };
  const ip = `toss-ip-${suffix}`, product = `toss-gacha-${suffix}`, prize = `toss-prize-${suffix}`;
  await pool.query("INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1::text,$1::text,'토스 시험','Toss test')", [ip]);
  await pool.query("INSERT INTO catalog_products(id,sku,ip_id,category,name,price,metadata) VALUES($1::text,$1::text,$2,'gacha','토스 시험',7000,$3::jsonb)", [product, ip,JSON.stringify({})]);
  await pool.query("INSERT INTO product_stock(product_id,on_hand) VALUES($1,6)", [product]);
  await pool.query("INSERT INTO catalog_products(id,sku,ip_id,category,name,price,is_prize_only) VALUES($1::text,$1::text,$2,'figure','경품',7000,true)", [prize, ip]);
  const version = (await pool.query<{ id: string }>("INSERT INTO draw_probability_versions(product_id,version) VALUES($1,1) RETURNING id", [product])).rows[0]!;
  await pool.query(`INSERT INTO draw_pool_entries(probability_version_id,prize_product_id,prize_name_snapshot,prize_sku_snapshot,prize_ip_id_snapshot,prize_category_snapshot,rarity,weight,initial_quantity,remaining_quantity)
    VALUES($1,$2::text,'경품',$2::text,$3,'figure','A',1,6,6)`, [version.id, prize, ip]);
  await pool.query("UPDATE draw_probability_versions SET status='ACTIVE',published_by=$2,published_at=now() WHERE id=$1", [version.id, user.id]);
  await pool.query("UPDATE catalog_products SET image_url='https://cdn.example.test/toss.png',sale_status='ON_SALE' WHERE id=$1", [product]);
  let nicePaidId: string | null=null; let secondNicePaidId:string|null=null; const niceLookups:string[]=[];
  const paid = new Map<string, Record<string, unknown>>(); let confirmCalls = 0; let loseResponse = false;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if(url.origin==="https://api.portone.io") {
      const paymentId=url.pathname.split('/').at(-1)!;niceLookups.push(paymentId);
      if(paymentId!==nicePaidId && paymentId!==secondNicePaidId)return Response.json({type:"PAYMENT_NOT_FOUND",message:"fixture not submitted"},{status:404});
      const now=new Date().toISOString();return Response.json({status:"PAID",id:paymentId,transactionId:`portone-shared-${paymentId}`,pgTxId:`portone-pg-${paymentId}`,
        merchantId:"merchant-synthetic",storeId:"store-synthetic",version:"V2",channel:{key:"channel-key-nice",type:"TEST",pgProvider:"NICE_V2",pgMerchantId:"synthetic-mid"},
        method:{type:"PaymentMethodCard",card:{number:"fixture"}},amount:{total:7000,paid:7000,cancelled:0,taxFree:0,discount:0,cancelledTaxFree:0},currency:"KRW",requestedAt:now,updatedAt:now,statusChangedAt:now,paidAt:now});
    }
    assert.equal(url.origin, "https://api.tosspayments.com");
    assert.match(new Headers(init?.headers).get("authorization") ?? "", /^Basic /);
    if (url.pathname === "/v1/payments/confirm") {
      confirmCalls += 1;
      const body = JSON.parse(String(init?.body)); assert.equal(body.amount, 7000);
      assert.equal(new Headers(init?.headers).get("Idempotency-Key"), `confirm:${body.orderId}`);
      const p = { paymentKey: body.paymentKey, orderId: body.orderId, mId: "test_mid", currency: "KRW", type: "NORMAL", method: "카드",
        status: "DONE", totalAmount: 7000, balanceAmount: 7000, requestedAt: new Date().toISOString(), approvedAt: new Date().toISOString(), lastTransactionKey: `transaction_${body.orderId}` };
      paid.set(body.orderId, p);
      if (loseResponse) { loseResponse = false; throw new Error("simulated connection loss after approval"); }
      return Response.json(p);
    }
    const id = url.pathname.split("/").at(-1)!;
    return paid.has(id) ? Response.json(paid.get(id)) : Response.json({ code: "NOT_FOUND_PAYMENT" }, { status: 404 });
  };
  const create = async () => {
    const r = await app.inject({ method: "POST", url: "/v1/orders", headers: { ...headers, "idempotency-key": randomUUID() },
      payload: { items: [{ productId: product, quantity: 1,expectedDrawVersion:1 }], pointAmount: 0,reviewPaymentProvider:"TOSSPAYMENTS_DIRECT" } });
    assert.equal(r.statusCode, 201, r.body); return r.json() as { id: string; paymentId: string };
  };
  const post = (id: string, action: string, payload = {}) => app.inject({ method: "POST", url: `/v1/review/toss-payments/${id}/${action}`, headers, payload });
  const publicConfig=await app.inject({method:"GET",url:"/v1/public/config"});
  assert.equal(publicConfig.json().cardPaymentOptions[0].provider,"PORTONE_V2_NICE");
  assert.equal(publicConfig.json().tossPayment.provider,"TOSSPAYMENTS_DIRECT");
  const niceKey=randomUUID();
  const nicePayload={items:[{productId:product,quantity:1,expectedDrawVersion:1}],pointAmount:0,reviewPaymentProvider:"PORTONE_V2_NICE",cardPg:"NICE"};
  const nice=await app.inject({method:"POST",url:"/v1/orders",headers:{...headers,"idempotency-key":niceKey},payload:nicePayload});
  assert.equal(nice.statusCode,201,nice.body);
  assert.equal(nice.json().paymentProvider,"PORTONE_V2_NICE");
  assert.equal(nice.json().cardPayment.pgProvider,"NICE_V2");
  const swapped=await app.inject({method:"POST",url:"/v1/orders",headers:{...headers,"idempotency-key":niceKey},payload:{...nicePayload,reviewPaymentProvider:"TOSSPAYMENTS_DIRECT",cardPg:undefined}});
  assert.equal(swapped.statusCode,409,swapped.body);
  const mixed=await app.inject({method:"POST",url:"/v1/orders",headers:{...headers,"idempotency-key":randomUUID()},payload:{...nicePayload,reviewPaymentProvider:"TOSSPAYMENTS_DIRECT"}});
  assert.equal(mixed.statusCode,400,mixed.body);
  const wrongRoute=await app.inject({method:"POST",url:`/v1/review/toss-payments/${nice.json().paymentId}/confirm`,headers,payload:{}});
  assert.equal(wrongRoute.statusCode,409,wrongRoute.body);
  const closedNice=await app.inject({method:"POST",url:`/v1/payments/${nice.json().paymentId}/abandon`,headers:{...headers,"idempotency-key":`shared-nice-abandon-${suffix}`},payload:{}});
  assert.equal(closedNice.statusCode,200,closedNice.body);
  const first = await create();
  assert.equal((await app.inject({ method: "POST", url: `/v1/review/toss-payments/${first.paymentId}/confirm`, payload: {} })).statusCode, 401);
  const outsider = (await pool.query<{ id: string }>("INSERT INTO users(email,nickname) VALUES($1,'다른 심사 회원') RETURNING id", [`other-toss-${suffix}@example.test`])).rows[0]!;
  await acceptRequiredPoliciesForIntegrationTest(pool, outsider.id);
  const otherSession = await issueSession(pool, config, { userId: outsider.id, kind: "USER", ip: "127.0.0.1", userAgent: "Toss integration" });
  assert.equal((await app.inject({ method: "POST", url: `/v1/review/toss-payments/${first.paymentId}/confirm`,
    headers: { authorization: `Bearer ${otherSession.token}` }, payload: {} })).statusCode, 404);
  assert.equal(confirmCalls, 0);
  const crossProvider=await app.inject({method:"POST",url:`/v1/payments/${first.paymentId}/confirm`,headers,payload:{}});
  assert.equal(crossProvider.statusCode,409,crossProvider.body);
  assert.ok(!niceLookups.includes(first.paymentId));
  assert.equal((await post(first.paymentId, "attempt")).statusCode, 200);
  assert.equal((await post(first.paymentId, "attempt")).statusCode, 409);
  assert.equal((await post(first.paymentId, "confirm", { orderId: first.paymentId, paymentKey: firstKey, amount: 1 })).statusCode, 409);
  const response = await post(first.paymentId, "confirm", { orderId: first.paymentId, paymentKey: firstKey, amount: 7000 });
  assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().status, "PAID");
  assert.equal((await post(first.paymentId, "confirm")).statusCode, 200); assert.equal(confirmCalls, 1);
  assert.equal((await pool.query("SELECT count(*)::integer AS n FROM draw_entitlements WHERE user_id=$1", [user.id])).rows[0].n, 1);
  const second = await create(); await post(second.paymentId, "attempt");
  const closed = await post(second.paymentId, "abandon"); assert.equal(closed.statusCode, 200, closed.body);
  assert.equal((await pool.query("SELECT status FROM orders WHERE id=$1", [second.id])).rows[0].status, "CANCELLED");
  const third = await create(); await post(third.paymentId, "attempt"); loseResponse = true;
  const unknown = await post(third.paymentId, "confirm", { orderId: third.paymentId, paymentKey: thirdKey, amount: 7000 });
  assert.ok(unknown.statusCode >= 400);
  assert.equal((await post(third.paymentId, "abandon")).statusCode, 409);
  const recovered = await post(third.paymentId, "confirm"); assert.equal(recovered.statusCode, 200, recovered.body);
  assert.equal(recovered.json().status, "PAID"); assert.equal(confirmCalls, 2);
  assert.equal((await pool.query("SELECT count(*)::integer AS n FROM draw_entitlements WHERE user_id=$1", [user.id])).rows[0].n, 2);
  assert.equal((await pool.query("SELECT reserved FROM product_stock WHERE product_id=$1", [product])).rows[0].reserved, 0);
  await assert.rejects(pool.query("DELETE FROM toss_review_confirm_attempts WHERE payment_id=$1", [third.paymentId]), /append-only/);
  const nicePaid=await app.inject({method:"POST",url:"/v1/orders",headers:{...headers,"idempotency-key":randomUUID()},payload:nicePayload});
  assert.equal(nicePaid.statusCode,201,nicePaid.body);nicePaidId=nicePaid.json().paymentId;
  assert.equal((await app.inject({method:"POST",url:`/v1/payments/${nicePaidId}/attempt`,headers,payload:{}})).statusCode,200);
  const niceConfirmed=await app.inject({method:"POST",url:`/v1/payments/${nicePaidId}/confirm`,headers,payload:{}});
  assert.equal(niceConfirmed.statusCode,200,niceConfirmed.body);
  const niceLookup=await app.inject({method:"GET",url:`/v1/orders/${nicePaid.json().id}`,headers});
  assert.equal(niceLookup.json().status,"PAID");assert.equal(niceLookup.json().paymentProvider,"PORTONE_V2_NICE");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM draw_entitlements WHERE user_id=$1",[user.id])).rows[0].n,3);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM inventory_units WHERE owner_id=$1 AND source_type='PURCHASE'",[user.id])).rows[0].n,0);

  // EasyPay (KICC) is retired for new payments: the API refuses it even with a configured channel key.
  const kiccPayload={...nicePayload,reviewPaymentProvider:"PORTONE_V2_KICC",cardPg:"KICC"};
  const kicc=await app.inject({method:"POST",url:"/v1/orders",headers:{...headers,"idempotency-key":randomUUID()},payload:kiccPayload});
  assert.equal(kicc.statusCode,409,kicc.body);assert.equal(kicc.json().error.code,"PAYMENT_RAIL_RETIRED");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM payments p JOIN orders o ON o.id=p.order_id WHERE o.user_id=$1 AND p.provider='PORTONE_V2_KICC'",[user.id])).rows[0].n,0);
  const nicePaid2=await app.inject({method:"POST",url:"/v1/orders",headers:{...headers,"idempotency-key":randomUUID()},payload:nicePayload});
  assert.equal(nicePaid2.statusCode,201,nicePaid2.body);secondNicePaidId=nicePaid2.json().paymentId;
  assert.equal(nicePaid2.json().cardPayment.pgProvider,"NICE_V2");
  assert.equal((await app.inject({method:"POST",url:`/v1/payments/${secondNicePaidId}/attempt`,headers,payload:{}})).statusCode,200);
  const nicePaid2Confirmed=await app.inject({method:"POST",url:`/v1/payments/${secondNicePaidId}/confirm`,headers,payload:{}});
  assert.equal(nicePaid2Confirmed.statusCode,200,nicePaid2Confirmed.body);
  const nicePaid2Order=await app.inject({method:"GET",url:`/v1/orders/${nicePaid2.json().id}`,headers});
  assert.equal(nicePaid2Order.json().drawEntitlementIds.length,1);
  const entitlementId=nicePaid2Order.json().drawEntitlementIds[0];
  const consume=()=>app.inject({method:"POST",url:`/v1/draws/${entitlementId}/consume`,headers:{...headers,"idempotency-key":`included-consume-${suffix}`},payload:{}});
  const opened=await consume();assert.equal(opened.statusCode,200,opened.body);
  assert.equal(opened.json().prizeProductId,prize);
  const replay=await consume();assert.equal(replay.statusCode,200,replay.body);assert.equal(replay.json().id,opened.json().id);
  const inventory=await pool.query("SELECT product_id,source_type FROM inventory_units WHERE owner_id=$1",[user.id]);
  assert.deepEqual(inventory.rows,[{product_id:prize,source_type:"GACHA"}]);
  const grants = (await pool.query(`SELECT
    has_table_privilege('anon','toss_review_confirm_attempts','SELECT') AS anon_read,
    has_table_privilege('authenticated','toss_review_confirm_attempts','SELECT') AS client_read,
    has_table_privilege('dabboba_worker','toss_review_confirm_attempts','INSERT') AS worker_write,
    has_table_privilege('dabboba_runtime','toss_review_confirm_attempts','INSERT') AS runtime_insert,
    has_table_privilege('dabboba_runtime','toss_review_confirm_attempts','UPDATE') AS runtime_update`)).rows[0];
  assert.deepEqual(grants, { anon_read: false, client_read: false, worker_write: false, runtime_insert: true, runtime_update: false });
});
