import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import type { ApiContext } from "../types.js";
import { AppError } from "../lib/errors.js";
import {
  createDrawSelectionEvidence,
  checkoutReservationViolation,
  DRAW_SELECTION_ALGORITHM,
  drawRollFromEntropy,
  refundRequiresReview,
  registerCommerceRoutes,
  paymentProviderForOrder,
  shouldRelistRefundedDrawStock,
  weightedSelectionIndex,
} from "./commerce.js";

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
    app: { get: register, post: register } as unknown as FastifyInstance,
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

test("draw entropy is reduced without modulo bias and records the accepted sample", () => {
  const valueFive = Buffer.alloc(32);
  valueFive[31] = 5;
  assert.equal(drawRollFromEntropy(valueFive, 3), 2);

  const rejectedTail = Buffer.alloc(32, 0xff);
  assert.equal(drawRollFromEntropy(rejectedTail, 3), null);

  let calls = 0;
  const evidence = createDrawSelectionEvidence(3, () => {
    calls += 1;
    return calls === 1 ? rejectedTail : valueFive;
  });
  assert.equal(calls, 2);
  assert.equal(evidence.algorithm, DRAW_SELECTION_ALGORITHM);
  assert.equal(evidence.roll, 2);
  assert.equal(evidence.totalWeight, 3);
  assert.equal(evidence.entropyHex, valueFive.toString("hex"));
  assert.equal(evidence.entropyDigest, createHash("sha256").update(valueFive).digest("hex"));
});

test("weighted selection uses the original evidence roll at exact range boundaries", () => {
  assert.equal(weightedSelectionIndex([2, 3, 5], 0), 0);
  assert.equal(weightedSelectionIndex([2, 3, 5], 1), 0);
  assert.equal(weightedSelectionIndex([2, 3, 5], 2), 1);
  assert.equal(weightedSelectionIndex([2, 3, 5], 4), 1);
  assert.equal(weightedSelectionIndex([2, 3, 5], 5), 2);
  assert.throws(() => weightedSelectionIndex([2, 3, 5], 10), RangeError);
});

test("refunds require review when a purchased unit moved owners or fulfillment is incomplete", () => {
  assert.equal(refundRequiresReview({ unsafeAssetCount: 1, expectedPurchaseUnits: 1, actualPurchaseUnits: 1 }), true);
  assert.equal(refundRequiresReview({ unsafeAssetCount: 0, expectedPurchaseUnits: 2, actualPurchaseUnits: 1 }), true);
  assert.equal(refundRequiresReview({ unsafeAssetCount: 0, expectedPurchaseUnits: 1, actualPurchaseUnits: 1 }), false);
});

test("a refund from a retired draw version is not relisted into an incompatible active pool", () => {
  assert.equal(shouldRelistRefundedDrawStock("version-1", "version-2"), false);
  assert.equal(shouldRelistRefundedDrawStock("version-2", "version-2"), true);
  assert.equal(shouldRelistRefundedDrawStock("version-1", null), true);
});

test("checkout reservation pressure is bounded per account and product", () => {
  assert.equal(checkoutReservationViolation({ attemptCount: 12, activeOrderCount: 0, activeUnitCount: 0, requestedUnitCount: 1, productQuantities: [{ active: 0, requested: 1 }] }), "ATTEMPT_RATE");
  assert.equal(checkoutReservationViolation({ attemptCount: 0, activeOrderCount: 3, activeUnitCount: 3, requestedUnitCount: 1, productQuantities: [{ active: 0, requested: 1 }] }), "ACTIVE_ORDERS");
  assert.equal(checkoutReservationViolation({ attemptCount: 0, activeOrderCount: 1, activeUnitCount: 8, requestedUnitCount: 3, productQuantities: [{ active: 1, requested: 2 }] }), "ACTIVE_UNITS");
  assert.equal(checkoutReservationViolation({ attemptCount: 0, activeOrderCount: 1, activeUnitCount: 4, requestedUnitCount: 2, productQuantities: [{ active: 4, requested: 2 }] }), "PRODUCT_UNITS");
  assert.equal(checkoutReservationViolation({ attemptCount: 1, activeOrderCount: 1, activeUnitCount: 4, requestedUnitCount: 1, productQuantities: [{ active: 4, requested: 1 }] }), null);
});

test("paid orders fail closed without a provider while zero-external-payment orders use the internal rail", () => {
  assert.throws(
    () => paymentProviderForOrder("UNCONFIGURED", 1),
    (error: unknown) => error instanceof AppError && error.statusCode === 503 && error.code === "PAYMENT_NOT_CONFIGURED",
  );
  assert.equal(paymentProviderForOrder("UNCONFIGURED", 0), "INTERNAL_ZERO");
  assert.throws(
    () => paymentProviderForOrder("INTERNAL_ZERO", 1),
    (error: unknown) => error instanceof AppError && error.code === "PAYMENT_NOT_CONFIGURED",
  );
  assert.equal(paymentProviderForOrder("TEST_PG", 1000), "TEST_PG");
});

