import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import { AppError } from "../lib/errors.js";
import type { ApiContext } from "../types.js";
import { registerCatalogRoutes } from "./catalog.js";

type Handler = (request: Record<string, unknown>, reply: Record<string, unknown>) => Promise<unknown>;

function routeHarness() {
  const routes = new Map<string, Handler>();
  const register = (method: string) => (...args: unknown[]) => {
    const path = args[0];
    const handler = args.at(-1);
    if (typeof path !== "string" || typeof handler !== "function") throw new Error("invalid route");
    routes.set(`${method} ${path}`, handler as Handler);
  };
  const app = {
    get: register("GET"),
    post: register("POST"),
    patch: register("PATCH"),
  } as unknown as FastifyInstance;
  return { app, routes };
}

const authStub = {
  requireUser: async () => undefined,
  requireAdmin: async () => undefined,
  requireSuperAdmin: async () => undefined,
  requirePermission: () => async () => undefined,
};

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "spy-x-family-anya-prize",
    sku: "SPY-X-FAMILY-ANYA-PRIZE",
    ip_id: "spy-x-family",
    category: "figure",
    name: "아냐 포저 봉제 마스코트",
    manufacturer: null,
    release_date: null,
    price: 0,
    available_quantity: 0,
    metadata: {},
    image_url: "https://cdn.example.test/anya.webp",
    is_active: true,
    is_prize_only: true,
    character_ids: [],
    version: 1,
    created_at: new Date("2026-08-25T00:00:00.000Z"),
    updated_at: new Date("2026-08-25T00:00:00.000Z"),
    ...overrides,
  };
}

function contextWithPool(pool: Record<string, unknown>) {
  return { pool, auth: authStub } as unknown as ApiContext;
}

function transactionPool(query: (sql: string, values?: unknown[]) => Promise<{ rowCount: number; rows: unknown[] }>) {
  const client = { query, release() {} };
  return { async connect() { return client; } };
}

function adminRequest(input: { method: "POST" | "PATCH"; path: string; body: unknown; params?: Record<string, unknown> }) {
  return {
    id: "catalog-test-request",
    method: input.method,
    url: input.path,
    routeOptions: { url: input.path },
    params: input.params || {},
    query: {},
    body: input.body,
    headers: {
      "x-admin-reason": "catalog test reason",
      "idempotency-key": "catalog-test-idempotency-key",
    },
    actor: {
      userId: "11111111-1111-4111-8111-111111111111",
      email: "admin@example.test",
      nickname: "관리자",
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      sessionId: "22222222-2222-4222-8222-222222222222",
      sessionKind: "ADMIN",
    },
  };
}

function replyCapture() {
  let statusCode = 200;
  let body: unknown;
  const reply = {
    code(value: number) { statusCode = value; return this; },
    header() { return this; },
    send(value?: unknown) { body = value; return value; },
  };
  return { reply, result: () => ({ statusCode, body }) };
}

test("public characters expose only active rows for an active IP with cursor pagination", async () => {
  const { app, routes } = routeHarness();
  let capturedSql = "";
  let capturedValues: unknown[] = [];
  const context = {
    pool: {
      async query(sql: string, values: unknown[]) {
        capturedSql = sql;
        capturedValues = values;
        return {
          rowCount: 1,
          rows: [{
            id: "11111111-1111-4111-8111-111111111111",
            ip_id: "one-piece",
            name: "루피",
            aliases: ["Luffy"],
            image_url: "https://cdn.example.test/luffy.webp",
            is_active: true,
            version: 1,
            created_at: new Date("2026-08-24T00:00:00.000Z"),
            updated_at: new Date("2026-08-24T00:00:00.000Z"),
          }],
        };
      },
    },
    auth: authStub,
  } as unknown as ApiContext;

  await registerCatalogRoutes(app, context);
  const handler = routes.get("GET /v1/catalog/characters");
  assert.ok(handler);
  const result = await handler({ query: { ipId: "one-piece", limit: "2" } }, {}) as {
    items: Array<{ id: string; ipId: string; name: string; isActive: boolean }>;
    nextCursor: string | null;
  };

  assert.match(capturedSql, /c\.is_active = true/);
  assert.match(capturedSql, /i\.is_active = true/);
  assert.match(capturedSql, /c\.ip_id = \$2/);
  assert.deepEqual(capturedValues, [3, "one-piece"]);
  assert.deepEqual(result, {
    items: [{
      id: "11111111-1111-4111-8111-111111111111",
      ipId: "one-piece",
      name: "루피",
      aliases: ["Luffy"],
      imageUrl: "https://cdn.example.test/luffy.webp",
      isActive: true,
      version: 1,
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:00.000Z",
    }],
    nextCursor: null,
  });
});

