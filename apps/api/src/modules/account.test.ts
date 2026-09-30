import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import type { ApiContext } from "../types.js";
import { AppError } from "../lib/errors.js";
import {
  GACHA_ONLY_FREE_SHIPPING_THRESHOLD,
  KUJI_INCLUDED_FREE_SHIPPING_THRESHOLD,
  STANDARD_SHIPPING_FEE,
  accountNotificationDestination,
  publicNotificationData,
  accountDeletionStatus,
  calculateAccountShippingPolicy,
  canonicalPointReturnInventoryIds,
  canonicalShippingInventoryIds,
  isExpoPushToken,
  isPointReturnEligibleInventory,
  MAX_POINT_BALANCE,
  maskAccountPhone,
  maskShippingPhone,
  maskShippingRecipient,
  normalizeBirthDate,
  normalizeShippingPhone,
  pointReturnAmount,
  pointReturnTotalAmount,
  registerAccountRoutes,
} from "./account.js";

type RouteHandler = (request: Record<string, unknown>, reply: Record<string, unknown>) => Promise<unknown>;

function routeCapture() {
  const routes = new Map<string, RouteHandler>();
  const register = (...args: unknown[]) => {
    const path = args[0];
    const handler = args.at(-1);
    if (typeof path !== "string" || typeof handler !== "function") throw new Error("Invalid test route registration.");
    routes.set(path, handler as RouteHandler);
  };
  return {
    app: { get: register, post: register, put: register, patch: register, delete: register } as unknown as FastifyInstance,
    routes,
  };
}

function testContext(pool: unknown): ApiContext {
  return {
    pool,
    redis: null,
    config: {
      environment: "test",
      host: "127.0.0.1",
      port: 8788,
      databaseUrl: "postgres://unused",
      redisUrl: "redis://unused",
      webOrigins: [],
      adminOrigins: [],
      sessionTokenPepper: "test-session-pepper-test-session-pepper",
      sessionTtlDays: 1,
      paymentProvider: "TEST_PG",
      paymentWebhookSecret: "test-webhook-secret",
      gcsBucket: null,
      gcsProjectId: null,
      logLevel: "silent",
    },
    auth: {
      loadActor: async () => { throw new Error("unused"); },
      requireUser: async () => undefined,
      requireAdmin: async () => undefined,
      requireSuperAdmin: async () => undefined,
      requirePermission: () => async () => undefined,
    },
  } as unknown as ApiContext;
}

test("shipping inventory ids are UUID-validated, unique, and deterministically ordered", () => {
  const first = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const second = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(canonicalShippingInventoryIds([first, second]), [second, first]);
  assert.throws(
    () => canonicalShippingInventoryIds([first, first]),
    (error: unknown) => error instanceof AppError && error.statusCode === 400,
  );
  assert.throws(
    () => canonicalShippingInventoryIds([first, first.toUpperCase()]),
    (error: unknown) => error instanceof AppError && error.statusCode === 400,
  );
  assert.throws(
    () => canonicalShippingInventoryIds([]),
    (error: unknown) => error instanceof AppError && error.statusCode === 400,
  );
});

test("notification destinations are finite, kind-owned, and never accept stored routes", () => {
  const orderId = "11111111-1111-4111-8111-111111111111";
  const shippingId = "22222222-2222-4222-8222-222222222222";
  const listingId = "33333333-3333-4333-8333-333333333333";

  assert.deepEqual(accountNotificationDestination("ORDER_PAID", { orderId }), {
    route: "profile",
    detail: { kind: "order", id: orderId },
  });
  assert.deepEqual(accountNotificationDestination("SHIPPING_SHIPPED", { shippingRequestId: shippingId }), {
    route: "profile",
    detail: { kind: "shipping", id: shippingId },
  });
  assert.deepEqual(accountNotificationDestination("EXCHANGE_OFFER_CREATED", { listingId }), {
    route: "storage",
    detail: { kind: "exchange", id: listingId },
  });
  assert.deepEqual(accountNotificationDestination("STORAGE_EXPIRY_REMINDER", {
    inventoryUnitId: orderId,
    route: "/admin",
  }), {
    route: "storage",
    detail: null,
  });
  assert.deepEqual(accountNotificationDestination("RESTOCK_AVAILABLE", {
    productId: "safe-kuji-product",
    category: "KUJI",
  }), {
    route: "kuji",
    detail: { kind: "product", id: "safe-kuji-product" },
  });
  assert.deepEqual(accountNotificationDestination("CATALOG_REQUEST_APPROVED", {
    aggregateId: shippingId,
  }), {
    route: "profile",
    detail: { kind: "request", id: shippingId },
  });
  assert.deepEqual(accountNotificationDestination("ORDER_PAID", {
    orderId: "../../admin",
    href: "https://attacker.example/steal",
    route: "/admin",
  }), {
    route: "profile",
    detail: null,
  });
  assert.deepEqual(accountNotificationDestination("UNKNOWN_KIND", {
    href: "https://attacker.example/steal",
  }), {
    route: "home",
    detail: null,
  });
});

test("notification data returned to clients is limited to validated destination identifiers", () => {
  const orderId = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(publicNotificationData({
    orderId,
    productId: "safe-kuji-product",
    category: "KUJI",
    userId: "22222222-2222-4222-8222-222222222222",
    amount: 12_000,
    reason: "internal operator note",
    providerPaymentId: "pay_secret",
    href: "https://attacker.example/steal",
    listingId: "../../admin",
  }), { orderId, productId: "safe-kuji-product", category: "KUJI" });
  assert.deepEqual(publicNotificationData({}), {});
});

test("Expo push tokens accept only bounded canonical Expo token forms", () => {
  assert.equal(isExpoPushToken("ExpoPushToken[abcdefgh_ABCDEFGH-12345678]"), true);
  assert.equal(isExpoPushToken("ExponentPushToken[abcdefgh_ABCDEFGH-12345678]"), true);
  assert.equal(isExpoPushToken("ExpoPushToken[short]"), false);
  assert.equal(isExpoPushToken("ExpoPushToken[abcdefgh 1234567890]"), false);
  assert.equal(isExpoPushToken("https://attacker.example/token"), false);
});

test("push device registration rotates ownership, binds the current session, and never returns the token", async () => {
  const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const sessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const installationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const expoPushToken = "ExpoPushToken[abcdefgh_ABCDEFGH-12345678]";
  const registeredAt = new Date("2026-09-20T12:00:00.000Z");
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const client = {
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, ...(params ? { params } : {}) });
      if (sql.includes("RETURNING installation_id")) {
        return {
          rowCount: 1,
          rows: [{
            installation_id: installationId,
            platform: "IOS",
            app_version: "1.0.0",
            last_registered_at: registeredAt,
          }],
        };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  const pool = {
    async connect() { return client; },
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, ...(params ? { params } : {}) });
      return { rowCount: 1, rows: [] };
    },
  };
  const { app, routes } = routeCapture();
  await registerAccountRoutes(app, testContext(pool));

  const registered = await routes.get("/v1/account/push-devices")!({
    actor: { userId: actorId, sessionId },
    body: { installationId, expoPushToken, platform: "IOS", appVersion: "1.0.0" },
  }, {}) as Record<string, unknown>;
  assert.deepEqual(registered, {
    installationId,
    platform: "IOS",
    appVersion: "1.0.0",
    registeredAt: registeredAt.toISOString(),
  });
  assert.equal("expoPushToken" in registered, false);
  assert.match(queries.find(({ sql }) => sql.includes("pg_advisory_xact_lock"))?.sql ?? "", /ORDER BY lock_key/);
  assert.match(queries.find(({ sql }) => sql.includes("OWNERSHIP_ROTATED"))?.sql ?? "", /installation_id=\$1 OR expo_push_token=\$2/);
  assert.deepEqual(
    queries.find(({ sql }) => sql.includes("INSERT INTO push_device_tokens"))?.params,
    [actorId, sessionId, installationId, expoPushToken, "IOS", "1.0.0"],
  );

  let responseStatus = 0;
  const reply = {
    code(status: number) { responseStatus = status; return this; },
    send() { return undefined; },
  };
  await routes.get("/v1/account/push-devices/:installationId")!({
    actor: { userId: actorId, sessionId },
    params: { installationId },
  }, reply);
  assert.equal(responseStatus, 204);
  assert.deepEqual(queries.at(-1)?.params, [actorId, installationId]);
});

