import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Queryable } from "@dabboba/db";
import type { FastifyInstance } from "fastify";
import type { ApiContext } from "../types.js";
import { AppError } from "../lib/errors.js";
import {
  assertDirectPurchaseAllowed,
  assertDrawPrizeSnapshotsCurrent,
  assertLatestDrawDraft,
  assertKujiRoomOrderBinding,
  assertUniqueDrawPrizeProductIds,
  createDrawSelectionEvidence,
  checkoutReservationViolation,
  DRAW_SELECTION_ALGORITHM,
  drawPrizeSnapshotFields,
  drawRollFromEntropy,
  loadValidatedDrawPrizeSnapshots,
  refundRequiresReview,
  registerCommerceRoutes,
  paymentProviderForOrder,
  shouldRelistRefundedDrawStock,
  weightedSelectionIndex,
} from "./commerce.js";

type RouteHandler = (request: Record<string, unknown>, reply: Record<string, unknown>) => Promise<unknown>;

function routeCapture() {
  const routes = new Map<string, RouteHandler>();
  const register = (method: "GET" | "POST") => (...args: unknown[]) => {
    const path = args[0];
    const handler = args.at(-1);
    if (typeof path !== "string" || typeof handler !== "function") throw new Error("Invalid test route registration.");
    routes.set(path, handler as RouteHandler);
    routes.set(`${method} ${path}`, handler as RouteHandler);
  };
  return {
    app: { get: register("GET"), post: register("POST") } as unknown as FastifyInstance,
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

test("kuji orders require one kuji-only product and a room entry", () => {
  const roomEntryId = "11111111-1111-4111-8111-111111111111";
  assert.doesNotThrow(() => assertKujiRoomOrderBinding([{ category: "kuji" }], roomEntryId));
  assert.throws(
    () => assertKujiRoomOrderBinding([{ category: "kuji" }], null),
    (error: unknown) => error instanceof AppError && error.statusCode === 400,
  );
  assert.throws(
    () => assertKujiRoomOrderBinding([{ category: "kuji" }, { category: "figure" }], roomEntryId),
    (error: unknown) => error instanceof AppError && error.statusCode === 400,
  );
  assert.throws(
    () => assertKujiRoomOrderBinding([{ category: "figure" }], roomEntryId),
    (error: unknown) => error instanceof AppError && error.statusCode === 400,
  );
  assert.doesNotThrow(() => assertKujiRoomOrderBinding([{ category: "gacha" }], null));
});

test("kuji payment, draw, and worker paths lock the room before payment or stock", async () => {
  const commerceSource = await readFile(new URL("../../src/modules/commerce.ts", import.meta.url), "utf8");
  const webhookStart = commerceSource.indexOf("const paymentLookup=");
  const webhookRoomLock = commerceSource.indexOf("lockLinkedKujiRoomForOrder", webhookStart);
  const webhookPaymentLock = commerceSource.indexOf("FROM payments WHERE id=$1 FOR UPDATE", webhookRoomLock);
  assert.ok(webhookStart >= 0 && webhookStart < webhookRoomLock && webhookRoomLock < webhookPaymentLock);

  const drawStart = commerceSource.indexOf('app.post("/v1/draws/:entitlementId/consume"');
  const drawRoomLock = commerceSource.indexOf("lockLinkedKujiRoomForOrder", drawStart);
  const drawOrderLock = commerceSource.indexOf("SELECT status FROM orders WHERE id=$1 FOR UPDATE", drawRoomLock);
  const drawStockLock = commerceSource.indexOf("FOR UPDATE OF p,s", drawRoomLock);
  assert.ok(
    drawStart >= 0
      && drawStart < drawRoomLock
      && drawRoomLock < drawOrderLock
      && drawOrderLock < drawStockLock,
  );

  const workerSource = await readFile(new URL("../../../worker/src/reservations.ts", import.meta.url), "utf8");
  const workerRoomLock = workerSource.indexOf("lockLinkedKujiRoomForOrder(client, orderId)");
  const workerPaymentLock = workerSource.indexOf("FROM payments WHERE order_id=$1 FOR UPDATE", workerRoomLock);
  assert.ok(workerRoomLock >= 0 && workerRoomLock < workerPaymentLock);
});

test("late kuji payment success releases local assets and drawing expiry keeps paid tickets consumable", async () => {
  const source = await readFile(new URL("../../src/modules/commerce.ts", import.meta.url), "utf8");
  const lateSuccess = source.indexOf("KUJI_PAYMENT_SUCCEEDED_OUTSIDE_LEASE");
  const releasedRoom = source.indexOf("terminalState:\"EXPIRED\"", lateSuccess);
  const cancelledAt = source.indexOf("cancelled_at=COALESCE(cancelled_at,$3)", lateSuccess);
  assert.ok(lateSuccess >= 0 && releasedRoom > lateSuccess && cancelledAt > lateSuccess);
  assert.match(source, /expireLockedKujiOrderDrawing/);
  assert.match(source, /\["EXPIRED","COMPLETED"\]\.includes\(linkedKujiRoom\.state\)/);
  assert.match(source, /entitlementsRemainConsumable:true/);
});

test("prize-only catalog products cannot be purchased directly", () => {
  assert.doesNotThrow(() => assertDirectPurchaseAllowed({ name: "일반 판매 상품", isPrizeOnly: false }));
  assert.throws(
    () => assertDirectPurchaseAllowed({ name: "A상 경품", isPrizeOnly: true }),
    (error: unknown) => error instanceof AppError
      && error.statusCode === 409
      && error.message === "경품 전용 상품은 직접 구매할 수 없습니다: A상 경품",
  );
});

test("a draw draft rejects duplicate prize product ids before persistence", () => {
  assert.doesNotThrow(() => assertUniqueDrawPrizeProductIds(["prize-a", "prize-b"]));
  assert.throws(
    () => assertUniqueDrawPrizeProductIds(["prize-a", "prize-a"]),
    (error: unknown) => error instanceof AppError
      && error.statusCode === 400
      && error.message === "같은 경품 상품은 확률표에 한 번만 등록할 수 있습니다: prize-a",
  );
});

test("draw prize validation locks and snapshots active prize-only products from the same IP", async () => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      queries.push({ sql, params });
      return {
        rowCount: 2,
        rows: [
          { id: "prize-a", name: "A상", image_url: "https://example.test/a.png", sku: "PRIZE-A", ip_id: "ip-1", category: "figure", is_active: true, is_prize_only: true },
          { id: "prize-b", name: "B상", image_url: null, sku: "PRIZE-B", ip_id: "ip-1", category: "tcg", is_active: true, is_prize_only: true },
        ],
      };
    },
  };

  const snapshots = await loadValidatedDrawPrizeSnapshots(client as unknown as Queryable, {
    drawIpId: "ip-1",
    prizeProductIds: ["prize-b", "prize-a"],
  });

  assert.match(queries[0]!.sql, /FOR SHARE OF p/);
  assert.deepEqual(queries[0]!.params, [["prize-a", "prize-b"]]);
  assert.deepEqual(snapshots, [
    { id: "prize-b", name: "B상", imageUrl: null, sku: "PRIZE-B", ipId: "ip-1", category: "tcg" },
    { id: "prize-a", name: "A상", imageUrl: "https://example.test/a.png", sku: "PRIZE-A", ipId: "ip-1", category: "figure" },
  ]);
});

