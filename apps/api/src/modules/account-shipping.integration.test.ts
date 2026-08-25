import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import { buildApp } from "../app.js";
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
    const productId = `shipping-figure-${suffix}`;
    await pool.query(
      "INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$4)",
      [ipId, ipId, `배송 조회 IP ${suffix}`, `Shipping Read ${suffix}`],
    );
    await pool.query(
      "INSERT INTO catalog_products(id,sku,ip_id,category,name,price) VALUES($1,$2,$3,'figure',$4,15000)",
      [productId, `SHIP-${suffix}`.toUpperCase(), ipId, `배송 조회 피규어 ${suffix}`],
    );
    await pool.query(
      `INSERT INTO default_shipping_addresses(
        user_id,recipient,phone,postal_code,address_line1,address_line2,delivery_note
      ) VALUES($1,'김영민','01012345678','06236','서울특별시 강남구 테헤란로 1','101호','문 앞')`,
      [owner.id],
    );

    const firstInventory = await pool.query<{ id: string }>(
      "INSERT INTO inventory_units(owner_id,product_id,source_type,status) VALUES($1,$2,'ADMIN_ADJUSTMENT','OWNED') RETURNING id",
      [owner.id, productId],
    );
    const firstCreated = await app.inject({
      method: "POST",
      url: "/v1/account/shipping-requests",
      headers: {
        ...auth(owner.token),
        "idempotency-key": `shipping-create-${randomUUID()}`,
      },
      payload: { inventoryUnitIds: [firstInventory.rows[0]!.id] },
    });
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
      "INSERT INTO inventory_units(owner_id,product_id,source_type,status) VALUES($1,$2,'ADMIN_ADJUSTMENT','OWNED') RETURNING id",
      [owner.id, productId],
    );
    const secondCreated = await app.inject({
      method: "POST",
      url: "/v1/account/shipping-requests",
      headers: {
        ...auth(owner.token),
        "idempotency-key": `shipping-create-${randomUUID()}`,
      },
      payload: { inventoryUnitIds: [secondInventory.rows[0]!.id] },
    });
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
    });
    assert.doesNotMatch(detail.body, /김영민|01012345678|문 앞|이변경|01099990000|변경로 2/);

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
