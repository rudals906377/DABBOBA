import { errorMessage } from "@dabboba/api-client";
import { createMobileDabbobaClient } from "@/lib/mobile-api-client";
import type { PaidDrawRecoverySource } from "@/features/profile/paid-draw-recovery-state";

export function createPaidDrawRecoverySource(
  apiBaseUrl: string,
  accessToken: string,
  signal: AbortSignal,
): PaidDrawRecoverySource {
  const client = createMobileDabbobaClient({ baseUrl: apiBaseUrl, token: () => accessToken });
  return {
    async fetchActorId() {
      const result = await client.GET("/v1/account/profile", { signal });
      if (!result.data) throw new Error(errorMessage(result.error, "로그인 계정을 확인하지 못했습니다."));
      return result.data.id;
    },
    async fetchPage(cursor) {
      const result = await client.GET("/v1/account/draw-entitlements", {
        signal,
        params: { query: { status: "AVAILABLE", limit: 50, ...(cursor ? { cursor } : {}) } },
      });
      if (!result.data) throw new Error(errorMessage(result.error, "남은 추첨권을 불러오지 못했습니다."));
      return result.data;
    },
    async fetchOrder(orderId) {
      const result = await client.GET("/v1/orders/{orderId}", {
        signal,
        params: { path: { orderId } },
      });
      if (!result.data) throw new Error(errorMessage(result.error, "주문 상태를 확인하지 못했습니다."));
      return result.data;
    },
    async fetchKujiRecovery(orderId) {
      const result = await client.GET("/v1/orders/{orderId}/draw-recovery", {
        signal,
        params: { path: { orderId } },
      });
      if (!result.data) throw new Error(errorMessage(result.error, "쿠지 뽑기방 복구 정보를 확인하지 못했습니다."));
      return result.data;
    },
  };
}
