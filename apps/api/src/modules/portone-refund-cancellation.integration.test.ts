import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import { buildApp } from "../app.js";
import { selectCardChannel } from "../lib/portone-channel-binding.js";
import { issueSession } from "../plugins/auth.js";
import { acceptRequiredPoliciesForIntegrationTest } from "../integration-test-fixtures.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;

for (const cardPg of ["INICIS", "KCP"] as const) {
test(`${cardPg}: late PortOne refund is full, durable, super-admin only, and never sent twice`, {
  skip: !databaseUrl,
  timeout: 60_000,
}, async (t) => {
  const pool = createDatabasePool(databaseUrl!, "dabboba-portone-refund-integration");
  const config: ApiConfig = {
    environment: "test", host: "127.0.0.1", port: 8788, databaseUrl: databaseUrl!, redisUrl: "redis://127.0.0.1:6379",
    webOrigins: ["http://127.0.0.1:4174"], adminOrigins: ["http://127.0.0.1:4180"],
    sessionTokenPepper: "portone-refund-integration-pepper", adminProxyIdentitySecret: null,
    sessionTtlDays: 1, commerceMode: "LIVE", paymentProvider: "PORTONE_V2_INICIS",
    paymentWebhookSecret: "portone-refund-integration-webhook-secret",
    portOne: {
      apiSecret: "synthetic-secret", merchantId: "synthetic-merchant", storeId: "synthetic-store",
      channelKey: "synthetic-channel", kcpChannelKey: "channel-key-synthetic-kcp", channelEnvironment: "TEST",
      webhookSecret: "portone-refund-integration-webhook-secret",
    },
    gcsBucket: null, gcsProjectId: null, logLevel: "silent",
  };
  const selectedChannel = selectCardChannel(config, cardPg);
  const { app } = await buildApp({ config, pool, redis: null });
  t.after(async () => { await app.close(); await pool.end(); });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const actor = async (role: "ADMIN" | "SUPER_ADMIN") => {
    const user = await pool.query<{ id: string }>(
      "INSERT INTO users(email,nickname,role,status) VALUES($1,$2,$3,'ACTIVE') RETURNING id",
      [`refund-${role}-${suffix}@example.test`, `Refund ${role}`, role],
    );
    const session = await issueSession(pool, config, {
      userId: user.rows[0]!.id, kind: "ADMIN", ip: "203.0.113.41", userAgent: "Refund integration test",
    });
    return session.token;
  };
  const adminToken = await actor("ADMIN");
  const supervisorToken = await actor("SUPER_ADMIN");
  const owner = await pool.query<{ id: string }>(
    "INSERT INTO users(email,nickname,role,status) VALUES($1,$2,'USER','ACTIVE') RETURNING id",
    [`refund-owner-${suffix}@example.test`, `Refund owner ${suffix}`],
  );
  const ipId = `refund-ip-${suffix}`;
  const productId = `refund-gacha-${suffix}`;
  await pool.query("INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$3)", [ipId, ipId, `환불 테스트 ${suffix}`]);
  await pool.query(
    "INSERT INTO catalog_products(id,sku,ip_id,category,name,price) VALUES($1,$2,$3,'gacha',$4,10000)",
    [productId, `REFUND-${suffix}`.toUpperCase(), ipId, `환불 테스트 가챠 ${suffix}`],
  );
  await pool.query("INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,1,0)", [productId]);
  const drawVersion = await pool.query<{ id: string }>(
    "INSERT INTO draw_probability_versions(product_id,version) VALUES($1,1) RETURNING id", [productId],
  );
  const order = await pool.query<{ id: string }>(
    "INSERT INTO orders(user_id,status,subtotal,total,paid_at,cancelled_at) VALUES($1,'REFUND_REVIEW',10000,10000,now(),now()) RETURNING id",
    [owner.rows[0]!.id],
  );
  const orderId = order.rows[0]!.id;
  await pool.query(
    `INSERT INTO order_lines(order_id,product_id,product_name_snapshot,category_snapshot,probability_version_id,unit_price,quantity,line_total)
     VALUES($1,$2,$3,'gacha',$4,10000,1,10000)`, [orderId, productId, `환불 테스트 가챠 ${suffix}`, drawVersion.rows[0]!.id],
  );
  const payment = await pool.query<{ id: string }>(
    "INSERT INTO payments(order_id,provider,status,amount,paid_at,portone_channel_binding) VALUES($1,$2,'REFUND_REVIEW',10000,now(),$3) RETURNING id",
    [orderId, selectedChannel.provider, JSON.stringify(selectedChannel)],
  );
  const paymentId = payment.rows[0]!.id;
  await pool.query(
    "INSERT INTO payment_ledger_entries(payment_id,order_id,entry_type,amount,reference_id) VALUES($1,$2,'PAYMENT',10000,$3)",
    [paymentId, orderId, `paid-${suffix}`],
  );

  const key = `refund-${randomUUID()}`;
  const reason = "결제 지연으로 상품과 뽑기권 미발급";
  const request = (token: string, idempotencyKey = key) => app.inject({
    method: "POST", url: `/v1/admin/commerce/refund-reviews/${paymentId}/cancel`,
    headers: { authorization: `Bearer ${token}`, "x-admin-reason": reason, "idempotency-key": idempotencyKey },
    payload: { reason },
  });
  const denied = await request(adminToken);
  assert.equal(denied.statusCode, 403, denied.body);

  let lookupCount = 0;
  let cancelCount = 0;
  let uncertainPaymentId: string | null = null;
  let uncertainCancelCount = 0;
  let uncertainLookupCount = 0;
  let uncertainProviderCancelled = false;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const isUncertain = Boolean(uncertainPaymentId && String(input).includes(`/payments/${uncertainPaymentId}`));
    const requestedPaymentId = isUncertain ? uncertainPaymentId! : paymentId;
    assert.match(String(input), new RegExp(`/payments/${requestedPaymentId}`));
    if (init?.method === "POST") {
      if (isUncertain) {
        uncertainCancelCount += 1;
        return new Response(JSON.stringify({ type: "TransientProviderError" }), {
          status: 502, headers: { "content-type": "application/json" },
        });
      }
      cancelCount += 1;
      const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      assert.equal(sent.amount, 10_000);
      assert.equal(sent.currentCancellableAmount, 10_000);
      assert.equal(sent.requester, "ADMIN");
      return new Response(JSON.stringify({ cancellation: {
        status: "SUCCEEDED", id: `cancel-${suffix}`, totalAmount: 10_000,
        taxFreeAmount: 0, vatAmount: 909, reason,
        requestedAt: "2026-09-20T00:01:00.000Z", cancelledAt: "2026-09-20T00:01:01.000Z",
      } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (isUncertain) uncertainLookupCount += 1;
    else lookupCount += 1;
    const cancelled = isUncertain ? uncertainProviderCancelled : lookupCount > 1;
    return new Response(JSON.stringify({
      id: requestedPaymentId, transactionId: `portone-${suffix}-${requestedPaymentId}`, pgTxId: `kg-${suffix}-${requestedPaymentId}`,
      merchantId: "synthetic-merchant", storeId: "synthetic-store", version: "V2",
      channel: { key: selectedChannel.channelKey, type: "TEST", pgProvider: selectedChannel.pgProvider },
      method: { type: "PaymentMethodCard" },
      status: cancelled ? "CANCELLED" : "PAID",
      amount: { total: 10_000, paid: 10_000, cancelled: cancelled ? 10_000 : 0 }, currency: "KRW",
      requestedAt: "2026-09-20T00:00:00.000Z", statusChangedAt: cancelled ? "2026-09-20T00:01:01.000Z" : "2026-09-20T00:00:02.000Z",
      paidAt: "2026-09-20T00:00:02.000Z", cancelledAt: cancelled ? "2026-09-20T00:01:01.000Z" : null,
      cancellations: [],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  const first = await request(supervisorToken);
  assert.equal(first.statusCode, 202, first.body);
  assert.equal((first.json() as { status: string }).status, "RECONCILED");
  assert.equal(cancelCount, 1);
  assert.equal(lookupCount, 2);
  const replay = await request(supervisorToken);
  assert.equal(replay.statusCode, 202, replay.body);
  assert.equal(replay.headers["x-idempotent-replay"], "true");
  assert.equal(cancelCount, 1);
  const changedKey = await request(supervisorToken, `refund-other-${randomUUID()}`);
  assert.equal(changedKey.statusCode, 409, changedKey.body);
  assert.equal(cancelCount, 1);
  const state = await pool.query<{ payment_status: string; order_status: string; refund_entries: string }>(
    `SELECT p.status AS payment_status,o.status AS order_status,
      (SELECT count(*)::text FROM payment_ledger_entries l WHERE l.payment_id=p.id AND l.entry_type='REFUND') AS refund_entries
     FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=$1`, [paymentId],
  );
  assert.deepEqual(state.rows[0], { payment_status: "REFUNDED", order_status: "REFUNDED", refund_entries: "1" });

  const unsafeProductId = `refund-figure-${suffix}`;
  await pool.query(
    "INSERT INTO catalog_products(id,sku,ip_id,category,name,price) VALUES($1,$2,$3,'figure',$4,10000)",
    [unsafeProductId, `REFUND-FIGURE-${suffix}`.toUpperCase(), ipId, `환불 테스트 상품 ${suffix}`],
  );
  await pool.query("INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,1,0)", [unsafeProductId]);
  const unsafeOrder = await pool.query<{ id: string }>(
    "INSERT INTO orders(user_id,status,subtotal,total,paid_at,cancelled_at) VALUES($1,'REFUND_REVIEW',10000,10000,now(),now()) RETURNING id",
    [owner.rows[0]!.id],
  );
  const unsafeLine = await pool.query<{ id: string }>(
    `INSERT INTO order_lines(order_id,product_id,product_name_snapshot,category_snapshot,unit_price,quantity,line_total)
     VALUES($1,$2,$3,'figure',10000,1,10000) RETURNING id`,
    [unsafeOrder.rows[0]!.id, unsafeProductId, `환불 테스트 상품 ${suffix}`],
  );
  const unsafePayment = await pool.query<{ id: string }>(
    "INSERT INTO payments(order_id,provider,status,amount,paid_at,portone_channel_binding) VALUES($1,$2,'REFUND_REVIEW',10000,now(),$3) RETURNING id",
    [unsafeOrder.rows[0]!.id, selectedChannel.provider, JSON.stringify(selectedChannel)],
  );
  await pool.query(
    "INSERT INTO payment_ledger_entries(payment_id,order_id,entry_type,amount,reference_id) VALUES($1,$2,'PAYMENT',10000,$3)",
    [unsafePayment.rows[0]!.id, unsafeOrder.rows[0]!.id, `unsafe-paid-${suffix}`],
  );
  await pool.query(
    "INSERT INTO inventory_units(owner_id,product_id,source_type,source_id) VALUES($1,$2,'PURCHASE',$3)",
    [owner.rows[0]!.id, unsafeProductId, unsafeLine.rows[0]!.id],
  );
  const unsafe = await app.inject({
    method: "POST", url: `/v1/admin/commerce/refund-reviews/${unsafePayment.rows[0]!.id}/cancel`,
    headers: { authorization: `Bearer ${supervisorToken}`, "x-admin-reason": reason, "idempotency-key": `refund-unsafe-${randomUUID()}` },
    payload: { reason },
  });
  assert.equal(unsafe.statusCode, 409, unsafe.body);
  assert.equal(cancelCount, 1);

  const uncertainOrder = await pool.query<{ id: string }>(
    "INSERT INTO orders(user_id,status,subtotal,total,paid_at,cancelled_at) VALUES($1,'REFUND_REVIEW',10000,10000,now(),now()) RETURNING id",
    [owner.rows[0]!.id],
  );
  await pool.query(
    `INSERT INTO order_lines(order_id,product_id,product_name_snapshot,category_snapshot,probability_version_id,unit_price,quantity,line_total)
     VALUES($1,$2,$3,'gacha',$4,10000,1,10000)`,
    [uncertainOrder.rows[0]!.id, productId, `환불 테스트 가챠 ${suffix}`, drawVersion.rows[0]!.id],
  );
  const uncertainPayment = await pool.query<{ id: string }>(
    "INSERT INTO payments(order_id,provider,status,amount,paid_at,portone_channel_binding) VALUES($1,$2,'REFUND_REVIEW',10000,now(),$3) RETURNING id",
    [uncertainOrder.rows[0]!.id, selectedChannel.provider, JSON.stringify(selectedChannel)],
  );
  uncertainPaymentId = uncertainPayment.rows[0]!.id;
  await pool.query(
    "INSERT INTO payment_ledger_entries(payment_id,order_id,entry_type,amount,reference_id) VALUES($1,$2,'PAYMENT',10000,$3)",
    [uncertainPaymentId, uncertainOrder.rows[0]!.id, `uncertain-paid-${suffix}`],
  );
  const uncertain = await app.inject({
    method: "POST", url: `/v1/admin/commerce/refund-reviews/${uncertainPaymentId}/cancel`,
    headers: { authorization: `Bearer ${supervisorToken}`, "x-admin-reason": reason, "idempotency-key": `refund-uncertain-${randomUUID()}` },
    payload: { reason },
  });
  assert.equal(uncertain.statusCode, 202, uncertain.body);
  assert.equal((uncertain.json() as { status: string }).status, "INDETERMINATE");
  assert.equal(uncertainCancelCount, 1);
  assert.equal(uncertainLookupCount, 1);
  const uncertainDetail = await app.inject({
    method: "GET", url: `/v1/admin/commerce/refund-reviews/${uncertainPaymentId}`,
    headers: { authorization: `Bearer ${supervisorToken}` },
  });
  assert.equal(uncertainDetail.statusCode, 200, uncertainDetail.body);
  assert.equal((uncertainDetail.json() as { providerReconciliationAvailable: boolean }).providerReconciliationAvailable, true);
  const { app: prelaunchApp } = await buildApp({ config: { ...config, commerceMode: "PRELAUNCH" }, pool, redis: null });
  t.after(async () => { await prelaunchApp.close(); });
  const prelaunchDetail = await prelaunchApp.inject({
    method: "GET", url: `/v1/admin/commerce/refund-reviews/${uncertainPaymentId}`,
    headers: { authorization: `Bearer ${supervisorToken}` },
  });
  assert.equal(prelaunchDetail.statusCode, 200, prelaunchDetail.body);
  assert.equal((prelaunchDetail.json() as { providerReconciliationAvailable: boolean }).providerReconciliationAvailable, false);
  const deniedRecheck = await app.inject({
    method: "POST", url: `/v1/admin/commerce/refund-reviews/${uncertainPaymentId}/cancellation/reconcile`,
    headers: { authorization: `Bearer ${adminToken}`, "x-admin-reason": reason, "idempotency-key": `refund-denied-reconcile-${randomUUID()}` },
    payload: { reason },
  });
  assert.equal(deniedRecheck.statusCode, 403, deniedRecheck.body);
  const gatedRecheck = await prelaunchApp.inject({
    method: "POST", url: `/v1/admin/commerce/refund-reviews/${uncertainPaymentId}/cancellation/reconcile`,
    headers: { authorization: `Bearer ${supervisorToken}`, "x-admin-reason": reason, "idempotency-key": `refund-prelaunch-reconcile-${randomUUID()}` },
    payload: { reason },
  });
  assert.equal(gatedRecheck.statusCode, 503, gatedRecheck.body);
  assert.equal(uncertainLookupCount, 1);
  uncertainProviderCancelled = true;
  await pool.query(
    "UPDATE portone_refund_cancellation_attempts SET updated_at=now()-interval '1 minute' WHERE payment_id=$1",
    [uncertainPaymentId],
  );
  const rechecked = await app.inject({
    method: "POST", url: `/v1/admin/commerce/refund-reviews/${uncertainPaymentId}/cancellation/reconcile`,
    headers: { authorization: `Bearer ${supervisorToken}`, "x-admin-reason": reason, "idempotency-key": `refund-reconcile-${randomUUID()}` },
    payload: { reason },
  });
  assert.equal(rechecked.statusCode, 200, rechecked.body);
  assert.equal((rechecked.json() as { status: string }).status, "RECONCILED");
  assert.equal(uncertainCancelCount, 1);
  assert.equal(uncertainLookupCount, 2);

  const gated = await prelaunchApp.inject({
    method: "POST", url: `/v1/admin/commerce/refund-reviews/${paymentId}/cancel`,
    headers: { authorization: `Bearer ${supervisorToken}`, "x-admin-reason": reason, "idempotency-key": `refund-gated-${randomUUID()}` },
    payload: { reason },
  });
  assert.equal(gated.statusCode, 503, gated.body);
  assert.equal(cancelCount, 1);
});

test(`${cardPg}: a paid unused gacha order freezes before one PortOne refund and restores its entitlement and stock`, {
  skip: !databaseUrl,
  timeout: 60_000,
}, async (t) => {
  const pool = createDatabasePool(databaseUrl!, "dabboba-normal-draw-refund-integration");
  const config: ApiConfig = {
    environment: "test", host: "127.0.0.1", port: 8788, databaseUrl: databaseUrl!, redisUrl: "redis://127.0.0.1:6379",
    webOrigins: ["http://127.0.0.1:4174"], adminOrigins: ["http://127.0.0.1:4180"],
    sessionTokenPepper: "normal-refund-integration-pepper", adminProxyIdentitySecret: null,
    sessionTtlDays: 1, commerceMode: "LIVE", paymentProvider: "PORTONE_V2_INICIS",
    paymentWebhookSecret: "normal-refund-integration-webhook-secret",
    portOne: {
      apiSecret: "synthetic-secret", merchantId: "synthetic-merchant", storeId: "synthetic-store",
      channelKey: "synthetic-channel", kcpChannelKey: "channel-key-synthetic-kcp", channelEnvironment: "TEST",
      webhookSecret: "normal-refund-integration-webhook-secret",
    },
    gcsBucket: null, gcsProjectId: null, logLevel: "silent",
  };
  const selectedChannel = selectCardChannel(config, cardPg);
  const { app } = await buildApp({ config, pool, redis: null });
  t.after(async () => { await app.close(); await pool.end(); });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const admin = await pool.query<{ id: string }>(
    "INSERT INTO users(email,nickname,role,status) VALUES($1,'Refund supervisor','SUPER_ADMIN','ACTIVE') RETURNING id",
    [`normal-refund-admin-${suffix}@example.test`],
  );
  const owner = await pool.query<{ id: string }>(
    "INSERT INTO users(email,nickname,role,status) VALUES($1,'Refund customer','USER','ACTIVE') RETURNING id",
    [`normal-refund-owner-${suffix}@example.test`],
  );
  await acceptRequiredPoliciesForIntegrationTest(pool, owner.rows[0]!.id);
  const adminSession = await issueSession(pool, config, {
    userId: admin.rows[0]!.id, kind: "ADMIN", ip: "203.0.113.41", userAgent: "Refund integration test",
  });
  const customerSession = await issueSession(pool, config, {
    userId: owner.rows[0]!.id, kind: "USER", ip: "203.0.113.42", userAgent: "Refund integration test",
  });
  const ipId = `normal-refund-ip-${suffix}`;
  const productId = `normal-refund-gacha-${suffix}`;
  await pool.query("INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$3)", [ipId, ipId, `환불 테스트 ${suffix}`]);
  await pool.query(
    "INSERT INTO catalog_products(id,sku,ip_id,category,name,price) VALUES($1,$2,$3,'gacha',$4,10000)",
    [productId, `NORMAL-REFUND-${suffix}`.toUpperCase(), ipId, `미사용 가챠 ${suffix}`],
  );
  await pool.query("INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,3,0)", [productId]);
  const drawVersion = await pool.query<{ id: string }>(
    "INSERT INTO draw_probability_versions(product_id,version) VALUES($1,1) RETURNING id", [productId],
  );
  const prizeProductId = `normal-refund-prize-${suffix}`;
  const prizeSku = `NORMAL-PRIZE-${suffix}`.toUpperCase();
  await pool.query(
    "INSERT INTO catalog_products(id,sku,ip_id,category,name,price,is_prize_only) VALUES($1,$2,$3,'figure',$4,0,true)",
    [prizeProductId, prizeSku, ipId, `환불 테스트 경품 ${suffix}`],
  );
  await pool.query(
    `INSERT INTO draw_pool_entries(probability_version_id,prize_product_id,prize_name_snapshot,
      prize_sku_snapshot,prize_ip_id_snapshot,prize_category_snapshot,rarity,weight,initial_quantity,remaining_quantity)
     VALUES($1,$2,$3,$4,$5,'figure','A',1,10,10)`,
    [drawVersion.rows[0]!.id, prizeProductId, `환불 테스트 경품 ${suffix}`, prizeSku, ipId],
  );
  const createPaidOrder = async (label: string, entitlementStatus = "AVAILABLE") => {
    const order = await pool.query<{ id: string }>(
      "INSERT INTO orders(user_id,status,subtotal,total,paid_at) VALUES($1,'PAID',10000,10000,now()) RETURNING id",
      [owner.rows[0]!.id],
    );
    const line = await pool.query<{ id: string }>(
      `INSERT INTO order_lines(order_id,product_id,product_name_snapshot,category_snapshot,probability_version_id,unit_price,quantity,line_total)
       VALUES($1,$2,$3,'gacha',$4,10000,1,10000) RETURNING id`,
      [order.rows[0]!.id, productId, `미사용 가챠 ${suffix}`, drawVersion.rows[0]!.id],
    );
    const entitlement = await pool.query<{ id: string }>(
      "INSERT INTO draw_entitlements(order_line_id,user_id,product_id,probability_version_id,status) VALUES($1,$2,$3,$4,$5) RETURNING id",
      [line.rows[0]!.id, owner.rows[0]!.id, productId, drawVersion.rows[0]!.id, entitlementStatus],
    );
    const payment = await pool.query<{ id: string }>(
      "INSERT INTO payments(order_id,provider,status,amount,paid_at,portone_channel_binding) VALUES($1,$2,'PAID',10000,now(),$3) RETURNING id",
      [order.rows[0]!.id, selectedChannel.provider, JSON.stringify(selectedChannel)],
    );
    await pool.query(
      "INSERT INTO payment_ledger_entries(payment_id,order_id,entry_type,amount,reference_id) VALUES($1,$2,'PAYMENT',10000,$3)",
      [payment.rows[0]!.id, order.rows[0]!.id, `paid-${label}-${suffix}`],
    );
    return { orderId: order.rows[0]!.id, entitlementId: entitlement.rows[0]!.id, paymentId: payment.rows[0]!.id };
  };
  const paid = await createPaidOrder("unused");
  const consumed = await createPaidOrder("consumed", "CONSUMED");

  let cancelCalls = 0;
  let paidLookups = 0;
  let failedPrecheckPaymentId: string | null = null;
  let precheckProviderUnavailable = true;
  let precheckRecoveryLookups = 0;
  let precheckRecoveryCancellations = 0;
  let signalCancelStarted!: () => void;
  let releaseCancel!: () => void;
  const cancelStarted = new Promise<void>((resolve) => { signalCancelStarted = resolve; });
  const cancelGate = new Promise<void>((resolve) => { releaseCancel = resolve; });
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    if (failedPrecheckPaymentId && String(input).includes(`/payments/${failedPrecheckPaymentId}`)) {
      if (precheckProviderUnavailable) {
        assert.notEqual(init?.method, "POST", "a failed provider lookup must not send a cancellation");
        return new Response(JSON.stringify({ type: "TransientProviderError" }), {
          status: 502, headers: { "content-type": "application/json" },
        });
      }
      if (init?.method === "POST") {
        precheckRecoveryCancellations += 1;
        return new Response(JSON.stringify({ cancellation: {
          status: "SUCCEEDED", id: `precheck-recovery-${suffix}`, totalAmount: 10_000,
          taxFreeAmount: 0, vatAmount: 909, reason: "고객 요청 전액 환불",
          requestedAt: "2026-09-20T00:01:00.000Z", cancelledAt: "2026-09-20T00:01:01.000Z",
        } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      precheckRecoveryLookups += 1;
      const cancelled = precheckRecoveryLookups > 1;
      return new Response(JSON.stringify({
        id: failedPrecheckPaymentId, transactionId: `portone-precheck-${suffix}`, pgTxId: `kg-precheck-${suffix}`,
        merchantId: "synthetic-merchant", storeId: "synthetic-store", version: "V2",
        channel: { key: selectedChannel.channelKey, type: "TEST", pgProvider: selectedChannel.pgProvider },
        method: { type: "PaymentMethodCard" }, status: cancelled ? "CANCELLED" : "PAID",
        amount: { total: 10_000, paid: 10_000, cancelled: cancelled ? 10_000 : 0 }, currency: "KRW",
        requestedAt: "2026-09-20T00:00:00.000Z", statusChangedAt: cancelled ? "2026-09-20T00:01:01.000Z" : "2026-09-20T00:00:02.000Z",
        paidAt: "2026-09-20T00:00:02.000Z", cancelledAt: cancelled ? "2026-09-20T00:01:01.000Z" : null,
        cancellations: [],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    assert.match(String(input), new RegExp(`/payments/${paid.paymentId}`));
    if (init?.method === "POST") {
      cancelCalls += 1;
      assert.equal((JSON.parse(String(init.body)) as { amount: number }).amount, 10_000);
      signalCancelStarted();
      await cancelGate;
      return new Response(JSON.stringify({ cancellation: {
        status: "SUCCEEDED", id: `normal-cancel-${suffix}`, totalAmount: 10_000,
        taxFreeAmount: 0, vatAmount: 909, reason: "고객 요청 전액 환불",
        requestedAt: "2026-09-20T00:01:00.000Z", cancelledAt: "2026-09-20T00:01:01.000Z",
      } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    paidLookups += 1;
    const cancelled = paidLookups > 1;
    return new Response(JSON.stringify({
      id: paid.paymentId, transactionId: `portone-${suffix}`, pgTxId: `kg-${suffix}`,
      merchantId: "synthetic-merchant", storeId: "synthetic-store", version: "V2",
      channel: { key: selectedChannel.channelKey, type: "TEST", pgProvider: selectedChannel.pgProvider },
      method: { type: "PaymentMethodCard" }, status: cancelled ? "CANCELLED" : "PAID",
      amount: { total: 10_000, paid: 10_000, cancelled: cancelled ? 10_000 : 0 }, currency: "KRW",
      requestedAt: "2026-09-20T00:00:00.000Z", statusChangedAt: cancelled ? "2026-09-20T00:01:01.000Z" : "2026-09-20T00:00:02.000Z",
      paidAt: "2026-09-20T00:00:02.000Z", cancelledAt: cancelled ? "2026-09-20T00:01:01.000Z" : null,
      cancellations: [],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const reason = "고객 요청 전액 환불";
  const rejectConsumed = await app.inject({
    method: "POST", url: `/v1/admin/commerce/payments/${consumed.paymentId}/refund`,
    headers: { authorization: `Bearer ${adminSession.token}`, "x-admin-reason": reason, "idempotency-key": randomUUID() },
    payload: { reason },
  });
  assert.equal(rejectConsumed.statusCode, 409, rejectConsumed.body);
  assert.equal(cancelCalls, 0);
  const refundPromise = app.inject({
    method: "POST", url: `/v1/admin/commerce/payments/${paid.paymentId}/refund`,
    headers: { authorization: `Bearer ${adminSession.token}`, "x-admin-reason": reason, "idempotency-key": randomUUID() },
    payload: { reason },
  });
  let cancelStartTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([cancelStarted, new Promise<never>((_resolve, reject) => {
      cancelStartTimeout = setTimeout(() => reject(new Error("PortOne cancellation was not reached")), 5_000);
    })]);
    const frozen = await pool.query<{ order_status: string; payment_status: string }>(
      "SELECT o.status AS order_status,p.status AS payment_status FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=$1",
      [paid.paymentId],
    );
    assert.deepEqual(frozen.rows[0], { order_status: "REFUND_REVIEW", payment_status: "REFUND_REVIEW" });
    const draw = await app.inject({
      method: "POST", url: `/v1/draws/${paid.entitlementId}/consume`,
      headers: { authorization: `Bearer ${customerSession.token}`, "idempotency-key": randomUUID() },
      payload: {},
    });
    assert.equal(draw.statusCode, 409, draw.body);
  } finally {
    if (cancelStartTimeout) clearTimeout(cancelStartTimeout);
    releaseCancel();
  }
  const refunded = await refundPromise;
  assert.equal(refunded.statusCode, 202, refunded.body);
  assert.equal((refunded.json() as { status: string }).status, "RECONCILED");
  assert.equal(cancelCalls, 1);
  const state = await pool.query<{ payment_status: string; order_status: string; ticket_status: string; on_hand: number; refund_entries: string }>(
    `SELECT p.status AS payment_status,o.status AS order_status,e.status AS ticket_status,s.on_hand,
      (SELECT count(*)::text FROM payment_ledger_entries l WHERE l.payment_id=p.id AND l.entry_type='REFUND') AS refund_entries
     FROM payments p JOIN orders o ON o.id=p.order_id JOIN order_lines line ON line.order_id=o.id
     JOIN draw_entitlements e ON e.order_line_id=line.id JOIN product_stock s ON s.product_id=line.product_id WHERE p.id=$1`,
    [paid.paymentId],
  );
  assert.deepEqual(state.rows[0], {
    payment_status: "REFUNDED", order_status: "REFUNDED", ticket_status: "CANCELLED", on_hand: 4, refund_entries: "1",
  });
  const auditList = await app.inject({
    method: "GET", url: `/v1/admin/commerce/refund-reviews?q=${paid.paymentId}`,
    headers: { authorization: `Bearer ${adminSession.token}` },
  });
  assert.equal(auditList.statusCode, 200, auditList.body);
  assert.equal((auditList.json() as { items: Array<{ id: string; providerCancellationStatus: string }> }).items
    .find((item) => item.id === paid.paymentId)?.providerCancellationStatus, "RECONCILED");
  const auditDetail = await app.inject({
    method: "GET", url: `/v1/admin/commerce/refund-reviews/${paid.paymentId}`,
    headers: { authorization: `Bearer ${adminSession.token}` },
  });
  assert.equal(auditDetail.statusCode, 200, auditDetail.body);
  assert.equal((auditDetail.json() as { providerCancellation: { status: string } }).providerCancellation.status, "RECONCILED");

  const failedPrecheck = await createPaidOrder("failed-precheck");
  failedPrecheckPaymentId = failedPrecheck.paymentId;
  const precheckResponse = await app.inject({
    method: "POST", url: `/v1/admin/commerce/payments/${failedPrecheck.paymentId}/refund`,
    headers: { authorization: `Bearer ${adminSession.token}`, "x-admin-reason": reason, "idempotency-key": randomUUID() },
    payload: { reason },
  });
  assert.equal(precheckResponse.statusCode, 502, precheckResponse.body);
  const afterPrecheckFailure = await pool.query<{
    payment_status: string; order_status: string; entitlement_status: string; attempt_count: string;
  }>(
    `SELECT p.status AS payment_status,o.status AS order_status,e.status AS entitlement_status,
       (SELECT count(*)::text FROM portone_refund_cancellation_attempts a WHERE a.payment_id=p.id) AS attempt_count
       FROM payments p JOIN orders o ON o.id=p.order_id
       JOIN order_lines line ON line.order_id=o.id
       JOIN draw_entitlements e ON e.order_line_id=line.id
      WHERE p.id=$1`,
    [failedPrecheck.paymentId],
  );
  assert.deepEqual(afterPrecheckFailure.rows[0], {
    payment_status: "PAID", order_status: "PAID", entitlement_status: "AVAILABLE", attempt_count: "0",
  });
  precheckProviderUnavailable = false;
  const recoveredPrecheck = await app.inject({
    method: "POST", url: `/v1/admin/commerce/payments/${failedPrecheck.paymentId}/refund`,
    headers: { authorization: `Bearer ${adminSession.token}`, "x-admin-reason": reason, "idempotency-key": randomUUID() },
    payload: { reason },
  });
  assert.equal(recoveredPrecheck.statusCode, 202, recoveredPrecheck.body);
  assert.equal((recoveredPrecheck.json() as { status: string }).status, "RECONCILED");
  assert.equal(precheckRecoveryLookups, 2);
  assert.equal(precheckRecoveryCancellations, 1);
  const recoveredTicket = await pool.query<{ status: string }>(
    "SELECT status FROM draw_entitlements WHERE id=$1",
    [failedPrecheck.entitlementId],
  );
  assert.equal(recoveredTicket.rows[0]?.status, "CANCELLED");
});

}
