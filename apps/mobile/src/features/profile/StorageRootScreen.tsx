import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DecorativeIonicon } from "@/components/DecorativeIonicon";
import { RootCategoryTitle } from "@/components/RootCategoryTitle";
import { RootPageHeader } from "@/components/RootPageHeader";
import {
  ROOT_NAVIGATION_CONTENT_INSET,
  useRootNavigationScroll,
} from "@/components/RootFloatingTabBar";
import { AppText as Text } from "@/components/Typography";
import { seed } from "@/design-system/seed";
import { useCommerceCapability } from "@/features/commerce/CommerceCapabilityProvider";
import { ProfileSessionGate, isProfileSessionBlocked } from "@/features/profile/ProfileSessionGate";
import { StorageHubContent } from "@/features/profile/ProfileSectionScreen";
import { useProfileSnapshot } from "@/features/profile/use-profile-snapshot";
import { colors } from "@/theme";

export function StorageRootScreen() {
  const rootNavigationScroll = useRootNavigationScroll();
  const { commerceEnabled } = useCommerceCapability();
  const profileState = useProfileSnapshot("storage");
  const hasFocusedOnce = useRef(false);
  const assetBaseUrl = profileState.runtime.assetBaseUrl
    ?? (__DEV__ ? profileState.runtime.apiBaseUrl.replace(/:8788$/, ":4174") : null);

  useFocusEffect(
    useCallback(() => {
      if (hasFocusedOnce.current) void profileState.reload();
      else hasFocusedOnce.current = true;
    }, [profileState.reload]),
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <RootPageHeader>
        <RootCategoryTitle>보관함</RootCategoryTitle>
      </RootPageHeader>

      {commerceEnabled ? <Pressable
        accessibilityRole="button"
        accessibilityLabel="교환방 열기"
        accessibilityHint="보관 상품을 서로 교환해요."
        onPress={() => router.push("/exchange")}
        style={({ pressed }) => [styles.exchangeEntry, pressed && styles.pressed]}
      >
        <View style={styles.exchangeEntryIcon}>
          <DecorativeIonicon name="swap-horizontal-outline" size={23} color={colors.greenInk} />
        </View>
        <View style={styles.exchangeEntryText}>
          <Text maxFontSizeMultiplier={2} style={styles.exchangeEntryTitle}>교환방</Text>
          <Text maxFontSizeMultiplier={2} style={styles.exchangeEntryCaption}>
            보관 상품을 서로 교환해요.
          </Text>
        </View>
        <DecorativeIonicon name="chevron-forward" size={21} color={colors.muted} />
      </Pressable> : null}

      <View style={styles.body}>
        {profileState.status === "loading" ? (
          <View style={styles.state}>
            <ActivityIndicator color={colors.ink} />
            <Text style={styles.stateBody}>보관함을 불러오는 중</Text>
          </View>
        ) : null}

        {profileState.status === "error" ? (
          <View style={styles.errorBox}>
            <DecorativeIonicon name="alert-circle-outline" size={30} color={colors.muted} />
            <Text style={styles.errorText}>{profileState.message}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="보관함 다시 불러오기"
              onPress={profileState.reload}
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
            >
              <Text style={styles.retryLabel}>다시 불러오기</Text>
            </Pressable>
          </View>
        ) : null}

        {isProfileSessionBlocked(profileState.status) ? (
          <ProfileSessionGate
            status={profileState.status}
            returnTo="/(tabs)/storage"
            guestBody="로그인하면 보관 중인 상품과 배송·환급 내역을 확인할 수 있어요."
          />
        ) : null}

        {profileState.status === "authenticated" && profileState.snapshot ? (
          <StorageHubContent profileState={profileState} assetBaseUrl={assetBaseUrl} rootLayout rootScrollProps={rootNavigationScroll} />
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  exchangeEntry: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: seed.spacing.x2_5,
    paddingHorizontal: seed.spacing.globalGutter,
    paddingVertical: seed.spacing.x1_5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: seed.color.stroke.neutral,
    backgroundColor: seed.color.layer.default,
  },
  exchangeEntryIcon: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: seed.radius.r3,
    backgroundColor: seed.color.background.brandWeak,
  },
  exchangeEntryText: { flex: 1, minWidth: 0 },
  exchangeEntryTitle: { color: colors.ink, ...seed.typography.bodyStrong },
  exchangeEntryCaption: {
    marginTop: seed.spacing.x1,
    color: colors.muted,
    ...seed.typography.caption,
  },
  body: { flex: 1, paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x3, paddingBottom: ROOT_NAVIGATION_CONTENT_INSET },
  state: { minHeight: 420, alignItems: "center", justifyContent: "center", gap: seed.spacing.x3 },
  stateBody: { color: colors.muted, fontSize: 13 },
  errorBox: {
    minHeight: 260,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: seed.radius.r4,
    padding: seed.spacing.x5,
    backgroundColor: seed.color.background.criticalWeak,
  },
  errorText: { color: colors.ink, fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: seed.spacing.x2 },
  retryButton: { minHeight: seed.size.touchTarget, justifyContent: "center", marginTop: seed.spacing.x3, paddingHorizontal: seed.spacing.x4, borderRadius: seed.radius.r3, backgroundColor: colors.ink },
  retryLabel: { color: colors.white, fontSize: 13, fontWeight: "800" },
  pressed: { opacity: seed.state.pressedOpacity, transform: [{ scale: seed.state.pressedScale }] },
});
