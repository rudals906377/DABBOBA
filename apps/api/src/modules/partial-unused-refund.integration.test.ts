import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool, type DatabasePool } from "@dabboba/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { acceptRequiredPoliciesForIntegrationTest } from "../integration-test-fixtures.js";
import { issueSession } from "../plugins/auth.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;

function baseConfig(label: string): ApiConfig {
  return {
    environment: "test", host: "127.0.0.1", port: 8788, databaseUrl: databaseUrl!, redisUrl: "redis://127.0.0.1:6379",
    webOrigins: ["http://127.0.0.1:4174"], adminOrigins: ["http://127.0.0.1:4180"],
    sessionTokenPepper: `${label}-pepper`, adminProxyIdentitySecret: null,
    sessionTtlDays: 1, commerceMode: "LIVE", paymentProvider: "TEST_PG",
    paymentWebhookSecret: `${label}-webhook-secret`,
    gcsBucket: null, gcsProjectId: null, logLevel: "silent",
  };
}

function portOneConfig(label: string): ApiConfig {
  return {
    ...baseConfig(label),
    paymentProvider: "PORTONE_V2_INICIS",
    portOne: {
      apiSecret: "synthetic-secret", merchantId: "synthetic-merchant", storeId: "synthetic-store",
      channelKey: "synthetic-channel", channelEnvironment: "TEST", webhookSecret: `${label}-webhook-secret`,
    },
    paymentWebhookSecret: `${label}-webhook-secret`,
  };
}

type Fixture = {
  suffix: string;
  ipId: string;
  customerId: string;
  publisherId: string;
  customerAuth: { authorization: string };
  adminAuth: (reason: string, key?: string) => Record<string, string>;
};

async function createFixture(pool: DatabasePool, config: ApiConfig, label: string, startingPoints: number): Promise<Fixture> {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const customer = await pool.query<{ id: string }>(
    "INSERT INTO users(email,nickname,role,status) VALUES($1,'Partial refund customer','USER','ACTIVE') RETURNING id",
    [`${label}-customer-${suffix}@example.test`],
  );
  const customerId = customer.rows[0]!.id;
  await acceptRequiredPoliciesForIntegrationTest(pool, customerId);
  const customerSession = await issueSession(pool, config, { userId: customerId, kind: "USER", ip: "203.0.113.81", userAgent: "Partial refund test" });
  const superAdmin = await pool.query<{ id: string }>(
    "INSERT INTO users(email,nickname,role,status) VALUES($1,'Partial refund supervisor','SUPER_ADMIN','ACTIVE') RETURNING id",
    [`${label}-super-admin-${suffix}@example.test`],
  );
  const adminSession = await issueSession(pool, config, { userId: superAdmin.rows[0]!.id, kind: "ADMIN", ip: "203.0.113.82", userAgent: "Partial refund test" });
  const ipId = `${label}-ip-${suffix}`;
  await pool.query("INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$3)", [ipId, ipId, `부분 환불 ${suffix}`]);
  await pool.query("INSERT INTO point_accounts(user_id,balance) VALUES($1,$2)", [customerId, startingPoints]);
  if (startingPoints > 0) {
    await pool.query(
      `INSERT INTO point_ledger_entries(user_id,entry_type,amount,reference_type,reference_id,reason)
       VALUES($1,'EARN',$2,'TEST',$3,'Partial refund integration setup')`,
      [customerId, startingPoints, suffix],
    );
  }
  return {
    suffix, ipId, customerId, publisherId: superAdmin.rows[0]!.id,
    customerAuth: { authorization: `Bearer ${customerSession.token}` },
    adminAuth: (reason, key = randomUUID()) => ({
      authorization: `Bearer ${adminSession.token}`, "x-admin-reason": reason, "idempotency-key": key,
    }),
  };
}

