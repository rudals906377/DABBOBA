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
import { SQLiteProvider } from "expo-sqlite";
import { StatusBar } from "expo-status-bar";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, AppState, Platform, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KujiNotificationObserver } from "@/features/kuji/KujiNotificationObserver";
import { AccountNotificationObserver } from "@/features/notifications/AccountNotificationObserver";
import { StorefrontCategorySettingsProvider } from "@/features/catalog/StorefrontCategorySettingsProvider";
import { CommerceCapabilityProvider } from "@/features/commerce/CommerceCapabilityProvider";
import { ensureInternalCustomerSession } from "@/features/demo/demo-api";
import { clearExpiredSocialLoginAttempt } from "@/features/auth/supabase-broker";
import { PolicyReconsentProvider } from "@/features/auth/PolicyReconsentProvider";
import {
  ensureCustomerSessionForUse,
  restoreCustomerSession,
} from "@/lib/customer-session";
import { initializeLocalDatabase } from "@/lib/local-database";
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
          <InternalCustomerSessionBootstrap enabled={__DEV__}>
            <CustomerSessionBootstrap>
              <CommerceCapabilityProvider>
                <StorefrontCategorySettingsProvider>
                  <AccountNotificationObserver />
                  <KujiNotificationObserver />
                  <SQLiteProvider
                    databaseName="dabboba-local.db"
                    onInit={initializeLocalDatabase}
                    useSuspense
                  >
                    <Stack screenOptions={{ headerShown: false, contentStyle: styles.stack }} />
                  </SQLiteProvider>
                </StorefrontCategorySettingsProvider>
              </CommerceCapabilityProvider>
            </CustomerSessionBootstrap>
          </InternalCustomerSessionBootstrap>
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
  const [ready, setReady] = useState(!enabled);

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
    void ensureInternalCustomerSession(runtime.apiBaseUrl, () => active)
      .catch((error: unknown) => {
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
  }, [enabled]);

  return ready ? children : <AppBootFallback />;
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
});
