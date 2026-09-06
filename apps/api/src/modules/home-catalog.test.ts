import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import type { ApiContext } from "../types.js";
import { registerHomeCatalogRoutes } from "./home-catalog.js";

type Handler = (request: Record<string, unknown>, reply: Record<string, unknown>) => Promise<unknown>;

function routeHarness() {
  const routes = new Map<string, Handler>();
  const register = (method: string) => (...args: unknown[]) => {
    const path = args[0];
    const handler = args.at(-1);
    if (typeof path !== "string" || typeof handler !== "function") throw new Error("invalid route");
    routes.set(`${method} ${path}`, handler as Handler);
  };
  return {
    app: { get: register("GET"), post: register("POST"), patch: register("PATCH") } as unknown as FastifyInstance,
    routes,
  };
}

const authStub = {
  requireUser: async () => undefined,
  requireAdmin: async () => undefined,
  requireSuperAdmin: async () => undefined,
  requirePermission: () => async () => undefined,
};

const sectionRow = {
  id: "demon-slayer-featured",
  title: "귀멸의 칼날 컬렉션",
  ip_id: "demon-slayer",
  sort_order: 10,
  is_active: true,
  version: 1,
  created_at: new Date("2026-09-05T00:00:00.000Z"),
  updated_at: new Date("2026-09-05T00:00:00.000Z"),
};

const publicSectionRow = {
  ...sectionRow,
  ip_slug: "demon-slayer",
  ip_name_ko: "귀멸의 칼날",
  ip_name_en: "Demon Slayer",
  ip_name_ja: null,
  ip_aliases: [],
  ip_description: "",
  ip_image_url: null,
  ip_is_active: true,
  ip_version: 1,
  ip_created_at: new Date("2026-08-25T00:00:00.000Z"),
  ip_updated_at: new Date("2026-08-25T00:00:00.000Z"),
};

const productRow = {
  id: "demon-slayer-gacha",
  sku: "DS-GACHA",
  ip_id: "demon-slayer",
  category: "gacha",
  name: "귀멸의 칼날 가챠",
  manufacturer: null,
  release_date: null,
  price: 5000,
  available_quantity: 12,
  metadata: {},
  image_url: null,
  is_active: true,
  is_prize_only: false,
  character_ids: [],
  version: 1,
  created_at: new Date("2026-09-04T00:00:00.000Z"),
  updated_at: new Date("2026-09-04T00:00:00.000Z"),
};

function contextWithPool(pool: Record<string, unknown>) {
  return { pool, auth: authStub } as unknown as ApiContext;
}

function transactionPool(query: (sql: string, values?: unknown[]) => Promise<{ rowCount: number; rows: unknown[] }>) {
  const client = { query, release() {} };
  return { async connect() { return client; } };
}

function publicSnapshotPool(
  query: (sql: string, values?: unknown[]) => Promise<{ rowCount: number | null; rows: unknown[] }>,
) {
  const observed: Array<{ sql: string; values: unknown[] }> = [];
  let released = false;
  return {
    observed,
    released: () => released,
    pool: {
      async query() {
        throw new Error("public Home snapshot must not use independent pool queries");
      },
      async connect() {
        return {
          async query(sql: string, values: unknown[] = []) {
            observed.push({ sql, values });
            if (["BEGIN", "COMMIT", "ROLLBACK", "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"].includes(sql)) {
              return { rowCount: null, rows: [] };
            }
            return query(sql, values);
          },
          release() { released = true; },
        };
      },
    },
  };
}

