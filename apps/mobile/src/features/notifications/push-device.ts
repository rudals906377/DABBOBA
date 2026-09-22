import Constants from "expo-constants";
import { randomUUID } from "expo-crypto";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import {
  registerAccountPushDevice,
  unregisterAccountPushDevice,
} from "@/features/notifications/notifications-api";

const PUSH_INSTALLATION_ID_KEY = "dabboba.push.installation-id.v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPO_PUSH_TOKEN = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{8,220}\]$/;

export type PushDeviceSyncResult =
  | { status: "registered" }
  | { status: "denied" }
  | { status: "unconfigured" }
  | { status: "unavailable" }
  | { status: "unsupported" };

export async function readPushPermissionGranted(): Promise<boolean> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return false;
  try {
    return (await Notifications.getPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

export async function synchronizeAccountPushDevice(
  apiBaseUrl: string,
  accessToken: string,
  options: { requestPermission?: boolean } = {},
): Promise<PushDeviceSyncResult> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return { status: "unsupported" };
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("account", {
      name: "계정 활동",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 180, 100, 180],
      lightColor: "#91E98E",
    });
  }

  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && options.requestPermission) {
    permission = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
  }
  if (!permission.granted) {
    const installationId = await readPushInstallationId();
    if (installationId) await unregisterAccountPushDevice(apiBaseUrl, accessToken, installationId);
    return { status: "denied" };
  }

  const projectId = resolveExpoProjectId();
  if (!projectId) return { status: "unconfigured" };

  let expoPushToken: string;
  try {
    expoPushToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch {
    return { status: "unavailable" };
  }
  if (!EXPO_PUSH_TOKEN.test(expoPushToken)) return { status: "unavailable" };

  const installationId = await getOrCreatePushInstallationId();
  await registerAccountPushDevice(apiBaseUrl, accessToken, {
    installationId,
    expoPushToken,
    platform: Platform.OS === "ios" ? "IOS" : "ANDROID",
    appVersion: Constants.expoConfig?.version ?? null,
  });
  return { status: "registered" };
}

export async function unregisterCurrentAccountPushDevice(
  apiBaseUrl: string,
  accessToken: string,
): Promise<void> {
  const installationId = await readPushInstallationId();
  if (!installationId) return;
  await unregisterAccountPushDevice(apiBaseUrl, accessToken, installationId);
}

export function resolveExpoProjectId(): string | null {
  const configured = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
  if (configured) return UUID.test(configured) ? configured : null;
  const easProjectId = Constants.easConfig?.projectId?.trim();
  return easProjectId && UUID.test(easProjectId) ? easProjectId : null;
}

async function readPushInstallationId(): Promise<string | null> {
  const value = await SecureStore.getItemAsync(PUSH_INSTALLATION_ID_KEY);
  return value && UUID.test(value) ? value : null;
}

async function getOrCreatePushInstallationId(): Promise<string> {
  const existing = await readPushInstallationId();
  if (existing) return existing;
  const installationId = randomUUID();
  await SecureStore.setItemAsync(PUSH_INSTALLATION_ID_KEY, installationId);
  return installationId;
}
