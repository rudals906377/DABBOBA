import { Redirect, type Href } from "expo-router";
import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { AppText as Text } from "@/components/Typography";
import { seed } from "@/design-system/seed";
import { useCommerceCapability } from "@/features/commerce/CommerceCapabilityProvider";
import { resolveCommerceRouteAccess } from "@/lib/runtime-config";

export function CommerceRouteGate({
  children,
  fallback = "/(tabs)",
}: {
  children: ReactNode;
  fallback?: Href;
}) {
  const { buildCapability, serverCapability, configReady } = useCommerceCapability();
  const access = resolveCommerceRouteAccess(buildCapability, serverCapability, configReady);
  // A LIVE deep link can arrive before the server capability has been fetched.
  // Wait for that first answer instead of redirecting a valid paid draw on cold start.
  if (access === "WAIT") {
    return (
      <View style={styles.loading} accessibilityLabel="결제 상태 확인 중">
        <ActivityIndicator color={seed.color.foreground.brand} />
        <Text style={styles.loadingText}>결제 상태를 확인하고 있어요.</Text>
      </View>
    );
  }
  if (access === "DENY") return <Redirect href={fallback} />;
  return children;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: seed.spacing.componentDefault,
    backgroundColor: seed.color.layer.default,
  },
  loadingText: {
    color: seed.color.foreground.muted,
    ...seed.typography.body,
  },
});