test("public products exclude prize-only rows and expose the catalog role", async () => {
  const { app, routes } = routeHarness();
  let capturedSql = "";
  const context = contextWithPool({
    async query(sql: string) {
      capturedSql = sql;
      return { rowCount: 1, rows: [productRow({ is_prize_only: false })] };
    },
  });
  await registerCatalogRoutes(app, context);
  const handler = routes.get("GET /v1/catalog/products");
  assert.ok(handler);
  const result = await handler({ query: {} }, {}) as { items: Array<{ isPrizeOnly: boolean }> };
  assert.match(capturedSql, /p\.is_prize_only = false/);
  assert.equal(result.items[0]?.isPrizeOnly, false);
});

test("admin products filter both prize-only states and support a single-product lookup", async () => {
  const { app, routes } = routeHarness();
  const observed: Array<{ sql: string; values: unknown[] }> = [];
  const context = contextWithPool({
    async query(sql: string, values: unknown[] = []) {
      observed.push({ sql, values });
      return { rowCount: 1, rows: [productRow()] };
    },
  });
  await registerCatalogRoutes(app, context);
  const list = routes.get("GET /v1/admin/products");
  const detail = routes.get("GET /v1/admin/products/:productId");
  assert.ok(list);
  assert.ok(detail);

  const page = await list({ query: { prizeOnly: "true" } }, {}) as { items: Array<{ isPrizeOnly: boolean }> };
  assert.match(observed[0]!.sql, /p\.is_prize_only=\$2/);
  assert.deepEqual(observed[0]!.values, [31, true]);
  assert.equal(page.items[0]?.isPrizeOnly, true);

  await list({ query: { prizeOnly: "false" } }, {});
  assert.match(observed[1]!.sql, /p\.is_prize_only=\$2/);
  assert.deepEqual(observed[1]!.values, [31, false]);

  const item = await detail({ params: { productId: "spy-x-family-anya-prize" } }, {}) as { id: string; isPrizeOnly: boolean };
  assert.match(observed[2]!.sql, /WHERE p\.id=\$1/);
  assert.deepEqual(observed[2]!.values, ["spy-x-family-anya-prize"]);
  assert.deepEqual({ id: item.id, isPrizeOnly: item.isPrizeOnly }, {
    id: "spy-x-family-anya-prize",
    isPrizeOnly: true,
  });

  await assert.rejects(
    list({ query: { prizeOnly: "yes" } }, {}),
    (error: unknown) => error instanceof AppError && error.statusCode === 400,
  );
});

test("admin product creation defaults omitted isPrizeOnly to false", async () => {
  const { app, routes } = routeHarness();
  let insertedPrizeOnly: unknown;
  const pool = transactionPool(async (sql, values = []) => {
    if (sql.includes("INSERT INTO idempotency_keys")) {
      return { rowCount: 1, rows: [{ id: "33333333-3333-4333-8333-333333333333" }] };
    }
    if (sql.includes("INSERT INTO catalog_products")) {
      insertedPrizeOnly = values[11];
      return {
        rowCount: 1,
        rows: [productRow({
          id: values[0],
          sku: values[1],
          ip_id: values[2],
          category: values[3],
          name: values[4],
          manufacturer: values[5],
          release_date: values[6],
          price: values[7],
          image_url: values[8],
          metadata: JSON.parse(String(values[9])),
          is_active: values[10],
          is_prize_only: values[11],
          available_quantity: values[12],
          character_ids: values[13],
        })],
      };
    }
    if (sql.includes("SELECT host(ip_address)")) {
      return { rowCount: 1, rows: [{ ip_address: "127.0.0.1", user_agent: "catalog-test" }] };
    }
    return { rowCount: 0, rows: [] };
  });
  await registerCatalogRoutes(app, contextWithPool(pool));
  const handler = routes.get("POST /v1/admin/products");
  assert.ok(handler);
  const capture = replyCapture();
  await handler(adminRequest({
    method: "POST",
    path: "/v1/admin/products",
    body: {
      sku: "SPY-X-FAMILY-ANYA-PRIZE",
      ipId: "spy-x-family",
      category: "figure",
      name: "아냐 포저 봉제 마스코트",
      price: 0,
      availableQuantity: 0,
      metadata: {},
      isActive: true,
    },
  }), capture.reply);
  assert.equal(insertedPrizeOnly, false);
  assert.deepEqual(capture.result(), {
    statusCode: 201,
    body: {
      id: "spy-x-family-anya-prize",
      sku: "SPY-X-FAMILY-ANYA-PRIZE",
      ipId: "spy-x-family",
      characterIds: [],
      category: "figure",
      name: "아냐 포저 봉제 마스코트",
      manufacturer: null,
      releaseDate: null,
      price: 0,
      availableQuantity: 0,
      metadata: {},
      imageUrl: null,
      isActive: true,
      isPrizeOnly: false,
      version: 1,
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
    },
  });
});

