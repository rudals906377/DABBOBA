import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import { AppError } from "../lib/errors.js";
import type { ApiContext } from "../types.js";
import { legacyCatalogMediaDeliveryUrl } from "./catalog-media-url.js";
import { assertStorefrontImageDimensions, registerCatalogMediaRoutes } from "./catalog-media.js";

function assertBadRequest(run: () => void, message: RegExp) {
  assert.throws(run, (error: unknown) => (
    error instanceof AppError
    && error.statusCode === 400
    && message.test(error.message)
  ));
}

test("storefront images enforce the exact gacha and kuji list formats", () => {
  assert.doesNotThrow(() => assertStorefrontImageDimensions("gacha", 1_080, 1_080));
  assert.doesNotThrow(() => assertStorefrontImageDimensions("gacha", 2_048, 2_048));
  assertBadRequest(() => assertStorefrontImageDimensions("gacha", 1_079, 1_079), /1080×1080/);
  assertBadRequest(() => assertStorefrontImageDimensions("gacha", 1_200, 1_080), /1:1/);

  assert.doesNotThrow(() => assertStorefrontImageDimensions("kuji", 1_200, 675));
  assert.doesNotThrow(() => assertStorefrontImageDimensions("kuji", 1_920, 1_080));
  assertBadRequest(() => assertStorefrontImageDimensions("kuji", 1_199, 675), /1200×675/);
  assertBadRequest(() => assertStorefrontImageDimensions("kuji", 1_200, 676), /16:9/);
});

test("storefront images reject unsupported categories and missing READY dimensions", () => {
  assertBadRequest(() => assertStorefrontImageDimensions("figure", 1_080, 1_080), /가챠·쿠지/);
  assertBadRequest(() => assertStorefrontImageDimensions("tcg", 1_200, 675), /가챠·쿠지/);
  assertBadRequest(() => assertStorefrontImageDimensions("gacha", null, 1_080), /가로 크기/);
  assertBadRequest(() => assertStorefrontImageDimensions("kuji", 1_200, null), /세로 크기/);
});

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
    patch: register("PATCH"),
    delete: register("DELETE"),
  } as unknown as FastifyInstance;
  return { app, routes };
}

test("public catalog media lookup accepts only this asset's current and legacy delivery URLs", async () => {
  const { app, routes } = routeHarness();
  const mediaId = "11111111-1111-4111-8111-111111111111";
  const baseUrl = "https://new.example.test/functions/v1/dabboba-api";
  let observed: unknown[] | null = null;
  await registerCatalogMediaRoutes(app, {
    config: { catalogMediaBaseUrl: baseUrl },
    pool: {
      async query(sql: string, values: unknown[]) {
        assert.match(sql, /media\.metadata->>'catalogDeliveryUrl'=ANY\(\$2::text\[\]\)/);
        assert.match(sql, /entry\.prize_image_url_snapshot=ANY\(\$2::text\[\]\)/);
        observed = values;
        return { rowCount: 0, rows: [] };
      },
    },
    auth: { requirePermission: () => async () => undefined },
  } as unknown as ApiContext);
  const handler = routes.get("GET /v1/catalog/media/:mediaId/image");
  assert.ok(handler);
  await assert.rejects(
    handler({ params: { mediaId } }, {}),
    (error: unknown) => error instanceof AppError && error.statusCode === 404,
  );
  assert.deepEqual(observed, [mediaId, [
    `${baseUrl}/v1/catalog/media/${mediaId}/image`,
    legacyCatalogMediaDeliveryUrl(mediaId),
  ]]);
});

function clearRequest(input: { expectedVersion: number; role: string; key: string }) {
  return {
    id: `request-${input.key}`,
    method: "DELETE",
    url: "/v1/admin/products/gacha-product/image",
    routeOptions: { url: "/v1/admin/products/:productId/image" },
    params: { productId: "gacha-product" },
    body: { expectedVersion: input.expectedVersion, role: input.role },
    headers: {
      "x-admin-reason": "목록 사진 연결 해제",
      "idempotency-key": input.key,
    },
    actor: {
      userId: "11111111-1111-4111-8111-111111111111",
      sessionId: "22222222-2222-4222-8222-222222222222",
    },
  };
}

function replyCapture() {
  let statusCode = 200;
  let body: unknown;
  const headers: Record<string, string> = {};
  const reply = {
    code(value: number) { statusCode = value; return this; },
    header(name: string, value: string) { headers[name] = value; return this; },
    send(value?: unknown) { body = value; return value; },
  };
  return { reply, result: () => ({ statusCode, body, headers }) };
}

