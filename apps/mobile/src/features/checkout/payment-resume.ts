type OwnedPaymentOrder = {
  id: string;
  paymentId: string;
  userId: string;
  status: string;
};

export class PaymentResumeIdentityMismatchError extends Error {
  constructor() {
    super("결제 주문 정보가 변경됐어요.");
    this.name = "PaymentResumeIdentityMismatchError";
  }
}

function assertSamePayment(original: OwnedPaymentOrder, current: OwnedPaymentOrder): void {
  if (
    current.id !== original.id
    || current.paymentId !== original.paymentId
    || current.userId !== original.userId
  ) {
    throw new PaymentResumeIdentityMismatchError();
  }
}

/** Re-query the provider only for the same user's still-pending order. Never infer a paid result. */
export async function reconcileOwnedPaymentOnResume<T extends OwnedPaymentOrder>(
  original: T,
  readOrder: () => Promise<T>,
  confirmPayment: (paymentId: string) => Promise<{ orderId: string; paymentId: string }>,
): Promise<T> {
  const current = await readOrder();
  assertSamePayment(original, current);
  if (current.status !== "PENDING_PAYMENT") return current;

  const confirmation = await confirmPayment(original.paymentId);
  if (confirmation.orderId !== original.id || confirmation.paymentId !== original.paymentId) {
    throw new PaymentResumeIdentityMismatchError();
  }

  const verified = await readOrder();
  assertSamePayment(original, verified);
  return verified;
}
