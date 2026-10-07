import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import { buildApp } from "../app.js";
import { acceptRequiredPoliciesForIntegrationTest, acceptUgcOperationsPolicyForIntegrationTest } from "../integration-test-fixtures.js";
import { issueSession } from "../plugins/auth.js";
import { lateRefundBlocker, REFUND_CANDIDATE_LOOKUP_SQL } from "./portone-payments.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;

test(
  "an operator shipping cancellation freezes the paid fee for refund, and prizes of orders under review cannot ship, exchange or return",
  { skip: !databaseUrl, timeout: 60_000 },
  async (t) => {
    const pool = createDatabasePool(databaseUrl!, "dabboba-shipping-cancel-fee-gate-integration");
    const config: ApiConfig = {
      environment: "test", host: "127.0.0.1", port: 8788, databaseUrl: databaseUrl!, redisUrl: "redis://127.0.0.1:6379",
      webOrigins: ["http://127.0.0.1:4174"], adminOrigins: ["http://127.0.0.1:4180"],
      sessionTokenPepper: "shipping-cancel-fee-gate-pepper", adminProxyIdentitySecret: null,
      sessionTtlDays: 1, commerceMode: "LIVE", paymentProvider: "PORTONE_V2_INICIS",
      paymentWebhookSecret: "shipping-cancel-fee-gate-webhook-secret",
      portOne: {
        apiSecret: "synthetic-secret", merchantId: "synthetic-merchant", storeId: "synthetic-store",
        channelKey: "synthetic-channel", channelEnvironment: "TEST",
        webhookSecret: "shipping-cancel-fee-gate-webhook-secret",
      },
      gcsBucket: null, gcsProjectId: null, logLevel: "silent",
    };
    const { app } = await buildApp({ config, pool, redis: null });
    t.after(async () => { await app.close(); await pool.end(); });
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const actor = async (role: "USER" | "ADMIN", label: string) => {
      const user = await pool.query<{ id: string }>(
        "INSERT INTO users(email,nickname,role,status) VALUES($1,$2,$3,'ACTIVE') RETURNING id",
        [`${label}-${suffix}@example.test`, `${label} ${suffix}`, role],
      );
      const id = user.rows[0]!.id;
      if (role === "USER") {
        await acceptRequiredPoliciesForIntegrationTest(pool, id);
        await acceptUgcOperationsPolicyForIntegrationTest(pool, id);
      }
      const session = await issueSession(pool, config, {
        userId: id, kind: role, ip: "203.0.113.95", userAgent: "Shipping cancel fee gate integration test",
      });
      return { id, token: session.token };
    };
    const owner = await actor("USER", "gate-owner");
    const admin = await actor("ADMIN", "gate-admin");
    const auth = (token: string) => ({ authorization: `Bearer ${token}` });
    const mutation = (token: string, reason: string) => ({
      authorization: `Bearer ${token}`, "x-admin-reason": reason, "idempotency-key": `gate-${randomUUID()}`,
    });

    const ipId = `gate-ip-${suffix}`;
    const gachaId = `gate-gacha-${suffix}`;
    const prizeId = `gate-prize-${suffix}`;
    await pool.query("INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$3)", [ipId, ipId, `게이트 ${suffix}`]);
    await pool.query(
      "INSERT INTO catalog_products(id,sku,ip_id,category,name,price,is_prize_only) VALUES($1,$2,$3,'gacha',$4,3000,false),($5,$6,$3,'figure',$7,12000,true)",
      [gachaId, `GATE-G-${suffix}`.toUpperCase(), ipId, `가챠 ${suffix}`, prizeId, `GATE-P-${suffix}`.toUpperCase(), `경품 ${suffix}`],
    );
    const version = await pool.query<{ id: string }>(
      "INSERT INTO draw_probability_versions(product_id,version) VALUES($1,1) RETURNING id", [gachaId],
    );
    const versionId = version.rows[0]!.id;
    const poolEntry = await pool.query<{ id: string }>(
      `INSERT INTO draw_pool_entries(
         probability_version_id,prize_product_id,prize_name_snapshot,prize_image_url_snapshot,
         prize_sku_snapshot,prize_ip_id_snapshot,prize_category_snapshot,rarity,weight
       ) VALUES($1,$2,$3,NULL,$4,$5,'figure','A',1) RETURNING id`,
      [versionId, prizeId, `경품 ${suffix}`, `GATE-P-${suffix}`.toUpperCase(), ipId],
    );
    await pool.query(
      "UPDATE draw_probability_versions SET status='ACTIVE',published_by=$2,published_at=now() WHERE id=$1",
      [versionId, admin.id],
    );
    await pool.query(
      `INSERT INTO default_shipping_addresses(user_id,recipient,phone,postal_code,address_line1,address_line2,delivery_note)
       VALUES($1,'게이트','01012345678','06236','서울특별시 강남구 테헤란로 1','101호','')`,
      [owner.id],
    );

    // One prize drawn from an order that is still settled, one from an order frozen for refund review.
    const drawnPrize = async (orderStatus: "PAID" | "REFUND_REVIEW") => {
      // The draw-result integrity trigger requires a PAID order and an AVAILABLE
      // entitlement at insert time; the review freeze is applied afterwards.
      const order = await pool.query<{ id: string }>(
        "INSERT INTO orders(user_id,status,subtotal,total,paid_at) VALUES($1,'PAID',3000,3000,now()) RETURNING id",
        [owner.id],
      );
      const line = await pool.query<{ id: string }>(
        `INSERT INTO order_lines(order_id,product_id,product_name_snapshot,category_snapshot,probability_version_id,unit_price,quantity,line_total)
         VALUES($1,$2,'가챠','gacha',$3,3000,1,3000) RETURNING id`,
        [order.rows[0]!.id, gachaId, versionId],
      );
      const entitlement = await pool.query<{ id: string }>(
        "INSERT INTO draw_entitlements(order_line_id,user_id,product_id,probability_version_id) VALUES($1,$2,$3,$4) RETURNING id",
        [line.rows[0]!.id, owner.id, gachaId, versionId],
      );
      const unit = await pool.query<{ id: string }>(
        "INSERT INTO inventory_units(owner_id,product_id,source_type,source_id,status) VALUES($1,$2,'GACHA',$3,'OWNED') RETURNING id",
        [owner.id, prizeId, entitlement.rows[0]!.id],
      );
      await pool.query(
        `INSERT INTO draw_results(
           entitlement_id,user_id,product_id,pool_entry_id,prize_product_id,prize_inventory_unit_id,
           probability_version,selection_algorithm,entropy_hex,entropy_digest,roll_value,total_weight,selection_snapshot
         ) VALUES($1,$2,$3,$4,$5,$6,1,'SHA256_REJECTION_V1',$7,$8,0,1,'[]'::jsonb)`,
        [entitlement.rows[0]!.id, owner.id, gachaId, poolEntry.rows[0]!.id, prizeId, unit.rows[0]!.id, "0".repeat(64), "1".repeat(64)],
      );
      await pool.query(
        "UPDATE draw_entitlements SET status='CONSUMED',consumed_at=now() WHERE id=$1 AND status='AVAILABLE'",
        [entitlement.rows[0]!.id],
      );
      if (orderStatus === "REFUND_REVIEW") {
        await pool.query("UPDATE orders SET status='REFUND_REVIEW',version=version+1 WHERE id=$1", [order.rows[0]!.id]);
      }
      return unit.rows[0]!.id;
    };
    const settledUnit = await drawnPrize("PAID");
    const reviewedUnit = await drawnPrize("REFUND_REVIEW");

    // --- #7: the reviewed prize is refused everywhere; the settled one is not. ---
    const quote = await app.inject({
      method: "POST", url: "/v1/account/shipping-quotes", headers: auth(owner.token),
      payload: { inventoryUnitIds: [reviewedUnit] },
    });
    assert.equal(quote.statusCode, 409, quote.body);
    assert.match(quote.body, /결제 확인이 진행 중인 주문/);
    const settledQuote = await app.inject({
      method: "POST", url: "/v1/account/shipping-quotes", headers: auth(owner.token),
      payload: { inventoryUnitIds: [settledUnit] },
    });
    assert.equal(settledQuote.statusCode, 200, settledQuote.body);

    const listing = await app.inject({
      method: "POST", url: "/v1/exchange/listings",
      headers: { ...auth(owner.token), "idempotency-key": `gate-listing-${suffix}` },
      payload: { title: "검토 중 상품 교환 테스트", details: "검토 중인 주문의 경품은 교환 등록이 거절되어야 합니다.", offeredInventoryUnitIds: [reviewedUnit] },
    });
    assert.equal(listing.statusCode, 409, listing.body);
    assert.match(listing.body, /결제 확인이 진행 중인 주문/);
    const exchangeInventory = await app.inject({ method: "GET", url: "/v1/exchange/inventory", headers: auth(owner.token) });
    assert.equal(exchangeInventory.statusCode, 200, exchangeInventory.body);
    const offered = (exchangeInventory.json() as { items: Array<{ id: string }> }).items.map((item) => item.id);
    assert.ok(offered.includes(settledUnit));
    assert.ok(!offered.includes(reviewedUnit));

    const pointReturn = await app.inject({
      method: "POST", url: "/v1/account/point-returns",
      headers: { ...auth(owner.token), "idempotency-key": `gate-return-${suffix}` },
      payload: { inventoryUnitIds: [reviewedUnit] },
    });
    assert.equal(pointReturn.statusCode, 409, pointReturn.body);
    const untouched = await pool.query<{ status: string }>("SELECT status FROM inventory_units WHERE id=$1", [reviewedUnit]);
    assert.equal(untouched.rows[0]!.status, "OWNED");

    // --- #6: an operator cancellation of a fee-paid shipping request freezes the fee for refund. ---
    const shipping = await pool.query<{ id: string }>(
      `INSERT INTO shipping_requests(user_id,status,address_snapshot,reference_subtotal,free_shipping_threshold,qualifies_for_free_shipping,contains_kuji,shipping_fee)
       VALUES($1,'REQUESTED','{"recipient":"게이트"}'::jsonb,12000,24900,false,false,3000) RETURNING id`,
      [owner.id],
    );
    const shippingRequestId = shipping.rows[0]!.id;
    await pool.query(
      `INSERT INTO shipping_request_items(shipping_request_id,inventory_unit_id,product_snapshot)
       SELECT $1,inventory.id,jsonb_build_object(
         'productId',product.id,'productName',product.name,'ipId',product.ip_id,'ipNameKo',ip.name_ko,
         'category',product.category,'imageUrl',product.image_url,'productVersion',product.version
       )
       FROM inventory_units inventory
       JOIN catalog_products product ON product.id=inventory.product_id
       JOIN catalog_ips ip ON ip.id=product.ip_id
       WHERE inventory.id=$2`,
      [shippingRequestId, settledUnit],
    );
    await pool.query("UPDATE inventory_units SET status='SHIPPING' WHERE id=$1", [settledUnit]);
    const feeOrder = await pool.query<{ id: string }>(
      "INSERT INTO orders(user_id,status,subtotal,total,paid_at,order_kind,shipping_request_id) VALUES($1,'PAID',3000,3000,now(),'SHIPPING_FEE',$2) RETURNING id",
      [owner.id, shippingRequestId],
    );
    const feePayment = await pool.query<{ id: string }>(
      "INSERT INTO payments(order_id,provider,status,amount,paid_at) VALUES($1,'PORTONE_V2_INICIS','PAID',3000,now()) RETURNING id",
      [feeOrder.rows[0]!.id],
    );
    await pool.query(
      "INSERT INTO payment_ledger_entries(payment_id,order_id,entry_type,amount,reference_id) VALUES($1,$2,'PAYMENT',3000,$3)",
      [feePayment.rows[0]!.id, feeOrder.rows[0]!.id, `gate-fee-${suffix}`],
    );
    const cancelled = await app.inject({
      method: "POST", url: `/v1/admin/commerce/shipping/${shippingRequestId}/status`,
      headers: mutation(admin.token, "고객 요청으로 배송 취소"),
      payload: { status: "CANCELLED", expectedVersion: 1, reason: "고객 요청으로 배송 취소" },
    });
    assert.equal(cancelled.statusCode, 200, cancelled.body);
    const frozen = await pool.query<{ order_status: string; payment_status: string; cancelled_at: Date | null; unit_status: string; alerts: string }>(
      `SELECT o.status AS order_status,p.status AS payment_status,o.cancelled_at,
              (SELECT status FROM inventory_units WHERE id=$3) AS unit_status,
              (SELECT count(*)::text FROM outbox_events WHERE aggregate_type='PAYMENT' AND aggregate_id=p.id::text
                  AND event_type='payment.shipping_fee_refund_required') AS alerts
         FROM orders o JOIN payments p ON p.order_id=o.id WHERE o.id=$1 AND p.id=$2`,
      [feeOrder.rows[0]!.id, feePayment.rows[0]!.id, settledUnit],
    );
    assert.equal(frozen.rows[0]!.order_status, "REFUND_REVIEW");
    assert.equal(frozen.rows[0]!.payment_status, "REFUND_REVIEW");
    assert.ok(frozen.rows[0]!.cancelled_at);
    assert.equal(frozen.rows[0]!.unit_status, "OWNED");
    assert.equal(frozen.rows[0]!.alerts, "1");
    // The frozen fee is exactly what the admin refund path accepts.
    const candidate = await pool.query(REFUND_CANDIDATE_LOOKUP_SQL, [feePayment.rows[0]!.id]);
    assert.equal(lateRefundBlocker(candidate.rows[0] as Parameters<typeof lateRefundBlocker>[0]), null);
  },
);
