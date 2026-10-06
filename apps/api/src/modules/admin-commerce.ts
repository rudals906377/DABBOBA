import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { withTransaction } from "@dabboba/db";
import { adminMutationHeaders, writeAdminAudit, writeOutbox } from "../lib/audit.js";
import { assertDrawCapacity } from "../lib/draw-capacity.js";
import { effectiveCommerceMode, requireLiveCommerce } from "../lib/commerce-mode.js";
import { isPortOneCardProvider } from "../lib/portone-channel-binding.js";
import { lateRefundBlocker, normalDrawRefundBlocker, REFUND_CANDIDATE_LOOKUP_SQL, type NormalDrawRefundCandidate } from "./portone-payments.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { beginIdempotency, completeIdempotency, requestHash } from "../lib/idempotency.js";
import { enumInput, integerInput, nullableStringInput, objectInput, queryString, slugIdInput, stringInput, uuidInput, likeContainsPattern } from "../lib/input.js";
import { cursorPage, pagination } from "../lib/pagination.js";
import { iso, maskEmail, nullableIso, numberValue } from "../lib/rows.js";
import type { ApiContext } from "../types.js";

const ORDER_STATUSES = ["PENDING_PAYMENT", "PAID", "FULFILLED", "CANCELLED", "REFUND_REVIEW", "REFUNDED"] as const;
const PAYMENT_STATUSES = ["PENDING", "AUTHORIZED", "PAID", "FAILED", "CANCELLED", "REFUND_REVIEW", "REFUNDED"] as const;
const REVIEW_STATUSES = ["PENDING", "IN_REVIEW", "WAITING_PROVIDER", "ESCALATED", "CLOSED"] as const;
const REVIEW_FILTER_STATUSES = ["UNTRACKED", ...REVIEW_STATUSES] as const;
const SHIPPING_STATUSES = ["PAYMENT_PENDING", "REQUESTED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"] as const;
const SHIPPING_TARGET_STATUSES = ["PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"] as const;
const PAYMENT_OBSERVATION_STATUSES = ["READY", "PAY_PENDING", "VIRTUAL_ACCOUNT_ISSUED", "PAID", "FAILED", "PARTIAL_CANCELLED", "CANCELLED"] as const;

function safePaymentProviderObservation(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const observation = value as Record<string, unknown>;
  if (!PAYMENT_OBSERVATION_STATUSES.some((status) => status === observation.status)
    || !Number.isSafeInteger(observation.paidAmount) || Number(observation.paidAmount) < 0
    || !Number.isSafeInteger(observation.cancelledAmount) || Number(observation.cancelledAmount) < 0) return null;
  return {
    status: observation.status as (typeof PAYMENT_OBSERVATION_STATUSES)[number],
    paidAmount: observation.paidAmount as number,
    cancelledAmount: observation.cancelledAmount as number,
  };
}

type OrderStatus = (typeof ORDER_STATUSES)[number];
type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
type ReviewStatus = (typeof REVIEW_STATUSES)[number];
type ShippingStatus = (typeof SHIPPING_STATUSES)[number];
type ShippingTargetStatus = (typeof SHIPPING_TARGET_STATUSES)[number];
type InventoryUnitStatus =
  | "OWNED"
  | "EXCHANGE_LISTED"
  | "EXCHANGE_OFFERED"
  | "SHIPPING"
  | "DELIVERED"
  | "TRANSFERRED"
  | "REFUNDED"
  | "POINT_RETURNED"
  | "EXPIRED_HOLD";

type OrderSummaryRow = {
  id: string; user_id: string; user_email: string | null; nickname: string; status: OrderStatus; currency: "KRW";
  subtotal: number | string; discount_total: number | string; point_total: number | string; total: number | string;
  paid_at: Date | null; cancelled_at: Date | null; refunded_at: Date | null; version: number;
  payment_id: string; payment_status: PaymentStatus; payment_provider: string;
  line_count: number | string; unit_count: number | string; created_at: Date; updated_at: Date;
};

type PaymentSummaryRow = {
  id: string; order_id: string; order_status: OrderStatus; user_id: string; user_email: string | null; nickname: string;
  provider: string; provider_payment_id: string | null; status: PaymentStatus; amount: number | string; currency: "KRW";
  failure_code: string | null; paid_at: Date | null; refunded_at: Date | null; version: number; created_at: Date; updated_at: Date;
};

type RefundReviewRow = PaymentSummaryRow & {
  review_id: string | null; review_status: ReviewStatus | null; assigned_admin_id: string | null;
  review_version: number | null; review_updated_at: Date | null; review_closed_at: Date | null;
  cancellation_attempt_id: string | null; cancellation_attempt_status: string | null;
};

type InventoryRow = {
  id: string; sku: string; name: string; category: string; ip_id: string; is_active: boolean;
  on_hand: number | string; reserved: number | string; stock_version: number; active_draw_version_id: string | null;
  pool_has_unlimited: boolean | null; finite_remaining: number | string | null; outstanding_entitlements: number | string;
  created_at: Date; updated_at: Date;
};

type ShippingRow = {
  id: string; user_id: string; user_email: string | null; nickname: string; status: ShippingStatus; address_snapshot: unknown;
  requested_at: Date; shipped_at: Date | null; tracking_carrier: string | null; tracking_number: string | null;
  version: number; updated_at: Date; item_count: number | string; created_at: Date;
};
type ShippingSummaryRow = Omit<ShippingRow, "address_snapshot">;

function queryOf(request: FastifyRequest) {
  return (request.query || {}) as Record<string, unknown>;
}

