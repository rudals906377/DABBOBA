import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import { DEMO_SELLER_PRODUCT_IDS } from "../lib/demo-testing.js";
import type { ApiContext } from "../types.js";
import { opaqueClientKey } from "../lib/rate-limit-key.js";
import { HOME_PRODUCT_CLICK_LIMIT_PER_MINUTE, homeProductClickDedupeId, registerHomeCatalogRoutes } from "./home-catalog.js";

type Handler = (request: Record<string, unknown>, reply: Record<string, unknown>) => Promise<unknown>;

function routeHarness() {
  const routes = new Map<string, Handler>();
  const options = new Map<string, Record<string, unknown>>();
  const register = (method: string) => (...args: unknown[]) => {
    const path = args[0];
    const handler = args.at(-1);
    if (typeof path !== "string" || typeof handler !== "function") throw new Error("invalid route");
    routes.set(`${method} ${path}`, handler as Handler);
    if (args.length > 2 && args[1] && typeof args[1] === "object") {
      options.set(`${method} ${path}`, args[1] as Record<string, unknown>);
    }
  };
  return {
    app: { get: register("GET"), post: register("POST"), patch: register("PATCH") } as unknown as FastifyInstance,
    routes,
    options,
  };
}

const TEST_PEPPER = "home-catalog-test-pepper-value";

const authStub = {
  requireUser: async () => undefined,
  requireAdmin: async () => undefined,
  requireSuperAdmin: async () => undefined,
  requirePermission: () => async () => undefined,
};

const sectionRow = {
  id: "demon-slayer-featured",
  title: "귀멸의 칼날 컬렉션",
  subtitle: "이번 주 추천 상품",
  ip_id: "demon-slayer",
  layout_kind: "gacha" as const,
  source_kind: "IP" as const,
  visible_limit: 20,
  manual_product_ids: [],
  sort_order: 10,
  is_active: true,
  version: 1,
  created_at: new Date("2026-09-05T00:00:00.000Z"),
  updated_at: new Date("2026-09-05T00:00:00.000Z"),
};

const publicSectionRow = {
  ...sectionRow,
  layout_kind: "kuji" as const,
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
  total_quantity: 120,
  metadata: {},
  image_url: null,
  storefront_image_url: "https://cdn.example.test/demon-slayer-gacha-storefront.webp",
  is_active: true,
  is_prize_only: false,
  sale_status: "ON_SALE",
  character_ids: [],
  version: 1,
  created_at: new Date("2026-09-04T00:00:00.000Z"),
  updated_at: new Date("2026-09-04T00:00:00.000Z"),
};

