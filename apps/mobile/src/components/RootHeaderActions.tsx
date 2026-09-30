import Constants from "expo-constants";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { DecorativeIonicon } from "@/components/DecorativeIonicon";
import { AppText as Text } from "@/components/Typography";
import { SeedIconButton } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import { fetchAccountNotificationUnreadSummary } from "@/features/notifications/notifications-api";
import { resolveMobileRuntimeConfig, type MobilePlatform } from "@/lib/runtime-config";
import { readAuthTokens } from "@/lib/session-store";

const ACTIONS: ReadonlyArray<{
  label: string;
  route: "/search" | "/notifications";
  icon: "search-outline" | "notifications-outline";
}> = [
  { label: "검색 열기", route: "/search", icon: "search-outline" },
  { label: "알림함 열기", route: "/notifications", icon: "notifications-outline" },
];

export function RootHeaderActions() {
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
  const [unreadCount, setUnreadCount] = useState(0);

  useFocusEffect(useCallback(() => {
    let active = true;
    void readAuthTokens()
      .then(async (tokens) => {
        if (!tokens) return { unreadCount: 0 };
        return fetchAccountNotificationUnreadSummary(runtime.apiBaseUrl, tokens.accessToken);
      })
      .then((summary) => {
        if (active) setUnreadCount(summary.unreadCount);
      })
      .catch((error: unknown) => {
        console.warn(
          "DABBOBA notification unread summary failed.",
          error instanceof Error ? error.message : error,
        );
      });
    return () => {
      active = false;
    };
  }, [runtime.apiBaseUrl]));

  return (
    <View style={styles.actions}>
      {ACTIONS.map((action) => (
        <SeedIconButton
          key={action.label}
          label={action.route === "/notifications" && unreadCount > 0
            ? `${action.label}, 읽지 않은 알림 ${unreadCount}개`
            : action.label}
          onPress={() => router.push(action.route as Href)}
        >
          <View style={styles.iconFrame}>
            <DecorativeIonicon name={action.icon} size={23} color={seed.color.foreground.neutral} />
            {action.route === "/notifications" && unreadCount > 0 ? (
              <Text variant="micro" style={styles.unreadBadge}>{unreadCount > 99 ? "99+" : unreadCount}</Text>
            ) : null}
          </View>
        </SeedIconButton>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", alignItems: "center" },
  iconFrame: { width: 25, height: 25, alignItems: "center", justifyContent: "center" },
  unreadBadge: {
    position: "absolute",
    top: -5,
    right: -8,
    minWidth: 15,
    minHeight: 15,
    paddingHorizontal: 4,
    overflow: "hidden",
    borderRadius: seed.radius.full,
    backgroundColor: seed.color.foreground.critical,
    color: seed.color.foreground.inverted,
    fontWeight: "700",
    textAlign: "center",
  },
});