function adminRequest(input: { method: "POST" | "PATCH"; path: string; body: unknown; params?: Record<string, unknown> }) {
  return {
    id: "home-section-test-request",
    method: input.method,
    url: input.path,
    routeOptions: { url: input.path },
    params: input.params ?? {},
    query: {},
    body: input.body,
    headers: {
      "x-admin-reason": "home section test reason",
      "idempotency-key": `home-section-${input.method.toLowerCase()}-idempotency-key`,
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

test("public Home sections are render-ready, stably ordered, and distinguish an empty configuration", async () => {
  const { app, routes } = routeHarness();
  const snapshot = publicSnapshotPool(async (sql) => {
    if (sql.includes("SELECT EXISTS")) return { rowCount: 1, rows: [{ configured: true }] };
    if (sql.includes("FROM home_catalog_sections s")) return { rowCount: 1, rows: [publicSectionRow] };
    if (sql.includes("FROM catalog_products p")) return { rowCount: 1, rows: [productRow] };
    throw new Error(`unexpected query: ${sql}`);
  });
  const context = contextWithPool(snapshot.pool);

  await registerHomeCatalogRoutes(app, context);
  const handler = routes.get("GET /v1/catalog/home-sections");
  assert.ok(handler);
  const result = await handler({ query: {} }, {}) as {
    configured: boolean;
    items: Array<{ id: string; title: string; ip: { id: string }; products: Array<{ id: string }> }>;
  };

  assert.equal(result.configured, true);
  assert.deepEqual(result.items.map((item) => [item.id, item.title, item.ip.id, item.products[0]?.id]), [[
    "demon-slayer-featured",
    "귀멸의 칼날 컬렉션",
    "demon-slayer",
    "demon-slayer-gacha",
  ]]);
  assert.equal(snapshot.observed[0]?.sql, "BEGIN");
  assert.equal(snapshot.observed[1]?.sql, "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(snapshot.observed.at(-1)?.sql, "COMMIT");
  assert.equal(snapshot.released(), true);
  assert.match(snapshot.observed.find(({ sql }) => sql.includes("FROM home_catalog_sections s"))!.sql, /ORDER BY s\.sort_order ASC, s\.id ASC/);
  assert.match(snapshot.observed.find(({ sql }) => sql.includes("FROM catalog_products p"))!.sql, /p\.category IN \('gacha', 'kuji'\)/);
  assert.match(snapshot.observed.find(({ sql }) => sql.includes("FROM catalog_products p"))!.sql, /p\.is_prize_only = false/);
  assert.match(snapshot.observed.find(({ sql }) => sql.includes("FROM catalog_products p"))!.sql, /home_rank <= \$2/);
  assert.deepEqual(
    snapshot.observed.find(({ sql }) => sql.includes("FROM catalog_products p"))!.values,
    [["demon-slayer"], 20],
  );
});

test("public Home sections preserve configured=true when every configured rail is hidden", async () => {
  const { app, routes } = routeHarness();
  const snapshot = publicSnapshotPool(async (sql) => {
    if (sql.includes("SELECT EXISTS")) return { rowCount: 1, rows: [{ configured: true }] };
    if (sql.includes("FROM home_catalog_sections s")) return { rowCount: 0, rows: [] };
    throw new Error(`unexpected query: ${sql}`);
  });
  await registerHomeCatalogRoutes(app, contextWithPool(snapshot.pool));

  const handler = routes.get("GET /v1/catalog/home-sections");
  assert.ok(handler);
  assert.deepEqual(await handler({ query: {} }, {}), { configured: true, items: [] });
});

test("public Home sections leave legacy fallback available before the first configuration", async () => {
  const { app, routes } = routeHarness();
  const snapshot = publicSnapshotPool(async (sql) => {
    if (sql.includes("SELECT EXISTS")) return { rowCount: 1, rows: [{ configured: false }] };
    if (sql.includes("FROM home_catalog_sections s")) return { rowCount: 0, rows: [] };
    throw new Error(`unexpected query: ${sql}`);
  });
  await registerHomeCatalogRoutes(app, contextWithPool(snapshot.pool));

  const handler = routes.get("GET /v1/catalog/home-sections");
  assert.ok(handler);
  assert.deepEqual(await handler({ query: {} }, {}), { configured: false, items: [] });
});

test("admin Home section listing includes inactive records in configured order", async () => {
  const { app, routes } = routeHarness();
  let capturedSql = "";
  await registerHomeCatalogRoutes(app, contextWithPool({
    async query(sql: string) {
      capturedSql = sql;
      return { rowCount: 1, rows: [{ ...sectionRow, is_active: false }] };
    },
  }));

  const handler = routes.get("GET /v1/admin/home-sections");
  assert.ok(handler);
  const result = await handler({ query: {} }, {}) as { configured: boolean; items: Array<{ isActive: boolean; ipId: string }> };
  assert.equal(result.configured, true);
  assert.deepEqual(result.items.map((item) => [item.ipId, item.isActive]), [["demon-slayer", false]]);
  assert.match(capturedSql, /ORDER BY sort_order ASC, id ASC/);
});

test("admin can create and audit an IP-backed Home section idempotently", async () => {
  const { app, routes } = routeHarness();
  const observed: Array<{ sql: string; values: unknown[] }> = [];
  const pool = transactionPool(async (sql, values = []) => {
    observed.push({ sql, values });
    if (sql.includes("INSERT INTO idempotency_keys")) {
      return { rowCount: 1, rows: [{ id: "33333333-3333-4333-8333-333333333333" }] };
    }
    if (sql.includes("SELECT 1 FROM catalog_ips")) return { rowCount: 1, rows: [{ exists: 1 }] };
    if (sql.includes("INSERT INTO home_catalog_sections")) return { rowCount: 1, rows: [sectionRow] };
    if (sql.includes("SELECT host(ip_address)")) {
      return { rowCount: 1, rows: [{ ip_address: "127.0.0.1", user_agent: "home-section-test" }] };
    }
    return { rowCount: 0, rows: [] };
  });
  await registerHomeCatalogRoutes(app, contextWithPool(pool));
  const handler = routes.get("POST /v1/admin/home-sections");
  assert.ok(handler);
  const capture = replyCapture();
  await handler(adminRequest({
    method: "POST",
    path: "/v1/admin/home-sections",
    body: {
      id: sectionRow.id,
      title: sectionRow.title,
      ipId: sectionRow.ip_id,
      sortOrder: sectionRow.sort_order,
      isActive: sectionRow.is_active,
    },
  }), capture.reply);

  assert.equal(capture.result().statusCode, 201);
  assert.deepEqual((capture.result().body as { id: string; ipId: string }).id, sectionRow.id);
  assert.deepEqual(
    observed.find(({ sql }) => sql.includes("INSERT INTO home_catalog_sections"))?.values,
    [sectionRow.id, sectionRow.title, sectionRow.ip_id, sectionRow.sort_order, sectionRow.is_active],
  );
  assert.ok(observed.some(({ sql }) => sql.includes("INSERT INTO admin_audit_logs")));
  assert.ok(observed.some(({ sql }) => sql.includes("INSERT INTO outbox_events")));
});

test("admin updates use expectedVersion and preserve the durable section id", async () => {
  const { app, routes } = routeHarness();
  let updateValues: unknown[] = [];
  const pool = transactionPool(async (sql, values = []) => {
    if (sql.includes("INSERT INTO idempotency_keys")) {
      return { rowCount: 1, rows: [{ id: "44444444-4444-4444-8444-444444444444" }] };
    }
    if (sql.includes("FROM home_catalog_sections WHERE id=$1 FOR UPDATE")) {
      return { rowCount: 1, rows: [sectionRow] };
    }
    if (sql.includes("SELECT 1 FROM catalog_ips")) return { rowCount: 1, rows: [{ exists: 1 }] };
    if (sql.includes("UPDATE home_catalog_sections")) {
      updateValues = values;
      return { rowCount: 1, rows: [{ ...sectionRow, title: "새 컬렉션", sort_order: 20, version: 2 }] };
    }
    if (sql.includes("SELECT host(ip_address)")) {
      return { rowCount: 1, rows: [{ ip_address: "127.0.0.1", user_agent: "home-section-test" }] };
    }
    return { rowCount: 0, rows: [] };
  });
  await registerHomeCatalogRoutes(app, contextWithPool(pool));
  const handler = routes.get("PATCH /v1/admin/home-sections/:sectionId");
  assert.ok(handler);
  const capture = replyCapture();
  await handler(adminRequest({
    method: "PATCH",
    path: "/v1/admin/home-sections/:sectionId",
    params: { sectionId: sectionRow.id },
    body: {
      title: "새 컬렉션",
      ipId: sectionRow.ip_id,
      sortOrder: 20,
      isActive: true,
      expectedVersion: 1,
    },
  }), capture.reply);

  assert.equal(capture.result().statusCode, 200);
  assert.deepEqual(updateValues, [sectionRow.id, "새 컬렉션", sectionRow.ip_id, 20, true, 1]);
  const body = capture.result().body as { id: string; title: string; version: number };
  assert.deepEqual(
    { id: body.id, title: body.title, version: body.version },
    { id: sectionRow.id, title: "새 컬렉션", version: 2 },
  );
});
