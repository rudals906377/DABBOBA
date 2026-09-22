import { createHmac } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { withTransaction } from "@dabboba/db";
import { issueSession } from "../plugins/auth.js";
import { AppError, badRequest, conflict, notFound } from "../lib/errors.js";
import { enumInput, objectInput, uuidInput } from "../lib/input.js";
import { idempotencyKey, requestHash } from "../lib/idempotency.js";
import {
  INTERNAL_CUSTOMER_ACCOUNT,
  DEMO_FIXTURE_TAG,
  DEMO_PAYMENT_ACTIONS,
  DEMO_PROFILE,
  assertDemoActor,
  assertDemoLoopbackRequest,
  assertDemoOrderProducts,
  demoPaymentEventId,
  type DemoPaymentAction,
  type DemoRuntime,
} from "../lib/demo-testing.js";
import type { ApiContext } from "../types.js";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const DISABLED_SHARED_MUTATION_PREFIXES = [
  "/v1/community/",
  "/v1/wanted-requests",
  "/v1/reports",
  "/v1/catalog/requests",
] as const;

function assertOnlyKeys(input: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(input).some((key) => !allowedSet.has(key))) {
    throw badRequest("허용되지 않은 데모 요청 항목이 포함되어 있습니다.");
  }
}

function routeUrl(request: FastifyRequest): string {
  return request.routeOptions.url || request.url.split("?")[0]!;
}

function orderProductIds(body: unknown): string[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const items = (body as Record<string, unknown>).items;
  if (!Array.isArray(items)) return [];
  return items.map((item) => (
    item && typeof item === "object" && !Array.isArray(item)
      ? (item as Record<string, unknown>).productId
      : null
  )).filter((value): value is string => typeof value === "string");
}

function bodyProductId(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = (body as Record<string, unknown>).productId;
  return typeof value === "string" ? value : null;
}

export function registerDemoSafetyHook(
  app: FastifyInstance,
  context: ApiContext,
  runtime: DemoRuntime,
): void {
  if (!runtime.enabled) return;
  app.addHook("preHandler", async (request) => {
    assertDemoLoopbackRequest(request, runtime);
    if (!MUTATION_METHODS.has(request.method)) return;
    const url = routeUrl(request);
    if (url === "/v1/demo/session" || url === "/v1/payments/webhooks/:provider") return;
    if (url.startsWith("/v1/auth/") && url !== "/v1/auth/logout") throw notFound();
    if (url.startsWith("/v1/admin/")) throw notFound();
    if (DISABLED_SHARED_MUTATION_PREFIXES.some((prefix) => url.startsWith(prefix))) throw notFound();
    const actor = await context.auth.loadActor(request);
    assertDemoActor(actor);
    if (url === "/v1/orders") assertDemoOrderProducts(orderProductIds(request.body));
    const params = (request.params ?? {}) as Record<string, unknown>;
    const requestedProductId = typeof params.productId === "string" ? params.productId : bodyProductId(request.body);
    if (requestedProductId) assertDemoOrderProducts([requestedProductId]);
    if (url.startsWith("/v1/exchange/listings/:listingId")) {
      const listingId = typeof params.listingId === "string" ? params.listingId : null;
      const listing = listingId ? await context.pool.query<{ user_id: string; email: string | null }>(
        `SELECT users.id AS user_id,users.email::text
           FROM exchange_listings
           JOIN users ON users.id=exchange_listings.author_id
          WHERE exchange_listings.id=$1`,
        [listingId],
      ) : null;
      const owner = listing?.rows[0];
      if (!owner) throw notFound();
      assertDemoActor({ userId: owner.user_id, email: owner.email });
    }
  });
}

type DemoPaymentRow = {
  payment_id: string;
  provider: string;
  amount: number;
  order_status: string;
  product_ids: string[];
};

type DemoPaymentEnvelope = {
  eventId: string;
  eventType: string;
  paymentId: string;
  providerPaymentId: string;
  occurredAt: string;
  amount: number;
  fixture: string;
};

function transitionEventType(action: DemoPaymentAction) {
  return {
    approve: "PAYMENT_SUCCEEDED",
    fail: "PAYMENT_FAILED",
    cancel: "PAYMENT_CANCELLED",
    refund: "REFUND_SUCCEEDED",
  }[action];
}

async function preparePaymentEnvelope(
  context: ApiContext,
  input: {
    actorId: string;
    idempotencyKey: string;
    action: DemoPaymentAction;
    orderId: string;
    paymentId: string;
    amount: number;
  },
): Promise<DemoPaymentEnvelope> {
  const scope = "DEMO_PAYMENT_TRANSITION_ENVELOPE";
  const hash = requestHash({ action: input.action, orderId: input.orderId, paymentId: input.paymentId });
  return withTransaction(context.pool, async (client) => {
    await client.query(
      `INSERT INTO idempotency_keys(actor_id,scope,idempotency_key,request_hash,expires_at)
       VALUES($1,$2,$3,$4,'infinity'::timestamptz)
       ON CONFLICT DO NOTHING`,
      [input.actorId, scope, input.idempotencyKey, hash],
    );
    const existing = await client.query<{
      id: string;
      request_hash: string;
      state: string;
      response_body: DemoPaymentEnvelope | null;
    }>(
      `SELECT id,request_hash,state,response_body
         FROM idempotency_keys
        WHERE actor_id=$1 AND scope=$2 AND idempotency_key=$3
        FOR UPDATE`,
      [input.actorId, scope, input.idempotencyKey],
    );
    const row = existing.rows[0];
    if (!row || row.request_hash !== hash) {
      throw conflict("같은 중복 방지 키의 결제 요청이 일치하지 않습니다.");
    }
    if (row.state === "COMPLETED" && row.response_body) return row.response_body;
    const clock = await client.query<{ now: Date }>("SELECT clock_timestamp() AS now");
    const envelope: DemoPaymentEnvelope = {
      eventId: demoPaymentEventId(input.actorId, input.idempotencyKey),
      eventType: transitionEventType(input.action),
      paymentId: input.paymentId,
      providerPaymentId: `demo-${input.paymentId}`,
      occurredAt: clock.rows[0]!.now.toISOString(),
      amount: input.amount,
      fixture: DEMO_FIXTURE_TAG,
    };
    await client.query(
      `UPDATE idempotency_keys
          SET state='COMPLETED',response_status=200,response_body=$2,
              resource_type='PAYMENT',resource_id=$3
        WHERE id=$1`,
      [row.id, JSON.stringify(envelope), input.paymentId],
    );
    return envelope;
  });
}

