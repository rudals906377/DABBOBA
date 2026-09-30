/**
 * Pure helpers for abandoning a PortOne payment window the customer closed.
 *
 * The server route `POST /v1/payments/{paymentId}/abandon` is owner-only and
 * idempotent: 200 cancels the pending order, 409 means the server already has
 * payment evidence, so the client must fall back to the normal confirm path.
 */

const IDEMPOTENCY_KEY_MAX_LENGTH = 200;

/** One stable key per paymentId so retries replay the same abandon request. */
export function paymentAbandonIdempotencyKey(paymentId: string): string {
  const safe = paymentId.replace(/[^A-Za-z0-9._:-]/g, "_");
  return `payment-abandon:${safe}`.slice(0, IDEMPOTENCY_KEY_MAX_LENGTH);
}

export type PaymentAbandonOutcome =
  | { kind: "ABANDONED"; paymentId: string; orderId: string | null }
  | { kind: "PAYMENT_EVIDENCE" };

/** Local response shape until the generated contract includes the route. */
export type PaymentAbandonResponseBody = {
  paymentId?: unknown;
  orderId?: unknown;
  error?: { code?: unknown; message?: unknown };
};

export class PaymentAbandonError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PaymentAbandonError";
    this.status = status;
  }
}

export function interpretPaymentAbandonResponse(
  status: number,
  body: PaymentAbandonResponseBody | null,
  expectedPaymentId: string,
): PaymentAbandonOutcome {
  if (status === 409) return { kind: "PAYMENT_EVIDENCE" };
  if (status !== 200) {
    throw new PaymentAbandonError(
      typeof body?.error?.message === "string" ? body.error.message : "결제 취소 상태를 확인하지 못했어요.",
      status,
    );
  }
  if (typeof body?.paymentId === "string" && body.paymentId !== expectedPaymentId) {
    throw new PaymentAbandonError("결제 취소 응답이 주문과 일치하지 않아요.", 502);
  }
  return {
    kind: "ABANDONED",
    paymentId: expectedPaymentId,
    orderId: typeof body?.orderId === "string" ? body.orderId : null,
  };
}

/**
 * PortOne V2 has no dedicated user-cancel code: a closed PG window resolves the
 * request with a failure `code` (typically `FAILURE_TYPE_PG`) and a PG message
 * or code naming the cancellation, e.g. `[PAY_PROCESS_CANCELED] 사용자가 결제를
 * 취소하였습니다`. The React Native SDK's `onError` only carries the message.
 * A false positive is safe: the server refuses to abandon (409) when payment
 * evidence exists and the client then confirms instead.
 */
const USER_CANCEL_PATTERN = /PAY_PROCESS_CANCELED|USER_CANCEL|사용자가?\s*(?:결제를?\s*)?취소|결제(?:를|가)?\s*취소(?:하였|했|되었|됐)/i;

export type PortOneResultLike = {
  code?: string | null;
  message?: string | null;
  pgCode?: string | null;
  pgMessage?: string | null;
};

export function isPortOneUserCancel(result: PortOneResultLike | null | undefined): boolean {
  if (!result) return false;
  const code = result.code?.trim();
  // A response without a failure code is a completed payment attempt.
  if (!code) return false;
  if (code === "Cancelled") return true;
  return [result.message, result.pgCode, result.pgMessage]
    .some((value) => typeof value === "string" && USER_CANCEL_PATTERN.test(value));
}

/** `onError` from the React Native SDK only preserves the error message. */
export function isPortOneUserCancelError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  const message = typeof candidate.message === "string" ? candidate.message : null;
  return isPortOneUserCancel({
    code: typeof candidate.code === "string" ? candidate.code : "SDK_ERROR",
    message,
  });
}

type AbandonedOrderLike = {
  orderKind?: string | null;
  shippingRequestId?: string | null;
  lines: ReadonlyArray<{ productId: string }>;
};

/**
 * Where a customer lands after an abandoned payment: the product they were
 * buying (replacing checkout, never back into an expired lease), the shipping
 * request for a shipping-fee order, or the order list as a last resort.
 */
export function abandonedPaymentDestination(
  order: AbandonedOrderLike,
  fallbackProductId?: string | null,
): string {
  if (order.orderKind === "SHIPPING_FEE") {
    return order.shippingRequestId
      ? `/profile/shipping/${encodeURIComponent(order.shippingRequestId)}`
      : "/profile/orders";
  }
  const productId = order.lines[0]?.productId ?? fallbackProductId ?? null;
  return productId ? `/product/${encodeURIComponent(productId)}` : "/profile/orders";
}
