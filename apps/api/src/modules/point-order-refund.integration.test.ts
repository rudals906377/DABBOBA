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

type Fixture = {
  suffix: string;
  ipId: string;
  customerId: string;
  customerAuth: { authorization: string };
  adminAuth: (reason: string, key?: string) => Record<string, string>;
  limitedAdminAuth: (reason: string) => Record<string, string>;
};

async function createFixture(pool: DatabasePool, config: ApiConfig, label: string, startingPoints: number): Promise<Fixture> {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const customer = await pool.query<{ id: string }>(
    "INSERT INTO users(email,nickname,role,status) VALUES($1,'Point refund customer','USER','ACTIVE') RETURNING id",
    [`${label}-customer-${suffix}@example.test`],
  );
  const customerId = customer.rows[0]!.id;
  await acceptRequiredPoliciesForIntegrationTest(pool, customerId);
  const customerSession = await issueSession(pool, config, {
    userId: customerId, kind: "USER", ip: "203.0.113.71", userAgent: "Point refund test",
  });
  const superAdmin = await pool.query<{ id: string }>(
    "INSERT INTO users(email,nickname,role,status) VALUES($1,'Point refund supervisor','SUPER_ADMIN','ACTIVE') RETURNING id",
    [`${label}-super-admin-${suffix}@example.test`],
  );
  const superAdminSession = await issueSession(pool, config, {
    userId: superAdmin.rows[0]!.id, kind: "ADMIN", ip: "203.0.113.72", userAgent: "Point refund test",
  });
  const limitedAdmin = await pool.query<{ id: string }>(
    "INSERT INTO users(email,nickname,role,status) VALUES($1,'Point refund operator','ADMIN','ACTIVE') RETURNING id",
    [`${label}-admin-${suffix}@example.test`],
  );
  const limitedAdminSession = await issueSession(pool, config, {
    userId: limitedAdmin.rows[0]!.id, kind: "ADMIN", ip: "203.0.113.73", userAgent: "Point refund test",
  });
  const ipId = `${label}-ip-${suffix}`;
  await pool.query("INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$3)", [ipId, ipId, `포인트 환불 ${suffix}`]);
  await pool.query("INSERT INTO point_accounts(user_id,balance) VALUES($1,$2)", [customerId, startingPoints]);
  await pool.query(
    `INSERT INTO point_ledger_entries(user_id,entry_type,amount,reference_type,reference_id,reason)
     VALUES($1,'EARN',$2,'TEST',$3,'Point refund integration setup')`,
    [customerId, startingPoints, suffix],
  );
  return {
    suffix,
    ipId,
    customerId,
    customerAuth: { authorization: `Bearer ${customerSession.token}` },
    adminAuth: (reason, key = randomUUID()) => ({
      authorization: `Bearer ${superAdminSession.token}`, "x-admin-reason": reason, "idempotency-key": key,
    }),
    limitedAdminAuth: (reason) => ({
      authorization: `Bearer ${limitedAdminSession.token}`, "x-admin-reason": reason, "idempotency-key": randomUUID(),
    }),
  };
}

async function createGachaProduct(
  pool: DatabasePool,
  fixture: Fixture,
  input: { label: string; price: number; onHand: number; prizeQuantity: number; publisherId: string },
) {
  const productId = `${input.label}-${fixture.suffix}`;
  const prizeId = `${input.label}-prize-${fixture.suffix}`;
  const prizeSku = `${input.label}-PRIZE-${fixture.suffix}`.toUpperCase();
  await pool.query(
    "INSERT INTO catalog_products(id,sku,ip_id,category,name,price,is_prize_only) VALUES($1,$2,$3,'figure',$4,0,true)",
    [prizeId, prizeSku, fixture.ipId, `포인트 환불 경품 ${fixture.suffix}`],
  );
  await pool.query(
    "INSERT INTO catalog_products(id,sku,ip_id,category,name,price,image_url) VALUES($1,$2,$3,'gacha',$4,$5,$6)",
    [productId, `${input.label}-${fixture.suffix}`.toUpperCase(), fixture.ipId, `포인트 환불 가챠 ${fixture.suffix}`,
      input.price, `https://cdn.example.test/${productId}.png`],
  );
  await pool.query("INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,$2,0)", [productId, input.onHand]);
  const version = await pool.query<{ id: string }>(
    "INSERT INTO draw_probability_versions(product_id,version) VALUES($1,1) RETURNING id", [productId],
  );
  await pool.query(
    `INSERT INTO draw_pool_entries(probability_version_id,prize_product_id,prize_name_snapshot,
      prize_sku_snapshot,prize_ip_id_snapshot,prize_category_snapshot,rarity,weight,initial_quantity,remaining_quantity)
     VALUES($1,$2,$3,$4,$5,'figure','A',1,$6,$6)`,
    [version.rows[0]!.id, prizeId, `포인트 환불 경품 ${fixture.suffix}`, prizeSku, fixture.ipId, input.prizeQuantity],
  );
  await pool.query(
    "UPDATE draw_probability_versions SET status='ACTIVE',published_by=$2,published_at=now() WHERE id=$1",
    [version.rows[0]!.id, input.publisherId],
  );
  await pool.query("UPDATE catalog_products SET sale_status='ON_SALE' WHERE id=$1", [productId]);
  return productId;
}

