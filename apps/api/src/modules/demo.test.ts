import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import type { ApiConfig } from "@dabboba/config";
import { registerErrorHandler } from "../lib/errors.js";
import { INTERNAL_CUSTOMER_ACCOUNT, DEMO_GACHA_PRODUCT_ID, type DemoRuntime } from "../lib/demo-testing.js";
import type { ApiContext } from "../types.js";
import { registerDemoRoutes } from "./demo.js";

const orderId = "11111111-1111-4111-8111-111111111111";
const paymentId = "22222222-2222-4222-8222-222222222222";
const webhookSecret = "demo-payment-webhook-secret-at-least-32-bytes";
const runtime: DemoRuntime = { enabled: true };

const config = {
  environment: "test",
  environmentTier: "TEST",
  host: "127.0.0.1",
  port: 8788,
  databaseUrl: "postgresql://dabboba_runtime:fixture@127.0.0.1:55441/dabboba_edge_test",
  redisUrl: "redis://127.0.0.1:56380",
  webOrigins: ["http://127.0.0.1:4174"],
  adminOrigins: ["http://127.0.0.1:4180"],
  sessionTokenPepper: "demo-session-pepper-at-least-32-bytes",
  adminProxyIdentitySecret: null,
  sessionTtlDays: 1,
  paymentProvider: "TEST_PG",
  paymentWebhookSecret: webhookSecret,
  gcsBucket: null,
  gcsProjectId: null,
  logLevel: "silent",
} as ApiConfig;

type EnvelopeRow = {
  id: string;
  request_hash: string;
  state: string;
  response_body: Record<string, unknown> | null;
};

class TestPool {
  activeTransactions = 0;
  readonly envelopes = new Map<string, EnvelopeRow>();
  private transactionTail: Promise<void> = Promise.resolve();

  async query(sql: string, values: unknown[] = []) {
    if (sql.includes("FROM orders") && sql.includes("JOIN payments")) {
      return { rowCount: 1, rows: [{
        payment_id: paymentId,
        provider: "TEST_PG",
        amount: 1000,
        order_status: "PENDING_PAYMENT",
        product_ids: [DEMO_GACHA_PRODUCT_ID],
      }] };
    }
    if (sql.startsWith("SELECT id,email::text,nickname")) {
      assert.match(sql, /id=\$1 AND email=\$2 AND role='USER' AND status='ACTIVE'/);
      assert.deepEqual(values, [INTERNAL_CUSTOMER_ACCOUNT.id, INTERNAL_CUSTOMER_ACCOUNT.email]);
      return { rowCount: 1, rows: [{
        id: INTERNAL_CUSTOMER_ACCOUNT.id,
        email: INTERNAL_CUSTOMER_ACCOUNT.email,
        nickname: "다뽑러 01",
        role: "USER",
        status: "ACTIVE",
      }] };
    }
    if (sql.includes("INSERT INTO sessions")) {
      return { rowCount: 1, rows: [{ id: "33333333-3333-4333-8333-333333333333" }] };
    }
    throw new Error(`Unexpected direct test query: ${sql.slice(0, 40)}`);
  }

  async connect() {
    let unlock!: () => void;
    const mine = new Promise<void>((resolve) => { unlock = resolve; });
    const prior = this.transactionTail;
    this.transactionTail = mine;
    await prior;
    const pool = this;
    return {
      async query(sql: string, values: unknown[] = []) {
        if (sql === "BEGIN") { pool.activeTransactions += 1; return { rowCount: null, rows: [] }; }
        if (sql === "COMMIT" || sql === "ROLLBACK") { pool.activeTransactions -= 1; return { rowCount: null, rows: [] }; }
        if (sql.startsWith("INSERT INTO idempotency_keys")) {
          const mapKey = `${values[0]}:${values[1]}:${values[2]}`;
          if (!pool.envelopes.has(mapKey)) {
            pool.envelopes.set(mapKey, { id: mapKey, request_hash: String(values[3]), state: "PROCESSING", response_body: null });
          }
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes("FROM idempotency_keys")) {
          const mapKey = `${values[0]}:${values[1]}:${values[2]}`;
          const row = pool.envelopes.get(mapKey);
          return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
        }
        if (sql === "SELECT clock_timestamp() AS now") {
          return { rowCount: 1, rows: [{ now: new Date("2026-09-10T12:00:00.000Z") }] };
        }
        if (sql.startsWith("UPDATE idempotency_keys")) {
          const row = [...pool.envelopes.values()].find((candidate) => candidate.id === values[0]);
          if (!row) throw new Error("Envelope row missing");
          row.state = "COMPLETED";
          row.response_body = JSON.parse(String(values[1])) as Record<string, unknown>;
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`Unexpected transaction test query: ${sql.slice(0, 40)}`);
      },
      release() { unlock(); },
    };
  }
}

