import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { withTransaction, type DatabaseClient } from "@dabboba/db";
import { AppError, badRequest, conflict, notFound } from "../lib/errors.js";
import { requireLiveCommerce } from "../lib/commerce-mode.js";
import { objectInput, uuidInput } from "../lib/input.js";
import { createTossPaymentsAdapter, TossPaymentError, type TossPayment } from "../lib/toss-payments.js";
import { applyCanonicalPaymentEventInTransaction, parseCanonicalPaymentEvent } from "./commerce.js";
import type { ApiContext } from "../types.js";

const PROVIDER = "TOSSPAYMENTS_DIRECT";
type Owned = { id: string; order_id: string; amount: number; provider: string; status: string;
  pg_attempt_started_at: Date | null; order_status: string; total: number; created_at: Date;
  order_kind: string; point_total: number; discount_total: number };
function settings(context: ApiContext) {
  const config = context.config.tossPayments;
  if (![PROVIDER, "PORTONE_V2_NICE"].includes(context.config.paymentProvider) || context.config.environmentTier !== "STAGING"
    || config?.environment !== "TEST") throw new AppError(503, "TOSS_TEST_NOT_CONFIGURED", "토스 TEST 연결을 준비 중이에요.");
  return config;
}
async function owned(client: DatabaseClient, id: string, userId: string): Promise<Owned> {
  const result = await client.query<Owned>(`SELECT p.id,p.order_id,p.provider,p.status,p.amount,p.pg_attempt_started_at,
    o.status AS order_status,o.total,o.created_at,o.order_kind,o.point_total,o.discount_total
    FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=$1 AND o.user_id=$2 FOR UPDATE OF p,o`, [id, userId]);
  if (!result.rowCount) throw notFound("결제 정보를 찾을 수 없습니다.");
  const row = result.rows[0]!;
  if (row.provider !== PROVIDER || row.order_kind !== "PRODUCT" || row.point_total !== 0 || row.discount_total !== 0
    || row.amount !== row.total || row.amount < 1) throw conflict("토스 심사 상품 주문이 아닙니다.");
  const lines = await client.query<{ count: string; gacha: string }>(
    "SELECT count(*)::text AS count,count(*) FILTER (WHERE category_snapshot='gacha')::text AS gacha FROM order_lines WHERE order_id=$1", [row.order_id]);
  if (Number(lines.rows[0]?.count) !== 1 || Number(lines.rows[0]?.gacha) !== 1) throw conflict("심사 가챠 주문만 처리할 수 있습니다.");
  return row;
}
async function payable(client: DatabaseClient, row: Owned) {
  if (row.status !== "PENDING" || row.order_status !== "PENDING_PAYMENT") throw conflict("결제할 수 없는 주문입니다.");
  const stock = await client.query<{ active: string }>(
    "SELECT count(*)::text AS active FROM stock_reservations WHERE order_id=$1 AND status='ACTIVE' AND expires_at>clock_timestamp()", [row.order_id]);
  if (Number(stock.rows[0]?.active) !== 1) throw conflict("상품 예약 시간이 만료되었습니다.");
}
export function tossCanonicalObservation(payment: TossPayment, paymentId: string) {
  const status = payment.status;
  const eventType = status === "DONE" ? "PAYMENT_SUCCEEDED" : status === "CANCELED" ? "REFUND_SUCCEEDED"
    : status === "PARTIAL_CANCELED" ? "REFUND_PARTIAL" : status === "ABORTED" || status === "EXPIRED" ? "PAYMENT_FAILED" : null;
  if (!eventType) return null;
  const digest = createHash("sha256").update(JSON.stringify(payment)).digest("hex");
  const amount = status === "CANCELED" || status === "PARTIAL_CANCELED"
    ? payment.totalAmount - payment.balanceAmount : payment.totalAmount;
  return parseCanonicalPaymentEvent(PROVIDER, { eventId: `toss:${paymentId}:${digest}`, eventType, paymentId,
    providerPaymentId: payment.paymentKey, amount, occurredAt: payment.cancelledAt ?? payment.approvedAt ?? payment.requestedAt }, digest);
}

