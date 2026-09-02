import { randomUUID } from "expo-crypto";
import { errorMessage } from "@dabboba/api-client";
import type { components } from "@dabboba/contracts";
import { createMobileDabbobaClient as createDabbobaClient } from "@/lib/mobile-api-client";

export type DrawResult = components["schemas"]["DrawResult"];

export async function consumeDrawEntitlement(
  apiBaseUrl: string,
  accessToken: string,
  entitlementId: string,
): Promise<DrawResult> {
  const client = createDabbobaClient({
    baseUrl: apiBaseUrl,
    token: () => accessToken,
    requestId: randomUUID,
  });
  const result = await client.POST("/v1/draws/{entitlementId}/consume", {
    params: {
      path: { entitlementId },
      header: { "Idempotency-Key": drawRevealIdempotencyKey(entitlementId) },
    },
  });
  if (!result.data) {
    throw new Error(errorMessage(result.error, "상품 결과를 확인하지 못했습니다."));
  }
  return result.data;
}

export function drawRevealIdempotencyKey(entitlementId: string): string {
  return `draw-reveal-${entitlementId}`;
}
