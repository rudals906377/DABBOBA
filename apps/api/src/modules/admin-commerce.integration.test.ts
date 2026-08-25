import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import { buildApp } from "../app.js";
import { issueSession } from "../plugins/auth.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;

test(
  "admin commerce operations preserve provider, stock, draw, shipping, idempotency, RBAC, and audit boundaries",
  { skip: !databaseUrl, timeout: 60_000 },
  async (t) => {
    const pool = createDatabasePool(databaseUrl!, "dabboba-admin-commerce-integration");
    const config: ApiConfig = {
      environment: "test",
      host: "127.0.0.1",
      port: 8788,
      databaseUrl: databaseUrl!,
      redisUrl: "redis://127.0.0.1:6379",
      webOrigins: ["http://127.0.0.1:4174"],
      adminOrigins: ["http://127.0.0.1:4180"],
      sessionTokenPepper: "admin-commerce-integration-session-pepper",
      adminProxyIdentitySecret: null,
      sessionTtlDays: 1,
      paymentProvider: "UNCONFIGURED",
      paymentWebhookSecret: null,
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
    const createActor = async (role: "USER" | "ADMIN" | "SUPER_ADMIN", label: string) => {
      const created = await pool.query<{ id: string }>(
        "INSERT INTO users(email,nickname,role,status) VALUES($1,$2,$3,'ACTIVE') RETURNING id",
        [`${label}-${suffix}@example.test`, `${label} ${suffix}`, role],
      );
      const session = await issueSession(pool, config, {
        userId: created.rows[0]!.id,
        kind: role === "USER" ? "USER" : "ADMIN",
        ip: "203.0.113.55",
        userAgent: "Dabboba Admin Commerce Integration/1.0",
      });
      return { id: created.rows[0]!.id, token: session.token };
    };
    const user = await createActor("USER", "commerce-owner");
    const admin = await createActor("ADMIN", "commerce-operator");
    const superAdmin = await createActor("SUPER_ADMIN", "commerce-supervisor");
    const auth = (token: string) => ({ authorization: `Bearer ${token}` });
    const mutation = (token: string, reason: string, key = `admin-commerce-${randomUUID()}`) => ({
      authorization: `Bearer ${token}`,
      "x-admin-reason": reason,
      "idempotency-key": key,
    });

    const permissions = await pool.query<{ role: string; permission_code: string }>(`
      SELECT role,permission_code FROM admin_role_permissions
      WHERE permission_code IN ('refunds.review','inventory.adjust','shipping.destination.read','shipping.manage') ORDER BY role,permission_code`);
    assert.ok(permissions.rows.some((item) => item.role === "ADMIN" && item.permission_code === "refunds.review"));
    assert.ok(permissions.rows.some((item) => item.role === "ADMIN" && item.permission_code === "shipping.manage"));
    assert.ok(permissions.rows.some((item) => item.role === "ADMIN" && item.permission_code === "shipping.destination.read"));
    assert.ok(!permissions.rows.some((item) => item.role === "ADMIN" && item.permission_code === "inventory.adjust"));
    assert.ok(permissions.rows.some((item) => item.role === "SUPER_ADMIN" && item.permission_code === "inventory.adjust"));

    const ipId = `admin-commerce-${suffix}`;
    const productId = `figure-${suffix}`;
    await pool.query("INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$4)", [ipId, ipId, `운영 IP ${suffix}`, `Operations ${suffix}`]);
    await pool.query(
      "INSERT INTO catalog_products(id,sku,ip_id,category,name,price) VALUES($1,$2,$3,'figure',$4,10000)",
      [productId, `FIGURE-${suffix}`.toUpperCase(), ipId, `운영 피규어 ${suffix}`],
    );
    await pool.query("INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,10,0)", [productId]);
    const order = await pool.query<{ id: string }>(`
      INSERT INTO orders(user_id,status,subtotal,total) VALUES($1,'REFUND_REVIEW',10000,10000) RETURNING id`, [user.id]);
    const orderId = order.rows[0]!.id;
    const line = await pool.query<{ id: string }>(`
      INSERT INTO order_lines(order_id,product_id,product_name_snapshot,category_snapshot,unit_price,quantity,line_total)
      VALUES($1,$2,$3,'figure',10000,1,10000) RETURNING id`, [orderId, productId, `운영 피규어 ${suffix}`]);
    const payment = await pool.query<{ id: string }>(`
      INSERT INTO payments(order_id,provider,provider_payment_id,status,amount)
      VALUES($1,'TEST_PG',$2,'REFUND_REVIEW',10000) RETURNING id`, [orderId, `provider-${suffix}`]);
    const paymentId = payment.rows[0]!.id;
    await pool.query(
      "INSERT INTO inventory_units(owner_id,product_id,source_type,source_id) VALUES($1,$2,'PURCHASE',$3)",
      [user.id, productId, line.rows[0]!.id],
    );

    const legacyStockMutation = await app.inject({
      method: "PATCH",
      url: `/v1/admin/products/${productId}`,
      headers: mutation(admin.token, "상품 수정 경로 재고 변경 차단"),
      payload: {
        sku: `FIGURE-${suffix}`.toUpperCase(), ipId, characterIds: [], category: "figure",
        name: `운영 피규어 ${suffix}`, manufacturer: null, releaseDate: null, price: 10_000,
        availableQuantity: 11, metadata: {}, imageUrl: null, isActive: true, expectedVersion: 1,
      },
    });
    assert.equal(legacyStockMutation.statusCode, 409, legacyStockMutation.body);
    const stockAfterLegacyAttempt = await pool.query<{ on_hand: number; version: number }>(
      "SELECT on_hand,version FROM product_stock WHERE product_id=$1",
      [productId],
    );
    assert.deepEqual(stockAfterLegacyAttempt.rows[0], { on_hand: 10, version: 1 });

    for (const url of [
      "/v1/admin/commerce/orders",
      `/v1/admin/commerce/orders/${orderId}`,
      "/v1/admin/commerce/payments",
      `/v1/admin/commerce/payments/${paymentId}`,
      "/v1/admin/commerce/refund-reviews",
      `/v1/admin/commerce/refund-reviews/${paymentId}`,
      "/v1/admin/commerce/inventory",
      `/v1/admin/commerce/inventory/${productId}`,
    ]) {
      const response = await app.inject({ method: "GET", url, headers: auth(admin.token) });
      assert.equal(response.statusCode, 200, `${url}: ${response.body}`);
    }

    const deniedAdjustment = await app.inject({
      method: "POST",
      url: `/v1/admin/commerce/inventory/${productId}/adjustments`,
      headers: mutation(admin.token, "일반 운영자 재고 조정 거부"),
      payload: { deltaOnHand: 1, expectedVersion: 1, reason: "일반 운영자 재고 조정 거부" },
    });
    assert.equal(deniedAdjustment.statusCode, 403, deniedAdjustment.body);

    const adjustmentKey = `stock-${randomUUID()}`;
    const adjustmentPayload = { deltaOnHand: 2, expectedVersion: 1, reason: "실물 검수 결과 재고 2개 추가" };
    const adjusted = await app.inject({
      method: "POST",
      url: `/v1/admin/commerce/inventory/${productId}/adjustments`,
      headers: mutation(superAdmin.token, adjustmentPayload.reason, adjustmentKey),
      payload: adjustmentPayload,
    });
    assert.equal(adjusted.statusCode, 200, adjusted.body);
    assert.equal((adjusted.json() as { onHand: number; version: number }).onHand, 12);
    const replayedAdjustment = await app.inject({
      method: "POST",
      url: `/v1/admin/commerce/inventory/${productId}/adjustments`,
      headers: mutation(superAdmin.token, adjustmentPayload.reason, adjustmentKey),
      payload: adjustmentPayload,
    });
    assert.equal(replayedAdjustment.statusCode, 200, replayedAdjustment.body);
    assert.equal(replayedAdjustment.headers["x-idempotent-replay"], "true");
    assert.equal((replayedAdjustment.json() as { adjustmentId: string }).adjustmentId, (adjusted.json() as { adjustmentId: string }).adjustmentId);
    const adjustmentState = await pool.query<{ on_hand: number; ledger_count: string; audit_count: string }>(`
      SELECT s.on_hand,
        (SELECT count(*) FROM product_stock_adjustment_ledger l WHERE l.product_id=s.product_id) AS ledger_count,
        (SELECT count(*) FROM admin_audit_logs a WHERE a.action='PRODUCT_STOCK_ADJUSTED' AND a.target_id=s.product_id) AS audit_count
      FROM product_stock s WHERE s.product_id=$1`, [productId]);
    assert.deepEqual(adjustmentState.rows[0], { on_hand: 12, ledger_count: "1", audit_count: "1" });
    await assert.rejects(
      pool.query("UPDATE product_stock_adjustment_ledger SET reason='rewritten' WHERE id=$1", [(adjusted.json() as { adjustmentId: string }).adjustmentId]),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "55000",
    );
    const reusedAdjustmentKey = await app.inject({
      method: "POST",
      url: `/v1/admin/commerce/inventory/${productId}/adjustments`,
      headers: mutation(superAdmin.token, "다른 내용으로 키 재사용", adjustmentKey),
      payload: { deltaOnHand: 1, expectedVersion: 2, reason: "다른 내용으로 키 재사용" },
    });
    assert.equal(reusedAdjustmentKey.statusCode, 409, reusedAdjustmentKey.body);
    await pool.query(
      "UPDATE idempotency_keys SET expires_at=now()-interval '1 second' WHERE actor_id=$1 AND scope='ADMIN_INVENTORY_ADJUST' AND idempotency_key=$2",
      [superAdmin.id, adjustmentKey],
    );
    const recycledAdjustment = await app.inject({
      method: "POST",
      url: `/v1/admin/commerce/inventory/${productId}/adjustments`,
      headers: mutation(superAdmin.token, "멱등 보존 기간 이후 새 재고 검수", adjustmentKey),
      payload: { deltaOnHand: 1, expectedVersion: 2, reason: "멱등 보존 기간 이후 새 재고 검수" },
    });
    assert.equal(recycledAdjustment.statusCode, 200, recycledAdjustment.body);
    const recycledState = await pool.query<{ on_hand: number; ledger_count: string; audit_count: string }>(`
      SELECT s.on_hand,
        (SELECT count(*) FROM product_stock_adjustment_ledger l WHERE l.product_id=s.product_id) AS ledger_count,
        (SELECT count(*) FROM admin_audit_logs a WHERE a.action='PRODUCT_STOCK_ADJUSTED' AND a.target_id=s.product_id) AS audit_count
      FROM product_stock s WHERE s.product_id=$1`, [productId]);
    assert.deepEqual(recycledState.rows[0], { on_hand: 13, ledger_count: "2", audit_count: "2" });
    await pool.query("UPDATE product_stock SET reserved=5 WHERE product_id=$1", [productId]);
    const belowReserved = await app.inject({
      method: "POST",
      url: `/v1/admin/commerce/inventory/${productId}/adjustments`,
      headers: mutation(superAdmin.token, "예약 재고 하한 검증"),
      payload: { deltaOnHand: -9, expectedVersion: 3, reason: "예약 재고 하한 검증" },
    });
    assert.equal(belowReserved.statusCode, 409, belowReserved.body);

    const drawProductId = `gacha-${suffix}`;
    const prizeProductId = `prize-${suffix}`;
    await pool.query(
      "INSERT INTO catalog_products(id,sku,ip_id,category,name,price) VALUES($1,$2,$3,'gacha',$4,3000),($5,$6,$3,'figure',$7,0)",
      [drawProductId, `GACHA-${suffix}`.toUpperCase(), ipId, `운영 가챠 ${suffix}`, prizeProductId, `PRIZE-${suffix}`.toUpperCase(), `경품 ${suffix}`],
    );
    await pool.query("INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,2,0),($2,100,0)", [drawProductId, prizeProductId]);
    const drawVersion = await pool.query<{ id: string }>(
      "INSERT INTO draw_probability_versions(product_id,version) VALUES($1,1) RETURNING id",
      [drawProductId],
    );
    await pool.query(
      "INSERT INTO draw_pool_entries(probability_version_id,prize_product_id,rarity,weight,initial_quantity,remaining_quantity) VALUES($1,$2,'A',1,3,3)",
      [drawVersion.rows[0]!.id, prizeProductId],
    );
    await pool.query(
      "UPDATE draw_probability_versions SET status='ACTIVE',published_by=$2,published_at=now() WHERE id=$1",
      [drawVersion.rows[0]!.id, superAdmin.id],
    );
    const overCapacity = await app.inject({
      method: "POST",
      url: `/v1/admin/commerce/inventory/${drawProductId}/adjustments`,
      headers: mutation(superAdmin.token, "유한 추첨 수용량 초과 검증"),
      payload: { deltaOnHand: 2, expectedVersion: 1, reason: "유한 추첨 수용량 초과 검증" },
    });
    assert.equal(overCapacity.statusCode, 409, overCapacity.body);
    const drawState = await pool.query<{ on_hand: number; ledger_count: string }>(`
      SELECT on_hand,(SELECT count(*) FROM product_stock_adjustment_ledger WHERE product_id=$1) AS ledger_count
      FROM product_stock WHERE product_id=$1`, [drawProductId]);
    assert.deepEqual(drawState.rows[0], { on_hand: 2, ledger_count: "0" });

    const reviewKey = `review-${randomUUID()}`;
    const reviewPayload = {
      status: "IN_REVIEW",
      note: "공급자 이벤트와 고객 보유 자산을 대조합니다.",
      expectedVersion: 0,
      reason: "환불 검토 담당 배정",
    };
    const reviewed = await app.inject({
      method: "POST",
      url: `/v1/admin/commerce/refund-reviews/${paymentId}`,
      headers: mutation(admin.token, reviewPayload.reason, reviewKey),
      payload: reviewPayload,
    });
    assert.equal(reviewed.statusCode, 200, reviewed.body);
    assert.equal((reviewed.json() as { providerActionExecuted: boolean }).providerActionExecuted, false);
    const replayedReview = await app.inject({
      method: "POST",
      url: `/v1/admin/commerce/refund-reviews/${paymentId}`,
      headers: mutation(admin.token, reviewPayload.reason, reviewKey),
      payload: reviewPayload,
    });
    assert.equal(replayedReview.statusCode, 200, replayedReview.body);
    assert.equal(replayedReview.headers["x-idempotent-replay"], "true");
    const refundState = await pool.query<{ payment_status: string; order_status: string; note_count: string }>(`
      SELECT p.status AS payment_status,o.status AS order_status,
        (SELECT count(*) FROM admin_commerce_review_notes n JOIN admin_commerce_reviews r ON r.id=n.review_id WHERE r.payment_id=p.id) AS note_count
      FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=$1`, [paymentId]);
    assert.deepEqual(refundState.rows[0], { payment_status: "REFUND_REVIEW", order_status: "REFUND_REVIEW", note_count: "1" });
    await assert.rejects(
      pool.query("UPDATE admin_commerce_review_notes SET note='rewritten' WHERE review_id=(SELECT id FROM admin_commerce_reviews WHERE payment_id=$1)", [paymentId]),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "55000",
    );
    const reviewRegression = await app.inject({
      method: "POST",
      url: `/v1/admin/commerce/refund-reviews/${paymentId}`,
      headers: mutation(admin.token, "검토 상태 역행 방지"),
      payload: { status: "PENDING", note: "검토 중 상태를 대기로 되돌릴 수 없습니다.", expectedVersion: 1, reason: "검토 상태 역행 방지" },
    });
    assert.equal(reviewRegression.statusCode, 409, reviewRegression.body);
    await assert.rejects(
      pool.query("UPDATE admin_commerce_reviews SET status='PENDING' WHERE payment_id=$1", [paymentId]),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "23514",
    );
    const falseClose = await app.inject({
      method: "POST",
      url: `/v1/admin/commerce/refund-reviews/${paymentId}`,
      headers: mutation(admin.token, "원장 해소 전 종료 방지"),
      payload: { status: "CLOSED", note: "아직 공급자 원장이 검토 상태입니다.", expectedVersion: 1, reason: "원장 해소 전 종료 방지" },
    });
    assert.equal(falseClose.statusCode, 409, falseClose.body);

    const shippingInventory = await pool.query<{ id: string }>(`
      INSERT INTO inventory_units(owner_id,product_id,source_type,status) VALUES($1,$2,'ADMIN_ADJUSTMENT','SHIPPING') RETURNING id`, [user.id, productId]);
    const shipping = await pool.query<{ id: string }>(`
      INSERT INTO shipping_requests(user_id,address_snapshot) VALUES($1,$2) RETURNING id`, [user.id, JSON.stringify({
        recipient: "김다뽀", phone: "010-1234-5678", postalCode: "06236",
        addressLine1: "서울특별시 강남구 테헤란로 1", addressLine2: "101호", deliveryNote: "문 앞",
      })]);
    const shippingRequestId = shipping.rows[0]!.id;
    await pool.query("INSERT INTO shipping_request_items(shipping_request_id,inventory_unit_id) VALUES($1,$2)", [shippingRequestId, shippingInventory.rows[0]!.id]);
    const shippingList = await app.inject({ method: "GET", url: "/v1/admin/commerce/shipping", headers: auth(admin.token) });
    assert.equal(shippingList.statusCode, 200, shippingList.body);
    const shippingListBody = shippingList.json() as { items: Array<Record<string, unknown>> };
    assert.equal(shippingListBody.items[0]?.destination, undefined);
    assert.doesNotMatch(shippingList.body, /010-1234-5678|테헤란로 1|101호|문 앞/);
    const shippingDetail = await app.inject({ method: "GET", url: `/v1/admin/commerce/shipping/${shippingRequestId}`, headers: auth(admin.token) });
    assert.equal(shippingDetail.statusCode, 200, shippingDetail.body);
    assert.equal((shippingDetail.json() as { destination: { phone: string } }).destination.phone, "010-1234-5678");
    const advance = async (
      payload: Record<string, unknown>,
      reason: string,
      key = `shipping-${randomUUID()}`,
      token = admin.token,
      requestId = shippingRequestId,
    ) => app.inject({
      method: "POST",
      url: `/v1/admin/commerce/shipping/${requestId}/status`,
      headers: mutation(token, reason, key),
      payload: { ...payload, reason },
    });
    const processingKey = adjustmentKey;
    const processing = await advance({ status: "PROCESSING", expectedVersion: 1 }, "포장 작업 시작", processingKey, superAdmin.token);
    assert.equal(processing.statusCode, 200, processing.body);
    const processingReplay = await advance({ status: "PROCESSING", expectedVersion: 1 }, "포장 작업 시작", processingKey, superAdmin.token);
    assert.equal(processingReplay.statusCode, 200, processingReplay.body);
    assert.equal(processingReplay.headers["x-idempotent-replay"], "true");
    const skippedState = await advance({ status: "DELIVERED", expectedVersion: 2 }, "배송 단계 건너뛰기 방지");
    assert.equal(skippedState.statusCode, 409, skippedState.body);
    const shipped = await advance({ status: "SHIPPED", expectedVersion: 2, trackingCarrier: "CJ대한통운", trackingNumber: `TRACK-${suffix}` }, "택배사 인계 완료");
    assert.equal(shipped.statusCode, 200, shipped.body);
    const lateCancel = await advance({ status: "CANCELLED", expectedVersion: 3 }, "출고 후 취소 방지");
    assert.equal(lateCancel.statusCode, 409, lateCancel.body);
    const deliveredKey = `shipping-delivered-${randomUUID()}`;
    const delivered = await advance({ status: "DELIVERED", expectedVersion: 3 }, "배송 완료 확인", deliveredKey);
    assert.equal(delivered.statusCode, 200, delivered.body);
    const deliveredReplay = await advance({ status: "DELIVERED", expectedVersion: 3 }, "배송 완료 확인", deliveredKey);
    assert.equal(deliveredReplay.statusCode, 200, deliveredReplay.body);
    assert.equal(deliveredReplay.headers["x-idempotent-replay"], "true");
    assert.deepEqual(deliveredReplay.json(), delivered.json());
    const shippingState = await pool.query<{
      status: string; version: number; inventory_status: string; event_count: string; audit_count: string; outbox_count: string;
    }>(`
      SELECT s.status,s.version,u.status AS inventory_status,
        (SELECT count(*) FROM shipping_status_events e WHERE e.shipping_request_id=s.id) AS event_count,
        (SELECT count(*) FROM admin_audit_logs a WHERE a.action='SHIPPING_STATUS_CHANGED' AND a.target_id=s.id::text) AS audit_count,
        (SELECT count(*) FROM outbox_events o WHERE o.aggregate_type='SHIPPING_REQUEST' AND o.aggregate_id=s.id::text) AS outbox_count
      FROM shipping_requests s JOIN shipping_request_items i ON i.shipping_request_id=s.id
      JOIN inventory_units u ON u.id=i.inventory_unit_id WHERE s.id=$1`, [shippingRequestId]);
    assert.deepEqual(shippingState.rows[0], {
      status: "DELIVERED", version: 4, inventory_status: "DELIVERED", event_count: "3", audit_count: "3", outbox_count: "3",
    });
    await assert.rejects(
      pool.query("UPDATE shipping_status_events SET reason='rewritten' WHERE id=$1", [(delivered.json() as { eventId: string }).eventId]),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "55000",
    );

    const cancelledInventory = await pool.query<{ id: string }>(`
      INSERT INTO inventory_units(owner_id,product_id,source_type,status) VALUES($1,$2,'ADMIN_ADJUSTMENT','SHIPPING') RETURNING id`, [user.id, productId]);
    const cancelledRequest = await pool.query<{ id: string }>(`
      INSERT INTO shipping_requests(user_id,address_snapshot) VALUES($1,$2) RETURNING id`, [user.id, JSON.stringify({
        recipient: "김취소", phone: "010-9876-5432", postalCode: "06236",
        addressLine1: "서울특별시 강남구 테헤란로 2", addressLine2: "202호", deliveryNote: "",
      })]);
    await pool.query("INSERT INTO shipping_request_items(shipping_request_id,inventory_unit_id) VALUES($1,$2)", [cancelledRequest.rows[0]!.id, cancelledInventory.rows[0]!.id]);
    const cancelledReason = "고객 요청에 따른 출고 전 취소";
    const cancelledKey = `shipping-cancelled-${randomUUID()}`;
    const cancelled = await app.inject({
      method: "POST",
      url: `/v1/admin/commerce/shipping/${cancelledRequest.rows[0]!.id}/status`,
      headers: mutation(admin.token, cancelledReason, cancelledKey),
      payload: { status: "CANCELLED", expectedVersion: 1, reason: cancelledReason },
    });
    assert.equal(cancelled.statusCode, 200, cancelled.body);
    const cancelledReplay = await app.inject({
      method: "POST",
      url: `/v1/admin/commerce/shipping/${cancelledRequest.rows[0]!.id}/status`,
      headers: mutation(admin.token, cancelledReason, cancelledKey),
      payload: { status: "CANCELLED", expectedVersion: 1, reason: cancelledReason },
    });
    assert.equal(cancelledReplay.statusCode, 200, cancelledReplay.body);
    assert.equal(cancelledReplay.headers["x-idempotent-replay"], "true");
    const cancelledState = await pool.query<{
      request_status: string; inventory_status: string; event_count: string; audit_count: string; outbox_count: string;
    }>(`
      SELECT s.status AS request_status,u.status AS inventory_status,
        (SELECT count(*) FROM shipping_status_events e WHERE e.shipping_request_id=s.id) AS event_count,
        (SELECT count(*) FROM admin_audit_logs a WHERE a.action='SHIPPING_STATUS_CHANGED' AND a.target_id=s.id::text) AS audit_count,
        (SELECT count(*) FROM outbox_events o WHERE o.aggregate_type='SHIPPING_REQUEST' AND o.aggregate_id=s.id::text) AS outbox_count
      FROM shipping_requests s JOIN shipping_request_items i ON i.shipping_request_id=s.id
      JOIN inventory_units u ON u.id=i.inventory_unit_id WHERE s.id=$1`, [cancelledRequest.rows[0]!.id]);
    assert.deepEqual(cancelledState.rows[0], {
      request_status: "CANCELLED", inventory_status: "OWNED", event_count: "1", audit_count: "1", outbox_count: "1",
    });

    const inconsistentInventory = await pool.query<{ id: string }>(`
      INSERT INTO inventory_units(owner_id,product_id,source_type,status)
      VALUES($1,$2,'ADMIN_ADJUSTMENT','OWNED') RETURNING id`, [user.id, productId]);
    const inconsistentRequest = await pool.query<{ id: string }>(`
      INSERT INTO shipping_requests(user_id,address_snapshot) VALUES($1,$2) RETURNING id`, [user.id, JSON.stringify({
        recipient: "김불일치", phone: "010-1111-2222", postalCode: "06236",
        addressLine1: "서울특별시 강남구 검증로 3", addressLine2: "303호", deliveryNote: "",
      })]);
    await pool.query(
      "INSERT INTO shipping_request_items(shipping_request_id,inventory_unit_id) VALUES($1,$2)",
      [inconsistentRequest.rows[0]!.id, inconsistentInventory.rows[0]!.id],
    );
    const inconsistentTransition = await advance(
      { status: "CANCELLED", expectedVersion: 1 },
      "배송 상품 상태 불일치 시 전체 전이 거부",
      `shipping-inconsistent-${randomUUID()}`,
      admin.token,
      inconsistentRequest.rows[0]!.id,
    );
    assert.equal(inconsistentTransition.statusCode, 409, inconsistentTransition.body);
    const inconsistentState = await pool.query<{
      request_status: string; inventory_status: string; event_count: string; audit_count: string; outbox_count: string;
    }>(`
      SELECT s.status AS request_status,u.status AS inventory_status,
        (SELECT count(*) FROM shipping_status_events e WHERE e.shipping_request_id=s.id) AS event_count,
        (SELECT count(*) FROM admin_audit_logs a WHERE a.action='SHIPPING_STATUS_CHANGED' AND a.target_id=s.id::text) AS audit_count,
        (SELECT count(*) FROM outbox_events o WHERE o.aggregate_type='SHIPPING_REQUEST' AND o.aggregate_id=s.id::text) AS outbox_count
      FROM shipping_requests s JOIN shipping_request_items i ON i.shipping_request_id=s.id
      JOIN inventory_units u ON u.id=i.inventory_unit_id WHERE s.id=$1`, [inconsistentRequest.rows[0]!.id]);
    assert.deepEqual(inconsistentState.rows[0], {
      request_status: "REQUESTED", inventory_status: "OWNED", event_count: "0", audit_count: "0", outbox_count: "0",
    });

    const deletionCandidate = await createActor("USER", "delivered-owner");
    const deliveredInventory = await pool.query<{ id: string }>(`
      INSERT INTO inventory_units(owner_id,product_id,source_type,status)
      VALUES($1,$2,'ADMIN_ADJUSTMENT','SHIPPING') RETURNING id`, [deletionCandidate.id, productId]);
    const deliveredRequest = await pool.query<{ id: string }>(`
      INSERT INTO shipping_requests(user_id,address_snapshot) VALUES($1,$2) RETURNING id`, [deletionCandidate.id, JSON.stringify({
        recipient: "김완료", phone: "010-3333-4444", postalCode: "06236",
        addressLine1: "서울특별시 강남구 완료로 4", addressLine2: "404호", deliveryNote: "",
      })]);
    await pool.query(
      "INSERT INTO shipping_request_items(shipping_request_id,inventory_unit_id) VALUES($1,$2)",
      [deliveredRequest.rows[0]!.id, deliveredInventory.rows[0]!.id],
    );
    const deliveredCandidateId = deliveredRequest.rows[0]!.id;
    const candidateProcessing = await advance(
      { status: "PROCESSING", expectedVersion: 1 },
      "탈퇴 blocker 배송 포장 시작",
      `shipping-deletion-processing-${randomUUID()}`,
      admin.token,
      deliveredCandidateId,
    );
    assert.equal(candidateProcessing.statusCode, 200, candidateProcessing.body);
    const candidateShipped = await advance(
      { status: "SHIPPED", expectedVersion: 2, trackingCarrier: "우체국택배", trackingNumber: `DELETE-${suffix}` },
      "탈퇴 blocker 배송 출고 완료",
      `shipping-deletion-shipped-${randomUUID()}`,
      admin.token,
      deliveredCandidateId,
    );
    assert.equal(candidateShipped.statusCode, 200, candidateShipped.body);
    const candidateDelivered = await advance(
      { status: "DELIVERED", expectedVersion: 3 },
      "탈퇴 blocker 배송 완료 확정",
      `shipping-deletion-delivered-${randomUUID()}`,
      admin.token,
      deliveredCandidateId,
    );
    assert.equal(candidateDelivered.statusCode, 200, candidateDelivered.body);
    const deletionRequested = await app.inject({
      method: "POST",
      url: "/v1/account/deletion-request",
      headers: {
        ...auth(deletionCandidate.token),
        "idempotency-key": `delivered-deletion-${randomUUID()}`,
      },
      payload: {},
    });
    assert.equal(deletionRequested.statusCode, 202, deletionRequested.body);
    const deletionBody = deletionRequested.json() as {
      status: string;
      blockers: { activeInventoryCount: number; activeShippingRequestCount: number };
    };
    assert.deepEqual(
      {
        status: deletionBody.status,
        activeInventoryCount: deletionBody.blockers.activeInventoryCount,
        activeShippingRequestCount: deletionBody.blockers.activeShippingRequestCount,
      },
      { status: "PENDING_REVIEW", activeInventoryCount: 0, activeShippingRequestCount: 0 },
    );
  },
);
