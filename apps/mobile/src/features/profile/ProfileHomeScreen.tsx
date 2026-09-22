import { router, useFocusEffect, type Href } from "expo-router";
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
import { DecorativeIonicon } from "@/components/DecorativeIonicon";
import { KoreanPixelTitle, RootCategoryTitle } from "@/components/RootCategoryTitle";
import { RootPageHeader } from "@/components/RootPageHeader";
import {
  ROOT_NAVIGATION_CONTENT_INSET,
  useRootNavigationScroll,
} from "@/components/RootFloatingTabBar";
import { AppText as Text } from "@/components/Typography";
import { seed } from "@/design-system/seed";
import { useCommerceCapability } from "@/features/commerce/CommerceCapabilityProvider";
import { useProfileSnapshot } from "@/features/profile/use-profile-snapshot";
import { ProfileSessionGate, isProfileSessionBlocked } from "@/features/profile/ProfileSessionGate";
import { colors } from "@/theme";

type ProfileSection =
  | "edit"
  | "product-history"
  | "wishlist"
  | "storage"
  | "exchange-activity"
  | "shipping"
  | "orders"
  | "points"
  | "requests"
  | "support"
  | "business"
  | "member-info"
  | "settings";

type ProfileMenuItem = {
  section: ProfileSection;
  label: string;
  caption?: string;
};

const COMMERCE_MENU: ReadonlyArray<ProfileMenuItem> = [
  { section: "product-history", label: "상품 기록", caption: "최근 본·뽑은·찜한 상품" },
  { section: "wishlist", label: "내 찜 목록" },
  { section: "storage", label: "보관함", caption: "배송 신청 · 포인트 환급" },
  { section: "exchange-activity", label: "내 교환 현황" },
  { section: "shipping", label: "배송 신청 내역" },
  { section: "orders", label: "구매 내역" },
  { section: "points", label: "포인트 내역" },
];

const ACCOUNT_MENU: ReadonlyArray<ProfileMenuItem> = [
  { section: "member-info", label: "회원정보 관리", caption: "배송지·결제·보안" },
  { section: "settings", label: "설정", caption: "알림·약관·로그아웃" },
];

const SUPPORT_MENU: ReadonlyArray<ProfileMenuItem> = [
  { section: "support", label: "고객센터", caption: "공지·FAQ·문의" },
  { section: "business", label: "사업자 정보" },
];

