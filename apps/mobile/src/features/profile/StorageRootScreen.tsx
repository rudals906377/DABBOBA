import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { RootCategoryTitle } from "@/components/RootCategoryTitle";
import { RootHeaderActions } from "@/components/RootHeaderActions";
import {
  ROOT_NAVIGATION_CONTENT_INSET,
  useRootNavigationScroll,
} from "@/components/RootFloatingTabBar";
import { AppText as Text } from "@/components/Typography";
import { seed } from "@/design-system/seed";
import { StorageHubContent } from "@/features/profile/ProfileSectionScreen";
import { useProfileSnapshot } from "@/features/profile/use-profile-snapshot";
import { colors } from "@/theme";

export function StorageRootScreen() {
  const rootNavigationScroll = useRootNavigationScroll();
  const profileState = useProfileSnapshot();
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
      <ScrollView
        {...rootNavigationScroll}
        contentContainerStyle={styles.content}
        refreshControl={(
          <RefreshControl
            refreshing={profileState.refreshing}
            onRefresh={profileState.reload}
            tintColor={colors.ink}
          />
        )}
      >
        <View style={styles.header}>
          <RootCategoryTitle>보관함</RootCategoryTitle>
          <RootHeaderActions />
        </View>

        <View style={styles.body}>
          {!profileState.snapshot && !profileState.message ? (
            <View style={styles.state}>
              <ActivityIndicator color={colors.ink} />
              <Text style={styles.stateBody}>보관함을 불러오는 중</Text>
            </View>
          ) : null}

          {profileState.message ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle-outline" size={30} color={colors.muted} />
              <Text style={styles.errorText}>{profileState.message}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={profileState.reload}
                style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
              >
                <Text style={styles.retryLabel}>다시 불러오기</Text>
              </Pressable>
            </View>
          ) : null}

          {profileState.snapshot?.isExample ? (
            <View style={styles.exampleBanner}>
              <View style={styles.exampleDot} />
              <Text style={styles.exampleText}>로그인 전에는 보관함과 신청 과정을 확인할 수 있는 화면 예시가 표시돼요.</Text>
            </View>
          ) : null}

          {profileState.snapshot ? (
            <StorageHubContent profileState={profileState} assetBaseUrl={assetBaseUrl} />
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  content: { paddingBottom: ROOT_NAVIGATION_CONTENT_INSET },
  header: {
    minHeight: seed.size.topNavigation,
    paddingHorizontal: seed.spacing.globalGutter,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: seed.color.stroke.neutral,
  },
  body: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x4 },
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
  pressed: { opacity: seed.state.pressedOpacity },
  exampleBanner: { minHeight: seed.size.touchTarget, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2, borderRadius: seed.radius.r3, paddingHorizontal: seed.spacing.x3_5, marginBottom: seed.spacing.x4, backgroundColor: seed.color.background.brandWeak },
  exampleDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.greenInk },
  exampleText: { flex: 1, color: colors.greenInk, fontSize: 10, lineHeight: 16, fontWeight: "700" },
});
