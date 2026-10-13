const ORIGIN = "https://api.tosspayments.com";
const STATUSES = ["READY", "IN_PROGRESS", "DONE", "CANCELED", "PARTIAL_CANCELED", "ABORTED", "EXPIRED"] as const;
export type TossPayment = {
  paymentKey: string; orderId: string; mId: string; status: typeof STATUSES[number];
  totalAmount: number; balanceAmount: number; approvedAt: string | null;
  requestedAt: string; lastTransactionKey: string | null; cancelledAt: string | null;
};
export class TossPaymentError extends Error {
  constructor(readonly code: string, readonly httpStatus = 502) { super("토스 결제 상태를 확인하지 못했어요."); }
}
type Options = { secretKey: string; merchantId: string; fetch?: typeof fetch; timeoutMs?: number };
function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{6,200}$/.test(value);
}
export function verifiedTossPayment(raw: unknown, expected: { orderId: string; amount: number; merchantId: string }): TossPayment {
  const p = raw as Record<string, unknown> | null;
  if (!p || !identifier(p.paymentKey) || p.orderId !== expected.orderId || p.mId !== expected.merchantId
    || p.currency !== "KRW" || p.totalAmount !== expected.amount || p.type !== "NORMAL"
    || !STATUSES.includes(p.status as TossPayment["status"])
    || !Number.isSafeInteger(p.balanceAmount) || Number(p.balanceAmount) < 0 || Number(p.balanceAmount) > expected.amount
    || (p.method !== "카드" && p.method !== "간편결제")
    || !Number.isFinite(Date.parse(String(p.requestedAt)))
    || !(p.approvedAt === null || (typeof p.approvedAt === "string" && Number.isFinite(Date.parse(p.approvedAt))))
    || !(p.lastTransactionKey === null || identifier(p.lastTransactionKey))) {
    throw new TossPaymentError("TOSS_CONTRACT_MISMATCH", 409);
  }
  if ((p.status === "DONE" && (p.balanceAmount !== p.totalAmount || !p.approvedAt))
    || (p.status === "CANCELED" && p.balanceAmount !== 0)
    || (p.status === "PARTIAL_CANCELED" && !(Number(p.balanceAmount) > 0 && Number(p.balanceAmount) < expected.amount))) {
    throw new TossPaymentError("TOSS_CONTRACT_MISMATCH", 409);
  }
  let cancelledAt: string | null = null;
  if (p.status === "CANCELED" || p.status === "PARTIAL_CANCELED") {
    const dates = Array.isArray(p.cancels) ? p.cancels.map((cancel: unknown) =>
      cancel && typeof cancel === "object" ? (cancel as Record<string, unknown>).canceledAt : null) : [];
    if (!p.approvedAt || !dates.length || dates.some(date => typeof date !== "string" || !Number.isFinite(Date.parse(date)))) {
      throw new TossPaymentError("TOSS_CONTRACT_MISMATCH", 409);
    }
    cancelledAt = (dates as string[]).reduce((latest, date) => Date.parse(date) > Date.parse(latest) ? date : latest);
  }
  // Do not persist card data, customer PII, raw gateway messages or arbitrary response fields.
  return { paymentKey: p.paymentKey, orderId: expected.orderId, mId: expected.merchantId,
    status: p.status as TossPayment["status"], totalAmount: expected.amount, balanceAmount: Number(p.balanceAmount),
    approvedAt: p.approvedAt as string | null, requestedAt: p.requestedAt as string,
    lastTransactionKey: p.lastTransactionKey as string | null, cancelledAt };
}
export function createTossPaymentsAdapter(options: Options) {
  if (!/^test_sk_[A-Za-z0-9_-]{10,200}$/.test(options.secretKey) || !/^[A-Za-z0-9_-]{1,100}$/.test(options.merchantId)) {
    throw new TossPaymentError("TOSS_TEST_CONFIGURATION_REQUIRED", 503);
  }
  const send = options.fetch ?? fetch;
  async function call(path: string, body?: Record<string, unknown>, idempotencyKey?: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
    try {
      const response = await send(ORIGIN + path, { method: body ? "POST" : "GET", redirect: "manual",
        signal: controller.signal, headers: { authorization: `Basic ${Buffer.from(options.secretKey + ":").toString("base64")}`,
          "content-type": "application/json", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      if (response.status >= 300 && response.status < 400) throw new TossPaymentError("TOSS_REDIRECT_REJECTED");
      if (Number(response.headers.get("content-length")) > 262144) throw new TossPaymentError("TOSS_RESPONSE_TOO_LARGE");
      const reader = response.body?.getReader(); let size = 0; const chunks: Uint8Array[] = [];
      if (reader) { for (;;) { const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength; if (size > 262144) { await reader.cancel(); throw new TossPaymentError("TOSS_RESPONSE_TOO_LARGE"); }
        chunks.push(part.value); } }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!response.ok) {
        const code = data?.code === "NOT_FOUND_PAYMENT" && response.status === 404 ? "NOT_FOUND_PAYMENT" : "TOSS_UPSTREAM_REJECTED";
        throw new TossPaymentError(code, response.status === 404 ? 404 : 502);
      }
      return data;
    } catch (error) {
      if (error instanceof TossPaymentError) throw error;
      throw new TossPaymentError("TOSS_UPSTREAM_UNAVAILABLE");
    } finally { clearTimeout(timeout); }
  }
  const check = (raw: unknown, orderId: string, amount: number) => verifiedTossPayment(raw, { orderId, amount, merchantId: options.merchantId });
  return {
    async lookup(orderId: string, amount: number) {
      if (!identifier(orderId)) throw new TossPaymentError("INVALID_ORDER_ID", 400);
      return check(await call(`/v1/payments/orders/${encodeURIComponent(orderId)}`), orderId, amount);
    },
    async confirm(orderId: string, paymentKey: string, amount: number) {
      if (!identifier(orderId) || !identifier(paymentKey) || !Number.isSafeInteger(amount) || amount < 1) throw new TossPaymentError("INVALID_CONFIRM", 400);
      const p = check(await call("/v1/payments/confirm", { orderId, paymentKey, amount }, `confirm:${orderId}`), orderId, amount);
      if (p.paymentKey !== paymentKey) throw new TossPaymentError("TOSS_CONTRACT_MISMATCH", 409);
      return p;
    },
    async cancel(orderId: string, paymentKey: string, amount: number, cancelAmount: number, requestId: string) {
      if (!identifier(orderId) || !identifier(paymentKey) || !identifier(requestId)
        || !Number.isSafeInteger(cancelAmount) || cancelAmount < 1 || cancelAmount > amount) throw new TossPaymentError("INVALID_CANCEL", 400);
      const p = check(await call(`/v1/payments/${encodeURIComponent(paymentKey)}/cancel`,
        { cancelReason: "고객 요청 취소", cancelAmount }, `cancel:${requestId}`), orderId, amount);
      if (p.paymentKey !== paymentKey) throw new TossPaymentError("TOSS_CONTRACT_MISMATCH", 409);
      return p;
    },
  };
}
