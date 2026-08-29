import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  Modal,
  Platform,
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
import { AppText as Text, AppTextInput as TextInput, BalancedAppText } from "@/components/Typography";
import { SeedActionButton, SeedChip, SeedIconButton, SeedInputShell } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import {
  categoryLabel,
  fetchExchangeRoom,
  filterExchangeItems,
  normalizeExchangeSearch,
  type ExchangeCardItem,
  type ExchangeCategory,
  type ExchangeRoomSnapshot,
} from "@/features/exchange/exchange-api";
import { productSubjectTitle } from "@/features/shop/product-title";
import {
  readExchangeListingCache,
  readExchangeRulesDismissed,
  writeExchangeListingCache,
  writeExchangeRulesDismissed,
} from "@/lib/local-database";
import {
  resolveCatalogImageUrl,
  resolveMobileRuntimeConfig,
  type MobilePlatform,
} from "@/lib/runtime-config";
import { readAuthTokens } from "@/lib/session-store";
import { colors } from "@/theme";

const CATEGORIES: ReadonlyArray<{ label: string; value?: ExchangeCategory }> = [
  { label: "전체" },
  { label: "가챠", value: "gacha" },
  { label: "피규어", value: "figure" },
  { label: "쿠지", value: "kuji" },
  { label: "카드", value: "tcg" },
];

type LoadSource = "live" | "cache" | "empty";

