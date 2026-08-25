import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import type { ApiContext } from "../types.js";
import { AppError } from "../lib/errors.js";
import { registerWantedRoutes } from "./wanted.js";

type RouteHandler = (request: Record<string, unknown>, reply: Record<string, unknown>) => Promise<unknown>;

function routeCapture() {
  const routes = new Map<string, RouteHandler>();
  const register = (method: string) => (...args: unknown[]) => {
    const path = args[0];
    const handler = args.at(-1);
    if (typeof path !== "string" || typeof handler !== "function") throw new Error("Invalid test route registration.");
    routes.set(`${method} ${path}`, handler as RouteHandler);
  };
  return {
    app: {
      get: register("GET"),
      post: register("POST"),
      patch: register("PATCH"),
      delete: register("DELETE"),
    } as unknown as FastifyInstance,
    routes,
  };
}

function testContext(pool: unknown, viewerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"): ApiContext {
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
      loadActor: async () => ({ userId: viewerId, role: "USER", sessionKind: "USER" }),
      requireUser: async () => undefined,
      requireAdmin: async () => undefined,
      requireSuperAdmin: async () => undefined,
      requirePermission: () => async () => undefined,
    },
  } as unknown as ApiContext;
}

const authorId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const viewerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const requestId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const idempotencyId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const createdAt = new Date("2026-08-24T10:00:00.000Z");

function wantedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: requestId,
    user_id: authorId,
    author_nickname: "요청자",
    category: "figure",
    ip_id: "spy-family",
    ip_name_ko: "스파이 패밀리",
    desired_item: "아냐 교복 피규어",
    details: "재입고되면 알려주세요.",
    status: "ACTIVE",
    like_count: "2",
    liked_by_viewer: true,
    version: 1,
    created_at: createdAt,
    updated_at: createdAt,
    ...overrides,
  };
}

function replyCapture() {
  let statusCode = 200;
  let body: unknown;
  const headers = new Map<string, string>();
  return {
    reply: {
      code(status: number) { statusCode = status; return this; },
      header(name: string, value: string) { headers.set(name.toLowerCase(), value); return this; },
      send(value: unknown) { body = value; return value; },
    },
    result: () => ({ statusCode, body, headers }),
  };
}

test("wanted room applies public filters and exposes the authenticated viewer's like state", async () => {
  const observed: Array<{ sql: string; params: unknown[] }> = [];
  const pool = {
    async query(sql: string, params: unknown[] = []) {
      observed.push({ sql, params });
      return {
        rowCount: 2,
        rows: [wantedRow(), wantedRow({
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          created_at: new Date("2026-08-23T10:00:00.000Z"),
        })],
      };
    },
  };
  const { app, routes } = routeCapture();
  await registerWantedRoutes(app, testContext(pool));
  const handler = routes.get("GET /v1/wanted-requests");
  assert.ok(handler);

  const response = await handler({
    headers: { authorization: "Bearer viewer-token" },
    query: { limit: "1", q: "아냐", category: "figure", ipId: "spy-family" },
  }, {});

  assert.deepEqual(response, {
    items: [{
      id: requestId,
      userId: authorId,
      authorNickname: "요청자",
      category: "figure",
      ipId: "spy-family",
      ipNameKo: "스파이 패밀리",
      desiredItem: "아냐 교복 피규어",
      details: "재입고되면 알려주세요.",
      status: "ACTIVE",
      likeCount: 2,
      likedByViewer: true,
      version: 1,
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
    }],
    nextCursor: Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id: requestId }), "utf8").toString("base64url"),
  });
  assert.match(observed[0]!.sql, /w\.status='ACTIVE'/);
  assert.match(observed[0]!.sql, /w\.desired_item ILIKE/);
  assert.match(observed[0]!.sql, /w\.category=/);
  assert.match(observed[0]!.sql, /w\.ip_id=/);
  assert.deepEqual(observed[0]!.params, [viewerId, 2, "%아냐%", "figure", "spy-family"]);
});

