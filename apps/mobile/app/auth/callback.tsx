import Constants from "expo-constants";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppText as Text } from "@/components/Typography";
import { SeedActionButton } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import { completeSocialCustomerLogin } from "@/features/auth/auth-api";
import { buildSocialLoginCallbackUrl } from "@/features/auth/social-login-state";
import {
  resolveMobileRuntimeConfig,
  type MobilePlatform,
} from "@/lib/runtime-config";
import { colors } from "@/theme";

export default function CustomerAuthCallbackRoute() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
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
  const callbackUrl = useMemo(
    () => buildSocialLoginCallbackUrl(params),
    [params],
  );
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void completeSocialCustomerLogin(runtime.apiBaseUrl, callbackUrl)
      .then((returnTo) => {
        if (active) router.replace(returnTo as Href);
      })
      .catch((error: unknown) => {
        if (active) {
          setMessage(error instanceof Error ? error.message : "로그인을 완료하지 못했습니다.");
        }
      });
    return () => {
      active = false;
    };
  }, [callbackUrl, runtime.apiBaseUrl]);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "right", "bottom", "left"]}>
      <View style={styles.content}>
        {message ? (
          <>
            <Text style={styles.title}>로그인을 완료하지 못했어요</Text>
            <Text style={styles.message}>{message}</Text>
            <SeedActionButton
              label="로그인 화면으로"
              onPress={() => router.replace({
                pathname: "/auth/login",
                params: { returnTo: "/(tabs)/profile" },
              } as Href)}
              style={styles.button}
            />
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.greenInk} />
            <Text style={styles.message}>로그인을 안전하게 확인하고 있어요.</Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: seed.spacing.x5,
  },
  title: { color: colors.ink, ...seed.typography.sectionTitle, textAlign: "center" },
  message: {
    marginTop: seed.spacing.x3,
    color: colors.muted,
    ...seed.typography.body,
    textAlign: "center",
  },
  button: { alignSelf: "stretch", marginTop: seed.spacing.x5 },
});
