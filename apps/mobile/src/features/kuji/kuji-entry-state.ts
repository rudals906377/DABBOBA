export type KujiRoomAvailability = "AVAILABLE" | "OCCUPIED";

export type KujiTurnCall = {
  productId: string;
  title: "차례가 되었습니다";
  body: "뽑으러 가시겠어요? 10초 안에 입장해 주세요.";
  claimExpiresAt: string;
};

export const LOCAL_KUJI_ROOM_AVAILABILITY: KujiRoomAvailability = "AVAILABLE";
export const KUJI_ENTRY_CLAIM_SECONDS = 10;

export function resolveKujiEntryPath(productId: string, availability: KujiRoomAvailability): string {
  const encodedProductId = encodeURIComponent(productId);
  return availability === "AVAILABLE"
    ? `/kuji/draw/${encodedProductId}`
    : `/kuji/queue/${encodedProductId}`;
}

export function buildKujiTurnCall(productId: string, notifiedAtMs: number): KujiTurnCall {
  return {
    productId,
    title: "차례가 되었습니다",
    body: "뽑으러 가시겠어요? 10초 안에 입장해 주세요.",
    claimExpiresAt: new Date(notifiedAtMs + KUJI_ENTRY_CLAIM_SECONDS * 1_000).toISOString(),
  };
}

export function resolveKujiTurnNotificationPath(call: KujiTurnCall, openedAtMs: number): string {
  if (openedAtMs >= Date.parse(call.claimExpiresAt)) {
    return resolveKujiEntryPath(call.productId, "OCCUPIED");
  }
  return `${resolveKujiEntryPath(call.productId, "AVAILABLE")}?claimExpiresAt=${encodeURIComponent(call.claimExpiresAt)}`;
}
