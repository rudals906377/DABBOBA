import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import type { ApiContext } from "../types.js";
import { registerPublicConfigRoutes } from "./public-config.js";

type Handler = (request: Record<string, unknown>, reply: Record<string, unknown>) => Promise<unknown>;

function routeHarness() {
  const routes = new Map<string, Handler>();
  return {
    app: {
      get(path: string, handler: Handler) { routes.set(`GET ${path}`, handler); },
    } as unknown as FastifyInstance,
    routes,
  };
}

test("public config exposes fail-closed commerce and exact required policy versions", async () => {
  const { app, routes } = routeHarness();
  const context = {
    config: { environment: "production", commerceMode: "PRELAUNCH" },
    pool: {
      async query(sql: string) {
        assert.match(sql, /FROM legal_document_versions/);
        return {
          rowCount: 2,
          rows: [
            { policy_key: "PRIVACY", policy_version: "2026-09-20", content_sha256: "b".repeat(64) },
            { policy_key: "TERMS", policy_version: "2026-09-14", content_sha256: "a".repeat(64) },
          ],
        };
      },
    },
  } as unknown as ApiContext;
  await registerPublicConfigRoutes(app, context);
  const handler = routes.get("GET /v1/public/config");
  assert.ok(handler);
  const headers = new Map<string, string>();
  const body = await handler({}, {
    header(name: string, value: string) { headers.set(name, value); return this; },
  });
  assert.deepEqual(body, {
    commerceMode: "PRELAUNCH",
    requiredPolicyVersions: { terms: "2026-09-14", privacy: "2026-09-20" },
  });
  assert.match(headers.get("cache-control") || "", /max-age=60/);
});
