import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import { buildApp } from "../app.js";
import { acceptRequiredPoliciesForIntegrationTest } from "../integration-test-fixtures.js";
import { issueSession } from "../plugins/auth.js";
import { selectCardChannel } from "../lib/portone-channel-binding.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;

for (const cardPg of ["INICIS", "KCP"] as const) {
test(`${cardPg}: verified PortOne requery recovers one paid order and its draw survives through storage without a second charge`, {
  skip: !databaseUrl,
  timeout: 60_000,
}, async (t) => {
  const pool = createDatabasePool(databaseUrl!, "dabboba-payment-requery-integration");
  const config: ApiConfig = {
    environment: "test", host: "127.0.0.1", port: 8788, databaseUrl: databaseUrl!, redisUrl: "redis://127.0.0.1:6379",
    webOrigins: ["http://127.0.0.1:4174"], adminOrigins: ["http://127.0.0.1:4180"],
    sessionTokenPepper: "payment-requery-integration-pepper", adminProxyIdentitySecret: null,
    sessionTtlDays: 1, commerceMode: "LIVE", paymentProvider: "PORTONE_V2_INICIS",
    paymentWebhookSecret: "payment-requery-integration-webhook-secret",
    paymentReconciliationWorkerSecret: "payment-requery-worker-secret-for-tests",
    portOne: {
      apiSecret: "synthetic-secret", merchantId: "synthetic-merchant", storeId: "synthetic-store",
      channelKey: "synthetic-channel", kcpChannelKey: "channel-key-synthetic-kcp", channelEnvironment: "TEST",
      webhookSecret: "payment-requery-integration-webhook-secret",
    },
    gcsBucket: null, gcsProjectId: null, logLevel: "silent",
  };
  const selectedChannel = selectCardChannel(config, cardPg);
  const { app } = await buildApp({ config, pool, redis: null });
  t.after(async () => { await app.close(); await pool.end(); });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const createActor = async (role: "USER" | "ADMIN" | "SUPER_ADMIN") => {
    const result = await pool.query<{ id: string }>(
      "INSERT INTO users(email,nickname,role,status) VALUES($1,$2,$3,'ACTIVE') RETURNING id",
      [`requery-${role}-${suffix}@example.test`, `Requery ${role}`, role],
    );
    if (role === "USER") await acceptRequiredPoliciesForIntegrationTest(pool, result.rows[0]!.id);
    const session = await issueSession(pool, config, {
      userId: result.rows[0]!.id, kind: role === "USER" ? "USER" : "ADMIN",
      ip: "203.0.113.90", userAgent: "Payment requery integration test",
    });
    return { id: result.rows[0]!.id, token: session.token };
  };
  const customer = await createActor("USER");
  const admin = await createActor("ADMIN");
  const supervisor = await createActor("SUPER_ADMIN");
  const ipId = `requery-ip-${suffix}`;
  const productId = `requery-gacha-${suffix}`;
  await pool.query("INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$3)", [ipId, ipId, `재조회 ${suffix}`]);
  await pool.query(
    "INSERT INTO catalog_products(id,sku,ip_id,category,name,price) VALUES($1,$2,$3,'gacha',$4,10000)",
    [productId, `REQUERY-${suffix}`.toUpperCase(), ipId, `재조회 가챠 ${suffix}`],
  );
  await pool.query("INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,1,1)", [productId]);
  const version = await pool.query<{ id: string }>(
    "INSERT INTO draw_probability_versions(product_id,version) VALUES($1,1) RETURNING id", [productId],
  );
  const prizeId = `requery-prize-${suffix}`;
  await pool.query(
    "INSERT INTO catalog_products(id,sku,ip_id,category,name,price,is_prize_only) VALUES($1,$2,$3,'figure',$4,0,true)",
    [prizeId, `REQUERY-PRIZE-${suffix}`.toUpperCase(), ipId, `재조회 경품 ${suffix}`],
  );
  await pool.query(
    `INSERT INTO draw_pool_entries(
       probability_version_id,prize_product_id,prize_name_snapshot,prize_sku_snapshot,
       prize_ip_id_snapshot,prize_category_snapshot,rarity,weight,initial_quantity,remaining_quantity
     ) VALUES($1,$2,$3,$4,$5,'figure','A',1,1,1)`,
    [version.rows[0]!.id, prizeId, `재조회 경품 ${suffix}`, `REQUERY-PRIZE-${suffix}`.toUpperCase(), ipId],
  );
  await pool.query(
    "UPDATE draw_probability_versions SET status='ACTIVE',published_by=$2,published_at=now() WHERE id=$1",
    [version.rows[0]!.id, supervisor.id],
  );
  const order = await pool.query<{ id: string }>(
    "INSERT INTO orders(user_id,status,subtotal,total) VALUES($1,'PENDING_PAYMENT',10000,10000) RETURNING id", [customer.id],
  );
  const orderId = order.rows[0]!.id;
  const line = await pool.query<{ id: string }>(
    `INSERT INTO order_lines(order_id,product_id,product_name_snapshot,category_snapshot,probability_version_id,unit_price,quantity,line_total)
     VALUES($1,$2,$3,'gacha',$4,10000,1,10000) RETURNING id`,
    [orderId, productId, `재조회 가챠 ${suffix}`, version.rows[0]!.id],
  );
  await pool.query(
    "INSERT INTO stock_reservations(order_id,order_line_id,product_id,quantity,expires_at) VALUES($1,$2,$3,1,now()+interval '15 minutes')",
    [orderId, line.rows[0]!.id, productId],
  );
  const payment = await pool.query<{ id: string }>(
    "INSERT INTO payments(order_id,provider,status,amount,portone_channel_binding) VALUES($1,$2,'PENDING',10000,$3) RETURNING id", [orderId, selectedChannel.provider, JSON.stringify(selectedChannel)],
  );
  const paymentId = payment.rows[0]!.id;
  let providerLookups = 0;
  let failNextLookup = true;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    providerLookups += 1;
    assert.equal(init?.method, "GET");
    assert.match(String(input), new RegExp(paymentId));
    if (failNextLookup) {
      failNextLookup = false;
      throw new Error("synthetic PortOne lookup outage");
    }
    return new Response(JSON.stringify({
      id: paymentId, transactionId: `portone-${suffix}`, pgTxId: `kg-${suffix}`,
      merchantId: "synthetic-merchant", storeId: "synthetic-store", version: "V2",
      channel: { key: selectedChannel.channelKey, type: "TEST", pgProvider: selectedChannel.pgProvider },
      method: { type: "PaymentMethodCard" }, status: "PAID",
      amount: { total: 10_000, paid: 10_000, cancelled: 0 }, currency: "KRW",
      requestedAt: "2026-09-20T00:00:00.000Z", statusChangedAt: "2026-09-20T00:00:02.000Z",
      paidAt: "2026-09-20T00:00:02.000Z", cancellations: [],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const reason = "웹훅 미수신 결제 상태 확인";
  const invoke = (token: string) => app.inject({
    method: "POST", url: `/v1/admin/commerce/payments/${paymentId}/reconcile`,
    headers: { authorization: `Bearer ${token}`, "x-admin-reason": reason, "idempotency-key": randomUUID() },
    payload: { reason },
  });
  const detail = await app.inject({
    method: "GET", url: `/v1/admin/commerce/payments/${paymentId}`,
    headers: { authorization: `Bearer ${supervisor.token}` },
  });
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal((detail.json() as { providerReconciliationAvailable: boolean }).providerReconciliationAvailable, true);
  for (const deniedToken of [customer.token, admin.token]) {
    const denied = await invoke(deniedToken);
    assert.equal(denied.statusCode, 403, denied.body);
  }
  assert.equal(providerLookups, 0);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const workerPath = `/v1/internal/payments/${paymentId}/reconcile`;
  const signature = createHmac("sha256", config.paymentReconciliationWorkerSecret!)
    .update(`POST\n${workerPath}\n${timestamp}`)
    .digest("hex");
  const unauthenticated = await app.inject({ method: "POST", url: workerPath });
  assert.equal(unauthenticated.statusCode, 401, unauthenticated.body);
  const forged = await app.inject({ method: "POST", url: workerPath, headers: {
    "x-dabboba-worker-timestamp": timestamp,
    "x-dabboba-worker-signature": `sha256=${"0".repeat(64)}`,
  } });
  assert.equal(forged.statusCode, 401, forged.body);
  const stale = await app.inject({ method: "POST", url: workerPath, headers: {
    "x-dabboba-worker-timestamp": String(Number(timestamp) - 601),
    "x-dabboba-worker-signature": `sha256=${signature}`,
  } });
  assert.equal(stale.statusCode, 401, stale.body);
  assert.equal(providerLookups, 0);
  const failedLookup = await invoke(supervisor.token);
  assert.equal(failedLookup.statusCode, 502, failedLookup.body);
  const pending = await pool.query<{ status: string; entitlement_count: string }>(
    `SELECT p.status,(SELECT count(*)::text FROM draw_entitlements e WHERE e.order_line_id=$2) AS entitlement_count
       FROM payments p WHERE p.id=$1`, [paymentId, line.rows[0]!.id],
  );
  assert.deepEqual(pending.rows[0], { status: "PENDING", entitlement_count: "0" });
  const beforePaymentDraws = await app.inject({
    method: "GET", url: "/v1/account/draw-entitlements",
    headers: { authorization: `Bearer ${customer.token}` },
  });
  assert.equal(beforePaymentDraws.statusCode, 200, beforePaymentDraws.body);
  assert.deepEqual((beforePaymentDraws.json() as { items: unknown[] }).items, []);
  const recoveredByWorker = await app.inject({ method: "POST", url: workerPath, headers: {
    "x-dabboba-worker-timestamp": timestamp,
    "x-dabboba-worker-signature": `sha256=${signature}`,
  } });
  assert.equal(recoveredByWorker.statusCode, 200, recoveredByWorker.body);
  assert.deepEqual(
    (({ providerStatus, localStatus }) => ({ providerStatus, localStatus }))(
      recoveredByWorker.json() as { providerStatus: string; localStatus: string },
    ),
    { providerStatus: "PAID", localStatus: "PAID" },
  );
  const workerReplay = await app.inject({ method: "POST", url: workerPath, headers: {
    "x-dabboba-worker-timestamp": timestamp,
    "x-dabboba-worker-signature": `sha256=${signature}`,
  } });
  assert.equal(workerReplay.statusCode, 200, workerReplay.body);
  assert.equal((workerReplay.json() as { outcome: string }).outcome, "already_settled");
  assert.equal(providerLookups, 2);
  const first = await invoke(supervisor.token);
  assert.equal(first.statusCode, 200, first.body);
  assert.equal((first.json() as { providerStatus: string; outcome: string }).providerStatus, "PAID");
  const replay = await invoke(supervisor.token);
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(providerLookups, 4);
  const state = await pool.query<{
    payment_status: string; order_status: string; entitlement_count: string; ledger_count: string;
    audit_count: string; reservation_status: string; on_hand: number; reserved: number;
  }>(
    `SELECT p.status AS payment_status,o.status AS order_status,
      (SELECT count(*)::text FROM draw_entitlements e WHERE e.order_line_id=$2) AS entitlement_count,
      (SELECT count(*)::text FROM payment_ledger_entries l WHERE l.payment_id=p.id AND l.entry_type='PAYMENT') AS ledger_count,
      (SELECT count(*)::text FROM admin_audit_logs a WHERE a.target_id=p.id::text AND a.action='PORTONE_PAYMENT_REQUERY_REQUESTED') AS audit_count,
      (SELECT status FROM stock_reservations r WHERE r.order_line_id=$2) AS reservation_status,
      s.on_hand,s.reserved
     FROM payments p JOIN orders o ON o.id=p.order_id JOIN product_stock s ON s.product_id=$3 WHERE p.id=$1`,
    [paymentId, line.rows[0]!.id, productId],
  );
  assert.deepEqual(state.rows[0], {
    payment_status: "PAID", order_status: "PAID", entitlement_count: "1", ledger_count: "1",
    audit_count: "3", reservation_status: "COMMITTED", on_hand: 0, reserved: 0,
  });
  const paidDraws = await app.inject({
    method: "GET", url: "/v1/account/draw-entitlements?status=AVAILABLE",
    headers: { authorization: `Bearer ${customer.token}` },
  });
  assert.equal(paidDraws.statusCode, 200, paidDraws.body);
  const available = (paidDraws.json() as {
    items: Array<{ id: string; orderId: string; product: { id: string }; status: string }>;
  }).items;
  assert.equal(available.length, 1);
  assert.equal(available[0]?.orderId, orderId);
  assert.equal(available[0]?.product.id, productId);
  assert.equal(available[0]?.status, "AVAILABLE");
  const drawKey = randomUUID();
  const drawPath = `/v1/draws/${available[0]!.id}/consume`;
  const drawn = await app.inject({
    method: "POST", url: drawPath,
    headers: { authorization: `Bearer ${customer.token}`, "idempotency-key": drawKey },
  });
  assert.equal(drawn.statusCode, 200, drawn.body);
  const result = drawn.json() as { id: string; entitlementId: string; prizeProductId: string; prizeInventoryUnitId: string };
  assert.equal(result.entitlementId, available[0]!.id);
  assert.equal(result.prizeProductId, prizeId);
  const repeatedDraw = await app.inject({
    method: "POST", url: drawPath,
    headers: { authorization: `Bearer ${customer.token}`, "idempotency-key": drawKey },
  });
  assert.equal(repeatedDraw.statusCode, 200, repeatedDraw.body);
  assert.deepEqual(repeatedDraw.json(), result);
  const inventory = await app.inject({
    method: "GET", url: "/v1/account/inventory",
    headers: { authorization: `Bearer ${customer.token}` },
  });
  assert.equal(inventory.statusCode, 200, inventory.body);
  assert.equal((inventory.json() as { items: Array<{ id: string }> }).items.some((item) => item.id === result.prizeInventoryUnitId), true);
  const drawState = await pool.query<{ result_count: string; inventory_count: string; entitlement_status: string }>(
    `SELECT e.status AS entitlement_status,
      (SELECT count(*)::text FROM draw_results r WHERE r.entitlement_id=e.id) AS result_count,
      (SELECT count(*)::text FROM inventory_units i WHERE i.id=$2 AND i.owner_id=$3) AS inventory_count
     FROM draw_entitlements e WHERE e.id=$1`,
    [available[0]!.id, result.prizeInventoryUnitId, customer.id],
  );
  assert.deepEqual(drawState.rows[0], { entitlement_status: "CONSUMED", result_count: "1", inventory_count: "1" });
  const { app: prelaunchApp } = await buildApp({ config: { ...config, commerceMode: "PRELAUNCH" }, pool, redis: null });
  t.after(async () => { await prelaunchApp.close(); });
  const prelaunchDetail = await prelaunchApp.inject({
    method: "GET", url: `/v1/admin/commerce/payments/${paymentId}`,
    headers: { authorization: `Bearer ${supervisor.token}` },
  });
  assert.equal(prelaunchDetail.statusCode, 200, prelaunchDetail.body);
  assert.equal((prelaunchDetail.json() as { providerReconciliationAvailable: boolean }).providerReconciliationAvailable, false);
  const gated = await prelaunchApp.inject({
    method: "POST", url: `/v1/admin/commerce/payments/${paymentId}/reconcile`,
    headers: { authorization: `Bearer ${supervisor.token}`, "x-admin-reason": reason, "idempotency-key": randomUUID() },
    payload: { reason },
  });
  assert.equal(gated.statusCode, 503, gated.body);
  const workerGated = await prelaunchApp.inject({ method: "POST", url: workerPath, headers: {
    "x-dabboba-worker-timestamp": timestamp,
    "x-dabboba-worker-signature": `sha256=${signature}`,
  } });
  assert.equal(workerGated.statusCode, 503, workerGated.body);
  assert.equal(providerLookups, 4);
});

}

test("a claimed payment cancelled on reservation expiry is still requeried and a late charge enters refund review", {
  skip: !databaseUrl,
  timeout: 30_000,
}, async (t) => {
  const pool = createDatabasePool(databaseUrl!, "dabboba-expired-payment-requery-integration");
  const config: ApiConfig = {
    environment: "test", host: "127.0.0.1", port: 8788, databaseUrl: databaseUrl!, redisUrl: "redis://127.0.0.1:6379",
    webOrigins: ["http://127.0.0.1:4174"], adminOrigins: ["http://127.0.0.1:4180"],
    sessionTokenPepper: "expired-payment-requery-test-pepper", adminProxyIdentitySecret: null,
    sessionTtlDays: 1, commerceMode: "LIVE", paymentProvider: "PORTONE_V2_INICIS",
    paymentWebhookSecret: "expired-payment-requery-test-webhook-secret",
    paymentReconciliationWorkerSecret: "expired-payment-requery-worker-secret",
    portOne: {
      apiSecret: "synthetic-secret", merchantId: "synthetic-merchant", storeId: "synthetic-store",
      channelKey: "synthetic-channel", channelEnvironment: "TEST",
      webhookSecret: "expired-payment-requery-test-webhook-secret",
    },
    gcsBucket: null, gcsProjectId: null, logLevel: "silent",
  };
  const { app } = await buildApp({ config, pool, redis: null });
  t.after(async () => { await app.close(); await pool.end(); });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const user = await pool.query<{ id: string }>(
    "INSERT INTO users(email,nickname) VALUES($1,$2) RETURNING id",
    [`expired-requery-${suffix}@example.test`, `만료 재조회 ${suffix}`],
  );
  const createCancelledPayment = async (claimed: boolean) => {
    const order = await pool.query<{ id: string }>(
      "INSERT INTO orders(user_id,status,subtotal,total,cancelled_at) VALUES($1,'CANCELLED',10000,10000,now()) RETURNING id",
      [user.rows[0]!.id],
    );
    const payment = await pool.query<{ id: string }>(
      `INSERT INTO payments(order_id,provider,status,amount,pg_attempt_started_at)
       VALUES($1,'PORTONE_V2_INICIS','CANCELLED',10000,$2) RETURNING id`,
      [order.rows[0]!.id, claimed ? new Date() : null],
    );
    return { orderId: order.rows[0]!.id, paymentId: payment.rows[0]!.id };
  };
  const unclaimed = await createCancelledPayment(false);
  const claimed = await createCancelledPayment(true);
  const claimedNoCharge = await createCancelledPayment(true);
  const supervisor = await pool.query<{ id: string }>(
    "INSERT INTO users(email,nickname,role,status) VALUES($1,$2,'SUPER_ADMIN','ACTIVE') RETURNING id",
    [`expired-requery-supervisor-${suffix}@example.test`, `환불 담당 ${suffix}`],
  );
  const supervisorSession = await issueSession(pool, config, {
    userId: supervisor.rows[0]!.id, kind: "ADMIN", ip: "203.0.113.91", userAgent: "Late refund integration test",
  });
  const ipId = `expired-requery-ip-${suffix}`;
  const productId = `expired-requery-product-${suffix}`;
  await pool.query("INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$3)", [ipId, ipId, `만료 재조회 ${suffix}`]);
  await pool.query(
    "INSERT INTO catalog_products(id,sku,ip_id,category,name,price) VALUES($1,$2,$3,'gacha',$4,10000)",
    [productId, `EXPIRED-REQUERY-${suffix}`.toUpperCase(), ipId, `만료 가챠 ${suffix}`],
  );
  const probabilityVersion = await pool.query<{ id: string }>(
    "INSERT INTO draw_probability_versions(product_id,version) VALUES($1,1) RETURNING id", [productId],
  );
  await pool.query(
    `INSERT INTO order_lines(order_id,product_id,product_name_snapshot,category_snapshot,probability_version_id,unit_price,quantity,line_total)
     VALUES($1,$2,$3,'gacha',$4,10000,1,10000)`,
    [claimed.orderId, productId, `만료 가챠 ${suffix}`, probabilityVersion.rows[0]!.id],
  );
  let lookups = 0;
  let cancellationCalls = 0;
  let providerCancelled = false;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      assert.match(String(input), new RegExp(claimed.paymentId));
      cancellationCalls += 1;
      providerCancelled = true;
      return new Response(JSON.stringify({ cancellation: {
        status: "SUCCEEDED", id: `cancel-${suffix}`, totalAmount: 10_000,
        taxFreeAmount: 0, vatAmount: 909, reason: "지연 승인 전액 취소",
        requestedAt: "2026-09-26T00:01:00.000Z", cancelledAt: "2026-09-26T00:01:01.000Z",
      } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    lookups += 1;
    const queriedId = String(input).includes(claimed.paymentId)
      ? claimed.paymentId : claimedNoCharge.paymentId;
    assert.match(String(input), new RegExp(queriedId));
    const noCharge = queriedId === claimedNoCharge.paymentId;
    return new Response(JSON.stringify({
      id: queriedId, transactionId: `portone-${suffix}`, pgTxId: `kg-${suffix}`,
      merchantId: "synthetic-merchant", storeId: "synthetic-store", version: "V2",
      channel: { key: "synthetic-channel", type: "TEST", pgProvider: "INICIS_V2" },
      method: { type: "PaymentMethodCard" }, status: noCharge ? "FAILED" : providerCancelled ? "CANCELLED" : "PAID",
      amount: { total: 10_000, paid: noCharge ? 0 : 10_000, cancelled: providerCancelled ? 10_000 : 0 }, currency: "KRW",
      requestedAt: "2026-09-26T00:00:00.000Z", statusChangedAt: providerCancelled ? "2026-09-26T00:01:01.000Z" : "2026-09-26T00:00:02.000Z",
      paidAt: noCharge ? null : "2026-09-26T00:00:02.000Z",
      failedAt: noCharge ? "2026-09-26T00:00:02.000Z" : null,
      cancelledAt: providerCancelled ? "2026-09-26T00:01:01.000Z" : null,
      cancellations: [],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const invoke = (paymentId: string) => {
    const path = `/v1/internal/payments/${paymentId}/reconcile`;
    const signature = createHmac("sha256", config.paymentReconciliationWorkerSecret!)
      .update(`POST\n${path}\n${timestamp}`).digest("hex");
    return app.inject({ method: "POST", url: path, headers: {
      "x-dabboba-worker-timestamp": timestamp,
      "x-dabboba-worker-signature": `sha256=${signature}`,
    } });
  };
  const skipped = await invoke(unclaimed.paymentId);
  assert.equal(skipped.statusCode, 200, skipped.body);
  assert.equal((skipped.json() as { outcome: string }).outcome, "already_settled");
  assert.equal(lookups, 0);
  const recovered = await invoke(claimed.paymentId);
  assert.equal(recovered.statusCode, 200, recovered.body);
  assert.equal((recovered.json() as { providerStatus: string; localStatus: string }).providerStatus, "PAID");
  assert.equal((recovered.json() as { localStatus: string }).localStatus, "REFUND_REVIEW");
  const state = await pool.query<{ payment_status: string; order_status: string; ledger_count: string; entitlement_count: string }>(
    `SELECT p.status AS payment_status,o.status AS order_status,
      (SELECT count(*)::text FROM payment_ledger_entries l WHERE l.payment_id=p.id AND l.entry_type='PAYMENT') AS ledger_count,
      (SELECT count(*)::text FROM draw_entitlements e JOIN order_lines line ON line.id=e.order_line_id WHERE line.order_id=o.id) AS entitlement_count
     FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=$1`, [claimed.paymentId],
  );
  assert.deepEqual(state.rows[0], {
    payment_status: "REFUND_REVIEW", order_status: "REFUND_REVIEW", ledger_count: "1", entitlement_count: "0",
  });
  assert.equal(lookups, 1);
  const verifiedNoCharge = await invoke(claimedNoCharge.paymentId);
  assert.equal(verifiedNoCharge.statusCode, 200, verifiedNoCharge.body);
  assert.equal((verifiedNoCharge.json() as { providerStatus: string; localStatus: string }).providerStatus, "FAILED");
  assert.equal((verifiedNoCharge.json() as { localStatus: string }).localStatus, "CANCELLED");
  const noChargeState = await pool.query<{ payment_status: string; order_status: string; ledger_count: string }>(
    `SELECT p.status AS payment_status,o.status AS order_status,
      (SELECT count(*)::text FROM payment_ledger_entries l WHERE l.payment_id=p.id) AS ledger_count
     FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=$1`, [claimedNoCharge.paymentId],
  );
  assert.deepEqual(noChargeState.rows[0], {
    payment_status: "CANCELLED", order_status: "CANCELLED", ledger_count: "0",
  });
  assert.equal(lookups, 2);
  const refundReason = "지연 승인 전액 취소";
  const refundKey = randomUUID();
  const refundRequest = (idempotencyKey: string) => app.inject({
    method: "POST", url: `/v1/admin/commerce/refund-reviews/${claimed.paymentId}/cancel`,
    headers: {
      authorization: `Bearer ${supervisorSession.token}`,
      "x-admin-reason": refundReason, "idempotency-key": idempotencyKey,
    },
    payload: { reason: refundReason },
  });
  const refunded = await refundRequest(refundKey);
  assert.equal(refunded.statusCode, 202, refunded.body);
  assert.equal((refunded.json() as { status: string }).status, "RECONCILED");
  assert.equal(cancellationCalls, 1);
  const replay = await refundRequest(refundKey);
  assert.equal(replay.statusCode, 202, replay.body);
  assert.equal(replay.headers["x-idempotent-replay"], "true");
  assert.equal(cancellationCalls, 1);
  const final = await pool.query<{
    payment_status: string; order_status: string; paid_entries: string;
    refund_entries: string; entitlement_count: string;
  }>(
    `SELECT p.status AS payment_status,o.status AS order_status,
      (SELECT count(*)::text FROM payment_ledger_entries l WHERE l.payment_id=p.id AND l.entry_type='PAYMENT') AS paid_entries,
      (SELECT count(*)::text FROM payment_ledger_entries l WHERE l.payment_id=p.id AND l.entry_type='REFUND') AS refund_entries,
      (SELECT count(*)::text FROM draw_entitlements e JOIN order_lines line ON line.id=e.order_line_id WHERE line.order_id=o.id) AS entitlement_count
     FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=$1`, [claimed.paymentId],
  );
  assert.deepEqual(final.rows[0], {
    payment_status: "REFUNDED", order_status: "REFUNDED", paid_entries: "1", refund_entries: "1", entitlement_count: "0",
  });
});
