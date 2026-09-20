import Constants from "expo-constants";
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
import { DecorativeIonicon } from "@/components/DecorativeIonicon";
import { SafeAreaView } from "react-native-safe-area-context";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { ProductInfoDivider } from "@/components/ProductInfoDivider";
import { KoreanPixelTitle, KoreanPixelTitleAccessory } from "@/components/RootCategoryTitle";
import { AppText as Text, AppTextInput as TextInput, BalancedAppText } from "@/components/Typography";
import { catalogProductCardSurface, catalogProductImageSurface } from "@/design-system/catalog";
import { SeedActionButton, SeedIconButton, SeedInputShell } from "@/design-system/components";
import { subtleSectionHeaderRule } from "@/design-system/section";
import { seed } from "@/design-system/seed";
import { catalogPriceLabel } from "@/features/commerce/product-commerce-presentation";
import { openCustomerLogin } from "@/features/auth/login-navigation";
import {
  categoryLabel,
  fetchExchangeRoom,
  filterExchangeItems,
  normalizeExchangeSearch,
  type ExchangeCardItem,
  type ExchangeRoomSnapshot,
} from "@/features/exchange/exchange-api";
import { areCustomerVisibleExchangeProducts } from "@/features/exchange/exchange-visibility";
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

type LoadSource = "live" | "cache" | "empty";