export function ProfileHomeScreen() {
  const rootNavigationScroll = useRootNavigationScroll();
  const { commerceEnabled } = useCommerceCapability();
  const profileState = useProfileSnapshot();
  const { status, snapshot, message, refreshing, reload } = profileState;
  const hasFocusedOnce = useRef(false);
  const push = (section: ProfileSection) => {
    if (section === "product-history") {
      router.push("/product-history");
      return;
    }
    if (section === "storage") {
      router.navigate("/(tabs)/storage");
      return;
    }
    if (section === "exchange-activity") {
      router.push("/exchange/activity");
      return;
    }
    router.push(`/profile/${section}` as Href);
  };

  useFocusEffect(
    useCallback(() => {
      if (hasFocusedOnce.current) void reload();
      else hasFocusedOnce.current = true;
    }, [reload]),
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <RootPageHeader>
        <RootCategoryTitle>내정보</RootCategoryTitle>
      </RootPageHeader>
      <ScrollView
        {...rootNavigationScroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.ink} />}
      >
        <View style={styles.body}>
        {status === "loading" ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.ink} />
            <Text style={styles.loadingText}>내정보를 불러오는 중</Text>
          </View>
        ) : null}

        {status === "error" || (status === "guest" && message) ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{message}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="내정보 다시 불러오기" onPress={reload} style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
              <Text style={styles.retryLabel}>다시 불러오기</Text>
            </Pressable>
          </View>
        ) : null}

        {snapshot ? (
          <>
            {isProfileSessionBlocked(status) ? (
              <ProfileSessionGate
                status={status}
                returnTo="/(tabs)/profile"
                guestBody="로그인하면 주문·포인트·배송 내역과 나의 수집 기록을 확인할 수 있어요."
              />
            ) : null}

            {status === "authenticated" ? (
              <View style={styles.profileSummaryCard}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="프로필 수정 열기"
                  onPress={() => push("edit")}
                  style={({ pressed }) => [styles.profileCard, pressed && styles.pressed]}
                >
                  <View style={styles.avatar}>
                    <DecorativeIonicon name="people-outline" size={28} color={colors.ink} />
                  </View>
                  <View style={styles.profileText}>
                    <Text maxFontSizeMultiplier={2} style={styles.nickname}>{snapshot.profile.nickname}</Text>
                    <Text maxFontSizeMultiplier={2} style={styles.bio}>{snapshot.profile.bio ?? "나만의 수집 프로필을 완성해 보세요."}</Text>
                  </View>
                  <DecorativeIonicon name="chevron-forward" size={22} color={colors.muted} />
                </Pressable>

                <View style={styles.summaryDivider} />
                <View accessible accessibilityRole="summary" style={styles.walletCard} accessibilityLabel={`내 포인트 ${snapshot.pointBalance.toLocaleString("ko-KR")}P`}>
                  <ProfileMetric label="내 포인트" value={`${snapshot.pointBalance.toLocaleString("ko-KR")}P`} accent />
                </View>

                <View style={styles.summaryDivider} />
                <View accessible accessibilityRole="summary" style={styles.statsCard} accessibilityLabel={`나의 활동, 찜 ${snapshot.wishlist.length}개, 보관함 ${snapshot.inventory.length}개, 구매 ${snapshot.orders.length}건`}>
                  <Stat value={snapshot.wishlist.length} label="찜" />
                  <View style={styles.statDivider} />
                  <Stat value={snapshot.inventory.length} label="보관함" />
                  <View style={styles.statDivider} />
                  <Stat value={snapshot.orders.length} label="구매" />
                </View>
              </View>
            ) : null}

            {commerceEnabled ? <Pressable
              accessibilityRole="button"
              accessibilityLabel="신청방 열기"
              onPress={() => push("requests")}
              style={({ pressed }) => [styles.requestCard, pressed && styles.pressed]}
            >
              <View style={styles.requestIcon}>
                <DecorativeIonicon name="megaphone-outline" size={24} color={colors.greenInk} />
              </View>
              <View style={styles.requestText}>
                <KoreanPixelTitle variant="compact">신청방</KoreanPixelTitle>
                <Text style={styles.requestCaption}>찾는 상품과 작품을 알려주고 같이 기다려요.</Text>
              </View>
              <DecorativeIonicon name="arrow-forward" size={21} color={colors.greenInk} />
            </Pressable> : null}

            <MenuGroup
              title="쇼핑"
              items={commerceEnabled
                ? COMMERCE_MENU
                : COMMERCE_MENU.filter((item) => item.section !== "exchange-activity")}
              onPress={push}
            />
            <MenuGroup title="계정" items={ACCOUNT_MENU} onPress={push} />
            <MenuGroup title="지원" items={SUPPORT_MENU} onPress={push} />
          </>
        ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text maxFontSizeMultiplier={2} style={styles.statValue}>{value}</Text>
      <Text maxFontSizeMultiplier={2} style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ProfileMetric({
  label,
  value,
  accent = false,
  muted = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <View style={styles.metric}>
      <Text maxFontSizeMultiplier={2} style={styles.metricLabel}>{label}</Text>
      <Text maxFontSizeMultiplier={2} style={[styles.metricValue, accent && styles.metricValueAccent, muted && styles.metricValueMuted]}>{value}</Text>
    </View>
  );
}

function MenuGroup({
  title,
  items,
  onPress,
}: {
  title: string;
  items: ReadonlyArray<ProfileMenuItem>;
  onPress: (section: ProfileSection) => void;
}) {
  return (
    <View style={styles.menuSection}>
      <Text style={styles.menuSectionTitle}>{title}</Text>
      <View style={styles.menuCard}>
        {items.map((item, index) => (
          <View key={item.section}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.label} 열기`}
              onPress={() => onPress(item.section)}
              style={({ pressed }) => [
                styles.menuRow,
                item.caption && styles.menuRowWithCaption,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.menuText}>
                <Text style={styles.menuLabel}>{item.label}</Text>
                {item.caption ? <Text style={styles.menuCaption}>{item.caption}</Text> : null}
              </View>
              <DecorativeIonicon name="chevron-forward" size={20} color={colors.muted} />
            </Pressable>
            {index < items.length - 1 ? <View style={styles.menuRowDivider} /> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  content: { paddingBottom: ROOT_NAVIGATION_CONTENT_INSET },
  body: { paddingHorizontal: seed.spacing.globalGutter },
  pressed: { opacity: seed.state.pressedOpacity, transform: [{ scale: seed.state.pressedScale }] },
  loading: { minHeight: 420, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { color: colors.muted, fontSize: 14 },
  errorBox: { marginTop: seed.spacing.x5, borderRadius: seed.radius.r4, padding: seed.spacing.x5, backgroundColor: seed.color.background.criticalWeak, alignItems: "center" },
  errorText: { color: colors.ink, fontSize: 14, lineHeight: 21, textAlign: "center" },
  retryButton: { minHeight: seed.size.touchTarget, justifyContent: "center", marginTop: seed.spacing.x3_5, paddingHorizontal: seed.spacing.x4_5, borderRadius: seed.radius.r2_5, backgroundColor: colors.ink },
  retryLabel: { color: colors.white, fontWeight: "900" },
  profileSummaryCard: { overflow: "hidden", marginTop: seed.spacing.x3, borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  profileCard: { minHeight: 92, flexDirection: "row", alignItems: "center", gap: seed.spacing.x3, paddingHorizontal: seed.spacing.x4, paddingVertical: seed.spacing.x3, backgroundColor: seed.color.layer.default },
  avatar: { width: 56, height: 56, borderRadius: seed.radius.r3, alignItems: "center", justifyContent: "center", backgroundColor: colors.brand },
  profileText: { flex: 1, minWidth: 0 },
  nickname: { color: colors.ink, fontSize: 19, fontWeight: "900" },
  bio: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: seed.spacing.x1_5 },
  summaryDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: seed.spacing.x4, backgroundColor: seed.color.stroke.muted },
  walletCard: { minHeight: 76, flexDirection: "row", alignItems: "stretch", backgroundColor: seed.color.layer.default },
  metric: { flex: 1, minWidth: 0, alignItems: "center", justifyContent: "center", gap: seed.spacing.x1_5 },
  metricLabel: { color: colors.muted, ...seed.typography.caption, fontWeight: "700" },
  metricValue: { color: colors.ink, ...seed.typography.subtitle, textAlign: "center" },
  metricValueAccent: { color: colors.greenInk },
  metricValueMuted: { color: colors.muted, ...seed.typography.bodyStrong },
  statsCard: { minHeight: 70, flexDirection: "row", alignItems: "center", backgroundColor: seed.color.layer.default },
  stat: { flex: 1, minWidth: 0, alignItems: "center", gap: 5 },
  statValue: { color: colors.ink, ...seed.typography.subtitle, textAlign: "center" },
  statLabel: { color: colors.muted, ...seed.typography.caption, fontWeight: "700", textAlign: "center" },
  statDivider: { width: StyleSheet.hairlineWidth, height: 34, backgroundColor: seed.color.stroke.muted },
  requestCard: { minHeight: 84, flexDirection: "row", alignItems: "center", gap: seed.spacing.x3, marginTop: seed.spacing.x4, borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, paddingHorizontal: seed.spacing.x4, paddingVertical: seed.spacing.x3, backgroundColor: seed.color.layer.default },
  requestIcon: { width: 48, height: 48, borderRadius: seed.radius.r3, alignItems: "center", justifyContent: "center", backgroundColor: seed.color.background.brandWeak },
  requestText: { flex: 1, minWidth: 0 },
  requestCaption: { color: seed.color.foreground.muted, fontSize: 11, lineHeight: 17, marginTop: 5 },
  menuSection: { marginTop: seed.spacing.x6 },
  menuSectionTitle: { color: seed.color.foreground.neutral, ...seed.typography.subheading, marginBottom: seed.spacing.x2_5 },
  menuCard: { overflow: "hidden", borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  menuRow: { minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x4, paddingHorizontal: seed.spacing.x4, paddingVertical: seed.spacing.x2 },
  menuRowWithCaption: { minHeight: 68 },
  menuText: { flex: 1, minWidth: 0 },
  menuLabel: { color: seed.color.foreground.neutral, ...seed.typography.subheading },
  menuCaption: { marginTop: seed.spacing.x0_5, color: seed.color.foreground.muted, ...seed.typography.finePrint },
  menuRowDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: seed.spacing.x4, backgroundColor: seed.color.stroke.muted },
});