function clearContext() {
  const product = {
    id: "gacha-product",
    category: "gacha",
    image_url: "https://cdn.example.test/primary.webp",
    storefront_image_url: "https://cdn.example.test/storefront.webp" as string | null,
    version: 7,
  };
  const idempotency = new Map<string, {
    id: string;
    requestHash: string;
    state: "STARTED" | "COMPLETED";
    responseStatus: number | null;
    responseBody: unknown;
  }>();
  const observed: Array<{ sql: string; values: unknown[] }> = [];
  let auditCount = 0;
  let outboxCount = 0;
  let productUpdateCount = 0;

  const client = {
    async query(sql: string, values: unknown[] = []) {
      observed.push({ sql, values });
      const normalized = sql.trim();
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)) return { rowCount: 0, rows: [] };
      if (normalized.startsWith("DELETE FROM idempotency_keys")) return { rowCount: 0, rows: [] };
      if (normalized.startsWith("INSERT INTO idempotency_keys")) {
        const key = String(values[2]);
        if (idempotency.has(key)) return { rowCount: 0, rows: [] };
        const record = {
          id: `idempotency-${idempotency.size + 1}`,
          requestHash: String(values[3]),
          state: "STARTED" as const,
          responseStatus: null,
          responseBody: null,
        };
        idempotency.set(key, record);
        return { rowCount: 1, rows: [{ id: record.id }] };
      }
      if (normalized.startsWith("SELECT request_hash,state,response_status,response_body FROM idempotency_keys")) {
        const record = idempotency.get(String(values[2]));
        return record ? {
          rowCount: 1,
          rows: [{
            request_hash: record.requestHash,
            state: record.state,
            response_status: record.responseStatus,
            response_body: record.responseBody,
          }],
        } : { rowCount: 0, rows: [] };
      }
      if (normalized.startsWith("UPDATE idempotency_keys SET state='COMPLETED'")) {
        const record = [...idempotency.values()].find((item) => item.id === values[0]);
        assert.ok(record);
        record.state = "COMPLETED";
        record.responseStatus = Number(values[1]);
        record.responseBody = JSON.parse(String(values[2]));
        return { rowCount: 1, rows: [] };
      }
      if (normalized.startsWith("SELECT id,category,image_url,storefront_image_url,version FROM catalog_products")) {
        return { rowCount: 1, rows: [{ ...product }] };
      }
      if (normalized.startsWith("UPDATE catalog_products")) {
        assert.match(normalized, /SET storefront_image_url=NULL,version=version\+1/);
        assert.doesNotMatch(normalized, /SET image_url=/);
        assert.deepEqual(values, [product.id, product.version]);
        product.storefront_image_url = null;
        product.version += 1;
        productUpdateCount += 1;
        return { rowCount: 1, rows: [{ id: product.id, version: product.version }] };
      }
      if (normalized.startsWith("SELECT host(ip_address) AS ip_address")) {
        return { rowCount: 1, rows: [{ ip_address: "203.0.113.10", user_agent: "catalog-media-test" }] };
      }
      if (normalized.startsWith("INSERT INTO admin_audit_logs")) {
        auditCount += 1;
        assert.equal(values[1], "PRODUCT_STOREFRONT_IMAGE_CLEARED");
        return { rowCount: 1, rows: [] };
      }
      if (normalized.startsWith("INSERT INTO outbox_events")) {
        outboxCount += 1;
        assert.equal(values[2], "catalog.product.storefront_image_cleared");
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`unexpected query: ${normalized}`);
    },
    release() {},
  };
  const context = {
    config: { catalogMediaBaseUrl: "https://cdn.example.test" },
    pool: { async connect() { return client; } },
    auth: { requirePermission: () => async () => undefined },
  } as unknown as ApiContext;
  return {
    context,
    product,
    observed,
    counts: () => ({ auditCount, outboxCount, productUpdateCount }),
  };
}

test("storefront image clear is storefront-only, versioned, audited, and replay-safe", async () => {
  const { app, routes } = routeHarness();
  const state = clearContext();
  await registerCatalogMediaRoutes(app, state.context);
  const handler = routes.get("DELETE /v1/admin/products/:productId/image");
  assert.ok(handler);

  const key = "catalog-clear-idempotency-0001";
  const firstReply = replyCapture();
  await handler(clearRequest({ expectedVersion: 7, role: "storefront", key }), firstReply.reply);
  assert.deepEqual(firstReply.result(), {
    statusCode: 200,
    body: { productId: "gacha-product", imageUrl: null, version: 8, role: "storefront" },
    headers: {},
  });
  assert.equal(state.product.image_url, "https://cdn.example.test/primary.webp");
  assert.equal(state.product.storefront_image_url, null);
  assert.deepEqual(state.counts(), { auditCount: 1, outboxCount: 1, productUpdateCount: 1 });

  const replayReply = replyCapture();
  await handler(clearRequest({ expectedVersion: 7, role: "storefront", key }), replayReply.reply);
  assert.deepEqual(replayReply.result().body, firstReply.result().body);
  assert.equal(replayReply.result().headers["x-idempotent-replay"], "true");
  assert.deepEqual(state.counts(), { auditCount: 1, outboxCount: 1, productUpdateCount: 1 });

  await assert.rejects(
    () => handler(clearRequest({ expectedVersion: 8, role: "primary", key: "catalog-clear-invalid-role" }), replyCapture().reply),
    (error: unknown) => error instanceof AppError && error.statusCode === 400,
  );
  const missingRoleRequest = clearRequest({ expectedVersion: 8, role: "storefront", key: "catalog-clear-missing-role" });
  missingRoleRequest.body = { expectedVersion: 8, role: undefined as unknown as string };
  await assert.rejects(
    () => handler(missingRoleRequest, replyCapture().reply),
    (error: unknown) => error instanceof AppError && error.statusCode === 400,
  );
  await assert.rejects(
    () => handler(clearRequest({ expectedVersion: 8, role: "storefront", key: "catalog-clear-empty-image" }), replyCapture().reply),
    (error: unknown) => error instanceof AppError && error.statusCode === 409 && /연결된 목록 사진/.test(error.message),
  );
  assert.deepEqual(state.counts(), { auditCount: 1, outboxCount: 1, productUpdateCount: 1 });
});