test("draw prize validation reports missing, non-prize-only, inactive, and cross-IP products in Korean", async () => {
  const base = { id: "prize-a", name: "A상", image_url: null, sku: "PRIZE-A", ip_id: "ip-1", category: "figure", is_active: true, is_prize_only: true };
  const cases: Array<{ rows: unknown[]; message: RegExp }> = [
    { rows: [], message: /경품 상품을 찾을 수 없습니다: prize-a/ },
    { rows: [{ ...base, is_prize_only: false }], message: /경품 전용 상품만 확률표 경품으로 등록할 수 있습니다: A상 \(prize-a\)/ },
    { rows: [{ ...base, is_active: false }], message: /비활성 경품 상품은 확률표에 등록하거나 공개할 수 없습니다: A상 \(prize-a\)/ },
    { rows: [{ ...base, ip_id: "ip-2" }], message: /추첨 상품과 동일한 IP의 경품만 사용할 수 있습니다: A상 \(prize-a\)/ },
  ];

  for (const scenario of cases) {
    const client = { async query() { return { rowCount: scenario.rows.length, rows: scenario.rows }; } };
    await assert.rejects(
      loadValidatedDrawPrizeSnapshots(client as unknown as Queryable, { drawIpId: "ip-1", prizeProductIds: ["prize-a"] }),
      (error: unknown) => error instanceof AppError && error.statusCode === 409 && scenario.message.test(error.message),
    );
  }
});

