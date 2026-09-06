import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import type { CatalogProduct } from "@dabboba/contracts";
import { GachaMachineFrame } from "@/components/GachaMachineFrame";
import { KujiProductFrame } from "@/components/KujiProductFrame";
import { ProductInfoDivider } from "@/components/ProductInfoDivider";
import { KoreanPixelTitle, RootCategoryTitle } from "@/components/RootCategoryTitle";
import { RootHeaderActions } from "@/components/RootHeaderActions";
import {
  ROOT_NAVIGATION_CONTENT_INSET,
  useRootNavigationScroll,
} from "@/components/RootFloatingTabBar";
import { AppText as Text, AppTextInput as TextInput } from "@/components/Typography";
import { SeedActionButton, SeedChip, SeedIconButton, SeedInputShell } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import { PRODUCT_CATEGORY_OPTIONS } from "@/features/catalog/product-categories";
import {
  categoryLabel,
  fetchShopSnapshot,
  type ProductCategory,
  type ShopSnapshot,
} from "@/features/shop/shop-api";
import { productSubjectTitle } from "@/features/shop/product-title";
import {
  SHOP_SORT_OPTIONS,
  filterSoldOutProducts,
  sortShopProducts,
  type ShopSortOption,
} from "@/features/shop/shop-filter";
import {
  resolveCatalogImageUrl,
  resolveMobileRuntimeConfig,
  type MobilePlatform,
} from "@/lib/runtime-config";
import { colors } from "@/theme";

const FIXTURE_CONTENT_ASPECT_RATIOS: Readonly<Record<string, number>> = {
  "/assets/dabboba/products/ip/blue-lock.jpg": 1032 / 1200,
  "/assets/dabboba/products/ip/dandadan.jpg": 1035 / 1200,
  "/assets/dabboba/products/ip/demon-slayer.jpg": 1034 / 1200,
  "/assets/dabboba/products/ip/detective-conan.jpg": 1031 / 1200,
  "/assets/dabboba/products/ip/haikyu.jpg": 1039 / 1200,
  "/assets/dabboba/products/ip/jujutsu-kaisen.jpg": 489 / 560,
  "/assets/dabboba/products/ip/oshi-no-ko.jpg": 1035 / 1200,
  "/assets/dabboba/products/ip/pokemon.jpg": 328 / 658,
};

