import { randomUUID } from "expo-crypto";
import { errorMessage } from "@dabboba/api-client";
import type { components } from "@dabboba/contracts";
import { createMobileDabbobaClient as createDabbobaClient } from "@/lib/mobile-api-client";
import { ProfileApiError } from "@/features/profile/profile-api";

export type AccountNotification = components["schemas"]["AccountNotification"];
export type AccountNotificationPage = components["schemas"]["NotificationPage"];
export type AccountNotificationUnreadSummary = components["schemas"]["NotificationUnreadSummary"];
export type PushDeviceRegistration = components["schemas"]["PushDeviceRegistration"];

export async function fetchAccountNotificationPage(
  apiBaseUrl: string,
  accessToken: string,
  cursor?: string,
  limit = 20,
): Promise<AccountNotificationPage> {
  const client = authorizedClient(apiBaseUrl, accessToken);
  const result = await client.GET("/v1/account/notifications", {
    params: { query: { limit, ...(cursor ? { cursor } : {}) } },
  });
  if (!result.data) throw new ProfileApiError(result.response.status, errorMessage(result.error, "알림을 불러오지 못했어요."));
  return result.data;
}

export async function fetchAccountNotification(
  apiBaseUrl: string,
  accessToken: string,
  notificationId: string,
): Promise<AccountNotification> {
  const client = authorizedClient(apiBaseUrl, accessToken);
  const result = await client.GET("/v1/account/notifications/{notificationId}", {
    params: { path: { notificationId } },
  });
  if (!result.data) throw new Error(errorMessage(result.error, "알림 상세를 불러오지 못했어요."));
  return result.data;
}

export async function fetchAccountNotificationUnreadSummary(
  apiBaseUrl: string,
  accessToken: string,
): Promise<AccountNotificationUnreadSummary> {
  const client = authorizedClient(apiBaseUrl, accessToken);
  const result = await client.GET("/v1/account/notifications/unread-summary");
  if (!result.data) throw new Error(errorMessage(result.error, "읽지 않은 알림 수를 불러오지 못했어요."));
  return result.data;
}

export async function markAccountNotificationRead(
  apiBaseUrl: string,
  accessToken: string,
  notificationId: string,
): Promise<AccountNotification> {
  const client = authorizedClient(apiBaseUrl, accessToken);
  const result = await client.POST("/v1/account/notifications/{notificationId}/read", {
    params: {
      path: { notificationId },
      header: { "Idempotency-Key": randomUUID() },
    },
  });
  if (!result.data) throw new Error(errorMessage(result.error, "알림을 읽음 처리하지 못했어요."));
  return result.data;
}

export async function registerAccountPushDevice(
  apiBaseUrl: string,
  accessToken: string,
  input: components["schemas"]["RegisterPushDeviceInput"],
): Promise<PushDeviceRegistration> {
  const client = authorizedClient(apiBaseUrl, accessToken);
  const result = await client.POST("/v1/account/push-devices", { body: input });
  if (!result.data) throw new Error(errorMessage(result.error, "이 기기의 푸시 알림을 등록하지 못했어요."));
  return result.data;
}

export async function unregisterAccountPushDevice(
  apiBaseUrl: string,
  accessToken: string,
  installationId: string,
): Promise<void> {
  const client = authorizedClient(apiBaseUrl, accessToken);
  const result = await client.DELETE("/v1/account/push-devices/{installationId}", {
    params: { path: { installationId } },
  });
  if (!result.response.ok) {
    throw new Error(errorMessage(result.error, "이 기기의 푸시 알림을 해제하지 못했어요."));
  }
}

function authorizedClient(apiBaseUrl: string, accessToken: string) {
  return createDabbobaClient({
    baseUrl: apiBaseUrl,
    token: () => accessToken,
    requestId: randomUUID,
  });
}