function contextWithPool(pool: Record<string, unknown>, catalogMediaBaseUrl: string | null = null) {
  return {
    pool,
    auth: authStub,
    config: { catalogMediaBaseUrl, sessionTokenPepper: TEST_PEPPER, trustedClientIpHeader: null },
  } as unknown as ApiContext;
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

const readReply = { header() { return this; } };

test("public Home sections are render-ready, stably ordered, and distinguish an empty configuration", async () => {
  const { app, routes } = routeHarness();
  const snapshot = publicSnapshotPool(async (sql) => {
    if (sql.includes("information_schema.columns")) {
      return { rowCount: 1, rows: [{ configured: true, supports_section_sources: true }] };
    }
    if (sql.includes("GROUP BY click_event.product_id")) return { rowCount: 1, rows: [{ product_id: productRow.id }] };
    if (sql.includes("FROM home_catalog_sections s")) return { rowCount: 1, rows: [publicSectionRow] };
    if (sql.includes("FROM section_targets section_target")) return { rowCount: 1, rows: [{
      ...productRow,
      home_section_id: publicSectionRow.id,
      category: "kuji",
      remaining_kuji_tiers: [{
        tierCode: "LAST_ONE",
        tierRank: "0",
        label: "라스트원",
        initialQuantity: "1",
        remainingQuantity: "1",
      }],
    }] };
    throw new Error(`unexpected query: ${sql}`);
  });
  const context = contextWithPool(snapshot.pool);

  await registerHomeCatalogRoutes(app, context);
  const handler = routes.get("GET /v1/catalog/home-sections");
  assert.ok(handler);
  const result = await handler({ query: {} }, readReply) as {
    configured: boolean;
    bestProductId: string | null;
    evaluatedAt: string;
    items: Array<{
      id: string;
      title: string;
      layoutKind: "gacha" | "kuji";
      ip: { id: string };
      products: Array<{
        id: string;
        totalQuantity: number | null;
        storefrontImageUrl: string | null;
        remainingKujiTiers: Array<{ label: string; remainingQuantity: number }>;
      }>;
    }>;
  };

  assert.equal(result.configured, true);
  assert.equal(result.bestProductId, productRow.id);
  assert.equal(Number.isNaN(Date.parse(result.evaluatedAt)), false);
  assert.deepEqual(result.items.map((item) => [item.id, item.title, item.layoutKind, item.ip.id, item.products[0]?.id]), [[
    "demon-slayer-featured",
    "귀멸의 칼날 컬렉션",
    "kuji",
    "demon-slayer",
    "demon-slayer-gacha",
  ]]);
  assert.equal(result.items[0]?.products[0]?.totalQuantity, 120);
  assert.equal(result.items[0]?.products[0]?.storefrontImageUrl, productRow.storefront_image_url);
  assert.deepEqual(result.items[0]?.products[0]?.remainingKujiTiers, [{
    tierCode: "LAST_ONE",
    tierRank: 0,
    label: "라스트원",
    initialQuantity: 1,
    remainingQuantity: 1,
  }]);
  assert.equal(snapshot.observed[0]?.sql, "BEGIN");
  assert.equal(snapshot.observed[1]?.sql, "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(snapshot.observed.at(-1)?.sql, "COMMIT");
  assert.equal(snapshot.released(), true);
  assert.match(snapshot.observed.find(({ sql }) => sql.includes("FROM home_catalog_sections s"))!.sql, /ORDER BY s\.sort_order ASC, s\.id ASC/);
  assert.match(snapshot.observed.find(({ sql }) => sql.includes("FROM home_catalog_sections s"))!.sql, /s\.layout_kind IS NOT NULL/);
  assert.match(snapshot.observed.find(({ sql }) => sql.includes("FROM section_targets section_target"))!.sql, /p\.category=section_target\.layout_kind/);
  assert.match(snapshot.observed.find(({ sql }) => sql.includes("FROM section_targets section_target"))!.sql, /p\.is_prize_only = false/);
  assert.match(snapshot.observed.find(({ sql }) => sql.includes("FROM section_targets section_target"))!.sql, /category_setting\.availability='active'/);
  assert.match(snapshot.observed.find(({ sql }) => sql.includes("FROM section_targets section_target"))!.sql, /category_setting\.show_on_home=true/);
  assert.match(snapshot.observed.find(({ sql }) => sql.includes("FROM section_targets section_target"))!.sql, /PARTITION BY candidate_product\.home_section_id/);
  assert.match(snapshot.observed.find(({ sql }) => sql.includes("FROM section_targets section_target"))!.sql, /home_rank <= visible_limit/);
  assert.match(snapshot.observed.find(({ sql }) => sql.includes("FROM section_targets section_target"))!.sql, /source_kind='NEW'.*30 days/s);
  assert.match(snapshot.observed.find(({ sql }) => sql.includes("FROM section_targets section_target"))!.sql, /source_kind='POPULAR'.*popularity_score/s);
  assert.match(snapshot.observed.find(({ sql }) => sql.includes("FROM section_targets section_target"))!.sql, /source_kind='MANUAL'.*manual_sort_order/s);
  assert.match(snapshot.observed.find(({ sql }) => sql.includes("FROM section_targets section_target"))!.sql, /deck\.total_slots/);
  assert.match(snapshot.observed.find(({ sql }) => sql.includes("FROM section_targets section_target"))!.sql, /count\(entry\.initial_quantity\)=count\(entry\.id\)/);
  assert.match(snapshot.observed.find(({ sql }) => sql.includes("FROM section_targets section_target"))!.sql, /entry\.remaining_quantity>0/);
  assert.match(snapshot.observed.find(({ sql }) => sql.includes("FROM section_targets section_target"))!.sql, /active_version\.status='ACTIVE'/);
  assert.deepEqual(
    snapshot.observed.find(({ sql }) => sql.includes("FROM section_targets section_target"))!.values,
    [[publicSectionRow.id], ["demon-slayer"], ["kuji"], ["IP"], [20], null, [...DEMO_SELLER_PRODUCT_IDS]],
  );
});

test("prelaunch Home cards do not expose unconfirmed stock or kuji tier counts", async () => {
  const { app, routes } = routeHarness();
  const snapshot = publicSnapshotPool(async (sql) => {
    if (sql.includes("information_schema.columns")) {
      return { rowCount: 1, rows: [{ configured: true, supports_section_sources: true }] };
    }
    if (sql.includes("GROUP BY click_event.product_id")) return { rowCount: 0, rows: [] };
    if (sql.includes("FROM home_catalog_sections s")) return { rowCount: 1, rows: [publicSectionRow] };
    if (sql.includes("FROM section_targets section_target")) return { rowCount: 1, rows: [{
      ...productRow,
      home_section_id: publicSectionRow.id,
      category: "kuji",
      sale_status: "COMING_SOON",
      available_quantity: 100,
      total_quantity: 100,
      remaining_kuji_tiers: [{
        tierCode: "A", tierRank: "0", label: "A상", initialQuantity: "1", remainingQuantity: "1",
      }],
    }] };
    throw new Error(`unexpected query: ${sql}`);
  });
  const context = {
    ...contextWithPool(snapshot.pool),
    config: { environment: "test", commerceMode: "PRELAUNCH" },
  } as unknown as ApiContext;
  await registerHomeCatalogRoutes(app, context);
  const handler = routes.get("GET /v1/catalog/home-sections");
  assert.ok(handler);
  const result = await handler({ query: {} }, readReply) as {
    items: Array<{ products: Array<{ availableQuantity: number; totalQuantity: number | null; remainingKujiTiers: unknown[] }> }>;
  };
  assert.equal(result.items[0]?.products[0]?.availableQuantity, 0);
  assert.equal(result.items[0]?.products[0]?.totalQuantity, null);
  assert.deepEqual(result.items[0]?.products[0]?.remainingKujiTiers, []);
});

test("public Home sections isolate Gacha and Kuji products by section id even when they share one IP", async () => {
  const { app, routes } = routeHarness();
  const gachaSection = {
    ...publicSectionRow,
    id: "demon-slayer-gacha-home",
    title: "귀멸의 칼날 가챠",
    layout_kind: "gacha" as const,
    sort_order: 10,
  };
  const kujiSection = {
    ...publicSectionRow,
    id: "demon-slayer-kuji-home",
    title: "귀멸의 칼날 쿠지",
    layout_kind: "kuji" as const,
    sort_order: 20,
  };
  const snapshot = publicSnapshotPool(async (sql) => {
    if (sql.includes("information_schema.columns")) {
      return { rowCount: 1, rows: [{ configured: true, supports_section_sources: true }] };
    }
    if (sql.includes("GROUP BY click_event.product_id")) return { rowCount: 0, rows: [] };
    if (sql.includes("FROM home_catalog_sections s")) return { rowCount: 2, rows: [gachaSection, kujiSection] };
    if (sql.includes("FROM section_targets section_target")) return {
      rowCount: 2,
      rows: [
        { ...productRow, home_section_id: gachaSection.id, category: "gacha", remaining_kuji_tiers: [] },
        { ...productRow, home_section_id: kujiSection.id, id: "demon-slayer-kuji", sku: "DS-KUJI", category: "kuji", remaining_kuji_tiers: [] },
      ],
    };
    throw new Error(`unexpected query: ${sql}`);
  });
  await registerHomeCatalogRoutes(app, contextWithPool(snapshot.pool));

  const handler = routes.get("GET /v1/catalog/home-sections");
  assert.ok(handler);
  const result = await handler({ query: {} }, readReply) as {
    items: Array<{ id: string; layoutKind: "gacha" | "kuji"; products: Array<{ category: string }> }>;
  };

  assert.deepEqual(result.items.map((section) => ({
    id: section.id,
    layoutKind: section.layoutKind,
    productCategories: section.products.map((product) => product.category),
  })), [
    { id: gachaSection.id, layoutKind: "gacha", productCategories: ["gacha"] },
    { id: kujiSection.id, layoutKind: "kuji", productCategories: ["kuji"] },
  ]);
  assert.deepEqual(
    snapshot.observed.find(({ sql }) => sql.includes("FROM section_targets section_target"))?.values,
    [
      [gachaSection.id, kujiSection.id],
      ["demon-slayer", "demon-slayer"],
      ["gacha", "kuji"],
      ["IP", "IP"],
      [20, 20],
      null,
      [...DEMO_SELLER_PRODUCT_IDS],
    ],
  );
});

test("public Home sections support a globally curated manual source with bounded ordered products", async () => {
  const { app, routes } = routeHarness();
  const manualSection = {
    ...publicSectionRow,
    id: "operator-picks",
    title: "오늘의 인기상품",
    subtitle: "운영자가 고른 상품",
    ip_id: null,
    source_kind: "MANUAL" as const,
    visible_limit: 2,
    ip_slug: null,
    ip_name_ko: null,
    ip_name_en: null,
    ip_name_ja: null,
    ip_aliases: null,
    ip_description: null,
    ip_image_url: null,
    ip_is_active: null,
    ip_version: null,
    ip_created_at: null,
    ip_updated_at: null,
  };
  const snapshot = publicSnapshotPool(async (sql) => {
    if (sql.includes("information_schema.columns")) {
      return { rowCount: 1, rows: [{ configured: true, supports_section_sources: true }] };
    }
    if (sql.includes("GROUP BY click_event.product_id")) return { rowCount: 0, rows: [] };
    if (sql.includes("FROM home_catalog_sections s")) return { rowCount: 1, rows: [manualSection] };
    if (sql.includes("FROM section_targets section_target")) return {
      rowCount: 1,
      rows: [{ ...productRow, home_section_id: manualSection.id, category: "kuji", remaining_kuji_tiers: [] }],
    };
    throw new Error(`unexpected query: ${sql}`);
  });
  await registerHomeCatalogRoutes(app, contextWithPool(snapshot.pool));

  const handler = routes.get("GET /v1/catalog/home-sections");
  assert.ok(handler);
  const result = await handler({ query: {} }, readReply) as {
    items: Array<{ subtitle: string | null; sourceKind: string; visibleLimit: number; ip: null }>;
  };

  assert.deepEqual(result.items.map(({ subtitle, sourceKind, visibleLimit, ip }) => ({ subtitle, sourceKind, visibleLimit, ip })), [{
    subtitle: "운영자가 고른 상품",
    sourceKind: "MANUAL",
    visibleLimit: 2,
    ip: null,
  }]);
  const productQuery = snapshot.observed.find(({ sql }) => sql.includes("FROM section_targets section_target"));
  assert.deepEqual(productQuery?.values, [[manualSection.id], [null], ["kuji"], ["MANUAL"], [2], null, [...DEMO_SELLER_PRODUCT_IDS]]);
  assert.match(productQuery!.sql, /LEFT JOIN home_catalog_section_products manual_product/);
  assert.match(productQuery!.sql, /manual_product\.sort_order/);
});

test("public Home sections preserve configured=true when every configured rail is hidden", async () => {
  const { app, routes } = routeHarness();
  const snapshot = publicSnapshotPool(async (sql) => {
    if (sql.includes("information_schema.columns")) {
      return { rowCount: 1, rows: [{ configured: true, supports_section_sources: true }] };
    }
    if (sql.includes("GROUP BY click_event.product_id")) return { rowCount: 0, rows: [] };
    if (sql.includes("FROM home_catalog_sections s")) return { rowCount: 0, rows: [] };
    throw new Error(`unexpected query: ${sql}`);
  });
  await registerHomeCatalogRoutes(app, contextWithPool(snapshot.pool));

  const handler = routes.get("GET /v1/catalog/home-sections");
  assert.ok(handler);
  const result = await handler({ query: {} }, readReply) as { configured: boolean; items: unknown[]; bestProductId: string | null; evaluatedAt: string };
  assert.equal(result.configured, true);
  assert.deepEqual(result.items, []);
  assert.equal(result.bestProductId, null);
  assert.equal(Number.isNaN(Date.parse(result.evaluatedAt)), false);
});

test("public Home sections return a truthful empty state before the first operator configuration", async () => {
  const { app, routes } = routeHarness();
  const snapshot = publicSnapshotPool(async (sql) => {
    if (sql.includes("information_schema.columns")) {
      return { rowCount: 1, rows: [{ configured: false, supports_section_sources: true }] };
    }
    if (sql.includes("GROUP BY click_event.product_id")) return { rowCount: 0, rows: [] };
    if (sql.includes("FROM home_catalog_sections s")) return { rowCount: 0, rows: [] };
    throw new Error(`unexpected query: ${sql}`);
  });
  await registerHomeCatalogRoutes(app, contextWithPool(snapshot.pool));

  const handler = routes.get("GET /v1/catalog/home-sections");
  assert.ok(handler);
  const result = await handler({ query: {} }, readReply) as { configured: boolean; items: unknown[]; bestProductId: string | null; evaluatedAt: string };
  assert.equal(result.configured, false);
  assert.deepEqual(result.items, []);
  assert.equal(result.bestProductId, null);
  assert.equal(Number.isNaN(Date.parse(result.evaluatedAt)), false);
});

test("public Home sections return the unconfigured contract when the layout column and operator rows are unavailable", async () => {
  const { app, routes } = routeHarness();
  const snapshot = publicSnapshotPool(async (sql) => {
    if (sql.includes("information_schema.columns")) {
      return {
        rowCount: 1,
        rows: [{ configured: false, supports_section_sources: false }],
      };
    }
    throw new Error(`pre-layout schema must not run typed Home queries: ${sql}`);
  });
  await registerHomeCatalogRoutes(app, contextWithPool(snapshot.pool));

  const handler = routes.get("GET /v1/catalog/home-sections");
  assert.ok(handler);
  const result = await handler({ query: {} }, readReply) as {
    configured: boolean;
    items: unknown[];
    bestProductId: string | null;
    evaluatedAt: string;
  };

  assert.equal(result.configured, false);
  assert.deepEqual(result.items, []);
  assert.equal(result.bestProductId, null);
  assert.equal(Number.isNaN(Date.parse(result.evaluatedAt)), false);
  assert.match(
    snapshot.observed.find(({ sql }) => sql.includes("information_schema.columns"))!.sql,
    /information_schema\.columns/,
  );
  assert.equal(snapshot.observed.some(({ sql }) => sql.includes("FROM home_catalog_sections s")), false);
  assert.equal(snapshot.observed.some(({ sql }) => sql.includes("FROM home_product_click_events")), false);
  assert.equal(snapshot.observed.at(-1)?.sql, "COMMIT");
  assert.equal(snapshot.released(), true);
});

test("public Home sections preserve configured state for unclassified legacy rows", async () => {
  const { app, routes } = routeHarness();
  const snapshot = publicSnapshotPool(async (sql) => {
    if (sql.includes("information_schema.columns")) {
      return {
        rowCount: 1,
        rows: [{ configured: true, supports_section_sources: false }],
      };
    }
    throw new Error(`pre-layout schema must not expose unclassified rows: ${sql}`);
  });
  await registerHomeCatalogRoutes(app, contextWithPool(snapshot.pool));

  const handler = routes.get("GET /v1/catalog/home-sections");
  assert.ok(handler);
  const result = await handler({ query: {} }, readReply) as {
    configured: boolean;
    items: unknown[];
    bestProductId: string | null;
    evaluatedAt: string;
  };

  assert.equal(result.configured, true);
  assert.deepEqual(result.items, []);
  assert.equal(result.bestProductId, null);
  assert.equal(Number.isNaN(Date.parse(result.evaluatedAt)), false);
  assert.equal(snapshot.observed.some(({ sql }) => sql.includes("FROM home_catalog_sections s")), false);
  assert.equal(snapshot.observed.some(({ sql }) => sql.includes("FROM home_product_click_events")), false);
  assert.equal(snapshot.observed.at(-1)?.sql, "COMMIT");
  assert.equal(snapshot.released(), true);
});

test("public Home recent draws expose only immutable prize snapshots without customer identity", async () => {
  const { app, routes } = routeHarness();
  const committedAt = new Date("2026-09-12T07:30:00.000Z");
  const mediaId = "11111111-1111-4111-8111-111111111111";
  const currentBase = "https://rconfxsykttfvznakile.supabase.co/functions/v1/dabboba-api";
  const observed: Array<{ sql: string; values: unknown[] }> = [];
  const pool = transactionPool(async (sql, values = []) => {
    observed.push({ sql, values });
    if (sql.includes("FROM draw_results result")) {
      return {
        rowCount: 1,
        rows: [{
          id: "55555555-5555-4555-8555-555555555555",
          product_id: productRow.id,
          category: "gacha",
          prize_name_snapshot: "리치 피규어",
          prize_image_url_snapshot: `https://yxkmvgfruphgghowzvmo.supabase.co/functions/v1/dabboba-api/v1/catalog/media/${mediaId}/image`,
          rarity: "A",
          committed_at: committedAt,
        }],
      };
    }
    return { rowCount: 0, rows: [] };
  });
  await registerHomeCatalogRoutes(app, contextWithPool(pool, currentBase));

  const handler = routes.get("GET /v1/catalog/recent-draws");
  assert.ok(handler);
  const capture = replyCapture();
  const result = await handler({ query: {} }, capture.reply) as {
    serverNow: string;
    items: Array<Record<string, unknown>>;
  };

  assert.equal(Number.isNaN(Date.parse(result.serverNow)), false);
  assert.deepEqual(result.items, [{
    id: "55555555-5555-4555-8555-555555555555",
    productId: productRow.id,
    category: "gacha",
    prizeName: "리치 피규어",
    prizeImageUrl: `${currentBase}/v1/catalog/media/${mediaId}/image`,
    rarity: "A",
    committedAt: committedAt.toISOString(),
  }]);
  assert.equal(Object.hasOwn(result.items[0]!, "displayName"), false);
  assert.equal(Object.hasOwn(result.items[0]!, "userId"), false);
  assert.deepEqual(observed.find(({ sql }) => sql.includes("FROM draw_results result"))?.values, [
    null,
    [...DEMO_SELLER_PRODUCT_IDS],
    2,
  ]);
  assert.match(observed.find(({ sql }) => sql.includes("FROM draw_results result"))!.sql, /ORDER BY result\.committed_at DESC,result\.id DESC/);
  assert.doesNotMatch(observed.find(({ sql }) => sql.includes("FROM draw_results result"))!.sql, /JOIN users|nickname|user_id/i);
});

test("Home product clicks are recorded once and immediately update the BEST product", async () => {
  const { app, routes, options } = routeHarness();
  const eventId = "55555555-5555-4555-8555-555555555555";
  const observed: Array<{ sql: string; values: unknown[] }> = [];
  const pool = transactionPool(async (sql, values = []) => {
    observed.push({ sql, values });
    if (sql.includes("SELECT product.id")) return { rowCount: 1, rows: [{ id: productRow.id }] };
    if (sql.includes("INSERT INTO home_product_click_events")) return { rowCount: 1, rows: [{ product_id: productRow.id }] };
    if (sql.includes("FROM home_product_click_events click_event")) return { rowCount: 1, rows: [{ product_id: productRow.id }] };
    return { rowCount: 0, rows: [] };
  });
  await registerHomeCatalogRoutes(app, contextWithPool(pool));

  const route = "POST /v1/catalog/home-product-clicks/:productId";
  const handler = routes.get(route);
  assert.ok(handler);
  assert.deepEqual(options.get(route)?.config, {
    rateLimit: { max: HOME_PRODUCT_CLICK_LIMIT_PER_MINUTE, timeWindow: "1 minute" },
  });
  assert.equal(HOME_PRODUCT_CLICK_LIMIT_PER_MINUTE, 30);
  const request = (ip: string, clientEventId: string) => ({
    params: { productId: productRow.id },
    body: { eventId: clientEventId },
    headers: {},
    ip,
    routeOptions: { url: "/v1/catalog/home-product-clicks/:productId" },
  });
  const result = await handler(request("203.0.113.7", eventId), {}) as {
    bestProductId: string | null;
    evaluatedAt: string;
  };
  await handler(request("203.0.113.7", "66666666-6666-4666-8666-666666666666"), {});
  await handler(request("198.51.100.4", eventId), {});

  assert.equal(result.bestProductId, productRow.id);
  assert.equal(Number.isNaN(Date.parse(result.evaluatedAt)), false);
  const inserts = observed.filter(({ sql }) => sql.includes("INSERT INTO home_product_click_events"));
  assert.equal(inserts.length, 3);
  assert.match(inserts[0]!.sql, /ON CONFLICT \(id\) DO NOTHING/);
  // The stored id is server-derived: a new client event id from the same
  // caller maps to the same row, while another caller gets its own row.
  assert.equal(inserts[0]!.values[1], productRow.id);
  assert.notEqual(inserts[0]!.values[0], eventId);
  assert.equal(inserts[1]!.values[0], inserts[0]!.values[0]);
  assert.notEqual(inserts[2]!.values[0], inserts[0]!.values[0]);
  assert.match(String(inserts[0]!.values[0]), /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.doesNotMatch(JSON.stringify(observed), /203\.0\.113\.7|198\.51\.100\.4/);
});

test("Home click dedupe ids are stable within one hour and rotate across hours and products", () => {
  const clientKey = opaqueClientKey("ip:203.0.113.7", TEST_PEPPER);
  const base = { clientKey, productId: productRow.id, pepper: TEST_PEPPER };
  const hour = Date.UTC(2026, 8, 30, 3);
  const first = homeProductClickDedupeId({ ...base, now: hour + 1_000 });
  assert.equal(homeProductClickDedupeId({ ...base, now: hour + 3_599_000 }), first);
  assert.notEqual(homeProductClickDedupeId({ ...base, now: hour + 3_600_000 }), first);
  assert.notEqual(homeProductClickDedupeId({ ...base, productId: "other-product", now: hour + 1_000 }), first);
  assert.notEqual(homeProductClickDedupeId({ ...base, pepper: "another-pepper-value", now: hour + 1_000 }), first);
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
  const result = await handler({ query: {} }, {}) as { configured: boolean; items: Array<{ isActive: boolean; ipId: string | null; layoutKind: "gacha" | "kuji" | null; sourceKind: string; visibleLimit: number; manualProductIds: string[] }> };
  assert.equal(result.configured, true);
  assert.deepEqual(result.items.map((item) => [item.ipId, item.layoutKind, item.isActive]), [["demon-slayer", "gacha", false]]);
  assert.deepEqual(result.items.map((item) => [item.sourceKind, item.visibleLimit, item.manualProductIds]), [["IP", 20, []]]);
  assert.match(capturedSql, /ORDER BY section\.sort_order ASC, section\.id ASC/);
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
      subtitle: sectionRow.subtitle,
      ipId: sectionRow.ip_id,
      layoutKind: sectionRow.layout_kind,
      sourceKind: sectionRow.source_kind,
      visibleLimit: sectionRow.visible_limit,
      manualProductIds: [],
      sortOrder: sectionRow.sort_order,
      isActive: sectionRow.is_active,
    },
  }), capture.reply);

  assert.equal(capture.result().statusCode, 201);
  assert.deepEqual((capture.result().body as { id: string; ipId: string }).id, sectionRow.id);
  assert.deepEqual(
    observed.find(({ sql }) => sql.includes("INSERT INTO home_catalog_sections"))?.values,
    [
      sectionRow.id,
      sectionRow.title,
      sectionRow.subtitle,
      sectionRow.ip_id,
      sectionRow.layout_kind,
      sectionRow.source_kind,
      sectionRow.visible_limit,
      sectionRow.sort_order,
      sectionRow.is_active,
    ],
  );
  assert.ok(observed.some(({ sql }) => sql.includes("INSERT INTO admin_audit_logs")));
  assert.ok(observed.some(({ sql }) => sql.includes("INSERT INTO outbox_events")));
});