test("an older draft cannot replace a newer draw version", async () => {
  const staleClient = {
    async query() { return { rowCount: 1, rows: [{ version: 4 }] }; },
  };
  await assert.rejects(
    assertLatestDrawDraft(staleClient as unknown as Queryable, { productId: "draw-product", version: 3 }),
    (error: unknown) => error instanceof AppError
      && error.statusCode === 409
      && error.message === "더 최신 확률표 버전(v4)이 있어 v3 초안을 공개할 수 없습니다.",
  );

  const latestClient = {
    async query() { return { rowCount: 0, rows: [] }; },
  };
  await assert.doesNotReject(assertLatestDrawDraft(latestClient as unknown as Queryable, { productId: "draw-product", version: 4 }));
});

test("draw result response fields come from the immutable prize snapshot", () => {
  assert.deepEqual(drawPrizeSnapshotFields({
    prize_name_snapshot: "공개 당시 이름",
    prize_image_url_snapshot: "https://example.test/snapshot.png",
    prize_sku_snapshot: "SNAPSHOT-SKU",
    prize_ip_id_snapshot: "snapshot-ip",
    prize_category_snapshot: "figure",
  }), {
    prizeName: "공개 당시 이름",
    prizeImageUrl: "https://example.test/snapshot.png",
    prizeSku: "SNAPSHOT-SKU",
    prizeIpId: "snapshot-ip",
    prizeCategory: "figure",
  });
});

test("publishing rejects a draft whose stored prize snapshot no longer matches the catalog", () => {
  assert.throws(() => assertDrawPrizeSnapshotsCurrent([{
    prize_product_id: "prize-a",
    prize_name_snapshot: "초안 당시 이름",
    prize_image_url_snapshot: null,
    prize_sku_snapshot: "PRIZE-A",
    prize_ip_id_snapshot: "ip-1",
    prize_category_snapshot: "figure",
  }], [{
    id: "prize-a",
    name: "수정된 이름",
    imageUrl: null,
    sku: "PRIZE-A",
    ipId: "ip-1",
    category: "figure",
  }]), (error: unknown) => error instanceof AppError
    && error.statusCode === 409
    && /최신 정보로 새 확률표 초안/.test(error.message));
});