export function ExchangeRoomScreen() {
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
        const tokens = await readAuthTokens();
        const fresh = await fetchExchangeRoom(
          runtime.apiBaseUrl,
          undefined,
          debouncedQuery,
          false,
          tokens?.accessToken,
        );
        if (sequence !== loadSequence.current) return;
        setSnapshot(fresh);
        setSource("live");
        setMessage("");
        if (!tokens && !debouncedQuery) await writeExchangeListingCache(db, undefined, fresh);
      } catch (error) {
        if (sequence !== loadSequence.current) return;
        const tokens = await readAuthTokens();
        if (tokens) {
          setSnapshot(null);
          setSource("empty");
          setMessage(error instanceof Error ? error.message : "교환 글을 불러오지 못했습니다.");
          return;
        }
        const cached = await readExchangeListingCache(db, undefined);
        if (sequence !== loadSequence.current) return;
        if (cached) {
          const cachedItems = cached.items
            .filter((item) => areCustomerVisibleExchangeProducts(item.products?.length ? item.products : [item.product]))
            .filter((item) => !item.isExample);
          setSnapshot(debouncedQuery
            ? {
                ...cached,
                items: filterExchangeItems(
                  cachedItems,
                  cached.ipSearchTerms ?? cached.ipNames,
                  debouncedQuery,
                ),
              }
            : { ...cached, items: cachedItems });
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
    [db, debouncedQuery, runtime.apiBaseUrl],
  );

  useFocusEffect(useCallback(() => {
    void load();
    return () => {
      loadSequence.current += 1;
    };
  }, [load]));

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
      openCustomerLogin(
        "로그인 후 가챠로 직접 뽑아 현재 보관 중인 상품을 교환방에 올릴 수 있어요.",
        "/exchange/new",
      );
      return;
    }
    router.push("/exchange/new");
  }, []);

  const openMyActivity = useCallback(async () => {
    const tokens = await readAuthTokens();
    if (!tokens) {
      openCustomerLogin("로그인 후 내가 등록하거나 신청한 교환을 확인할 수 있어요.", "/exchange/activity");
      return;
    }
    router.push("/exchange/activity");
  }, []);

  const normalizedQuery = normalizeExchangeSearch(query);
  const items = useMemo(
    () => filterExchangeItems(
      (snapshot?.items ?? []).filter((item) => (
        areCustomerVisibleExchangeProducts(item.products?.length ? item.products : [item.product])
      )),
      snapshot?.ipSearchTerms ?? snapshot?.ipNames ?? {},
      normalizedQuery,
    ),
    [normalizedQuery, snapshot?.ipNames, snapshot?.ipSearchTerms, snapshot?.items],
  );
  const searchPending = Boolean(normalizedQuery && (normalizedQuery !== debouncedQuery || searching));
  const assetBaseUrl = runtime.assetBaseUrl
    ?? (__DEV__ ? runtime.apiBaseUrl.replace(/:8788$/, ":4174") : null);
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/storage");
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <DetailPageHeader title="교환방" titleMode="pixel" onBack={goBack} backLabel="보관함으로 돌아가기" />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.ink} />
        }
      >
        <View style={styles.primaryActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="교환 상품 올리기"
            onPress={() => void openComposer()}
            style={({ pressed }) => [styles.createPrimary, pressed && styles.pressed]}
          >
            <DecorativeIonicon name="add" size={22} color={colors.ink} />
            <Text style={styles.createPrimaryLabel}>상품 올리기</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="내 교환 현황"
            onPress={() => void openMyActivity()}
            style={({ pressed }) => [styles.myExchangeButton, pressed && styles.pressed]}
          >
            <DecorativeIonicon name="person-outline" size={20} color={colors.ink} />
            <Text style={styles.myExchangeLabel}>현황</Text>
          </Pressable>
        </View>

        <SeedInputShell focused={searchFocused} variant="search" style={styles.searchBox}>
          <DecorativeIonicon name="search-outline" size={20} color={colors.muted} />
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
            placeholderTextColor={colors.muted}
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
              <DecorativeIonicon name="close-circle" size={20} color={colors.muted} />
            </SeedIconButton>
          ) : null}
        </SeedInputShell>

        <View style={styles.sectionHeader}>
          <KoreanPixelTitle variant="section" numberOfLines={2} style={styles.sectionTitle}>
            {normalizedQuery ? "검색 결과" : "교환을 기다리고 있어요"}
          </KoreanPixelTitle>
          <KoreanPixelTitleAccessory style={styles.sectionCount}>{items.length}개</KoreanPixelTitleAccessory>
        </View>

        {message ? (
          <View style={[styles.notice, source === "empty" && styles.noticeError]}>
            <Text style={styles.noticeText}>{message}</Text>
            {source === "empty" ? (
              <Pressable accessibilityRole="button" onPress={() => void load(true)} style={({ pressed }) => [styles.retry, pressed && styles.pressed]}>
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
                ipNames={snapshot?.ipNames ?? {}}
                assetBaseUrl={assetBaseUrl}
              />
            ))}
          </View>
        ) : null}

        {snapshot && normalizedQuery && !searchPending && items.length === 0 && source !== "empty" ? (
          <View style={styles.searchEmpty}>
            <DecorativeIonicon name="search-outline" size={32} color={colors.muted} />
            <KoreanPixelTitle variant="section" style={styles.searchEmptyTitle}>검색 결과가 없어요</KoreanPixelTitle>
            <BalancedAppText style={styles.searchEmptyBody}>
              다른 상품명이나 작품 이름으로 다시 찾아보세요.
            </BalancedAppText>
          </View>
        ) : null}

        {snapshot && !normalizedQuery && items.length === 0 && source !== "empty" ? (
          <View style={styles.searchEmpty}>
            <DecorativeIonicon name="swap-horizontal-outline" size={32} color={colors.muted} />
            <KoreanPixelTitle variant="section" style={styles.searchEmptyTitle}>아직 등록된 교환 상품이 없어요</KoreanPixelTitle>
            <BalancedAppText style={styles.searchEmptyBody}>
              보관함에 있는 상품으로 첫 교환을 시작해 보세요.
            </BalancedAppText>
          </View>
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
            <RuleLine>가챠로 직접 뽑아 현재 보관함에 있는 상품만 등록하거나 신청할 수 있어요.</RuleLine>
            <RuleLine>등록글은 7일 동안 공개되며 성사되지 않으면 자동으로 종료돼요.</RuleLine>
            <RuleLine>교환 완료 시 남은 보관 기간이 14일보다 짧으면 14일로 연장돼요.</RuleLine>
            <RuleLine>교환으로 받은 상품은 포인트 환급 대상이 아니며, 본인이 가챠에서 직접 뽑아 보관 중인 상품만 포인트로 환급할 수 있어요.</RuleLine>
            <RuleLine>교환 진행과 문의는 다뽀바 안에서 완료해 주세요.</RuleLine>
          </View>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: dismissChecked }}
            onPress={() => onDismissCheckedChange(!dismissChecked)}
            style={({ pressed }) => [styles.dismissOption, pressed && styles.pressed]}
          >
            <View style={[styles.checkbox, dismissChecked && styles.checkboxChecked]}>
              {dismissChecked ? <DecorativeIonicon name="checkmark" size={16} color={colors.ink} /> : null}
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
  ipNames,
  assetBaseUrl,
}: {
  item: ExchangeCardItem;
  ipNames: Record<string, string>;
  assetBaseUrl: string | null;
}) {
  const products = item.products.length ? item.products : [item.product];
  const productDetails = products.map((product) => ({
    product,
    ipName: ipNames[product.ipId] ?? "작품 정보 없음",
  }));
  const expiryTime = Date.parse(item.expiresAt);
  const daysLeft = Number.isFinite(expiryTime)
    ? Math.max(0, Math.ceil((expiryTime - Date.now()) / 86_400_000))
    : 7;
  const listingAccessibilityLabel = [
    item.title,
    ...productDetails.map(({ product, ipName: productIpName }, index) => (
      `등록 상품 ${index + 1}/${products.length}, ${productIpName}, ${product.name}, ${categoryLabel(product.category)}, ${catalogPriceLabel(product.price)}`
    )),
    `제안 ${item.offerCount}개`,
    `마감 D-${daysLeft}`,
    "교환 글 자세히 보기",
  ].join(". ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={listingAccessibilityLabel}
      onPress={() => router.push({ pathname: "/exchange/[listingId]", params: { listingId: item.id } })}
      style={({ pressed }) => [styles.listingCard, pressed && styles.pressed]}
    >
      <View style={styles.cardBody}>
        <View style={styles.cardHeadingRow}>
          <View style={styles.cardHeadingCopy}>
            <Text numberOfLines={1} style={styles.listingTitle}>{item.title}</Text>
          </View>
          <View style={styles.cardCategoryBadge}>
            <Text style={styles.cardCategoryLabel}>{products.length > 1 ? `상품 ${products.length}개` : categoryLabel(item.product.category)}</Text>
          </View>
        </View>
        <ProductInfoDivider style={styles.cardHeadingDivider} />
        <View style={styles.exchangePanel}>
          <View style={styles.bundleImages}>
            {productDetails.map(({ product }, index) => {
              const uri = resolveCatalogImageUrl(product.imageUrl, assetBaseUrl, product.version);
              return (
                <View
                  key={`${product.id}-${index}`}
                  accessible
                  accessibilityLabel={`등록 상품 ${index + 1}/${products.length}: ${product.name}`}
                  style={[styles.imageFrame, products.length > 1 && styles.imageFrameBundled]}
                >
                  {uri ? <Image source={{ uri }} style={styles.productImage} resizeMode="contain" /> : <MediaPlaceholder />}
                </View>
              );
            })}
          </View>
          <DecorativeIonicon name="swap-horizontal" size={24} color={seed.color.stroke.contrast} />
          <View style={styles.applyTile}>
            <Text style={styles.applyTileLabel}>교환 신청</Text>
            <Text style={styles.applyTileMeta}>제안 {item.offerCount}개</Text>
          </View>
        </View>
        <View style={styles.bundleInfoList}>
          {productDetails.map(({ product, ipName: productIpName }, index) => (
            <View key={`${product.id}-information-${index}`} style={styles.bundleInfoGroup}>
              {index > 0 ? <ProductInfoDivider style={styles.bundleItemDivider} /> : null}
              <View style={styles.bundleInfoItem}>
                <Text numberOfLines={1} style={styles.bundleIpName}>
                  {products.length > 1 ? `상품 ${index + 1}/${products.length} · ` : ""}
                  {productIpName} · {categoryLabel(product.category)}
                </Text>
                <Text numberOfLines={2} style={styles.bundleProductName}>
                  {productSubjectTitle(product.name, productIpName)}
                </Text>
                <ProductInfoDivider style={styles.bundleValueDivider} />
                <Text style={styles.bundleProductValue}>{catalogPriceLabel(product.price)}</Text>
              </View>
            </View>
          ))}
        </View>
        <View style={styles.cardFooter}>
          <Text style={styles.author}>@{item.authorNickname}</Text>
          <Text style={styles.offerCount}>D-{daysLeft}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function MediaPlaceholder() {
  return (
    <View style={styles.mediaPlaceholder}>
      <Text style={styles.mediaPlaceholderLabel}>이미지 준비 중</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  content: { paddingBottom: seed.spacing.screenBottom },
  primaryActions: { marginHorizontal: seed.spacing.globalGutter, marginTop: seed.spacing.x2_5, flexDirection: "row", gap: seed.spacing.x2_5 },
  createPrimary: { minHeight: 56, flex: 1.45, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.brandSolid, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: seed.spacing.x2 },
  createPrimaryLabel: { color: colors.ink, ...seed.typography.button, fontWeight: "900" },
  myExchangeButton: { minHeight: 56, flex: 1, borderRadius: seed.radius.r3, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.elevated, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: seed.spacing.x2 },
  myExchangeLabel: { color: colors.ink, ...seed.typography.button },
  searchBox: { marginHorizontal: seed.spacing.globalGutter, marginTop: seed.spacing.x2_5 },
  searchInput: { flex: 1, color: colors.ink, ...seed.typography.body, paddingVertical: seed.spacing.x3 },
  clearSearch: { width: seed.size.touchTarget, height: seed.size.touchTarget, marginRight: -seed.spacing.x2 },
  modalBackdrop: { flex: 1, paddingHorizontal: seed.spacing.globalGutter, justifyContent: "center", backgroundColor: "rgba(17, 20, 17, 0.48)" },
  modalCard: { width: "100%", maxWidth: 480, alignSelf: "center", borderRadius: seed.radius.r5, padding: seed.spacing.x5, backgroundColor: seed.color.layer.elevated, shadowColor: colors.black, shadowOpacity: 0.2, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 12 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x3 },
  modalBadge: { overflow: "hidden", borderRadius: seed.radius.r2, paddingHorizontal: seed.spacing.x2_5, paddingVertical: seed.spacing.x1_5, color: colors.greenInk, backgroundColor: seed.color.background.brandWeak, ...seed.typography.finePrint, fontWeight: "800" },
  modalRuleList: { marginTop: seed.spacing.x4, gap: seed.spacing.x3_5 },
  modalRuleRow: { flexDirection: "row", alignItems: "flex-start", gap: seed.spacing.x2_5 },
  modalRuleDot: { width: 7, height: 7, marginTop: 7, borderRadius: seed.radius.full, backgroundColor: colors.brand },
  modalRuleText: { flex: 1, maxWidth: "100%", color: colors.ink, fontSize: 14, lineHeight: 22, letterSpacing: -0.2 },
  dismissOption: { minHeight: seed.size.touchTarget, marginTop: seed.spacing.x4, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2_5 },
  checkbox: { width: 22, height: 22, borderRadius: seed.radius.r1, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default, alignItems: "center", justifyContent: "center" },
  checkboxChecked: { borderColor: colors.brand, backgroundColor: colors.brand },
  dismissOptionLabel: { color: colors.ink, fontSize: 14, lineHeight: 20, fontWeight: "700" },
  modalConfirm: { marginTop: seed.spacing.x2 },
  pressed: { opacity: seed.state.pressedOpacity, transform: [{ scale: seed.state.pressedScale }] },
  sectionHeader: { marginTop: seed.spacing.x4, marginBottom: seed.spacing.x3_5, paddingHorizontal: seed.spacing.globalGutter, ...subtleSectionHeaderRule, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: seed.spacing.componentDefault },
  sectionTitle: { flex: 1 },
  sectionCount: { paddingBottom: 3 },
  notice: { marginHorizontal: seed.spacing.globalGutter, marginBottom: seed.spacing.componentDefault, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.brandWeak, padding: seed.spacing.x3_5, flexDirection: "row", alignItems: "center", gap: seed.spacing.componentDefault },
  noticeError: { backgroundColor: seed.color.background.criticalWeak },
  noticeText: { flex: 1, color: colors.ink, fontSize: 13, lineHeight: 19 },
  retry: { minHeight: seed.size.touchTarget, justifyContent: "center", paddingHorizontal: seed.spacing.x3, borderRadius: seed.radius.r2_5, backgroundColor: colors.ink },
  retryLabel: { color: colors.white, fontSize: 12, fontWeight: "800" },
  loading: { paddingHorizontal: seed.spacing.globalGutter, paddingVertical: 58, alignItems: "center", gap: 12 },
  loadingText: { color: colors.muted, fontSize: 14 },
  list: { paddingHorizontal: seed.spacing.globalGutter, gap: seed.spacing.x3_5 },
  searchEmpty: { minHeight: 320, marginHorizontal: seed.spacing.globalGutter, paddingHorizontal: seed.spacing.x5, alignItems: "center", justifyContent: "center" },
  searchEmptyTitle: { marginTop: seed.spacing.x3_5, textAlign: "center" },
  searchEmptyBody: { marginTop: seed.spacing.x2, color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: "center" },
  listingCard: { padding: seed.spacing.x4, ...catalogProductCardSurface },
  bundleImages: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: seed.spacing.x1 },
  imageFrame: { width: 92, height: 92, ...catalogProductImageSurface },
  imageFrameBundled: { width: 56, height: 70 },
  productImage: { width: "100%", height: "100%" },
  cardHeadingRow: { flexDirection: "row", alignItems: "flex-start", gap: seed.spacing.x3 },
  cardHeadingCopy: { flex: 1, minWidth: 0 },
  cardCategoryBadge: { borderRadius: seed.radius.r2, paddingHorizontal: seed.spacing.x2, paddingVertical: seed.spacing.x1_5, backgroundColor: seed.color.background.brandWeak },
  cardCategoryLabel: { color: colors.ink, ...seed.typography.finePrint, fontWeight: "900" },
  cardBody: { minWidth: 0 },
  listingTitle: { color: colors.ink, fontSize: 16, lineHeight: 22, fontWeight: "900" },
  cardHeadingDivider: { marginTop: seed.spacing.x3 },
  exchangePanel: { marginTop: seed.spacing.x3, borderRadius: seed.radius.r4, backgroundColor: seed.color.background.neutralWeak, padding: seed.spacing.x3, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: seed.spacing.x3 },
  applyTile: { width: 104, height: 92, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.neutralSolid, alignItems: "center", justifyContent: "center" },
  applyTileLabel: { color: colors.white, ...seed.typography.bodyStrong },
  applyTileMeta: { marginTop: seed.spacing.x1, color: "#C9CEC9", ...seed.typography.caption },
  bundleInfoList: { marginTop: seed.spacing.x3 },
  bundleInfoGroup: { minWidth: 0 },
  bundleItemDivider: { marginVertical: seed.spacing.x2_5 },
  bundleInfoItem: { minWidth: 0 },
  bundleIpName: { color: colors.muted, ...seed.typography.catalogMetadata },
  bundleProductName: { marginTop: seed.spacing.x1, color: colors.ink, ...seed.typography.catalogTitle },
  bundleValueDivider: { marginTop: seed.spacing.x2 },
  bundleProductValue: { marginTop: seed.spacing.x1_5, color: colors.ink, ...seed.typography.catalogPrice },
  cardFooter: { marginTop: seed.spacing.x3, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  author: { flex: 1, color: colors.muted, fontSize: 11, fontWeight: "700" },
  offerCount: { color: colors.greenInk, fontSize: 11, fontWeight: "900" },
  mediaPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", padding: 12 },
  mediaPlaceholderLabel: { color: colors.muted, fontFamily: "monospace", ...seed.typography.finePrint, fontWeight: "800", textAlign: "center" },
});