test("admin Home section mutations require an explicit Gacha or Kuji layout", async () => {
  const { app, routes } = routeHarness();
  await registerHomeCatalogRoutes(app, contextWithPool({
    async query() { throw new Error("invalid input must fail before database access"); },
  }));
  const handler = routes.get("POST /v1/admin/home-sections");
  assert.ok(handler);
  const body = {
    id: sectionRow.id,
    title: sectionRow.title,
    subtitle: sectionRow.subtitle,
    ipId: sectionRow.ip_id,
    sourceKind: sectionRow.source_kind,
    visibleLimit: sectionRow.visible_limit,
    manualProductIds: [],
    sortOrder: sectionRow.sort_order,
    isActive: false,
  };

  await assert.rejects(
    () => handler(adminRequest({ method: "POST", path: "/v1/admin/home-sections", body }), replyCapture().reply),
    /layoutKind/,
  );
  await assert.rejects(
    () => handler(adminRequest({ method: "POST", path: "/v1/admin/home-sections", body: { ...body, layoutKind: "figure" } }), replyCapture().reply),
    /layoutKind/,
  );
});

test("admin can preserve manual product order for a global Home section", async () => {
  const { app, routes } = routeHarness();
  const manualProductIds = ["demon-slayer-gacha", "pokemon-gacha"];
  const observed: Array<{ sql: string; values: unknown[] }> = [];
  const pool = transactionPool(async (sql, values = []) => {
    observed.push({ sql, values });
    if (sql.includes("INSERT INTO idempotency_keys")) {
      return { rowCount: 1, rows: [{ id: "33333333-3333-4333-8333-333333333333" }] };
    }
    if (sql.includes("FROM catalog_products") && sql.includes("id=ANY")) {
      return {
        rowCount: 2,
        rows: manualProductIds.map((id) => ({ id, ip_id: id.startsWith("pokemon") ? "pokemon" : "demon-slayer", category: "gacha" })),
      };
    }
    if (sql.includes("INSERT INTO home_catalog_sections")) {
      return { rowCount: 1, rows: [{
        ...sectionRow,
        id: "operator-picks",
        ip_id: null,
        source_kind: "MANUAL",
        visible_limit: 2,
      }] };
    }
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
      id: "operator-picks",
      title: "오늘의 인기상품",
      subtitle: "운영자 추천",
      ipId: null,
      layoutKind: "gacha",
      sourceKind: "MANUAL",
      visibleLimit: 2,
      manualProductIds,
      sortOrder: 0,
      isActive: false,
    },
  }), capture.reply);

  assert.equal(capture.result().statusCode, 201);
  assert.deepEqual(
    observed.find(({ sql }) => sql.includes("FROM catalog_products") && sql.includes("id=ANY"))?.values,
    [manualProductIds],
  );
  assert.deepEqual(
    observed.find(({ sql }) => sql.includes("INSERT INTO home_catalog_section_products"))?.values,
    ["operator-picks", manualProductIds],
  );
  assert.deepEqual(
    (capture.result().body as { ipId: string | null; sourceKind: string; manualProductIds: string[] }).manualProductIds,
    manualProductIds,
  );
});