async function createGachaProduct(pool: DatabasePool, fixture: Fixture, input: { label: string; price: number; onHand: number }) {
  const productId = `${input.label}-${fixture.suffix}`;
  const prizeId = `${input.label}-prize-${fixture.suffix}`;
  const prizeSku = `${input.label}-PRIZE-${fixture.suffix}`.toUpperCase();
  await pool.query(
    "INSERT INTO catalog_products(id,sku,ip_id,category,name,price,is_prize_only) VALUES($1,$2,$3,'figure',$4,0,true)",
    [prizeId, prizeSku, fixture.ipId, `부분 환불 경품 ${fixture.suffix}`],
  );
  await pool.query(
    "INSERT INTO catalog_products(id,sku,ip_id,category,name,price,image_url) VALUES($1,$2,$3,'gacha',$4,$5,$6)",
    [productId, `${input.label}-${fixture.suffix}`.toUpperCase(), fixture.ipId, `부분 환불 가챠 ${fixture.suffix}`,
      input.price, `https://cdn.example.test/${productId}.png`],
  );
  await pool.query("INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,$2,0)", [productId, input.onHand]);
  const version = await pool.query<{ id: string }>(
    "INSERT INTO draw_probability_versions(product_id,version) VALUES($1,1) RETURNING id", [productId],
  );
  await pool.query(
    `INSERT INTO draw_pool_entries(probability_version_id,prize_product_id,prize_name_snapshot,
      prize_sku_snapshot,prize_ip_id_snapshot,prize_category_snapshot,rarity,weight,initial_quantity,remaining_quantity)
     VALUES($1,$2,$3,$4,$5,'figure','A',1,20,20)`,
    [version.rows[0]!.id, prizeId, `부분 환불 경품 ${fixture.suffix}`, prizeSku, fixture.ipId],
  );
  await pool.query(
    "UPDATE draw_probability_versions SET status='ACTIVE',published_by=$2,published_at=now() WHERE id=$1",
    [version.rows[0]!.id, fixture.publisherId],
  );
  await pool.query("UPDATE catalog_products SET sale_status='ON_SALE' WHERE id=$1", [productId]);
  return productId;
}

type OrderBody = { id: string; paymentId: string; status: string; total: number; pointTotal: number; drawEntitlementIds: string[] };

