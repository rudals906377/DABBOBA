import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import {
  bumpKujiRoomVersion,
  createDatabasePool,
  lockExistingKujiRoom,
  lockKujiRoomAdvisories,
  withTransaction,
} from "@dabboba/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { acceptRequiredPoliciesForIntegrationTest } from "../integration-test-fixtures.js";
import { expireAndPromoteKujiRoomLocked } from "./kuji-rooms.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;
const provider = "TEST_PG";
const webhookSecret = "kuji-commerce-integration-webhook-secret";

type Session = { token: string; actor: { userId: string } };
type RoomSnapshot = {
  serverNow: string;
  viewer: { entryId: string; state: string; checkoutExpiresAt: string | null };
};
type OrderResponse = {
  id: string;
  paymentId: string;
  status: string;
  total: number;
  drawEntitlementIds: string[];
};

async function sendWebhook(
  app: FastifyInstance,
  input: {
    eventType: "PAYMENT_SUCCEEDED" | "PAYMENT_FAILED" | "PAYMENT_CANCELLED" | "REFUND_SUCCEEDED";
    paymentId: string;
    amount: number;
    occurredAt?: string;
  },
) {
  const payload = JSON.stringify({
    eventId: `kuji-event-${randomUUID()}`,
    eventType: input.eventType,
    paymentId: input.paymentId,
    providerPaymentId: `provider-${input.paymentId}`,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    amount: input.amount,
  });
  const signature = createHmac("sha256", webhookSecret).update(payload).digest("hex");
  return app.inject({
    method: "POST",
    url: `/v1/payments/webhooks/${provider}`,
    headers: { "content-type": "application/json", "x-dabboba-signature": signature },
    payload,
  });
}

