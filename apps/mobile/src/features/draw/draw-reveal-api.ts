import { randomUUID } from "expo-crypto";
import { errorMessage } from "@dabboba/api-client";
import type { components } from "@dabboba/contracts";
import { createMobileDabbobaClient as createDabbobaClient } from "@/lib/mobile-api-client";

export type DrawResult = components["schemas"]["DrawResult"];
const DRAW_CONSUME_TIMEOUT_MS = 15_000;

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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DRAW_CONSUME_TIMEOUT_MS);
  try {
    const result = await client.POST("/v1/draws/{entitlementId}/consume", {
      params: {
        path: { entitlementId },
        header: { "Idempotency-Key": drawRevealIdempotencyKey(entitlementId) },
      },
      signal: controller.signal,
    });
    if (controller.signal.aborted) {
      throw new Error("결과 확인이 지연되고 있어요. 다시 시도하면 확정된 결과를 다시 확인할 수 있어요.");
    }
    if (!result.data) {
      throw new Error(errorMessage(result.error, "상품 결과를 확인하지 못했습니다."));
    }
    return result.data;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("결과 확인이 지연되고 있어요. 다시 시도하면 확정된 결과를 다시 확인할 수 있어요.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function drawRevealIdempotencyKey(entitlementId: string): string {
  return `draw-reveal-${entitlementId}`;
}