async function testApp() {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  const pool = new TestPool();
  const seenPayloads: Record<string, unknown>[] = [];
  app.post("/v1/payments/webhooks/:provider", async (request, reply) => {
    assert.equal(pool.activeTransactions, 0, "webhook injection must not hold a transaction connection");
    const payload = request.body as Record<string, unknown>;
    const encoded = JSON.stringify(payload);
    const expected = createHmac("sha256", webhookSecret).update(encoded).digest("hex");
    assert.equal(request.headers["x-dabboba-signature"], expected);
    seenPayloads.push(payload);
    return reply.code(202).send({ accepted: true });
  });
  app.get("/v1/orders/:orderId", async () => ({ id: orderId, status: "PAID" }));
  const authenticated = {
    userId: INTERNAL_CUSTOMER_ACCOUNT.id,
    email: INTERNAL_CUSTOMER_ACCOUNT.email,
    nickname: "다뽑러 01",
    role: "USER" as const,
    status: "ACTIVE" as const,
    sessionId: "33333333-3333-4333-8333-333333333333",
  };
  const context = {
    config,
    pool,
    redis: null,
    mediaRuntime: {},
    auth: {
      requireUser: async (request: { actor?: typeof authenticated }) => { request.actor = authenticated; },
      loadActor: async () => authenticated,
    },
  } as unknown as ApiContext;
  await registerDemoRoutes(app, context, runtime);
  await app.ready();
  return { app, pool, seenPayloads };
}

test("capabilities and session expose one fixed customer without an account selector", async () => {
  const { app } = await testApp();
  try {
    const capabilities = await app.inject({ method: "GET", url: "/v1/demo/capabilities" });
    assert.equal(capabilities.statusCode, 200);
    assert.deepEqual(capabilities.json(), {
      enabled: true,
      profile: "supabase-demo",
      paymentProvider: "TEST_PG",
      actions: ["approve", "fail", "cancel", "refund"],
    });
    const session = await app.inject({ method: "POST", url: "/v1/demo/session" });
    assert.equal(session.statusCode, 201, session.body);
    const body = session.json() as { actor: Record<string, unknown> };
    assert.deepEqual(Object.keys(body.actor).sort(), ["email", "nickname", "role", "sessionId", "status", "userId"]);
    assert.equal(body.actor.userId, INTERNAL_CUSTOMER_ACCOUNT.id);
    assert.equal(body.actor.nickname, "다뽑러 01", "the database nickname remains customer-editable");
    assert.equal(body.actor.id, undefined);
    for (const account of ["a", "b"]) {
      const selected = await app.inject({ method: "POST", url: "/v1/demo/session", payload: { account } });
      assert.equal(selected.statusCode, 400, selected.body);
    }
  } finally { await app.close(); }
});

test("parallel transition retries reuse one current server-clock envelope without holding a DB lease", async () => {
  const { app, seenPayloads } = await testApp();
  try {
    const request = {
      method: "POST" as const,
      url: `/v1/demo/payments/${orderId}/transition`,
      headers: { authorization: `Bearer ${"x".repeat(40)}`, "idempotency-key": "parallel-demo-key-0001" },
      payload: { action: "approve" },
    };
    const responses = await Promise.all([app.inject(request), app.inject(request)]);
    assert.deepEqual(responses.map((response) => response.statusCode), [200, 200]);
    assert.equal(seenPayloads.length, 2);
    assert.deepEqual(seenPayloads[0], seenPayloads[1]);
    assert.equal(seenPayloads[0]!.occurredAt, "2026-09-10T12:00:00.000Z");
    assert.notEqual(seenPayloads[0]!.occurredAt, "2026-01-01T00:00:00.000Z");
  } finally { await app.close(); }
});

test("same idempotency key cannot change transition action", async () => {
  const { app } = await testApp();
  try {
    const headers = { authorization: `Bearer ${"x".repeat(40)}`, "idempotency-key": "changed-demo-key-0001" };
    const first = await app.inject({ method: "POST", url: `/v1/demo/payments/${orderId}/transition`, headers, payload: { action: "approve" } });
    assert.equal(first.statusCode, 200, first.body);
    const changed = await app.inject({ method: "POST", url: `/v1/demo/payments/${orderId}/transition`, headers, payload: { action: "cancel" } });
    assert.equal(changed.statusCode, 409, changed.body);
  } finally { await app.close(); }
});
