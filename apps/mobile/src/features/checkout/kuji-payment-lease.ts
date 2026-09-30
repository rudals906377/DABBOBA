type PendingKujiOrder = Readonly<{
  status: string;
  kujiRoomEntryId?: string | null;
  lines: ReadonlyArray<{ category: string; productId: string }>;
}>;

type KujiRoomPaymentSnapshot = Readonly<{
  productId: string;
  serverNow: string;
  viewer: Readonly<{
    entryId: string;
    state: string;
    checkoutExpiresAt: string | null;
  }>;
}>;

export class KujiPaymentLeaseMismatchError extends Error {
  constructor() {
    super("쿠지 주문과 대기실 참여 정보가 일치하지 않아요. 추가 결제를 진행하지 않았어요.");
    this.name = "KujiPaymentLeaseMismatchError";
  }
}

export class KujiPaymentLeaseExpiredError extends Error {
  readonly productId: string;

  constructor(productId: string) {
    super("쿠지 결제 대기 시간이 끝났어요. 결제창을 열지 않고 상품으로 돌아가요.");
    this.name = "KujiPaymentLeaseExpiredError";
    this.productId = productId;
  }
}

/** Check the fresh room's server clock; the atomic PG-window claim rechecks expiry. */
export function assertKujiPaymentLease(
  order: PendingKujiOrder,
  room: KujiRoomPaymentSnapshot,
): void {
  const line = order.lines[0];
  if (
    order.lines.length !== 1
    || line?.category !== "kuji"
    || !order.kujiRoomEntryId
    || line.productId !== room.productId
    || order.kujiRoomEntryId !== room.viewer.entryId
  ) {
    throw new KujiPaymentLeaseMismatchError();
  }

  const serverNowMs = Date.parse(room.serverNow);
  const deadlineMs = Date.parse(room.viewer.checkoutExpiresAt ?? "");
  if (
    order.status !== "PENDING_PAYMENT"
    || room.viewer.state !== "CHECKOUT_PENDING"
    || !Number.isFinite(serverNowMs)
    || !Number.isFinite(deadlineMs)
    || deadlineMs <= serverNowMs
  ) {
    throw new KujiPaymentLeaseExpiredError(line.productId);
  }
}
