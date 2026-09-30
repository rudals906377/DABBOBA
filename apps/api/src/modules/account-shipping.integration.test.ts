import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import { buildApp } from "../app.js";
import { acceptRequiredPoliciesForIntegrationTest } from "../integration-test-fixtures.js";
import { issueSession } from "../plugins/auth.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;

test(
  "customer shipping reads are owner-scoped, cursor-paged, snapshot-safe, and reflect durable fulfillment state",
  { skip: !databaseUrl, timeout: 60_000 },
  async (t) => {
    const pool = createDatabasePool(databaseUrl!, "dabboba-account-shipping-integration");
    const config: ApiConfig = {
      environment: "test",
      host: "127.0.0.1",
      port: 8788,
      databaseUrl: databaseUrl!,
      redisUrl: "redis://127.0.0.1:6379",
      webOrigins: ["http://127.0.0.1:4174"],
      adminOrigins: ["http://127.0.0.1:4180"],
      sessionTokenPepper: "account-shipping-integration-session-pepper",
      adminProxyIdentitySecret: null,
      sessionTtlDays: 1,
      paymentProvider: "UNCONFIGURED",
      paymentWebhookSecret: null,
      gcsBucket: null,
      gcsProjectId: null,
      logLevel: "silent",
    };
    let { app } = await buildApp({ config, pool, redis: null });
    t.after(async () => {
      await app.close();
      await pool.end();
    });

    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const createActor = async (role: "USER" | "ADMIN", label: string) => {
      const created = await pool.query<{ id: string }>(
        "INSERT INTO users(email,nickname,role,status) VALUES($1,$2,$3,'ACTIVE') RETURNING id",
        [`${label}-${suffix}@example.test`, `${label} ${suffix}`, role],
      );
      if (role === "USER") {
        await acceptRequiredPoliciesForIntegrationTest(pool, created.rows[0]!.id);
      }
      const session = await issueSession(pool, config, {
        userId: created.rows[0]!.id,
        kind: role === "USER" ? "USER" : "ADMIN",
        ip: "203.0.113.77",
        userAgent: "Dabboba Account Shipping Integration/1.0",
      });
      return { id: created.rows[0]!.id, token: session.token };
    };
    const owner = await createActor("USER", "shipping-owner");
    const stranger = await createActor("USER", "shipping-stranger");
    const admin = await createActor("ADMIN", "shipping-admin");
    const auth = (token: string) => ({ authorization: `Bearer ${token}` });
    const mutation = (reason: string) => ({
      authorization: `Bearer ${admin.token}`,
      "x-admin-reason": reason,
      "idempotency-key": `shipping-admin-${randomUUID()}`,
    });

    const ipId = `account-shipping-${suffix}`;
    const productId = `shipping-gacha-${suffix}`;
    await pool.query(
      "INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$4)",
      [ipId, ipId, `배송 조회 IP ${suffix}`, `Shipping Read ${suffix}`],
    );
    await pool.query(
      "INSERT INTO catalog_products(id,sku,ip_id,category,name,price) VALUES($1,$2,$3,'gacha',$4,24900)",
      [productId, `SHIP-${suffix}`.toUpperCase(), ipId, `배송 조회 가챠 ${suffix}`],
    );
    await pool.query(
      `INSERT INTO default_shipping_addresses(
        user_id,recipient,phone,postal_code,address_line1,address_line2,delivery_note
      ) VALUES($1,'김영민','01012345678','06236','서울특별시 강남구 테헤란로 1','101호','문 앞')`,
      [owner.id],
    );

    const createShippingRequest = async (inventoryUnitId: string) => {
      const quoteResponse = await app.inject({
        method: "POST",
        url: "/v1/account/shipping-quotes",
        headers: auth(owner.token),
        payload: { inventoryUnitIds: [inventoryUnitId] },
      });
      assert.equal(quoteResponse.statusCode, 200, quoteResponse.body);
      const quote = quoteResponse.json() as {
        id: string;
        addressVersion: number;
        createdAt: string;
        expiresAt: string;
        referenceSubtotal: number;
        freeShippingThreshold: number;
        shippingFee: number;
      };
      assert.equal(Date.parse(quote.expiresAt) - Date.parse(quote.createdAt), 10 * 60_000);
      assert.equal(quote.referenceSubtotal, 24_900);
      assert.equal(quote.freeShippingThreshold, 24_900);
      assert.equal(quote.shippingFee, 0);
      return app.inject({
        method: "POST",
        url: "/v1/account/shipping-requests",
        headers: {
          ...auth(owner.token),
          "idempotency-key": `shipping-create-${randomUUID()}`,
        },
        payload: { quoteId: quote.id, addressVersion: quote.addressVersion },
      });
    };

    const firstInventory = await pool.query<{ id: string }>(
      "INSERT INTO inventory_units(owner_id,product_id,source_type,status) VALUES($1,$2,'GACHA','OWNED') RETURNING id",
      [owner.id, productId],
    );
    const firstCreated = await createShippingRequest(firstInventory.rows[0]!.id);
    assert.equal(firstCreated.statusCode, 201, firstCreated.body);
    const firstRequest = firstCreated.json() as { id: string; requestedAt: string };

    const beforeTransition = await app.inject({
      method: "GET",
      url: `/v1/account/shipping-requests/${firstRequest.id}`,
      headers: auth(owner.token),
    });
    assert.equal(beforeTransition.statusCode, 200, beforeTransition.body);
    assert.equal((beforeTransition.json() as { status: string; version: number }).status, "REQUESTED");
    assert.equal((beforeTransition.json() as { status: string; version: number }).version, 1);

    const secondInventory = await pool.query<{ id: string }>(
      "INSERT INTO inventory_units(owner_id,product_id,source_type,status) VALUES($1,$2,'GACHA','OWNED') RETURNING id",
      [owner.id, productId],
    );
    const secondCreated = await createShippingRequest(secondInventory.rows[0]!.id);
    assert.equal(secondCreated.statusCode, 201, secondCreated.body);
    const secondRequest = secondCreated.json() as { id: string };
    await pool.query(
      `UPDATE shipping_requests SET requested_at=CASE id
        WHEN $1 THEN '2026-08-25T01:00:00.000Z'::timestamptz
        WHEN $2 THEN '2026-08-25T02:00:00.000Z'::timestamptz END
       WHERE id=ANY($3::uuid[])`,
      [firstRequest.id, secondRequest.id, [firstRequest.id, secondRequest.id]],
    );

    const addressChanged = await app.inject({
      method: "PUT",
      url: "/v1/account/default-address",
      headers: {
        ...auth(owner.token),
        "idempotency-key": `address-change-${randomUUID()}`,
      },
      payload: {
        recipient: "이변경",
        phone: "010-9999-0000",
        postalCode: "04524",
        addressLine1: "서울특별시 중구 변경로 2",
        addressLine2: "202호",
        deliveryNote: "경비실",
        expectedVersion: 1,
      },
    });
    assert.equal(addressChanged.statusCode, 200, addressChanged.body);

    await pool.query(
      "UPDATE catalog_ips SET name_ko=$2 WHERE id=$1",
      [ipId, `변경된 배송 조회 IP ${suffix}`],
    );
    await pool.query(
      "UPDATE catalog_products SET name=$2,image_url=$3,version=version+1 WHERE id=$1",
      [productId, `변경된 배송 조회 가챠 ${suffix}`, "https://example.test/changed-product.webp"],
    );

    const processingReason = "고객 배송 조회 상태 반영 검증 포장 시작";
    const processing = await app.inject({
      method: "POST",
      url: `/v1/admin/commerce/shipping/${firstRequest.id}/status`,
      headers: mutation(processingReason),
      payload: { status: "PROCESSING", expectedVersion: 1, reason: processingReason },
    });
    assert.equal(processing.statusCode, 200, processing.body);
    const shippedReason = "고객 배송 조회 상태 반영 검증 출고 완료";
    const shipped = await app.inject({
      method: "POST",
      url: `/v1/admin/commerce/shipping/${firstRequest.id}/status`,
      headers: mutation(shippedReason),
      payload: {
        status: "SHIPPED",
        expectedVersion: 2,
        reason: shippedReason,
        trackingCarrier: "CJ대한통운",
        trackingNumber: `TRACK-${suffix}`,
      },
    });
    assert.equal(shipped.statusCode, 200, shipped.body);

    await app.close();
    ({ app } = await buildApp({ config, pool, redis: null }));

    const detail = await app.inject({
      method: "GET",
      url: `/v1/account/shipping-requests/${firstRequest.id}`,
      headers: auth(owner.token),
    });
    assert.equal(detail.statusCode, 200, detail.body);
    const stored = await pool.query<{
      requested_at: Date;
      updated_at: Date;
      shipped_at: Date;
    }>(
      "SELECT requested_at,updated_at,shipped_at FROM shipping_requests WHERE id=$1",
      [firstRequest.id],
    );
    assert.deepEqual(detail.json(), {
      id: firstRequest.id,
      status: "SHIPPED",
      version: 3,
      inventoryUnitIds: [firstInventory.rows[0]!.id],
      destination: {
        recipientMasked: "김*민",
        phoneMasked: "*******5678",
        postalCode: "06236",
        addressLine1: "서울특별시 강남구 테헤란로 1",
        addressLine2: "101호",
      },
      requestedAt: stored.rows[0]!.requested_at.toISOString(),
      updatedAt: stored.rows[0]!.updated_at.toISOString(),
      shippedAt: stored.rows[0]!.shipped_at.toISOString(),
      trackingCarrier: "CJ대한통운",
      trackingNumber: `TRACK-${suffix}`,
      items: [{
        inventoryUnitId: firstInventory.rows[0]!.id,
        productId,
        productName: `배송 조회 가챠 ${suffix}`,
        ipId,
        ipNameKo: `배송 조회 IP ${suffix}`,
        category: "gacha",
        imageUrl: null,
        productVersion: 1,
      }],
    });
    assert.doesNotMatch(detail.body, /김영민|01012345678|문 앞|이변경|01099990000|변경로 2/);
    assert.doesNotMatch(detail.body, /변경된 배송 조회|changed-product/);

    // A request snapshot taken before the media-host cutover keeps its stored
    // URL (snapshots are immutable), but the response translates the legacy host.
    const legacyOwner = await createActor("USER", "shipping-legacy-media");
    const legacyMediaId = randomUUID();
    const currentMediaBase = "https://rconfxsykttfvznakile.supabase.co/functions/v1/dabboba-api";
    const legacyImageUrl = `https://yxkmvgfruphgghowzvmo.supabase.co/functions/v1/dabboba-api/v1/catalog/media/${legacyMediaId}/image`;
    const legacyProductId = `shipping-legacy-media-${suffix}`;
    await pool.query(
      "INSERT INTO catalog_products(id,sku,ip_id,category,name,price,image_url) VALUES($1,$2,$3,'gacha',$4,10000,$5)",
      [legacyProductId, `SHIP-LEGACY-${suffix}`.toUpperCase(), ipId, `배송 이전 이미지 ${suffix}`, legacyImageUrl],
    );
    const legacyInventory = await pool.query<{ id: string }>(
      "INSERT INTO inventory_units(owner_id,product_id,source_type,status) VALUES($1,$2,'GACHA','OWNED') RETURNING id",
      [legacyOwner.id, legacyProductId],
    );
    const legacyRequest = await pool.query<{ id: string }>(
      `INSERT INTO shipping_requests(user_id,status,address_snapshot,reference_subtotal,free_shipping_threshold,
         qualifies_for_free_shipping,contains_kuji,shipping_fee)
       VALUES($1,'PAYMENT_PENDING','{}'::jsonb,10000,24900,false,false,3000) RETURNING id`,
      [legacyOwner.id],
    );
    await pool.query(
      `INSERT INTO shipping_request_items(shipping_request_id,inventory_unit_id,product_snapshot)
       SELECT $1,$2,jsonb_build_object('productId',p.id,'productName',p.name,'ipId',p.ip_id,
         'ipNameKo',ip.name_ko,'category',p.category,'imageUrl',p.image_url,'productVersion',p.version)
       FROM catalog_products p JOIN catalog_ips ip ON ip.id=p.ip_id WHERE p.id=$3`,
      [legacyRequest.rows[0]!.id, legacyInventory.rows[0]!.id, legacyProductId],
    );
    const mediaApp = (await buildApp({ config: { ...config, catalogMediaBaseUrl: currentMediaBase }, pool, redis: null })).app;
    try {
      const rebased = await mediaApp.inject({
        method: "GET",
        url: `/v1/account/shipping-requests/${legacyRequest.rows[0]!.id}`,
        headers: auth(legacyOwner.token),
      });
      assert.equal(rebased.statusCode, 200, rebased.body);
      assert.equal(
        (rebased.json() as { items: Array<{ imageUrl: string | null }> }).items[0]!.imageUrl,
        `${currentMediaBase}/v1/catalog/media/${legacyMediaId}/image`,
      );
    } finally {
      await mediaApp.close();
    }

    const firstPage = await app.inject({
      method: "GET",
      url: "/v1/account/shipping-requests?limit=1",
      headers: auth(owner.token),
    });
    assert.equal(firstPage.statusCode, 200, firstPage.body);
    const firstPageBody = firstPage.json() as {
      items: Array<{ id: string }>;
      nextCursor: string | null;
    };
    assert.deepEqual(firstPageBody.items.map((item) => item.id), [secondRequest.id]);
    assert.ok(firstPageBody.nextCursor);
    const nextPage = await app.inject({
      method: "GET",
      url: `/v1/account/shipping-requests?limit=1&cursor=${encodeURIComponent(firstPageBody.nextCursor!)}`,
      headers: auth(owner.token),
    });
    assert.equal(nextPage.statusCode, 200, nextPage.body);
    assert.deepEqual(
      (nextPage.json() as { items: Array<{ id: string }> }).items.map((item) => item.id),
      [firstRequest.id],
    );

    const shippedOnly = await app.inject({
      method: "GET",
      url: "/v1/account/shipping-requests?status=SHIPPED",
      headers: auth(owner.token),
    });
    assert.equal(shippedOnly.statusCode, 200, shippedOnly.body);
    assert.deepEqual(
      (shippedOnly.json() as { items: Array<{ id: string; status: string }> }).items
        .map((item) => ({ id: item.id, status: item.status })),
      [{ id: firstRequest.id, status: "SHIPPED" }],
    );
    const invalidStatus = await app.inject({
      method: "GET",
      url: "/v1/account/shipping-requests?status=UNKNOWN",
      headers: auth(owner.token),
    });
    assert.equal(invalidStatus.statusCode, 400, invalidStatus.body);

    const hiddenDetail = await app.inject({
      method: "GET",
      url: `/v1/account/shipping-requests/${firstRequest.id}`,
      headers: auth(stranger.token),
    });
    assert.equal(hiddenDetail.statusCode, 404, hiddenDetail.body);
    const strangerList = await app.inject({
      method: "GET",
      url: "/v1/account/shipping-requests",
      headers: auth(stranger.token),
    });
    assert.equal(strangerList.statusCode, 200, strangerList.body);
    assert.deepEqual(strangerList.json(), { items: [], nextCursor: null });
  },
);
