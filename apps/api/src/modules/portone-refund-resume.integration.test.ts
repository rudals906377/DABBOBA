import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import { buildApp } from "../app.js";
import { acceptRequiredPoliciesForIntegrationTest } from "../integration-test-fixtures.js";
import { issueSession } from "../plugins/auth.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;

type ProviderView = "PAID" | "PAID_WITH_PENDING_CANCEL" | "CANCELLED";
type CancelReply = "FAILED" | "SUCCEEDED" | "UNKNOWN";

test("refund attempts resume after safe dead ends, abort restores the paid order, and INDETERMINATE never retries", {
  skip: !databaseUrl,
  timeout: 90_000,
}, async (t) => {
  const pool = createDatabasePool(databaseUrl!, "dabboba-refund-resume-integration");
  const config: ApiConfig = {
    environment: "test", host: "127.0.0.1", port: 8788, databaseUrl: databaseUrl!, redisUrl: "redis://127.0.0.1:6379",
    webOrigins: ["http://127.0.0.1:4174"], adminOrigins: ["http://127.0.0.1:4180"],
    sessionTokenPepper: "refund-resume-integration-pepper", adminProxyIdentitySecret: null,
    sessionTtlDays: 1, commerceMode: "LIVE", paymentProvider: "PORTONE_V2_INICIS",
    paymentWebhookSecret: "refund-resume-normalized-webhook-secret",
    portOne: {
      apiSecret: "synthetic-secret", merchantId: "synthetic-merchant", storeId: "synthetic-store",
      channelKey: "synthetic-channel", channelEnvironment: "TEST",
      webhookSecret: "refund-resume-portone-webhook-secret",
    },
    gcsBucket: null, gcsProjectId: null, logLevel: "silent",
  };
  const { app } = await buildApp({ config, pool, redis: null });
  t.after(async () => { await app.close(); await pool.end(); });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const adminUser = async (role: "ADMIN" | "SUPER_ADMIN") => {
    const user = await pool.query<{ id: string }>(
      "INSERT INTO users(email,nickname,role,status) VALUES($1,$2,$3,'ACTIVE') RETURNING id",
      [`resume-${role}-${suffix}@example.test`, `Resume ${role}`, role],
    );
    return (await issueSession(pool, config, {
      userId: user.rows[0]!.id, kind: "ADMIN", ip: "203.0.113.41", userAgent: "Refund resume integration test",
    })).token;
  };
  const operatorToken = await adminUser("ADMIN");
  const supervisorToken = await adminUser("SUPER_ADMIN");
  const owner = await pool.query<{ id: string }>(
    "INSERT INTO users(email,nickname,role,status) VALUES($1,'Resume customer','USER','ACTIVE') RETURNING id",
    [`resume-owner-${suffix}@example.test`],
  );
  const ownerId = owner.rows[0]!.id;
  await acceptRequiredPoliciesForIntegrationTest(pool, ownerId);
  const customerToken = (await issueSession(pool, config, {
    userId: ownerId, kind: "USER", ip: "203.0.113.42", userAgent: "Refund resume integration test",
  })).token;
  const ipId = `resume-ip-${suffix}`;
  const productId = `resume-gacha-${suffix}`;
  const prizeId = `resume-prize-${suffix}`;
  await pool.query("INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$3)", [ipId, ipId, `재개 ${suffix}`]);
  await pool.query(
    "INSERT INTO catalog_products(id,sku,ip_id,category,name,price) VALUES($1,$2,$3,'gacha',$4,10000)",
    [productId, `RESUME-${suffix}`.toUpperCase(), ipId, `가챠 ${suffix}`],
  );
  await pool.query(
    "INSERT INTO catalog_products(id,sku,ip_id,category,name,price,is_prize_only) VALUES($1,$2,$3,'figure',$4,0,true)",
    [prizeId, `RESUME-PRIZE-${suffix}`.toUpperCase(), ipId, `경품 ${suffix}`],
  );
  await pool.query("INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,3,0)", [productId]);
  const drawVersion = await pool.query<{ id: string }>(
    "INSERT INTO draw_probability_versions(product_id,version) VALUES($1,1) RETURNING id", [productId],
  );
  await pool.query(
    `INSERT INTO draw_pool_entries(probability_version_id,prize_product_id,prize_name_snapshot,
      prize_sku_snapshot,prize_ip_id_snapshot,prize_category_snapshot,rarity,weight,initial_quantity,remaining_quantity)
     VALUES($1,$2,$3,$4,$5,'figure','A',1,10,10)`,
    [drawVersion.rows[0]!.id, prizeId, `경품 ${suffix}`, `RESUME-PRIZE-${suffix}`.toUpperCase(), ipId],
  );
  const createPaidOrder = async (label: string) => {
    const order = await pool.query<{ id: string }>(
      "INSERT INTO orders(user_id,status,subtotal,total,paid_at) VALUES($1,'PAID',10000,10000,now()) RETURNING id", [ownerId],
    );
    const line = await pool.query<{ id: string }>(
      `INSERT INTO order_lines(order_id,product_id,product_name_snapshot,category_snapshot,probability_version_id,unit_price,quantity,line_total)
       VALUES($1,$2,$3,'gacha',$4,10000,1,10000) RETURNING id`,
      [order.rows[0]!.id, productId, `가챠 ${suffix}`, drawVersion.rows[0]!.id],
    );
    const entitlement = await pool.query<{ id: string }>(
      "INSERT INTO draw_entitlements(order_line_id,user_id,product_id,probability_version_id) VALUES($1,$2,$3,$4) RETURNING id",
      [line.rows[0]!.id, ownerId, productId, drawVersion.rows[0]!.id],
    );
    const payment = await pool.query<{ id: string }>(
      "INSERT INTO payments(order_id,provider,status,amount,paid_at) VALUES($1,'PORTONE_V2_INICIS','PAID',10000,now()) RETURNING id",
      [order.rows[0]!.id],
    );
    await pool.query(
      "INSERT INTO payment_ledger_entries(payment_id,order_id,entry_type,amount,reference_id) VALUES($1,$2,'PAYMENT',10000,$3)",
      [payment.rows[0]!.id, order.rows[0]!.id, `resume-paid-${label}-${suffix}`],
    );
    return { orderId: order.rows[0]!.id, paymentId: payment.rows[0]!.id, entitlementId: entitlement.rows[0]!.id };
  };

  const providerView = new Map<string, ProviderView>();
  const cancelReply = new Map<string, CancelReply>();
  const cancelCalls = new Map<string, number>();
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const paymentId = /\/payments\/([0-9a-f-]{36})/.exec(String(input))?.[1] ?? "";
    if (init?.method === "POST") {
      cancelCalls.set(paymentId, (cancelCalls.get(paymentId) ?? 0) + 1);
      const replyKind = cancelReply.get(paymentId) ?? "UNKNOWN";
      if (replyKind === "UNKNOWN") {
        return new Response(JSON.stringify({ type: "TransientProviderError" }), {
          status: 502, headers: { "content-type": "application/json" },
        });
      }
      if (replyKind === "SUCCEEDED") providerView.set(paymentId, "CANCELLED");
      return new Response(JSON.stringify({ cancellation: {
        status: replyKind, id: `cancel-${paymentId}-${cancelCalls.get(paymentId)}`, totalAmount: 10_000,
        taxFreeAmount: 0, vatAmount: 909, reason: "resume",
        requestedAt: "2026-09-30T00:01:00.000Z", ...(replyKind === "SUCCEEDED" ? { cancelledAt: "2026-09-30T00:01:01.000Z" } : {}),
      } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const view = providerView.get(paymentId) ?? "PAID";
    const cancelled = view === "CANCELLED";
    return new Response(JSON.stringify({
      id: paymentId, transactionId: `portone-${paymentId}`, pgTxId: `kg-${paymentId}`,
      merchantId: "synthetic-merchant", storeId: "synthetic-store", version: "V2",
      channel: { key: "synthetic-channel", type: "TEST", pgProvider: "INICIS_V2" },
      method: { type: "PaymentMethodCard" }, status: cancelled ? "CANCELLED" : "PAID",
      amount: { total: 10_000, paid: 10_000, cancelled: cancelled ? 10_000 : 0 }, currency: "KRW",
      requestedAt: "2026-09-30T00:00:00.000Z",
      statusChangedAt: cancelled ? "2026-09-30T00:01:01.000Z" : "2026-09-30T00:00:02.000Z",
      paidAt: "2026-09-30T00:00:02.000Z", ...(cancelled ? { cancelledAt: "2026-09-30T00:01:01.000Z" } : {}),
      cancellations: view === "PAID_WITH_PENDING_CANCEL" ? [{
        status: "REQUESTED", id: `pending-${paymentId}`, totalAmount: 10_000, taxFreeAmount: 0, vatAmount: 909,
        reason: "external", requestedAt: "2026-09-30T00:00:30.000Z",
      }] : [],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  const reason = "고객 요청 전액 환불 재시도";
  const adminHeaders = (token: string, key: string) => ({
    authorization: `Bearer ${token}`, "x-admin-reason": reason, "idempotency-key": key,
  });
  const refund = (paymentId: string, key: string) => app.inject({
    method: "POST", url: `/v1/admin/commerce/payments/${paymentId}/refund`,
    headers: adminHeaders(supervisorToken, key), payload: { reason },
  });
  const abort = (paymentId: string, key: string, token = supervisorToken) => app.inject({
    method: "POST", url: `/v1/admin/commerce/refund-reviews/${paymentId}/cancellation/abort`,
    headers: adminHeaders(token, key), payload: { reason },
  });
  const ledgerState = async (paymentId: string) => (await pool.query<{
    payment_status: string; order_status: string; ticket_status: string; attempt_status: string | null;
    last_error_code: string | null; attempt_rows: string;
  }>(
    `SELECT p.status AS payment_status,o.status AS order_status,e.status AS ticket_status,
       a.status AS attempt_status,a.last_error_code,
       (SELECT count(*)::text FROM portone_refund_cancellation_attempts x WHERE x.payment_id=p.id) AS attempt_rows
     FROM payments p JOIN orders o ON o.id=p.order_id JOIN order_lines line ON line.order_id=o.id
     JOIN draw_entitlements e ON e.order_line_id=line.id
     LEFT JOIN portone_refund_cancellation_attempts a ON a.payment_id=p.id WHERE p.id=$1`, [paymentId],
  )).rows[0]!;

  // A) Provider shows a pending external cancellation: the first request
  //    stops at PROVIDER_STATE_MISMATCH with the draw frozen and no call.
  const paid = await createPaidOrder("resume");
  providerView.set(paid.paymentId, "PAID_WITH_PENDING_CANCEL");
  const firstKey = `resume-first-${randomUUID()}`;
  const mismatch = await refund(paid.paymentId, firstKey);
  assert.equal(mismatch.statusCode, 202, mismatch.body);
  assert.deepEqual(await ledgerState(paid.paymentId), {
    payment_status: "REFUND_REVIEW", order_status: "REFUND_REVIEW", ticket_status: "AVAILABLE",
    attempt_status: "REVIEW_REQUIRED", last_error_code: "PROVIDER_STATE_MISMATCH", attempt_rows: "1",
  });
  const replay = await refund(paid.paymentId, firstKey);
  assert.equal(replay.headers["x-idempotent-replay"], "true");
  assert.equal(cancelCalls.get(paid.paymentId) ?? 0, 0);

  // Abort needs refunds.cancel and a provider that confirms no cancellation.
  const denied = await abort(paid.paymentId, `abort-denied-${randomUUID()}`, operatorToken);
  assert.equal(denied.statusCode, 403, denied.body);
  const unsafeAbort = await abort(paid.paymentId, `abort-unsafe-${randomUUID()}`);
  assert.equal(unsafeAbort.statusCode, 409, unsafeAbort.body);
  assert.equal((unsafeAbort.json() as { error: { code: string } }).error.code, "PROVIDER_STATE_MISMATCH");
  assert.equal((await ledgerState(paid.paymentId)).payment_status, "REFUND_REVIEW");

  // The external cancellation failed at the provider: abort unfreezes.
  providerView.set(paid.paymentId, "PAID");
  const abortKey = `abort-${randomUUID()}`;
  const aborted = await abort(paid.paymentId, abortKey);
  assert.equal(aborted.statusCode, 200, aborted.body);
  assert.equal((aborted.json() as { status: string; localPaymentStatus: string; lastErrorCode: string }).status, "PRECHECK_FAILED");
  assert.equal((aborted.json() as { localPaymentStatus: string }).localPaymentStatus, "PAID");
  assert.equal((aborted.json() as { lastErrorCode: string }).lastErrorCode, "ABORTED_BY_ADMIN");
  assert.deepEqual(await ledgerState(paid.paymentId), {
    payment_status: "PAID", order_status: "PAID", ticket_status: "AVAILABLE",
    attempt_status: "PRECHECK_FAILED", last_error_code: "ABORTED_BY_ADMIN", attempt_rows: "1",
  });
  const abortReplay = await abort(paid.paymentId, abortKey);
  assert.equal(abortReplay.statusCode, 200, abortReplay.body);
  assert.equal(abortReplay.headers["x-idempotent-replay"], "true");
  const abortAgain = await abort(paid.paymentId, `abort-again-${randomUUID()}`);
  assert.equal(abortAgain.statusCode, 409, abortAgain.body);
  const audits = await pool.query<{ action: string }>(
    "SELECT action FROM admin_audit_logs WHERE target_id=$1 ORDER BY created_at", [paid.paymentId],
  );
  assert.deepEqual(audits.rows.map((row) => row.action), ["PORTONE_DRAW_REFUND_PREPARED", "PORTONE_REFUND_ATTEMPT_ABORTED"]);

  // The unfrozen entitlement is usable again, but stays untouched here.
  // B) Resume after the abort; the provider reports the cancellation FAILED.
  cancelReply.set(paid.paymentId, "FAILED");
  const failed = await refund(paid.paymentId, `resume-second-${randomUUID()}`);
  assert.equal(failed.statusCode, 202, failed.body);
  assert.equal(cancelCalls.get(paid.paymentId), 1);
  assert.deepEqual(await ledgerState(paid.paymentId), {
    payment_status: "REFUND_REVIEW", order_status: "REFUND_REVIEW", ticket_status: "AVAILABLE",
    attempt_status: "REVIEW_REQUIRED", last_error_code: "PROVIDER_CANCEL_FAILED", attempt_rows: "1",
  });
  // A frozen draw cannot be consumed while the attempt waits.
  const frozenDraw = await app.inject({
    method: "POST", url: `/v1/draws/${paid.entitlementId}/consume`,
    headers: { authorization: `Bearer ${customerToken}`, "idempotency-key": randomUUID() },
  });
  assert.equal(frozenDraw.statusCode, 409, frozenDraw.body);

  // C) Resume after the provider-reported failure: one more call succeeds.
  cancelReply.set(paid.paymentId, "SUCCEEDED");
  const succeeded = await refund(paid.paymentId, `resume-third-${randomUUID()}`);
  assert.equal(succeeded.statusCode, 202, succeeded.body);
  assert.equal((succeeded.json() as { status: string }).status, "RECONCILED");
  assert.equal(cancelCalls.get(paid.paymentId), 2);
  assert.deepEqual(await ledgerState(paid.paymentId), {
    payment_status: "REFUNDED", order_status: "REFUNDED", ticket_status: "CANCELLED",
    attempt_status: "RECONCILED", last_error_code: null, attempt_rows: "1",
  });
  const settled = await refund(paid.paymentId, `resume-fourth-${randomUUID()}`);
  assert.equal(settled.statusCode, 409, settled.body);
  const resumedAudits = await pool.query<{ count: string }>(
    "SELECT count(*)::text FROM admin_audit_logs WHERE target_id=$1 AND action='PORTONE_REFUND_ATTEMPT_RESUMED'",
    [paid.paymentId],
  );
  assert.equal(resumedAudits.rows[0]!.count, "2");

  // D) INDETERMINATE is never retried or aborted automatically.
  const uncertain = await createPaidOrder("uncertain");
  cancelReply.set(uncertain.paymentId, "UNKNOWN");
  const unknown = await refund(uncertain.paymentId, `uncertain-${randomUUID()}`);
  assert.equal(unknown.statusCode, 202, unknown.body);
  assert.equal((unknown.json() as { status: string }).status, "INDETERMINATE");
  await pool.query(
    "UPDATE portone_refund_cancellation_attempts SET updated_at=now()-interval '1 day' WHERE payment_id=$1",
    [uncertain.paymentId],
  );
  const retry = await refund(uncertain.paymentId, `uncertain-retry-${randomUUID()}`);
  assert.equal(retry.statusCode, 409, retry.body);
  const abortUncertain = await abort(uncertain.paymentId, `uncertain-abort-${randomUUID()}`);
  assert.equal(abortUncertain.statusCode, 409, abortUncertain.body);
  assert.equal(cancelCalls.get(uncertain.paymentId), 1);
  assert.equal((await ledgerState(uncertain.paymentId)).attempt_status, "INDETERMINATE");

  // E) A stale PRECHECK left by a crashed request (draw already frozen) and a
  //    LOCAL_STATE_CHANGED review both resume after a full local recheck.
  for (const [label, status, code] of [["stale", "PRECHECK", null], ["local", "REVIEW_REQUIRED", "LOCAL_STATE_CHANGED"]] as const) {
    const stuck = await createPaidOrder(label);
    await pool.query("UPDATE payments SET status='REFUND_REVIEW',version=version+1 WHERE id=$1", [stuck.paymentId]);
    await pool.query("UPDATE orders SET status='REFUND_REVIEW',version=version+1 WHERE id=$1", [stuck.orderId]);
    const adminId = await pool.query<{ id: string }>("SELECT id FROM users WHERE email=$1", [`resume-SUPER_ADMIN-${suffix}@example.test`]);
    await pool.query(
      `INSERT INTO portone_refund_cancellation_attempts(payment_id,admin_id,idempotency_key,request_hash,reason,status,last_error_code,created_at,updated_at)
       VALUES($1,$2,$3,$4,'crashed attempt',$5,$6,now()-interval '5 minutes',now()-interval '5 minutes')`,
      [stuck.paymentId, adminId.rows[0]!.id, `crashed-${randomUUID()}`, "0".repeat(64), status, code],
    );
    cancelReply.set(stuck.paymentId, "SUCCEEDED");
    const resumed = await refund(stuck.paymentId, `resume-${label}-${randomUUID()}`);
    assert.equal(resumed.statusCode, 202, resumed.body);
    assert.equal((resumed.json() as { status: string }).status, "RECONCILED", label);
    assert.equal(cancelCalls.get(stuck.paymentId), 1, label);
    assert.equal((await ledgerState(stuck.paymentId)).payment_status, "REFUNDED", label);
  }

  // A fresh PRECHECK may still be in flight and is never taken over.
  const inFlight = await createPaidOrder("in-flight");
  const inFlightAdmin = await pool.query<{ id: string }>("SELECT id FROM users WHERE email=$1", [`resume-SUPER_ADMIN-${suffix}@example.test`]);
  await pool.query(
    `INSERT INTO portone_refund_cancellation_attempts(payment_id,admin_id,idempotency_key,request_hash,reason)
     VALUES($1,$2,$3,$4,'in flight')`,
    [inFlight.paymentId, inFlightAdmin.rows[0]!.id, `in-flight-${randomUUID()}`, "0".repeat(64)],
  );
  const takeover = await refund(inFlight.paymentId, `takeover-${randomUUID()}`);
  assert.equal(takeover.statusCode, 409, takeover.body);
  assert.equal(cancelCalls.get(inFlight.paymentId) ?? 0, 0);
});
