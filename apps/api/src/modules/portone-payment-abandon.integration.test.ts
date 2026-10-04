import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import { buildApp } from "../app.js";
import { acceptRequiredPoliciesForIntegrationTest } from "../integration-test-fixtures.js";
import { issueSession } from "../plugins/auth.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;

type ProviderState = "READY" | "READY_REQUEST_AMOUNT" | "FAILED_WINDOW_CLOSE" | "PAY_PENDING" | "PAID" | "NOT_FOUND" | "UNAVAILABLE"
  | `${"READY" | "FAILED" | "CANCELLED"}_${"PAID_AT" | "PG_TX"}`;

test("an abandoned PortOne window releases only an authoritatively unpaid order, idempotently", {
  skip: !databaseUrl,
  timeout: 60_000,
}, async (t) => {
  const pool = createDatabasePool(databaseUrl!, "dabboba-portone-abandon-integration");
  const config: ApiConfig = {
    environment: "test", host: "127.0.0.1", port: 8788, databaseUrl: databaseUrl!, redisUrl: "redis://127.0.0.1:6379",
    webOrigins: ["http://127.0.0.1:4174"], adminOrigins: ["http://127.0.0.1:4180"],
    sessionTokenPepper: "portone-abandon-integration-pepper", adminProxyIdentitySecret: null,
    sessionTtlDays: 1, commerceMode: "LIVE", paymentProvider: "PORTONE_V2_INICIS",
    paymentWebhookSecret: "portone-abandon-normalized-webhook-secret",
    portOne: {
      apiSecret: "synthetic-secret", merchantId: "synthetic-merchant", storeId: "synthetic-store",
      channelKey: "synthetic-channel", channelEnvironment: "TEST",
      webhookSecret: "portone-abandon-webhook-secret",
    },
    gcsBucket: null, gcsProjectId: null, logLevel: "silent",
  };
  const { app } = await buildApp({ config, pool, redis: null });
  t.after(async () => { await app.close(); await pool.end(); });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const actor = async (label: string) => {
    const user = await pool.query<{ id: string }>(
      "INSERT INTO users(email,nickname,role,status) VALUES($1,$2,'USER','ACTIVE') RETURNING id",
      [`abandon-${label}-${suffix}@example.test`, `Abandon ${label}`],
    );
    const id = user.rows[0]!.id;
    await acceptRequiredPoliciesForIntegrationTest(pool, id);
    const session = await issueSession(pool, config, {
      userId: id, kind: "USER", ip: "203.0.113.95", userAgent: "PortOne abandon integration test",
    });
    return { id, token: session.token };
  };
  const owner = await actor("owner");
  const waiter = await actor("waiter");
  const stranger = await actor("stranger");
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  // The abandon route is limited per session (6/min). Each scenario block uses
  // a fresh session for the same owner so the blocks stay independent.
  const ownerSession = async (userId = owner.id) => (await issueSession(pool, config, {
    userId, kind: "USER", ip: "203.0.113.95", userAgent: "PortOne abandon integration test",
  })).token;

  // Provider state is chosen per payment; every lookup is counted.
  const providerState = new Map<string, ProviderState>();
  const lookups = new Map<string, number>();
  let cancellationRequests = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    if (init?.method !== "GET") {
      cancellationRequests += 1;
      throw new Error("abandon must never request a provider cancellation");
    }
    const paymentId = /\/payments\/([0-9a-f-]{36})/.exec(String(input))?.[1] ?? "";
    lookups.set(paymentId, (lookups.get(paymentId) ?? 0) + 1);
    const state = providerState.get(paymentId) ?? "UNAVAILABLE";
    if (state === "UNAVAILABLE") throw new Error("synthetic network failure");
    if (state === "NOT_FOUND") {
      return new Response(JSON.stringify({ type: "PAYMENT_NOT_FOUND", message: "not found" }), {
        status: 404, headers: { "content-type": "application/json" },
      });
    }
    const amount = await pool.query<{ amount: number }>("SELECT amount FROM payments WHERE id=$1", [paymentId]);
    const total = Number(amount.rows[0]!.amount);
    const paid = state === "PAID" || state === "READY_REQUEST_AMOUNT" || state === "FAILED_WINDOW_CLOSE" ? total : 0;
    const contradictoryStatus = /^(READY|FAILED|CANCELLED)_(PAID_AT|PG_TX)$/.exec(state)?.[1];
    return new Response(JSON.stringify({
      id: paymentId, transactionId: `portone-${paymentId}`, ...(state === "PAID" || state.endsWith("_PG_TX") ? { pgTxId: `kg-${paymentId}` } : {}),
      merchantId: "synthetic-merchant", storeId: "synthetic-store", version: "V2",
      ...(state === "READY" ? {} : { channel: { key: "synthetic-channel", type: "TEST", pgProvider: "INICIS_V2" } }),
      ...(state === "PAID" || (contradictoryStatus && contradictoryStatus !== "READY") ? { method: { type: "PaymentMethodCard" } } : {}),
      status: contradictoryStatus ?? (state === "READY_REQUEST_AMOUNT" ? "READY" : state === "FAILED_WINDOW_CLOSE" ? "FAILED" : state),
      ...(state === "FAILED_WINDOW_CLOSE" ? { failedAt: "2026-09-30T00:00:01.000Z", failure: { pgCode: "01" } } : {}),
      ...(contradictoryStatus === "FAILED" ? { failedAt: "2026-09-30T00:00:01.000Z" } : {}),
      ...(contradictoryStatus === "CANCELLED" ? { cancelledAt: "2026-09-30T00:00:01.000Z" } : {}),
      amount: { total, paid, cancelled: 0 }, currency: "KRW",
      requestedAt: "2026-09-30T00:00:00.000Z", statusChangedAt: "2026-09-30T00:00:01.000Z",
      ...(state === "PAID" || state.endsWith("_PAID_AT") ? { paidAt: "2026-09-30T00:00:01.000Z" } : {}),
      cancellations: [],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  const ipId = `abandon-ip-${suffix}`;
  const gachaId = `abandon-gacha-${suffix}`;
  await pool.query("INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$3)", [ipId, ipId, `결제 포기 ${suffix}`]);
  await pool.query(
    "INSERT INTO catalog_products(id,sku,ip_id,category,name,price) VALUES($1,$2,$3,'gacha',$4,6000)",
    [gachaId, `AB-${suffix}`.toUpperCase(), ipId, `가챠 ${suffix}`],
  );
  await pool.query("INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,10,0)", [gachaId]);
  const gachaVersion = await pool.query<{ id: string }>(
    "INSERT INTO draw_probability_versions(product_id,version) VALUES($1,1) RETURNING id", [gachaId],
  );

  // A pending gacha order that spent points: reservation, points and stock
  // must all return when PortOne confirms no payment.
  const gachaOrder = async (userId: string, pointTotal: number) => {
    const order = await pool.query<{ id: string }>(
      "INSERT INTO orders(user_id,subtotal,point_total,total) VALUES($1,6000,$2,$3) RETURNING id",
      [userId, pointTotal, 6000 - pointTotal],
    );
    const orderId = order.rows[0]!.id;
    const line = await pool.query<{ id: string }>(
      `INSERT INTO order_lines(order_id,product_id,product_name_snapshot,category_snapshot,probability_version_id,unit_price,quantity,line_total)
       VALUES($1,$2,$3,'gacha',$4,6000,1,6000) RETURNING id`,
      [orderId, gachaId, `가챠 ${suffix}`, gachaVersion.rows[0]!.id],
    );
    await pool.query("UPDATE product_stock SET reserved=reserved+1 WHERE product_id=$1", [gachaId]);
    await pool.query(
      `INSERT INTO stock_reservations(order_id,order_line_id,product_id,quantity,expires_at)
       VALUES($1,$2,$3,1,clock_timestamp()+interval '15 minutes')`,
      [orderId, line.rows[0]!.id, gachaId],
    );
    if (pointTotal > 0) {
      await pool.query(
        `INSERT INTO point_accounts(user_id,balance) VALUES($1,0)
         ON CONFLICT (user_id) DO NOTHING`, [userId],
      );
      await pool.query(
        "INSERT INTO point_ledger_entries(user_id,entry_type,amount,reference_type,reference_id,reason) VALUES($1,'SPEND',$2,'ORDER',$3,'Order point reservation')",
        [userId, -pointTotal, orderId],
      );
    }
    const payment = await pool.query<{ id: string }>(
      "INSERT INTO payments(order_id,provider,amount,pg_attempt_started_at) VALUES($1,'PORTONE_V2_INICIS',$2,clock_timestamp()) RETURNING id",
      [orderId, 6000 - pointTotal],
    );
    return { orderId, paymentId: payment.rows[0]!.id };
  };
  const abandon = (paymentId: string, token: string, key: string | null, remoteAddress: string) => app.inject({
    method: "POST", url: `/v1/payments/${paymentId}/abandon`, remoteAddress,
    headers: { ...auth(token), ...(key ? { "idempotency-key": key } : {}) },
  });
  const orderState = async (orderId: string) => (await pool.query<{
    order_status: string; payment_status: string; reservation_status: string; reserved: number; point_refunds: string;
  }>(
    `SELECT o.status AS order_status,p.status AS payment_status,
       (SELECT string_agg(r.status,',') FROM stock_reservations r WHERE r.order_id=o.id) AS reservation_status,
       (SELECT s.reserved FROM product_stock s WHERE s.product_id=$2) AS reserved,
       (SELECT count(*)::text FROM point_ledger_entries l WHERE l.reference_id=o.id::text AND l.entry_type='REFUND') AS point_refunds
     FROM orders o JOIN payments p ON p.order_id=o.id WHERE o.id=$1`, [orderId, gachaId],
  )).rows[0]!;

  // 1) READY: released once; the replay makes no provider call; a new key
  //    reports the already-closed order without another release.
  const ready = await gachaOrder(owner.id, 1000);
  providerState.set(ready.paymentId, "READY");
  const missingKey = await abandon(ready.paymentId, owner.token, null, "198.51.100.1");
  assert.equal(missingKey.statusCode, 409, missingKey.body);
  const foreign = await abandon(ready.paymentId, stranger.token, `abandon-foreign-${randomUUID()}`, "198.51.100.1");
  assert.equal(foreign.statusCode, 404, foreign.body);
  assert.equal(lookups.get(ready.paymentId) ?? 0, 0);
  const key = `abandon-${randomUUID()}`;
  const released = await abandon(ready.paymentId, owner.token, key, "198.51.100.2");
  assert.equal(released.statusCode, 200, released.body);
  assert.equal(released.headers["cache-control"], "no-store");
  assert.deepEqual(released.json(), {
    accepted: true, paymentId: ready.paymentId, orderId: ready.orderId, outcome: "cancelled",
    providerStatus: "READY", localStatus: "CANCELLED", orderStatus: "CANCELLED",
  });
  assert.deepEqual(await orderState(ready.orderId), {
    order_status: "CANCELLED", payment_status: "CANCELLED", reservation_status: "RELEASED",
    reserved: 0, point_refunds: "1",
  });
  const points = await pool.query<{ balance: number }>("SELECT balance FROM point_accounts WHERE user_id=$1", [owner.id]);
  assert.equal(Number(points.rows[0]!.balance), 1000);
  const replay = await abandon(ready.paymentId, owner.token, key, "198.51.100.2");
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(replay.headers["x-idempotent-replay"], "true");
  assert.deepEqual(replay.json(), released.json());
  assert.equal(lookups.get(ready.paymentId), 1);
  const secondKey = await abandon(ready.paymentId, owner.token, `abandon-again-${randomUUID()}`, "198.51.100.2");
  assert.equal(secondKey.statusCode, 200, secondKey.body);
  assert.equal((secondKey.json() as { outcome: string }).outcome, "already_closed");
  assert.equal((await orderState(ready.orderId)).point_refunds, "1");
  const outbox = await pool.query<{ event_type: string }>(
    `SELECT event_type FROM outbox_events WHERE aggregate_id=ANY($1::text[]) ORDER BY event_type`,
    [[ready.orderId, ready.paymentId]],
  );
  assert.deepEqual(outbox.rows.map((row) => row.event_type), ["order.cancelled", "payment.window_abandoned"]);

  // Real KG window-only shape: requested amount is present, but no card,
  // approval time or PG transaction exists. Do not create financial entries.
  const projected = await gachaOrder(owner.id, 0);
  providerState.set(projected.paymentId, "READY_REQUEST_AMOUNT");
  const projectedRelease = await abandon(projected.paymentId, await ownerSession(), `abandon-projected-${randomUUID()}`, "198.51.100.2");
  assert.equal(projectedRelease.statusCode, 200, projectedRelease.body);
  assert.deepEqual(await orderState(projected.orderId), {
    order_status: "CANCELLED", payment_status: "CANCELLED", reservation_status: "RELEASED",
    reserved: 0, point_refunds: "0",
  });
  assert.equal((await pool.query("SELECT 1 FROM payment_ledger_entries WHERE order_id=$1", [projected.orderId])).rowCount, 0);
  assert.equal(cancellationRequests, 0);

  const closedWindow = await gachaOrder(owner.id, 0);
  providerState.set(closedWindow.paymentId, "FAILED_WINDOW_CLOSE");
  const closedKey = `abandon-closed-${randomUUID()}`;
  const closedToken = await ownerSession();
  const closedRelease = await abandon(closedWindow.paymentId, closedToken, closedKey, "198.51.100.2");
  assert.equal(closedRelease.statusCode, 200, closedRelease.body);
  assert.deepEqual(await orderState(closedWindow.orderId), {
    order_status: "CANCELLED", payment_status: "FAILED", reservation_status: "RELEASED",
    reserved: 0, point_refunds: "0",
  });
  assert.equal((await pool.query("SELECT 1 FROM payment_ledger_entries WHERE order_id=$1", [closedWindow.orderId])).rowCount, 0);
  const closedReplay = await abandon(closedWindow.paymentId, closedToken, closedKey, "198.51.100.2");
  assert.deepEqual(closedReplay.json(), closedRelease.json());
  assert.equal(lookups.get(closedWindow.paymentId), 1);
  assert.equal(cancellationRequests, 0);

  // Zero money with authenticated approval evidence is contradictory, not
  // proof of an unsubmitted window. Preserve reservations and point spend.
  // Keep these intentionally pending orders on a separate actor so they do
  // not consume the legitimate checkout actor's pending-order limit.
  const evidenceOwner = await actor("approval-evidence");
  for (const state of ["READY_PAID_AT", "READY_PG_TX", "FAILED_PAID_AT", "FAILED_PG_TX", "CANCELLED_PAID_AT", "CANCELLED_PG_TX"] as const) {
    const evidence = await gachaOrder(evidenceOwner.id, 1000);
    providerState.set(evidence.paymentId, state);
    const refused = await abandon(evidence.paymentId, await ownerSession(evidenceOwner.id), `abandon-${state}-${randomUUID()}`, "198.51.100.6");
    assert.equal(refused.statusCode, 409, `${state}: ${refused.body}`);
    assert.equal((refused.json() as { error: { code: string } }).error.code, "PAYMENT_EVIDENCE_PRESENT");
    assert.deepEqual(await orderState(evidence.orderId), {
      order_status: "PENDING_PAYMENT", payment_status: "PENDING", reservation_status: "ACTIVE",
      reserved: 1, point_refunds: "0",
    }, state);
    assert.equal((await pool.query("SELECT 1 FROM payment_ledger_entries WHERE order_id=$1", [evidence.orderId])).rowCount, 0);
    assert.equal((await pool.query("SELECT 1 FROM outbox_events WHERE aggregate_id=ANY($1::text[])", [[evidence.orderId, evidence.paymentId]])).rowCount, 0);
    assert.equal(lookups.get(evidence.paymentId), 1);
    assert.equal(cancellationRequests, 0);
    // Test-only fixture cleanup after assertions; not a successful abandon.
    await pool.query("UPDATE stock_reservations SET status='RELEASED' WHERE order_id=$1", [evidence.orderId]);
    await pool.query("UPDATE product_stock SET reserved=reserved-1 WHERE product_id=$1", [gachaId]);
  }

  // 2) Payment evidence: PAID and PAY_PENDING are 409 with no local change;
  //    a failed provider read is 502 with no local change.
  const evidenceToken = await ownerSession();
  for (const [state, remote] of [["PAID", "198.51.100.3"], ["PAY_PENDING", "198.51.100.3"], ["UNAVAILABLE", "198.51.100.3"]] as const) {
    const evidence = await gachaOrder(owner.id, 0);
    providerState.set(evidence.paymentId, state);
    const refused = await abandon(evidence.paymentId, evidenceToken, `abandon-${state}-${randomUUID()}`, remote);
    assert.equal(refused.statusCode, state === "UNAVAILABLE" ? 502 : 409, refused.body);
    if (state !== "UNAVAILABLE") {
      assert.equal((refused.json() as { error: { code: string } }).error.code, "PAYMENT_EVIDENCE_PRESENT");
    }
    const unchanged = await orderState(evidence.orderId);
    assert.equal(unchanged.order_status, "PENDING_PAYMENT", state);
    assert.equal(unchanged.payment_status, "PENDING", state);
    assert.equal(unchanged.reservation_status, "ACTIVE", state);
    const noKey = await pool.query(
      "SELECT 1 FROM idempotency_keys WHERE actor_id=$1 AND scope='ABANDON_PAYMENT_WINDOW' AND resource_id=$2",
      [owner.id, evidence.paymentId],
    );
    assert.equal(noKey.rowCount, 0);
    // Release the fixture reservation so later stock assertions stay exact.
    await pool.query("UPDATE stock_reservations SET status='RELEASED' WHERE order_id=$1", [evidence.orderId]);
    await pool.query("UPDATE product_stock SET reserved=reserved-1 WHERE product_id=$1", [gachaId]);
  }

  // 3) PAYMENT_NOT_FOUND: the window was never submitted to PortOne.
  const laterToken = await ownerSession();
  const notFound = await gachaOrder(owner.id, 0);
  providerState.set(notFound.paymentId, "NOT_FOUND");
  const notFoundRelease = await abandon(notFound.paymentId, laterToken, `abandon-missing-${randomUUID()}`, "198.51.100.4");
  assert.equal(notFoundRelease.statusCode, 200, notFoundRelease.body);
  assert.equal((notFoundRelease.json() as { providerStatus: string }).providerStatus, "PAYMENT_NOT_FOUND");
  assert.equal((await orderState(notFound.orderId)).order_status, "CANCELLED");
  assert.equal(cancellationRequests, 0);

  // 4) Kuji: the room entry is released and the FIFO waiter is promoted.
  const kujiId = `abandon-kuji-${suffix}`;
  const prizeId = `abandon-kuji-prize-${suffix}`;
  await pool.query(
    "INSERT INTO catalog_products(id,sku,ip_id,category,name,price,is_prize_only) VALUES($1,$2,$3,'figure',$4,0,true)",
    [prizeId, `AB-PRIZE-${suffix}`.toUpperCase(), ipId, `경품 ${suffix}`],
  );
  await pool.query(
    "INSERT INTO catalog_products(id,sku,ip_id,category,name,price,image_url) VALUES($1,$2,$3,'kuji',$4,1000,$5)",
    [kujiId, `AB-KUJI-${suffix}`.toUpperCase(), ipId, `쿠지 ${suffix}`, `https://cdn.example.test/${kujiId}.png`],
  );
  await pool.query("INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,2,0)", [kujiId]);
  const kujiVersion = await pool.query<{ id: string }>(
    "INSERT INTO draw_probability_versions(product_id,version) VALUES($1,1) RETURNING id", [kujiId],
  );
  const poolEntry = await pool.query<{ id: string }>(
    `INSERT INTO draw_pool_entries(
      probability_version_id,prize_product_id,prize_name_snapshot,prize_sku_snapshot,
      prize_ip_id_snapshot,prize_category_snapshot,rarity,weight,initial_quantity,remaining_quantity
    ) VALUES($1,$2,$3,$4,$5,'figure','A',1,2,2) RETURNING id`,
    [kujiVersion.rows[0]!.id, prizeId, `경품 ${suffix}`, `AB-PRIZE-${suffix}`.toUpperCase(), ipId],
  );
  await pool.query("INSERT INTO kuji_decks(probability_version_id,total_slots) VALUES($1,2)", [kujiVersion.rows[0]!.id]);
  await pool.query(
    "INSERT INTO kuji_deck_tiers(probability_version_id,pool_entry_id,tier_code,tier_rank) VALUES($1,$2,'A',0)",
    [kujiVersion.rows[0]!.id, poolEntry.rows[0]!.id],
  );
  await pool.query(
    `INSERT INTO kuji_slot_assignments(probability_version_id,slot_number,pool_entry_id)
     SELECT $1,slot_number,$2 FROM generate_series(1,2) AS slot_number`,
    [kujiVersion.rows[0]!.id, poolEntry.rows[0]!.id],
  );
  await pool.query(
    "UPDATE draw_probability_versions SET status='ACTIVE',published_by=$2,published_at=now() WHERE id=$1",
    [kujiVersion.rows[0]!.id, owner.id],
  );
  await pool.query("UPDATE catalog_products SET sale_status='ON_SALE' WHERE id=$1", [kujiId]);
  const room = await app.inject({ method: "POST", url: `/v1/kuji/rooms/${kujiId}/entries`, headers: auth(owner.token) });
  assert.ok([200, 201].includes(room.statusCode), room.body);
  const entryId = (room.json() as { viewer: { entryId: string } }).viewer.entryId;
  const waiting = await app.inject({ method: "POST", url: `/v1/kuji/rooms/${kujiId}/entries`, headers: auth(waiter.token) });
  assert.ok([200, 201].includes(waiting.statusCode), waiting.body);
  const waiterEntryId = (waiting.json() as { viewer: { entryId: string; state: string } }).viewer.entryId;
  assert.equal((waiting.json() as { viewer: { state: string } }).viewer.state, "WAITING");
  const ordered = await app.inject({
    method: "POST", url: "/v1/orders",
    headers: { ...auth(owner.token), "idempotency-key": randomUUID() },
    payload: { items: [{ productId: kujiId, quantity: 1, expectedDrawVersion: 1 }], pointAmount: 0, kujiRoomEntryId: entryId },
  });
  assert.equal(ordered.statusCode, 201, ordered.body);
  const kujiOrder = ordered.json() as { id: string; paymentId: string };
  const claim = await app.inject({ method: "POST", url: `/v1/payments/${kujiOrder.paymentId}/attempt`, headers: auth(owner.token) });
  assert.equal(claim.statusCode, 200, claim.body);
  providerState.set(kujiOrder.paymentId, "READY");
  const kujiRelease = await abandon(kujiOrder.paymentId, laterToken, `abandon-kuji-${randomUUID()}`, "198.51.100.5");
  assert.equal(kujiRelease.statusCode, 200, kujiRelease.body);
  assert.equal((kujiRelease.json() as { outcome: string }).outcome, "cancelled");
  const rooms = await pool.query<{ id: string; state: string }>(
    "SELECT id,state FROM kuji_room_entries WHERE id=ANY($1::uuid[])", [[entryId, waiterEntryId]],
  );
  const roomState = new Map(rooms.rows.map((row) => [row.id, row.state]));
  assert.equal(roomState.get(entryId), "CANCELLED");
  assert.equal(roomState.get(waiterEntryId), "CHECKOUT_PENDING");
  const kujiStock = await pool.query<{ reserved: number }>("SELECT reserved FROM product_stock WHERE product_id=$1", [kujiId]);
  assert.equal(Number(kujiStock.rows[0]!.reserved), 0);

  // 5) A paid order is never released, even if PortOne lags as READY.
  const lagging = await gachaOrder(owner.id, 0);
  await pool.query("UPDATE payments SET status='PAID',paid_at=now(),version=version+1 WHERE id=$1", [lagging.paymentId]);
  await pool.query("UPDATE orders SET status='PAID',paid_at=now(),version=version+1 WHERE id=$1", [lagging.orderId]);
  providerState.set(lagging.paymentId, "READY");
  const paidRefused = await abandon(lagging.paymentId, laterToken, `abandon-paid-${randomUUID()}`, "198.51.100.6");
  assert.equal(paidRefused.statusCode, 409, paidRefused.body);
  assert.equal((await orderState(lagging.orderId)).order_status, "PAID");
});

test("a foreign draw entitlement is not found before any order or room lock", {
  skip: !databaseUrl,
  timeout: 30_000,
}, async (t) => {
  const pool = createDatabasePool(databaseUrl!, "dabboba-foreign-consume-integration");
  const config: ApiConfig = {
    environment: "test", host: "127.0.0.1", port: 8788, databaseUrl: databaseUrl!, redisUrl: "redis://127.0.0.1:6379",
    webOrigins: ["http://127.0.0.1:4174"], adminOrigins: ["http://127.0.0.1:4180"],
    sessionTokenPepper: "foreign-consume-integration-pepper", adminProxyIdentitySecret: null,
    sessionTtlDays: 1, commerceMode: "LIVE", paymentProvider: "TEST_PG",
    paymentWebhookSecret: "foreign-consume-webhook-secret",
    gcsBucket: null, gcsProjectId: null, logLevel: "silent",
  };
  const { app } = await buildApp({ config, pool, redis: null });
  t.after(async () => { await app.close(); await pool.end(); });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const users: Array<{ id: string; token: string }> = [];
  for (const label of ["owner", "stranger"]) {
    const user = await pool.query<{ id: string }>(
      "INSERT INTO users(email,nickname,role,status) VALUES($1,$2,'USER','ACTIVE') RETURNING id",
      [`consume-${label}-${suffix}@example.test`, `Consume ${label}`],
    );
    await acceptRequiredPoliciesForIntegrationTest(pool, user.rows[0]!.id);
    const session = await issueSession(pool, config, {
      userId: user.rows[0]!.id, kind: "USER", ip: "203.0.113.96", userAgent: "Foreign consume integration test",
    });
    users.push({ id: user.rows[0]!.id, token: session.token });
  }
  const [owner, stranger] = users as [{ id: string; token: string }, { id: string; token: string }];
  const ipId = `consume-ip-${suffix}`;
  const productId = `consume-gacha-${suffix}`;
  await pool.query("INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$3)", [ipId, ipId, `소유 ${suffix}`]);
  await pool.query(
    "INSERT INTO catalog_products(id,sku,ip_id,category,name,price) VALUES($1,$2,$3,'gacha',$4,1000)",
    [productId, `CO-${suffix}`.toUpperCase(), ipId, `가챠 ${suffix}`],
  );
  const version = await pool.query<{ id: string }>(
    "INSERT INTO draw_probability_versions(product_id,version) VALUES($1,1) RETURNING id", [productId],
  );
  const prizeId = `consume-prize-${suffix}`;
  await pool.query(
    "INSERT INTO catalog_products(id,sku,ip_id,category,name,price,is_prize_only) VALUES($1,$2,$3,'figure',$4,0,true)",
    [prizeId, `CO-PRIZE-${suffix}`.toUpperCase(), ipId, `경품 ${suffix}`],
  );
  await pool.query(
    `INSERT INTO draw_pool_entries(probability_version_id,prize_product_id,prize_name_snapshot,
      prize_sku_snapshot,prize_ip_id_snapshot,prize_category_snapshot,rarity,weight,initial_quantity,remaining_quantity)
     VALUES($1,$2,$3,$4,$5,'figure','A',1,5,5)`,
    [version.rows[0]!.id, prizeId, `경품 ${suffix}`, `CO-PRIZE-${suffix}`.toUpperCase(), ipId],
  );
  const order = await pool.query<{ id: string }>(
    "INSERT INTO orders(user_id,status,subtotal,total,paid_at) VALUES($1,'PAID',1000,1000,now()) RETURNING id", [owner.id],
  );
  const line = await pool.query<{ id: string }>(
    `INSERT INTO order_lines(order_id,product_id,product_name_snapshot,category_snapshot,probability_version_id,unit_price,quantity,line_total)
     VALUES($1,$2,$3,'gacha',$4,1000,1,1000) RETURNING id`,
    [order.rows[0]!.id, productId, `가챠 ${suffix}`, version.rows[0]!.id],
  );
  const entitlement = await pool.query<{ id: string }>(
    "INSERT INTO draw_entitlements(order_line_id,user_id,product_id,probability_version_id) VALUES($1,$2,$3,$4) RETURNING id",
    [line.rows[0]!.id, owner.id, productId, version.rows[0]!.id],
  );
  const response = await app.inject({
    method: "POST", url: `/v1/draws/${entitlement.rows[0]!.id}/consume`,
    headers: { authorization: `Bearer ${stranger.token}`, "idempotency-key": `consume-foreign-${randomUUID()}` },
  });
  assert.equal(response.statusCode, 404, response.body);
  const unchanged = await pool.query<{ status: string }>("SELECT status FROM draw_entitlements WHERE id=$1", [entitlement.rows[0]!.id]);
  assert.equal(unchanged.rows[0]!.status, "AVAILABLE");
});