test("admin updates use expectedVersion and preserve the durable section id", async () => {
  const { app, routes } = routeHarness();
  let updateValues: unknown[] = [];
  const pool = transactionPool(async (sql, values = []) => {
    if (sql.includes("INSERT INTO idempotency_keys")) {
      return { rowCount: 1, rows: [{ id: "44444444-4444-4444-8444-444444444444" }] };
    }
    if (sql.includes("FROM home_catalog_sections section") && sql.includes("FOR UPDATE OF section")) {
      return { rowCount: 1, rows: [sectionRow] };
    }
    if (sql.includes("SELECT 1 FROM catalog_ips")) return { rowCount: 1, rows: [{ exists: 1 }] };
    if (sql.includes("UPDATE home_catalog_sections")) {
      updateValues = values;
      return { rowCount: 1, rows: [{
        ...sectionRow,
        title: "새 컬렉션",
        subtitle: "새 추천 설명",
        layout_kind: "kuji",
        visible_limit: 8,
        sort_order: 20,
        version: 2,
      }] };
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
      subtitle: "새 추천 설명",
      ipId: sectionRow.ip_id,
      layoutKind: "kuji",
      sourceKind: "IP",
      visibleLimit: 8,
      manualProductIds: [],
      sortOrder: 20,
      isActive: true,
      expectedVersion: 1,
    },
  }), capture.reply);

  assert.equal(capture.result().statusCode, 200);
  assert.deepEqual(updateValues, [sectionRow.id, "새 컬렉션", "새 추천 설명", sectionRow.ip_id, "kuji", "IP", 8, 20, true, 1]);
  const body = capture.result().body as { id: string; title: string; layoutKind: "gacha" | "kuji" | null; version: number };
  assert.deepEqual(
    { id: body.id, title: body.title, layoutKind: body.layoutKind, version: body.version },
    { id: sectionRow.id, title: "새 컬렉션", layoutKind: "kuji", version: 2 },
  );
});
