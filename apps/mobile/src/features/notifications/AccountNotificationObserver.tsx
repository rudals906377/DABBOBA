import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { type Href, useRouter } from "expo-router";
import { useEffect, useMemo } from "react";
import { AppState, Platform } from "react-native";
import { resolveAccountNotificationResponsePath } from "@/features/notifications/notification-navigation";
import { synchronizeAccountPushDevice } from "@/features/notifications/push-device";
import { resolveMobileRuntimeConfig, type MobilePlatform } from "@/lib/runtime-config";
import { readAuthTokens, subscribeAuthTokens } from "@/lib/session-store";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Handles foreground, background, and terminated-state account notification taps. */
export function AccountNotificationObserver() {
  const router = useRouter();
  const runtime = useMemo(
    () => resolveMobileRuntimeConfig({
      configuredApiUrl: process.env.EXPO_PUBLIC_DABBOBA_API_URL,
      configuredAssetBaseUrl: process.env.EXPO_PUBLIC_DABBOBA_ASSET_BASE_URL,
      metroHostUri: Constants.expoConfig?.hostUri,
      platform: Platform.OS as MobilePlatform,
      development: __DEV__,
    }),
    [],
  );

  useEffect(() => {
    const openResponse = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const path = resolveAccountNotificationResponsePath(response.notification.request.content.data);
      if (!path) return;
      router.push(path as Href);
      Notifications.clearLastNotificationResponse();
    };

    openResponse(Notifications.getLastNotificationResponse());
    const subscription = Notifications.addNotificationResponseReceivedListener(openResponse);
    return () => subscription.remove();
  }, [router]);

  useEffect(() => {
    let active = true;
    let syncFlight: Promise<void> | null = null;
    const sync = () => {
      if (!active || syncFlight) return;
      syncFlight = readAuthTokens()
        .then(async (tokens) => {
          if (!tokens || !active) return;
          await synchronizeAccountPushDevice(runtime.apiBaseUrl, tokens.accessToken);
        })
        .catch(() => undefined)
        .finally(() => {
          syncFlight = null;
        });
    };

    sync();
    const unsubscribeSession = subscribeAuthTokens(sync);
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") sync();
    });
    const pushToken = Notifications.addPushTokenListener(() => sync());
    return () => {
      active = false;
      unsubscribeSession();
      appState.remove();
      pushToken.remove();
    };
  }, [runtime.apiBaseUrl]);

  return null;
}
