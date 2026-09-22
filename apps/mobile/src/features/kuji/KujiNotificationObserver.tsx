import * as Notifications from "expo-notifications";
import { type Href, useRouter } from "expo-router";
import { useEffect } from "react";
import {
  buildKujiRoomGatePath,
  resolveKujiTurnNotificationPath,
  type KujiTurnCall,
} from "@/features/kuji/kuji-entry-state";

export function KujiNotificationObserver() {
  const router = useRouter();

  useEffect(() => {
    const openResponse = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const data = response.notification.request.content.data;
      if (!data || data.kind !== "KUJI_TURN" || typeof data.productId !== "string") return;
      if (
        typeof data.entryId !== "string"
        || typeof data.checkoutExpiresAt !== "string"
        || typeof data.serverNow !== "string"
      ) {
        router.push(buildKujiRoomGatePath(data.productId) as Href);
        Notifications.clearLastNotificationResponse();
        return;
      }
      const call: KujiTurnCall = {
        productId: data.productId,
        entryId: data.entryId,
        title: "차례가 되었습니다",
        body: "결제 대기 시간이 시작되었어요.",
        checkoutExpiresAt: data.checkoutExpiresAt,
        serverNow: data.serverNow,
        developmentFixture: data.kujiRoomFixture === "development",
      };
      router.push(resolveKujiTurnNotificationPath(call, Date.now()) as Href);
      Notifications.clearLastNotificationResponse();
    };

    openResponse(Notifications.getLastNotificationResponse());
    const subscription = Notifications.addNotificationResponseReceivedListener(openResponse);
    return () => subscription.remove();
  }, [router]);

  return null;
}
