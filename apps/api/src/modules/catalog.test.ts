import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import type { ApiContext } from "../types.js";
import { registerCatalogRoutes } from "./catalog.js";

type Handler = (request: Record<string, unknown>, reply: Record<string, unknown>) => Promise<unknown>;

test("public characters expose only active rows for an active IP with cursor pagination", async () => {
  const routes = new Map<string, Handler>();
  const register = (...args: unknown[]) => {
    const path = args[0];
    const handler = args.at(-1);
    if (typeof path !== "string" || typeof handler !== "function") throw new Error("invalid route");
    routes.set(path, handler as Handler);
  };
  const app = { get: register, post: register, patch: register } as unknown as FastifyInstance;
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
    auth: {
      requireUser: async () => undefined,
      requireAdmin: async () => undefined,
      requireSuperAdmin: async () => undefined,
      requirePermission: () => async () => undefined,
    },
  } as unknown as ApiContext;

  await registerCatalogRoutes(app, context);
  const handler = routes.get("/v1/catalog/characters");
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