test("public draw odds are no-store and disclose exact finite-pool probability components", async () => {
  let queryIndex = 0;
  const queries: string[] = [];
  const pool = {
    async query(sql: string) {
      queries.push(sql);
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
            prize_name_snapshot: "공개 당시 A상",
            prize_image_url_snapshot: null,
            prize_sku_snapshot: "PRIZE-A-V7",
            prize_ip_id_snapshot: "snapshot-ip",
            prize_category_snapshot: "figure",
            rarity: "A",
            weight: 3,
            initial_quantity: 10,
            remaining_quantity: 5,
          },
          {
            id: "33333333-3333-4333-8333-333333333333",
            prize_product_id: "prize-b",
            prize_name_snapshot: "공개 당시 B상",
            prize_image_url_snapshot: "https://example.test/b-v7.png",
            prize_sku_snapshot: "PRIZE-B-V7",
            prize_ip_id_snapshot: "snapshot-ip",
            prize_category_snapshot: "tcg",
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
    entries: Array<{ prizeName: string; prizeImageUrl: string | null; prizeSku: string; prizeIpId: string; prizeCategory: string; effectiveWeight: number; probabilityNumerator: number; probabilityDenominator: number; probabilityPercent: number }>;
  };
  assert.equal(headers.get("cache-control"), "no-store");
  assert.match(queries[0]!, /p\.is_prize_only=false/);
  assert.match(queries[1]!, /e\.prize_name_snapshot/);
  assert.doesNotMatch(queries[1]!, /JOIN catalog_products/);
  assert.equal(result.version, 7);
  assert.equal(result.totalEffectiveWeight, 20);
  assert.deepEqual(result.entries[0] && {
    prizeName: result.entries[0].prizeName,
    prizeImageUrl: result.entries[0].prizeImageUrl,
    prizeSku: result.entries[0].prizeSku,
    prizeIpId: result.entries[0].prizeIpId,
    prizeCategory: result.entries[0].prizeCategory,
  }, {
    prizeName: "공개 당시 A상",
    prizeImageUrl: null,
    prizeSku: "PRIZE-A-V7",
    prizeIpId: "snapshot-ip",
    prizeCategory: "figure",
  });
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

test("admin draw versions return the stored prize snapshot", async () => {
  const queries: string[] = [];
  const pool = {
    async query(sql: string) {
      queries.push(sql);
      if (queries.length === 1) return { rowCount: 1, rows: [{ id: "draw-product" }] };
      return {
        rowCount: 1,
        rows: [{
          id: "11111111-1111-4111-8111-111111111111",
          product_id: "draw-product",
          version: 7,
          status: "ACTIVE",
          published_by: "22222222-2222-4222-8222-222222222222",
          published_at: new Date("2026-08-24T00:00:00.000Z"),
          created_at: new Date("2026-08-23T00:00:00.000Z"),
          entries: [{
            id: "33333333-3333-4333-8333-333333333333",
            prizeProductId: "prize-a",
            prizeName: "공개 당시 A상",
            prizeImageUrl: null,
            prizeSku: "PRIZE-A-V7",
            prizeIpId: "snapshot-ip",
            prizeCategory: "figure",
            rarity: "A",
            weight: 3,
            initialQuantity: 10,
            remainingQuantity: 5,
          }],
        }],
      };
    },
  };
  const { app, routes } = routeCapture();
  await registerCommerceRoutes(app, testContext(pool));
  const handler = routes.get("GET /v1/admin/products/:productId/draw-versions");
  assert.ok(handler);
  const result = await handler({ params: { productId: "draw-product" } }, {}) as {
    items: Array<{ entries: Array<Record<string, unknown>> }>;
  };

  assert.match(queries[1]!, /e\.prize_name_snapshot/);
  assert.deepEqual(result.items[0]!.entries[0], {
    id: "33333333-3333-4333-8333-333333333333",
    prizeProductId: "prize-a",
    prizeName: "공개 당시 A상",
    prizeImageUrl: null,
    prizeSku: "PRIZE-A-V7",
    prizeIpId: "snapshot-ip",
    prizeCategory: "figure",
    rarity: "A",
    weight: 3,
    initialQuantity: 10,
    remainingQuantity: 5,
  });
});

test("creating a draw draft validates and stores the canonical prize snapshot in one transaction", async () => {
  let savedEntry: { sql: string; params: unknown[] } | undefined;
  const client = {
    async query(sql: string, params: unknown[] = []) {
      if (sql === "BEGIN" || sql === "COMMIT") return { rowCount: null, rows: [] };
      if (sql.startsWith("DELETE FROM idempotency_keys")) return { rowCount: 0, rows: [] };
      if (sql.includes("INSERT INTO idempotency_keys")) return { rowCount: 1, rows: [{ id: "idem-draft" }] };
      if (sql === "SELECT ip_id,category,is_active,is_prize_only FROM catalog_products WHERE id=$1 FOR UPDATE") return { rowCount: 1, rows: [{ ip_id: "ip-1", category: "gacha", is_active: true, is_prize_only: false }] };
      if (sql.includes("SELECT p.id,p.name,p.image_url,p.sku")) return { rowCount: 1, rows: [{
        id: "prize-a",
        name: "A상",
        image_url: null,
        sku: "PRIZE-A",
        ip_id: "ip-1",
        category: "figure",
        is_active: true,
        is_prize_only: true,
      }] };
      if (sql.startsWith("SELECT COALESCE(max(version),0)+1")) return { rowCount: 1, rows: [{ version: 1 }] };
      if (sql.startsWith("INSERT INTO draw_probability_versions")) return { rowCount: 1, rows: [{ id: "11111111-1111-4111-8111-111111111111", version: 1, created_at: new Date("2026-08-24T00:00:00.000Z") }] };
      if (sql.startsWith("INSERT INTO draw_pool_entries")) {
        savedEntry = { sql, params };
        return { rowCount: 1, rows: [{ id: "22222222-2222-4222-8222-222222222222" }] };
      }
      if (sql.includes("SELECT host(ip_address) AS ip_address")) return { rowCount: 1, rows: [{ ip_address: "127.0.0.1", user_agent: "test" }] };
      if (sql.startsWith("INSERT INTO admin_audit_logs")) return { rowCount: 1, rows: [] };
      if (sql.startsWith("UPDATE idempotency_keys SET state='COMPLETED'")) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() { /* no-op */ },
  };
  const { app, routes } = routeCapture();
  await registerCommerceRoutes(app, testContext({ async connect() { return client; } }));
  const handler = routes.get("POST /v1/admin/products/:productId/draw-versions");
  assert.ok(handler);
  let responseBody: unknown;
  const reply = {
    header() { return this; },
    code() { return this; },
    send(body: unknown) { responseBody = body; return body; },
  };
  await handler({
    params: { productId: "draw-product" },
    body: { entries: [{ prizeProductId: "prize-a", rarity: "A", weight: 3, quantity: 10 }] },
    headers: { "idempotency-key": "create-draw-draft-0001", "x-admin-reason": "확률표 생성" },
    actor: { userId: "admin-1", sessionId: "session-1" },
    id: "request-create-draft",
    method: "POST",
    url: "/v1/admin/products/draw-product/draw-versions",
    routeOptions: { url: "/v1/admin/products/:productId/draw-versions" },
  }, reply);

  assert.ok(savedEntry);
  assert.match(savedEntry.sql, /prize_name_snapshot,prize_image_url_snapshot/);
  assert.deepEqual(savedEntry.params, [
    "11111111-1111-4111-8111-111111111111",
    "prize-a",
    "A상",
    null,
    "PRIZE-A",
    "ip-1",
    "figure",
    "A",
    3,
    10,
  ]);
  const responseEntry = (responseBody as { entries: Array<Record<string, unknown>> }).entries[0];
  assert.deepEqual(responseEntry && {
    prizeName: responseEntry.prizeName,
    prizeImageUrl: responseEntry.prizeImageUrl,
    prizeSku: responseEntry.prizeSku,
    prizeIpId: responseEntry.prizeIpId,
    prizeCategory: responseEntry.prizeCategory,
  }, {
    prizeName: "A상",
    prizeImageUrl: null,
    prizeSku: "PRIZE-A",
    prizeIpId: "ip-1",
    prizeCategory: "figure",
  });
});

test("publishing a stale draft rolls back before replacing the active draw version", async () => {
  const queries: string[] = [];
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rowCount: null, rows: [] };
      if (sql.startsWith("DELETE FROM idempotency_keys")) return { rowCount: 0, rows: [] };
      if (sql.includes("INSERT INTO idempotency_keys")) return { rowCount: 1, rows: [{ id: "idem-publish" }] };
      if (sql.startsWith("SELECT p.ip_id,s.on_hand")) return { rowCount: 1, rows: [{ ip_id: "ip-1", on_hand: 1 }] };
      if (sql.startsWith("SELECT id,status,version FROM draw_probability_versions")) return { rowCount: 1, rows: [{ id: "11111111-1111-4111-8111-111111111111", status: "DRAFT", version: 3 }] };
      if (sql.startsWith("SELECT version FROM draw_probability_versions")) return { rowCount: 1, rows: [{ version: 4 }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() { /* no-op */ },
  };
  const { app, routes } = routeCapture();
  await registerCommerceRoutes(app, testContext({ async connect() { return client; } }));
  const handler = routes.get("POST /v1/admin/products/:productId/draw-versions/:versionId/publish");
  assert.ok(handler);
  await assert.rejects(handler({
    params: { productId: "draw-product", versionId: "11111111-1111-4111-8111-111111111111" },
    body: { reason: "확률표 공개" },
    headers: { "idempotency-key": "publish-draw-draft-0001", "x-admin-reason": "확률표 공개" },
    actor: { userId: "admin-1", sessionId: "session-1" },
    id: "request-publish-draft",
    method: "POST",
    url: "/v1/admin/products/draw-product/draw-versions/11111111-1111-4111-8111-111111111111/publish",
    routeOptions: { url: "/v1/admin/products/:productId/draw-versions/:versionId/publish" },
  }, {}), (error: unknown) => error instanceof AppError && error.statusCode === 409 && /더 최신 확률표 버전\(v4\)/.test(error.message));
  assert.equal(queries.some((sql) => sql.includes("SET status='RETIRED'")), false);
  assert.equal(queries.at(-1), "ROLLBACK");
});

test("publishing revalidates prize-only active same-IP catalog state before activation", async () => {
  const queries: string[] = [];
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rowCount: null, rows: [] };
      if (sql.startsWith("DELETE FROM idempotency_keys")) return { rowCount: 0, rows: [] };
      if (sql.includes("INSERT INTO idempotency_keys")) return { rowCount: 1, rows: [{ id: "idem-publish-validation" }] };
      if (sql.startsWith("SELECT p.ip_id,s.on_hand")) return { rowCount: 1, rows: [{ ip_id: "ip-1", on_hand: 1 }] };
      if (sql.startsWith("SELECT id,status,version FROM draw_probability_versions")) return { rowCount: 1, rows: [{ id: "11111111-1111-4111-8111-111111111111", status: "DRAFT", version: 4 }] };
      if (sql.startsWith("SELECT version FROM draw_probability_versions")) return { rowCount: 0, rows: [] };
      if (sql.startsWith("SELECT prize_product_id,prize_name_snapshot")) return { rowCount: 1, rows: [{
        prize_product_id: "prize-a",
        prize_name_snapshot: "기존 A상",
        prize_image_url_snapshot: null,
        prize_sku_snapshot: "PRIZE-A",
        prize_ip_id_snapshot: "ip-1",
        prize_category_snapshot: "figure",
      }] };
      if (sql.includes("SELECT p.id,p.name,p.image_url,p.sku")) return { rowCount: 1, rows: [{
        id: "prize-a",
        name: "중지된 A상",
        image_url: null,
        sku: "PRIZE-A",
        ip_id: "ip-1",
        category: "figure",
        is_active: false,
        is_prize_only: true,
      }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() { /* no-op */ },
  };
  const { app, routes } = routeCapture();
  await registerCommerceRoutes(app, testContext({ async connect() { return client; } }));
  const handler = routes.get("POST /v1/admin/products/:productId/draw-versions/:versionId/publish");
  assert.ok(handler);
  await assert.rejects(handler({
    params: { productId: "draw-product", versionId: "11111111-1111-4111-8111-111111111111" },
    body: { reason: "확률표 공개" },
    headers: { "idempotency-key": "publish-draw-validate-0001", "x-admin-reason": "확률표 공개" },
    actor: { userId: "admin-1", sessionId: "session-1" },
    id: "request-publish-validation",
    method: "POST",
    url: "/v1/admin/products/draw-product/draw-versions/11111111-1111-4111-8111-111111111111/publish",
    routeOptions: { url: "/v1/admin/products/:productId/draw-versions/:versionId/publish" },
  }, {}), (error: unknown) => error instanceof AppError
    && error.statusCode === 409
    && error.message === "비활성 경품 상품은 확률표에 등록하거나 공개할 수 없습니다: 중지된 A상 (prize-a)");
  assert.ok(queries.some((sql) => /FOR SHARE OF p/.test(sql)));
  assert.equal(queries.some((sql) => sql.includes("SET status='RETIRED'")), false);
  assert.equal(queries.at(-1), "ROLLBACK");
});

test("an already consumed draw returns immutable prize snapshot fields", async () => {
  const client = {
    async query(sql: string) {
      if (sql === "BEGIN" || sql === "COMMIT") return { rowCount: null, rows: [] };
      if (sql.startsWith("DELETE FROM idempotency_keys")) return { rowCount: 0, rows: [] };
      if (sql.includes("INSERT INTO idempotency_keys")) return { rowCount: 1, rows: [{ id: "idem-1" }] };
      if (sql.includes("SELECT e.product_id,e.probability_version_id,l.order_id FROM draw_entitlements")) return { rowCount: 1, rows: [{ product_id: "draw-product", probability_version_id: "version-id", order_id: "order-id" }] };
      if (sql.includes("FROM kuji_room_entries WHERE order_id=$1")) return { rowCount: 0, rows: [] };
      if (sql.startsWith("SELECT p.id FROM catalog_products")) return { rowCount: 1, rows: [{ id: "draw-product" }] };
      if (sql === "SELECT id FROM draw_probability_versions WHERE id=$1 FOR UPDATE") return { rowCount: 1, rows: [{ id: "version-id" }] };
      if (sql.startsWith("SELECT pg_advisory_xact_lock")) return { rowCount: 1, rows: [{}] };
      if (sql.includes("SELECT e.*,v.version FROM draw_entitlements")) return { rowCount: 1, rows: [{
        id: "44444444-4444-4444-8444-444444444444",
        user_id: "user-1",
        product_id: "draw-product",
        probability_version_id: "version-id",
        status: "CONSUMED",
        version: 7,
      }] };
      if (sql.includes("SELECT r.*,e.rarity,e.prize_name_snapshot")) return { rowCount: 1, rows: [{
        id: "55555555-5555-4555-8555-555555555555",
        entitlement_id: "44444444-4444-4444-8444-444444444444",
        product_id: "draw-product",
        prize_product_id: "prize-a",
        prize_name_snapshot: "공개 당시 A상",
        prize_image_url_snapshot: null,
        prize_sku_snapshot: "PRIZE-A-V7",
        prize_ip_id_snapshot: "snapshot-ip",
        prize_category_snapshot: "figure",
        prize_inventory_unit_id: "66666666-6666-4666-8666-666666666666",
        probability_version: 7,
        rarity: "A",
        committed_at: new Date("2026-08-24T00:00:00.000Z"),
      }] };
      if (sql.startsWith("UPDATE idempotency_keys SET state='COMPLETED'")) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() { /* no-op */ },
  };
  const { app, routes } = routeCapture();
  await registerCommerceRoutes(app, testContext({ async connect() { return client; } }));
  const handler = routes.get("POST /v1/draws/:entitlementId/consume");
  assert.ok(handler);
  let responseBody: unknown;
  const reply = {
    header() { return this; },
    code() { return this; },
    send(body: unknown) { responseBody = body; return body; },
  };
  await handler({
    params: { entitlementId: "44444444-4444-4444-8444-444444444444" },
    headers: { "idempotency-key": "consume-existing-0001" },
    actor: { userId: "user-1" },
    id: "request-existing-draw",
  }, reply);

  assert.deepEqual(responseBody && {
    prizeName: (responseBody as Record<string, unknown>).prizeName,
    prizeImageUrl: (responseBody as Record<string, unknown>).prizeImageUrl,
    prizeSku: (responseBody as Record<string, unknown>).prizeSku,
    prizeIpId: (responseBody as Record<string, unknown>).prizeIpId,
    prizeCategory: (responseBody as Record<string, unknown>).prizeCategory,
  }, {
    prizeName: "공개 당시 A상",
    prizeImageUrl: null,
    prizeSku: "PRIZE-A-V7",
    prizeIpId: "snapshot-ip",
    prizeCategory: "figure",
  });
});

test("a newly consumed draw returns the selected pool entry snapshot", async () => {
  const client = {
    async query(sql: string) {
      if (sql === "BEGIN" || sql === "COMMIT") return { rowCount: null, rows: [] };
      if (sql.startsWith("DELETE FROM idempotency_keys")) return { rowCount: 0, rows: [] };
      if (sql.includes("INSERT INTO idempotency_keys")) return { rowCount: 1, rows: [{ id: "idem-2" }] };
      if (sql.includes("SELECT e.product_id,e.probability_version_id,l.order_id FROM draw_entitlements")) return { rowCount: 1, rows: [{ product_id: "draw-product", probability_version_id: "version-id", order_id: "order-id" }] };
      if (sql.includes("FROM kuji_room_entries WHERE order_id=$1")) return { rowCount: 0, rows: [] };
      if (sql.startsWith("SELECT p.id FROM catalog_products")) return { rowCount: 1, rows: [{ id: "draw-product" }] };
      if (sql === "SELECT id FROM draw_probability_versions WHERE id=$1 FOR UPDATE") return { rowCount: 1, rows: [{ id: "version-id" }] };
      if (sql.startsWith("SELECT pg_advisory_xact_lock")) return { rowCount: 1, rows: [{}] };
      if (sql.includes("SELECT e.*,v.version FROM draw_entitlements")) return { rowCount: 1, rows: [{
        id: "77777777-7777-4777-8777-777777777777",
        user_id: "user-1",
        product_id: "draw-product",
        probability_version_id: "version-id",
        status: "AVAILABLE",
        version: 7,
      }] };
      if (sql.startsWith("SELECT id,prize_product_id,prize_name_snapshot")) return { rowCount: 1, rows: [{
        id: "88888888-8888-4888-8888-888888888888",
        prize_product_id: "prize-b",
        prize_name_snapshot: "공개 당시 B상",
        prize_image_url_snapshot: "https://example.test/b-v7.png",
        prize_sku_snapshot: "PRIZE-B-V7",
        prize_ip_id_snapshot: "snapshot-ip",
        prize_category_snapshot: "tcg",
        rarity: "B",
        weight: 1,
        remaining_quantity: null,
      }] };
      if (sql === "SELECT category FROM catalog_products WHERE id=$1") return { rowCount: 1, rows: [{ category: "gacha" }] };
      if (sql.startsWith("INSERT INTO inventory_units")) return { rowCount: 1, rows: [{ id: "99999999-9999-4999-8999-999999999999" }] };
      if (sql.startsWith("INSERT INTO draw_results")) return { rowCount: 1, rows: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", committed_at: new Date("2026-08-24T00:00:00.000Z") }] };
      if (sql.startsWith("UPDATE draw_entitlements SET status='CONSUMED'")) return { rowCount: 1, rows: [] };
      if (sql.startsWith("INSERT INTO outbox_events")) return { rowCount: 1, rows: [] };
      if (sql.startsWith("UPDATE idempotency_keys SET state='COMPLETED'")) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() { /* no-op */ },
  };
  const { app, routes } = routeCapture();
  await registerCommerceRoutes(app, testContext({ async connect() { return client; } }));
  const handler = routes.get("POST /v1/draws/:entitlementId/consume");
  assert.ok(handler);
  let responseBody: unknown;
  const reply = {
    header() { return this; },
    code() { return this; },
    send(body: unknown) { responseBody = body; return body; },
  };
  await handler({
    params: { entitlementId: "77777777-7777-4777-8777-777777777777" },
    headers: { "idempotency-key": "consume-new-draw-0001" },
    actor: { userId: "user-1" },
    id: "request-new-draw",
  }, reply);

  assert.deepEqual(responseBody && {
    prizeName: (responseBody as Record<string, unknown>).prizeName,
    prizeImageUrl: (responseBody as Record<string, unknown>).prizeImageUrl,
    prizeSku: (responseBody as Record<string, unknown>).prizeSku,
    prizeIpId: (responseBody as Record<string, unknown>).prizeIpId,
    prizeCategory: (responseBody as Record<string, unknown>).prizeCategory,
  }, {
    prizeName: "공개 당시 B상",
    prizeImageUrl: "https://example.test/b-v7.png",
    prizeSku: "PRIZE-B-V7",
    prizeIpId: "snapshot-ip",
    prizeCategory: "tcg",
  });
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
      if (sql === "SELECT order_id FROM payments WHERE id=$1") return { rowCount: 0, rows: [] };
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
      if (sql === "SELECT order_id FROM payments WHERE id=$1") {
        return { rowCount: 1, rows: [{ order_id: "22222222-2222-4222-8222-222222222222" }] };
      }
      if (sql.includes("FROM kuji_room_entries WHERE order_id=$1")) return { rowCount: 0, rows: [] };
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
      if (sql === "SELECT order_id FROM payments WHERE id=$1") return { rowCount: 1, rows: [{ order_id: "22222222-2222-4222-8222-222222222222" }] };
      if (sql.includes("FROM kuji_room_entries WHERE order_id=$1")) return { rowCount: 0, rows: [] };
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