export function ShopScreen() {
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
  const [snapshot, setSnapshot] = useState<ShopSnapshot | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<ProductCategory>("gacha");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [excludeSoldOut, setExcludeSoldOut] = useState(false);
  const [sortOption, setSortOption] = useState<ShopSortOption>("latest");

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    else setLoading(true);
    try {
      setSnapshot(await fetchShopSnapshot(runtime.apiBaseUrl));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "상품을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [runtime.apiBaseUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const requestedIp = snapshot?.ips.find((ip) => ip.id === requestedIpId) ?? null;
  const ipNames = useMemo(
    () => new Map(snapshot?.ips.map((ip) => [ip.id, ip.nameKo]) ?? []),
    [snapshot?.ips],
  );
  const normalizedQuery = normalizeSearch(query);
  const visibleProducts = useMemo(() => {
    const matchingProducts = snapshot?.products.filter((product) => {
      if (product.category !== selectedCategory) return false;
      if (requestedIpId && product.ipId !== requestedIpId) return false;
      if (!normalizedQuery) return true;
      return normalizeSearch([
        product.name,
        product.sku,
        product.manufacturer ?? "",
        ipNames.get(product.ipId) ?? "",
      ].join(" ")).includes(normalizedQuery);
    }) ?? [];
    return sortShopProducts(filterSoldOutProducts(matchingProducts, excludeSoldOut), sortOption);
  }, [excludeSoldOut, ipNames, normalizedQuery, requestedIpId, selectedCategory, snapshot?.products, sortOption]);

  const openProduct = (product: CatalogProduct) => {
    router.push(`/product/${encodeURIComponent(product.id)}` as Href);
  };
  const isComingSoon = selectedCategory === "figure";

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <ScrollView
        {...rootNavigationScroll}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.ink} />}
      >
        <View style={styles.header}>
          <RootCategoryTitle>뽀바</RootCategoryTitle>
          <RootHeaderActions />
        </View>

        <SeedInputShell focused={searchFocused} variant="search" style={styles.searchBox}>
          <Ionicons name="search-outline" size={20} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => { setSearchFocused(false); Keyboard.dismiss(); }}
            placeholder="상품명·작품 검색"
            placeholderTextColor="#8D948C"
            returnKeyType="search"
            style={styles.searchInput}
            accessibilityLabel="뽀바 상품 검색"
          />
          {query ? (
            <SeedIconButton label="검색어 지우기" onPress={() => setQuery("")} style={styles.clearSearch}>
              <Ionicons name="close-circle" size={20} color={colors.muted} />
            </SeedIconButton>
          ) : null}
        </SeedInputShell>

        {requestedIp ? (
          <View style={styles.ipFilter}>
            <View style={styles.ipFilterCopy}>
              <Text numberOfLines={1} style={styles.ipFilterName}>{requestedIp.nameKo}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="작품 필터 해제"
              onPress={() => router.setParams({ ipId: undefined })}
              style={styles.clearFilter}
            >
              <Ionicons name="close" size={18} color={colors.ink} />
              <Text style={styles.clearFilterLabel}>해제</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.categoryToolbar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll} contentContainerStyle={styles.categoryRail}>
            {PRODUCT_CATEGORY_OPTIONS.map((category) => {
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="상품 필터 및 정렬 열기"
            accessibilityHint="품절 제외와 상품 정렬 방식을 선택합니다"
            hitSlop={4}
            onPress={() => { Keyboard.dismiss(); setFilterDrawerOpen(true); }}
            style={({ pressed }) => [
              styles.filterButton,
              (excludeSoldOut || sortOption !== "latest") && styles.filterButtonActive,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="options-outline" size={20} color={colors.ink} />
            {excludeSoldOut || sortOption !== "latest" ? <View style={styles.filterActiveDot} /> : null}
          </Pressable>
        </View>

        {isComingSoon ? (
          <View
            accessibilityLabel={`${categoryLabel(selectedCategory)} 준비 중`}
            style={styles.comingSoon}
          >
            <KoreanPixelTitle variant="hero">준비중입니다.</KoreanPixelTitle>
            <Text style={styles.comingSoonBody}>{categoryLabel(selectedCategory)} 상품을 준비하고 있어요.</Text>
          </View>
        ) : (
          <>
            {loading ? (
              <View style={styles.loading}><ActivityIndicator color={colors.ink} /><Text style={styles.loadingText}>상품을 불러오는 중</Text></View>
            ) : message ? (
              <View style={styles.empty}>
                <Ionicons name="alert-circle-outline" size={30} color={colors.muted} />
                <Text style={styles.emptyTitle}>{message}</Text>
                <Pressable accessibilityRole="button" onPress={() => void load(true)} style={styles.retryButton}><Text style={styles.retryLabel}>다시 불러오기</Text></Pressable>
              </View>
            ) : visibleProducts.length ? (
              <View style={styles.productGrid}>
                {visibleProducts.map((product, index) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    ipName={ipNames.get(product.ipId) ?? "등록 작품"}
                    assetBaseUrl={runtime.assetBaseUrl}
                    wide={selectedCategory === "kuji"}
                    divided={index < visibleProducts.length - 1}
                    onPress={() => openProduct(product)}
                  />
                ))}
              </View>
            ) : (
              <View style={styles.empty}>
                <Ionicons name="search-outline" size={30} color={colors.muted} />
                <Text style={styles.emptyTitle}>찾는 상품이 없어요</Text>
                <Text style={styles.emptyBody}>검색어나 작품 조건을 바꿔보세요.</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
      <ShopFilterDrawer
        visible={filterDrawerOpen}
        excludeSoldOut={excludeSoldOut}
        sortOption={sortOption}
        onExcludeSoldOutChange={setExcludeSoldOut}
        onSortOptionChange={setSortOption}
        onClose={() => setFilterDrawerOpen(false)}
      />
    </SafeAreaView>
  );
}

function ShopFilterDrawer({
  visible,
  excludeSoldOut,
  sortOption,
  onExcludeSoldOutChange,
  onSortOptionChange,
  onClose,
}: {
  visible: boolean;
  excludeSoldOut: boolean;
  sortOption: ShopSortOption;
  onExcludeSoldOutChange: (value: boolean) => void;
  onSortOptionChange: (value: ShopSortOption) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.drawerOverlay}>
        <Pressable accessibilityRole="button" accessibilityLabel="상품 필터 서랍 닫기" onPress={onClose} style={styles.drawerBackdrop} />
        <SafeAreaView edges={["bottom"]} style={styles.drawerSheet}>
          <View style={styles.drawerHandle} />
          <View style={styles.drawerHeader}>
            <KoreanPixelTitle variant="section">상품 보기</KoreanPixelTitle>
            <SeedIconButton label="상품 필터 서랍 닫기" onPress={onClose}>
              <Ionicons name="close" size={22} color={colors.ink} />
            </SeedIconButton>
          </View>

          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: excludeSoldOut }}
            onPress={() => onExcludeSoldOutChange(!excludeSoldOut)}
            style={({ pressed }) => [styles.drawerToggleRow, pressed && styles.drawerRowPressed]}
          >
            <View style={styles.drawerRowCopy}>
              <Text style={styles.drawerRowTitle}>품절 제외</Text>
              <Text style={styles.drawerRowBody}>재고가 남아 있는 상품만 보여드려요.</Text>
            </View>
            <View style={[styles.switchTrack, excludeSoldOut && styles.switchTrackActive]}>
              <View style={[styles.switchThumb, excludeSoldOut && styles.switchThumbActive]} />
            </View>
          </Pressable>

          <View style={styles.drawerDivider} />
          <Text style={styles.drawerSectionLabel}>정렬</Text>
          <View accessibilityRole="radiogroup">
            {SHOP_SORT_OPTIONS.map((option) => {
              const selected = sortOption === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected, checked: selected }}
                  onPress={() => onSortOptionChange(option.value)}
                  style={({ pressed }) => [styles.sortRow, pressed && styles.drawerRowPressed]}
                >
                  <Text style={[styles.sortLabel, selected && styles.sortLabelSelected]}>{option.label}</Text>
                  <Ionicons
                    name={selected ? "checkmark-circle" : "ellipse-outline"}
                    size={22}
                    color={selected ? colors.greenInk : seed.color.stroke.contrast}
                  />
                </Pressable>
              );
            })}
          </View>
          <SeedActionButton label="적용" onPress={onClose} style={styles.drawerApplyButton} />
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function ProductCard({
  product,
  ipName,
  assetBaseUrl,
  wide,
  divided,
  onPress,
}: {
  product: CatalogProduct;
  ipName: string;
  assetBaseUrl: string | null;
  wide: boolean;
  divided: boolean;
  onPress: () => void;
}) {
  const uri = resolveCatalogImageUrl(product.imageUrl, assetBaseUrl, product.version);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${product.name} 상세 보기`}
      onPress={onPress}
      style={({ pressed }) => [styles.productCard, wide && styles.kujiProductCard, pressed && styles.pressed]}
    >
      <AdaptiveProductMedia uri={uri} category={product.category} />
      <Text numberOfLines={1} style={styles.productIp}>{ipName}</Text>
      <Text numberOfLines={2} style={styles.productName}>{productSubjectTitle(product.name, ipName)}</Text>
      <ProductInfoDivider style={styles.productFieldDivider} />
      <View style={styles.productMeta}>
        <Text style={styles.productPrice}>{product.price.toLocaleString("ko-KR")}원</Text>
        <Text style={styles.productStock}>{product.availableQuantity}개</Text>
      </View>
      {divided ? <ProductInfoDivider style={styles.productBoundaryDivider} /> : null}
    </Pressable>
  );
}

function AdaptiveProductMedia({
  uri,
  category,
}: {
  uri: string | null;
  category: ProductCategory;
}) {
  const [imageAspectRatio, setImageAspectRatio] = useState(1);

  useEffect(() => {
    let active = true;
    setImageAspectRatio(1);
    if (!uri) return () => { active = false; };

    Image.getSize(
      uri,
      (width, height) => {
        if (active && width > 0 && height > 0) {
          setImageAspectRatio(displayProductAspectRatio(uri, width, height));
        }
      },
      () => undefined,
    );
    return () => { active = false; };
  }, [uri]);

  return (
    <GachaMachineFrame category={category}>
      <KujiProductFrame category={category}>
        <View style={[styles.productImageFrame, category === "gacha" && styles.gachaMachineMediaWindow, { aspectRatio: imageAspectRatio }]}>
          {uri ? (
            <Image
              source={{ uri }}
              resizeMode="cover"
              style={styles.productImage}
              onLoad={({ nativeEvent }) => {
                const { width, height } = nativeEvent.source;
                if (width > 0 && height > 0) {
                  setImageAspectRatio(displayProductAspectRatio(uri, width, height));
                }
              }}
            />
          ) : <MediaPlaceholder />}
          {category !== "gacha" ? <View style={styles.categoryBadge}><Text style={styles.categoryBadgeLabel}>{categoryLabel(category)}</Text></View> : null}
        </View>
      </KujiProductFrame>
    </GachaMachineFrame>
  );
}

function MediaPlaceholder() {
  return <View style={styles.mediaPlaceholder}><Text style={styles.mediaPlaceholderLabel}>이미지 준비 중</Text></View>;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeSearch(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ko-KR").replace(/\s+/g, " ");
}

function displayProductAspectRatio(uri: string, width: number, height: number): number {
  const sourcePath = uri.split("?", 1)[0] ?? uri;
  const fixtureRatio = Object.entries(FIXTURE_CONTENT_ASPECT_RATIOS)
    .find(([path]) => sourcePath.endsWith(path))?.[1];
  return fixtureRatio ?? width / height;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  content: { paddingBottom: ROOT_NAVIGATION_CONTENT_INSET },
  header: { minHeight: seed.size.topNavigation, paddingHorizontal: seed.spacing.globalGutter, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral },
  searchBox: { marginHorizontal: seed.spacing.globalGutter, marginTop: seed.spacing.x3_5 },
  searchInput: { flex: 1, color: colors.ink, fontSize: 15, paddingVertical: 12 },
  clearSearch: { width: seed.size.touchTarget, height: seed.size.touchTarget, marginRight: -seed.spacing.x2 },
  ipFilter: { marginHorizontal: seed.spacing.globalGutter, marginTop: seed.spacing.componentDefault, padding: seed.spacing.x3_5, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.brandWeak, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.componentDefault },
  ipFilterCopy: { flex: 1 },
  ipFilterName: { color: colors.ink, fontSize: 15, fontWeight: "900" },
  clearFilter: { minHeight: seed.size.touchTarget, paddingHorizontal: seed.spacing.x2_5, flexDirection: "row", alignItems: "center", gap: seed.spacing.x0_5, borderRadius: seed.radius.r2, backgroundColor: seed.color.layer.default },
  clearFilterLabel: { color: colors.ink, fontSize: 12, fontWeight: "800" },
  categoryToolbar: { marginTop: seed.spacing.x4_5, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2, paddingRight: seed.spacing.globalGutter },
  categoryScroll: { flex: 1 },
  categoryRail: { paddingLeft: seed.spacing.globalGutter, gap: seed.spacing.betweenChips },
  filterButton: { width: 40, minHeight: seed.size.chip, borderWidth: 1, borderRadius: seed.radius.r2, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default, alignItems: "center", justifyContent: "center" },
  filterButtonActive: { borderColor: seed.color.stroke.brand, backgroundColor: seed.color.background.brandWeak },
  filterActiveDot: { position: "absolute", top: 5, right: 5, width: 5, height: 5, borderRadius: 3, backgroundColor: colors.greenInk },
  comingSoon: { minHeight: 320, marginTop: seed.spacing.x7, paddingHorizontal: seed.spacing.globalGutter, alignItems: "center", justifyContent: "center" },
  comingSoonBody: { marginTop: seed.spacing.x3_5, color: colors.muted, fontSize: 14, lineHeight: 21, textAlign: "center" },
  loading: { paddingHorizontal: seed.spacing.globalGutter, paddingVertical: 70, alignItems: "center", gap: 12 },
  loadingText: { color: colors.muted, fontSize: 14 },
  productGrid: { marginTop: seed.spacing.x7, paddingHorizontal: seed.spacing.globalGutter, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: seed.spacing.x6 },
  productCard: { width: "48%", paddingBottom: seed.spacing.x3 },
  kujiProductCard: { width: "100%" },
  productImageFrame: { width: "100%", borderRadius: seed.radius.r4, overflow: "hidden" },
  gachaMachineMediaWindow: { borderRadius: 0 },
  productImage: { width: "100%", height: "100%" },
  categoryBadge: { position: "absolute", top: 9, left: 9, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 7, backgroundColor: colors.brand },
  categoryBadgeLabel: { color: colors.ink, fontSize: 11, fontWeight: "900" },
  productIp: { color: colors.muted, fontSize: 11, marginTop: 9 },
  productName: { minHeight: 40, color: colors.ink, fontSize: 14, lineHeight: 20, fontWeight: "800", marginTop: 3 },
  productFieldDivider: { marginTop: seed.spacing.x2 },
  productMeta: { marginTop: 6, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  productPrice: { flexShrink: 1, color: colors.ink, fontSize: 15, fontWeight: "900" },
  productStock: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  productBoundaryDivider: { position: "absolute", right: 0, bottom: 0, left: 0 },
  mediaPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", padding: 14, backgroundColor: "#EEF0EA" },
  mediaPlaceholderLabel: { color: colors.muted, fontFamily: "monospace", fontSize: 9, fontWeight: "700", textAlign: "center" },
  empty: { marginHorizontal: seed.spacing.globalGutter, paddingVertical: seed.spacing.x14, paddingHorizontal: seed.spacing.x5, alignItems: "center", borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  emptyTitle: { color: colors.ink, fontSize: 16, fontWeight: "900", textAlign: "center", marginTop: 12 },
  emptyBody: { color: colors.muted, fontSize: 13, textAlign: "center", marginTop: 6 },
  retryButton: { minHeight: 42, justifyContent: "center", paddingHorizontal: 16, marginTop: 15, borderRadius: 10, backgroundColor: colors.ink },
  retryLabel: { color: colors.white, fontSize: 13, fontWeight: "800" },
  drawerOverlay: { flex: 1, justifyContent: "flex-end" },
  drawerBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(7, 16, 11, 0.42)" },
  drawerSheet: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x2, borderTopLeftRadius: seed.radius.r6, borderTopRightRadius: seed.radius.r6, backgroundColor: seed.color.layer.elevated },
  drawerHandle: { alignSelf: "center", width: 38, height: 4, marginBottom: seed.spacing.x2, borderRadius: 2, backgroundColor: seed.color.stroke.contrast },
  drawerHeader: { minHeight: seed.size.topNavigation, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  drawerToggleRow: { minHeight: 70, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x4, paddingVertical: seed.spacing.x3 },
  drawerRowCopy: { flex: 1 },
  drawerRowTitle: { color: colors.ink, fontSize: 15, fontWeight: "900" },
  drawerRowBody: { marginTop: 3, color: colors.muted, fontSize: 12, lineHeight: 18 },
  switchTrack: { width: 46, height: 28, padding: 3, borderRadius: 14, backgroundColor: seed.color.background.neutralWeak },
  switchTrackActive: { backgroundColor: colors.brand },
  switchThumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.white, shadowColor: colors.black, shadowOpacity: 0.14, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  switchThumbActive: { transform: [{ translateX: 18 }] },
  drawerDivider: { height: StyleSheet.hairlineWidth, backgroundColor: seed.color.stroke.neutral },
  drawerSectionLabel: { marginTop: seed.spacing.x4, marginBottom: seed.spacing.x2, color: colors.muted, fontSize: 12, fontWeight: "800" },
  sortRow: { minHeight: seed.size.touchTarget, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sortLabel: { color: colors.ink, fontSize: 15, fontWeight: "700" },
  sortLabelSelected: { color: colors.greenInk, fontWeight: "900" },
  drawerRowPressed: { backgroundColor: seed.color.background.transparentPressed },
  drawerApplyButton: { marginTop: seed.spacing.x4, marginBottom: seed.spacing.x2 },
  pressed: { opacity: seed.state.pressedOpacity },
});
