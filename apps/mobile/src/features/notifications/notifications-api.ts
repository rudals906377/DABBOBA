import { randomUUID } from "expo-crypto";
import { createDabbobaClient, errorMessage } from "@dabboba/api-client";
import type { components } from "@dabboba/contracts";

export type AccountNotification = components["schemas"]["AccountNotification"];

export async function fetchAccountNotifications(
  apiBaseUrl: string,
  accessToken: string,
): Promise<AccountNotification[]> {
  const client = authorizedClient(apiBaseUrl, accessToken);
  const items: AccountNotification[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  while (true) {
    const result = await client.GET("/v1/account/notifications", {
      params: { query: { limit: 50, ...(cursor ? { cursor } : {}) } },
    });
    if (!result.data) throw new Error(errorMessage(result.error, "알림을 불러오지 못했습니다."));
    items.push(...result.data.items);
    const nextCursor = result.data.nextCursor ?? undefined;
    if (!nextCursor || seenCursors.has(nextCursor)) break;
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return items;
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
  if (!result.data) throw new Error(errorMessage(result.error, "알림을 읽음 처리하지 못했습니다."));
  return result.data;
}

function authorizedClient(apiBaseUrl: string, accessToken: string) {
  return createDabbobaClient({
    baseUrl: apiBaseUrl,
    token: () => accessToken,
    requestId: randomUUID,
  });
}