export function ExchangeRoomScreen() {
  const rootNavigationScroll = useRootNavigationScroll();
  const db = useSQLiteContext();
  const runtime = useMemo(
    () =>
      resolveMobileRuntimeConfig({
        configuredApiUrl: process.env.EXPO_PUBLIC_DABBOBA_API_URL,
        configuredAssetBaseUrl: process.env.EXPO_PUBLIC_DABBOBA_ASSET_BASE_URL,
        metroHostUri: Constants.expoConfig?.hostUri,
        platform: Platform.OS as MobilePlatform,
        development: __DEV__,
      }),
    [],
  );
  const [selectedCategory, setSelectedCategory] = useState<ExchangeCategory | undefined>();
  const [snapshot, setSnapshot] = useState<ExchangeRoomSnapshot | null>(null);
  const [source, setSource] = useState<LoadSource>("empty");
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searching, setSearching] = useState(false);
  const [rulesVisible, setRulesVisible] = useState(false);
  const [rulesDismissChecked, setRulesDismissChecked] = useState(false);
  const loadSequence = useRef(0);

  useEffect(() => {
    const search = normalizeExchangeSearch(query);
    const timeout = setTimeout(() => setDebouncedQuery(search), 250);
    return () => clearTimeout(timeout);
  }, [query]);

  const load = useCallback(
    async (manual = false) => {
      const sequence = ++loadSequence.current;
      if (manual) setRefreshing(true);
      if (debouncedQuery) setSearching(true);
      try {
        const fresh = await fetchExchangeRoom(runtime.apiBaseUrl, selectedCategory, debouncedQuery);
        if (sequence !== loadSequence.current) return;
        setSnapshot(fresh);
        setSource("live");
        setMessage("");
        if (!debouncedQuery) await writeExchangeListingCache(db, selectedCategory, fresh);
      } catch (error) {
        if (sequence !== loadSequence.current) return;
        const cached = await readExchangeListingCache(db, selectedCategory);
        if (sequence !== loadSequence.current) return;
        if (cached) {
          setSnapshot(debouncedQuery
            ? {
                ...cached,
                items: filterExchangeItems(
                  cached.items,
                  cached.ipSearchTerms ?? cached.ipNames,
                  debouncedQuery,
                ),
              }
            : cached);
          setSource("cache");
          setMessage(debouncedQuery
            ? "연결이 불안정해 저장된 교환 글 안에서 검색했어요."
            : "연결이 불안정해 마지막으로 저장한 교환 글을 보여드려요.");
        } else {
          setSnapshot(null);
          setSource("empty");
          setMessage(error instanceof Error ? error.message : "교환 글을 불러오지 못했습니다.");
        }
      } finally {
        if (sequence === loadSequence.current) {
          setRefreshing(false);
          setSearching(false);
        }
      }
    },
    [db, debouncedQuery, runtime.apiBaseUrl, selectedCategory],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setRulesVisible(false);
      setRulesDismissChecked(false);
      void readExchangeRulesDismissed(db)
        .then((dismissed) => {
          if (active) setRulesVisible(!dismissed);
        })
        .catch(() => {
          if (active) setRulesVisible(true);
        });
      return () => {
        active = false;
        setRulesVisible(false);
      };
    }, [db]),
  );

  const closeRules = useCallback(async () => {
    try {
      if (rulesDismissChecked) {
        await writeExchangeRulesDismissed(db, true);
      }
    } catch {
      Alert.alert("설정을 저장하지 못했어요", "이번에는 팝업만 닫고 다음 입장 때 다시 안내할게요.");
    } finally {
      setRulesVisible(false);
    }
  }, [db, rulesDismissChecked]);

  const openComposer = useCallback(async () => {
    const tokens = await readAuthTokens();
    if (!tokens) {
      Alert.alert(
        "로그인이 필요해요",
        "로그인 후 직접 뽑아 현재 보관 중인 가챠·쿠지 상품을 교환방에 올릴 수 있어요.",
      );
      return;
    }
    router.push("/exchange/new");
  }, []);

  const normalizedQuery = normalizeExchangeSearch(query);
  const items = useMemo(
    () => filterExchangeItems(
      snapshot?.items ?? [],
      snapshot?.ipSearchTerms ?? snapshot?.ipNames ?? {},
      normalizedQuery,
    ),
    [normalizedQuery, snapshot?.ipNames, snapshot?.ipSearchTerms, snapshot?.items],
  );
  const searchPending = Boolean(normalizedQuery && (normalizedQuery !== debouncedQuery || searching));
  const examplesVisible = items.length > 0 && items.every((item) => item.isExample);
  const assetBaseUrl = runtime.assetBaseUrl
    ?? (__DEV__ ? runtime.apiBaseUrl.replace(/:8788$/, ":4174") : null);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <ScrollView
        {...rootNavigationScroll}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.ink} />
        }
      >
        <Header />

        <SeedInputShell focused={searchFocused} style={styles.searchBox}>
          <Ionicons name="search-outline" size={20} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            onSubmitEditing={() => {
              setDebouncedQuery(normalizeExchangeSearch(query));
              Keyboard.dismiss();
            }}
            placeholder="상품명·작품 검색"
            placeholderTextColor="#8D948C"
            returnKeyType="search"
            maxLength={120}
            style={styles.searchInput}
            accessibilityLabel="교환방 상품 검색"
          />
          {searchPending ? <ActivityIndicator size="small" color={colors.greenInk} /> : null}
          {query ? (
            <SeedIconButton
              label="검색어 지우기"
              onPress={() => {
                setQuery("");
                setDebouncedQuery("");
              }}
              style={styles.clearSearch}
            >
              <Ionicons name="close-circle" size={20} color={colors.muted} />
            </SeedIconButton>
          ) : null}
        </SeedInputShell>

        <View style={styles.createAction}>
          <SeedActionButton
            label="교환 상품 올리기"
            onPress={() => void openComposer()}
            size="medium"
            trailing={<Text style={styles.createButtonArrow}>＋</Text>}
          />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRail}>
          {CATEGORIES.map((category) => {
            const active = selectedCategory === category.value;
            return (
              <SeedChip
                key={category.label}
                label={category.label}
                selected={active}
                onPress={() => setSelectedCategory(category.value)}
              />
            );
          })}
        </ScrollView>

        <View style={styles.sectionHeader}>
          <KoreanPixelTitle variant="section" numberOfLines={2} style={styles.sectionTitle}>
            {normalizedQuery ? "검색 결과" : "교환을 기다리고 있어요"}
          </KoreanPixelTitle>
          <Text style={styles.sectionCount}>{items.length}개</Text>
        </View>

        {examplesVisible ? (
          <View style={styles.exampleNotice}>
            <View style={styles.exampleDot} />
            <Text style={styles.exampleNoticeText}>화면 구성을 확인할 수 있는 예시 글이에요.</Text>
          </View>
        ) : null}

        {message ? (
          <View style={[styles.notice, source === "empty" && styles.noticeError]}>
            <Text style={styles.noticeText}>{message}</Text>
            {source === "empty" ? (
              <Pressable accessibilityRole="button" onPress={() => void load(true)} style={styles.retry}>
                <Text style={styles.retryLabel}>다시 불러오기</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {!snapshot && !message ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.ink} />
            <Text style={styles.loadingText}>교환 글을 불러오는 중</Text>
          </View>
        ) : null}

        {items.length > 0 ? (
          <View style={styles.list}>
            {items.map((item) => (
              <ListingCard
                key={item.id}
                item={item}
                ipName={snapshot?.ipNames[item.product.ipId]}
                assetBaseUrl={assetBaseUrl}
              />
            ))}
          </View>
        ) : null}

        {snapshot && normalizedQuery && !searchPending && items.length === 0 && source !== "empty" ? (
          <View style={styles.searchEmpty}>
            <Ionicons name="search-outline" size={32} color={colors.muted} />
            <KoreanPixelTitle variant="section" style={styles.searchEmptyTitle}>검색 결과가 없어요</KoreanPixelTitle>
            <BalancedAppText style={styles.searchEmptyBody}>
              다른 상품명이나 작품 이름으로 다시 찾아보세요.
            </BalancedAppText>
          </View>
        ) : null}

        {snapshot ? (
          <Text style={styles.sourceNote}>
            {source === "live"
              ? examplesVisible
                ? "Fastify API 카탈로그 기반 예시"
                : "Fastify API에서 방금 불러온 실제 교환 글"
              : "기기에 저장된 삭제 가능한 캐시"}
          </Text>
        ) : null}
      </ScrollView>

      <ExchangeRulesModal
        visible={rulesVisible}
        dismissChecked={rulesDismissChecked}
        onDismissCheckedChange={setRulesDismissChecked}
        onClose={() => void closeRules()}
      />
    </SafeAreaView>
  );
}

