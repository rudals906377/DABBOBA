import { randomUUID } from "expo-crypto";
import { createDabbobaClient, errorMessage } from "@dabboba/api-client";
import type { components } from "@dabboba/contracts";
import {
  clearBrokerSession,
  completeBrokerSocialLoginCallback,
} from "@/features/auth/supabase-broker";
import { socialLoginCallbackFingerprint } from "@/features/auth/social-login-state";
import { writeAuthTokens } from "@/lib/session-store";

export type AuthProviderAvailability = components["schemas"]["CustomerLoginProviders"];

export type AcceptedPolicyVersions = {
  terms: string;
  privacy: string;
};

const socialLoginCompletionFlights = new Map<string, Promise<string>>();

export async function fetchAuthProviderAvailability(apiBaseUrl: string): Promise<AuthProviderAvailability> {
  const client = createDabbobaClient({ baseUrl: apiBaseUrl, requestId: randomUUID });
  const result = await client.GET("/v1/auth/providers");
  if (!result.data) throw new Error(errorMessage(result.error, "로그인 연결 상태를 확인하지 못했습니다."));
  return result.data;
}

export async function exchangeBrokerSession(
  apiBaseUrl: string,
  accessToken: string,
  acceptedPolicies: AcceptedPolicyVersions,
  loginProvider: "KAKAO" | "NAVER" | "GOOGLE" | "APPLE" | "EMAIL",
  appleRefreshToken?: string,
): Promise<void> {
  const client = createDabbobaClient({ baseUrl: apiBaseUrl, requestId: randomUUID });
  const result = await client.POST("/v1/auth/exchange", {
    body: {
      accessToken,
      acceptedPolicies,
      loginProvider,
      ...(appleRefreshToken ? { appleRefreshToken } : {}),
    },
  });
  if (!result.data) throw new Error(errorMessage(result.error, "로그인 정보를 저장하지 못했습니다."));
  await writeAuthTokens({
    accessToken: result.data.token,
    refreshToken: result.data.token,
    expiresAt: result.data.expiresAt,
  });
}

export async function completeSocialCustomerLogin(
  apiBaseUrl: string,
  resultUrl: string,
): Promise<string> {
  const fingerprint = socialLoginCallbackFingerprint(resultUrl);
  const existing = socialLoginCompletionFlights.get(fingerprint);
  if (existing) return existing;

  const flight = (async () => {
    try {
      const completed = await completeBrokerSocialLoginCallback(resultUrl);
      await exchangeBrokerSession(
        apiBaseUrl,
        completed.accessToken,
        completed.acceptedPolicies,
        completed.provider,
        completed.appleRefreshToken,
      );
      return completed.returnTo;
    } finally {
      await clearBrokerSession();
    }
  })().finally(() => {
    if (socialLoginCompletionFlights.get(fingerprint) === flight) {
      socialLoginCompletionFlights.delete(fingerprint);
    }
  });
  socialLoginCompletionFlights.set(fingerprint, flight);
  return flight;
}