type OrderBody = { id: string; paymentId: string; status: string; total: number; pointTotal: number; drawEntitlementIds: string[] };

async function placeOrder(
  app: FastifyInstance,
  fixture: Fixture,
  input: { productId: string; quantity: number; pointAmount: number; kujiRoomEntryId?: string },
) {
  const response = await app.inject({
    method: "POST", url: "/v1/orders",
    headers: { ...fixture.customerAuth, "idempotency-key": randomUUID() },
    payload: {
      items: [{ productId: input.productId, quantity: input.quantity, expectedDrawVersion: 1 }],
      pointAmount: input.pointAmount,
      ...(input.kujiRoomEntryId ? { kujiRoomEntryId: input.kujiRoomEntryId } : {}),
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json() as OrderBody;
}

type CommerceSnapshot = {
  payment_status: string; order_status: string; provider: string; entitlements: string[];
  on_hand: number; reserved: number; balance: number; point_refund_rows: string; point_refund_total: number;
  internal_events: string; payment_ledger_rows: string; refunded_outbox: string; refund_audits: string;
};

async function snapshot(pool: DatabasePool, input: { orderId: string; productId: string; userId: string }): Promise<CommerceSnapshot> {
  const result = await pool.query<CommerceSnapshot>(
    `SELECT p.status AS payment_status,o.status AS order_status,p.provider,
       ARRAY(SELECT e.status FROM draw_entitlements e JOIN order_lines line ON line.id=e.order_line_id
         WHERE line.order_id=o.id ORDER BY e.status) AS entitlements,
       s.on_hand,s.reserved,a.balance,
       (SELECT count(*)::text FROM point_ledger_entries l
         WHERE l.user_id=$3 AND l.entry_type='REFUND' AND l.reference_type='ORDER' AND l.reference_id=o.id::text) AS point_refund_rows,
       COALESCE((SELECT sum(l.amount)::integer FROM point_ledger_entries l
         WHERE l.user_id=$3 AND l.entry_type='REFUND' AND l.reference_type='ORDER' AND l.reference_id=o.id::text),0) AS point_refund_total,
       (SELECT count(*)::text FROM payment_provider_events ev
         WHERE ev.payment_id=p.id AND ev.provider='INTERNAL_ZERO' AND ev.event_type='REFUND_SUCCEEDED'
           AND ev.provider_event_id='internal-zero-refund:' || p.id::text) AS internal_events,
       (SELECT count(*)::text FROM payment_ledger_entries l WHERE l.payment_id=p.id) AS payment_ledger_rows,
       (SELECT count(*)::text FROM outbox_events ob
         WHERE ob.aggregate_type='ORDER' AND ob.aggregate_id=o.id::text AND ob.event_type='order.refunded') AS refunded_outbox,
       (SELECT count(*)::text FROM admin_audit_logs log
         WHERE log.target_type='PAYMENT' AND log.target_id=p.id::text AND log.action='POINT_ORDER_REFUNDED') AS refund_audits
     FROM orders o JOIN payments p ON p.order_id=o.id
     JOIN product_stock s ON s.product_id=$2
     JOIN point_accounts a ON a.user_id=$3
     WHERE o.id=$1`,
    [input.orderId, input.productId, input.userId],
  );
  return result.rows[0]!;
}

test("an unused points-only gacha order is refunded once through the admin point-order refund", {
  skip: !databaseUrl,
  timeout: 60_000,
}, async (t) => {
  const pool = createDatabasePool(databaseUrl!, "dabboba-point-order-refund-integration");
  const config = baseConfig("point-order-refund");
  const { app } = await buildApp({ config, pool, redis: null });
  t.after(async () => { await app.close(); await pool.end(); });
  const fixture = await createFixture(pool, config, "point-refund", 20_000);
  const publisher = await pool.query<{ id: string }>("SELECT id FROM users WHERE email=$1", [`point-refund-super-admin-${fixture.suffix}@example.test`]);
  const productId = await createGachaProduct(pool, fixture, {
    label: "point-refund-gacha", price: 3_000, onHand: 6, prizeQuantity: 20, publisherId: publisher.rows[0]!.id,
  });

  const order = await placeOrder(app, fixture, { productId, quantity: 2, pointAmount: 6_000 });
  assert.equal(order.status, "PAID");
  assert.equal(order.total, 0);
  assert.equal(order.drawEntitlementIds.length, 2);
  const paid = await snapshot(pool, { orderId: order.id, productId, userId: fixture.customerId });
  assert.deepEqual(paid, {
    payment_status: "PAID", order_status: "PAID", provider: "INTERNAL_ZERO", entitlements: ["AVAILABLE", "AVAILABLE"],
    on_hand: 4, reserved: 0, balance: 14_000, point_refund_rows: "0", point_refund_total: 0,
    internal_events: "0", payment_ledger_rows: "0", refunded_outbox: "0", refund_audits: "0",
  });

  const detail = await app.inject({
    method: "GET", url: `/v1/admin/commerce/payments/${order.paymentId}`, headers: { authorization: fixture.adminAuth("조회").authorization! },
  });
  assert.equal(detail.statusCode, 200, detail.body);
  assert.deepEqual(
    (({ refundActionKind, refundActionAvailable, refundActionBlocker, orderPointTotal }) =>
      ({ refundActionKind, refundActionAvailable, refundActionBlocker, orderPointTotal }))(detail.json() as Record<string, unknown>),
    { refundActionKind: "POINT_ORDER", refundActionAvailable: true, refundActionBlocker: null, orderPointTotal: 6_000 },
  );

  const reason = "고객 요청 포인트 주문 환불";
  const url = `/v1/admin/commerce/payments/${order.paymentId}/point-refund`;
  const forbidden = await app.inject({ method: "POST", url, headers: fixture.limitedAdminAuth(reason), payload: { reason } });
  assert.equal(forbidden.statusCode, 403, forbidden.body);
  const mismatchedReason = await app.inject({
    method: "POST", url, headers: { ...fixture.adminAuth(reason), "x-admin-reason": "다른 사유" }, payload: { reason },
  });
  assert.equal(mismatchedReason.statusCode, 400, mismatchedReason.body);
  assert.deepEqual(await snapshot(pool, { orderId: order.id, productId, userId: fixture.customerId }), paid);

  const key = `point-refund-${randomUUID()}`;
  const refunded = await app.inject({ method: "POST", url, headers: fixture.adminAuth(reason, key), payload: { reason } });
  assert.equal(refunded.statusCode, 200, refunded.body);
  const refundBody = refunded.json() as Record<string, unknown>;
  assert.equal(typeof refundBody.refundedAt, "string");
  assert.deepEqual({ ...refundBody, refundedAt: null }, {
    paymentId: order.paymentId, orderId: order.id, paymentStatus: "REFUNDED", orderStatus: "REFUNDED",
    pointTotal: 6_000, restoredPoints: 6_000, cancelledEntitlements: 2, refundedAt: null, alreadyRefunded: false,
  });
  const afterRefund = await snapshot(pool, { orderId: order.id, productId, userId: fixture.customerId });
  assert.deepEqual(afterRefund, {
    payment_status: "REFUNDED", order_status: "REFUNDED", provider: "INTERNAL_ZERO", entitlements: ["CANCELLED", "CANCELLED"],
    on_hand: 6, reserved: 0, balance: 20_000, point_refund_rows: "1", point_refund_total: 6_000,
    internal_events: "1", payment_ledger_rows: "0", refunded_outbox: "1", refund_audits: "1",
  });

  // The same request replays the stored response; a new request reports the
  // committed refund. Neither credits points again.
  const replay = await app.inject({ method: "POST", url, headers: fixture.adminAuth(reason, key), payload: { reason } });
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(replay.headers["x-idempotent-replay"], "true");
  assert.deepEqual(replay.json(), refundBody);
  const repeated = await app.inject({ method: "POST", url, headers: fixture.adminAuth(reason), payload: { reason } });
  assert.equal(repeated.statusCode, 200, repeated.body);
  assert.deepEqual(repeated.json(), { ...refundBody, alreadyRefunded: true });
  assert.deepEqual(await snapshot(pool, { orderId: order.id, productId, userId: fixture.customerId }), afterRefund);

  const draw = await app.inject({
    method: "POST", url: `/v1/draws/${order.drawEntitlementIds[0]}/consume`,
    headers: { ...fixture.customerAuth, "idempotency-key": randomUUID() }, payload: {},
  });
  assert.equal(draw.statusCode, 409, draw.body);
  const refundedDetail = await app.inject({
    method: "GET", url: `/v1/admin/commerce/payments/${order.paymentId}`, headers: { authorization: fixture.adminAuth("조회").authorization! },
  });
  assert.equal(refundedDetail.statusCode, 200, refundedDetail.body);
  assert.equal((refundedDetail.json() as { refundActionAvailable: boolean }).refundActionAvailable, false);

  // A points-only order with one opened capsule is never refunded automatically.
  const usedOrder = await placeOrder(app, fixture, { productId, quantity: 2, pointAmount: 6_000 });
  const consumed = await app.inject({
    method: "POST", url: `/v1/draws/${usedOrder.drawEntitlementIds[0]}/consume`,
    headers: { ...fixture.customerAuth, "idempotency-key": randomUUID() }, payload: {},
  });
  assert.equal(consumed.statusCode, 200, consumed.body);
  const usedBefore = await snapshot(pool, { orderId: usedOrder.id, productId, userId: fixture.customerId });
  assert.equal(usedBefore.balance, 14_000);
  assert.deepEqual(usedBefore.entitlements, ["AVAILABLE", "CONSUMED"]);
  const usedDetail = await app.inject({
    method: "GET", url: `/v1/admin/commerce/payments/${usedOrder.paymentId}`, headers: { authorization: fixture.adminAuth("조회").authorization! },
  });
  assert.equal(usedDetail.statusCode, 200, usedDetail.body);
  const usedAction = usedDetail.json() as { refundActionKind: string; refundActionAvailable: boolean; refundActionBlocker: string | null };
  assert.equal(usedAction.refundActionKind, "POINT_ORDER");
  assert.equal(usedAction.refundActionAvailable, false);
  assert.ok(usedAction.refundActionBlocker);
  const rejected = await app.inject({
    method: "POST", url: `/v1/admin/commerce/payments/${usedOrder.paymentId}/point-refund`,
    headers: fixture.adminAuth(reason), payload: { reason },
  });
  assert.equal(rejected.statusCode, 409, rejected.body);
  assert.deepEqual(await snapshot(pool, { orderId: usedOrder.id, productId, userId: fixture.customerId }), usedBefore);
});

test("a points-only kuji order refund cancels its ticket and releases the kuji room", {
  skip: !databaseUrl,
  timeout: 60_000,
}, async (t) => {
  const pool = createDatabasePool(databaseUrl!, "dabboba-point-order-kuji-refund-integration");
  const config = baseConfig("point-order-kuji-refund");
  const { app } = await buildApp({ config, pool, redis: null });
  t.after(async () => { await app.close(); await pool.end(); });
  const fixture = await createFixture(pool, config, "point-kuji-refund", 5_000);
  const publisher = await pool.query<{ id: string }>("SELECT id FROM users WHERE email=$1", [`point-kuji-refund-super-admin-${fixture.suffix}@example.test`]);
  const productId = `point-kuji-refund-${fixture.suffix}`;
  const prizeId = `point-kuji-refund-prize-${fixture.suffix}`;
  await pool.query(
    "INSERT INTO catalog_products(id,sku,ip_id,category,name,price,is_prize_only) VALUES($1,$2,$3,'figure',$4,0,true)",
    [prizeId, `PKR-PRIZE-${fixture.suffix}`.toUpperCase(), fixture.ipId, `포인트 쿠지 경품 ${fixture.suffix}`],
  );
  await pool.query(
    "INSERT INTO catalog_products(id,sku,ip_id,category,name,price,image_url) VALUES($1,$2,$3,'kuji',$4,1000,$5)",
    [productId, `PKR-${fixture.suffix}`.toUpperCase(), fixture.ipId, `포인트 쿠지 ${fixture.suffix}`, `https://cdn.example.test/${productId}.png`],
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
    [versionId, prizeId, `포인트 쿠지 경품 ${fixture.suffix}`, `PKR-PRIZE-${fixture.suffix}`.toUpperCase(), fixture.ipId],
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
    [versionId, publisher.rows[0]!.id],
  );
  await pool.query("UPDATE catalog_products SET sale_status='ON_SALE' WHERE id=$1", [productId]);

  const room = await app.inject({ method: "POST", url: `/v1/kuji/rooms/${productId}/entries`, headers: fixture.customerAuth });
  assert.ok([200, 201].includes(room.statusCode), room.body);
  const entryId = (room.json() as { viewer: { entryId: string } }).viewer.entryId;
  const order = await placeOrder(app, fixture, { productId, quantity: 1, pointAmount: 1_000, kujiRoomEntryId: entryId });
  assert.equal(order.status, "PAID");
  const drawing = await pool.query<{ state: string }>("SELECT state FROM kuji_room_entries WHERE id=$1", [entryId]);
  assert.equal(drawing.rows[0]?.state, "DRAWING");

  const reason = "고객 요청 쿠지 포인트 환불";
  const refunded = await app.inject({
    method: "POST", url: `/v1/admin/commerce/payments/${order.paymentId}/point-refund`,
    headers: fixture.adminAuth(reason), payload: { reason },
  });
  assert.equal(refunded.statusCode, 200, refunded.body);
  assert.equal((refunded.json() as { restoredPoints: number }).restoredPoints, 1_000);
  const state = await snapshot(pool, { orderId: order.id, productId, userId: fixture.customerId });
  assert.deepEqual(state, {
    payment_status: "REFUNDED", order_status: "REFUNDED", provider: "INTERNAL_ZERO", entitlements: ["CANCELLED"],
    on_hand: 2, reserved: 0, balance: 5_000, point_refund_rows: "1", point_refund_total: 1_000,
    internal_events: "1", payment_ledger_rows: "0", refunded_outbox: "1", refund_audits: "1",
  });
  const released = await pool.query<{ state: string }>("SELECT state FROM kuji_room_entries WHERE id=$1", [entryId]);
  assert.equal(released.rows[0]?.state, "CANCELLED");
});

test("a full card refund of a mixed points-and-card gacha order returns the points once", {
  skip: !databaseUrl,
  timeout: 60_000,
}, async (t) => {
  const pool = createDatabasePool(databaseUrl!, "dabboba-mixed-point-card-refund-integration");
  const config: ApiConfig = {
    ...baseConfig("mixed-point-card-refund"),
    paymentProvider: "PORTONE_V2_INICIS",
    portOne: {
      apiSecret: "synthetic-secret", merchantId: "synthetic-merchant", storeId: "synthetic-store",
      channelKey: "synthetic-channel", channelEnvironment: "TEST",
      webhookSecret: "mixed-point-card-refund-webhook-secret",
    },
    paymentWebhookSecret: "mixed-point-card-refund-webhook-secret",
  };
  const { app } = await buildApp({ config, pool, redis: null });
  t.after(async () => { await app.close(); await pool.end(); });
  const fixture = await createFixture(pool, config, "mixed-refund", 3_000);
  const publisher = await pool.query<{ id: string }>("SELECT id FROM users WHERE email=$1", [`mixed-refund-super-admin-${fixture.suffix}@example.test`]);
  const productId = await createGachaProduct(pool, fixture, {
    label: "mixed-refund-gacha", price: 2_000, onHand: 3, prizeQuantity: 10, publisherId: publisher.rows[0]!.id,
  });
  const order = await placeOrder(app, fixture, { productId, quantity: 1, pointAmount: 500 });
  assert.equal(order.status, "PENDING_PAYMENT");
  assert.equal(order.total, 1_500);
  assert.equal(order.pointTotal, 500);
  const attempt = await app.inject({ method: "POST", url: `/v1/payments/${order.paymentId}/attempt`, headers: fixture.customerAuth });
  assert.equal(attempt.statusCode, 200, attempt.body);

  const providerTimestamp = (await pool.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now.toISOString();
  let cancelled = false;
  let cancelCalls = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    assert.match(String(input), new RegExp(order.paymentId));
    if (init?.method === "POST") {
      cancelCalls += 1;
      assert.equal((JSON.parse(String(init.body)) as { amount: number }).amount, 1_500);
      cancelled = true;
      return new Response(JSON.stringify({ cancellation: {
        status: "SUCCEEDED", id: `cancel-mixed-${fixture.suffix}`, totalAmount: 1_500,
        taxFreeAmount: 0, vatAmount: 136, reason: "고객 요청 전액 환불",
        requestedAt: providerTimestamp, cancelledAt: providerTimestamp,
      } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      id: order.paymentId, transactionId: `portone-${fixture.suffix}`, pgTxId: `kg-${fixture.suffix}`,
      merchantId: "synthetic-merchant", storeId: "synthetic-store", version: "V2",
      channel: { key: "synthetic-channel", type: "TEST", pgProvider: "INICIS_V2" },
      method: { type: "PaymentMethodCard" }, status: cancelled ? "CANCELLED" : "PAID",
      amount: { total: 1_500, paid: 1_500, cancelled: cancelled ? 1_500 : 0 }, currency: "KRW",
      requestedAt: providerTimestamp, statusChangedAt: providerTimestamp, paidAt: providerTimestamp,
      cancelledAt: cancelled ? providerTimestamp : null, cancellations: [],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const confirmed = await app.inject({ method: "POST", url: `/v1/payments/${order.paymentId}/confirm`, headers: fixture.customerAuth });
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  const paid = await snapshot(pool, { orderId: order.id, productId, userId: fixture.customerId });
  assert.equal(paid.payment_status, "PAID");
  assert.equal(paid.balance, 2_500);

  const detail = await app.inject({
    method: "GET", url: `/v1/admin/commerce/payments/${order.paymentId}`, headers: { authorization: fixture.adminAuth("조회").authorization! },
  });
  assert.equal(detail.statusCode, 200, detail.body);
  const action = detail.json() as { refundActionKind: string; refundActionAvailable: boolean; orderPointTotal: number };
  assert.deepEqual(
    { kind: action.refundActionKind, available: action.refundActionAvailable, points: action.orderPointTotal },
    { kind: "CARD_CANCELLATION", available: true, points: 500 },
  );
  // A card order is never refunded through the point-order path.
  const reason = "고객 요청 전액 환불";
  const wrongPath = await app.inject({
    method: "POST", url: `/v1/admin/commerce/payments/${order.paymentId}/point-refund`,
    headers: fixture.adminAuth(reason), payload: { reason },
  });
  assert.equal(wrongPath.statusCode, 409, wrongPath.body);
  assert.equal(cancelCalls, 0);

  const refunded = await app.inject({
    method: "POST", url: `/v1/admin/commerce/payments/${order.paymentId}/refund`,
    headers: fixture.adminAuth(reason), payload: { reason },
  });
  assert.equal(refunded.statusCode, 202, refunded.body);
  assert.equal((refunded.json() as { status: string }).status, "RECONCILED");
  assert.equal(cancelCalls, 1);
  const state = await pool.query<{
    payment_status: string; order_status: string; entitlement: string; balance: number;
    point_refund_rows: string; point_refund_total: number; card_refund_total: number;
  }>(
    `SELECT p.status AS payment_status,o.status AS order_status,
       (SELECT e.status FROM draw_entitlements e JOIN order_lines line ON line.id=e.order_line_id WHERE line.order_id=o.id) AS entitlement,
       a.balance,
       (SELECT count(*)::text FROM point_ledger_entries l
         WHERE l.user_id=o.user_id AND l.entry_type='REFUND' AND l.reference_type='ORDER' AND l.reference_id=o.id::text) AS point_refund_rows,
       COALESCE((SELECT sum(l.amount)::integer FROM point_ledger_entries l
         WHERE l.user_id=o.user_id AND l.entry_type='REFUND' AND l.reference_type='ORDER' AND l.reference_id=o.id::text),0) AS point_refund_total,
       COALESCE((SELECT sum(l.amount)::integer FROM payment_ledger_entries l WHERE l.payment_id=p.id AND l.entry_type='REFUND'),0) AS card_refund_total
     FROM orders o JOIN payments p ON p.order_id=o.id JOIN point_accounts a ON a.user_id=o.user_id WHERE o.id=$1`,
    [order.id],
  );
  assert.deepEqual(state.rows[0], {
    payment_status: "REFUNDED", order_status: "REFUNDED", entitlement: "CANCELLED", balance: 3_000,
    point_refund_rows: "1", point_refund_total: 500, card_refund_total: -1_500,
  });
});
