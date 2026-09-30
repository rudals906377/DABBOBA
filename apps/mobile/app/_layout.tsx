import Constants from "expo-constants";
import { NotoSans_400Regular } from "@expo-google-fonts/noto-sans/400Regular";
import { NotoSans_500Medium } from "@expo-google-fonts/noto-sans/500Medium";
import { NotoSans_700Bold } from "@expo-google-fonts/noto-sans/700Bold";
import { NotoSans_900Black } from "@expo-google-fonts/noto-sans/900Black";
import { NotoSansKR_400Regular } from "@expo-google-fonts/noto-sans-kr/400Regular";
import { NotoSansKR_500Medium } from "@expo-google-fonts/noto-sans-kr/500Medium";
import { NotoSansKR_700Bold } from "@expo-google-fonts/noto-sans-kr/700Bold";
import { NotoSansKR_900Black } from "@expo-google-fonts/noto-sans-kr/900Black";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { SQLiteProvider, useSQLiteContext } from "expo-sqlite";
import { StatusBar } from "expo-status-bar";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, AppState, Platform, Pressable, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AppText as Text } from "@/components/Typography";
import { KujiNotificationObserver } from "@/features/kuji/KujiNotificationObserver";
import { AccountNotificationObserver } from "@/features/notifications/AccountNotificationObserver";
import { StorefrontCategorySettingsProvider } from "@/features/catalog/StorefrontCategorySettingsProvider";
import { CommerceCapabilityProvider } from "@/features/commerce/CommerceCapabilityProvider";
import { ensureInternalCustomerSession, InternalCustomerDataCleanupError } from "@/features/demo/demo-api";
import { clearExpiredSocialLoginAttempt } from "@/features/auth/supabase-broker";
import { PolicyReconsentProvider } from "@/features/auth/PolicyReconsentProvider";
import {
  ensureCustomerSessionForUse,
  restoreCustomerSession,
} from "@/lib/customer-session";
import { clearUserScopedLocalData, initializeLocalDatabase } from "@/lib/local-database";
import {
  resolveMobileRuntimeConfig,
  type MobilePlatform,
} from "@/lib/runtime-config";
import { colors } from "@/theme";

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Galmuri11: require("galmuri/dist/Galmuri11-Bold.ttf"),
    Galmuri11Readable: require("galmuri/dist/Galmuri11.ttf"),
    DabbobaKoreanPixelBold: require("galmuri/dist/Galmuri11-Bold.ttf"),
    NotoSans_400Regular,
    NotoSans_500Medium,
    NotoSans_700Bold,
    NotoSans_900Black,
    NotoSansKR_400Regular,
    NotoSansKR_500Medium,
    NotoSansKR_700Bold,
    NotoSansKR_900Black,
  });

  if (fontError) throw fontError;
  if (!fontsLoaded) return <AppBootFallback />;

  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
      <StatusBar style="dark" />
      <Suspense fallback={<AppBootFallback />}>
        <PolicyReconsentProvider>
          <SQLiteProvider
            databaseName="dabboba-local.db"
            onInit={initializeLocalDatabase}
            useSuspense
          >
            <InternalCustomerSessionBootstrap enabled={__DEV__}>
              <CustomerSessionBootstrap>
                <CommerceCapabilityProvider>
                  <StorefrontCategorySettingsProvider>
                    <AccountNotificationObserver />
                    <KujiNotificationObserver />
                    <Stack screenOptions={{ headerShown: false, contentStyle: styles.stack }} />
                  </StorefrontCategorySettingsProvider>
                </CommerceCapabilityProvider>
              </CustomerSessionBootstrap>
            </InternalCustomerSessionBootstrap>
          </SQLiteProvider>
        </PolicyReconsentProvider>
      </Suspense>
    </GestureHandlerRootView>
  );
}

function CustomerSessionBootstrap({ children }: { children: ReactNode }) {
  useEffect(() => {
    const runtime = resolveMobileRuntimeConfig({
      configuredApiUrl: process.env.EXPO_PUBLIC_DABBOBA_API_URL,
      configuredAssetBaseUrl: process.env.EXPO_PUBLIC_DABBOBA_ASSET_BASE_URL,
      metroHostUri: Constants.expoConfig?.hostUri,
      platform: Platform.OS as MobilePlatform,
      development: __DEV__,
    });
    const restore = async () => {
      await clearExpiredSocialLoginAttempt();
      return restoreCustomerSession(runtime.apiBaseUrl);
    };
    void restore()
      .catch((error: unknown) => {
        console.warn(
          "DABBOBA customer session validation failed; preserving retryable state.",
          error instanceof Error ? error.message : error,
        );
      });

    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void ensureCustomerSessionForUse(runtime.apiBaseUrl).catch((error: unknown) => {
        console.warn(
          "DABBOBA foreground session validation failed.",
          error instanceof Error ? error.message : error,
        );
      });
    });
    return () => {
      subscription.remove();
    };
  }, []);

  // DABBOBA is guest-first. Session validation runs in the background so a
  // stored token plus an offline network never blocks public cold start.
  return children;
}

function InternalCustomerSessionBootstrap({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const db = useSQLiteContext();
  const [ready, setReady] = useState(!enabled);
  const [cleanupBlocked, setCleanupBlocked] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let active = true;
    if (!enabled) {
      setReady(true);
      return () => {
        active = false;
      };
    }

    const runtime = resolveMobileRuntimeConfig({
      configuredApiUrl: process.env.EXPO_PUBLIC_DABBOBA_API_URL,
      configuredAssetBaseUrl: process.env.EXPO_PUBLIC_DABBOBA_ASSET_BASE_URL,
      metroHostUri: Constants.expoConfig?.hostUri,
      platform: Platform.OS as MobilePlatform,
      development: true,
    });
    void ensureInternalCustomerSession(runtime.apiBaseUrl, () => clearUserScopedLocalData(db), () => active)
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof InternalCustomerDataCleanupError) {
          setCleanupBlocked(true);
          return;
        }
        console.warn(
          "DABBOBA customer session restore failed; continuing to sign-in.",
          error instanceof Error ? error.message : error,
        );
      })
      .finally(() => {
        if (active) setReady(true);
      });

    return () => {
      active = false;
    };
  }, [db, enabled, retryCount]);

  if (!ready) return <AppBootFallback />;
  if (cleanupBlocked) {
    return (
      <View style={styles.cleanupBlocked}>
        <Text style={styles.cleanupTitle}>계정 데이터를 정리하지 못했어요</Text>
        <Text style={styles.cleanupDescription}>이전 계정 정보가 보이지 않도록 앱을 잠시 멈췄어요.</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setReady(false);
            setCleanupBlocked(false);
            setRetryCount((count) => count + 1);
          }}
          style={styles.cleanupRetry}
        >
          <Text style={styles.cleanupRetryText}>다시 시도</Text>
        </Pressable>
      </View>
    );
  }
  return children;
}

function AppBootFallback() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.ink} />
    </View>
  );
}

const styles = StyleSheet.create({
  gestureRoot: { flex: 1 },
  stack: { backgroundColor: colors.canvas },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.canvas,
  },
  cleanupBlocked: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 24,
    backgroundColor: colors.canvas,
  },
  cleanupTitle: { color: colors.ink, fontSize: 20, fontWeight: "700", textAlign: "center" },
  cleanupDescription: { color: colors.ink, fontSize: 14, textAlign: "center" },
  cleanupRetry: { minHeight: 44, justifyContent: "center", paddingHorizontal: 20 },
  cleanupRetryText: { color: colors.ink, fontSize: 16, fontWeight: "700" },
});