test("notification APIs are owner-scoped, paged, and expose an authoritative unread summary", async () => {
  const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const firstId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const secondId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const queryCalls: Array<{ sql: string; params: unknown[] | undefined }> = [];
  const notificationRows = [
    {
      id: firstId,
      kind: "DRAW_RESULT",
      title: "첫 알림",
      body: "첫 알림 본문",
      data: {},
      read_at: null,
      created_at: new Date("2026-09-20T10:00:00.000Z"),
    },
    {
      id: secondId,
      kind: "USER_WARNING",
      title: "두 번째 알림",
      body: "두 번째 알림 본문",
      data: { href: "https://attacker.example" },
      read_at: null,
      created_at: new Date("2026-09-20T09:00:00.000Z"),
    },
  ];
  const pool = {
    async query(sql: string, params?: unknown[]) {
      queryCalls.push({ sql, params });
      if (sql.includes("count(*)::integer AS unread_count")) {
        return {
          rowCount: 1,
          rows: [{ unread_count: 2, newest_unread_created_at: notificationRows[0]!.created_at }],
        };
      }
      if (sql.includes("WHERE id=$1 AND user_id=$2")) {
        return { rowCount: 1, rows: [notificationRows[0]!] };
      }
      if (sql.includes("ORDER BY created_at DESC,id DESC LIMIT $2")) {
        return { rowCount: 2, rows: notificationRows };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const { app, routes } = routeCapture();
  await registerAccountRoutes(app, testContext(pool));

  const list = await routes.get("/v1/account/notifications")!({
    actor: { userId: actorId },
    query: { limit: 1 },
  }, {}) as { items: Array<{ id: string; data: unknown; destination: { route: string } }>; nextCursor: string | null };
  assert.equal(list.items.length, 1);
  assert.deepEqual(list.items[0]!.data, {});
  assert.equal(list.items[0]!.id, firstId);
  assert.equal(list.items[0]!.destination.route, "storage");
  assert.ok(list.nextCursor);

  const summary = await routes.get("/v1/account/notifications/unread-summary")!({
    actor: { userId: actorId },
  }, {});
  assert.deepEqual(summary, {
    unreadCount: 2,
    newestUnreadCreatedAt: "2026-09-20T10:00:00.000Z",
  });

  const detail = await routes.get("/v1/account/notifications/:notificationId")!({
    actor: { userId: actorId },
    params: { notificationId: firstId },
  }, {}) as { id: string; destination: { route: string } };
  assert.equal(detail.id, firstId);
  assert.equal(detail.destination.route, "storage");

  assert.equal(queryCalls.every((call) => call.params?.includes(actorId)), true);
  const detailQuery = queryCalls.find((call) => call.sql.includes("WHERE id=$1 AND user_id=$2"));
  assert.deepEqual(detailQuery?.params, [firstId, actorId]);
});

test("server shipping policy uses 24,900 won for Gacha and 54,900 won whenever Kuji is included", () => {
  const gachaBelow = calculateAccountShippingPolicy([{ sourceType: "GACHA", price: 24_899 }]);
  const gachaExact = calculateAccountShippingPolicy([{ sourceType: "GACHA", price: 24_900 }]);
  const kujiBelow = calculateAccountShippingPolicy([
    { sourceType: "GACHA", price: 30_000 },
    { sourceType: "KUJI", price: 24_899 },
  ]);
  const kujiExact = calculateAccountShippingPolicy([{ sourceType: "KUJI", price: 54_900 }]);

  assert.equal(gachaBelow.threshold, GACHA_ONLY_FREE_SHIPPING_THRESHOLD);
  assert.equal(gachaBelow.qualifiesForFreeShipping, false);
  assert.equal(gachaBelow.shippingFee, STANDARD_SHIPPING_FEE);
  assert.equal(gachaExact.qualifiesForFreeShipping, true);
  assert.equal(gachaExact.shippingFee, 0);
  assert.equal(kujiBelow.threshold, KUJI_INCLUDED_FREE_SHIPPING_THRESHOLD);
  assert.equal(kujiBelow.qualifiesForFreeShipping, false);
  assert.equal(kujiBelow.shippingFee, STANDARD_SHIPPING_FEE);
  assert.equal(kujiExact.threshold, KUJI_INCLUDED_FREE_SHIPPING_THRESHOLD);
  assert.equal(kujiExact.qualifiesForFreeShipping, true);
  assert.equal(kujiExact.shippingFee, 0);
});

test("point return ids and amounts are deterministic and use integer floor at 50 percent", () => {
  const high = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const low = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(canonicalPointReturnInventoryIds([high, low]), [low, high]);
  assert.equal(pointReturnAmount(9_999), 4_999);
  assert.equal(pointReturnAmount(2), 1);
  assert.equal(pointReturnAmount(1), 0);
  assert.equal(pointReturnAmount(MAX_POINT_BALANCE), 1_073_741_823);
  assert.equal(pointReturnTotalAmount([1_073_741_823, 1_073_741_823]), 2_147_483_646);
  assert.throws(
    () => pointReturnTotalAmount([1_073_741_823, 1_073_741_823, 2]),
    (error: unknown) => error instanceof AppError && error.statusCode === 409,
  );
  assert.throws(() => canonicalPointReturnInventoryIds([low, low]), AppError);
});

test("point return eligibility requires trusted GACHA inventory in the owned state", () => {
  assert.equal(isPointReturnEligibleInventory("OWNED", "GACHA", true), true);
  assert.equal(isPointReturnEligibleInventory("OWNED", "KUJI", true), false);
  assert.equal(isPointReturnEligibleInventory("OWNED", "PURCHASE", true), false);
  assert.equal(isPointReturnEligibleInventory("OWNED", "ADMIN_ADJUSTMENT", true), false);
  assert.equal(isPointReturnEligibleInventory("OWNED", "GACHA", false), false);
  for (const status of [
    "EXCHANGE_LISTED",
    "EXCHANGE_OFFERED",
    "SHIPPING",
    "DELIVERED",
    "TRANSFERRED",
    "REFUNDED",
    "POINT_RETURNED",
    "EXPIRED_HOLD",
  ] as const) {
    assert.equal(isPointReturnEligibleInventory(status, "GACHA", true), false);
  }
});

test("point return endpoint rejects an original OWNED KUJI draw without crediting points", async () => {
  const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const inventoryId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const entitlementId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const queries: string[] = [];
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rowCount: null, rows: [] };
      if (sql.startsWith("DELETE FROM idempotency_keys")) return { rowCount: 0, rows: [] };
      if (sql.includes("INSERT INTO idempotency_keys")) {
        return { rowCount: 1, rows: [{ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }] };
      }
      if (sql.includes("FROM inventory_units iu") && sql.includes("draw_results")) {
        return {
          rowCount: 1,
          rows: [{
            id: inventoryId,
            owner_id: actorId,
            product_id: "kuji-prize",
            source_type: "KUJI",
            source_id: entitlementId,
            status: "OWNED",
            price: 2_000,
            draw_user_id: actorId,
            draw_entitlement_id: entitlementId,
            draw_prize_product_id: "kuji-prize",
          }],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() { /* no-op */ },
  };
  const { app, routes } = routeCapture();
  await registerAccountRoutes(app, testContext({ async connect() { return client; } }));
  const handler = routes.get("/v1/account/point-returns");
  assert.ok(handler);

  await assert.rejects(
    handler({
      actor: { userId: actorId },
      headers: { "idempotency-key": "point-return-kuji-reject-0001" },
      body: { inventoryUnitIds: [inventoryId] },
      id: "request-point-return-kuji-reject-0001",
    }, {}),
    (error: unknown) => error instanceof AppError
      && error.statusCode === 409
      && /본인이 가챠에서 직접 뽑아/.test(error.message),
  );

  const inventoryLock = queries.find((sql) => sql.includes("FROM inventory_units iu") && sql.includes("draw_results"));
  assert.match(inventoryLock || "", /iu\.source_type='GACHA'/);
  assert.equal(queries.includes("ROLLBACK"), true);
  assert.equal(queries.includes("COMMIT"), false);
  assert.equal(queries.some((sql) => sql.includes("INSERT INTO inventory_point_returns")), false);
  assert.equal(queries.some((sql) => sql.includes("INSERT INTO point_ledger_entries")), false);
  assert.equal(queries.some((sql) => sql.includes("UPDATE point_accounts SET balance=balance+")), false);
});

test("shipping contact data is normalized for storage and masked for response", () => {
  assert.equal(normalizeShippingPhone("010-1234-5678"), "01012345678");
  assert.equal(normalizeShippingPhone("+82 (10) 1234-5678"), "+821012345678");
  assert.equal(maskShippingRecipient("김영민"), "김*민");
  assert.equal(maskShippingPhone("01012345678"), "*******5678");
  assert.throws(() => normalizeShippingPhone("010-ABCD-5678"), AppError);
});

test("account basics validate real, plausible birth dates and mask verified phone identities", () => {
  const today = new Date("2026-08-31T12:00:00.000Z");
  assert.equal(normalizeBirthDate("2000-02-29", today), "2000-02-29");
  assert.equal(normalizeBirthDate("2026-08-31", today), "2026-08-31");
  assert.throws(() => normalizeBirthDate("2025-02-29", today), AppError);
  assert.throws(() => normalizeBirthDate("1899-12-31", today), AppError);
  assert.throws(() => normalizeBirthDate("2026-09-01", today), AppError);
  assert.throws(() => normalizeBirthDate("2000/02/29", today), AppError);
  assert.equal(maskAccountPhone("01012345678"), "010-****-5678");
  assert.equal(maskAccountPhone("+82 (10) 1234-5678"), "+82-10-****-5678");
  assert.equal(maskAccountPhone("123"), "****");
});

test("account basic info update rejects direct email and phone mutations", async () => {
  const { app, routes } = routeCapture();
  await registerAccountRoutes(app, testContext({ async connect() { throw new Error("must not connect"); } }));
  const handler = routes.get("/v1/account/basic-info");
  assert.ok(handler);

  for (const body of [
    { email: "changed@example.test", expectedVersion: 1 },
    { phone: "01012345678", expectedVersion: 1 },
  ]) {
    await assert.rejects(
      handler({
        actor: { userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
        headers: { "idempotency-key": "basic-info-update-0001" },
        body,
      }, {}),
      (error: unknown) => error instanceof AppError && error.statusCode === 400,
    );
  }
});

test("account basic info reads the verified phone column and returns only a masked value", async () => {
  const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let basicInfoHandler: RouteHandler | undefined;
  let capturedSql = "";
  const register = (...args: unknown[]) => {
    if (args[0] === "/v1/account/basic-info" && typeof args.at(-1) === "function") {
      basicInfoHandler = args.at(-1) as RouteHandler;
    }
  };
  const app = {
    get: register,
    post() { /* no-op */ },
    put() { /* no-op */ },
    patch() { /* preserve the captured GET */ },
    delete() { /* no-op */ },
  } as unknown as FastifyInstance;
  const pool = {
    async query(sql: string, params: unknown[]) {
      capturedSql = sql;
      assert.deepEqual(params, [actorId]);
      return { rowCount: 1, rows: [{
        id: actorId,
        nickname: "모찌수집가",
        email: "owner@example.test",
        phone_e164: "+821012345678",
        birth_date: "2000-02-29",
        version: 2,
        updated_at: new Date("2026-08-31T03:00:00.000Z"),
      }] };
    },
  };
  await registerAccountRoutes(app, testContext(pool));
  assert.ok(basicInfoHandler);

  const body = await basicInfoHandler({ actor: { userId: actorId } }, {});
  assert.deepEqual(body, {
    id: actorId,
    nickname: "모찌수집가",
    email: "owner@example.test",
    phoneMasked: "+82-10-****-5678",
    birthDate: "2000-02-29",
    version: 2,
    updatedAt: "2026-08-31T03:00:00.000Z",
  });
  assert.equal(Object.hasOwn(body as object, "phone"), false);
  assert.match(capturedSql, /u\.phone_e164/);
  assert.doesNotMatch(capturedSql, /auth_identities|provider_subject/);
});

test("account deletion starts automatically only when every authoritative blocker is clear", () => {
  const clear = {
    pointBalance: 0,
    activeOrderCount: 0,
    activePaymentCount: 0,
    availableDrawEntitlementCount: 0,
    activeInventoryCount: 0,
    activeShippingRequestCount: 0,
    activeExchangeListingCount: 0,
    activeExchangeOfferCount: 0,
  };
  assert.equal(accountDeletionStatus(clear), "PROCESSING");
  assert.equal(accountDeletionStatus({ ...clear, pointBalance: 1 }), "BLOCKED");
  assert.equal(accountDeletionStatus({ ...clear, activeExchangeOfferCount: 1 }), "BLOCKED");
});

test("wishlist reads hide prize-only catalog items", async () => {
  const { app, routes } = routeCapture();
  let capturedSql = "";
  const pool = {
    async query(sql: string) {
      capturedSql = sql;
      return { rowCount: 0, rows: [] };
    },
  };
  await registerAccountRoutes(app, testContext(pool));
  const handler = routes.get("/v1/account/wishlist");
  assert.ok(handler);

  await handler({ actor: { userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, query: {} }, {});

  assert.match(capturedSql, /p\.is_prize_only=false/);
});

test("account inventory returns the owner's stored, exchanging, or shipping GACHA and KUJI prizes", async () => {
  const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const inventoryId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const acquiredAt = new Date("2026-09-01T03:00:00.000Z");
  const productCreatedAt = new Date("2026-08-01T03:00:00.000Z");
  const productUpdatedAt = new Date("2026-08-31T03:00:00.000Z");
  let capturedSql = "";
  let capturedParams: unknown[] = [];
  let queryCount = 0;
  const pool = {
    async query(sql: string, params: unknown[] = []) {
      queryCount += 1;
      capturedSql = sql;
      capturedParams = params;
      return {
        rowCount: 1,
        rows: [{
          id: inventoryId,
          owner_id: actorId,
          product_id: "inactive-kuji-prize",
          source_type: "KUJI",
          inventory_status: "EXCHANGE_LISTED",
          acquired_at: acquiredAt,
          point_return_eligible: false,
          sku: "PRIZE-KUJI-001",
          ip_id: "test-ip",
          character_ids: ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
          category: "figure",
          product_name: "비활성 전환된 쿠지 경품",
          manufacturer: "DABBOBA",
          release_date: "2026-08-01",
          price: "9900",
          available_quantity: "0",
          metadata: { rarity: "A" },
          image_url: "https://cdn.example.test/inactive-kuji-prize.png",
          storefront_image_url: "https://cdn.example.test/inactive-kuji-prize-storefront.png",
          product_active: false,
          is_prize_only: true,
          product_version: 3,
          product_created_at: productCreatedAt,
          product_updated_at: productUpdatedAt,
          created_at: acquiredAt,
        }],
      };
    },
  };
  const { app, routes } = routeCapture();
  await registerAccountRoutes(app, testContext(pool));
  const handler = routes.get("/v1/account/inventory");
  assert.ok(handler);

  const body = await handler({ actor: { userId: actorId }, query: { limit: 2 } }, {});

  assert.deepEqual(body, {
    items: [{
      id: inventoryId,
      ownerId: actorId,
      productId: "inactive-kuji-prize",
      product: {
        id: "inactive-kuji-prize",
        sku: "PRIZE-KUJI-001",
        ipId: "test-ip",
        characterIds: ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
        category: "figure",
        name: "비활성 전환된 쿠지 경품",
        manufacturer: "DABBOBA",
        releaseDate: "2026-08-01",
        price: 9_900,
        availableQuantity: 0,
        totalQuantity: null,
        metadata: { rarity: "A" },
        imageUrl: "https://cdn.example.test/inactive-kuji-prize.png",
        storefrontImageUrl: "https://cdn.example.test/inactive-kuji-prize-storefront.png",
        isActive: false,
        isPrizeOnly: true,
        version: 3,
        createdAt: productCreatedAt.toISOString(),
        updatedAt: productUpdatedAt.toISOString(),
      },
      sourceType: "KUJI",
      status: "EXCHANGE_LISTED",
      acquiredAt: acquiredAt.toISOString(),
      pointReturnEligible: false,
    }],
    nextCursor: null,
  });
  assert.deepEqual(capturedParams, [actorId, 3]);
  assert.match(capturedSql, /iu\.owner_id=\$1/);
  assert.match(capturedSql, /iu\.status IN \('OWNED','EXCHANGE_LISTED','EXCHANGE_OFFERED','SHIPPING','EXPIRED_HOLD'\)/);
  assert.match(capturedSql, /\(iu\.status IN \('SHIPPING','EXPIRED_HOLD'\) OR iu\.storage_expires_at>now\(\)\)/);
  assert.match(capturedSql, /point_purchase\.reference_amount >= 2/);
  assert.match(capturedSql, /purchase_line\.unit_price AS reference_amount/);
  assert.match(capturedSql, /iu\.source_type IN \('GACHA','KUJI'\)/);
  assert.match(capturedSql, /draw_result\.prize_inventory_unit_id=iu\.id/);
  assert.match(capturedSql, /draw_result\.user_id=iu\.owner_id/);
  assert.match(capturedSql, /draw_result\.entitlement_id=iu\.source_id/);
  assert.match(capturedSql, /draw_result\.prize_product_id=iu\.product_id/);
  assert.match(capturedSql, /p\.storefront_image_url/);
  assert.match(capturedSql, /inventory_ownership_transfers transfer/);
  assert.match(capturedSql, /completed_exchange\.status='COMPLETED'/);
  assert.match(capturedSql, /transfer\.to_owner_id=iu\.owner_id/);
  assert.doesNotMatch(capturedSql, /p\.is_active\s*=\s*true/);

  const malformedUuidCursor = Buffer.from(JSON.stringify({
    createdAt: acquiredAt.toISOString(),
    id: "not-a-uuid",
  }), "utf8").toString("base64url");
  await assert.rejects(
    handler({ actor: { userId: actorId }, query: { cursor: malformedUuidCursor } }, {}),
    (error: unknown) => error instanceof AppError && error.statusCode === 400,
  );
  assert.equal(queryCount, 1);
});

test("owned product detail is scoped to the authenticated owner and direct draw provenance", async () => {
  const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let capturedSql = "";
  let capturedParams: unknown[] = [];
  const timestamp = new Date("2026-09-01T03:00:00.000Z");
  const pool = {
    async query(sql: string, params: unknown[] = []) {
      capturedSql = sql;
      capturedParams = params;
      return {
        rowCount: 1,
        rows: [{
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          owner_id: actorId,
          product_id: "inactive-kuji-prize",
          source_type: "KUJI",
          inventory_status: "SHIPPING",
          acquired_at: timestamp,
          sku: "PRIZE-KUJI-001",
          ip_id: "test-ip",
          character_ids: [],
          category: "figure",
          product_name: "배송 중인 쿠지 경품",
          manufacturer: null,
          release_date: null,
          price: "9900",
          available_quantity: "0",
          metadata: {},
          image_url: null,
          product_active: false,
          is_prize_only: true,
          product_version: 3,
          product_created_at: timestamp,
          product_updated_at: timestamp,
          created_at: timestamp,
        }],
      };
    },
  };
  const { app, routes } = routeCapture();
  await registerAccountRoutes(app, testContext(pool));
  const handler = routes.get("/v1/account/owned-products/:productId");
  assert.ok(handler);

  const body = await handler({
    actor: { userId: actorId },
    params: { productId: "inactive-kuji-prize" },
  }, {}) as { id: string; name: string; isPrizeOnly: boolean };

  assert.deepEqual(capturedParams, [actorId, "inactive-kuji-prize"]);
  assert.match(capturedSql, /iu\.owner_id=\$1 AND iu\.product_id=\$2/);
  assert.match(capturedSql, /iu\.source_type IN \('GACHA','KUJI'\)/);
  assert.match(capturedSql, /draw_result\.prize_inventory_unit_id=iu\.id/);
  assert.match(capturedSql, /draw_result\.user_id=iu\.owner_id/);
  const detailWhere = capturedSql.slice(capturedSql.indexOf("WHERE iu.owner_id=$1"));
  assert.doesNotMatch(detailWhere, /iu\.status='OWNED'/);
  assert.equal(body.id, "inactive-kuji-prize");
  assert.equal(body.name, "배송 중인 쿠지 경품");
  assert.equal(body.isPrizeOnly, true);
});

test("draw entitlements default to AVAILABLE and are scoped to the authenticated owner", async () => {
  const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const entitlementId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const orderId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const orderLineId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const createdAt = new Date("2026-08-25T03:00:00.000Z");
  const observed: Array<{ sql: string; params: unknown[] }> = [];
  const pool = {
    async query(sql: string, params: unknown[] = []) {
      observed.push({ sql, params });
      return {
        rowCount: 1,
        rows: [{
          id: entitlementId,
          order_id: orderId,
          order_line_id: orderLineId,
          product_id: "draw-product",
          product_name: "복원 추첨 상품",
          product_category: "gacha",
          product_image_url: "https://cdn.example.test/draw.png",
          probability_version: 7,
          status: "AVAILABLE",
          created_at: createdAt,
          consumed_at: null,
        }],
      };
    },
  };
  const { app, routes } = routeCapture();
  await registerAccountRoutes(app, testContext(pool));
  const handler = routes.get("/v1/account/draw-entitlements");
  assert.ok(handler);

  const body = await handler({ actor: { userId: actorId }, query: { limit: 10 } }, {});
  assert.deepEqual(body, {
    items: [{
      id: entitlementId,
      orderId,
      orderLineId,
      product: {
        id: "draw-product",
        name: "복원 추첨 상품",
        category: "gacha",
        imageUrl: "https://cdn.example.test/draw.png",
      },
      probabilityVersion: 7,
      status: "AVAILABLE",
      createdAt: createdAt.toISOString(),
      consumedAt: null,
    }],
    nextCursor: null,
  });
  assert.deepEqual(observed[0]?.params, [actorId, 11, "AVAILABLE"]);
  assert.match(observed[0]?.sql || "", /e\.user_id=\$1/);
  assert.match(observed[0]?.sql || "", /o\.user_id=\$1/);
  assert.match(observed[0]?.sql || "", /e\.status=\$3/);
  assert.match(observed[0]?.sql || "", /JOIN draw_probability_versions/);

  await assert.rejects(
    handler({ actor: { userId: actorId }, query: { status: "PENDING" } }, {}),
    (error: unknown) => error instanceof AppError && error.statusCode === 400,
  );
  assert.equal(observed.length, 1);
});

test("profile updates reject a stale owner version before changing the user row", async () => {
  const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      queries.push({ sql, params });
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rowCount: null, rows: [] };
      if (sql.startsWith("DELETE FROM idempotency_keys")) return { rowCount: 0, rows: [] };
      if (sql.includes("INSERT INTO idempotency_keys")) {
        return { rowCount: 1, rows: [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }] };
      }
      if (sql.includes("FROM users u JOIN user_profiles p") && sql.includes("FOR UPDATE")) {
        return { rowCount: 1, rows: [{
          id: actorId,
          nickname: "현재 닉네임",
          bio: null,
          favorite_ip_id: null,
          favorite_ip_name_ko: null,
          favorite_ip_image_url: null,
          version: 2,
          updated_at: new Date("2026-08-24T10:00:00.000Z"),
        }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() { /* no-op */ },
  };
  const { app, routes } = routeCapture();
  await registerAccountRoutes(app, testContext({ async connect() { return client; } }));
  const handler = routes.get("/v1/account/profile");
  assert.ok(handler);
  await assert.rejects(
    handler({
      actor: { userId: actorId },
      headers: { "idempotency-key": "profile-update-0001" },
      body: { nickname: "새 닉네임", expectedVersion: 1 },
    }, {}),
    (error: unknown) => error instanceof AppError && error.statusCode === 409,
  );
  const lock = queries.find(({ sql }) => sql.includes("FOR UPDATE OF u,p"));
  assert.deepEqual(lock?.params, [actorId]);
  assert.equal(queries.some(({ sql }) => sql.startsWith("UPDATE users")), false);
  assert.equal(queries.some(({ sql }) => sql === "ROLLBACK"), true);
});

test("account basic info updates reject a stale version before changing private data", async () => {
  const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      queries.push({ sql, params });
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rowCount: null, rows: [] };
      if (sql.startsWith("DELETE FROM idempotency_keys")) return { rowCount: 0, rows: [] };
      if (sql.includes("INSERT INTO idempotency_keys")) {
        return { rowCount: 1, rows: [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }] };
      }
      if (sql.includes("p.birth_date") && sql.includes("FOR UPDATE OF u,p")) {
        return { rowCount: 1, rows: [{
          id: actorId,
          nickname: "현재 닉네임",
          email: "owner@example.test",
          phone_e164: "+821012345678",
          birth_date: "2000-01-01",
          version: 3,
          updated_at: new Date("2026-08-31T03:00:00.000Z"),
        }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() { /* no-op */ },
  };
  const { app, routes } = routeCapture();
  await registerAccountRoutes(app, testContext({ async connect() { return client; } }));
  const handler = routes.get("/v1/account/basic-info");
  assert.ok(handler);
  await assert.rejects(
    handler({
      actor: { userId: actorId },
      headers: { "idempotency-key": "basic-info-update-0002" },
      body: { nickname: "새 닉네임", birthDate: null, expectedVersion: 2 },
    }, {}),
    (error: unknown) => error instanceof AppError && error.statusCode === 409,
  );
  const lock = queries.find(({ sql }) => sql.includes("p.birth_date") && sql.includes("FOR UPDATE OF u,p"));
  assert.deepEqual(lock?.params, [actorId]);
  assert.equal(queries.some(({ sql }) => sql.startsWith("UPDATE users")), false);
  assert.equal(queries.some(({ sql }) => sql.includes("UPDATE user_profiles SET birth_date")), false);
  assert.equal(queries.some(({ sql }) => sql === "ROLLBACK"), true);
});

test("shipping quote snapshots the canonical selection, active address version, ten-minute expiry, and server policy", async () => {
  const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const gachaId = "11111111-1111-4111-8111-111111111111";
  const kujiId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const quoteId = "77777777-7777-4777-8777-777777777777";
  const addressId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const createdAt = new Date("2026-09-20T01:00:00.000Z");
  const expiresAt = new Date("2026-09-20T01:10:00.000Z");
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      queries.push({ sql, params });
      if (sql === "BEGIN" || sql === "COMMIT" || sql.startsWith("SET TRANSACTION")) {
        return { rowCount: null, rows: [] };
      }
      if (sql.includes("FROM default_shipping_addresses")) {
        return { rowCount: 1, rows: [{
          id: addressId,
          user_id: actorId,
          recipient: "김영민",
          phone: "01012345678",
          postal_code: "06236",
          address_line1: "서울특별시 강남구 테스트로 1",
          address_line2: "101호",
          delivery_note: "문 앞",
          version: 3,
          created_at: createdAt,
          updated_at: createdAt,
        }] };
      }
      if (sql.includes("FROM inventory_units iu") && sql.includes("FOR SHARE OF iu,p")) {
        assert.deepEqual(params, [[gachaId, kujiId], actorId]);
        return { rowCount: 2, rows: [
          { id: gachaId, source_type: "GACHA", price: 24_900 },
          { id: kujiId, source_type: "KUJI", price: 30_000 },
        ] };
      }
      if (sql.includes("INSERT INTO shipping_quotes")) {
        assert.deepEqual(params, [actorId, addressId, 3, [gachaId, kujiId], 2, 54_900, true, 54_900, 0]);
        return { rowCount: 1, rows: [{
          id: quoteId,
          user_id: actorId,
          address_id: addressId,
          address_version: 3,
          inventory_unit_ids: [gachaId, kujiId],
          item_count: 2,
          reference_subtotal: 54_900,
          contains_kuji: true,
          free_shipping_threshold: 54_900,
          shipping_fee: 0,
          created_at: createdAt,
          expires_at: expiresAt,
          consumed_at: null,
          shipping_request_id: null,
        }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() { /* no-op */ },
  };
  const { app, routes } = routeCapture();
  await registerAccountRoutes(app, testContext({ async connect() { return client; } }));
  const handler = routes.get("/v1/account/shipping-quotes");
  assert.ok(handler);
  const response = await handler({
    actor: { userId: actorId },
    body: { inventoryUnitIds: [kujiId, gachaId] },
  }, {}) as Record<string, unknown>;

  assert.deepEqual(response, {
    id: quoteId,
    inventoryUnitIds: [gachaId, kujiId],
    addressId,
    addressVersion: 3,
    destination: {
      recipientMasked: "김*민",
      phoneMasked: "*******5678",
      postalCode: "06236",
      addressLine1: "서울특별시 강남구 테스트로 1",
      addressLine2: "101호",
    },
    itemCount: 2,
    referenceSubtotal: 54_900,
    containsKuji: true,
    freeShippingThreshold: 54_900,
    qualifiesForFreeShipping: true,
    shippingFee: 0,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
  assert.match(queries.find(({ sql }) => sql.includes("FROM inventory_units iu"))?.sql ?? "", /ORDER BY iu\.id FOR SHARE OF iu,p/);
  assert.equal(queries.at(-1)?.sql, "COMMIT");
});

test("shipping request locks owned inventory in canonical order and commits one atomic transition", async () => {
  const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const highId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const lowId = "11111111-1111-4111-8111-111111111111";
  const quoteId = "77777777-7777-4777-8777-777777777777";
  const shippingId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const idempotencyId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const requestedAt = new Date("2026-08-24T10:00:00.000Z");
  const observedInventoryParams: unknown[][] = [];
  let observedShippingItems: unknown;
  const queries: string[] = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      queries.push(sql);
      if (sql === "BEGIN" || sql === "COMMIT") return { rowCount: null, rows: [] };
      if (sql.startsWith("DELETE FROM idempotency_keys")) return { rowCount: 0, rows: [] };
      if (sql.includes("INSERT INTO idempotency_keys")) return { rowCount: 1, rows: [{ id: idempotencyId }] };
      if (sql.includes("FROM shipping_quotes quote")) {
        return { rowCount: 1, rows: [{
          id: quoteId,
          user_id: actorId,
          address_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          address_version: 1,
          inventory_unit_ids: [lowId, highId],
          item_count: 2,
          reference_subtotal: 24_900,
          contains_kuji: false,
          free_shipping_threshold: 24_900,
          shipping_fee: 0,
          created_at: requestedAt,
          expires_at: new Date("2026-08-24T10:10:00.000Z"),
          consumed_at: null,
          shipping_request_id: null,
          expired: false,
        }] };
      }
      if (sql.includes("FROM default_shipping_addresses")) {
        return { rowCount: 1, rows: [{
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          user_id: actorId,
          recipient: "김영민",
          phone: "01012345678",
          postal_code: "12345",
          address_line1: "서울시 테스트로 1",
          address_line2: null,
          delivery_note: null,
          version: 1,
          created_at: requestedAt,
          updated_at: requestedAt,
        }] };
      }
      if (sql.includes("FROM inventory_units iu") && sql.includes("JOIN catalog_products p")) {
        observedInventoryParams.push(params);
        return {
          rowCount: 2,
          rows: [
            { id: lowId, source_type: "GACHA", price: 12_450 },
            { id: highId, source_type: "GACHA", price: 12_450 },
          ],
        };
      }
      if (sql.includes("INSERT INTO shipping_requests")) {
        assert.equal(params[1], "REQUESTED");
        assert.deepEqual(params.slice(3), [24_900, 24_900, true, false, 0]);
        return { rowCount: 1, rows: [{ id: shippingId, requested_at: requestedAt }] };
      }
      if (sql.includes("INSERT INTO shipping_request_items")) {
        observedShippingItems = params[1];
        return { rowCount: 2, rows: [] };
      }
      if (sql.includes("UPDATE inventory_units SET status='SHIPPING'")) {
        observedInventoryParams.push(params);
        return { rowCount: 2, rows: [{ id: lowId }, { id: highId }] };
      }
      if (sql.includes("UPDATE shipping_quotes")) return { rowCount: 1, rows: [] };
      if (sql.includes("INSERT INTO outbox_events")) return { rowCount: 1, rows: [] };
      if (sql.includes("UPDATE idempotency_keys SET state='COMPLETED'")) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() { /* no-op */ },
  };
  const { app, routes } = routeCapture();
  await registerAccountRoutes(app, testContext({ async connect() { return client; } }));
  const handler = routes.get("/v1/account/shipping-requests");
  assert.ok(handler);
  let responseStatus = 0;
  let responseBody: unknown;
  const reply = {
    code(status: number) { responseStatus = status; return this; },
    header() { return this; },
    send(body: unknown) { responseBody = body; return body; },
  };
  await handler({
    actor: { userId: actorId },
    headers: { "idempotency-key": "shipping-request-0001" },
    body: { quoteId, addressVersion: 1 },
    id: "request-shipping-0001",
  }, reply);

  assert.equal(responseStatus, 201);
  assert.deepEqual((responseBody as { inventoryUnitIds: string[] }).inventoryUnitIds, [lowId, highId]);
  assert.equal((responseBody as { quoteId: string }).quoteId, quoteId);
  assert.deepEqual(observedInventoryParams.map((params) => params[0]), [[lowId, highId], [lowId, highId]]);
  assert.deepEqual(observedShippingItems, [lowId, highId]);
  const shippingLock = queries.find((sql) => sql.includes("FROM inventory_units iu") && sql.includes("JOIN catalog_products p"));
  assert.match(shippingLock || "", /iu\.source_type IN \('GACHA','KUJI'\)/);
  assert.match(shippingLock || "", /iu\.storage_expires_at>now\(\)/);
  assert.match(shippingLock || "", /ORDER BY iu\.id FOR UPDATE OF iu,p/);
  assert.match(queries.find((sql) => sql.includes("UPDATE inventory_units SET status='SHIPPING'")) || "", /storage_expires_at>now\(\)/);
  assert.equal(queries.includes("COMMIT"), true);
});

test("shipping quote expiry, address changes, and duplicate consumption fail before any shipping mutation", async () => {
  const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const inventoryId = "11111111-1111-4111-8111-111111111111";
  const quoteId = "77777777-7777-4777-8777-777777777777";
  const addressId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const scenarios = [
    { name: "expired", expectedCode: "SHIPPING_QUOTE_EXPIRED", expired: true, consumedAt: null, addressVersion: 1 },
    { name: "consumed", expectedCode: "SHIPPING_QUOTE_CONSUMED", expired: false, consumedAt: new Date("2026-09-20T01:01:00.000Z"), addressVersion: 1 },
    { name: "address-changed", expectedCode: "SHIPPING_ADDRESS_CHANGED", expired: false, consumedAt: null, addressVersion: 2 },
  ] as const;

  for (const scenario of scenarios) {
    const queries: string[] = [];
    const client = {
      async query(sql: string) {
        queries.push(sql);
        if (sql === "BEGIN" || sql === "ROLLBACK") return { rowCount: null, rows: [] };
        if (sql.startsWith("DELETE FROM idempotency_keys")) return { rowCount: 0, rows: [] };
        if (sql.includes("INSERT INTO idempotency_keys")) {
          return { rowCount: 1, rows: [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }] };
        }
        if (sql.includes("FROM shipping_quotes quote")) {
          return { rowCount: 1, rows: [{
            id: quoteId,
            user_id: actorId,
            address_id: addressId,
            address_version: 1,
            inventory_unit_ids: [inventoryId],
            item_count: 1,
            reference_subtotal: 24_900,
            contains_kuji: false,
            free_shipping_threshold: 24_900,
            shipping_fee: 0,
            created_at: new Date("2026-09-20T01:00:00.000Z"),
            expires_at: new Date("2026-09-20T01:10:00.000Z"),
            consumed_at: scenario.consumedAt,
            shipping_request_id: scenario.consumedAt ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" : null,
            expired: scenario.expired,
          }] };
        }
        if (sql.includes("FROM default_shipping_addresses")) {
          return { rowCount: 1, rows: [{
            id: addressId,
            user_id: actorId,
            recipient: "김영민",
            phone: "01012345678",
            postal_code: "06236",
            address_line1: "서울특별시 강남구 테스트로 1",
            address_line2: null,
            delivery_note: null,
            version: scenario.addressVersion,
          }] };
        }
        throw new Error(`Unexpected query in ${scenario.name}: ${sql}`);
      },
      release() { /* no-op */ },
    };
    const { app, routes } = routeCapture();
    await registerAccountRoutes(app, testContext({ async connect() { return client; } }));
    const handler = routes.get("/v1/account/shipping-requests");
    assert.ok(handler);
    await assert.rejects(
      handler({
        actor: { userId: actorId },
        headers: { "idempotency-key": `shipping-${scenario.name}-0001` },
        body: { quoteId, addressVersion: 1 },
        id: `request-${scenario.name}`,
      }, {}),
      (error: unknown) => error instanceof AppError
        && error.statusCode === 409
        && error.code === scenario.expectedCode,
    );
    assert.equal(queries.some((sql) => sql.includes("INSERT INTO shipping_requests")), false);
    assert.equal(queries.at(-1), "ROLLBACK");
  }
});

test("mixed Gacha and Kuji shipping persists the 54,900 won policy at the exact boundary", async () => {
  const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const gachaId = "11111111-1111-4111-8111-111111111111";
  const kujiId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const quoteId = "77777777-7777-4777-8777-777777777777";
  const shippingId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const requestedAt = new Date("2026-09-14T01:00:00.000Z");
  let insertedPolicy: unknown[] | null = null;
  const client = {
    async query(sql: string, params: unknown[] = []) {
      if (sql === "BEGIN" || sql === "COMMIT") return { rowCount: null, rows: [] };
      if (sql.startsWith("DELETE FROM idempotency_keys")) return { rowCount: 0, rows: [] };
      if (sql.includes("INSERT INTO idempotency_keys")) {
        return { rowCount: 1, rows: [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }] };
      }
      if (sql.includes("FROM shipping_quotes quote")) {
        return { rowCount: 1, rows: [{
          id: quoteId,
          user_id: actorId,
          address_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          address_version: 1,
          inventory_unit_ids: [gachaId, kujiId],
          item_count: 2,
          reference_subtotal: 54_900,
          contains_kuji: true,
          free_shipping_threshold: 54_900,
          shipping_fee: 0,
          created_at: requestedAt,
          expires_at: new Date("2026-09-14T01:10:00.000Z"),
          consumed_at: null,
          shipping_request_id: null,
          expired: false,
        }] };
      }
      if (sql.includes("FROM default_shipping_addresses")) {
        return { rowCount: 1, rows: [{
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          user_id: actorId,
          recipient: "김영민",
          phone: "01012345678",
          postal_code: "12345",
          address_line1: "서울시 테스트로 1",
          address_line2: null,
          delivery_note: null,
          version: 1,
          created_at: requestedAt,
          updated_at: requestedAt,
        }] };
      }
      if (sql.includes("FROM inventory_units iu") && sql.includes("JOIN catalog_products p")) {
        return {
          rowCount: 2,
          rows: [
            { id: gachaId, source_type: "GACHA", price: 24_900 },
            { id: kujiId, source_type: "KUJI", price: 30_000 },
          ],
        };
      }
      if (sql.includes("INSERT INTO shipping_requests")) {
        assert.equal(params[1], "REQUESTED");
        insertedPolicy = params.slice(3);
        return { rowCount: 1, rows: [{ id: shippingId, requested_at: requestedAt }] };
      }
      if (sql.includes("INSERT INTO shipping_request_items")) return { rowCount: 2, rows: [] };
      if (sql.includes("UPDATE inventory_units SET status='SHIPPING'")) {
        return { rowCount: 2, rows: [{ id: gachaId }, { id: kujiId }] };
      }
      if (sql.includes("UPDATE shipping_quotes")) return { rowCount: 1, rows: [] };
      if (sql.includes("INSERT INTO outbox_events")) return { rowCount: 1, rows: [] };
      if (sql.includes("UPDATE idempotency_keys SET state='COMPLETED'")) {
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() { /* no-op */ },
  };
  const { app, routes } = routeCapture();
  await registerAccountRoutes(app, testContext({ async connect() { return client; } }));
  const handler = routes.get("/v1/account/shipping-requests");
  assert.ok(handler);
  let responseStatus = 0;
  const reply = {
    code(status: number) { responseStatus = status; return this; },
    header() { return this; },
    send(body: unknown) { return body; },
  };

  await handler({
    actor: { userId: actorId },
    headers: { "idempotency-key": "shipping-request-mixed-exact-0001" },
    body: { quoteId, addressVersion: 1 },
    id: "request-shipping-mixed-exact-0001",
  }, reply);

  assert.equal(responseStatus, 201);
  assert.deepEqual(insertedPolicy, [54_900, 54_900, true, true, 0]);
});

test("shipping request below the free-shipping threshold creates a 3,000 won payment order", async () => {
  const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const inventoryId = "11111111-1111-4111-8111-111111111111";
  const quoteId = "77777777-7777-4777-8777-777777777777";
  const shippingId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const orderId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const paymentId = "99999999-9999-4999-8999-999999999999";
  const queries: string[] = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      queries.push(sql);
      if (sql === "BEGIN" || sql === "COMMIT") return { rowCount: null, rows: [] };
      if (sql.startsWith("DELETE FROM idempotency_keys")) return { rowCount: 0, rows: [] };
      if (sql.includes("INSERT INTO idempotency_keys")) {
        return { rowCount: 1, rows: [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }] };
      }
      if (sql.includes("FROM shipping_quotes quote")) {
        return { rowCount: 1, rows: [{
          id: quoteId,
          user_id: actorId,
          address_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          address_version: 1,
          inventory_unit_ids: [inventoryId],
          item_count: 1,
          reference_subtotal: 24_899,
          contains_kuji: false,
          free_shipping_threshold: 24_900,
          shipping_fee: 3_000,
          created_at: new Date("2026-09-14T01:00:00.000Z"),
          expires_at: new Date("2026-09-14T01:10:00.000Z"),
          consumed_at: null,
          shipping_request_id: null,
          expired: false,
        }] };
      }
      if (sql.includes("FROM default_shipping_addresses")) {
        return { rowCount: 1, rows: [{
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          user_id: actorId,
          recipient: "김영민",
          phone: "01012345678",
          postal_code: "12345",
          address_line1: "서울시 테스트로 1",
          address_line2: null,
          delivery_note: null,
          version: 1,
        }] };
      }
      if (sql.includes("FROM inventory_units iu") && sql.includes("JOIN catalog_products p")) {
        return {
          rowCount: 1,
          rows: [{ id: inventoryId, source_type: "GACHA", price: 24_899 }],
        };
      }
      if (sql.includes("INSERT INTO shipping_requests")) {
        assert.equal(params[1], "PAYMENT_PENDING");
        assert.deepEqual(params.slice(3), [24_899, 24_900, false, false, 3_000]);
        return { rowCount: 1, rows: [{ id: shippingId, requested_at: new Date("2026-09-14T01:00:00.000Z") }] };
      }
      if (sql.includes("INSERT INTO shipping_request_items")) return { rowCount: 1, rows: [] };
      if (sql.includes("UPDATE inventory_units SET status='SHIPPING'")) return { rowCount: 1, rows: [{ id: inventoryId }] };
      if (sql.includes("INSERT INTO orders(")) {
        assert.deepEqual(params, [actorId, 3_000, shippingId]);
        return { rowCount: 1, rows: [{ id: orderId }] };
      }
      if (sql.includes("INSERT INTO payments")) {
        assert.deepEqual(params, [orderId, "TEST_PG", 3_000]);
        return { rowCount: 1, rows: [{ id: paymentId }] };
      }
      if (sql.includes("UPDATE shipping_quotes")) return { rowCount: 1, rows: [] };
      if (sql.includes("INSERT INTO outbox_events")) return { rowCount: 1, rows: [] };
      if (sql.includes("UPDATE idempotency_keys SET state='COMPLETED'")) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() { /* no-op */ },
  };
  const { app, routes } = routeCapture();
  await registerAccountRoutes(app, testContext({ async connect() { return client; } }));
  const handler = routes.get("/v1/account/shipping-requests");
  assert.ok(handler);

  let responseBody: unknown;
  const reply = { code() { return this; }, header() { return this; }, send(body: unknown) { responseBody = body; return body; } };
  await handler({
    actor: { userId: actorId },
    headers: { "idempotency-key": "shipping-request-below-threshold-0001" },
    body: { quoteId, addressVersion: 1 },
    id: "request-shipping-below-threshold-0001",
  }, reply);
  assert.deepEqual(responseBody, {
    id: shippingId,
    quoteId,
    status: "PAYMENT_PENDING",
    inventoryUnitIds: [inventoryId],
    destination: {
      recipientMasked: "김*민",
      phoneMasked: "*******5678",
      postalCode: "12345",
      addressLine1: "서울시 테스트로 1",
      addressLine2: null,
    },
    requestedAt: "2026-09-14T01:00:00.000Z",
    shippingFee: 3_000,
    paymentOrderId: orderId,
    paymentId,
  });
  assert.equal(queries.includes("COMMIT"), true);
});

test("mixed Gacha and Kuji shipping one won below 54,900 creates the same 3,000 won fee", async () => {
  const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const gachaId = "11111111-1111-4111-8111-111111111111";
  const kujiId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const quoteId = "77777777-7777-4777-8777-777777777777";
  const shippingId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const orderId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const paymentId = "99999999-9999-4999-8999-999999999999";
  const queries: string[] = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      queries.push(sql);
      if (sql === "BEGIN" || sql === "COMMIT") return { rowCount: null, rows: [] };
      if (sql.startsWith("DELETE FROM idempotency_keys")) return { rowCount: 0, rows: [] };
      if (sql.includes("INSERT INTO idempotency_keys")) {
        return { rowCount: 1, rows: [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }] };
      }
      if (sql.includes("FROM shipping_quotes quote")) {
        return { rowCount: 1, rows: [{
          id: quoteId,
          user_id: actorId,
          address_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          address_version: 1,
          inventory_unit_ids: [gachaId, kujiId],
          item_count: 2,
          reference_subtotal: 54_899,
          contains_kuji: true,
          free_shipping_threshold: 54_900,
          shipping_fee: 3_000,
          created_at: new Date("2026-09-14T01:00:00.000Z"),
          expires_at: new Date("2026-09-14T01:10:00.000Z"),
          consumed_at: null,
          shipping_request_id: null,
          expired: false,
        }] };
      }
      if (sql.includes("FROM default_shipping_addresses")) {
        return { rowCount: 1, rows: [{
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          user_id: actorId,
          recipient: "김영민",
          phone: "01012345678",
          postal_code: "12345",
          address_line1: "서울시 테스트로 1",
          address_line2: null,
          delivery_note: null,
          version: 1,
        }] };
      }
      if (sql.includes("FROM inventory_units iu") && sql.includes("JOIN catalog_products p")) {
        return {
          rowCount: 2,
          rows: [
            { id: gachaId, source_type: "GACHA", price: 24_900 },
            { id: kujiId, source_type: "KUJI", price: 29_999 },
          ],
        };
      }
      if (sql.includes("INSERT INTO shipping_requests")) {
        assert.equal(params[1], "PAYMENT_PENDING");
        assert.deepEqual(params.slice(3), [54_899, 54_900, false, true, 3_000]);
        return { rowCount: 1, rows: [{ id: shippingId, requested_at: new Date("2026-09-14T01:00:00.000Z") }] };
      }
      if (sql.includes("INSERT INTO shipping_request_items")) return { rowCount: 2, rows: [] };
      if (sql.includes("UPDATE inventory_units SET status='SHIPPING'")) return { rowCount: 2, rows: [{ id: gachaId }, { id: kujiId }] };
      if (sql.includes("INSERT INTO orders(")) return { rowCount: 1, rows: [{ id: orderId }] };
      if (sql.includes("INSERT INTO payments")) {
        assert.deepEqual(params, [orderId, "TEST_PG", 3_000]);
        return { rowCount: 1, rows: [{ id: paymentId }] };
      }
      if (sql.includes("UPDATE shipping_quotes")) return { rowCount: 1, rows: [] };
      if (sql.includes("INSERT INTO outbox_events")) return { rowCount: 1, rows: [] };
      if (sql.includes("UPDATE idempotency_keys SET state='COMPLETED'")) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() { /* no-op */ },
  };
  const { app, routes } = routeCapture();
  await registerAccountRoutes(app, testContext({ async connect() { return client; } }));
  const handler = routes.get("/v1/account/shipping-requests");
  assert.ok(handler);

  let responseBody: unknown;
  const reply = { code() { return this; }, header() { return this; }, send(body: unknown) { responseBody = body; return body; } };
  await handler({
    actor: { userId: actorId },
    headers: { "idempotency-key": "shipping-request-mixed-below-0001" },
    body: { quoteId, addressVersion: 1 },
    id: "request-shipping-mixed-below-0001",
  }, reply);
  assert.equal((responseBody as { status: string }).status, "PAYMENT_PENDING");
  assert.equal((responseBody as { shippingFee: number }).shippingFee, 3_000);
  assert.equal((responseBody as { paymentOrderId: string }).paymentOrderId, orderId);
  assert.equal(queries.includes("COMMIT"), true);
});

test("point return atomically locks original draw inventory, records immutable audit, and credits one ledger entry", async () => {
  const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const highId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const lowId = "11111111-1111-4111-8111-111111111111";
  const pointReturnId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const idempotencyId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const returnedAt = new Date("2026-08-30T01:00:00.000Z");
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      queries.push({ sql, params });
      if (sql === "BEGIN" || sql === "COMMIT") return { rowCount: null, rows: [] };
      if (sql.startsWith("DELETE FROM idempotency_keys")) return { rowCount: 0, rows: [] };
      if (sql.includes("INSERT INTO idempotency_keys")) return { rowCount: 1, rows: [{ id: idempotencyId }] };
      if (sql.includes("FROM inventory_units iu") && sql.includes("draw_results")) {
        return {
          rowCount: 2,
          rows: [
            {
              id: lowId,
              owner_id: actorId,
              product_id: "prize-low",
              source_type: "GACHA",
              source_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              status: "OWNED",
              price: 9_999,
              reference_amount: 1_000,
              purchase_category: "gacha",
              purchase_product_id: "original-gacha",
              purchase_order_status: "PAID",
              purchase_order_user_id: actorId,
              original_entitlement_user_id: actorId,
              original_entitlement_product_id: "original-gacha",
              draw_user_id: actorId,
              draw_entitlement_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              draw_prize_product_id: "prize-low",
              never_exchanged: true,
            },
            {
              id: highId,
              owner_id: actorId,
              product_id: "prize-high",
              source_type: "GACHA",
              source_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
              status: "OWNED",
              price: 2_000,
              reference_amount: 1_000,
              purchase_category: "gacha",
              purchase_product_id: "original-gacha",
              purchase_order_status: "PAID",
              purchase_order_user_id: actorId,
              original_entitlement_user_id: actorId,
              original_entitlement_product_id: "original-gacha",
              draw_user_id: actorId,
              draw_entitlement_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
              draw_prize_product_id: "prize-high",
              never_exchanged: true,
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO inventory_point_returns")) {
        return { rowCount: 1, rows: [{ id: pointReturnId, returned_at: returnedAt }] };
      }
      if (sql.includes("INSERT INTO inventory_point_return_items")) return { rowCount: 2, rows: [] };
      if (sql.includes("UPDATE inventory_units SET status='POINT_RETURNED'")) {
        return { rowCount: 2, rows: [{ id: lowId }, { id: highId }] };
      }
      if (sql.includes("INSERT INTO point_accounts")) return { rowCount: 1, rows: [] };
      if (sql.includes("INSERT INTO point_ledger_entries")) return { rowCount: 1, rows: [{ id: "ledger-1" }] };
      if (sql.includes("UPDATE point_accounts SET balance=balance+")) {
        return { rowCount: 1, rows: [{ balance: 2_600, version: 2 }] };
      }
      if (sql.includes("INSERT INTO outbox_events")) return { rowCount: 1, rows: [] };
      if (sql.includes("UPDATE idempotency_keys SET state='COMPLETED'")) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() { /* no-op */ },
  };
  const { app, routes } = routeCapture();
  await registerAccountRoutes(app, testContext({ async connect() { return client; } }));
  const handler = routes.get("/v1/account/point-returns");
  assert.ok(handler);
  let responseStatus = 0;
  let responseBody: unknown;
  const reply = {
    code(status: number) { responseStatus = status; return this; },
    header() { return this; },
    send(body: unknown) { responseBody = body; return body; },
  };
  await handler({
    actor: { userId: actorId },
    headers: { "idempotency-key": "point-return-request-0001" },
    body: { inventoryUnitIds: [highId, lowId] },
    id: "request-point-return-0001",
  }, reply);

  assert.equal(responseStatus, 201);
  assert.deepEqual(responseBody, {
    id: pointReturnId,
    inventoryUnitIds: [lowId, highId],
    totalPointAmount: 1_000,
    balance: 2_600,
    returnedAt: returnedAt.toISOString(),
  });
  const inventoryLock = queries.find(({ sql }) => sql.includes("FROM inventory_units iu") && sql.includes("draw_results"));
  assert.deepEqual(inventoryLock?.params, [[lowId, highId]]);
  assert.match(inventoryLock?.sql || "", /ORDER BY iu\.id FOR UPDATE OF iu,p/);
  assert.match(inventoryLock?.sql || "", /NOT EXISTS[\s\S]*?inventory_ownership_transfers transfer_history/);
  assert.match(inventoryLock?.sql || "", /iu\.storage_expires_at>now\(\)/);
  assert.doesNotMatch(inventoryLock?.sql || "", /completed_exchange|to_owner_id/);
  assert.equal(queries.filter(({ sql }) => sql.includes("INSERT INTO point_ledger_entries")).length, 1);
  const pointBalanceUpdate = queries.find(({ sql }) => sql.includes("UPDATE point_accounts SET balance=balance+"));
  assert.match(pointBalanceUpdate?.sql || "", /balance<=\$3::integer-\$2::integer/);
  assert.deepEqual(pointBalanceUpdate?.params, [actorId, 1_000, MAX_POINT_BALANCE]);
  assert.match(inventoryLock?.sql || "", /purchase_line\.unit_price AS reference_amount/);
  assert.match(
    queries.find(({ sql }) => sql.includes("UPDATE inventory_units SET status='POINT_RETURNED'"))?.sql || "",
    /storage_expires_at>now\(\)/,
  );
  assert.equal(queries.some(({ sql }) => sql === "COMMIT"), true);
});

test("account migration adds only profile, default-address, and wishlist persistence without raw card fields", async () => {
  const sql = await readFile(new URL("../../../../packages/db/migrations/0004_user_account.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE user_profiles/);
  assert.match(sql, /CREATE TABLE default_shipping_addresses/);
  assert.match(sql, /CREATE TABLE wishlist_items/);
  assert.match(sql, /UNIQUE \(user_id, product_id\)/);
  assert.doesNotMatch(sql, /card_number|\bcvv\b|\bcvc\b/i);
});

test("account lifecycle migration keeps deletion reviewable, idempotent, and append-only", async () => {
  const sql = await readFile(
    new URL("../../../../packages/db/migrations/0009_customer_account_lifecycle.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /ADD COLUMN rotated_from_session_id/);
  assert.match(sql, /CREATE TABLE account_deletion_requests/);
  assert.match(sql, /CREATE UNIQUE INDEX account_deletion_requests_one_open_idx/);
  assert.match(sql, /CREATE TABLE account_deletion_request_events/);
  assert.match(sql, /account_deletion_request_events_immutable/);
  assert.match(sql, /CHECK \(\(status = 'COMPLETED'\) = \(completed_at IS NOT NULL\)\)/);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+users/i);
});

test("point return migration separates the terminal status and keeps return evidence immutable", async () => {
  const sql = await readFile(
    new URL("../../../../packages/db/migrations/0019_inventory_point_returns.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /'POINT_RETURNED'/);
  assert.match(sql, /CREATE TABLE inventory_point_returns/);
  assert.match(sql, /CREATE TABLE inventory_point_return_items/);
  assert.match(sql, /inventory_unit_id uuid NOT NULL UNIQUE/);
  assert.match(sql, /point_amount = reference_amount \/ 2/);
  assert.match(sql, /inventory_point_returns_immutable/);
  assert.match(sql, /inventory_point_return_items_immutable/);
  assert.match(sql, /CREATE CONSTRAINT TRIGGER inventory_point_returns_total_guard/);
  assert.match(sql, /CREATE CONSTRAINT TRIGGER inventory_point_return_items_total_guard/);
  assert.match(sql, /DEFERRABLE INITIALLY DEFERRED/g);
});

test("account basic info migration stores only bounded birth dates", async () => {
  const sql = await readFile(
    new URL("../../../../packages/db/migrations/0021_user_profile_birth_date.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /ADD COLUMN birth_date date/);
  assert.match(sql, /birth_date BETWEEN DATE '1900-01-01' AND CURRENT_DATE/);
  assert.doesNotMatch(sql, /phone|email/i);
});