function Header() {
  return (
    <View style={styles.header}>
      <RootCategoryTitle>교환방</RootCategoryTitle>
      <RootHeaderActions />
    </View>
  );
}

function ExchangeRulesModal({
  visible,
  dismissChecked,
  onDismissCheckedChange,
  onClose,
}: {
  visible: boolean;
  dismissChecked: boolean;
  onDismissCheckedChange: (checked: boolean) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.modalBackdrop}>
        <View
          accessibilityLabel="교환방 이용 규칙"
          accessibilityViewIsModal
          style={styles.modalCard}
        >
          <View style={styles.modalHeader}>
            <KoreanPixelTitle variant="section">교환 규칙</KoreanPixelTitle>
            <Text style={styles.modalBadge}>입장 안내</Text>
          </View>
          <View style={styles.modalRuleList}>
            <RuleLine>직접 뽑은 가챠·쿠지 상품 중 현재 보관함에 보관 중인 상품만 교환 등록·제안과 포인트 환급을 신청할 수 있어요.</RuleLine>
            <RuleLine>배송 신청이 접수되었거나 배송이 완료된 상품은 환불·교환·포인트 환급을 신청할 수 없어요.</RuleLine>
            <RuleLine>표시 금액은 판매가가 아닌 앱 기준가예요.</RuleLine>
          </View>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: dismissChecked }}
            onPress={() => onDismissCheckedChange(!dismissChecked)}
            style={({ pressed }) => [styles.dismissOption, pressed && styles.pressed]}
          >
            <View style={[styles.checkbox, dismissChecked && styles.checkboxChecked]}>
              {dismissChecked ? <Ionicons name="checkmark" size={16} color={colors.ink} /> : null}
            </View>
            <Text style={styles.dismissOptionLabel}>다시 보지 않기</Text>
          </Pressable>
          <SeedActionButton label="확인" onPress={onClose} style={styles.modalConfirm} />
        </View>
      </View>
    </Modal>
  );
}

function RuleLine({ children }: { children: string }) {
  return (
    <View style={styles.modalRuleRow}>
      <View style={styles.modalRuleDot} />
      <BalancedAppText style={styles.modalRuleText}>{children}</BalancedAppText>
    </View>
  );
}

