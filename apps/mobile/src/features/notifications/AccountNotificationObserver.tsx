import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { type Href, useRouter } from "expo-router";
import { useEffect, useMemo } from "react";
import { AppState, Platform } from "react-native";
import { ensureForegroundNotificationHandler } from "@/features/notifications/notification-handler";
import { installNotificationResponseDispatcher } from "@/features/notifications/notification-response";
import { synchronizeAccountPushDevice } from "@/features/notifications/push-device";
import { resolveMobileRuntimeConfig, type MobilePlatform } from "@/lib/runtime-config";
import { readAuthTokens, subscribeAuthTokens } from "@/lib/session-store";

ensureForegroundNotificationHandler();

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

  // Account and kuji taps share one kind-based dispatcher, so the launch
  // response is handled once whichever observer mounts first.
  useEffect(
    () => installNotificationResponseDispatcher((path) => router.push(path as Href)),
    [router],
  );

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
