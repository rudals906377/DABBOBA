import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import type { ApiContext } from "../types.js";
import { AppError } from "../lib/errors.js";
import {
  accountDeletionStatus,
  canonicalShippingInventoryIds,
  maskShippingPhone,
  maskShippingRecipient,
  normalizeShippingPhone,
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

test("shipping contact data is normalized for storage and masked for response", () => {
  assert.equal(normalizeShippingPhone("010-1234-5678"), "01012345678");
  assert.equal(normalizeShippingPhone("+82 (10) 1234-5678"), "+821012345678");
  assert.equal(maskShippingRecipient("김영민"), "김*민");
  assert.equal(maskShippingPhone("01012345678"), "*******5678");
  assert.throws(() => normalizeShippingPhone("010-ABCD-5678"), AppError);
});

test("account deletion remains review-only and reports any authoritative blocker", () => {
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
  assert.equal(accountDeletionStatus(clear), "PENDING_REVIEW");
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

test("shipping request locks owned inventory in canonical order and commits one atomic transition", async () => {
  const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const highId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const lowId = "11111111-1111-4111-8111-111111111111";
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
      if (sql.includes("SELECT id FROM inventory_units")) {
        observedInventoryParams.push(params);
        return { rowCount: 2, rows: [{ id: lowId }, { id: highId }] };
      }
      if (sql.includes("INSERT INTO shipping_requests")) return { rowCount: 1, rows: [{ id: shippingId, requested_at: requestedAt }] };
      if (sql.includes("INSERT INTO shipping_request_items")) {
        observedShippingItems = params[1];
        return { rowCount: 2, rows: [] };
      }
      if (sql.includes("UPDATE inventory_units SET status='SHIPPING'")) {
        observedInventoryParams.push(params);
        return { rowCount: 2, rows: [{ id: lowId }, { id: highId }] };
      }
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
    body: { inventoryUnitIds: [highId, lowId] },
    id: "request-shipping-0001",
  }, reply);

  assert.equal(responseStatus, 201);
  assert.deepEqual((responseBody as { inventoryUnitIds: string[] }).inventoryUnitIds, [lowId, highId]);
  assert.deepEqual(observedInventoryParams.map((params) => params[0]), [[lowId, highId], [lowId, highId]]);
  assert.deepEqual(observedShippingItems, [lowId, highId]);
  assert.match(queries.find((sql) => sql.includes("SELECT id FROM inventory_units")) || "", /ORDER BY id FOR UPDATE/);
  assert.equal(queries.includes("COMMIT"), true);
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