/** Deliberately TEST/STAGING and gacha/card only; no production activation or webhook body trust. */
export async function registerTossReviewPaymentRoutes(app: FastifyInstance, context: ApiContext, prefix = "/v1/payments") {
  const preHandler = [requireLiveCommerce(context), context.auth.requireUser];
  app.post(`${prefix}/:paymentId/attempt`, { preHandler }, async (request, reply) => {
    settings(context); reply.header("cache-control", "no-store");
    const id = uuidInput((request.params as Record<string, unknown>).paymentId, "paymentId");
    return withTransaction(context.pool, async (client) => {
      const row = await owned(client, id, request.actor!.userId); await payable(client, row);
      if (row.pg_attempt_started_at) throw conflict("이미 결제창을 연 주문입니다. 결제 상태 확인을 눌러 주세요.");
      await client.query("UPDATE payments SET pg_attempt_started_at=clock_timestamp(),version=version+1 WHERE id=$1", [id]);
      return { paymentId: id, orderId: row.order_id, claimed: true };
    });
  });
  app.post(`${prefix}/:paymentId/confirm`, { preHandler, config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (request, reply) => {
    const config = settings(context); reply.header("cache-control", "no-store");
    const id = uuidInput((request.params as Record<string, unknown>).paymentId, "paymentId");
    const input = objectInput(request.body ?? {});
    const key = input.paymentKey;
    if (key !== undefined && (typeof key !== "string" || !/^[A-Za-z0-9_-]{6,200}$/.test(key)
      || input.orderId !== id || !Number.isSafeInteger(input.amount))) throw badRequest("결제 복귀 정보를 확인해 주세요.");
    // Persist before leaving the transaction. Never clear this marker on a network failure.
    if (typeof key === "string") await withTransaction(context.pool, async (client) => {
      const row = await owned(client, id, request.actor!.userId);
      if (input.amount !== row.amount || !row.pg_attempt_started_at) throw conflict("주문 금액 또는 결제 시도를 확인할 수 없습니다.");
      if (row.status === "PENDING") await payable(client, row);
      else if (!['PAID', 'REFUNDED'].includes(row.status)) throw conflict("종료된 주문은 새로 승인하지 않습니다.");
      const prior = await client.query<{ payment_key: string; merchant_id: string }>("SELECT payment_key,merchant_id FROM toss_review_confirm_attempts WHERE payment_id=$1", [id]);
      if (prior.rowCount) {
        if (prior.rows[0]!.payment_key !== key || prior.rows[0]!.merchant_id !== config.merchantId) throw conflict("다른 결제 승인 정보입니다.");
      } else await client.query("INSERT INTO toss_review_confirm_attempts(payment_id,payment_key,merchant_id) VALUES($1,$2,$3)", [id, key, config.merchantId]);
    });
    return withTransaction(context.pool, async (client) => {
      const row = await owned(client, id, request.actor!.userId);
      const prior = await client.query<{ payment_key: string; merchant_id: string }>("SELECT payment_key,merchant_id FROM toss_review_confirm_attempts WHERE payment_id=$1", [id]);
      if (prior.rowCount && prior.rows[0]!.merchant_id !== config.merchantId) throw conflict("주문의 토스 상점 설정을 확인해 주세요.");
      const adapter = createTossPaymentsAdapter(config);
      let payment: TossPayment | null = null;
      try { payment = await adapter.lookup(id, row.amount); }
      catch (error) { if (!(error instanceof TossPaymentError) || error.code !== "NOT_FOUND_PAYMENT") throw error; }
      if (key && prior.rowCount && row.status === "PENDING"
        && (!payment || payment.status === "READY" || payment.status === "IN_PROGRESS")) {
        if (payment && payment.paymentKey !== prior.rows[0]!.payment_key) throw conflict("결제 키가 주문과 일치하지 않습니다.");
        await payable(client, row);
        payment = await adapter.confirm(id, prior.rows[0]!.payment_key, row.amount);
      }
      if (!payment) return { paymentId: id, orderId: row.order_id, status: row.order_status, outcome: "pending" };
      if (prior.rowCount && payment.paymentKey !== prior.rows[0]!.payment_key) throw conflict("결제 키가 주문과 일치하지 않습니다.");
      const event = tossCanonicalObservation(payment, id);
      const outcome = event ? await applyCanonicalPaymentEventInTransaction(client, event, request.id) : "pending";
      const after = await client.query<{ status: string }>("SELECT status FROM orders WHERE id=$1", [row.order_id]);
      return { paymentId: id, orderId: row.order_id, status: after.rows[0]!.status, outcome };
    });
  });
  app.post(`${prefix}/:paymentId/abandon`, { preHandler, config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (request, reply) => {
    const config = settings(context); reply.header("cache-control", "no-store");
    const id = uuidInput((request.params as Record<string, unknown>).paymentId, "paymentId");
    return withTransaction(context.pool, async (client) => {
      const row = await owned(client, id, request.actor!.userId);
      if (row.status !== "PENDING") throw conflict("결제 상태를 먼저 확인해 주세요.");
      const prior = await client.query("SELECT payment_id FROM toss_review_confirm_attempts WHERE payment_id=$1", [id]);
      if (prior.rowCount) throw conflict("승인 확인이 시작된 주문입니다. 결제 상태를 다시 확인해 주세요.");
      try {
        const payment = await createTossPaymentsAdapter(config).lookup(id, row.amount);
        if (payment.status === "DONE" || payment.status.includes("CANCELED") || payment.approvedAt) throw conflict("결제 상태를 먼저 확인해 주세요.");
      } catch (error) {
        if (!(error instanceof TossPaymentError) || error.code !== "NOT_FOUND_PAYMENT") throw error;
      }
      const event = parseCanonicalPaymentEvent(PROVIDER, { eventId: `toss-abandon:${id}`, eventType: "PAYMENT_CANCELLED",
        paymentId: id, providerPaymentId: null, amount: row.amount, occurredAt: new Date().toISOString() }, "server-verified-toss-no-approval");
      await applyCanonicalPaymentEventInTransaction(client, event, request.id);
      return { paymentId: id, orderId: row.order_id, abandoned: true };
    });
  });
}