function orderSummary(row: OrderSummaryRow) {
  return {
    id: row.id,
    user: { id: row.user_id, emailMasked: maskEmail(row.user_email), nickname: row.nickname },
    status: row.status,
    currency: row.currency,
    subtotal: numberValue(row.subtotal),
    discountTotal: numberValue(row.discount_total),
    pointTotal: numberValue(row.point_total),
    total: numberValue(row.total),
    version: row.version,
    payment: { id: row.payment_id, status: row.payment_status, provider: row.payment_provider },
    lineCount: numberValue(row.line_count),
    unitCount: numberValue(row.unit_count),
    paidAt: nullableIso(row.paid_at),
    cancelledAt: nullableIso(row.cancelled_at),
    refundedAt: nullableIso(row.refunded_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function paymentSummary(row: PaymentSummaryRow) {
  return {
    id: row.id,
    orderId: row.order_id,
    orderStatus: row.order_status,
    user: { id: row.user_id, emailMasked: maskEmail(row.user_email), nickname: row.nickname },
    provider: row.provider,
    providerPaymentId: row.provider_payment_id,
    status: row.status,
    amount: numberValue(row.amount),
    currency: row.currency,
    failureCode: row.failure_code,
    version: row.version,
    paidAt: nullableIso(row.paid_at),
    refundedAt: nullableIso(row.refunded_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function refundReviewSummary(row: RefundReviewRow) {
  return {
    ...paymentSummary(row),
    providerCancellationStatus: row.status === "REFUNDED" && row.cancellation_attempt_id
      ? "RECONCILED" : row.cancellation_attempt_status,
    review: row.review_id ? {
      id: row.review_id,
      status: row.review_status!,
      assignedAdminId: row.assigned_admin_id,
      version: numberValue(row.review_version),
      updatedAt: nullableIso(row.review_updated_at),
      closedAt: nullableIso(row.review_closed_at),
    } : null,
  };
}

function inventorySummary(row: InventoryRow) {
  const onHand = numberValue(row.on_hand);
  const reserved = numberValue(row.reserved);
  const finiteRemaining = row.finite_remaining === null ? null : numberValue(row.finite_remaining);
  const outstandingEntitlements = numberValue(row.outstanding_entitlements);
  return {
    productId: row.id,
    sku: row.sku,
    name: row.name,
    category: row.category,
    ipId: row.ip_id,
    isActive: row.is_active,
    onHand,
    reserved,
    available: onHand - reserved,
    version: row.stock_version,
    drawCapacity: row.active_draw_version_id ? {
      probabilityVersionId: row.active_draw_version_id,
      unlimited: row.pool_has_unlimited === true,
      remainingPrizeUnits: row.pool_has_unlimited ? null : finiteRemaining,
      outstandingEntitlements,
      sellableUnits: row.pool_has_unlimited || finiteRemaining === null ? null : finiteRemaining - outstandingEntitlements,
    } : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function addressSnapshot(value: unknown) {
  const address = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const field = (key: string) => typeof address[key] === "string" ? address[key] as string : "";
  return {
    recipient: field("recipient"),
    phone: field("phone"),
    postalCode: field("postalCode"),
    addressLine1: field("addressLine1"),
    addressLine2: field("addressLine2"),
    deliveryNote: field("deliveryNote"),
  };
}

function shippingSummary(row: ShippingSummaryRow) {
  return {
    id: row.id,
    user: { id: row.user_id, emailMasked: maskEmail(row.user_email), nickname: row.nickname },
    status: row.status,
    itemCount: numberValue(row.item_count),
    trackingCarrier: row.tracking_carrier,
    trackingNumber: row.tracking_number,
    version: row.version,
    requestedAt: iso(row.requested_at),
    shippedAt: nullableIso(row.shipped_at),
    updatedAt: iso(row.updated_at),
  };
}

/**
 * A request that carries a shipping-fee order may move forward only while that
 * order is settled. Cancelling stays possible so an operator can stop a request
 * whose fee is under refund review.
 */
export function shippingFeeAllowsDispatch(feeOrderStatus: string | null, to: ShippingTargetStatus) {
  return to === "CANCELLED" || feeOrderStatus === null || feeOrderStatus === "PAID" || feeOrderStatus === "FULFILLED";
}

export function allowedShippingTransition(from: ShippingStatus, to: ShippingTargetStatus) {
  return (from === "REQUESTED" && (to === "PROCESSING" || to === "CANCELLED"))
    || (from === "PROCESSING" && (to === "SHIPPED" || to === "CANCELLED"))
    || (from === "SHIPPED" && to === "DELIVERED");
}

export function allowedReviewTransition(from: ReviewStatus, to: ReviewStatus) {
  if (from === to) return true;
  return (from === "PENDING" && (to === "IN_REVIEW" || to === "ESCALATED" || to === "CLOSED"))
    || (from === "IN_REVIEW" && (to === "WAITING_PROVIDER" || to === "ESCALATED" || to === "CLOSED"))
    || (from === "WAITING_PROVIDER" && (to === "IN_REVIEW" || to === "ESCALATED" || to === "CLOSED"))
    || (from === "ESCALATED" && (to === "IN_REVIEW" || to === "WAITING_PROVIDER" || to === "CLOSED"));
}

async function sendMutation(reply: FastifyReply, result: { replay: boolean; statusCode: number; body: unknown }) {
  if (result.replay) reply.header("x-idempotent-replay", "true");
  return reply.code(result.statusCode).send(result.body);
}

export async function registerAdminCommerceRoutes(app: FastifyInstance, context: ApiContext) {
  app.get("/v1/admin/commerce/orders", { preHandler: context.auth.requirePermission("orders.read") }, async (request) => {
    const query = queryOf(request);
    const { limit, cursor } = pagination(query, "uuid");
    const status = query.status === undefined ? undefined : enumInput(query, "status", ORDER_STATUSES);
    const search = queryString(query.q);
    const userId = query.userId === undefined || query.userId === "" ? undefined : uuidInput(query.userId, "userId");
    const values: unknown[] = [limit + 1];
    const filters: string[] = [];
    if (status) { values.push(status); filters.push(`o.status=$${values.length}`); }
    if (userId) { values.push(userId); filters.push(`o.user_id=$${values.length}`); }
    if (search) {
      values.push(likeContainsPattern(search));
      filters.push(`(o.id::text ILIKE $${values.length} ESCAPE '\\' OR u.email::text ILIKE $${values.length} ESCAPE '\\' OR u.nickname ILIKE $${values.length} ESCAPE '\\' OR EXISTS (
        SELECT 1 FROM order_lines search_line WHERE search_line.order_id=o.id AND search_line.product_name_snapshot ILIKE $${values.length} ESCAPE '\\'
      ))`);
    }
    if (cursor) { values.push(cursor.createdAt, cursor.id); filters.push(`(o.created_at,o.id)<($${values.length - 1},$${values.length})`); }
    const result = await context.pool.query<OrderSummaryRow>(`
      SELECT o.*,u.email::text AS user_email,u.nickname,
        p.id AS payment_id,p.status AS payment_status,p.provider AS payment_provider,
        count(l.id) AS line_count,COALESCE(sum(l.quantity),0) AS unit_count
      FROM orders o JOIN users u ON u.id=o.user_id JOIN payments p ON p.order_id=o.id
      LEFT JOIN order_lines l ON l.order_id=o.id
      ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
      GROUP BY o.id,u.id,p.id
      ORDER BY o.created_at DESC,o.id DESC LIMIT $1`, values);
    return cursorPage(result.rows, limit, orderSummary);
  });

  app.get("/v1/admin/commerce/orders/:orderId", { preHandler: context.auth.requirePermission("orders.read") }, async (request) => {
    const orderId = uuidInput((request.params as Record<string, unknown>).orderId, "orderId");
    const result = await context.pool.query<OrderSummaryRow>(`
      SELECT o.*,u.email::text AS user_email,u.nickname,
        p.id AS payment_id,p.status AS payment_status,p.provider AS payment_provider,
        count(l.id) AS line_count,COALESCE(sum(l.quantity),0) AS unit_count
      FROM orders o JOIN users u ON u.id=o.user_id JOIN payments p ON p.order_id=o.id
      LEFT JOIN order_lines l ON l.order_id=o.id WHERE o.id=$1
      GROUP BY o.id,u.id,p.id`, [orderId]);
    if (!result.rowCount) throw notFound("주문을 찾을 수 없습니다.");
    const lines = await context.pool.query<{
      id: string; product_id: string; product_name_snapshot: string; category_snapshot: string;
      unit_price: number | string; quantity: number | string; line_total: number | string; probability_version_id: string | null; created_at: Date;
    }>("SELECT * FROM order_lines WHERE order_id=$1 ORDER BY created_at,id", [orderId]);
    const reservations = await context.pool.query<{
      id: string; order_line_id: string; product_id: string; quantity: number | string; status: string; expires_at: Date; resolved_at: Date | null; created_at: Date;
    }>("SELECT * FROM stock_reservations WHERE order_id=$1 ORDER BY created_at,id", [orderId]);
    return {
      ...orderSummary(result.rows[0]!),
      lines: lines.rows.map((line) => ({
        id: line.id, productId: line.product_id, productName: line.product_name_snapshot,
        category: line.category_snapshot, unitPrice: numberValue(line.unit_price), quantity: numberValue(line.quantity),
        lineTotal: numberValue(line.line_total), probabilityVersionId: line.probability_version_id, createdAt: iso(line.created_at),
      })),
      reservations: reservations.rows.map((item) => ({
        id: item.id, orderLineId: item.order_line_id, productId: item.product_id,
        quantity: numberValue(item.quantity), status: item.status, expiresAt: iso(item.expires_at),
        resolvedAt: nullableIso(item.resolved_at), createdAt: iso(item.created_at),
      })),
    };
  });

  app.get("/v1/admin/commerce/payments", { preHandler: context.auth.requirePermission("payments.read") }, async (request) => {
    const query = queryOf(request);
    const { limit, cursor } = pagination(query, "uuid");
    const status = query.status === undefined ? undefined : enumInput(query, "status", PAYMENT_STATUSES);
    const provider = queryString(query.provider, 40);
    const search = queryString(query.q, 200);
    const values: unknown[] = [limit + 1];
    const filters: string[] = [];
    if (status) { values.push(status); filters.push(`p.status=$${values.length}`); }
    if (provider) { values.push(provider); filters.push(`p.provider=$${values.length}`); }
    if (search) {
      values.push(likeContainsPattern(search));
      filters.push(`(p.id::text ILIKE $${values.length} ESCAPE '\\' OR p.order_id::text ILIKE $${values.length} ESCAPE '\\' OR COALESCE(p.provider_payment_id,'') ILIKE $${values.length} ESCAPE '\\' OR u.email::text ILIKE $${values.length} ESCAPE '\\')`);
    }
    if (cursor) { values.push(cursor.createdAt, cursor.id); filters.push(`(p.created_at,p.id)<($${values.length - 1},$${values.length})`); }
    const result = await context.pool.query<PaymentSummaryRow>(`
      SELECT p.*,o.status AS order_status,o.user_id,u.email::text AS user_email,u.nickname
      FROM payments p JOIN orders o ON o.id=p.order_id JOIN users u ON u.id=o.user_id
      ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
      ORDER BY p.created_at DESC,p.id DESC LIMIT $1`, values);
    return cursorPage(result.rows, limit, paymentSummary);
  });

  app.get("/v1/admin/commerce/payments/:paymentId", { preHandler: context.auth.requirePermission("payments.read") }, async (request) => {
    const paymentId = uuidInput((request.params as Record<string, unknown>).paymentId, "paymentId");
    const result = await context.pool.query<PaymentSummaryRow>(`
      SELECT p.*,o.status AS order_status,o.user_id,u.email::text AS user_email,u.nickname
      FROM payments p JOIN orders o ON o.id=p.order_id JOIN users u ON u.id=o.user_id WHERE p.id=$1`, [paymentId]);
    if (!result.rowCount) throw notFound("결제 내역을 찾을 수 없습니다.");
    const ledger = await context.pool.query<{
      id: string; entry_type: string; amount: number | string; currency: string; reference_id: string; reason: string | null; created_at: Date;
    }>("SELECT id,entry_type,amount,currency,reference_id,reason,created_at FROM payment_ledger_entries WHERE payment_id=$1 ORDER BY created_at,id", [paymentId]);
    const events = await context.pool.query<{
      id: string; provider_event_id: string; event_type: string; occurred_at: Date; processed_at: Date | null; processing_error: string | null; created_at: Date; provider_observation: unknown;
    }>(`SELECT id,provider_event_id,event_type,occurred_at,processed_at,processing_error,created_at,
        CASE WHEN event_type='PAYMENT_STATE_ANOMALY' THEN payload->'providerObservation' ELSE NULL END AS provider_observation
       FROM payment_provider_events WHERE payment_id=$1 ORDER BY occurred_at DESC,id DESC`, [paymentId]);
    const paymentRow = result.rows[0]!;
    const refundConfigured = effectiveCommerceMode(context.config) === "LIVE"
      && context.config.paymentProvider === "PORTONE_V2_INICIS"
      && Boolean(context.config.paymentWebhookSecret && context.config.portOne);
    const candidate = refundConfigured && paymentRow.status === "PAID" && paymentRow.order_status === "PAID"
      ? await context.pool.query<NormalDrawRefundCandidate>(REFUND_CANDIDATE_LOOKUP_SQL, [paymentId])
      : null;
    const refundActionBlocker = candidate?.rows[0]
      ? normalDrawRefundBlocker(candidate.rows[0], "PAID")
      : null;
    return {
      ...paymentSummary(paymentRow),
      providerReconciliationAvailable: refundConfigured && isPortOneCardProvider(paymentRow.provider),
      refundActionAvailable: Boolean(candidate?.rowCount) && refundActionBlocker === null,
      refundActionBlocker,
      ledger: ledger.rows.map((entry) => ({
        id: entry.id, entryType: entry.entry_type, amount: numberValue(entry.amount), currency: entry.currency,
        referenceId: entry.reference_id, reason: entry.reason, createdAt: iso(entry.created_at),
      })),
      providerEvents: events.rows.map((event) => ({
        id: event.id, providerEventId: event.provider_event_id, eventType: event.event_type,
        occurredAt: iso(event.occurred_at), processedAt: nullableIso(event.processed_at),
        processingError: event.processing_error?.slice(0, 500) || null, createdAt: iso(event.created_at),
        providerObservation: safePaymentProviderObservation(event.provider_observation),
      })),
    };
  });

  app.get("/v1/admin/commerce/refund-reviews", { preHandler: context.auth.requirePermission("refunds.read") }, async (request) => {
    const query = queryOf(request);
    const { limit, cursor } = pagination(query, "uuid");
    const operationStatus = query.operationStatus === undefined ? undefined : enumInput(query, "operationStatus", REVIEW_FILTER_STATUSES);
    const search = queryString(query.q, 200);
    const values: unknown[] = [limit + 1];
    const filters = ["(p.status='REFUND_REVIEW' OR o.status='REFUND_REVIEW' OR r.id IS NOT NULL OR a.payment_id IS NOT NULL)"];
    if (operationStatus === "UNTRACKED") filters.push("r.id IS NULL AND a.payment_id IS NULL");
    else if (operationStatus) { values.push(operationStatus); filters.push(`r.status=$${values.length}`); }
    if (search) {
      values.push(likeContainsPattern(search));
      filters.push(`(p.id::text ILIKE $${values.length} ESCAPE '\\' OR o.id::text ILIKE $${values.length} ESCAPE '\\' OR COALESCE(p.provider_payment_id,'') ILIKE $${values.length} ESCAPE '\\' OR u.email::text ILIKE $${values.length} ESCAPE '\\')`);
    }
    if (cursor) { values.push(cursor.createdAt, cursor.id); filters.push(`(p.created_at,p.id)<($${values.length - 1},$${values.length})`); }
    const result = await context.pool.query<RefundReviewRow>(`
      SELECT p.*,o.status AS order_status,o.user_id,u.email::text AS user_email,u.nickname,
        r.id AS review_id,r.status AS review_status,r.assigned_admin_id,r.version AS review_version,
        r.updated_at AS review_updated_at,r.closed_at AS review_closed_at,
        a.payment_id AS cancellation_attempt_id,a.status AS cancellation_attempt_status
      FROM payments p JOIN orders o ON o.id=p.order_id JOIN users u ON u.id=o.user_id
      LEFT JOIN admin_commerce_reviews r ON r.payment_id=p.id
      LEFT JOIN portone_refund_cancellation_attempts a ON a.payment_id=p.id
      WHERE ${filters.join(" AND ")} ORDER BY p.created_at DESC,p.id DESC LIMIT $1`, values);
    return cursorPage(result.rows, limit, refundReviewSummary);
  });

  app.get("/v1/admin/commerce/refund-reviews/:paymentId", { preHandler: context.auth.requirePermission("refunds.read") }, async (request) => {
    const paymentId = uuidInput((request.params as Record<string, unknown>).paymentId, "paymentId");
    const result = await context.pool.query<RefundReviewRow>(`
      SELECT p.*,o.status AS order_status,o.user_id,u.email::text AS user_email,u.nickname,
        r.id AS review_id,r.status AS review_status,r.assigned_admin_id,r.version AS review_version,
        r.updated_at AS review_updated_at,r.closed_at AS review_closed_at,
        a.payment_id AS cancellation_attempt_id,a.status AS cancellation_attempt_status
      FROM payments p JOIN orders o ON o.id=p.order_id JOIN users u ON u.id=o.user_id
      LEFT JOIN admin_commerce_reviews r ON r.payment_id=p.id
      LEFT JOIN portone_refund_cancellation_attempts a ON a.payment_id=p.id WHERE p.id=$1`, [paymentId]);
    if (!result.rowCount) throw notFound("환불 검토 대상을 찾을 수 없습니다.");
    const row = result.rows[0]!;
    if (row.status !== "REFUND_REVIEW" && row.order_status !== "REFUND_REVIEW" && !row.review_id && !row.cancellation_attempt_id) throw notFound("환불 검토 대상을 찾을 수 없습니다.");
    const notes = row.review_id ? await context.pool.query<{
      id: string; admin_id: string; admin_nickname: string; status_snapshot: ReviewStatus; note: string; created_at: Date;
    }>(`SELECT n.id,n.admin_id,u.nickname AS admin_nickname,n.status_snapshot,n.note,n.created_at
        FROM admin_commerce_review_notes n JOIN users u ON u.id=n.admin_id
        WHERE n.review_id=$1 ORDER BY n.created_at DESC,n.id DESC`, [row.review_id]) : { rows: [] };
    const safety = await context.pool.query<{
      expected_purchase_units: number | string; actual_purchase_units: number | string; unsafe_purchase_units: number | string;
      expected_draw_units: number | string; actual_draw_entitlements: number | string; consumed_draw_entitlements: number | string;
    }>(`SELECT
      COALESCE((SELECT sum(l.quantity) FROM order_lines l WHERE l.order_id=o.id AND l.category_snapshot IN ('figure','tcg')),0) AS expected_purchase_units,
      (SELECT count(*) FROM inventory_units i JOIN order_lines l ON l.id=i.source_id WHERE l.order_id=o.id AND i.source_type='PURCHASE') AS actual_purchase_units,
      (SELECT count(*) FROM inventory_units i JOIN order_lines l ON l.id=i.source_id WHERE l.order_id=o.id AND i.source_type='PURCHASE' AND (i.owner_id<>o.user_id OR i.status<>'OWNED')) AS unsafe_purchase_units,
      COALESCE((SELECT sum(l.quantity) FROM order_lines l WHERE l.order_id=o.id AND l.category_snapshot IN ('gacha','kuji')),0) AS expected_draw_units,
      (SELECT count(*) FROM draw_entitlements e JOIN order_lines l ON l.id=e.order_line_id WHERE l.order_id=o.id) AS actual_draw_entitlements,
      (SELECT count(*) FROM draw_entitlements e JOIN order_lines l ON l.id=e.order_line_id WHERE l.order_id=o.id AND e.status='CONSUMED') AS consumed_draw_entitlements
      FROM orders o WHERE o.id=$1`, [row.order_id]);
    const asset = safety.rows[0]!;
    const cancellation = await context.pool.query<{
      status: string; provider_cancellation_id: string | null; provider_status: string | null;
      last_error_code: string | null; created_at: Date; updated_at: Date;
    }>(`SELECT status,provider_cancellation_id,provider_status,last_error_code,created_at,updated_at
        FROM portone_refund_cancellation_attempts WHERE payment_id=$1`, [paymentId]);
    const attempt = cancellation.rows[0];
    const lateRefundConfigured = effectiveCommerceMode(context.config) === "LIVE"
      && context.config.paymentProvider === "PORTONE_V2_INICIS"
      && Boolean(context.config.paymentWebhookSecret && context.config.portOne);
    const lateCandidate = lateRefundConfigured && !attempt
      && row.status === "REFUND_REVIEW" && row.order_status === "REFUND_REVIEW"
      ? await context.pool.query<NormalDrawRefundCandidate>(REFUND_CANDIDATE_LOOKUP_SQL, [paymentId])
      : null;
    const providerActionBlocker = lateCandidate?.rows[0]
      ? lateRefundBlocker(lateCandidate.rows[0]) : null;
    return {
      ...refundReviewSummary(row),
      assetSafety: {
        expectedPurchaseUnits: numberValue(asset.expected_purchase_units), actualPurchaseUnits: numberValue(asset.actual_purchase_units),
        unsafePurchaseUnits: numberValue(asset.unsafe_purchase_units), expectedDrawUnits: numberValue(asset.expected_draw_units),
        actualDrawEntitlements: numberValue(asset.actual_draw_entitlements), consumedDrawEntitlements: numberValue(asset.consumed_draw_entitlements),
      },
      notes: notes.rows.map((note) => ({
        id: note.id, adminId: note.admin_id, adminNickname: note.admin_nickname,
        status: note.status_snapshot, note: note.note, createdAt: iso(note.created_at),
      })),
      providerCancellation: attempt ? {
        status: row.status === "REFUNDED" ? "RECONCILED" : attempt.status,
        providerCancellationId: attempt.provider_cancellation_id,
        providerStatus: attempt.provider_status,
        lastErrorCode: attempt.last_error_code,
        createdAt: iso(attempt.created_at), updatedAt: iso(attempt.updated_at),
      } : null,
      providerActionAvailable: Boolean(lateCandidate?.rowCount) && providerActionBlocker === null,
      providerActionBlocker,
      providerReconciliationAvailable: Boolean(attempt)
        && row.status !== "REFUNDED"
        && effectiveCommerceMode(context.config) === "LIVE"
        && context.config.paymentProvider === "PORTONE_V2_INICIS"
        && Boolean(context.config.paymentWebhookSecret && context.config.portOne),
    };
  });

  app.post("/v1/admin/commerce/refund-reviews/:paymentId", { preHandler: context.auth.requirePermission("refunds.review") }, async (request, reply) => {
    const paymentId = uuidInput((request.params as Record<string, unknown>).paymentId, "paymentId");
    const body = objectInput(request.body);
    const status = enumInput(body, "status", REVIEW_STATUSES)!;
    const note = stringInput(body, "note", { min: 2, max: 5000 })!;
    const expectedVersion = integerInput(body, "expectedVersion", { min: 0, max: 2_147_483_647 })!;
    const reason = stringInput(body, "reason", { min: 2, max: 1000 })!;
    const mutation = adminMutationHeaders(request, reason);
    const hash = requestHash({ paymentId, status, note, expectedVersion, reason });
    const result = await withTransaction(context.pool, async (client) => {
      const idem = await beginIdempotency(client, { actorId: request.actor!.userId, scope: "ADMIN_REFUND_REVIEW", key: mutation.idempotencyKey, hash });
      if (!idem.fresh) return { replay: true, statusCode: idem.statusCode, body: idem.body };
      const payment = await client.query<{ id: string; order_id: string; status: PaymentStatus; order_status: OrderStatus }>(`
        SELECT p.id,p.order_id,p.status,o.status AS order_status FROM payments p JOIN orders o ON o.id=p.order_id
        WHERE p.id=$1 FOR UPDATE OF p,o`, [paymentId]);
      if (!payment.rowCount) throw notFound("환불 검토 대상을 찾을 수 없습니다.");
      const raw = payment.rows[0]!;
      const current = await client.query<{
        id: string; status: ReviewStatus; assigned_admin_id: string | null; closed_at: Date | null; version: number; created_at: Date; updated_at: Date;
      }>("SELECT * FROM admin_commerce_reviews WHERE payment_id=$1 FOR UPDATE", [paymentId]);
      if (!current.rowCount && raw.status !== "REFUND_REVIEW" && raw.order_status !== "REFUND_REVIEW") throw conflict("공급자 또는 주문 원장에 환불 검토 상태가 없습니다.");
      const before = current.rows[0] || null;
      if (numberValue(before?.version) !== expectedVersion) throw conflict("다른 운영자가 먼저 환불 검토 상태를 변경했습니다.");
      if (!before && status !== "PENDING" && status !== "IN_REVIEW") throw conflict("환불 운영 검토는 대기 또는 검토 중 상태로 시작해야 합니다.");
      if (before && !allowedReviewTransition(before.status, status)) throw conflict(`허용되지 않은 환불 검토 상태 변경입니다: ${before.status} → ${status}`);
      if (status === "CLOSED" && (raw.status === "REFUND_REVIEW" || raw.order_status === "REFUND_REVIEW")) {
        throw conflict("결제와 주문 원장의 환불 검토가 해소된 뒤에만 운영 검토를 종료할 수 있습니다.");
      }
      const saved = current.rowCount
        ? await client.query<{ id: string; status: ReviewStatus; assigned_admin_id: string; closed_at: Date | null; version: number; created_at: Date; updated_at: Date }>(`
            UPDATE admin_commerce_reviews SET status=$2,assigned_admin_id=$3,
              closed_at=CASE WHEN $2='CLOSED' THEN COALESCE(closed_at,now()) ELSE NULL END,version=version+1
            WHERE id=$1 RETURNING *`, [before!.id, status, request.actor!.userId])
        : await client.query<{ id: string; status: ReviewStatus; assigned_admin_id: string; closed_at: Date | null; version: number; created_at: Date; updated_at: Date }>(`
            INSERT INTO admin_commerce_reviews(payment_id,status,assigned_admin_id,closed_at)
            VALUES($1,$2,$3,CASE WHEN $2='CLOSED' THEN now() ELSE NULL END) RETURNING *`, [paymentId, status, request.actor!.userId]);
      const review = saved.rows[0]!;
      await client.query("INSERT INTO admin_commerce_review_notes(review_id,admin_id,status_snapshot,note) VALUES($1,$2,$3,$4)", [review.id, request.actor!.userId, status, note]);
      const responseBody = {
        id: review.id, paymentId, status: review.status, assignedAdminId: review.assigned_admin_id,
        version: review.version, updatedAt: iso(review.updated_at), closedAt: nullableIso(review.closed_at), providerActionExecuted: false,
      };
      await writeAdminAudit(client, request, request.actor!, {
        action: "REFUND_REVIEW_NOTE_RECORDED", targetType: "PAYMENT", targetId: paymentId, reason,
        before: before ? { status: before.status, assignedAdminId: before.assigned_admin_id, version: before.version } : null,
        after: { status: review.status, assignedAdminId: review.assigned_admin_id, version: review.version },
        metadata: { orderId: raw.order_id, providerActionExecuted: false },
      });
      await completeIdempotency(client, idem.id, { statusCode: 200, body: responseBody, resourceType: "ADMIN_COMMERCE_REVIEW", resourceId: review.id });
      return { replay: false, statusCode: 200, body: responseBody };
    });
    return sendMutation(reply, result);
  });

  app.get("/v1/admin/commerce/inventory", { preHandler: context.auth.requirePermission("inventory.read") }, async (request) => {
    const query = queryOf(request);
    const { limit, cursor } = pagination(query, "uuid");
    const search = queryString(query.q);
    const category = query.category === undefined || query.category === "" ? undefined : enumInput(query, "category", ["gacha", "figure", "kuji", "tcg"] as const);
    const values: unknown[] = [limit + 1];
    const filters: string[] = [];
    if (search) { values.push(likeContainsPattern(search)); filters.push(`(p.name ILIKE $${values.length} ESCAPE '\\' OR p.sku ILIKE $${values.length} ESCAPE '\\' OR p.id ILIKE $${values.length} ESCAPE '\\')`); }
    if (category) { values.push(category); filters.push(`p.category=$${values.length}`); }
    if (cursor) { values.push(cursor.createdAt, cursor.id); filters.push(`(p.created_at,p.id)<($${values.length - 1},$${values.length})`); }
    const result = await context.pool.query<InventoryRow>(`
      SELECT p.id,p.sku,p.name,p.category,p.ip_id,p.is_active,p.created_at,s.updated_at,
        s.on_hand,s.reserved,s.version AS stock_version,v.id AS active_draw_version_id,
        pool.pool_has_unlimited,pool.finite_remaining,
        COALESCE((SELECT count(*) FROM draw_entitlements e WHERE e.product_id=p.id AND e.probability_version_id=v.id AND e.status='AVAILABLE'),0) AS outstanding_entitlements
      FROM catalog_products p JOIN product_stock s ON s.product_id=p.id
      LEFT JOIN draw_probability_versions v ON v.product_id=p.id AND v.status='ACTIVE'
      LEFT JOIN LATERAL (
        SELECT COALESCE(bool_or(e.remaining_quantity IS NULL),false) AS pool_has_unlimited,
          COALESCE(sum(e.remaining_quantity) FILTER (WHERE e.remaining_quantity IS NOT NULL),0) AS finite_remaining
        FROM draw_pool_entries e WHERE e.probability_version_id=v.id
      ) pool ON v.id IS NOT NULL
      ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
      ORDER BY p.created_at DESC,p.id DESC LIMIT $1`, values);
    return cursorPage(result.rows, limit, inventorySummary);
  });

  app.get("/v1/admin/commerce/inventory/:productId", { preHandler: context.auth.requirePermission("inventory.read") }, async (request) => {
    const productId = slugIdInput((request.params as Record<string, unknown>).productId, "productId");
    const result = await context.pool.query<InventoryRow>(`
      SELECT p.id,p.sku,p.name,p.category,p.ip_id,p.is_active,p.created_at,s.updated_at,
        s.on_hand,s.reserved,s.version AS stock_version,v.id AS active_draw_version_id,
        pool.pool_has_unlimited,pool.finite_remaining,
        COALESCE((SELECT count(*) FROM draw_entitlements e WHERE e.product_id=p.id AND e.probability_version_id=v.id AND e.status='AVAILABLE'),0) AS outstanding_entitlements
      FROM catalog_products p JOIN product_stock s ON s.product_id=p.id
      LEFT JOIN draw_probability_versions v ON v.product_id=p.id AND v.status='ACTIVE'
      LEFT JOIN LATERAL (
        SELECT COALESCE(bool_or(e.remaining_quantity IS NULL),false) AS pool_has_unlimited,
          COALESCE(sum(e.remaining_quantity) FILTER (WHERE e.remaining_quantity IS NOT NULL),0) AS finite_remaining
        FROM draw_pool_entries e WHERE e.probability_version_id=v.id
      ) pool ON v.id IS NOT NULL WHERE p.id=$1`, [productId]);
    if (!result.rowCount) throw notFound("상품 재고를 찾을 수 없습니다.");
    const adjustments = await context.pool.query<{
      id: string; admin_id: string; admin_nickname: string; delta_on_hand: number; before_on_hand: number; after_on_hand: number;
      before_reserved: number; after_reserved: number; reason: string; request_id: string; created_at: Date;
    }>(`SELECT l.id,l.admin_id,u.nickname AS admin_nickname,l.delta_on_hand,l.before_on_hand,l.after_on_hand,
        l.before_reserved,l.after_reserved,l.reason,l.request_id,l.created_at
      FROM product_stock_adjustment_ledger l JOIN users u ON u.id=l.admin_id
      WHERE l.product_id=$1 ORDER BY l.created_at DESC,l.id DESC LIMIT 100`, [productId]);
    const reservations = await context.pool.query<{
      id: string; order_id: string; quantity: number | string; status: string; expires_at: Date; resolved_at: Date | null; created_at: Date;
    }>("SELECT id,order_id,quantity,status,expires_at,resolved_at,created_at FROM stock_reservations WHERE product_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100", [productId]);
    return {
      ...inventorySummary(result.rows[0]!),
      adjustments: adjustments.rows.map((item) => ({
        id: item.id, adminId: item.admin_id, adminNickname: item.admin_nickname, deltaOnHand: item.delta_on_hand,
        beforeOnHand: item.before_on_hand, afterOnHand: item.after_on_hand, beforeReserved: item.before_reserved,
        afterReserved: item.after_reserved, reason: item.reason, requestId: item.request_id, createdAt: iso(item.created_at),
      })),
      reservations: reservations.rows.map((item) => ({
        id: item.id, orderId: item.order_id, quantity: numberValue(item.quantity), status: item.status,
        expiresAt: iso(item.expires_at), resolvedAt: nullableIso(item.resolved_at), createdAt: iso(item.created_at),
      })),
    };
  });

  app.post("/v1/admin/commerce/inventory/:productId/adjustments", { preHandler: context.auth.requirePermission("inventory.adjust") }, async (request, reply) => {
    const productId = slugIdInput((request.params as Record<string, unknown>).productId, "productId");
    const body = objectInput(request.body);
    const deltaOnHand = integerInput(body, "deltaOnHand", { min: -2_147_483_647, max: 2_147_483_647 })!;
    if (deltaOnHand === 0) throw badRequest("재고 증감 수량은 0일 수 없습니다.");
    const expectedVersion = integerInput(body, "expectedVersion", { min: 1, max: 2_147_483_647 })!;
    const reason = stringInput(body, "reason", { min: 2, max: 1000 })!;
    const mutation = adminMutationHeaders(request, reason);
    const hash = requestHash({ productId, deltaOnHand, expectedVersion, reason });
    const result = await withTransaction(context.pool, async (client) => {
      const idem = await beginIdempotency(client, { actorId: request.actor!.userId, scope: "ADMIN_INVENTORY_ADJUST", key: mutation.idempotencyKey, hash });
      if (!idem.fresh) return { replay: true, statusCode: idem.statusCode, body: idem.body };
      const stock = await client.query<{
        id: string; name: string; category: string; on_hand: number; reserved: number; version: number; active_draw_version_id: string | null;
      }>(`SELECT p.id,p.name,p.category,s.on_hand,s.reserved,s.version,v.id AS active_draw_version_id
        FROM catalog_products p JOIN product_stock s ON s.product_id=p.id
        LEFT JOIN draw_probability_versions v ON v.product_id=p.id AND v.status='ACTIVE'
        WHERE p.id=$1 FOR UPDATE OF p,s`, [productId]);
      if (!stock.rowCount) throw notFound("상품 재고를 찾을 수 없습니다.");
      const before = stock.rows[0]!;
      if (before.version !== expectedVersion) throw conflict("다른 작업이 먼저 재고를 변경했습니다.");
      const afterOnHand = numberValue(before.on_hand) + deltaOnHand;
      if (!Number.isSafeInteger(afterOnHand) || afterOnHand < numberValue(before.reserved)) throw conflict("조정 후 재고는 예약 수량보다 적을 수 없습니다.");
      if (before.active_draw_version_id) await assertDrawCapacity(client, {
        probabilityVersionId: before.active_draw_version_id, productId, onHand: afterOnHand,
      });
      const updated = await client.query<{ on_hand: number; reserved: number; version: number; updated_at: Date }>(`
        UPDATE product_stock SET on_hand=$2,version=version+1 WHERE product_id=$1 RETURNING on_hand,reserved,version,updated_at`, [productId, afterOnHand]);
      const after = updated.rows[0]!;
      const ledger = await client.query<{ id: string; created_at: Date }>(`
        INSERT INTO product_stock_adjustment_ledger(
          product_id,admin_id,delta_on_hand,before_on_hand,after_on_hand,before_reserved,after_reserved,reason,request_id,idempotency_key
        ) VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9) RETURNING id,created_at`, [
        productId, request.actor!.userId, deltaOnHand, before.on_hand, after.on_hand, before.reserved, reason, request.id, mutation.idempotencyKey,
      ]);
      const responseBody = {
        adjustmentId: ledger.rows[0]!.id, productId, deltaOnHand, onHand: numberValue(after.on_hand),
        reserved: numberValue(after.reserved), available: numberValue(after.on_hand) - numberValue(after.reserved),
        version: after.version, createdAt: iso(ledger.rows[0]!.created_at),
      };
      await writeAdminAudit(client, request, request.actor!, {
        action: "PRODUCT_STOCK_ADJUSTED", targetType: "PRODUCT_STOCK", targetId: productId, reason,
        before: { onHand: numberValue(before.on_hand), reserved: numberValue(before.reserved), version: before.version },
        after: { onHand: numberValue(after.on_hand), reserved: numberValue(after.reserved), version: after.version },
        metadata: { adjustmentId: ledger.rows[0]!.id, deltaOnHand },
      });
      await writeOutbox(client, request.id, {
        aggregateType: "PRODUCT_STOCK", aggregateId: productId, eventType: "inventory.stock_adjusted",
        payload: { productId, adjustmentId: ledger.rows[0]!.id, deltaOnHand, onHand: numberValue(after.on_hand) },
      });
      await completeIdempotency(client, idem.id, { statusCode: 200, body: responseBody, resourceType: "PRODUCT_STOCK_ADJUSTMENT", resourceId: ledger.rows[0]!.id });
      return { replay: false, statusCode: 200, body: responseBody };
    });
    return sendMutation(reply, result);
  });

  app.get("/v1/admin/commerce/shipping", { preHandler: context.auth.requirePermission("shipping.read") }, async (request) => {
    const query = queryOf(request);
    const { limit, cursor } = pagination(query, "uuid");
    const status = query.status === undefined ? undefined : enumInput(query, "status", SHIPPING_STATUSES);
    const search = queryString(query.q, 200);
    const values: unknown[] = [limit + 1];
    const filters: string[] = [];
    if (status) { values.push(status); filters.push(`s.status=$${values.length}`); }
    if (search) {
      values.push(likeContainsPattern(search));
      filters.push(`(s.id::text ILIKE $${values.length} ESCAPE '\\' OR u.email::text ILIKE $${values.length} ESCAPE '\\' OR u.nickname ILIKE $${values.length} ESCAPE '\\' OR COALESCE(s.tracking_number,'') ILIKE $${values.length} ESCAPE '\\')`);
    }
    if (cursor) { values.push(cursor.createdAt, cursor.id); filters.push(`(s.requested_at,s.id)<($${values.length - 1},$${values.length})`); }
    const result = await context.pool.query<ShippingSummaryRow>(`
      SELECT s.id,s.user_id,s.status,s.requested_at,s.shipped_at,s.tracking_carrier,s.tracking_number,s.version,s.updated_at,
        s.requested_at AS created_at,u.email::text AS user_email,u.nickname,count(i.inventory_unit_id) AS item_count
      FROM shipping_requests s JOIN users u ON u.id=s.user_id
      LEFT JOIN shipping_request_items i ON i.shipping_request_id=s.id
      ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
      GROUP BY s.id,u.id ORDER BY s.requested_at DESC,s.id DESC LIMIT $1`, values);
    return cursorPage(result.rows, limit, shippingSummary);
  });

  app.get("/v1/admin/commerce/shipping/:shippingRequestId", {
    preHandler: [
      context.auth.requirePermission("shipping.read"),
      context.auth.requirePermission("shipping.destination.read"),
    ],
  }, async (request) => {
    const shippingRequestId = uuidInput((request.params as Record<string, unknown>).shippingRequestId, "shippingRequestId");
    const result = await context.pool.query<ShippingRow>(`
      SELECT s.*,s.requested_at AS created_at,u.email::text AS user_email,u.nickname,count(i.inventory_unit_id) AS item_count
      FROM shipping_requests s JOIN users u ON u.id=s.user_id
      LEFT JOIN shipping_request_items i ON i.shipping_request_id=s.id WHERE s.id=$1
      GROUP BY s.id,u.id`, [shippingRequestId]);
    if (!result.rowCount) throw notFound("배송 신청을 찾을 수 없습니다.");
    const items = await context.pool.query<{
      inventory_unit_id: string; product_id: string; product_name: string; sku: string; inventory_status: InventoryUnitStatus;
    }>(`SELECT i.inventory_unit_id,u.product_id,p.name AS product_name,p.sku,u.status AS inventory_status
      FROM shipping_request_items i JOIN inventory_units u ON u.id=i.inventory_unit_id
      JOIN catalog_products p ON p.id=u.product_id WHERE i.shipping_request_id=$1 ORDER BY i.inventory_unit_id`, [shippingRequestId]);
    const events = await context.pool.query<{
      id: string; admin_id: string; admin_nickname: string; from_status: ShippingStatus; to_status: ShippingStatus;
      tracking_carrier: string | null; tracking_number: string | null; reason: string; request_id: string; created_at: Date;
    }>(`SELECT e.id,e.admin_id,u.nickname AS admin_nickname,e.from_status,e.to_status,e.tracking_carrier,e.tracking_number,e.reason,e.request_id,e.created_at
      FROM shipping_status_events e JOIN users u ON u.id=e.admin_id
      WHERE e.shipping_request_id=$1 ORDER BY e.created_at DESC,e.id DESC`, [shippingRequestId]);
    return {
      ...shippingSummary(result.rows[0]!),
      destination: addressSnapshot(result.rows[0]!.address_snapshot),
      items: items.rows.map((item) => ({
        inventoryUnitId: item.inventory_unit_id, productId: item.product_id, productName: item.product_name,
        sku: item.sku, inventoryStatus: item.inventory_status,
      })),
      events: events.rows.map((event) => ({
        id: event.id, adminId: event.admin_id, adminNickname: event.admin_nickname,
        fromStatus: event.from_status, toStatus: event.to_status, trackingCarrier: event.tracking_carrier,
        trackingNumber: event.tracking_number, reason: event.reason, requestId: event.request_id, createdAt: iso(event.created_at),
      })),
    };
  });

  app.post("/v1/admin/commerce/shipping/:shippingRequestId/status", { preHandler: [requireLiveCommerce(context), context.auth.requirePermission("shipping.manage")] }, async (request, reply) => {
    const shippingRequestId = uuidInput((request.params as Record<string, unknown>).shippingRequestId, "shippingRequestId");
    const body = objectInput(request.body);
    const status = enumInput(body, "status", SHIPPING_TARGET_STATUSES)!;
    const expectedVersion = integerInput(body, "expectedVersion", { min: 1, max: 2_147_483_647 })!;
    const reason = stringInput(body, "reason", { min: 2, max: 1000 })!;
    const trackingCarrier = nullableStringInput(body, "trackingCarrier", { max: 100 }) ?? null;
    const trackingNumber = nullableStringInput(body, "trackingNumber", { max: 200 }) ?? null;
    if ((trackingCarrier === null) !== (trackingNumber === null)) throw badRequest("택배사와 운송장 번호를 함께 입력해 주세요.");
    if (status === "SHIPPED" && (!trackingCarrier || !trackingNumber)) throw badRequest("출고 처리에는 택배사와 운송장 번호가 필요합니다.");
    if (status !== "SHIPPED" && (trackingCarrier || trackingNumber)) throw badRequest("택배 정보는 출고 처리 단계에서만 입력할 수 있습니다.");
    const mutation = adminMutationHeaders(request, reason);
    const hash = requestHash({ shippingRequestId, status, expectedVersion, reason, trackingCarrier, trackingNumber });
    const result = await withTransaction(context.pool, async (client) => {
      const idem = await beginIdempotency(client, { actorId: request.actor!.userId, scope: "ADMIN_SHIPPING_TRANSITION", key: mutation.idempotencyKey, hash });
      if (!idem.fresh) return { replay: true, statusCode: idem.statusCode, body: idem.body };
      // Lock a linked shipping-fee order before its request, in the same order as the
      // payment webhook, so a refund review observed concurrently cannot be bypassed.
      const feeOrder = await client.query<{ status: string }>(
        "SELECT status FROM orders WHERE shipping_request_id=$1 AND order_kind='SHIPPING_FEE' FOR UPDATE",
        [shippingRequestId],
      );
      const locked = await client.query<{
        id: string; user_id: string; status: ShippingStatus; tracking_carrier: string | null; tracking_number: string | null;
        shipped_at: Date | null; version: number; updated_at: Date;
      }>("SELECT id,user_id,status,tracking_carrier,tracking_number,shipped_at,version,updated_at FROM shipping_requests WHERE id=$1 FOR UPDATE", [shippingRequestId]);
      if (!locked.rowCount) throw notFound("배송 신청을 찾을 수 없습니다.");
      const before = locked.rows[0]!;
      if (before.version !== expectedVersion) throw conflict("다른 작업이 먼저 배송 상태를 변경했습니다.");
      if (!allowedShippingTransition(before.status, status)) throw conflict(`허용되지 않은 배송 상태 변경입니다: ${before.status} → ${status}`);
      if (!shippingFeeAllowsDispatch(feeOrder.rows[0]?.status ?? null, status)) {
        throw conflict("배송비 결제가 환불 검토 중이거나 확정되지 않아 배송을 진행할 수 없습니다.");
      }
      const inventory = await client.query<{ id: string; status: InventoryUnitStatus }>(`
        SELECT u.id,u.status FROM shipping_request_items i JOIN inventory_units u ON u.id=i.inventory_unit_id
        WHERE i.shipping_request_id=$1 ORDER BY u.id FOR UPDATE OF u`, [shippingRequestId]);
      if (!inventory.rowCount || inventory.rows.some((item) => item.status !== "SHIPPING")) throw conflict("배송 대상 상품 상태가 일치하지 않습니다.");
      const terminalInventoryStatus = status === "CANCELLED"
        ? "OWNED"
        : status === "DELIVERED"
          ? "DELIVERED"
          : null;
      if (terminalInventoryStatus) {
        const transitioned = await client.query<{ id: string }>(`
          UPDATE inventory_units SET status=$2
          WHERE id=ANY($1::uuid[]) AND status='SHIPPING' RETURNING id`, [
          inventory.rows.map((item) => item.id),
          terminalInventoryStatus,
        ]);
        if (transitioned.rowCount !== inventory.rowCount) throw conflict("배송 종료 처리 중 상품 상태가 변경되었습니다.");
      }
      const nextCarrier = status === "SHIPPED" ? trackingCarrier : status === "DELIVERED" ? before.tracking_carrier : null;
      const nextTracking = status === "SHIPPED" ? trackingNumber : status === "DELIVERED" ? before.tracking_number : null;
      const nextShippedAt = status === "SHIPPED" ? new Date() : status === "DELIVERED" ? before.shipped_at : null;
      const updated = await client.query<{
        id: string; status: ShippingStatus; tracking_carrier: string | null; tracking_number: string | null; shipped_at: Date | null; version: number; updated_at: Date;
      }>(`UPDATE shipping_requests SET status=$2,tracking_carrier=$3,tracking_number=$4,shipped_at=$5,version=version+1
        WHERE id=$1 RETURNING id,status,tracking_carrier,tracking_number,shipped_at,version,updated_at`, [
        shippingRequestId, status, nextCarrier, nextTracking, nextShippedAt,
      ]);
      const after = updated.rows[0]!;
      const event = await client.query<{ id: string; created_at: Date }>(`
        INSERT INTO shipping_status_events(
          shipping_request_id,admin_id,from_status,to_status,tracking_carrier,tracking_number,reason,request_id,idempotency_key
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,created_at`, [
        shippingRequestId, request.actor!.userId, before.status, status, nextCarrier, nextTracking, reason, request.id, mutation.idempotencyKey,
      ]);
      const responseBody = {
        id: shippingRequestId, status: after.status, trackingCarrier: after.tracking_carrier,
        trackingNumber: after.tracking_number, shippedAt: nullableIso(after.shipped_at),
        version: after.version, updatedAt: iso(after.updated_at), eventId: event.rows[0]!.id,
      };
      await writeAdminAudit(client, request, request.actor!, {
        action: "SHIPPING_STATUS_CHANGED", targetType: "SHIPPING_REQUEST", targetId: shippingRequestId, reason,
        before: { status: before.status, trackingCarrier: before.tracking_carrier, trackingNumber: before.tracking_number, version: before.version },
        after: { status: after.status, trackingCarrier: after.tracking_carrier, trackingNumber: after.tracking_number, version: after.version },
        metadata: { eventId: event.rows[0]!.id, inventoryUnitCount: inventory.rowCount },
      });
      await writeOutbox(client, request.id, {
        aggregateType: "SHIPPING_REQUEST", aggregateId: shippingRequestId, eventType: `shipping.${status.toLocaleLowerCase("en-US")}`,
        payload: { shippingRequestId, userId: before.user_id, status, trackingCarrier: nextCarrier, trackingNumber: nextTracking },
      });
      await completeIdempotency(client, idem.id, { statusCode: 200, body: responseBody, resourceType: "SHIPPING_STATUS_EVENT", resourceId: event.rows[0]!.id });
      return { replay: false, statusCode: 200, body: responseBody };
    });
    return sendMutation(reply, result);
  });
}