test("public draw odds are no-store and disclose exact finite-pool probability components", async () => {
  let queryIndex = 0;
  const pool = {
    async query() {
      queryIndex += 1;
      if (queryIndex === 1) {
        return {
          rowCount: 1,
          rows: [{
            id: "11111111-1111-4111-8111-111111111111",
            product_id: "draw-product",
            version: 7,
            published_at: new Date("2026-08-24T00:00:00.000Z"),
          }],
        };
      }
      return {
        rowCount: 2,
        rows: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            prize_product_id: "prize-a",
            prize_name: "A상",
            prize_image_url: null,
            rarity: "A",
            weight: 3,
            initial_quantity: 10,
            remaining_quantity: 5,
          },
          {
            id: "33333333-3333-4333-8333-333333333333",
            prize_product_id: "prize-b",
            prize_name: "B상",
            prize_image_url: null,
            rarity: "B",
            weight: 1,
            initial_quantity: 10,
            remaining_quantity: 5,
          },
        ],
      };
    },
  };
  const { app, routes } = routeCapture();
  await registerCommerceRoutes(app, testContext(pool));
  const handler = routes.get("/v1/catalog/products/:productId/draw-odds");
  assert.ok(handler);
  const headers = new Map<string, string>();
  const result = await handler(
    { params: { productId: "draw-product" } },
    { header(name: string, value: string) { headers.set(name, value); } },
  ) as {
    version: number;
    totalEffectiveWeight: number;
    entries: Array<{ effectiveWeight: number; probabilityNumerator: number; probabilityDenominator: number; probabilityPercent: number }>;
  };
  assert.equal(headers.get("cache-control"), "no-store");
  assert.equal(result.version, 7);
  assert.equal(result.totalEffectiveWeight, 20);
  assert.deepEqual(result.entries.map((entry) => ({
    effectiveWeight: entry.effectiveWeight,
    numerator: entry.probabilityNumerator,
    denominator: entry.probabilityDenominator,
    percent: entry.probabilityPercent,
  })), [
    { effectiveWeight: 15, numerator: 15, denominator: 20, percent: 75 },
    { effectiveWeight: 5, numerator: 5, denominator: 20, percent: 25 },
  ]);
});

test("webhooks reject the internal zero rail and a disabled provider before database access", async () => {
  const pool = {
    async connect() { throw new Error("A rejected provider must not open a database transaction."); },
  };
  const { app, routes } = routeCapture();
  await registerCommerceRoutes(app, testContext(pool));
  const handler = routes.get("/v1/payments/webhooks/:provider");
  assert.ok(handler);
  await assert.rejects(
    handler({ params: { provider: "INTERNAL_ZERO" }, headers: {} }, {}),
    (error: unknown) => error instanceof AppError && error.statusCode === 403,
  );

  const disabledContext = testContext(pool);
  disabledContext.config.paymentProvider = "UNCONFIGURED";
  const disabled = routeCapture();
  await registerCommerceRoutes(disabled.app, disabledContext);
  await assert.rejects(
    disabled.routes.get("/v1/payments/webhooks/:provider")!({ params: { provider: "INTERNAL_ZERO" }, headers: {} }, {}),
    (error: unknown) => error instanceof AppError && error.statusCode === 503 && error.code === "PAYMENT_NOT_CONFIGURED",
  );
});

test("an authenticated webhook for an unknown payment returns 404 before event persistence", async () => {
  const queries: string[] = [];
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rowCount: null, rows: [] };
      if (sql.includes("FROM payments WHERE id=$1 FOR UPDATE")) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() { /* no-op test connection */ },
  };
  const pool = { async connect() { return client; } };
  const { app, routes } = routeCapture();
  await registerCommerceRoutes(app, testContext(pool));
  const handler = routes.get("/v1/payments/webhooks/:provider");
  assert.ok(handler);

  const body = {
    eventId: "evt-unknown-payment",
    eventType: "PAYMENT_SUCCEEDED",
    paymentId: "11111111-1111-4111-8111-111111111111",
    occurredAt: "2026-08-24T10:00:00.000Z",
    amount: 1000,
  };
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = createHmac("sha256", "test-webhook-secret").update(rawBody).digest("hex");
  await assert.rejects(
    handler({
      params: { provider: "TEST_PG" },
      headers: { "x-dabboba-signature": signature },
      body,
      rawBody,
      id: "request-unknown-payment",
    }, {}),
    (error: unknown) => error instanceof AppError && error.statusCode === 404 && error.code === "NOT_FOUND",
  );
  assert.equal(queries.some((sql) => sql.includes("INSERT INTO payment_provider_events")), false);
  assert.deepEqual(queries.map((sql) => sql === "BEGIN" || sql === "ROLLBACK" ? sql : "PAYMENT_LOOKUP"), ["BEGIN", "PAYMENT_LOOKUP", "ROLLBACK"]);
});

