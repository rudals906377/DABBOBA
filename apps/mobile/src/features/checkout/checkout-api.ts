import { randomUUID } from "expo-crypto";
import { createDabbobaClient, errorMessage } from "@dabboba/api-client";

export async function fetchCheckoutPointBalance(
  apiBaseUrl: string,
  accessToken: string,
): Promise<number> {
  const client = createDabbobaClient({
    baseUrl: apiBaseUrl,
    token: () => accessToken,
    requestId: randomUUID,
  });
  const result = await client.GET("/v1/account/points", {
    params: { query: { limit: 1 } },
  });
  if (!result.data) {
    throw new Error(errorMessage(result.error, "포인트 정보를 불러오지 못했습니다."));
  }
  return Math.max(0, result.data.balance);
}
