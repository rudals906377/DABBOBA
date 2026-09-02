import { randomUUID } from "expo-crypto";
import { createDabbobaClient, errorMessage } from "@dabboba/api-client";
import type { components } from "@dabboba/contracts";
import { writeAuthTokens } from "@/lib/session-store";

export type AuthProviderAvailability = components["schemas"]["CustomerLoginProviders"];

export async function fetchAuthProviderAvailability(apiBaseUrl: string): Promise<AuthProviderAvailability> {
  const client = createDabbobaClient({ baseUrl: apiBaseUrl, requestId: randomUUID });
  const result = await client.GET("/v1/auth/providers");
  if (!result.data) throw new Error(errorMessage(result.error, "로그인 연결 상태를 확인하지 못했습니다."));
  return result.data;
}

export async function exchangeBrokerSession(apiBaseUrl: string, accessToken: string): Promise<void> {
  const client = createDabbobaClient({ baseUrl: apiBaseUrl, requestId: randomUUID });
  const result = await client.POST("/v1/auth/exchange", {
    body: { accessToken },
  });
  if (!result.data) throw new Error(errorMessage(result.error, "로그인 정보를 저장하지 못했습니다."));
  await writeAuthTokens({
    accessToken: result.data.token,
    refreshToken: result.data.token,
  });
}
