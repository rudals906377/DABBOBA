export type KujiTurnCall = {
  productId: string;
  entryId: string;
  title: "차례가 되었습니다";
  body: "결제 대기 시간이 시작되었어요.";
  checkoutExpiresAt: string;
  serverNow: string;
  developmentFixture?: boolean;
};

export function buildKujiRoomGatePath(productId: string): string {
  return `/kuji/queue/${encodeURIComponent(productId)}`;
}

export function buildKujiCheckoutPath(
  productId: string,
  entryId: string,
  checkoutExpiresAt: string,
  serverNow?: string,
  developmentFixture = false,
): string {
  const query = [
    `kujiEntryId=${encodeURIComponent(entryId)}`,
    `kujiCheckoutExpiresAt=${encodeURIComponent(checkoutExpiresAt)}`,
    ...(serverNow ? [`serverNow=${encodeURIComponent(serverNow)}`] : []),
    ...(developmentFixture ? ["kujiRoomFixture=development"] : []),
  ].join("&");
  return `/checkout/${encodeURIComponent(productId)}?${query}`;
}

export function buildKujiTurnCall(
  productId: string,
  entryId: string,
  checkoutExpiresAt: string,
  serverNow: string,
  developmentFixture = false,
): KujiTurnCall {
  return {
    productId,
    entryId,
    title: "차례가 되었습니다",
    body: "결제 대기 시간이 시작되었어요.",
    checkoutExpiresAt,
    serverNow,
    ...(developmentFixture ? { developmentFixture: true } : {}),
  };
}

export function resolveKujiTurnNotificationPath(call: KujiTurnCall, _openedAtMs: number): string {
  return buildKujiRoomGatePath(call.productId);
}
