import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { buildKujiTurnCall } from "@/features/kuji/kuji-entry-state";

const KUJI_NOTIFICATION_CHANNEL = "kuji-turn";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function scheduleKujiTurnExampleNotification(
  productId: string,
  delaySeconds = 5,
): Promise<string> {
  const permission = await ensureNotificationPermission();
  if (!permission) throw new Error("알림 권한을 허용해야 다른 화면에서도 쿠지 차례를 받을 수 있어요.");

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(KUJI_NOTIFICATION_CHANNEL, {
      name: "쿠지 차례 알림",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 180, 100, 180],
      lightColor: "#91E98E",
    });
  }

  const call = buildKujiTurnCall(productId, Date.now() + delaySeconds * 1_000);
  return Notifications.scheduleNotificationAsync({
    content: {
      title: call.title,
      body: call.body,
      sound: true,
      data: {
        kind: "KUJI_TURN",
        productId: call.productId,
        claimExpiresAt: call.claimExpiresAt,
      },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: delaySeconds,
      repeats: false,
      ...(Platform.OS === "android" ? { channelId: KUJI_NOTIFICATION_CHANNEL } : {}),
    },
  });
}

async function ensureNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}
