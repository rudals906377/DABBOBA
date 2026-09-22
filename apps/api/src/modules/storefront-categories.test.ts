import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import type { ApiContext } from "../types.js";
import { registerStorefrontCategoryRoutes } from "./storefront-categories.js";

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
    app: { get: register("GET"), patch: register("PATCH") } as unknown as FastifyInstance,
    routes,
  };
}

const row = {
  category: "gacha",
  label: "가챠",
  sort_order: 10,
  availability: "active",
  show_on_home: true,
  show_on_catalog: true,
  show_on_exchange: true,
  show_on_wanted: true,
  description: "캡슐을 열어 상품을 확인해요.",
  image_url: null,
  icon_key: "capsule",
  version: 1,
  created_at: new Date("2026-09-10T00:00:00.000Z"),
  updated_at: new Date("2026-09-10T00:00:00.000Z"),
};

const authStub = {
  requirePermission: () => async () => undefined,
};

test("public category settings return ordered presentation data without caching", async () => {
  const observed: string[] = [];
  const context = {
    auth: authStub,
    pool: {
      async query(sql: string) {
        observed.push(sql);
        return { rowCount: 1, rows: [row] };
      },
    },
  } as unknown as ApiContext;
  const { app, routes } = routeHarness();
  await registerStorefrontCategoryRoutes(app, context);
  const handler = routes.get("GET /v1/catalog/category-settings");
  assert.ok(handler);
  const headers = new Map<string, string>();
  const result = await handler({}, { header(name: string, value: string) { headers.set(name, value); return this; } }) as {
    items: Array<{ category: string; label: string; showOnHome: boolean }>;
  };
  assert.deepEqual(result.items.map((item) => [item.category, item.label, item.showOnHome]), [["gacha", "가챠", true]]);
  assert.equal(headers.get("cache-control"), "no-store, max-age=0");
  assert.match(observed[0]!, /ORDER BY sort_order ASC, category ASC/);
});

test("category setting mutation rejects unknown domain category before database work", async () => {
  const context = {
    auth: authStub,
    pool: { async query() { throw new Error("database should not be reached"); } },
  } as unknown as ApiContext;
  const { app, routes } = routeHarness();
  await registerStorefrontCategoryRoutes(app, context);
  const handler = routes.get("PATCH /v1/admin/category-settings/:category");
  assert.ok(handler);
  await assert.rejects(
    () => handler({ params: { category: "custom-draw" }, body: {} }, {}),
    /category 값을 확인해 주세요/,
  );
});