function ListingCard({
  item,
  ipName,
  assetBaseUrl,
}: {
  item: ExchangeCardItem;
  ipName?: string;
  assetBaseUrl: string | null;
}) {
  const uri = resolveCatalogImageUrl(item.product.imageUrl, assetBaseUrl, item.product.version);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.product.name} 교환 글 자세히 보기`}
      onPress={() => router.push({ pathname: "/exchange/[listingId]", params: { listingId: item.id } })}
      style={({ pressed }) => [styles.listingCard, pressed && styles.pressed]}
    >
      <View style={styles.imageFrame}>
        {uri ? <Image source={{ uri }} style={styles.productImage} resizeMode="cover" /> : <MediaPlaceholder />}
        <View style={styles.cardCategoryBadge}>
          <Text style={styles.cardCategoryLabel}>{categoryLabel(item.product.category)}</Text>
        </View>
        {item.isExample ? (
          <View style={styles.exampleBadge}>
            <Text style={styles.exampleBadgeLabel}>예시</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.cardBody}>
        <Text numberOfLines={2} style={styles.listingTitle}>{item.title}</Text>
        <Text style={styles.productMeta}>{ipName ?? "작품 정보 확인 중"} · {categoryLabel(item.product.category)}</Text>
        <Text numberOfLines={2} style={styles.productName}>{productSubjectTitle(item.product.name, ipName)}</Text>
        <Text numberOfLines={2} style={styles.listingDetails}>{item.details}</Text>
        <View style={styles.priceBox}>
          <Text style={styles.priceCaption}>가챠샵 기준가 · 판매가 아님</Text>
          <Text style={styles.price}>{item.product.price.toLocaleString("ko-KR")}원</Text>
        </View>
        <View style={styles.cardFooter}>
          <Text style={styles.author}>@{item.authorNickname}</Text>
          <Text style={styles.offerCount}>제안 {item.offerCount}개</Text>
        </View>
      </View>
    </Pressable>
  );
}

function MediaPlaceholder() {
  return (
    <View style={styles.mediaPlaceholder}>
      <Text style={styles.mediaPlaceholderLabel}>ITEM IMAGE</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  content: { paddingBottom: ROOT_NAVIGATION_CONTENT_INSET },
  header: { minHeight: seed.size.topNavigation, paddingHorizontal: seed.spacing.globalGutter, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral },
  searchBox: { marginHorizontal: seed.spacing.globalGutter, marginTop: seed.spacing.x3_5 },
  searchInput: { flex: 1, color: colors.ink, fontSize: 15, paddingVertical: 12 },
  clearSearch: { width: seed.size.touchTarget, height: seed.size.touchTarget, marginRight: -seed.spacing.x2 },
  createAction: { marginHorizontal: seed.spacing.globalGutter, marginTop: seed.spacing.x3 },
  createButtonArrow: { color: colors.ink, fontSize: 22, fontWeight: "600" },
  modalBackdrop: { flex: 1, paddingHorizontal: seed.spacing.globalGutter, justifyContent: "center", backgroundColor: "rgba(17, 20, 17, 0.48)" },
  modalCard: { width: "100%", maxWidth: 480, alignSelf: "center", borderRadius: seed.radius.r5, padding: seed.spacing.x5, backgroundColor: seed.color.layer.elevated, shadowColor: colors.black, shadowOpacity: 0.2, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 12 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x3 },
  modalBadge: { overflow: "hidden", borderRadius: seed.radius.r2, paddingHorizontal: seed.spacing.x2_5, paddingVertical: seed.spacing.x1_5, color: colors.greenInk, backgroundColor: seed.color.background.brandWeak, fontSize: 10, lineHeight: 15, fontWeight: "800" },
  modalRuleList: { marginTop: seed.spacing.x4, gap: seed.spacing.x3_5 },
  modalRuleRow: { flexDirection: "row", alignItems: "flex-start", gap: seed.spacing.x2_5 },
  modalRuleDot: { width: 7, height: 7, marginTop: 7, borderRadius: 4, backgroundColor: colors.brand },
  modalRuleText: { flex: 1, maxWidth: "100%", color: colors.ink, fontSize: 14, lineHeight: 22, letterSpacing: -0.2 },
  dismissOption: { minHeight: seed.size.touchTarget, marginTop: seed.spacing.x4, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2_5 },
  checkbox: { width: 22, height: 22, borderRadius: seed.radius.r1, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default, alignItems: "center", justifyContent: "center" },
  checkboxChecked: { borderColor: colors.brand, backgroundColor: colors.brand },
  dismissOptionLabel: { color: colors.ink, fontSize: 14, lineHeight: 20, fontWeight: "700" },
  modalConfirm: { marginTop: seed.spacing.x2 },
  pressed: { opacity: seed.state.pressedOpacity },
  categoryRail: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x3_5, gap: seed.spacing.betweenChips },
  sectionHeader: { marginTop: seed.spacing.x7, marginBottom: seed.spacing.x3_5, paddingHorizontal: seed.spacing.globalGutter, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: seed.spacing.componentDefault },
  sectionTitle: { flex: 1 },
  sectionCount: { color: colors.muted, fontSize: 14, fontWeight: "800", paddingBottom: 3 },
  exampleNotice: { marginHorizontal: seed.spacing.globalGutter, marginBottom: seed.spacing.x3_5, minHeight: seed.size.touchTarget, paddingHorizontal: seed.spacing.componentDefault, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.brandWeak, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2 },
  exampleDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.greenInk },
  exampleNoticeText: { flex: 1, color: colors.greenInk, fontSize: 12, lineHeight: 18, fontWeight: "700" },
  notice: { marginHorizontal: seed.spacing.globalGutter, marginBottom: seed.spacing.componentDefault, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.brandWeak, padding: seed.spacing.x3_5, flexDirection: "row", alignItems: "center", gap: seed.spacing.componentDefault },
  noticeError: { backgroundColor: seed.color.background.criticalWeak },
  noticeText: { flex: 1, color: colors.ink, fontSize: 13, lineHeight: 19 },
  retry: { minHeight: 40, justifyContent: "center", paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.ink },
  retryLabel: { color: colors.white, fontSize: 12, fontWeight: "800" },
  loading: { paddingVertical: 58, alignItems: "center", gap: 12 },
  loadingText: { color: colors.muted, fontSize: 14 },
  list: { paddingHorizontal: seed.spacing.globalGutter, gap: seed.spacing.x3_5 },
  searchEmpty: { minHeight: 230, marginHorizontal: seed.spacing.globalGutter, paddingHorizontal: seed.spacing.x5, alignItems: "center", justifyContent: "center", borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  searchEmptyTitle: { marginTop: seed.spacing.x3_5, textAlign: "center" },
  searchEmptyBody: { marginTop: seed.spacing.x2, color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: "center" },
  listingCard: { minHeight: 188, padding: seed.spacing.componentDefault, borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default, flexDirection: "row", gap: seed.spacing.x3_5 },
  imageFrame: { width: 126, height: 164, borderRadius: seed.radius.r3_5, overflow: "hidden", borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.background.neutralWeak },
  productImage: { width: "100%", height: "100%" },
  cardCategoryBadge: { position: "absolute", top: 8, left: 8, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: colors.brand },
  cardCategoryLabel: { color: colors.ink, fontSize: 10, fontWeight: "900" },
  exampleBadge: { position: "absolute", right: 8, top: 8, borderRadius: 7, paddingHorizontal: 7, paddingVertical: 5, backgroundColor: colors.black },
  exampleBadgeLabel: { color: colors.white, fontSize: 9, fontWeight: "900" },
  cardBody: { flex: 1, minWidth: 0 },
  listingTitle: { color: colors.ink, fontSize: 16, lineHeight: 22, fontWeight: "900" },
  productName: { color: colors.ink, fontSize: 14, lineHeight: 20, fontWeight: "800", marginTop: 3 },
  productMeta: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 5 },
  listingDetails: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 8 },
  priceBox: { marginTop: 10, paddingTop: 9, borderTopWidth: 1, borderTopColor: colors.line },
  priceCaption: { color: colors.muted, fontSize: 9, lineHeight: 13, fontWeight: "700" },
  price: { color: colors.ink, fontSize: 15, lineHeight: 20, fontWeight: "900", marginTop: 2 },
  cardFooter: { marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  author: { flex: 1, color: colors.muted, fontSize: 11, fontWeight: "700" },
  offerCount: { color: colors.greenInk, fontSize: 11, fontWeight: "900" },
  mediaPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", padding: 12 },
  mediaPlaceholderLabel: { color: colors.muted, fontFamily: "monospace", fontSize: 9, fontWeight: "800", textAlign: "center" },
  sourceNote: { color: seed.color.foreground.muted, ...seed.typography.caption, textAlign: "center", marginTop: seed.spacing.x6, paddingHorizontal: seed.spacing.globalGutter },
});
