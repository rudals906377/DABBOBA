import Constants from "expo-constants";
import {
  NotoSans_400Regular,
  NotoSans_500Medium,
  NotoSans_700Bold,
  NotoSans_900Black,
} from "@expo-google-fonts/noto-sans";
import {
  NotoSansKR_400Regular,
  NotoSansKR_500Medium,
  NotoSansKR_700Bold,
  NotoSansKR_900Black,
} from "@expo-google-fonts/noto-sans-kr";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { SQLiteProvider } from "expo-sqlite";
import { StatusBar } from "expo-status-bar";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KujiNotificationObserver } from "@/features/kuji/KujiNotificationObserver";
import { ensureDevelopmentAuthSession } from "@/lib/development-session";
import { initializeLocalDatabase } from "@/lib/local-database";
import {
  resolveMobileRuntimeConfig,
  type MobilePlatform,
} from "@/lib/runtime-config";
import { colors } from "@/theme";

export default function RootLayout() {
  const customerAuthSetupAttempted = Boolean(
    process.env.EXPO_PUBLIC_SUPABASE_URL?.trim()
    || process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim(),
  );
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
        <DevelopmentSessionBootstrap enabled={__DEV__ && !customerAuthSetupAttempted}>
          <>
            <KujiNotificationObserver />
            <SQLiteProvider
              databaseName="dabboba-local.db"
              onInit={initializeLocalDatabase}
              useSuspense
            >
              <Stack screenOptions={{ headerShown: false, contentStyle: styles.stack }} />
            </SQLiteProvider>
          </>
        </DevelopmentSessionBootstrap>
      </Suspense>
    </GestureHandlerRootView>
  );
}

function DevelopmentSessionBootstrap({
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
    void ensureDevelopmentAuthSession(runtime.apiBaseUrl)
      .catch((error: unknown) => {
        console.warn(
          "DABBOBA development auto sign-in failed; continuing as guest.",
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
