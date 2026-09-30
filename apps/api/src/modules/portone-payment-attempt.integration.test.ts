import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import { buildApp } from "../app.js";
import { acceptRequiredPoliciesForIntegrationTest } from "../integration-test-fixtures.js";
import { issueSession } from "../plugins/auth.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;

test("PortOne PG window claim is owned, single-use, reservation-bound, and disabled in PRELAUNCH", {
  skip: !databaseUrl,
  timeout: 60_000,
}, async (t) => {
  const pool = createDatabasePool(databaseUrl!, "dabboba-portone-payment-attempt-integration");
  const config: ApiConfig = {
    environment: "test", host: "127.0.0.1", port: 8788, databaseUrl: databaseUrl!, redisUrl: "redis://127.0.0.1:6379",
    webOrigins: ["http://127.0.0.1:4174"], adminOrigins: ["http://127.0.0.1:4180"],
    sessionTokenPepper: "portone-payment-attempt-integration-pepper", adminProxyIdentitySecret: null,
    sessionTtlDays: 1, commerceMode: "LIVE", paymentProvider: "PORTONE_V2_INICIS",
    paymentWebhookSecret: "portone-attempt-webhook-secret",
    portOne: {
      apiSecret: "synthetic-secret", merchantId: "synthetic-merchant", storeId: "synthetic-store",
      channelKey: "synthetic-channel", channelEnvironment: "TEST",
      webhookSecret: "portone-attempt-webhook-secret",
    },
    gcsBucket: null, gcsProjectId: null, logLevel: "silent",
  };
  const { app } = await buildApp({ config, pool, redis: null });
  t.after(async () => { await app.close(); await pool.end(); });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const actor = async (label: string) => {
    const user = await pool.query<{ id: string }>(
      "INSERT INTO users(email,nickname,role,status) VALUES($1,$2,'USER','ACTIVE') RETURNING id",
      [`attempt-${label}-${suffix}@example.test`, `Attempt ${label}`],
    );
    const id = user.rows[0]!.id;
    await acceptRequiredPoliciesForIntegrationTest(pool, id);
    const session = await issueSession(pool, config, {
      userId: id, kind: "USER", ip: "203.0.113.93", userAgent: "PortOne attempt integration test",
    });
    return { id, token: session.token };
  };
  const owner = await actor("owner");
  const stranger = await actor("stranger");
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const ipId = `attempt-ip-${suffix}`;
  const productId = `attempt-gacha-${suffix}`;
  await pool.query("INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$3)", [ipId, ipId, `결제 시도 ${suffix}`]);
  await pool.query(
    "INSERT INTO catalog_products(id,sku,ip_id,category,name,price) VALUES($1,$2,$3,'gacha',$4,6000)",
    [productId, `PA-${suffix}`.toUpperCase(), ipId, `가챠 ${suffix}`],
  );
  await pool.query("INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,2,2)", [productId]);
  const version = await pool.query<{ id: string }>(
    "INSERT INTO draw_probability_versions(product_id,version) VALUES($1,1) RETURNING id", [productId],
  );
  const probabilityVersionId = version.rows[0]!.id;

  const productOrder = async (expiresInSeconds: number) => {
    const order = await pool.query<{ id: string }>(
      "INSERT INTO orders(user_id,subtotal,total) VALUES($1,6000,6000) RETURNING id", [owner.id],
    );
    const orderId = order.rows[0]!.id;
    const line = await pool.query<{ id: string }>(
      `INSERT INTO order_lines(order_id,product_id,product_name_snapshot,category_snapshot,probability_version_id,unit_price,quantity,line_total)
       VALUES($1,$2,$3,'gacha',$4,6000,1,6000) RETURNING id`,
      [orderId, productId, `가챠 ${suffix}`, probabilityVersionId],
    );
    await pool.query(
      `INSERT INTO stock_reservations(order_id,order_line_id,product_id,quantity,expires_at)
       VALUES($1,$2,$3,1,clock_timestamp()+($4::integer * interval '1 second'))`,
      [orderId, line.rows[0]!.id, productId, expiresInSeconds],
    );
    const payment = await pool.query<{ id: string }>(
      "INSERT INTO payments(order_id,provider,amount) VALUES($1,'PORTONE_V2_INICIS',6000) RETURNING id", [orderId],
    );
    return { orderId, paymentId: payment.rows[0]!.id };
  };
  const gacha = await productOrder(900);
  const beforeClaim = await pool.query<{ version: number }>(
    "SELECT version FROM payments WHERE id=$1", [gacha.paymentId],
  );
  const initialVersion = beforeClaim.rows[0]!.version;
  await pool.query(
    `INSERT INTO worker_payment_reconciliations(
      payment_id,payment_version,attempts,last_outcome,last_observed_state,
      last_attempted_at,next_attempt_at
    ) VALUES($1,$2,8,'UNKNOWN','UNKNOWN',clock_timestamp(),clock_timestamp()+interval '24 hours')`,
    [gacha.paymentId, initialVersion],
  );
  const path = `/v1/payments/${gacha.paymentId}/attempt`;
  const foreign = await app.inject({ method: "POST", url: path, headers: auth(stranger.token) });
  assert.equal(foreign.statusCode, 404, foreign.body);
  const first = await app.inject({ method: "POST", url: path, headers: auth(owner.token) });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal((first.json() as { orderId: string }).orderId, gacha.orderId);
  const claimedPayment = await pool.query<{
    version: number; pg_attempt_started_at: Date | null; reconciliation_version: number;
  }>(
    `SELECT p.version,p.pg_attempt_started_at,r.payment_version AS reconciliation_version
       FROM payments p JOIN worker_payment_reconciliations r ON r.payment_id=p.id
      WHERE p.id=$1`, [gacha.paymentId],
  );
  assert.ok(claimedPayment.rows[0]!.pg_attempt_started_at);
  assert.equal(claimedPayment.rows[0]!.version, initialVersion + 1);
  assert.equal(claimedPayment.rows[0]!.reconciliation_version, initialVersion);
  const repeat = await app.inject({ method: "POST", url: path, headers: auth(owner.token) });
  assert.equal(repeat.statusCode, 409, repeat.body);
  assert.equal((repeat.json() as { error: { code: string } }).error.code, "PAYMENT_ATTEMPT_ALREADY_STARTED");
  const afterRepeat = await pool.query<{ version: number }>(
    "SELECT version FROM payments WHERE id=$1", [gacha.paymentId],
  );
  assert.equal(afterRepeat.rows[0]!.version, initialVersion + 1);

  const expired = await productOrder(-1);
  const expiredClaim = await app.inject({ method: "POST", url: `/v1/payments/${expired.paymentId}/attempt`, headers: auth(owner.token) });
  assert.equal(expiredClaim.statusCode, 409, expiredClaim.body);
  const noClaim = await pool.query<{ pg_attempt_started_at: Date | null }>(
    "SELECT pg_attempt_started_at FROM payments WHERE id=$1", [expired.paymentId],
  );
  assert.equal(noClaim.rows[0]!.pg_attempt_started_at, null);

  const shipping = await pool.query<{ id: string }>(
    `INSERT INTO shipping_requests(
      user_id,status,address_snapshot,reference_subtotal,free_shipping_threshold,
      qualifies_for_free_shipping,contains_kuji
    ) VALUES($1,'PAYMENT_PENDING','{}'::jsonb,1000,24900,false,false) RETURNING id`,
    [owner.id],
  );
  const shippingOrder = await pool.query<{ id: string }>(
    `INSERT INTO orders(user_id,subtotal,total,order_kind,shipping_request_id)
     VALUES($1,3000,3000,'SHIPPING_FEE',$2) RETURNING id`, [owner.id, shipping.rows[0]!.id],
  );
  const shippingPayment = await pool.query<{ id: string }>(
    "INSERT INTO payments(order_id,provider,amount) VALUES($1,'PORTONE_V2_INICIS',3000) RETURNING id",
    [shippingOrder.rows[0]!.id],
  );
  const shippingClaim = await app.inject({
    method: "POST", url: `/v1/payments/${shippingPayment.rows[0]!.id}/attempt`, headers: auth(owner.token),
  });
  assert.equal(shippingClaim.statusCode, 200, shippingClaim.body);

  const prelaunchConfig: ApiConfig = {
    ...config, commerceMode: "PRELAUNCH", paymentProvider: "UNCONFIGURED",
    paymentWebhookSecret: null, portOne: null,
  };
  const prelaunch = await buildApp({ config: prelaunchConfig, pool, redis: null });
  t.after(async () => { await prelaunch.app.close(); });
  const prelaunchPayment = await productOrder(900);
  const blocked = await prelaunch.app.inject({
    method: "POST", url: `/v1/payments/${prelaunchPayment.paymentId}/attempt`, headers: auth(owner.token),
  });
  assert.equal(blocked.statusCode, 503, blocked.body);
  const unchanged = await pool.query<{ pg_attempt_started_at: Date | null }>(
    "SELECT pg_attempt_started_at FROM payments WHERE id=$1", [prelaunchPayment.paymentId],
  );
  assert.equal(unchanged.rows[0]!.pg_attempt_started_at, null);
});