async function placeOrder(app: FastifyInstance, fixture: Fixture, input: { productId: string; quantity: number; pointAmount: number }) {
  const response = await app.inject({
    method: "POST", url: "/v1/orders",
    headers: { ...fixture.customerAuth, "idempotency-key": randomUUID() },
    payload: { items: [{ productId: input.productId, quantity: input.quantity, expectedDrawVersion: 1 }], pointAmount: input.pointAmount },
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json() as OrderBody;
}

async function entitlementIds(pool: DatabasePool, orderId: string) {
  const result = await pool.query<{ id: string }>(
    `SELECT e.id FROM draw_entitlements e JOIN order_lines line ON line.id=e.order_line_id
      WHERE line.order_id=$1 ORDER BY e.created_at,e.id`,
    [orderId],
  );
  return result.rows.map((row) => row.id);
}

async function consume(app: FastifyInstance, fixture: Fixture, entitlementId: string) {
  return app.inject({
    method: "POST", url: `/v1/draws/${entitlementId}/consume`,
    headers: { ...fixture.customerAuth, "idempotency-key": randomUUID() }, payload: {},
  });
}

type State = {
  payment_status: string; order_status: string; entitlements: string[]; on_hand: number; balance: number;
  point_refund: number; card_refund: number; partial_outbox: string; plan_status: string | null;
};

async function state(pool: DatabasePool, orderId: string, productId: string): Promise<State> {
  const result = await pool.query<State>(
    `SELECT p.status AS payment_status,o.status AS order_status,
       ARRAY(SELECT e.status FROM draw_entitlements e JOIN order_lines line ON line.id=e.order_line_id
         WHERE line.order_id=o.id ORDER BY e.status) AS entitlements,
       s.on_hand,a.balance,
       COALESCE((SELECT sum(l.amount)::integer FROM point_ledger_entries l
         WHERE l.user_id=o.user_id AND l.entry_type='REFUND' AND l.reference_type='ORDER_PARTIAL_REFUND' AND l.reference_id=o.id::text),0) AS point_refund,
       COALESCE((SELECT sum(l.amount)::integer FROM payment_ledger_entries l WHERE l.payment_id=p.id AND l.entry_type='REFUND'),0) AS card_refund,
       (SELECT count(*)::text FROM outbox_events ob
         WHERE ob.aggregate_type='ORDER' AND ob.aggregate_id=o.id::text AND ob.event_type='order.partially_refunded') AS partial_outbox,
       (SELECT r.status FROM partial_unused_draw_refunds r WHERE r.payment_id=p.id) AS plan_status
     FROM orders o JOIN payments p ON p.order_id=o.id
     JOIN product_stock s ON s.product_id=$2 JOIN point_accounts a ON a.user_id=o.user_id
     WHERE o.id=$1`,
    [orderId, productId],
  );
  return result.rows[0]!;
}

function portOnePayment(input: { paymentId: string; suffix: string; total: number; cancelled: number; timestamp: string }) {
  return {
    id: input.paymentId, transactionId: `portone-${input.suffix}`, pgTxId: `kg-${input.suffix}`,
    merchantId: "synthetic-merchant", storeId: "synthetic-store", version: "V2",
    channel: { key: "synthetic-channel", type: "TEST", pgProvider: "INICIS_V2" },
    method: { type: "PaymentMethodCard" }, status: input.cancelled > 0 ? "PARTIAL_CANCELLED" : "PAID",
    amount: { total: input.total, paid: input.total, cancelled: input.cancelled }, currency: "KRW",
    requestedAt: input.timestamp, statusChangedAt: input.timestamp, paidAt: input.timestamp,
    cancelledAt: input.cancelled > 0 ? input.timestamp : null,
    cancellations: input.cancelled > 0 ? [{
      status: "SUCCEEDED", id: `cancel-partial-${input.suffix}`, totalAmount: input.cancelled,
      requestedAt: input.timestamp, cancelledAt: input.timestamp,
    }] : [],
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("a partly used card and points gacha order refunds only its unused draws after PortOne confirms the partial cancel", {
  skip: !databaseUrl,
  timeout: 60_000,
}, async (t) => {
  const pool = createDatabasePool(databaseUrl!, "dabboba-partial-unused-refund-integration");
  const config = portOneConfig("partial-unused-refund");
  const { app } = await buildApp({ config, pool, redis: null });
  t.after(async () => { await app.close(); await pool.end(); });
  const fixture = await createFixture(pool, config, "partial-refund", 3_000);
  const productId = await createGachaProduct(pool, fixture, { label: "partial-refund-gacha", price: 3_000, onHand: 5 });
  const order = await placeOrder(app, fixture, { productId, quantity: 3, pointAmount: 1_000 });
  assert.equal(order.total, 8_000);
  const attempt = await app.inject({ method: "POST", url: `/v1/payments/${order.paymentId}/attempt`, headers: fixture.customerAuth });
  assert.equal(attempt.statusCode, 200, attempt.body);

  const timestamp = (await pool.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now.toISOString();
  let cancelled = 0;
  const cancelBodies: Array<{ amount: number; currentCancellableAmount: number }> = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    assert.match(String(input), new RegExp(order.paymentId));
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { amount: number; currentCancellableAmount: number };
      cancelBodies.push({ amount: body.amount, currentCancellableAmount: body.currentCancellableAmount });
      cancelled = body.amount;
      return json({ cancellation: {
        status: "SUCCEEDED", id: `cancel-partial-${fixture.suffix}`, totalAmount: body.amount,
        taxFreeAmount: 0, vatAmount: 0, reason: "미사용 뽑기 환불", requestedAt: timestamp, cancelledAt: timestamp,
      } });
    }
    return json(portOnePayment({ paymentId: order.paymentId, suffix: fixture.suffix, total: 8_000, cancelled, timestamp }));
  });
  const confirmed = await app.inject({ method: "POST", url: `/v1/payments/${order.paymentId}/confirm`, headers: fixture.customerAuth });
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  const issued = await entitlementIds(pool, order.id);
  assert.equal(issued.length, 3);
  assert.equal((await consume(app, fixture, issued[0]!)).statusCode, 200);
  const before = await state(pool, order.id, productId);
  assert.deepEqual(before.entitlements, ["AVAILABLE", "AVAILABLE", "CONSUMED"]);
  assert.equal(before.balance, 2_000);

  const detail = await app.inject({
    method: "GET", url: `/v1/admin/commerce/payments/${order.paymentId}`, headers: { authorization: fixture.adminAuth("조회").authorization! },
  });
  assert.equal(detail.statusCode, 200, detail.body);
  const partial = (detail.json() as { partialRefund: { available: boolean; preview: unknown } }).partialRefund;
  assert.equal(partial.available, true);
  assert.deepEqual(partial.preview, { totalDrawUnits: 3, unusedDrawUnits: 2, cardRefundAmount: 5_333, pointRefundAmount: 667 });

  const reason = "고객 요청 미사용 뽑기 환불";
  const key = randomUUID();
  const refunded = await app.inject({
    method: "POST", url: `/v1/admin/commerce/payments/${order.paymentId}/partial-refund`,
    headers: fixture.adminAuth(reason, key), payload: { reason },
  });
  assert.equal(refunded.statusCode, 202, refunded.body);
  assert.equal((refunded.json() as { status: string }).status, "APPLIED");
  assert.deepEqual(cancelBodies, [{ amount: 5_333, currentCancellableAmount: 8_000 }]);
  const after = await state(pool, order.id, productId);
  assert.deepEqual(after, {
    payment_status: "PAID", order_status: "PAID", entitlements: ["CANCELLED", "CANCELLED", "CONSUMED"],
    on_hand: before.on_hand + 2, balance: 2_667, point_refund: 667, card_refund: -5_333, partial_outbox: "1", plan_status: "APPLIED",
  });

  // Replays and repeats never send a second cancellation or credit.
  const replay = await app.inject({
    method: "POST", url: `/v1/admin/commerce/payments/${order.paymentId}/partial-refund`,
    headers: fixture.adminAuth(reason, key), payload: { reason },
  });
  assert.equal(replay.statusCode, 202, replay.body);
  assert.equal(replay.headers["x-idempotent-replay"], "true");
  const again = await app.inject({
    method: "POST", url: `/v1/admin/commerce/payments/${order.paymentId}/partial-refund`,
    headers: fixture.adminAuth(reason), payload: { reason },
  });
  assert.equal(again.statusCode, 409, again.body);
  const full = await app.inject({
    method: "POST", url: `/v1/admin/commerce/payments/${order.paymentId}/refund`,
    headers: fixture.adminAuth(reason), payload: { reason },
  });
  assert.equal(full.statusCode, 409, full.body);
  assert.equal((await consume(app, fixture, issued[1]!)).statusCode, 409);
  // A later provider read of the same partial cancellation is not a review item.
  const requery = await app.inject({
    method: "POST", url: `/v1/admin/commerce/payments/${order.paymentId}/reconcile`,
    headers: fixture.adminAuth("결제 상태 재확인"), payload: { reason: "결제 상태 재확인" },
  });
  assert.equal(requery.statusCode, 200, requery.body);
  assert.deepEqual(await state(pool, order.id, productId), after);
  assert.equal(cancelBodies.length, 1);

  const orders = await app.inject({ method: "GET", url: "/v1/account/orders", headers: fixture.customerAuth });
  assert.equal(orders.statusCode, 200, orders.body);
  const listed = (orders.json() as { items: Array<{ id: string; partialRefund: unknown }> }).items.find((item) => item.id === order.id);
  assert.deepEqual(
    (({ cardAmount, pointAmount, drawUnits }) => ({ cardAmount, pointAmount, drawUnits }))(listed!.partialRefund as { cardAmount: number; pointAmount: number; drawUnits: number }),
    { cardAmount: 5_333, pointAmount: 667, drawUnits: 2 },
  );
});

test("a partly used points-only gacha order returns the unused share as points without a provider call", {
  skip: !databaseUrl,
  timeout: 60_000,
}, async (t) => {
  const pool = createDatabasePool(databaseUrl!, "dabboba-partial-point-refund-integration");
  const config = baseConfig("partial-point-refund");
  const { app } = await buildApp({ config, pool, redis: null });
  t.after(async () => { await app.close(); await pool.end(); });
  const fixture = await createFixture(pool, config, "partial-point-refund", 10_000);
  const productId = await createGachaProduct(pool, fixture, { label: "partial-point-gacha", price: 2_000, onHand: 4 });
  const order = await placeOrder(app, fixture, { productId, quantity: 2, pointAmount: 4_000 });
  assert.equal(order.status, "PAID");
  assert.equal((await consume(app, fixture, order.drawEntitlementIds[0]!)).statusCode, 200);
  const before = await state(pool, order.id, productId);
  const reason = "포인트 주문 미사용 환불";
  const refunded = await app.inject({
    method: "POST", url: `/v1/admin/commerce/payments/${order.paymentId}/partial-refund`,
    headers: fixture.adminAuth(reason), payload: { reason },
  });
  assert.equal(refunded.statusCode, 202, refunded.body);
  assert.deepEqual(
    (({ status, cardRefundAmount, pointRefundAmount }) => ({ status, cardRefundAmount, pointRefundAmount }))(
      refunded.json() as { status: string; cardRefundAmount: number; pointRefundAmount: number },
    ),
    { status: "APPLIED", cardRefundAmount: 0, pointRefundAmount: 2_000 },
  );
  assert.deepEqual(await state(pool, order.id, productId), {
    payment_status: "PAID", order_status: "PAID", entitlements: ["CANCELLED", "CONSUMED"],
    on_hand: before.on_hand + 1, balance: 8_000, point_refund: 2_000, card_refund: 0, partial_outbox: "1", plan_status: "APPLIED",
  });
});

test("an unknown cancel outcome keeps the order frozen until a provider read shows no money moved", {
  skip: !databaseUrl,
  timeout: 60_000,
}, async (t) => {
  const pool = createDatabasePool(databaseUrl!, "dabboba-partial-refund-release-integration");
  const config = portOneConfig("partial-refund-release");
  const { app } = await buildApp({ config, pool, redis: null });
  t.after(async () => { await app.close(); await pool.end(); });
  const fixture = await createFixture(pool, config, "partial-release", 0);
  const productId = await createGachaProduct(pool, fixture, { label: "partial-release-gacha", price: 3_000, onHand: 4 });
  const order = await placeOrder(app, fixture, { productId, quantity: 2, pointAmount: 0 });
  const attempt = await app.inject({ method: "POST", url: `/v1/payments/${order.paymentId}/attempt`, headers: fixture.customerAuth });
  assert.equal(attempt.statusCode, 200, attempt.body);
  const timestamp = (await pool.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now.toISOString();
  let cancelCalls = 0;
  t.mock.method(globalThis, "fetch", async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      cancelCalls += 1;
      return json({ type: "INTERNAL_ERROR", message: "unavailable" }, 500);
    }
    return json(portOnePayment({ paymentId: order.paymentId, suffix: fixture.suffix, total: 6_000, cancelled: 0, timestamp }));
  });
  const confirmed = await app.inject({ method: "POST", url: `/v1/payments/${order.paymentId}/confirm`, headers: fixture.customerAuth });
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  const issued = await entitlementIds(pool, order.id);
  assert.equal((await consume(app, fixture, issued[0]!)).statusCode, 200);

  const reason = "미사용 뽑기 환불 요청";
  const requested = await app.inject({
    method: "POST", url: `/v1/admin/commerce/payments/${order.paymentId}/partial-refund`,
    headers: fixture.adminAuth(reason), payload: { reason },
  });
  assert.equal(requested.statusCode, 202, requested.body);
  assert.equal((requested.json() as { status: string }).status, "INDETERMINATE");
  assert.equal(cancelCalls, 1);
  const frozen = await state(pool, order.id, productId);
  assert.deepEqual([frozen.payment_status, frozen.order_status, frozen.plan_status], ["REFUND_REVIEW", "REFUND_REVIEW", "INDETERMINATE"]);
  // The frozen order cannot be drawn while the cancellation is unresolved.
  assert.equal((await consume(app, fixture, issued[1]!)).statusCode, 409);

  const reconciled = await app.inject({
    method: "POST", url: `/v1/admin/commerce/payments/${order.paymentId}/partial-refund/reconcile`,
    headers: fixture.adminAuth("결제사 상태 확인"), payload: { reason: "결제사 상태 확인" },
  });
  assert.equal(reconciled.statusCode, 200, reconciled.body);
  assert.deepEqual(
    (({ status, lastErrorCode }) => ({ status, lastErrorCode }))(reconciled.json() as { status: string; lastErrorCode: string }),
    { status: "RELEASED", lastErrorCode: "PROVIDER_NOT_CANCELLED" },
  );
  const released = await state(pool, order.id, productId);
  assert.deepEqual(
    [released.payment_status, released.order_status, released.entitlements, released.card_refund, released.partial_outbox],
    ["PAID", "PAID", ["AVAILABLE", "CONSUMED"], 0, "0"],
  );
  assert.equal(cancelCalls, 1);
  assert.equal((await consume(app, fixture, issued[1]!)).statusCode, 200);
});
