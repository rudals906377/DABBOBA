import * as Notifications from "expo-notifications";
import { type Href, useRouter } from "expo-router";
import { useEffect } from "react";
import {
  resolveKujiTurnNotificationPath,
  type KujiTurnCall,
} from "@/features/kuji/kuji-entry-state";

export function KujiNotificationObserver() {
  const router = useRouter();

  useEffect(() => {
    const openResponse = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const data = response.notification.request.content.data;
      if (data.kind !== "KUJI_TURN" || typeof data.productId !== "string" || typeof data.claimExpiresAt !== "string") return;
      const call: KujiTurnCall = {
        productId: data.productId,
        title: "차례가 되었습니다",
        body: "뽑으러 가시겠어요? 10초 안에 입장해 주세요.",
        claimExpiresAt: data.claimExpiresAt,
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