test("wanted request creation is one authenticated idempotent transaction", async () => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      queries.push({ sql, params });
      if (sql === "BEGIN" || sql === "COMMIT") return { rowCount: null, rows: [] };
      if (sql.startsWith("DELETE FROM idempotency_keys")) return { rowCount: 0, rows: [] };
      if (sql.includes("INSERT INTO idempotency_keys")) return { rowCount: 1, rows: [{ id: idempotencyId }] };
      if (sql.includes("SELECT 1 FROM catalog_ips")) return { rowCount: 1, rows: [{}] };
      if (sql.includes("INSERT INTO wanted_requests")) return { rowCount: 1, rows: [{ id: requestId }] };
      if (sql.includes("INSERT INTO outbox_events")) return { rowCount: 1, rows: [] };
      if (sql.includes("FROM wanted_requests w") && sql.includes("WHERE w.id=$2")) {
        return { rowCount: 1, rows: [wantedRow({ liked_by_viewer: false, like_count: "0" })] };
      }
      if (sql.includes("UPDATE idempotency_keys SET state='COMPLETED'")) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() { /* no-op */ },
  };
  const { app, routes } = routeCapture();
  await registerWantedRoutes(app, testContext({ async connect() { return client; } }, authorId));
  const handler = routes.get("POST /v1/wanted-requests");
  assert.ok(handler);
  const capture = replyCapture();

  await handler({
    actor: { userId: authorId },
    headers: { "idempotency-key": "wanted-create-0001" },
    body: {
      category: "figure",
      ipId: "spy-family",
      desiredItem: "아냐 교복 피규어",
      details: "재입고되면 알려주세요.",
    },
    id: "wanted-request-create-test",
  }, capture.reply);

  const result = capture.result();
  assert.equal(result.statusCode, 201);
  assert.equal((result.body as { id: string }).id, requestId);
  assert.deepEqual(queries.find(({ sql }) => sql.includes("SELECT 1 FROM catalog_ips"))?.params, ["spy-family"]);
  assert.deepEqual(queries.find(({ sql }) => sql.includes("INSERT INTO wanted_requests"))?.params, [
    authorId,
    "figure",
    "spy-family",
    "아냐 교복 피규어",
    "재입고되면 알려주세요.",
  ]);
  assert.equal(queries.some(({ sql }) => sql === "COMMIT"), true);
});

test("wanted like commits the explicit state and rejects self-like attempts", async () => {
  const successfulQueries: string[] = [];
  const successfulClient = {
    async query(sql: string) {
      successfulQueries.push(sql);
      if (sql === "BEGIN" || sql === "COMMIT") return { rowCount: null, rows: [] };
      if (sql.startsWith("DELETE FROM idempotency_keys")) return { rowCount: 0, rows: [] };
      if (sql.includes("INSERT INTO idempotency_keys")) return { rowCount: 1, rows: [{ id: idempotencyId }] };
      if (sql.includes("SELECT user_id FROM wanted_requests")) return { rowCount: 1, rows: [{ user_id: authorId }] };
      if (sql.includes("INSERT INTO wanted_request_likes")) return { rowCount: 1, rows: [] };
      if (sql.includes("SELECT count(*) FROM wanted_request_likes")) return { rowCount: 1, rows: [{ count: "3" }] };
      if (sql.includes("INSERT INTO outbox_events")) return { rowCount: 1, rows: [] };
      if (sql.includes("UPDATE idempotency_keys SET state='COMPLETED'")) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() { /* no-op */ },
  };
  const { app, routes } = routeCapture();
  await registerWantedRoutes(app, testContext({ async connect() { return successfulClient; } }));
  const handler = routes.get("POST /v1/wanted-requests/:requestId/like");
  assert.ok(handler);
  const capture = replyCapture();
  await handler({
    actor: { userId: viewerId },
    params: { requestId },
    headers: { "idempotency-key": "wanted-like-000001" },
    body: { liked: true },
    id: "wanted-request-like-test",
  }, capture.reply);
  assert.equal(capture.result().statusCode, 200);
  assert.deepEqual(capture.result().body, { requestId, liked: true, likeCount: 3 });
  assert.equal(successfulQueries.some((sql) => sql.includes("INSERT INTO wanted_request_likes")), true);
  assert.equal(successfulQueries.some((sql) => sql === "COMMIT"), true);

  const selfClient = {
    async query(sql: string) {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rowCount: null, rows: [] };
      if (sql.startsWith("DELETE FROM idempotency_keys")) return { rowCount: 0, rows: [] };
      if (sql.includes("INSERT INTO idempotency_keys")) return { rowCount: 1, rows: [{ id: idempotencyId }] };
      if (sql.includes("SELECT user_id FROM wanted_requests")) return { rowCount: 1, rows: [{ user_id: authorId }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() { /* no-op */ },
  };
  const second = routeCapture();
  await registerWantedRoutes(second.app, testContext({ async connect() { return selfClient; } }, authorId));
  const selfHandler = second.routes.get("POST /v1/wanted-requests/:requestId/like");
  assert.ok(selfHandler);
  await assert.rejects(
    selfHandler({
      actor: { userId: authorId },
      params: { requestId },
      headers: { "idempotency-key": "wanted-self-like01" },
      body: { liked: true },
      id: "wanted-request-self-like-test",
    }, replyCapture().reply),
    (error: unknown) => error instanceof AppError && error.statusCode === 403,
  );
});