test(
  "kuji checkout binds payment, room occupancy, expiry release, drawing, and FIFO completion",
  { skip: !databaseUrl, timeout: 60_000 },
  async (t) => {
    const pool = createDatabasePool(databaseUrl!, "dabboba-kuji-commerce-integration");
    const config: ApiConfig = {
      environment: "test",
      host: "127.0.0.1",
      port: 8788,
      databaseUrl: databaseUrl!,
      redisUrl: "redis://127.0.0.1:6379",
      webOrigins: ["http://127.0.0.1:4174"],
      adminOrigins: ["http://127.0.0.1:4180"],
      sessionTokenPepper: "kuji-commerce-integration-session-pepper",
      adminProxyIdentitySecret: null,
      sessionTtlDays: 1,
      paymentProvider: provider,
      paymentWebhookSecret: webhookSecret,
      gcsBucket: null,
      gcsProjectId: null,
      logLevel: "silent",
    };
    const { app } = await buildApp({ config, pool, redis: null });
    t.after(async () => {
      await app.close();
      await pool.end();
    });

    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const ipId = `kuji-commerce-${suffix}`;
    let sequence = 0;
    await pool.query(
      "INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$4)",
      [ipId, ipId, `쿠지 결제 ${suffix}`, `Kuji commerce ${suffix}`],
    );

    const createSession = async (label: string): Promise<Session> => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/auth/dev-session",
        payload: { email: `${label}-${suffix}-${sequence++}@example.test` },
      });
      assert.equal(response.statusCode, 201, response.body);
      const created = response.json() as Session;
      await acceptRequiredPoliciesForIntegrationTest(pool, created.actor.userId);
      return created;
    };
    const auth = (session: Session) => ({ authorization: `Bearer ${session.token}` });
    const publisher = await createSession("publisher");
    const prizeProductId = `kuji-prize-${suffix}`;
    await pool.query(
      `INSERT INTO catalog_products(id,sku,ip_id,category,name,price,is_prize_only)
       VALUES($1,$2,$3,'figure',$4,0,true)`,
      [prizeProductId, `KUJI-PRIZE-${suffix.toUpperCase()}`, ipId, `쿠지 경품 ${suffix}`],
    );

    const createKuji = async (label: string, price = 1_000, onHand = 5) => {
      const productId = `${label}-${suffix}-${sequence++}`.toLowerCase();
      await pool.query(
        `INSERT INTO catalog_products(id,sku,ip_id,category,name,price,image_url,is_prize_only)
         VALUES($1,$2,$3,'kuji',$4,$5,$6,false)`,
        [
          productId,
          `${label}-${suffix}-${sequence}`.toUpperCase(),
          ipId,
          `${label} ${suffix}`,
          price,
          `https://cdn.example.test/products/${productId}.png`,
        ],
      );
      await pool.query("INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,$2,0)", [productId, onHand]);
      const version = await pool.query<{ id: string }>(
        "INSERT INTO draw_probability_versions(product_id,version) VALUES($1,1) RETURNING id",
        [productId],
      );
      const poolEntry = await pool.query<{ id: string }>(
        `INSERT INTO draw_pool_entries(
           probability_version_id,prize_product_id,prize_name_snapshot,prize_image_url_snapshot,
           prize_sku_snapshot,prize_ip_id_snapshot,prize_category_snapshot,rarity,weight,
           initial_quantity,remaining_quantity
         ) SELECT $1,p.id,p.name,p.image_url,p.sku,p.ip_id,p.category,'A',1,$3,$3
             FROM catalog_products p WHERE p.id=$2
           RETURNING id`,
        [version.rows[0]!.id, prizeProductId, onHand],
      );
      await pool.query(
        "INSERT INTO kuji_decks(probability_version_id,total_slots) VALUES($1,$2)",
        [version.rows[0]!.id, onHand],
      );
      await pool.query(
        "INSERT INTO kuji_deck_tiers(probability_version_id,pool_entry_id,tier_code,tier_rank) VALUES($1,$2,'A',0)",
        [version.rows[0]!.id, poolEntry.rows[0]!.id],
      );
      await pool.query(
        `INSERT INTO kuji_slot_assignments(probability_version_id,slot_number,pool_entry_id)
         SELECT $1,slot_number,$2 FROM generate_series(1,$3) AS slot_number`,
        [version.rows[0]!.id, poolEntry.rows[0]!.id, onHand],
      );
      await pool.query(
        "UPDATE draw_probability_versions SET status='ACTIVE',published_by=$2,published_at=now() WHERE id=$1",
        [version.rows[0]!.id, publisher.actor.userId],
      );
      await pool.query(
        "UPDATE catalog_products SET sale_status='ON_SALE' WHERE id=$1",
        [productId],
      );
      return productId;
    };
    const join = async (session: Session, productId: string): Promise<RoomSnapshot> => {
      const response = await app.inject({
        method: "POST",
        url: `/v1/kuji/rooms/${productId}/entries`,
        headers: auth(session),
      });
      assert.ok([200, 201].includes(response.statusCode), response.body);
      return response.json() as RoomSnapshot;
    };
    const createOrder = async (input: {
      session: Session;
      productId: string;
      entryId: string;
      quantity?: number;
      pointAmount?: number;
      couponCode?: string;
    }): Promise<OrderResponse> => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { ...auth(input.session), "idempotency-key": `kuji-order-${randomUUID()}` },
        payload: {
          items: [{
            productId: input.productId,
            quantity: input.quantity ?? 1,
            expectedDrawVersion: 1,
          }],
          pointAmount: input.pointAmount ?? 0,
          ...(input.couponCode ? { couponCode: input.couponCode } : {}),
          kujiRoomEntryId: input.entryId,
        },
      });
      assert.equal(response.statusCode, 201, response.body);
      return response.json() as OrderResponse;
    };
    const bindSlots = async (input: {
      session: Session;
      productId: string;
      entryId: string;
      slotNumbers: number[];
    }) => {
      const response = await app.inject({
        method: "POST",
        url: `/v1/kuji/rooms/${input.productId}/entries/${input.entryId}/slots`,
        headers: { ...auth(input.session), "idempotency-key": `kuji-slots-${randomUUID()}` },
        payload: { probabilityVersion: 1, slotNumbers: input.slotNumbers },
      });
      assert.equal(response.statusCode, 201, response.body);
    };
    const readDeckSnapshotVersion = async (productId: string): Promise<number> => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/catalog/products/${productId}/kuji-slots`,
      });
      assert.equal(response.statusCode, 200, response.body);
      return (response.json() as { snapshotVersion: number }).snapshotVersion;
    };
    const expireRoomAt = async (input: {
      session: Session;
      productId: string;
      serverNow: Date;
    }) => withTransaction(pool, async (client) => {
      await lockKujiRoomAdvisories(client, {
        userId: input.session.actor.userId,
        productId: input.productId,
      });
      assert.equal(await lockExistingKujiRoom(client, input.productId), true);
      const settled = await expireAndPromoteKujiRoomLocked(client, {
        productId: input.productId,
        serverNow: input.serverNow,
        requestId: `kuji-expiry-${randomUUID()}`,
      });
      if (settled.changed) await bumpKujiRoomVersion(client, input.productId);
      return settled;
    });

    const zeroProduct = await createKuji("zero-kuji");
    const zeroUser = await createSession("zero-user");
    const zeroWaiter = await createSession("zero-waiter");
    await pool.query("INSERT INTO point_accounts(user_id,balance) VALUES($1,2000)", [zeroUser.actor.userId]);
    await pool.query(
      `INSERT INTO point_ledger_entries(user_id,entry_type,amount,reference_type,reference_id,reason)
       VALUES($1,'EARN',2000,'TEST',$2,'Kuji integration setup')`,
      [zeroUser.actor.userId, `zero-${suffix}`],
    );
    const zeroRoom = await join(zeroUser, zeroProduct);
    const waitingRoom = await join(zeroWaiter, zeroProduct);
    assert.equal(waitingRoom.viewer.state, "WAITING");
    const zeroOrder = await createOrder({
      session: zeroUser,
      productId: zeroProduct,
      entryId: zeroRoom.viewer.entryId,
      quantity: 2,
      pointAmount: 2_000,
    });
    assert.equal(zeroOrder.status, "PAID");
    assert.equal(zeroOrder.drawEntitlementIds.length, 2);
    await bindSlots({
      session: zeroUser,
      productId: zeroProduct,
      entryId: zeroRoom.viewer.entryId,
      slotNumbers: [1, 2],
    });
    const zeroDrawing = await pool.query<{
      state: string;
      order_id: string;
      drawing_started_at: Date;
      drawing_expires_at: Date;
    }>("SELECT state,order_id,drawing_started_at,drawing_expires_at FROM kuji_room_entries WHERE id=$1", [zeroRoom.viewer.entryId]);
    assert.equal(zeroDrawing.rows[0]!.state, "DRAWING");
    assert.equal(zeroDrawing.rows[0]!.order_id, zeroOrder.id);
    assert.equal(
      zeroDrawing.rows[0]!.drawing_expires_at.getTime() - zeroDrawing.rows[0]!.drawing_started_at.getTime(),
      300_000,
    );
    let zeroDeckSnapshotVersion = await readDeckSnapshotVersion(zeroProduct);
    for (const [index, entitlementId] of zeroOrder.drawEntitlementIds.entries()) {
      const consumed = await app.inject({
        method: "POST",
        url: `/v1/draws/${entitlementId}/consume`,
        headers: { ...auth(zeroUser), "idempotency-key": `kuji-consume-${randomUUID()}` },
      });
      assert.equal(consumed.statusCode, 200, consumed.body);
      const state = await pool.query<{ state: string }>("SELECT state FROM kuji_room_entries WHERE id=$1", [zeroRoom.viewer.entryId]);
      assert.equal(state.rows[0]!.state, index === 0 ? "DRAWING" : "COMPLETED");
      const nextSnapshotVersion = await readDeckSnapshotVersion(zeroProduct);
      assert.equal(nextSnapshotVersion, zeroDeckSnapshotVersion + 1);
      zeroDeckSnapshotVersion = nextSnapshotVersion;
    }
    const promotedWaiter = await pool.query<{ state: string; checkout_started_at: Date; checkout_expires_at: Date }>(
      "SELECT state,checkout_started_at,checkout_expires_at FROM kuji_room_entries WHERE id=$1",
      [waitingRoom.viewer.entryId],
    );
    assert.equal(promotedWaiter.rows[0]!.state, "CHECKOUT_PENDING");
    assert.equal(
      promotedWaiter.rows[0]!.checkout_expires_at.getTime() - promotedWaiter.rows[0]!.checkout_started_at.getTime(),
      180_000,
    );

    const deleteProduct = await createKuji("delete-kuji");
    const deleteUser = await createSession("delete-user");
    const deleteWaiter = await createSession("delete-waiter");
    await pool.query("INSERT INTO point_accounts(user_id,balance) VALUES($1,100)", [deleteUser.actor.userId]);
    await pool.query(
      `INSERT INTO point_ledger_entries(user_id,entry_type,amount,reference_type,reference_id,reason)
       VALUES($1,'EARN',100,'TEST',$2,'Kuji cancel integration setup')`,
      [deleteUser.actor.userId, `delete-${suffix}`],
    );
    const couponCode = `KUJI-${suffix}`;
    await pool.query(
      `INSERT INTO coupons(code,discount_type,discount_value,starts_at,ends_at,usage_limit)
       VALUES($1,'FIXED',100,now()-interval '1 day',now()+interval '1 day',10)`,
      [couponCode],
    );
    const deleteRoom = await join(deleteUser, deleteProduct);
    const deleteWaitingRoom = await join(deleteWaiter, deleteProduct);
    const deleteOrder = await createOrder({
      session: deleteUser,
      productId: deleteProduct,
      entryId: deleteRoom.viewer.entryId,
      pointAmount: 100,
      couponCode,
    });
    const reservation = await pool.query<{ reservation_expiry: Date; checkout_expiry: Date }>(
      `SELECT r.expires_at AS reservation_expiry,e.checkout_expires_at AS checkout_expiry
         FROM stock_reservations r
         JOIN kuji_room_entries e ON e.order_id=r.order_id
        WHERE r.order_id=$1`,
      [deleteOrder.id],
    );
    assert.equal(reservation.rows[0]!.reservation_expiry.getTime(), reservation.rows[0]!.checkout_expiry.getTime());
    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/kuji/rooms/${deleteProduct}/entries/${deleteRoom.viewer.entryId}`,
      headers: auth(deleteUser),
    });
    assert.equal(deleted.statusCode, 200, deleted.body);
    const cancelled = await pool.query<{
      order_status: string;
      payment_status: string;
      reservation_status: string;
      reserved: number;
      points: number;
      coupon_used: number;
      redemption_status: string;
      room_state: string;
      waiter_state: string;
    }>(
      `SELECT o.status AS order_status,p.status AS payment_status,r.status AS reservation_status,
              s.reserved,a.balance AS points,c.used_count AS coupon_used,
              cr.status AS redemption_status,e.state AS room_state,w.state AS waiter_state
         FROM orders o
         JOIN payments p ON p.order_id=o.id
         JOIN stock_reservations r ON r.order_id=o.id
         JOIN product_stock s ON s.product_id=r.product_id
         JOIN point_accounts a ON a.user_id=o.user_id
         JOIN coupon_redemptions cr ON cr.order_id=o.id
         JOIN coupons c ON c.id=cr.coupon_id
         JOIN kuji_room_entries e ON e.order_id=o.id
         JOIN kuji_room_entries w ON w.id=$2
        WHERE o.id=$1`,
      [deleteOrder.id, deleteWaitingRoom.viewer.entryId],
    );
    assert.deepEqual(cancelled.rows[0], {
      order_status: "CANCELLED",
      payment_status: "CANCELLED",
      reservation_status: "RELEASED",
      reserved: 0,
      points: 100,
      coupon_used: 0,
      redemption_status: "RELEASED",
      room_state: "CANCELLED",
      waiter_state: "CHECKOUT_PENDING",
    });

    const expiryProduct = await createKuji("expiry-kuji");
    const expiryUser = await createSession("expiry-user");
    const expiryWaiter = await createSession("expiry-waiter");
    await pool.query("INSERT INTO point_accounts(user_id,balance) VALUES($1,100)", [expiryUser.actor.userId]);
    await pool.query(
      `INSERT INTO point_ledger_entries(user_id,entry_type,amount,reference_type,reference_id,reason)
       VALUES($1,'EARN',100,'TEST',$2,'Kuji expiry integration setup')`,
      [expiryUser.actor.userId, `expiry-${suffix}`],
    );
    const expiryCouponCode = `KUJI-EXPIRY-${suffix}`;
    await pool.query(
      `INSERT INTO coupons(code,discount_type,discount_value,starts_at,ends_at,usage_limit)
       VALUES($1,'FIXED',100,now()-interval '1 day',now()+interval '1 day',10)`,
      [expiryCouponCode],
    );
    const expiryRoom = await join(expiryUser, expiryProduct);
    const expiryWaitingRoom = await join(expiryWaiter, expiryProduct);
    const expiryOrder = await createOrder({
      session: expiryUser,
      productId: expiryProduct,
      entryId: expiryRoom.viewer.entryId,
      pointAmount: 100,
      couponCode: expiryCouponCode,
    });
    const checkoutExpiry = new Date(expiryRoom.viewer.checkoutExpiresAt!);
    const expiredCheckout = await expireRoomAt({
      session: expiryUser,
      productId: expiryProduct,
      serverNow: new Date(checkoutExpiry.getTime() + 1),
    });
    assert.equal(expiredCheckout.changed, true);
    assert.equal(expiredCheckout.promotedEntryId, expiryWaitingRoom.viewer.entryId);
    const expiredCheckoutState = await pool.query<{
      order_status: string;
      payment_status: string;
      reservation_status: string;
      reserved: number;
      points: number;
      coupon_used: number;
      redemption_status: string;
      room_state: string;
      waiter_state: string;
      cancelled_at: Date | null;
    }>(
      `SELECT o.status AS order_status,p.status AS payment_status,r.status AS reservation_status,
              s.reserved,a.balance AS points,c.used_count AS coupon_used,
              cr.status AS redemption_status,e.state AS room_state,w.state AS waiter_state,
              o.cancelled_at
         FROM orders o
         JOIN payments p ON p.order_id=o.id
         JOIN stock_reservations r ON r.order_id=o.id
         JOIN product_stock s ON s.product_id=r.product_id
         JOIN point_accounts a ON a.user_id=o.user_id
         JOIN coupon_redemptions cr ON cr.order_id=o.id
         JOIN coupons c ON c.id=cr.coupon_id
         JOIN kuji_room_entries e ON e.order_id=o.id
         JOIN kuji_room_entries w ON w.id=$2
        WHERE o.id=$1`,
      [expiryOrder.id, expiryWaitingRoom.viewer.entryId],
    );
    assert.deepEqual(
      { ...expiredCheckoutState.rows[0], cancelled_at: Boolean(expiredCheckoutState.rows[0]!.cancelled_at) },
      {
        order_status: "CANCELLED",
        payment_status: "CANCELLED",
        reservation_status: "RELEASED",
        reserved: 0,
        points: 100,
        coupon_used: 0,
        redemption_status: "RELEASED",
        room_state: "EXPIRED",
        waiter_state: "CHECKOUT_PENDING",
        cancelled_at: true,
      },
    );

    const successProduct = await createKuji("success-kuji");
    const successUser = await createSession("success-user");
    const successWaiter = await createSession("success-waiter");
    const successRoom = await join(successUser, successProduct);
    const successWaitingRoom = await join(successWaiter, successProduct);
    const successOrder = await createOrder({ session: successUser, productId: successProduct, entryId: successRoom.viewer.entryId });
    const successWebhook = await sendWebhook(app, {
      eventType: "PAYMENT_SUCCEEDED",
      paymentId: successOrder.paymentId,
      amount: 1_000,
    });
    assert.equal(successWebhook.statusCode, 202, successWebhook.body);
    assert.equal((successWebhook.json() as { outcome: string }).outcome, "processed");
    const paidDrawing = await pool.query<{ order_status: string; payment_status: string; room_state: string }>(
      `SELECT o.status AS order_status,p.status AS payment_status,e.state AS room_state
         FROM orders o JOIN payments p ON p.order_id=o.id
         JOIN kuji_room_entries e ON e.order_id=o.id WHERE o.id=$1`,
      [successOrder.id],
    );
    assert.deepEqual(paidDrawing.rows[0], { order_status: "PAID", payment_status: "PAID", room_state: "DRAWING" });
    await bindSlots({
      session: successUser,
      productId: successProduct,
      entryId: successRoom.viewer.entryId,
      slotNumbers: [1],
    });

    const drawingFixture = await pool.query<{
      entitlement_id: string;
      drawing_expires_at: Date;
    }>(
      `SELECT e.id AS entitlement_id,r.drawing_expires_at
         FROM draw_entitlements e
         JOIN order_lines l ON l.id=e.order_line_id
         JOIN kuji_room_entries r ON r.order_id=l.order_id
        WHERE l.order_id=$1`,
      [successOrder.id],
    );
    const expiredDrawing = await expireRoomAt({
      session: successUser,
      productId: successProduct,
      serverNow: new Date(drawingFixture.rows[0]!.drawing_expires_at.getTime() + 1),
    });
    assert.equal(expiredDrawing.changed, true);
    assert.equal(expiredDrawing.promotedEntryId, successWaitingRoom.viewer.entryId);
    const drawingExpiryState = await pool.query<{
      room_state: string;
      waiter_state: string;
      entitlement_status: string;
    }>(
      `SELECT r.state AS room_state,w.state AS waiter_state,e.status AS entitlement_status
         FROM kuji_room_entries r
         JOIN kuji_room_entries w ON w.id=$2
         JOIN order_lines l ON l.order_id=r.order_id
         JOIN draw_entitlements e ON e.order_line_id=l.id
        WHERE r.order_id=$1`,
      [successOrder.id, successWaitingRoom.viewer.entryId],
    );
    assert.deepEqual(drawingExpiryState.rows[0], {
      room_state: "EXPIRED",
      waiter_state: "CHECKOUT_PENDING",
      entitlement_status: "AVAILABLE",
    });
    const expiredDeckSnapshotVersion = await readDeckSnapshotVersion(successProduct);
    const consumedAfterDrawingExpiry = await app.inject({
      method: "POST",
      url: `/v1/draws/${drawingFixture.rows[0]!.entitlement_id}/consume`,
      headers: { ...auth(successUser), "idempotency-key": `kuji-expired-consume-${randomUUID()}` },
    });
    assert.equal(consumedAfterDrawingExpiry.statusCode, 200, consumedAfterDrawingExpiry.body);
    assert.equal(
      await readDeckSnapshotVersion(successProduct),
      expiredDeckSnapshotVersion + 1,
    );
    const consumedExpiryState = await pool.query<{ room_state: string; entitlement_status: string }>(
      `SELECT r.state AS room_state,e.status AS entitlement_status
         FROM kuji_room_entries r
         JOIN order_lines l ON l.order_id=r.order_id
         JOIN draw_entitlements e ON e.order_line_id=l.id
        WHERE r.order_id=$1`,
      [successOrder.id],
    );
    assert.deepEqual(consumedExpiryState.rows[0], {
      room_state: "EXPIRED",
      entitlement_status: "CONSUMED",
    });

    const lateProduct = await createKuji("late-kuji");
    const lateUser = await createSession("late-user");
    const lateWaiter = await createSession("late-waiter");
    await pool.query("INSERT INTO point_accounts(user_id,balance) VALUES($1,100)", [lateUser.actor.userId]);
    await pool.query(
      `INSERT INTO point_ledger_entries(user_id,entry_type,amount,reference_type,reference_id,reason)
       VALUES($1,'EARN',100,'TEST',$2,'Kuji late success integration setup')`,
      [lateUser.actor.userId, `late-${suffix}`],
    );
    const lateCouponCode = `KUJI-LATE-${suffix}`;
    await pool.query(
      `INSERT INTO coupons(code,discount_type,discount_value,starts_at,ends_at,usage_limit)
       VALUES($1,'FIXED',100,now()-interval '1 day',now()+interval '1 day',10)`,
      [lateCouponCode],
    );
    const lateRoom = await join(lateUser, lateProduct);
    const lateWaitingRoom = await join(lateWaiter, lateProduct);
    const lateOrder = await createOrder({
      session: lateUser,
      productId: lateProduct,
      entryId: lateRoom.viewer.entryId,
      pointAmount: 100,
      couponCode: lateCouponCode,
    });
    assert.equal(lateOrder.total, 800);
    const lateOccurredAt = new Date(new Date(lateRoom.viewer.checkoutExpiresAt!).getTime() + 1);
    const lateSuccess = await sendWebhook(app, {
      eventType: "PAYMENT_SUCCEEDED",
      paymentId: lateOrder.paymentId,
      amount: lateOrder.total,
      occurredAt: lateOccurredAt.toISOString(),
    });
    assert.equal(lateSuccess.statusCode, 202, lateSuccess.body);
    assert.equal((lateSuccess.json() as { outcome: string }).outcome, "review");
    const lateReviewState = await pool.query<{
      order_status: string;
      payment_status: string;
      reservation_status: string;
      reserved: number;
      points: number;
      coupon_used: number;
      redemption_status: string;
      room_state: string;
      waiter_state: string;
      cancelled_at: Date | null;
      entitlement_count: string;
    }>(
      `SELECT o.status AS order_status,p.status AS payment_status,r.status AS reservation_status,
              s.reserved,a.balance AS points,c.used_count AS coupon_used,
              cr.status AS redemption_status,e.state AS room_state,w.state AS waiter_state,
              o.cancelled_at,
              (SELECT count(*) FROM draw_entitlements de
                JOIN order_lines ol ON ol.id=de.order_line_id WHERE ol.order_id=o.id) AS entitlement_count
         FROM orders o
         JOIN payments p ON p.order_id=o.id
         JOIN stock_reservations r ON r.order_id=o.id
         JOIN product_stock s ON s.product_id=r.product_id
         JOIN point_accounts a ON a.user_id=o.user_id
         JOIN coupon_redemptions cr ON cr.order_id=o.id
         JOIN coupons c ON c.id=cr.coupon_id
         JOIN kuji_room_entries e ON e.order_id=o.id
         JOIN kuji_room_entries w ON w.id=$2
        WHERE o.id=$1`,
      [lateOrder.id, lateWaitingRoom.viewer.entryId],
    );
    assert.deepEqual(
      { ...lateReviewState.rows[0], cancelled_at: Boolean(lateReviewState.rows[0]!.cancelled_at) },
      {
        order_status: "REFUND_REVIEW",
        payment_status: "REFUND_REVIEW",
        reservation_status: "RELEASED",
        reserved: 0,
        points: 100,
        coupon_used: 0,
        redemption_status: "RELEASED",
        room_state: "EXPIRED",
        waiter_state: "CHECKOUT_PENDING",
        cancelled_at: true,
        entitlement_count: "0",
      },
    );
    const lateRefund = await sendWebhook(app, {
      eventType: "REFUND_SUCCEEDED",
      paymentId: lateOrder.paymentId,
      amount: lateOrder.total,
      occurredAt: new Date(lateOccurredAt.getTime() + 1_000).toISOString(),
    });
    assert.equal(lateRefund.statusCode, 202, lateRefund.body);
    assert.equal((lateRefund.json() as { outcome: string }).outcome, "processed");
    const lateRefundState = await pool.query<{
      order_status: string;
      payment_status: string;
      payment_entries: string;
      refund_entries: string;
      net_ledger_amount: string;
    }>(
      `SELECT o.status AS order_status,p.status AS payment_status,
              count(*) FILTER (WHERE l.entry_type='PAYMENT') AS payment_entries,
              count(*) FILTER (WHERE l.entry_type='REFUND') AS refund_entries,
              sum(l.amount) AS net_ledger_amount
         FROM orders o
         JOIN payments p ON p.order_id=o.id
         JOIN payment_ledger_entries l ON l.payment_id=p.id
        WHERE o.id=$1
        GROUP BY o.status,p.status`,
      [lateOrder.id],
    );
    assert.deepEqual(lateRefundState.rows[0], {
      order_status: "REFUNDED",
      payment_status: "REFUNDED",
      payment_entries: "1",
      refund_entries: "1",
      net_ledger_amount: "0",
    });

    const failedProduct = await createKuji("failed-kuji");
    const failedUser = await createSession("failed-user");
    const failedWaiter = await createSession("failed-waiter");
    const failedRoom = await join(failedUser, failedProduct);
    const failedWaitingRoom = await join(failedWaiter, failedProduct);
    const failedOrder = await createOrder({ session: failedUser, productId: failedProduct, entryId: failedRoom.viewer.entryId });
    const failedWebhook = await sendWebhook(app, {
      eventType: "PAYMENT_FAILED",
      paymentId: failedOrder.paymentId,
      amount: 1_000,
    });
    assert.equal((failedWebhook.json() as { outcome: string }).outcome, "processed");
    const failedState = await pool.query<{ room_state: string; waiter_state: string; reserved: number }>(
      `SELECT e.state AS room_state,w.state AS waiter_state,s.reserved
         FROM kuji_room_entries e
         JOIN kuji_room_entries w ON w.id=$2
         JOIN product_stock s ON s.product_id=e.product_id
        WHERE e.order_id=$1`,
      [failedOrder.id, failedWaitingRoom.viewer.entryId],
    );
    assert.deepEqual(failedState.rows[0], { room_state: "CANCELLED", waiter_state: "CHECKOUT_PENDING", reserved: 0 });
  },
);
