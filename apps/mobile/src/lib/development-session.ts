import { randomUUID } from "expo-crypto";
import { createDabbobaClient, errorMessage } from "@dabboba/api-client";
import {
  clearAuthTokens,
  readAuthTokens,
  type StoredAuthTokens,
  writeAuthTokens,
} from "@/lib/session-store";

const DEVELOPMENT_EMAIL = "app@dabboba.local";

export async function ensureDevelopmentAuthSession(
  apiBaseUrl: string,
): Promise<StoredAuthTokens> {
  const stored = await readAuthTokens();
  if (stored) {
    const validity = await checkStoredSession(apiBaseUrl, stored.accessToken);
    if (validity !== "invalid") return stored;
    await clearAuthTokens();
  }

  const client = createDabbobaClient({
    baseUrl: apiBaseUrl,
    requestId: randomUUID,
  });
  const result = await client.POST("/v1/auth/dev-session", {
    body: { email: DEVELOPMENT_EMAIL },
  });
  if (!result.data) {
    throw new Error(errorMessage(result.error, "로그인 정보를 확인하지 못했습니다."));
  }

  // The local development endpoint issues one bearer token. Keep the second
  // SecureStore slot populated so the production access/refresh pair contract
  // remains unchanged while the native test app can restore this session.
  const tokens: StoredAuthTokens = {
    accessToken: result.data.token,
    refreshToken: result.data.token,
  };
  await writeAuthTokens(tokens);
  return tokens;
}

async function checkStoredSession(
  apiBaseUrl: string,
  accessToken: string,
): Promise<"valid" | "invalid" | "unreachable"> {
  const client = createDabbobaClient({
    baseUrl: apiBaseUrl,
    requestId: randomUUID,
    token: () => accessToken,
  });

  try {
    const result = await client.GET("/v1/auth/me");
    if (result.data) return "valid";
    return result.response.status === 401 ? "invalid" : "unreachable";
  } catch {
    // Keep the stored session during a temporary local API outage. It will be
    // checked again the next time the development app starts.
    return "unreachable";
  }
}