test("a value-moving webhook requires the provider amount before database access", async () => {
  const { app, routes } = routeCapture();
  await registerCommerceRoutes(app, testContext({
    async connect() { throw new Error("A malformed webhook must not open a database transaction."); },
  }));
  const handler = routes.get("/v1/payments/webhooks/:provider");
  assert.ok(handler);
  const body = {
    eventId: "evt-missing-amount",
    eventType: "PAYMENT_SUCCEEDED",
    paymentId: "11111111-1111-4111-8111-111111111111",
    occurredAt: "2026-08-24T10:00:00.000Z",
  };
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = createHmac("sha256", "test-webhook-secret").update(rawBody).digest("hex");
  await assert.rejects(
    handler({
      params: { provider: "TEST_PG" },
      headers: { "x-dabboba-signature": signature },
      body,
      rawBody,
      id: "request-missing-amount",
    }, {}),
    (error: unknown) => error instanceof AppError && error.statusCode === 400 && error.code === "INVALID_REQUEST",
  );
});

test("a reused provider event id with different content is rejected instead of silently deduplicated", async () => {
  const client = {
    async query(sql: string) {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rowCount: null, rows: [] };
      if (sql.includes("FROM payments WHERE id=$1 FOR UPDATE")) {
        return { rowCount: 1, rows: [{
          id: "11111111-1111-4111-8111-111111111111",
          order_id: "22222222-2222-4222-8222-222222222222",
          provider: "TEST_PG",
          status: "PENDING",
          amount: 1000,
          provider_payment_id: null,
        }] };
      }
      if (sql.includes("INSERT INTO payment_provider_events")) return { rowCount: 0, rows: [] };
      if (sql.includes("FROM payment_provider_events WHERE")) {
        return { rowCount: 1, rows: [{
          payment_id: "33333333-3333-4333-8333-333333333333",
          event_type: "PAYMENT_SUCCEEDED",
          payload_matches: false,
        }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() { /* no-op test connection */ },
  };
  const { app, routes } = routeCapture();
  await registerCommerceRoutes(app, testContext({ async connect() { return client; } }));
  const handler = routes.get("/v1/payments/webhooks/:provider");
  assert.ok(handler);
  const body = {
    eventId: "evt-reused",
    eventType: "PAYMENT_SUCCEEDED",
    paymentId: "11111111-1111-4111-8111-111111111111",
    occurredAt: "2026-08-24T10:00:00.000Z",
    amount: 1000,
  };
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = createHmac("sha256", "test-webhook-secret").update(rawBody).digest("hex");
  await assert.rejects(
    handler({
      params: { provider: "TEST_PG" },
      headers: { "x-dabboba-signature": signature },
      body,
      rawBody,
      id: "request-reused-event",
    }, {}),
    (error: unknown) => error instanceof AppError && error.statusCode === 409,
  );
});

test("late provider success is persisted for reconciliation without fulfilling released stock", async () => {
  const queries: string[] = [];
  const queryParams: unknown[][] = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      queries.push(sql);
      queryParams.push(params);
      if (sql === "BEGIN" || sql === "COMMIT") return { rowCount: null, rows: [] };
      if (sql.includes("FROM payments WHERE id=$1 FOR UPDATE")) return { rowCount: 1, rows: [{
        id: "11111111-1111-4111-8111-111111111111",
        order_id: "22222222-2222-4222-8222-222222222222",
        provider: "TEST_PG",
        status: "CANCELLED",
        amount: 1000,
        provider_payment_id: null,
      }] };
      if (sql.includes("INSERT INTO payment_provider_events")) return { rowCount: 1, rows: [{ id: "event-row" }] };
      if (sql.includes("FROM orders o JOIN payments")) return { rowCount: 1, rows: [{
        id: "22222222-2222-4222-8222-222222222222",
        user_id: "33333333-3333-4333-8333-333333333333",
        point_total: 0,
      }] };
      if (sql.includes("UPDATE payments SET status='REFUND_REVIEW'")) return { rowCount: 1, rows: [] };
      if (sql.includes("UPDATE orders SET status='REFUND_REVIEW'")) return { rowCount: 1, rows: [] };
      if (sql.includes("INSERT INTO payment_ledger_entries")) return { rowCount: 1, rows: [] };
      if (sql.includes("INSERT INTO outbox_events")) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() { /* no-op test connection */ },
  };
  const { app, routes } = routeCapture();
  await registerCommerceRoutes(app, testContext({ async connect() { return client; } }));
  const handler = routes.get("/v1/payments/webhooks/:provider");
  assert.ok(handler);
  const body = {
    eventId: "evt-late-success",
    eventType: "PAYMENT_SUCCEEDED",
    paymentId: "11111111-1111-4111-8111-111111111111",
    providerPaymentId: "provider-late-success",
    occurredAt: "2026-08-24T10:00:00.000Z",
    amount: 1000,
  };
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = createHmac("sha256", "test-webhook-secret").update(rawBody).digest("hex");
  let responseStatus = 0;
  let responseBody: unknown;
  const reply = {
    code(status: number) { responseStatus = status; return this; },
    send(payload: unknown) { responseBody = payload; return payload; },
  };
  await handler({
    params: { provider: "TEST_PG" },
    headers: { "x-dabboba-signature": signature },
    body,
    rawBody,
    id: "request-late-success",
  }, reply);
  assert.equal(responseStatus, 202);
  assert.deepEqual(responseBody, { accepted: true, outcome: "review" });
  assert.ok(queries.some((sql) => sql.includes("INSERT INTO payment_provider_events")));
  assert.ok(queryParams.flat().includes("payment.late_success_requires_reconciliation"));
  assert.equal(queries.some((sql) => sql.includes("UPDATE product_stock")), false);
  assert.equal(queries.at(-1), "COMMIT");
});

test("draw version input rejects finite prize entries with zero drawable quantity", async () => {
  const { app, routes } = routeCapture();
  await registerCommerceRoutes(app, testContext({}));
  const handler = routes.get("/v1/admin/products/:productId/draw-versions");
  assert.ok(handler);
  await assert.rejects(
    handler({
      params: { productId: "test-gacha" },
      body: { entries: [{ prizeProductId: "test-prize", rarity: "A", weight: 1, quantity: 0 }] },
    }, {}),
    (error: unknown) => error instanceof AppError && error.statusCode === 400,
  );
});

test("commerce migration namespaces ledgers and freezes published draw configuration", async () => {
  const sql = await readFile(new URL("../../../../packages/db/migrations/0003_commerce.sql", import.meta.url), "utf8");
  assert.match(sql, /payment_ledger_entries \(payment_id, entry_type, reference_id\)/);
  assert.doesNotMatch(sql, /payment_ledger_entries \(entry_type, reference_id\)/);
  assert.match(sql, /guard_published_draw_version_mutation/);
  assert.match(sql, /guard_draw_pool_entry_mutation/);
  assert.match(sql, /NEW\.remaining_quantity = OLD\.remaining_quantity - 1/);
  assert.match(sql, /initial_quantity IS NULL OR initial_quantity > 0/);
  assert.match(sql, /selection_algorithm varchar\(40\) NOT NULL/);
  assert.match(sql, /entropy_hex text NOT NULL/);
  assert.match(sql, /roll_value bigint NOT NULL/);
  assert.match(sql, /total_weight bigint NOT NULL/);
  assert.match(sql, /selection_snapshot jsonb NOT NULL/);
  const source = await readFile(new URL("../../src/modules/commerce.ts", import.meta.url), "utf8");
  assert.match(source, /SELECT id,owner_id,status FROM inventory_units[^\n]+FOR UPDATE/);
  assert.match(source, /SELECT id,status FROM draw_entitlements[^\n]+FOR UPDATE/);
  const refundLineLock = source.indexOf("ORDER BY product_id,id FOR UPDATE");
  const refundStockLock = source.indexOf("WHERE p.id=ANY($1::text[]) ORDER BY p.id FOR UPDATE OF p,s", refundLineLock);
  const refundCapacityLock = source.indexOf("draw-capacity:${versionId}", refundStockLock);
  const refundInventoryLock = source.indexOf("SELECT id,owner_id,status FROM inventory_units", refundCapacityLock);
  const refundEntitlementLock = source.indexOf("SELECT id,status FROM draw_entitlements", refundInventoryLock);
  assert.ok(refundLineLock >= 0 && refundLineLock < refundStockLock);
  assert.ok(refundStockLock < refundCapacityLock && refundCapacityLock < refundInventoryLock);
  assert.ok(refundInventoryLock < refundEntitlementLock);
  const invariantSql = await readFile(new URL("../../../../packages/db/migrations/0005_commerce_invariants.sql", import.meta.url), "utf8");
  assert.match(invariantSql, /guard_draw_product_stock_capacity/);
  assert.match(invariantSql, /guard_draw_entitlement_capacity/);
  assert.match(invariantSql, /Draw stock exceeds finite prize capacity/);
});
