import { Ionicons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import type { ComponentProps } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { KoreanPixelTitle, RootCategoryTitle } from "@/components/RootCategoryTitle";
import { RootHeaderActions } from "@/components/RootHeaderActions";
import {
  ROOT_NAVIGATION_CONTENT_INSET,
  useRootNavigationScroll,
} from "@/components/RootFloatingTabBar";
import { AppText as Text } from "@/components/Typography";
import { SeedCard } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import { useProfileSnapshot } from "@/features/profile/use-profile-snapshot";
import { colors } from "@/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];
type ProfileSection =
  | "edit"
  | "wishlist"
  | "storage"
  | "shipping"
  | "orders"
  | "points"
  | "requests"
  | "support"
  | "member-info"
  | "settings";

const COMMERCE_MENU: ReadonlyArray<{ section: ProfileSection; label: string; caption: string; icon: IconName }> = [
  { section: "wishlist", label: "내 찜 목록", caption: "관심 상품을 한곳에서 확인", icon: "heart-outline" },
  { section: "storage", label: "보관함", caption: "배송 신청 · 포인트 환급", icon: "cube-outline" },
  { section: "orders", label: "구매 내역", caption: "결제 금액과 주문 상태", icon: "receipt-outline" },
  { section: "points", label: "포인트 내역", caption: "잔액과 적립·사용 기록", icon: "wallet-outline" },
];

const ACCOUNT_MENU: ReadonlyArray<{ section: ProfileSection; label: string; caption: string; icon: IconName }> = [
  { section: "member-info", label: "회원정보 관리", caption: "개인정보·배송·결제·보안", icon: "person-outline" },
  { section: "settings", label: "설정", caption: "알림·약관·로그아웃·탈퇴", icon: "settings-outline" },
  { section: "support", label: "고객센터", caption: "공지·FAQ·문의 내역", icon: "headset-outline" },
];

export function ProfileHomeScreen() {
  const rootNavigationScroll = useRootNavigationScroll();
  const { snapshot, message, refreshing, reload } = useProfileSnapshot();
  const push = (section: ProfileSection) => router.push(`/profile/${section}` as Href);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <ScrollView
        {...rootNavigationScroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.ink} />}
      >
        <View style={styles.header}>
          <RootCategoryTitle>내정보</RootCategoryTitle>
          <RootHeaderActions />
        </View>

        <View style={styles.body}>
        {!snapshot && !message ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.ink} />
            <Text style={styles.loadingText}>내정보를 불러오는 중</Text>
          </View>
        ) : null}

        {message ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{message}</Text>
            <Pressable accessibilityRole="button" onPress={reload} style={styles.retryButton}>
              <Text style={styles.retryLabel}>다시 불러오기</Text>
            </Pressable>
          </View>
        ) : null}

        {snapshot ? (
          <>
            {snapshot.isExample ? (
              <View style={styles.exampleBanner}>
                <View style={styles.exampleDot} />
                <Text style={styles.exampleText}>프로필·주문·포인트·배송은 로그인 전 화면 예시예요. 공개 신청방·공지는 서버 목록을 사용할 수 있습니다.</Text>
              </View>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="프로필 관리 열기"
              onPress={() => push("edit")}
              style={({ pressed }) => [styles.profileCard, pressed && styles.pressed]}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{snapshot.profile.nickname.slice(0, 1)}</Text>
              </View>
              <View style={styles.profileText}>
                <View style={styles.nameRow}>
                  <Text style={styles.nickname}>{snapshot.profile.nickname}</Text>
                  <Text style={styles.levelBadge}>{snapshot.isExample ? "PREVIEW" : "MEMBER"}</Text>
                </View>
                <Text numberOfLines={2} style={styles.bio}>{snapshot.profile.bio ?? "나만의 수집 프로필을 완성해 보세요."}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.muted} />
            </Pressable>

            <SeedCard style={styles.statsCard}>
              <Stat value={snapshot.inventory.length} label="사용 가능 보관" />
              <View style={styles.statDivider} />
              <Stat value={snapshot.wishlist.length} label="찜" />
              <View style={styles.statDivider} />
              <Stat value={`${snapshot.pointBalance.toLocaleString("ko-KR")}P`} label="포인트" />
            </SeedCard>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="신청방 열기"
              onPress={() => push("requests")}
              style={({ pressed }) => [styles.requestCard, pressed && styles.pressed]}
            >
              <View style={styles.requestIcon}>
                <Ionicons name="megaphone-outline" size={24} color={colors.ink} />
              </View>
              <View style={styles.requestText}>
                <KoreanPixelTitle variant="compact">신청방</KoreanPixelTitle>
                <Text style={styles.requestCaption}>찾는 상품과 작품을 알려주고 같이 기다려요.</Text>
              </View>
              <Ionicons name="arrow-forward" size={21} color={colors.ink} />
            </Pressable>

            <MenuGroup title="쇼핑·보관" items={COMMERCE_MENU} onPress={push} />
            <MenuGroup title="계정·도움" items={ACCOUNT_MENU} onPress={push} />

            <Text style={styles.disclosure}>
              {snapshot.isExample
                ? "프로필·등급·주문·포인트·배송 내용은 로그인 전 예시이며 실제 계정 데이터가 아닙니다."
                : "주문·포인트·배송 상태는 서버에 저장된 계정 내역을 기준으로 표시합니다."}
            </Text>
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
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function MenuGroup({
  title,
  items,
  onPress,
}: {
  title: string;
  items: ReadonlyArray<{ section: ProfileSection; label: string; caption: string; icon: IconName }>;
  onPress: (section: ProfileSection) => void;
}) {
  return (
    <View style={styles.menuSection}>
      <Text style={styles.menuSectionTitle}>{title}</Text>
      <SeedCard style={styles.menuCard}>
        {items.map((item, index) => (
          <Pressable
            key={item.section}
            accessibilityRole="button"
            accessibilityLabel={`${item.label} 열기`}
            onPress={() => onPress(item.section)}
            style={({ pressed }) => [
              styles.menuRow,
              index < items.length - 1 && styles.menuRowBorder,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.menuIcon}><Ionicons name={item.icon} size={20} color={colors.ink} /></View>
            <View style={styles.menuText}>
              <Text style={styles.menuLabel}>{item.label}</Text>
              <Text style={styles.menuCaption}>{item.caption}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        ))}
      </SeedCard>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  content: { paddingBottom: ROOT_NAVIGATION_CONTENT_INSET },
  header: { minHeight: seed.size.topNavigation, paddingHorizontal: seed.spacing.globalGutter, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral },
  body: { paddingHorizontal: seed.spacing.globalGutter },
  pressed: { opacity: seed.state.pressedOpacity },
  loading: { minHeight: 420, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { color: colors.muted, fontSize: 14 },
  errorBox: { marginTop: seed.spacing.x5, borderRadius: seed.radius.r4, padding: seed.spacing.x5, backgroundColor: seed.color.background.criticalWeak, alignItems: "center" },
  errorText: { color: colors.ink, fontSize: 14, lineHeight: 21, textAlign: "center" },
  retryButton: { minHeight: 42, justifyContent: "center", marginTop: 14, paddingHorizontal: 18, borderRadius: 10, backgroundColor: colors.ink },
  retryLabel: { color: colors.white, fontWeight: "900" },
  exampleBanner: { minHeight: seed.size.touchTarget, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2, borderRadius: seed.radius.r3, paddingHorizontal: seed.spacing.x3_5, backgroundColor: seed.color.background.brandWeak },
  exampleDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.greenInk },
  exampleText: { flex: 1, color: colors.greenInk, fontSize: 11, lineHeight: 17, fontWeight: "700" },
  profileCard: { marginTop: seed.spacing.x3_5, minHeight: 110, flexDirection: "row", alignItems: "center", gap: seed.spacing.x3_5, borderRadius: seed.radius.r5, borderWidth: 1, borderColor: seed.color.stroke.neutral, padding: seed.spacing.x4_5, backgroundColor: seed.color.layer.default },
  avatar: { width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center", backgroundColor: colors.brand },
  avatarText: { color: colors.ink, fontSize: 22, fontWeight: "900" },
  profileText: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  nickname: { color: colors.ink, fontSize: 19, fontWeight: "900" },
  levelBadge: { overflow: "hidden", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 4, backgroundColor: "#E8ECE8", color: colors.greenInk, fontSize: 9, fontWeight: "900" },
  bio: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 6 },
  statsCard: { minHeight: 86, flexDirection: "row", alignItems: "center", borderRadius: seed.radius.r4, marginTop: seed.spacing.componentDefault, backgroundColor: seed.color.layer.inverted, borderWidth: 0 },
  stat: { flex: 1, alignItems: "center", gap: 5 },
  statValue: { color: colors.white, fontSize: 17, fontWeight: "900" },
  statLabel: { color: "#AEB6AF", fontSize: 10, fontWeight: "700" },
  statDivider: { width: 1, height: 34, backgroundColor: "#313832" },
  requestCard: { minHeight: 116, flexDirection: "row", alignItems: "center", gap: seed.spacing.x3_5, borderRadius: seed.radius.r5, marginTop: seed.spacing.x4_5, padding: seed.spacing.x4_5, backgroundColor: seed.color.background.brandSolid },
  requestIcon: { width: 48, height: 48, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.55)" },
  requestText: { flex: 1, minWidth: 0 },
  requestCaption: { color: "#2E4B32", fontSize: 11, lineHeight: 17, marginTop: 5 },
  menuSection: { marginTop: seed.spacing.x6 },
  menuSectionTitle: { color: seed.color.foreground.neutral, ...seed.typography.subtitle, marginBottom: seed.spacing.x2_5 },
  menuCard: { overflow: "hidden", borderRadius: seed.radius.r4 },
  menuRow: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: seed.spacing.componentDefault, paddingHorizontal: seed.spacing.x3_5 },
  menuRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral },
  menuIcon: { width: 38, height: 38, borderRadius: seed.radius.r3, alignItems: "center", justifyContent: "center", backgroundColor: seed.color.background.neutralWeak },
  menuText: { flex: 1, minWidth: 0 },
  menuLabel: { color: seed.color.foreground.neutral, ...seed.typography.bodyStrong },
  menuCaption: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 3 },
  disclosure: { color: colors.muted, fontSize: 10, lineHeight: 16, textAlign: "center", marginTop: 22, paddingHorizontal: 12 },
});
