import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import { buildApp } from "../app.js";
import { acceptRequiredPoliciesForIntegrationTest } from "../integration-test-fixtures.js";
import { issueSession } from "../plugins/auth.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;

test("verified PortOne kuji payment leads to sealed ticket results and owned inventory exactly once", {
  skip: !databaseUrl,
  timeout: 60_000,
}, async (t) => {
  const pool = createDatabasePool(databaseUrl!, "dabboba-portone-kuji-flow-integration");
  const config: ApiConfig = {
    environment: "test", host: "127.0.0.1", port: 8788, databaseUrl: databaseUrl!, redisUrl: "redis://127.0.0.1:6379",
    webOrigins: ["http://127.0.0.1:4174"], adminOrigins: ["http://127.0.0.1:4180"],
    sessionTokenPepper: "portone-kuji-flow-integration-pepper", adminProxyIdentitySecret: null,
    sessionTtlDays: 1, commerceMode: "LIVE", paymentProvider: "PORTONE_V2_INICIS",
    paymentWebhookSecret: "portone-kuji-flow-webhook-secret",
    portOne: {
      apiSecret: "synthetic-secret", merchantId: "synthetic-merchant", storeId: "synthetic-store",
      channelKey: "synthetic-channel", channelEnvironment: "TEST",
      webhookSecret: "portone-kuji-flow-webhook-secret",
    },
    gcsBucket: null, gcsProjectId: null, logLevel: "silent",
  };
  const { app } = await buildApp({ config, pool, redis: null });
  t.after(async () => { await app.close(); await pool.end(); });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const createActor = async (label: string) => {
    const user = await pool.query<{ id: string }>(
      "INSERT INTO users(email,nickname,role,status) VALUES($1,$2,'USER','ACTIVE') RETURNING id",
      [`portone-kuji-${label}-${suffix}@example.test`, `Kuji ${label}`],
    );
    const id = user.rows[0]!.id;
    await acceptRequiredPoliciesForIntegrationTest(pool, id);
    const session = await issueSession(pool, config, {
      userId: id, kind: "USER", ip: "203.0.113.91", userAgent: "PortOne kuji integration test",
    });
    return { id, token: session.token };
  };
  const customer = await createActor("customer");
  const stranger = await createActor("stranger");
  const secondDevice = await issueSession(pool, config, {
    userId: customer.id, kind: "USER", ip: "203.0.113.94", userAgent: "Second customer device",
  });
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const ipId = `portone-kuji-ip-${suffix}`;
  const productId = `portone-kuji-${suffix}`;
  const prizeId = `portone-kuji-prize-${suffix}`;
  await pool.query("INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$3)", [ipId, ipId, `쿠지 연동 ${suffix}`]);
  await pool.query(
    "INSERT INTO catalog_products(id,sku,ip_id,category,name,price,is_prize_only) VALUES($1,$2,$3,'figure',$4,0,true)",
    [prizeId, `PK-PRIZE-${suffix}`.toUpperCase(), ipId, `쿠지 경품 ${suffix}`],
  );
  await pool.query(
    "INSERT INTO catalog_products(id,sku,ip_id,category,name,price,image_url) VALUES($1,$2,$3,'kuji',$4,1000,$5)",
    [productId, `PK-${suffix}`.toUpperCase(), ipId, `쿠지 상품 ${suffix}`, `https://cdn.example.test/${productId}.png`],
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
    [versionId, prizeId, `쿠지 경품 ${suffix}`, `PK-PRIZE-${suffix}`.toUpperCase(), ipId],
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
    [versionId, customer.id],
  );
  await pool.query("UPDATE catalog_products SET sale_status='ON_SALE' WHERE id=$1", [productId]);

  const room = await app.inject({ method: "POST", url: `/v1/kuji/rooms/${productId}/entries`, headers: auth(customer.token) });
  assert.ok([200, 201].includes(room.statusCode), room.body);
  const entryId = (room.json() as { viewer: { entryId: string; state: string } }).viewer.entryId;
  assert.equal((room.json() as { viewer: { state: string } }).viewer.state, "CHECKOUT_PENDING");
  const ordered = await app.inject({
    method: "POST", url: "/v1/orders",
    headers: { ...auth(customer.token), "idempotency-key": randomUUID() },
    payload: { items: [{ productId, quantity: 2, expectedDrawVersion: 1 }], pointAmount: 0, kujiRoomEntryId: entryId },
  });
  assert.equal(ordered.statusCode, 201, ordered.body);
  const order = ordered.json() as { id: string; paymentId: string; status: string; total: number; drawEntitlementIds: string[]; kujiRoomEntryId: string | null };
  assert.equal(order.status, "PENDING_PAYMENT");
  assert.equal(order.kujiRoomEntryId, entryId);
  assert.equal(order.total, 2000);
  assert.deepEqual(order.drawEntitlementIds, []);
  const ownedOrder = await app.inject({ method: "GET", url: `/v1/orders/${order.id}`, headers: auth(customer.token) });
  assert.equal(ownedOrder.statusCode, 200, ownedOrder.body);
  assert.equal((ownedOrder.json() as { kujiRoomEntryId: string | null }).kujiRoomEntryId, entryId);
  const strangerAttempt = await app.inject({ method: "POST", url: `/v1/payments/${order.paymentId}/attempt`, headers: auth(stranger.token) });
  assert.equal(strangerAttempt.statusCode, 404, strangerAttempt.body);
  const attempts = await Promise.all([customer.token, secondDevice.token].map((token) => app.inject({
    method: "POST", url: `/v1/payments/${order.paymentId}/attempt`, headers: auth(token),
  })));
  assert.deepEqual(attempts.map((response) => response.statusCode).sort(), [200, 409]);
  const granted = attempts.find((response) => response.statusCode === 200)!;
  assert.equal((granted.json() as { paymentId: string; orderId: string }).paymentId, order.paymentId);
  assert.equal((granted.json() as { paymentId: string; orderId: string }).orderId, order.id);
  const claimedOrder = await app.inject({ method: "GET", url: `/v1/orders/${order.id}`, headers: auth(customer.token) });
  assert.equal(claimedOrder.statusCode, 200, claimedOrder.body);
  assert.match((claimedOrder.json() as { paymentAttemptStartedAt: string }).paymentAttemptStartedAt, /^\d{4}-\d\d-\d\dT/);
  const prePaymentSlot = await app.inject({
    method: "POST", url: `/v1/kuji/rooms/${productId}/entries/${entryId}/slots`,
    headers: { ...auth(customer.token), "idempotency-key": randomUUID() },
    payload: { probabilityVersion: 1, slotNumbers: [1, 2] },
  });
  assert.notEqual(prePaymentSlot.statusCode, 201, prePaymentSlot.body);
  const strangerConfirm = await app.inject({ method: "POST", url: `/v1/payments/${order.paymentId}/confirm`, headers: auth(stranger.token) });
  assert.equal(strangerConfirm.statusCode, 404, strangerConfirm.body);

  const providerTimestamp = (await pool.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now.toISOString();
  let providerLookups = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    providerLookups += 1;
    assert.equal(init?.method, "GET");
    assert.match(String(input), new RegExp(order.paymentId));
    return new Response(JSON.stringify({
      id: order.paymentId, transactionId: `portone-${suffix}`, pgTxId: `kg-${suffix}`,
      merchantId: "synthetic-merchant", storeId: "synthetic-store", version: "V2",
      channel: { key: "synthetic-channel", type: "TEST", pgProvider: "INICIS_V2" },
      method: { type: "PaymentMethodCard" }, status: "PAID",
      amount: { total: 2000, paid: 2000, cancelled: 0 }, currency: "KRW",
      requestedAt: providerTimestamp, statusChangedAt: providerTimestamp, paidAt: providerTimestamp, cancellations: [],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const confirmed = await app.inject({ method: "POST", url: `/v1/payments/${order.paymentId}/confirm`, headers: auth(customer.token) });
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  assert.equal((confirmed.json() as { providerStatus: string }).providerStatus, "PAID");
  const confirmedAgain = await app.inject({ method: "POST", url: `/v1/payments/${order.paymentId}/confirm`, headers: auth(customer.token) });
  assert.equal(confirmedAgain.statusCode, 200, confirmedAgain.body);
  assert.equal((confirmedAgain.json() as { outcome: string }).outcome, "duplicate");
  assert.equal(providerLookups, 2);

  const beforeDraw = await pool.query<{ payment_status: string; room_state: string; entitlement_count: string; ledger_count: string; on_hand: number; reserved: number }>(
    `SELECT p.status AS payment_status,r.state AS room_state,
      (SELECT count(*)::text FROM draw_entitlements e JOIN order_lines l ON l.id=e.order_line_id WHERE l.order_id=o.id) AS entitlement_count,
      (SELECT count(*)::text FROM payment_ledger_entries ledger WHERE ledger.payment_id=p.id AND ledger.entry_type='PAYMENT') AS ledger_count,
      s.on_hand,s.reserved
     FROM orders o JOIN payments p ON p.order_id=o.id JOIN kuji_room_entries r ON r.order_id=o.id
     JOIN product_stock s ON s.product_id=r.product_id WHERE o.id=$1`, [order.id],
  );
  assert.deepEqual(beforeDraw.rows[0], {
    payment_status: "PAID", room_state: "DRAWING", entitlement_count: "2", ledger_count: "1", on_hand: 0, reserved: 0,
  });
  const available = await app.inject({ method: "GET", url: "/v1/account/draw-entitlements?status=AVAILABLE", headers: auth(customer.token) });
  assert.equal(available.statusCode, 200, available.body);
  const entitlements = (available.json() as { items: Array<{ id: string; orderId: string; product: { id: string } }> }).items;
  assert.equal(entitlements.length, 2);
  assert.ok(entitlements.every((item) => item.orderId === order.id && item.product.id === productId));
  const selected = await app.inject({
    method: "POST", url: `/v1/kuji/rooms/${productId}/entries/${entryId}/slots`,
    headers: { ...auth(customer.token), "idempotency-key": randomUUID() },
    payload: { probabilityVersion: 1, slotNumbers: [1, 2] },
  });
  assert.equal(selected.statusCode, 201, selected.body);
  const resultIds: string[] = [];
  for (const entitlement of entitlements) {
    const drawKey = randomUUID();
    const drawPath = `/v1/draws/${entitlement.id}/consume`;
    const draw = await app.inject({ method: "POST", url: drawPath, headers: { ...auth(customer.token), "idempotency-key": drawKey } });
    assert.equal(draw.statusCode, 200, draw.body);
    const result = draw.json() as { id: string; prizeProductId: string; prizeInventoryUnitId: string; kujiSlotNumber: number };
    assert.equal(result.prizeProductId, prizeId);
    assert.ok([1, 2].includes(result.kujiSlotNumber));
    resultIds.push(result.prizeInventoryUnitId);
    const replay = await app.inject({ method: "POST", url: drawPath, headers: { ...auth(customer.token), "idempotency-key": drawKey } });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.deepEqual(replay.json(), result);
  }
  assert.equal(new Set(resultIds).size, 2);
  const inventory = await app.inject({ method: "GET", url: "/v1/account/inventory", headers: auth(customer.token) });
  assert.equal(inventory.statusCode, 200, inventory.body);
  const ownedIds = new Set((inventory.json() as { items: Array<{ id: string }> }).items.map((item) => item.id));
  assert.ok(resultIds.every((id) => ownedIds.has(id)));
  const afterDraw = await pool.query<{ room_state: string; consumed_count: string; result_count: string; consumed_slot_count: string }>(
    `SELECT r.state AS room_state,
      (SELECT count(*)::text FROM draw_entitlements e JOIN order_lines l ON l.id=e.order_line_id WHERE l.order_id=r.order_id AND e.status='CONSUMED') AS consumed_count,
      (SELECT count(*)::text FROM draw_results result JOIN draw_entitlements e ON e.id=result.entitlement_id JOIN order_lines l ON l.id=e.order_line_id WHERE l.order_id=r.order_id) AS result_count,
      (SELECT count(*)::text FROM kuji_slot_bindings binding WHERE binding.room_entry_id=r.id AND binding.state='CONSUMED') AS consumed_slot_count
     FROM kuji_room_entries r WHERE r.id=$1`, [entryId],
  );
  assert.deepEqual(afterDraw.rows[0], { room_state: "COMPLETED", consumed_count: "2", result_count: "2", consumed_slot_count: "2" });
});

test("PortOne payment outside a kuji checkout lease releases the room and requires a verified full refund", {
  skip: !databaseUrl,
  timeout: 60_000,
}, async (t) => {
  const pool = createDatabasePool(databaseUrl!, "dabboba-portone-kuji-late-payment-integration");
  const config: ApiConfig = {
    environment: "test", host: "127.0.0.1", port: 8788, databaseUrl: databaseUrl!, redisUrl: "redis://127.0.0.1:6379",
    webOrigins: ["http://127.0.0.1:4174"], adminOrigins: ["http://127.0.0.1:4180"],
    sessionTokenPepper: "portone-kuji-late-payment-pepper", adminProxyIdentitySecret: null,
    sessionTtlDays: 1, commerceMode: "LIVE", paymentProvider: "PORTONE_V2_INICIS",
    paymentWebhookSecret: "portone-kuji-late-payment-webhook-secret",
    portOne: {
      apiSecret: "synthetic-secret", merchantId: "synthetic-merchant", storeId: "synthetic-store",
      channelKey: "synthetic-channel", channelEnvironment: "TEST",
      webhookSecret: "portone-kuji-late-payment-webhook-secret",
    },
    gcsBucket: null, gcsProjectId: null, logLevel: "silent",
  };
  const { app } = await buildApp({ config, pool, redis: null });
  t.after(async () => { await app.close(); await pool.end(); });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const actor = async (role: "USER" | "SUPER_ADMIN", label: string) => {
    const created = await pool.query<{ id: string }>(
      "INSERT INTO users(email,nickname,role,status) VALUES($1,$2,$3,'ACTIVE') RETURNING id",
      [`late-kuji-${label}-${suffix}@example.test`, `Late ${label}`, role],
    );
    const id = created.rows[0]!.id;
    if (role === "USER") await acceptRequiredPoliciesForIntegrationTest(pool, id);
    const session = await issueSession(pool, config, {
      userId: id, kind: role === "USER" ? "USER" : "ADMIN",
      ip: "203.0.113.92", userAgent: "Late PortOne kuji integration test",
    });
    return { id, token: session.token };
  };
  const customer = await actor("USER", "customer");
  const waiter = await actor("USER", "waiter");
  const supervisor = await actor("SUPER_ADMIN", "supervisor");
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const ipId = `late-kuji-ip-${suffix}`;
  const productId = `late-kuji-${suffix}`;
  const prizeId = `late-kuji-prize-${suffix}`;
  await pool.query("INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$3)", [ipId, ipId, `지연 결제 ${suffix}`]);
  await pool.query(
    "INSERT INTO catalog_products(id,sku,ip_id,category,name,price,is_prize_only) VALUES($1,$2,$3,'figure',$4,0,true)",
    [prizeId, `LKP-${suffix}`.toUpperCase(), ipId, `지연 쿠지 경품 ${suffix}`],
  );
  await pool.query(
    "INSERT INTO catalog_products(id,sku,ip_id,category,name,price,image_url) VALUES($1,$2,$3,'kuji',$4,1000,$5)",
    [productId, `LK-${suffix}`.toUpperCase(), ipId, `지연 쿠지 상품 ${suffix}`, `https://cdn.example.test/${productId}.png`],
  );
  await pool.query("INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,1,0)", [productId]);
  const version = await pool.query<{ id: string }>(
    "INSERT INTO draw_probability_versions(product_id,version) VALUES($1,1) RETURNING id", [productId],
  );
  const versionId = version.rows[0]!.id;
  const entry = await pool.query<{ id: string }>(
    `INSERT INTO draw_pool_entries(
      probability_version_id,prize_product_id,prize_name_snapshot,prize_sku_snapshot,
      prize_ip_id_snapshot,prize_category_snapshot,rarity,weight,initial_quantity,remaining_quantity
    ) VALUES($1,$2,$3,$4,$5,'figure','A',1,1,1) RETURNING id`,
    [versionId, prizeId, `지연 쿠지 경품 ${suffix}`, `LKP-${suffix}`.toUpperCase(), ipId],
  );
  await pool.query("INSERT INTO kuji_decks(probability_version_id,total_slots) VALUES($1,1)", [versionId]);
  await pool.query(
    "INSERT INTO kuji_deck_tiers(probability_version_id,pool_entry_id,tier_code,tier_rank) VALUES($1,$2,'A',0)",
    [versionId, entry.rows[0]!.id],
  );
  await pool.query(
    "INSERT INTO kuji_slot_assignments(probability_version_id,slot_number,pool_entry_id) VALUES($1,1,$2)",
    [versionId, entry.rows[0]!.id],
  );
  await pool.query(
    "UPDATE draw_probability_versions SET status='ACTIVE',published_by=$2,published_at=now() WHERE id=$1",
    [versionId, supervisor.id],
  );
  await pool.query("UPDATE catalog_products SET sale_status='ON_SALE' WHERE id=$1", [productId]);
  const joined = await app.inject({ method: "POST", url: `/v1/kuji/rooms/${productId}/entries`, headers: auth(customer.token) });
  assert.ok([200, 201].includes(joined.statusCode), joined.body);
  const room = joined.json() as { viewer: { entryId: string; checkoutExpiresAt: string } };
  const waiting = await app.inject({ method: "POST", url: `/v1/kuji/rooms/${productId}/entries`, headers: auth(waiter.token) });
  assert.ok([200, 201].includes(waiting.statusCode), waiting.body);
  const waitingEntry = (waiting.json() as { viewer: { entryId: string; state: string } }).viewer;
  assert.equal(waitingEntry.state, "WAITING");
  const ordered = await app.inject({
    method: "POST", url: "/v1/orders",
    headers: { ...auth(customer.token), "idempotency-key": randomUUID() },
    payload: { items: [{ productId, quantity: 1, expectedDrawVersion: 1 }], pointAmount: 0, kujiRoomEntryId: room.viewer.entryId },
  });
  assert.equal(ordered.statusCode, 201, ordered.body);
  const order = ordered.json() as { id: string; paymentId: string; status: string };
  assert.equal(order.status, "PENDING_PAYMENT");
  const paidAfterExpiry = new Date(new Date(room.viewer.checkoutExpiresAt).getTime() + 1_000).toISOString();
  const requestedAt = (await pool.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now.toISOString();
  let providerCancelled = false;
  let cancelCalls = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    assert.match(String(input), new RegExp(order.paymentId));
    if (init?.method === "POST") {
      cancelCalls += 1;
      const cancellation = JSON.parse(String(init.body)) as { amount: number; currentCancellableAmount: number };
      assert.equal(cancellation.amount, 1000);
      assert.equal(cancellation.currentCancellableAmount, 1000);
      providerCancelled = true;
      return new Response(JSON.stringify({ cancellation: {
        status: "SUCCEEDED", id: `late-cancel-${suffix}`, totalAmount: 1000,
        taxFreeAmount: 0, vatAmount: 91, reason: "쿠지 결제 대기 시간 초과",
        requestedAt: paidAfterExpiry, cancelledAt: new Date(new Date(paidAfterExpiry).getTime() + 1_000).toISOString(),
      } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    assert.equal(init?.method, "GET");
    return new Response(JSON.stringify({
      id: order.paymentId, transactionId: `portone-${suffix}`, pgTxId: `kg-${suffix}`,
      merchantId: "synthetic-merchant", storeId: "synthetic-store", version: "V2",
      channel: { key: "synthetic-channel", type: "TEST", pgProvider: "INICIS_V2" },
      method: { type: "PaymentMethodCard" }, status: providerCancelled ? "CANCELLED" : "PAID",
      amount: { total: 1000, paid: 1000, cancelled: providerCancelled ? 1000 : 0 }, currency: "KRW",
      requestedAt, statusChangedAt: providerCancelled
        ? new Date(new Date(paidAfterExpiry).getTime() + 1_000).toISOString() : paidAfterExpiry,
      paidAt: paidAfterExpiry,
      ...(providerCancelled ? { cancelledAt: new Date(new Date(paidAfterExpiry).getTime() + 1_000).toISOString() } : {}),
      cancellations: [],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const confirmed = await app.inject({ method: "POST", url: `/v1/payments/${order.paymentId}/confirm`, headers: auth(customer.token) });
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  assert.equal((confirmed.json() as { outcome: string }).outcome, "review");
  const review = await pool.query<{
    order_status: string; payment_status: string; room_state: string; waiter_state: string;
    reservation_status: string; on_hand: number; reserved: number; entitlement_count: string; paid_ledger_count: string;
  }>(
    `SELECT o.status AS order_status,p.status AS payment_status,r.state AS room_state,w.state AS waiter_state,
      reservation.status AS reservation_status,stock.on_hand,stock.reserved,
      (SELECT count(*)::text FROM draw_entitlements e JOIN order_lines l ON l.id=e.order_line_id WHERE l.order_id=o.id) AS entitlement_count,
      (SELECT count(*)::text FROM payment_ledger_entries ledger WHERE ledger.payment_id=p.id AND ledger.entry_type='PAYMENT') AS paid_ledger_count
     FROM orders o JOIN payments p ON p.order_id=o.id JOIN kuji_room_entries r ON r.order_id=o.id
     JOIN kuji_room_entries w ON w.id=$2 JOIN stock_reservations reservation ON reservation.order_id=o.id
     JOIN product_stock stock ON stock.product_id=r.product_id WHERE o.id=$1`,
    [order.id, waitingEntry.entryId],
  );
  assert.deepEqual(review.rows[0], {
    order_status: "REFUND_REVIEW", payment_status: "REFUND_REVIEW", room_state: "EXPIRED", waiter_state: "CHECKOUT_PENDING",
    reservation_status: "RELEASED", on_hand: 1, reserved: 0, entitlement_count: "0", paid_ledger_count: "1",
  });
  const reason = "쿠지 결제 대기 시간 초과";
  const refunded = await app.inject({
    method: "POST", url: `/v1/admin/commerce/refund-reviews/${order.paymentId}/cancel`,
    headers: { ...auth(supervisor.token), "x-admin-reason": reason, "idempotency-key": randomUUID() },
    payload: { reason },
  });
  assert.equal(refunded.statusCode, 202, refunded.body);
  assert.equal((refunded.json() as { status: string }).status, "RECONCILED");
  assert.equal(cancelCalls, 1);
  const finalState = await pool.query<{
    order_status: string; payment_status: string; payment_count: string; refund_count: string; entitlement_count: string;
  }>(
    `SELECT o.status AS order_status,p.status AS payment_status,
      (SELECT count(*)::text FROM payment_ledger_entries l WHERE l.payment_id=p.id AND l.entry_type='PAYMENT') AS payment_count,
      (SELECT count(*)::text FROM payment_ledger_entries l WHERE l.payment_id=p.id AND l.entry_type='REFUND') AS refund_count,
      (SELECT count(*)::text FROM draw_entitlements e JOIN order_lines line ON line.id=e.order_line_id WHERE line.order_id=o.id) AS entitlement_count
     FROM orders o JOIN payments p ON p.order_id=o.id WHERE o.id=$1`, [order.id],
  );
  assert.deepEqual(finalState.rows[0], {
    order_status: "REFUNDED", payment_status: "REFUNDED", payment_count: "1", refund_count: "1", entitlement_count: "0",
  });
});
