type PaymentAttemptOrder = {
  id: string;
  paymentId: string;
  userId: string;
};

export type PaymentAttemptStorage = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

const PAYMENT_ATTEMPT_KEY_PREFIX = "dabboba.payment-attempt.v1.";
export type PaymentAttemptState = "none" | "preparing" | "started";

export class PaymentAttemptMismatchError extends Error {
  constructor() {
    super("이전 결제 시도 정보가 현재 주문과 일치하지 않아요.");
    this.name = "PaymentAttemptMismatchError";
  }
}

function attemptKey(order: PaymentAttemptOrder): string {
  return `${PAYMENT_ATTEMPT_KEY_PREFIX}${order.id}`;
}

/** Legacy v1 values mean started; v2 separates a pre-claim intent from a PG window. */
export async function paymentAttemptState(
  storage: PaymentAttemptStorage,
  order: PaymentAttemptOrder,
): Promise<PaymentAttemptState> {
  const raw = await storage.getItemAsync(attemptKey(order));
  if (raw === null) return "none";
  let saved: unknown;
  try {
    saved = JSON.parse(raw);
  } catch {
    throw new PaymentAttemptMismatchError();
  }
  if (
    !saved || typeof saved !== "object"
    || !("version" in saved) || (saved.version !== 1 && saved.version !== 2)
    || !("orderId" in saved) || saved.orderId !== order.id
    || !("paymentId" in saved) || saved.paymentId !== order.paymentId
    || !("userId" in saved) || saved.userId !== order.userId
  ) throw new PaymentAttemptMismatchError();
  if (saved.version === 1) return "started";
  if (!("phase" in saved) || (saved.phase !== "PREPARING" && saved.phase !== "STARTED")) {
    throw new PaymentAttemptMismatchError();
  }
  return saved.phase === "STARTED" ? "started" : "preparing";
}

/** A durable marker prevents a killed app from silently opening a second PG session. */
export async function hasStartedPaymentAttempt(
  storage: PaymentAttemptStorage,
  order: PaymentAttemptOrder,
): Promise<boolean> {
  return (await paymentAttemptState(storage, order)) === "started";
}

export async function preparePaymentAttempt(
  storage: PaymentAttemptStorage,
  order: PaymentAttemptOrder,
): Promise<void> {
  if ((await paymentAttemptState(storage, order)) !== "none") return;
  await storage.setItemAsync(attemptKey(order), JSON.stringify({
    version: 2,
    phase: "PREPARING",
    orderId: order.id,
    paymentId: order.paymentId,
    userId: order.userId,
  }));
}

export async function markPaymentAttemptStarted(
  storage: PaymentAttemptStorage,
  order: PaymentAttemptOrder,
): Promise<void> {
  if (await hasStartedPaymentAttempt(storage, order)) return;
  await storage.setItemAsync(attemptKey(order), JSON.stringify({
    version: 2,
    phase: "STARTED",
    orderId: order.id,
    paymentId: order.paymentId,
    userId: order.userId,
  }));
}

export async function clearPaymentAttempt(
  storage: PaymentAttemptStorage,
  order: PaymentAttemptOrder,
): Promise<void> {
  if ((await paymentAttemptState(storage, order)) !== "none") {
    await storage.deleteItemAsync(attemptKey(order));
  }
}