export async function registerDemoRoutes(
  app: FastifyInstance,
  context: ApiContext,
  runtime: DemoRuntime,
): Promise<void> {
  app.get("/v1/demo/capabilities", async (request) => {
    assertDemoLoopbackRequest(request, runtime);
    return {
      enabled: true,
      profile: DEMO_PROFILE,
      paymentProvider: "TEST_PG",
      actions: [...DEMO_PAYMENT_ACTIONS],
    };
  });

  app.post("/v1/demo/session", async (request, reply) => {
    assertDemoLoopbackRequest(request, runtime);
    const input = request.body === undefined ? {} : objectInput(request.body);
    assertOnlyKeys(input, []);
    const expected = INTERNAL_CUSTOMER_ACCOUNT;
    const result = await context.pool.query<{
      id: string; email: string | null; nickname: string; role: "USER"; status: "ACTIVE";
    }>(
      "SELECT id,email::text,nickname,role,status FROM users WHERE id=$1 AND email=$2 AND role='USER' AND status='ACTIVE'",
      [expected.id, expected.email],
    );
    const actor = result.rows[0];
    if (!actor) throw conflict("고객 계정이 준비되지 않았습니다.");
    const session = await issueSession(context.pool, context.config, {
      userId: actor.id,
      kind: "USER",
      ip: request.ip,
      ...(request.headers["user-agent"] ? { userAgent: request.headers["user-agent"] } : {}),
    });
    return reply.code(201).send({
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
      actor: {
        userId: actor.id,
        email: actor.email,
        nickname: actor.nickname,
        role: actor.role,
        status: actor.status,
        sessionId: session.sessionId,
      },
    });
  });

  app.post(
    "/v1/demo/payments/:orderId/transition",
    { preHandler: context.auth.requireUser },
    async (request) => {
      assertDemoLoopbackRequest(request, runtime);
      assertDemoActor(request.actor!);
      const orderId = uuidInput((request.params as Record<string, unknown>).orderId, "orderId");
      const input = objectInput(request.body);
      assertOnlyKeys(input, ["action"]);
      const action = enumInput(input, "action", DEMO_PAYMENT_ACTIONS)!;
      const key = idempotencyKey(request.headers);
      const payment = await context.pool.query<DemoPaymentRow>(
        `SELECT payment.id AS payment_id,payment.provider,payment.amount,orders.status AS order_status,
                array_agg(lines.product_id ORDER BY lines.product_id) AS product_ids
           FROM orders
           JOIN payments payment ON payment.order_id=orders.id
           JOIN order_lines lines ON lines.order_id=orders.id
          WHERE orders.id=$1 AND orders.user_id=$2
          GROUP BY payment.id,payment.provider,payment.amount,orders.status`,
        [orderId, request.actor!.userId],
      );
      const row = payment.rows[0];
      if (!row) throw notFound("주문을 찾을 수 없습니다.");
      assertDemoOrderProducts(row.product_ids);
      if (row.provider !== "TEST_PG") throw conflict("테스트 결제 주문이 아닙니다.");
      if (action === "refund" && !["PAID", "REFUND_REVIEW", "REFUNDED"].includes(row.order_status)) {
        throw conflict("결제가 완료된 주문만 환불할 수 있습니다.");
      }
      if (action !== "refund" && ["REFUNDED", "REFUND_REVIEW"].includes(row.order_status)) {
        throw conflict("환불 처리 중인 주문의 결제 상태는 변경할 수 없습니다.");
      }
      const envelope = await preparePaymentEnvelope(context, {
        actorId: request.actor!.userId,
        idempotencyKey: key,
        action,
        orderId,
        paymentId: row.payment_id,
        amount: Number(row.amount),
      });
      const payload = JSON.stringify(envelope);
      const signature = createHmac("sha256", context.config.paymentWebhookSecret!).update(payload).digest("hex");
      const transitioned = await app.inject({
        method: "POST",
        url: "/v1/payments/webhooks/TEST_PG",
        headers: {
          "content-type": "application/json",
          "x-dabboba-signature": signature,
          "x-request-id": `demo-transition-${envelope.eventId.slice(-64)}`,
        },
        payload,
      });
      if (transitioned.statusCode !== 202) {
        let message = "결제 상태를 변경하지 못했습니다.";
        try {
          const body = transitioned.json() as { message?: unknown };
          if (typeof body.message === "string") message = body.message;
        } catch { /* Keep the safe generic message. */ }
        throw new AppError(transitioned.statusCode, "DEMO_PAYMENT_TRANSITION_FAILED", message);
      }
      const order = await app.inject({
        method: "GET",
        url: `/v1/orders/${encodeURIComponent(orderId)}`,
        headers: { authorization: request.headers.authorization! },
      });
      if (order.statusCode !== 200) throw new AppError(502, "DEMO_ORDER_REFRESH_FAILED", "주문 상태를 다시 확인하지 못했습니다.");
      return order.json();
    },
  );
}