test("admin product update rejects changing the immutable prize-only role", async () => {
  const { app, routes } = routeHarness();
  const pool = transactionPool(async (sql) => {
    if (sql.includes("INSERT INTO idempotency_keys")) {
      return { rowCount: 1, rows: [{ id: "44444444-4444-4444-8444-444444444444" }] };
    }
    if (sql.includes("FROM catalog_products p JOIN product_stock")) {
      return { rowCount: 1, rows: [productRow()] };
    }
    return { rowCount: 0, rows: [] };
  });
  await registerCatalogRoutes(app, contextWithPool(pool));
  const handler = routes.get("PATCH /v1/admin/products/:productId");
  assert.ok(handler);
  await assert.rejects(
    handler(adminRequest({
      method: "PATCH",
      path: "/v1/admin/products/:productId",
      params: { productId: "spy-x-family-anya-prize" },
      body: {
        sku: "SPY-X-FAMILY-ANYA-PRIZE",
        ipId: "spy-x-family",
        category: "figure",
        name: "아냐 포저 봉제 마스코트",
        price: 0,
        availableQuantity: 0,
        metadata: {},
        isActive: true,
        isPrizeOnly: false,
        expectedVersion: 1,
      },
    }), {}),
    (error: unknown) => error instanceof AppError
      && error.statusCode === 409
      && /경품 전용 여부/.test(error.message),
  );
});

test("catalog request canonical product targets exclude prize-only SKUs", async () => {
  const { app, routes } = routeHarness();
  let canonicalLookupSql = "";
  const pool = transactionPool(async (sql) => {
    if (sql.includes("INSERT INTO idempotency_keys")) {
      return { rowCount: 1, rows: [{ id: "55555555-5555-4555-8555-555555555555" }] };
    }
    if (sql.includes("FROM catalog_requests WHERE id=$1")) {
      return {
        rowCount: 1,
        rows: [{
          id: "66666666-6666-4666-8666-666666666666",
          user_id: "77777777-7777-4777-8777-777777777777",
          kind: "PRODUCT",
          name: "아냐 경품",
          reference_url: null,
          description: null,
          media_id: null,
          status: "PENDING",
          canonical_target_id: null,
          decision_reason: null,
          created_at: new Date("2026-08-25T00:00:00.000Z"),
          updated_at: new Date("2026-08-25T00:00:00.000Z"),
        }],
      };
    }
    if (sql.includes("FROM catalog_products p JOIN catalog_ips")) {
      canonicalLookupSql = sql;
      return { rowCount: 1, rows: [{ is_active: false }] };
    }
    return { rowCount: 0, rows: [] };
  });
  await registerCatalogRoutes(app, contextWithPool(pool));
  const handler = routes.get("POST /v1/admin/catalog-requests/:requestId/decision");
  assert.ok(handler);
  await assert.rejects(
    handler(adminRequest({
      method: "POST",
      path: "/v1/admin/catalog-requests/:requestId/decision",
      params: { requestId: "66666666-6666-4666-8666-666666666666" },
      body: {
        decision: "APPROVED",
        reason: "catalog test reason",
        canonicalTargetId: "spy-x-family-anya-prize",
      },
    }), {}),
    (error: unknown) => error instanceof AppError && error.statusCode === 409,
  );
  assert.match(canonicalLookupSql, /NOT p\.is_prize_only/);
});
