import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { KoreanPixelTitle, KoreanPixelTitleAccessory, RootCategoryTitle } from "@/components/RootCategoryTitle";
import { RootHeaderActions } from "@/components/RootHeaderActions";
import {
  ROOT_NAVIGATION_CONTENT_INSET,
  useRootNavigationScroll,
} from "@/components/RootFloatingTabBar";
import { AppText as Text } from "@/components/Typography";
import { SeedActionButton, SeedInlineGuidance } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import {
  fetchDukroomSnapshot,
  type DukroomItem,
  type DukroomSnapshot,
} from "@/features/dukroom/dukroom-api";
import { readAuthTokens } from "@/lib/session-store";
import {
  resolveCatalogImageUrl,
  resolveMobileRuntimeConfig,
  type MobilePlatform,
} from "@/lib/runtime-config";
import { colors } from "@/theme";

export function DukroomScreen() {
  const rootNavigationScroll = useRootNavigationScroll();
  const router = useRouter();
  const params = useLocalSearchParams<{ ipId?: string | string[] }>();
  const requestedIpId = firstParam(params.ipId);
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
  const [snapshot, setSnapshot] = useState<DukroomSnapshot | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    else setLoading(true);
    try {
      const tokens = await readAuthTokens();
      setAccessToken(tokens?.accessToken ?? null);
      setSnapshot(await fetchDukroomSnapshot(runtime.apiBaseUrl, tokens?.accessToken));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "덕룸을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [runtime.apiBaseUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const requestedIp = snapshot?.ips.find((ip) => ip.id === requestedIpId) ?? null;
  const visibleItems = snapshot?.items.filter((item) => !requestedIpId || item.post.ipId === requestedIpId) ?? [];
  const hasExamples = visibleItems.some((item) => item.isExample);

  const requestCompose = () => {
    if (!accessToken) {
      Alert.alert("로그인이 필요합니다", "덕룸 글과 사진은 로그인한 계정으로 등록됩니다.");
      return;
    }
    Alert.alert("글쓰기 준비 중", "사진 선택·업로드가 포함된 네이티브 작성 화면은 다음 구현 단계에서 연결합니다.");
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <ScrollView
        {...rootNavigationScroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.ink} />}
      >
        <View style={styles.header}>
          <RootCategoryTitle>덕룸</RootCategoryTitle>
          <RootHeaderActions />
        </View>

        <Text style={styles.categoryDescription}>모은 굿즈를 꺼내 보여주고 수집 이야기를 나누는 곳이에요.</Text>

        {requestedIp ? (
          <View style={styles.ipFilter}>
            <View style={styles.ipFilterCopy}><Text numberOfLines={1} style={styles.ipFilterName}>{requestedIp.nameKo}</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="작품 필터 해제" onPress={() => router.setParams({ ipId: undefined })} style={styles.clearFilter}>
              <Ionicons name="close" size={18} color={colors.ink} /><Text style={styles.clearFilterLabel}>해제</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.sectionHeader}>
          <KoreanPixelTitle variant="section">수집가의 방</KoreanPixelTitle>
          <View style={styles.sectionActions}>
            <KoreanPixelTitleAccessory style={styles.sectionCount}>{visibleItems.length}개</KoreanPixelTitleAccessory>
            <SeedActionButton
              label="글쓰기"
              size="small"
              leading={<Ionicons name="add" size={18} color={colors.ink} />}
              onPress={requestCompose}
              style={styles.composeButton}
            />
          </View>
        </View>

        {hasExamples ? (
          <SeedInlineGuidance style={styles.exampleGuidance}>서버에 공개된 일반 덕룸 글이 부족해 등록 상품으로 만든 화면 예시를 함께 보여드려요.</SeedInlineGuidance>
        ) : null}

        {loading ? (
          <View style={styles.loading}><ActivityIndicator color={colors.ink} /><Text style={styles.loadingText}>덕룸을 불러오는 중</Text></View>
        ) : message ? (
          <View style={styles.empty}>
            <Ionicons name="alert-circle-outline" size={30} color={colors.muted} />
            <Text style={styles.emptyTitle}>{message}</Text>
            <Pressable accessibilityRole="button" onPress={() => void load(true)} style={styles.retryButton}><Text style={styles.retryLabel}>다시 불러오기</Text></Pressable>
          </View>
        ) : visibleItems.length ? (
          <View style={styles.feed}>
            {visibleItems.map((item) => (
              <DukroomCard
                key={item.post.id}
                item={item}
                assetBaseUrl={runtime.assetBaseUrl}
                onPress={() => router.push(`/dukroom/${encodeURIComponent(item.post.id)}` as Href)}
              />
            ))}
          </View>
        ) : (
          <View style={styles.empty}>
            <Ionicons name="images-outline" size={30} color={colors.muted} />
            <Text style={styles.emptyTitle}>표시할 덕룸 글이 없어요</Text>
            <Text style={styles.emptyBody}>새로운 수집 이야기가 등록되면 여기에 표시돼요.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function DukroomCard({ item, assetBaseUrl, onPress }: { item: DukroomItem; assetBaseUrl: string | null; onPress: () => void }) {
  const uri = resolveCatalogImageUrl(item.imageUrl, assetBaseUrl, item.imageVersion);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${item.post.title} 상세 보기`} onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.cardMedia}>
        {uri ? <Image source={{ uri }} resizeMode="cover" style={styles.cardImage} /> : <View style={styles.placeholder}><Ionicons name="images-outline" size={28} color={colors.muted} /></View>}
        {item.isExample ? <View style={styles.previewBadge}><Text style={styles.previewBadgeLabel}>화면 예시</Text></View> : null}
      </View>
      <View style={styles.cardCopy}>
        <View style={styles.authorRow}><Text numberOfLines={1} style={styles.author}>@{item.post.authorNickname}</Text><Text style={styles.ipName}>{item.ipName ?? "자유 수집"}</Text></View>
        <Text numberOfLines={2} style={styles.cardTitle}>{item.post.title}</Text>
        <Text numberOfLines={2} style={styles.cardBody}>{item.post.content}</Text>
        <View style={styles.statRow}>
          <View style={styles.stat}><Ionicons name={item.post.likedByViewer ? "heart" : "heart-outline"} size={17} color={item.post.likedByViewer ? colors.greenInk : colors.muted} /><Text style={styles.statLabel}>{item.post.likeCount}</Text></View>
          <View style={styles.stat}><Ionicons name="chatbubble-outline" size={16} color={colors.muted} /><Text style={styles.statLabel}>{item.post.commentCount}</Text></View>
          <Text style={styles.date}>{formatCompactDate(item.post.createdAt)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function formatCompactDate(value: string): string {
  const date = new Date(value);
  return `${date.getMonth() + 1}.${String(date.getDate()).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  content: { paddingBottom: ROOT_NAVIGATION_CONTENT_INSET },
  header: { minHeight: seed.size.topNavigation, paddingHorizontal: seed.spacing.globalGutter, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral },
  categoryDescription: { marginHorizontal: seed.spacing.globalGutter, marginTop: seed.spacing.x3_5, color: seed.color.foreground.muted, ...seed.typography.label },
  ipFilter: { marginHorizontal: seed.spacing.globalGutter, marginTop: seed.spacing.x4_5, padding: seed.spacing.x3_5, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.brandWeak, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.componentDefault },
  ipFilterCopy: { flex: 1 },
  ipFilterName: { color: colors.ink, fontSize: 15, fontWeight: "900" },
  clearFilter: { minHeight: seed.size.touchTarget, paddingHorizontal: seed.spacing.x2_5, flexDirection: "row", alignItems: "center", gap: seed.spacing.x0_5, borderRadius: seed.radius.r2, backgroundColor: seed.color.layer.default },
  clearFilterLabel: { color: colors.ink, fontSize: 12, fontWeight: "800" },
  sectionHeader: { marginTop: seed.spacing.x7, marginBottom: seed.spacing.x3_5, paddingHorizontal: seed.spacing.globalGutter, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  sectionCount: { paddingBottom: 3 },
  sectionActions: { flexDirection: "row", alignItems: "center", gap: seed.spacing.x2_5 },
  composeButton: { paddingHorizontal: seed.spacing.x3 },
  exampleGuidance: { marginHorizontal: seed.spacing.globalGutter, marginBottom: seed.spacing.x3_5 },
  loading: { paddingHorizontal: seed.spacing.globalGutter, paddingVertical: 70, alignItems: "center", gap: 12 },
  loadingText: { color: colors.muted, fontSize: 14 },
  feed: { paddingHorizontal: seed.spacing.globalGutter, gap: seed.spacing.x4 },
  card: { overflow: "hidden", borderRadius: seed.radius.r5, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  cardMedia: { aspectRatio: 1.45, overflow: "hidden", backgroundColor: seed.color.background.neutralWeak },
  cardImage: { width: "100%", height: "100%" },
  placeholder: { flex: 1, alignItems: "center", justifyContent: "center" },
  previewBadge: { position: "absolute", top: 11, right: 11, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, backgroundColor: "rgba(7,16,11,0.82)" },
  previewBadgeLabel: { color: colors.white, fontSize: 10, fontWeight: "800" },
  cardCopy: { padding: seed.spacing.x4 },
  authorRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  author: { flex: 1, color: colors.ink, fontSize: 12, fontWeight: "800" },
  ipName: { maxWidth: "52%", color: colors.greenInk, fontSize: 11, fontWeight: "800" },
  cardTitle: { color: seed.color.foreground.neutral, ...seed.typography.subtitle, marginTop: seed.spacing.x2_5 },
  cardBody: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 7 },
  statRow: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 14 },
  stat: { flexDirection: "row", alignItems: "center", gap: 5 },
  statLabel: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  date: { marginLeft: "auto", color: colors.muted, fontSize: 11 },
  empty: { marginHorizontal: seed.spacing.globalGutter, paddingVertical: seed.spacing.x14, paddingHorizontal: seed.spacing.x5, alignItems: "center", borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  emptyTitle: { color: colors.ink, fontSize: 16, fontWeight: "900", textAlign: "center", marginTop: 12 },
  emptyBody: { color: colors.muted, fontSize: 13, textAlign: "center", marginTop: 6 },
  retryButton: { minHeight: 42, justifyContent: "center", paddingHorizontal: 16, marginTop: 15, borderRadius: 10, backgroundColor: colors.ink },
  retryLabel: { color: colors.white, fontSize: 13, fontWeight: "800" },
  pressed: { opacity: seed.state.pressedOpacity },
});
