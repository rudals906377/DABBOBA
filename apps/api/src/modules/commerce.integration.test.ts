import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { acceptRequiredPoliciesForIntegrationTest } from "../integration-test-fixtures.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;
const provider = "TEST_PG";
const webhookSecret = "commerce-integration-webhook-secret";

type Session = { token: string; actor: { userId: string } };
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
    eventId?: string;
    eventType: "PAYMENT_SUCCEEDED" | "PAYMENT_FAILED" | "PAYMENT_CANCELLED" | "REFUND_SUCCEEDED";
    paymentId: string;
    amount: number;
  },
) {
  const payload = JSON.stringify({
    eventId: input.eventId ?? `evt-${randomUUID()}`,
    eventType: input.eventType,
    paymentId: input.paymentId,
    providerPaymentId: `provider-${input.paymentId}`,
    occurredAt: new Date().toISOString(),
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
  "commerce persists zero-payment fulfillment, out-of-order refunds, asset reconciliation, and finite draw invariants",
  { skip: !databaseUrl, timeout: 60_000 },
  async (t) => {
    const pool = createDatabasePool(databaseUrl!, "dabboba-commerce-integration");
    const config: ApiConfig = {
      environment: "test",
      host: "127.0.0.1",
      port: 8788,
      databaseUrl: databaseUrl!,
      redisUrl: "redis://127.0.0.1:6379",
      webOrigins: ["http://127.0.0.1:4174"],
      adminOrigins: ["http://127.0.0.1:4180"],
      sessionTokenPepper: "commerce-integration-session-pepper",
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
    const ipId = `commerce-ip-${suffix}`;
    let sequence = 0;
    await pool.query(
      "INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$4)",
      [ipId, ipId, `커머스 통합 ${suffix}`, `Commerce ${suffix}`],
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
    const createProduct = async (
      category: "gacha" | "figure" | "kuji" | "tcg",
      price: number,
      onHand: number,
      label: string,
      isPrizeOnly = false,
    ) => {
      const productId = `${label}-${suffix}-${sequence++}`.toLowerCase();
      await pool.query(
        `INSERT INTO catalog_products(id,sku,ip_id,category,name,price,image_url,is_prize_only)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          productId,
          `${label}-${suffix}-${sequence}`.toUpperCase(),
          ipId,
          category,
          `${label} ${suffix}`,
          price,
          `https://cdn.example.test/products/${productId}.png`,
          isPrizeOnly,
        ],
      );
      await pool.query("INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,$2,0)", [productId, onHand]);
      return productId;
    };
    const createOrder = async (session: Session, productId: string, pointAmount = 0): Promise<OrderResponse> => {
      const activeDrawVersion = await pool.query<{ version: number }>(
        "SELECT version FROM draw_probability_versions WHERE product_id=$1 AND status='ACTIVE'",
        [productId],
      );
      const response = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: {
          authorization: `Bearer ${session.token}`,
          "idempotency-key": `order-${randomUUID()}`,
        },
        payload: {
          items: [{
            productId,
            quantity: 1,
            ...(activeDrawVersion.rows[0] ? { expectedDrawVersion: activeDrawVersion.rows[0].version } : {}),
          }],
          pointAmount,
        },
      });
      assert.equal(response.statusCode, 201, response.body);
      return response.json() as OrderResponse;
    };
    const state = async (orderId: string) => {
      const result = await pool.query<{ order_status: string; payment_status: string }>(
        `SELECT o.status AS order_status,p.status AS payment_status
         FROM orders o JOIN payments p ON p.order_id=o.id WHERE o.id=$1`,
        [orderId],
      );
      return result.rows[0]!;
    };

    const paymentDrawProduct = await createProduct("gacha", 10_000, 40, "payment-draw");
    const paymentPrizeProduct = await createProduct("figure", 0, 200, "payment-prize", true);
    const paymentPublisher = await createSession("payment-draw-publisher");
    const paymentVersion = await pool.query<{ id: string }>(
      "INSERT INTO draw_probability_versions(product_id,version) VALUES($1,1) RETURNING id",
      [paymentDrawProduct],
    );
    const paymentPrizeSnapshot = await pool.query<{
      category: string;
      image_url: string | null;
      ip_id: string;
      name: string;
      sku: string;
    }>(
      "SELECT name,image_url,sku,ip_id,category FROM catalog_products WHERE id=$1",
      [paymentPrizeProduct],
    );
    await pool.query(
      `INSERT INTO draw_pool_entries(
         probability_version_id,prize_product_id,prize_name_snapshot,prize_image_url_snapshot,
         prize_sku_snapshot,prize_ip_id_snapshot,prize_category_snapshot,rarity,weight
       ) VALUES($1,$2,$3,$4,$5,$6,$7,'A',1)`,
      [
        paymentVersion.rows[0]!.id,
        paymentPrizeProduct,
        paymentPrizeSnapshot.rows[0]!.name,
        paymentPrizeSnapshot.rows[0]!.image_url,
        paymentPrizeSnapshot.rows[0]!.sku,
        paymentPrizeSnapshot.rows[0]!.ip_id,
        paymentPrizeSnapshot.rows[0]!.category,
      ],
    );
    await pool.query(
      `UPDATE draw_probability_versions
       SET status='ACTIVE',published_by=$2,published_at=now() WHERE id=$1`,
      [paymentVersion.rows[0]!.id, paymentPublisher.actor.userId],
    );
    await pool.query(
      "UPDATE catalog_products SET sale_status='ON_SALE' WHERE id=$1",
      [paymentDrawProduct],
    );

    const zeroUser = await createSession("zero-payment");
    await pool.query("INSERT INTO point_accounts(user_id,balance) VALUES($1,10000)", [zeroUser.actor.userId]);
    await pool.query(
      `INSERT INTO point_ledger_entries(user_id,entry_type,amount,reference_type,reference_id,reason)
       VALUES($1,'EARN',10000,'TEST',$2,'Commerce integration setup')`,
      [zeroUser.actor.userId, suffix],
    );
    const zeroOrder = await createOrder(zeroUser, paymentDrawProduct, 10_000);
    assert.equal(zeroOrder.status, "PAID");
    assert.equal(zeroOrder.total, 0);
    const zeroPersisted = await pool.query<{
      entitlement_count: string;
      inventory_count: string;
      ledger_count: string;
      payment_status: string;
      provider: string;
    }>(
      `SELECT p.provider,p.status AS payment_status,
        (SELECT count(*) FROM inventory_units i JOIN order_lines l ON l.id=i.source_id WHERE l.order_id=o.id) AS inventory_count,
        (SELECT count(*) FROM draw_entitlements e JOIN order_lines l ON l.id=e.order_line_id WHERE l.order_id=o.id) AS entitlement_count,
        (SELECT count(*) FROM payment_ledger_entries e WHERE e.payment_id=p.id) AS ledger_count
       FROM orders o JOIN payments p ON p.order_id=o.id WHERE o.id=$1`,
      [zeroOrder.id],
    );
    assert.deepEqual(zeroPersisted.rows[0], {
      provider: "INTERNAL_ZERO",
      payment_status: "PAID",
      inventory_count: "0",
      entitlement_count: "1",
      ledger_count: "0",
    });

    const refundFirstUser = await createSession("refund-first");
    const refundFirstOrder = await createOrder(refundFirstUser, paymentDrawProduct);
    const refundFirstEvent = `refund-first-${randomUUID()}`;
    const refundedBeforeSuccess = await sendWebhook(app, {
      eventId: refundFirstEvent,
      eventType: "REFUND_SUCCEEDED",
      paymentId: refundFirstOrder.paymentId,
      amount: 10_000,
    });
    assert.equal(refundedBeforeSuccess.statusCode, 202, refundedBeforeSuccess.body);
    assert.equal((refundedBeforeSuccess.json() as { outcome: string }).outcome, "processed");
    assert.deepEqual(await state(refundFirstOrder.id), { order_status: "REFUNDED", payment_status: "REFUNDED" });
    const refundFirstLedgers = await pool.query<{ entry_type: string; amount: number }>(
      "SELECT entry_type,amount FROM payment_ledger_entries WHERE payment_id=$1 ORDER BY amount DESC",
      [refundFirstOrder.paymentId],
    );
    assert.deepEqual(refundFirstLedgers.rows, [
      { entry_type: "PAYMENT", amount: 10_000 },
      { entry_type: "REFUND", amount: -10_000 },
    ]);
    const successAfterRefund = await sendWebhook(app, {
      eventType: "PAYMENT_SUCCEEDED",
      paymentId: refundFirstOrder.paymentId,
      amount: 10_000,
    });
    assert.equal(successAfterRefund.statusCode, 202, successAfterRefund.body);
    assert.equal((successAfterRefund.json() as { outcome: string }).outcome, "ignored");
    assert.deepEqual(await state(refundFirstOrder.id), { order_status: "REFUNDED", payment_status: "REFUNDED" });

    const lateUser = await createSession("late-success");
    const lateOrder = await createOrder(lateUser, paymentDrawProduct);
    const cancelled = await sendWebhook(app, {
      eventType: "PAYMENT_CANCELLED",
      paymentId: lateOrder.paymentId,
      amount: 10_000,
    });
    assert.equal(cancelled.statusCode, 202, cancelled.body);
    const lateSuccess = await sendWebhook(app, {
      eventType: "PAYMENT_SUCCEEDED",
      paymentId: lateOrder.paymentId,
      amount: 10_000,
    });
    assert.equal((lateSuccess.json() as { outcome: string }).outcome, "review");
    assert.deepEqual(await state(lateOrder.id), { order_status: "REFUND_REVIEW", payment_status: "REFUND_REVIEW" });
    const lateRefund = await sendWebhook(app, {
      eventType: "REFUND_SUCCEEDED",
      paymentId: lateOrder.paymentId,
      amount: 10_000,
    });
    assert.equal((lateRefund.json() as { outcome: string }).outcome, "processed");
    assert.deepEqual(await state(lateOrder.id), { order_status: "REFUNDED", payment_status: "REFUNDED" });

    const paidUser = await createSession("unsafe-refund-owner");
    const newOwner = await createSession("unsafe-refund-new-owner");
    const unsafeOrder = await createOrder(paidUser, paymentDrawProduct);
    const paid = await sendWebhook(app, {
      eventType: "PAYMENT_SUCCEEDED",
      paymentId: unsafeOrder.paymentId,
      amount: 10_000,
    });
    assert.equal((paid.json() as { outcome: string }).outcome, "processed");
    const unsafeEntitlement = await pool.query<{ id: string }>(
      `SELECT entitlement.id
       FROM draw_entitlements entitlement
       JOIN order_lines line ON line.id=entitlement.order_line_id
       WHERE line.order_id=$1`,
      [unsafeOrder.id],
    );
    assert.equal(unsafeEntitlement.rowCount, 1);
    const consumedUnsafeDraw = await app.inject({
      method: "POST",
      url: `/v1/draws/${unsafeEntitlement.rows[0]!.id}/consume`,
      headers: {
        authorization: `Bearer ${paidUser.token}`,
        "idempotency-key": `unsafe-refund-consume-${randomUUID()}`,
      },
    });
    assert.equal(consumedUnsafeDraw.statusCode, 200, consumedUnsafeDraw.body);
    const unsafeInventoryId = (consumedUnsafeDraw.json() as { prizeInventoryUnitId: string }).prizeInventoryUnitId;
    const moved = await pool.query<{ id: string }>(
      "UPDATE inventory_units SET owner_id=$2 WHERE id=$1 RETURNING id",
      [unsafeInventoryId, newOwner.actor.userId],
    );
    assert.equal(moved.rowCount, 1);
    const unsafeRefund = await sendWebhook(app, {
      eventType: "REFUND_SUCCEEDED",
      paymentId: unsafeOrder.paymentId,
      amount: 10_000,
    });
    assert.equal((unsafeRefund.json() as { outcome: string }).outcome, "review");
    assert.deepEqual(await state(unsafeOrder.id), { order_status: "REFUND_REVIEW", payment_status: "REFUND_REVIEW" });
    const movedAfterReview = await pool.query<{ owner_id: string; status: string }>(
      "SELECT owner_id,status FROM inventory_units WHERE id=$1",
      [moved.rows[0]!.id],
    );
    assert.deepEqual(movedAfterReview.rows[0], { owner_id: newOwner.actor.userId, status: "OWNED" });

    const drawProduct = await createProduct("gacha", 3_000, 1, "draw");
    const prizeProduct = await createProduct("figure", 0, 200, "prize", true);
    const prizeBoundaryUser = await createSession("prize-boundary");
    const publicCatalog = await app.inject({
      method: "GET",
      url: `/v1/catalog/products?ipId=${encodeURIComponent(ipId)}&limit=100`,
    });
    assert.equal(publicCatalog.statusCode, 200, publicCatalog.body);
    assert.equal(
      (publicCatalog.json() as { items: Array<{ id: string }> }).items.some((item) => item.id === prizeProduct),
      false,
    );
    const prizeWishlist = await app.inject({
      method: "POST",
      url: `/v1/account/wishlist/${prizeProduct}`,
      headers: {
        authorization: `Bearer ${prizeBoundaryUser.token}`,
        "idempotency-key": `wishlist-prize-${randomUUID()}`,
      },
    });
    assert.equal(prizeWishlist.statusCode, 404, prizeWishlist.body);
    await pool.query(
      "INSERT INTO wishlist_items(user_id,product_id) VALUES($1,$2)",
      [prizeBoundaryUser.actor.userId, prizeProduct],
    );
    const prizeWishlistRead = await app.inject({
      method: "GET",
      url: "/v1/account/wishlist",
      headers: { authorization: `Bearer ${prizeBoundaryUser.token}` },
    });
    assert.equal(prizeWishlistRead.statusCode, 200, prizeWishlistRead.body);
    assert.equal(
      (prizeWishlistRead.json() as { items: Array<{ productId: string }> }).items
        .some((item) => item.productId === prizeProduct),
      false,
    );
    const prizeOrder = await app.inject({
      method: "POST",
      url: "/v1/orders",
      headers: {
        authorization: `Bearer ${prizeBoundaryUser.token}`,
        "idempotency-key": `order-prize-${randomUUID()}`,
      },
      payload: { items: [{ productId: prizeProduct, quantity: 1 }], pointAmount: 0 },
    });
    assert.equal(prizeOrder.statusCode, 409, prizeOrder.body);
    assert.match(prizeOrder.body, /아직 구매할 수 없습니다/);
    const publisher = await createSession("draw-publisher");
    const createDrawVersion = async (version: number, quantity: number) => {
      const created = await pool.query<{ id: string }>(
        "INSERT INTO draw_probability_versions(product_id,version) VALUES($1,$2) RETURNING id",
        [drawProduct, version],
      );
      const versionId = created.rows[0]!.id;
      const prizeSnapshot = await pool.query<{
        name: string; image_url: string | null; sku: string; ip_id: string; category: string;
      }>("SELECT name,image_url,sku,ip_id,category FROM catalog_products WHERE id=$1", [prizeProduct]);
      await pool.query(
        `INSERT INTO draw_pool_entries
          (probability_version_id,prize_product_id,prize_name_snapshot,prize_image_url_snapshot,
           prize_sku_snapshot,prize_ip_id_snapshot,prize_category_snapshot,rarity,weight,initial_quantity,remaining_quantity)
         VALUES($1,$2,$3,$4,$5,$6,$7,'A',1,$8,$8)`,
        [
          versionId,
          prizeProduct,
          prizeSnapshot.rows[0]!.name,
          prizeSnapshot.rows[0]!.image_url,
          prizeSnapshot.rows[0]!.sku,
          prizeSnapshot.rows[0]!.ip_id,
          prizeSnapshot.rows[0]!.category,
          quantity,
        ],
      );
      await pool.query(
        `UPDATE draw_probability_versions
         SET status='ACTIVE',published_by=$2,published_at=now() WHERE id=$1`,
        [versionId, publisher.actor.userId],
      );
      await pool.query(
        "UPDATE catalog_products SET sale_status='ON_SALE' WHERE id=$1",
        [drawProduct],
      );
      return versionId;
    };
    const versionOne = await createDrawVersion(1, 1);
    const retiredOrderUser = await createSession("retired-draw-order");
    const retiredOrder = await createOrder(retiredOrderUser, drawProduct);
    await pool.query("UPDATE draw_probability_versions SET status='RETIRED' WHERE id=$1", [versionOne]);
    const versionTwo = await createDrawVersion(2, 100);
    await pool.query("UPDATE product_stock SET on_hand=100 WHERE product_id=$1", [drawProduct]);
    const paidRetiredOrder = await sendWebhook(app, {
      eventType: "PAYMENT_SUCCEEDED",
      paymentId: retiredOrder.paymentId,
      amount: 3_000,
    });
    assert.equal((paidRetiredOrder.json() as { outcome: string }).outcome, "processed");
    const retiredEntitlement = await pool.query<{ id: string; probability_version_id: string; status: string }>(
      "SELECT id,probability_version_id,status FROM draw_entitlements WHERE order_line_id IN (SELECT id FROM order_lines WHERE order_id=$1)",
      [retiredOrder.id],
    );
    assert.deepEqual(retiredEntitlement.rows[0], {
      id: retiredEntitlement.rows[0]!.id,
      probability_version_id: versionOne,
      status: "AVAILABLE",
    });
    const stockBeforeRetiredRefund = await pool.query<{ on_hand: number }>(
      "SELECT on_hand FROM product_stock WHERE product_id=$1",
      [drawProduct],
    );
    assert.equal(stockBeforeRetiredRefund.rows[0]!.on_hand, 99);
    const retiredRefund = await sendWebhook(app, {
      eventType: "REFUND_SUCCEEDED",
      paymentId: retiredOrder.paymentId,
      amount: 3_000,
    });
    assert.equal((retiredRefund.json() as { outcome: string }).outcome, "processed");
    const retiredRefundState = await pool.query<{ on_hand: number; entitlement_status: string; event_count: string }>(
      `SELECT s.on_hand,e.status AS entitlement_status,
        (SELECT count(*) FROM outbox_events o WHERE o.aggregate_id=$2 AND o.event_type='draw.refund_stock_not_relisted') AS event_count
       FROM product_stock s CROSS JOIN draw_entitlements e
       WHERE s.product_id=$1 AND e.id=$3`,
      [drawProduct, retiredOrder.id, retiredEntitlement.rows[0]!.id],
    );
    assert.deepEqual(retiredRefundState.rows[0], { on_hand: 99, entitlement_status: "CANCELLED", event_count: "1" });

    await assert.rejects(
      pool.query("UPDATE product_stock SET on_hand=101 WHERE product_id=$1", [drawProduct]),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "23514",
    );

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const concurrentUser = await createSession(`refund-consume-${attempt}`);
      const concurrentOrder = await createOrder(concurrentUser, drawProduct);
      const concurrentPaid = await sendWebhook(app, {
        eventType: "PAYMENT_SUCCEEDED",
        paymentId: concurrentOrder.paymentId,
        amount: 3_000,
      });
      assert.equal((concurrentPaid.json() as { outcome: string }).outcome, "processed");
      const entitlementId = (await pool.query<{ id: string }>(
        "SELECT id FROM draw_entitlements WHERE order_line_id IN (SELECT id FROM order_lines WHERE order_id=$1)",
        [concurrentOrder.id],
      )).rows[0]!.id;
      let timeoutId: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("refund/consume concurrency timed out")), 8_000);
      });
      const operations = Promise.all([
        app.inject({
          method: "POST",
          url: `/v1/draws/${entitlementId}/consume`,
          headers: { authorization: `Bearer ${concurrentUser.token}`, "idempotency-key": `consume-${randomUUID()}` },
        }),
        sendWebhook(app, {
          eventType: "REFUND_SUCCEEDED",
          paymentId: concurrentOrder.paymentId,
          amount: 3_000,
        }),
      ]);
      const [consumeResponse, refundResponse] = await Promise.race([operations, timeout]).finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
      });
      assert.ok([200, 409].includes(consumeResponse.statusCode), consumeResponse.body);
      assert.equal(refundResponse.statusCode, 202, refundResponse.body);
      assert.ok(["processed", "review"].includes((refundResponse.json() as { outcome: string }).outcome));
      assert.notEqual(consumeResponse.statusCode, 500, consumeResponse.body);
      assert.notEqual(refundResponse.statusCode, 500, refundResponse.body);
    }

    const activeVersion = await pool.query<{ id: string }>(
      "SELECT id FROM draw_probability_versions WHERE product_id=$1 AND status='ACTIVE'",
      [drawProduct],
    );
    assert.equal(activeVersion.rows[0]!.id, versionTwo);
  },
);
