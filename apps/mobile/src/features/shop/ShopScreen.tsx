import Constants from "expo-constants";
import { type Href, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import type { CatalogIp, CatalogProduct } from "@dabboba/contracts";
import { DecorativeIonicon } from "@/components/DecorativeIonicon";
import { CatalogDiscoveryImage } from "@/components/CatalogDiscoveryImage";
import { CatalogProductTopIndicator } from "@/components/CatalogProductTopIndicator";
import { GachaMachineFrame } from "@/components/GachaMachineFrame";
import { KujiPrizeTierRow } from "@/components/KujiPrizeTierRow";
import { KujiProductFrame } from "@/components/KujiProductFrame";
import { RemainingInventoryMeter } from "@/components/RemainingInventoryMeter";
import { KoreanPixelTitle, RootCategoryTitle } from "@/components/RootCategoryTitle";
import { RootPageHeader, RootPageScaffold } from "@/components/RootPageHeader";
import {
  ROOT_NAVIGATION_CONTENT_INSET,
  useRootNavigationScroll,
} from "@/components/RootFloatingTabBar";
import { AppText as Text, AppTextInput as TextInput } from "@/components/Typography";
import { SeedActionButton, SeedIconButton, SeedInputShell } from "@/design-system/components";
import {
  CATALOG_CARD_TEXT_MAX_FONT_SIZE_MULTIPLIER,
  catalogProductCardSurface,
} from "@/design-system/catalog";
import { seed } from "@/design-system/seed";
import { CategoryAvailabilityState } from "@/features/catalog/CategoryAvailabilityState";
import { useStorefrontCategorySettings } from "@/features/catalog/StorefrontCategorySettingsProvider";
import { useCommerceCapability } from "@/features/commerce/CommerceCapabilityProvider";
import { productPriceLabel, productPriceParts } from "@/features/commerce/product-commerce-presentation";
import {
  isCustomerProductCategoryComingSoon,
  isCustomerProductCategoryEnabledOn,
} from "@/features/catalog/product-categories";
import { catalogQuantityLabel, remainingInventoryLabel, shouldShowCatalogInventory } from "@/features/catalog/remaining-inventory";
import { remainingKujiTierAccessibilityLabel } from "@/features/kuji/kuji-tier-availability";
import {
  categoryLabel,
  fetchShopIps,
  fetchShopProductPage,
  type ProductCategory,
} from "@/features/shop/shop-api";
import { catalogCardTitle, productSubjectTitle } from "@/features/shop/product-title";
import {
  SHOP_SORT_OPTIONS,
  type ShopSortOption,
} from "@/features/shop/shop-filter";
import { resolveTwoColumnProductCardWidth } from "@/features/shop/shop-layout";
import {
  resolveCatalogImageUrl,
  resolveMobileRuntimeConfig,
  type MobilePlatform,
} from "@/lib/runtime-config";
import { colors } from "@/theme";

type ShopRootCategory = Extract<ProductCategory, "gacha" | "kuji">;

export function ShopScreen({ category }: { category: ShopRootCategory }) {
  const rootNavigationScroll = useRootNavigationScroll();
  const router = useRouter();
  const { width: viewportWidth, fontScale } = useWindowDimensions();
  const safeAreaInsets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ ipId?: string | string[] }>();
  const requestedIpId = firstParam(params.ipId);
  const { revision: categorySettingsRevision, refresh: refreshCategorySettings } = useStorefrontCategorySettings();
  const { commerceEnabled } = useCommerceCapability();
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
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [ips, setIps] = useState<CatalogIp[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [imageRequestKey, setImageRequestKey] = useState(0);
  const [message, setMessage] = useState("");
  const [loadMoreMessage, setLoadMoreMessage] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [excludeSoldOut, setExcludeSoldOut] = useState(false);
  const [sortOption, setSortOption] = useState<ShopSortOption>("latest");
  const [focusRevision, setFocusRevision] = useState(0);
  const requestSequence = useRef(0);

  const catalogEnabled = isCustomerProductCategoryEnabledOn(category, "catalog");
  const prelaunchKuji = category === "kuji" && !commerceEnabled;
  const isComingSoon = prelaunchKuji || isCustomerProductCategoryComingSoon(category);

  const loadIps = useCallback(async () => {
    try {
      setIps(await fetchShopIps(runtime.apiBaseUrl));
    } catch {
      // 작품명 보조 정보 실패가 상품 목록을 가로막지 않게 한다.
    }
  }, [runtime.apiBaseUrl]);

  const loadProducts = useCallback(async ({
    cursor,
    manual = false,
  }: {
    cursor?: string;
    manual?: boolean;
  } = {}) => {
    if (!catalogEnabled || isComingSoon) {
      setProducts([]);
      setNextCursor(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const append = Boolean(cursor);
    const sequence = ++requestSequence.current;
    if (manual) {
      setRefreshing(true);
      setImageRequestKey((current) => current + 1);
    } else if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setProducts([]);
      setNextCursor(null);
    }
    if (!append) setLoadMoreMessage("");
    try {
      const page = await fetchShopProductPage(runtime.apiBaseUrl, {
        category,
        query,
        ipId: requestedIpId,
        sort: sortOption,
        excludeSoldOut,
        cursor,
        limit: 20,
      });
      if (sequence !== requestSequence.current) return;
      setProducts((current) => append
        ? mergeUniqueProducts(current, page.products)
        : page.products);
      setNextCursor(page.nextCursor);
      setMessage("");
      setLoadMoreMessage("");
    } catch {
      if (sequence !== requestSequence.current) return;
      if (append) setLoadMoreMessage("다음 상품을 불러오지 못했어요.");
      else setMessage("연결 상태를 확인한 뒤 다시 시도해 주세요.");
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
    }
  }, [catalogEnabled, category, excludeSoldOut, isComingSoon, query, requestedIpId, runtime.apiBaseUrl, sortOption]);

  useFocusEffect(useCallback(() => {
    setFocusRevision((current) => current + 1);
    void loadIps();
    return undefined;
  }, [loadIps]));

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadProducts();
    }, query.trim() ? 300 : 0);
    return () => clearTimeout(timer);
  }, [categorySettingsRevision, focusRevision, loadProducts]);

  const requestedIp = ips.find((ip) => ip.id === requestedIpId) ?? null;
  const ipNames = useMemo(
    () => new Map(ips.map((ip) => [ip.id, ip.nameKo])),
    [ips],
  );
  const normalizedQuery = normalizeSearch(query);
  const hasSearchConditions = Boolean(normalizedQuery || requestedIpId || excludeSoldOut);
  const gachaProductCardWidth = resolveTwoColumnProductCardWidth({
    viewportWidth,
    horizontalSafeArea: safeAreaInsets.left + safeAreaInsets.right,
    horizontalGutter: seed.spacing.globalGutter,
    columnGap: seed.spacing.componentDefault,
  });

  const resetSearchConditions = () => {
    Keyboard.dismiss();
    setSearchFocused(false);
    setQuery("");
    setExcludeSoldOut(false);
    router.setParams({ ipId: undefined });
  };

  const openProduct = (product: CatalogProduct) => {
    router.push(`/product/${encodeURIComponent(product.id)}` as Href);
  };
  const shopTitle = `${categoryLabel(category)}샵`;
  const refresh = async () => {
    void refreshCategorySettings();
    void loadIps();
    await loadProducts({ manual: true });
  };

  const listHeader = prelaunchKuji ? null : (
    <>
      <View style={styles.searchToolbar}>
        <SeedInputShell focused={searchFocused} variant="search" style={styles.searchBox}>
          <DecorativeIonicon name="search-outline" size={20} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => { setSearchFocused(false); Keyboard.dismiss(); }}
            placeholder="상품명·작품 검색"
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            style={styles.searchInput}
            accessibilityLabel={`${shopTitle} 상품 검색`}
          />
          {query ? (
            <SeedIconButton label="검색어 지우기" onPress={() => setQuery("")} style={styles.clearSearch}>
              <DecorativeIonicon name="close-circle" size={20} color={colors.muted} />
            </SeedIconButton>
          ) : null}
        </SeedInputShell>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="상품 필터 및 정렬 열기"
          accessibilityHint={commerceEnabled ? "품절 제외와 상품 정렬 방식을 선택합니다" : "상품 정렬 방식을 선택합니다"}
          accessibilityValue={{ text: excludeSoldOut || sortOption !== "latest" ? "필터 적용됨" : "기본 필터" }}
          hitSlop={4}
          onPress={() => { Keyboard.dismiss(); setFilterDrawerOpen(true); }}
          style={({ pressed }) => [
            styles.filterButton,
            (excludeSoldOut || sortOption !== "latest") && styles.filterButtonActive,
            pressed && styles.pressed,
          ]}
        >
          <DecorativeIonicon name="options-outline" size={20} color={colors.ink} />
          {excludeSoldOut || sortOption !== "latest" ? <View style={styles.filterActiveDot} /> : null}
        </Pressable>
      </View>

      {requestedIp ? (
        <View style={styles.ipFilter}>
          <View style={styles.ipFilterCopy}>
            <Text variant="subheading" numberOfLines={1} style={styles.ipFilterName}>{requestedIp.nameKo}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="작품 필터 해제"
            onPress={() => router.setParams({ ipId: undefined })}
            style={({ pressed }) => [styles.clearFilter, pressed && styles.pressed]}
          >
            <DecorativeIonicon name="close" size={18} color={colors.ink} />
            <Text variant="caption" style={styles.clearFilterLabel}>해제</Text>
          </Pressable>
        </View>
      ) : null}
      {message && products.length > 0 && !loading && !refreshing ? (
        <View style={styles.refreshFailure} accessibilityLiveRegion="polite">
          <Text variant="caption" style={styles.refreshFailureText}>
            {commerceEnabled
              ? "목록을 갱신하지 못했어요. 표시된 가격·재고가 최신이 아닐 수 있습니다."
              : "목록을 갱신하지 못했어요. 표시된 예정가가 최신이 아닐 수 있습니다."}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="상품 목록 다시 불러오기"
            onPress={() => void loadProducts({ manual: true })}
            style={({ pressed }) => [styles.refreshFailureRetry, pressed && styles.pressed]}
          >
            <Text variant="button" style={styles.refreshFailureRetryText}>다시 시도</Text>
          </Pressable>
        </View>
      ) : null}
      {loading && products.length ? (
        <View accessible accessibilityRole="progressbar" accessibilityLabel="상품 목록 갱신 중" style={styles.inlineLoading}>
          <ActivityIndicator size="small" color={colors.ink} />
        </View>
      ) : null}
      {products.length ? <View style={styles.productGridTopSpacer} /> : null}
    </>
  );

  const listEmpty = isComingSoon || !catalogEnabled ? (
    <CategoryAvailabilityState category={category} style={styles.comingSoon} />
  ) : loading ? (
    <View style={styles.loading}><ActivityIndicator color={colors.ink} /><Text variant="body" style={styles.loadingText}>상품을 불러오는 중</Text></View>
  ) : message ? (
    <View style={styles.empty}>
      <DecorativeIonicon name="alert-circle-outline" size={30} color={colors.muted} />
      <KoreanPixelTitle variant="section" numberOfLines={fontScale > 1.35 ? 4 : 2}>상품을 불러오지 못했어요</KoreanPixelTitle>
      <Text variant="bodyCompact" style={styles.emptyBody}>{message}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="상품 다시 불러오기" onPress={() => void loadProducts({ manual: true })} style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
        <Text variant="button" style={styles.retryLabel}>다시 불러오기</Text>
      </Pressable>
    </View>
  ) : hasSearchConditions ? (
    <View style={styles.empty}>
      <DecorativeIonicon name="search-outline" size={30} color={colors.muted} />
      <KoreanPixelTitle variant="section" numberOfLines={fontScale > 1.35 ? 4 : 2}>검색 결과가 없어요</KoreanPixelTitle>
      <Text variant="bodyCompact" style={styles.emptyBody}>검색어나 작품·품절 조건을 바꿔보세요.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="상품 검색 조건 초기화" onPress={resetSearchConditions} style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
        <Text variant="button" style={styles.retryLabel}>검색 조건 초기화</Text>
      </Pressable>
    </View>
  ) : (
    <View style={styles.empty}>
      <DecorativeIonicon name="cube-outline" size={30} color={colors.muted} />
      <KoreanPixelTitle variant="section" numberOfLines={fontScale > 1.35 ? 4 : 2}>상품을 준비 중이에요.</KoreanPixelTitle>
      <Text variant="bodyCompact" style={styles.emptyBody}>곧 새로운 상품을 보여드릴게요.</Text>
    </View>
  );

  const listFooter = loadingMore ? (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="다음 상품 불러오는 중" style={styles.listFooter}>
      <ActivityIndicator color={colors.ink} />
    </View>
  ) : loadMoreMessage ? (
    <View style={styles.listFooter}>
      <Text variant="caption" style={styles.loadingText}>{loadMoreMessage}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="다음 상품 다시 불러오기" onPress={() => nextCursor && void loadProducts({ cursor: nextCursor })} style={({ pressed }) => [styles.loadMoreRetry, pressed && styles.pressed]}>
        <Text variant="button" style={styles.retryLabel}>다시 시도</Text>
      </Pressable>
    </View>
  ) : null;

  return (
    <RootPageScaffold
      header={(
        <RootPageHeader>
          <RootCategoryTitle>{shopTitle}</RootCategoryTitle>
        </RootPageHeader>
      )}
    >
      <FlatList
        {...rootNavigationScroll}
        data={isComingSoon || !catalogEnabled ? [] : products}
        keyExtractor={(product) => product.id}
        key={`shop-${category}`}
        numColumns={category === "gacha" ? 2 : 1}
        columnWrapperStyle={category === "gacha" ? styles.gachaColumn : undefined}
        renderItem={({ item: product }) => (
          <View style={category === "kuji" ? styles.kujiListItem : undefined}>
            <ProductCard
              product={product}
              ipName={ipNames.get(product.ipId) ?? "등록 작품"}
              assetBaseUrl={runtime.assetBaseUrl}
              imageRequestKey={imageRequestKey}
              wide={category === "kuji"}
              cardWidth={gachaProductCardWidth}
              commerceEnabled={commerceEnabled}
              onPress={() => openProduct(product)}
            />
          </View>
        )}
        ItemSeparatorComponent={() => <View style={category === "kuji" ? styles.kujiRowGap : styles.gachaRowGap} />}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        ListFooterComponent={listFooter}
        onEndReached={() => {
          if (nextCursor && !loading && !loadingMore && !loadMoreMessage) {
            void loadProducts({ cursor: nextCursor });
          }
        }}
        onEndReachedThreshold={0.45}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.ink} />}
      />
      <ShopFilterDrawer
        visible={filterDrawerOpen}
        showStockFilter={commerceEnabled}
        excludeSoldOut={excludeSoldOut}
        sortOption={sortOption}
        onApply={(next) => {
          setExcludeSoldOut(next.excludeSoldOut);
          setSortOption(next.sortOption);
          setFilterDrawerOpen(false);
        }}
        onClose={() => setFilterDrawerOpen(false)}
      />
    </RootPageScaffold>
  );
}

function ShopFilterDrawer({
  visible,
  showStockFilter,
  excludeSoldOut,
  sortOption,
  onApply,
  onClose,
}: {
  visible: boolean;
  showStockFilter: boolean;
  excludeSoldOut: boolean;
  sortOption: ShopSortOption;
  onApply: (value: { excludeSoldOut: boolean; sortOption: ShopSortOption }) => void;
  onClose: () => void;
}) {
  const [draftExcludeSoldOut, setDraftExcludeSoldOut] = useState(excludeSoldOut);
  const [draftSortOption, setDraftSortOption] = useState(sortOption);

  useEffect(() => {
    if (!visible) return;
    setDraftExcludeSoldOut(excludeSoldOut);
    setDraftSortOption(sortOption);
  }, [excludeSoldOut, sortOption, visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View accessibilityViewIsModal style={styles.drawerOverlay}>
        <Pressable accessibilityRole="button" accessibilityLabel="상품 필터 서랍 닫기" onPress={onClose} style={styles.drawerBackdrop} />
        <SafeAreaView edges={["bottom"]} style={styles.drawerSheet}>
          <View style={styles.drawerHandle} />
          <View style={styles.drawerHeader}>
            <KoreanPixelTitle variant="section">상품 보기</KoreanPixelTitle>
            <SeedIconButton label="상품 필터 서랍 닫기" onPress={onClose}>
              <DecorativeIonicon name="close" size={22} color={colors.ink} />
            </SeedIconButton>
          </View>

          {showStockFilter ? (
            <>
              <Pressable
                accessibilityRole="switch"
                accessibilityLabel="품절 상품 제외"
                accessibilityState={{ checked: draftExcludeSoldOut }}
                onPress={() => setDraftExcludeSoldOut((current) => !current)}
                style={({ pressed }) => [styles.drawerToggleRow, pressed && styles.drawerRowPressed]}
              >
                <View style={styles.drawerRowCopy}>
                  <Text variant="subheading" style={styles.drawerRowTitle}>품절 제외</Text>
                  <Text variant="caption" style={styles.drawerRowBody}>재고가 남아 있는 상품만 보여드려요.</Text>
                </View>
                <View style={[styles.switchTrack, draftExcludeSoldOut && styles.switchTrackActive]}>
                  <View style={[styles.switchThumb, draftExcludeSoldOut && styles.switchThumbActive]} />
                </View>
              </Pressable>
              <View style={styles.drawerDivider} />
            </>
          ) : null}
          <Text variant="caption" style={styles.drawerSectionLabel}>정렬</Text>
          <View accessibilityRole="radiogroup">
            {SHOP_SORT_OPTIONS.map((option) => {
              const selected = draftSortOption === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityLabel={`${option.label} 정렬`}
                  accessibilityState={{ selected, checked: selected }}
                  onPress={() => setDraftSortOption(option.value)}
                  style={({ pressed }) => [styles.sortRow, pressed && styles.drawerRowPressed]}
                >
                  <Text variant="body" style={[styles.sortLabel, selected && styles.sortLabelSelected]}>{option.label}</Text>
                  <DecorativeIonicon
                    name={selected ? "checkmark-circle" : "ellipse-outline"}
                    size={22}
                    color={selected ? colors.greenInk : seed.color.stroke.contrast}
                  />
                </Pressable>
              );
            })}
          </View>
          <SeedActionButton
            label="적용"
            onPress={() => onApply({
              excludeSoldOut: showStockFilter && draftExcludeSoldOut,
              sortOption: draftSortOption,
            })}
            style={styles.drawerApplyButton}
          />
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function ProductCard({
  product,
  ipName,
  assetBaseUrl,
  imageRequestKey,
  wide,
  cardWidth,
  commerceEnabled,
  onPress,
}: {
  product: CatalogProduct;
  ipName: string;
  assetBaseUrl: string | null;
  imageRequestKey: number;
  wide: boolean;
  cardWidth: number;
  commerceEnabled: boolean;
  onPress: () => void;
}) {
  const storefrontUri = resolveCatalogImageUrl(product.storefrontImageUrl, assetBaseUrl, product.version);
  const primaryUri = resolveCatalogImageUrl(product.imageUrl, assetBaseUrl, product.version);
  const tierAccessibilityLabel = product.category === "kuji"
    ? remainingKujiTierAccessibilityLabel(product.remainingKujiTiers)
    : null;
  const price = productPriceParts(product, commerceEnabled);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[
        `${categoryLabel(product.category)} 상품`,
        ipName,
        product.name,
        productPriceLabel(product, commerceEnabled),
        shouldShowCatalogInventory(product, commerceEnabled)
          ? `${remainingInventoryLabel(product.category)} ${catalogQuantityLabel(product)}`
          : null,
        shouldShowCatalogInventory(product, commerceEnabled) ? tierAccessibilityLabel : null,
        "상세 보기",
      ].filter(Boolean).join(", ")}
      onPress={onPress}
      style={({ pressed }) => [
        styles.productCard,
        wide ? styles.kujiProductCard : { width: cardWidth },
        pressed && styles.pressed,
      ]}
    >
      <CatalogProductTopIndicator category={product.category} />
      <AdaptiveProductMedia
        storefrontUri={storefrontUri}
        primaryUri={primaryUri}
        imageRequestKey={imageRequestKey}
        category={product.category}
      />
      <View style={[styles.productCardBody, wide && styles.kujiProductCardBody]}>
        {wide ? (
          <Text variant="catalogMetadata" maxFontSizeMultiplier={CATALOG_CARD_TEXT_MAX_FONT_SIZE_MULTIPLIER} numberOfLines={1} style={styles.productIp}>{ipName}</Text>
        ) : null}
        <Text
          variant={wide ? "catalogTitleWide" : "catalogTitle"}
          maxFontSizeMultiplier={CATALOG_CARD_TEXT_MAX_FONT_SIZE_MULTIPLIER}
          numberOfLines={2}
          style={[styles.productName, !wide && styles.gachaProductName, wide && styles.kujiProductName]}
        >
          {wide ? productSubjectTitle(product.name, ipName) : catalogCardTitle(product.name, ipName)}
        </Text>
        <View style={[styles.productMeta, wide && styles.kujiProductMeta]}>
          {price.qualifier ? (
            <Text variant="catalogMetadata" maxFontSizeMultiplier={CATALOG_CARD_TEXT_MAX_FONT_SIZE_MULTIPLIER} numberOfLines={1} style={styles.productPriceQualifier}>예정가</Text>
          ) : null}
          <Text variant="catalogPrice" maxFontSizeMultiplier={CATALOG_CARD_TEXT_MAX_FONT_SIZE_MULTIPLIER} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={styles.productPrice}>{price.amount}</Text>
        </View>
        {product.category === "kuji" && shouldShowCatalogInventory(product, commerceEnabled) ? (
          <KujiPrizeTierRow tiers={product.remainingKujiTiers} style={styles.kujiPrizeTiers} />
        ) : null}
        {shouldShowCatalogInventory(product, commerceEnabled) ? (
          <RemainingInventoryMeter
            category={product.category}
            availableQuantity={product.availableQuantity}
            totalQuantity={product.totalQuantity}
            compact
            style={[styles.productInventory, wide && styles.kujiProductInventory]}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

function AdaptiveProductMedia({
  storefrontUri,
  primaryUri,
  imageRequestKey,
  category,
}: {
  storefrontUri: string | null;
  primaryUri: string | null;
  imageRequestKey: number;
  category: ProductCategory;
}) {
  return (
    <GachaMachineFrame category={category} clean>
      <KujiProductFrame category={category} clean>
        <View style={[
          styles.productImageFrame,
          category === "kuji" ? styles.kujiProductImageFrame : styles.gachaProductImageFrame,
        ]}>
          <CatalogDiscoveryImage
            storefrontUri={storefrontUri}
            primaryUri={primaryUri}
            requestKey={imageRequestKey}
            targetAspectRatio={category === "kuji" ? 7 / 4 : 8 / 7}
          />
        </View>
      </KujiProductFrame>
    </GachaMachineFrame>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeSearch(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ko-KR").replace(/\s+/g, " ");
}

function mergeUniqueProducts(
  current: readonly CatalogProduct[],
  incoming: readonly CatalogProduct[],
): CatalogProduct[] {
  const byId = new Map(current.map((product) => [product.id, product]));
  for (const product of incoming) byId.set(product.id, product);
  return [...byId.values()];
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingBottom: ROOT_NAVIGATION_CONTENT_INSET },
  searchToolbar: { marginHorizontal: seed.spacing.globalGutter, marginTop: seed.spacing.x3_5, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2 },
  searchBox: { flex: 1, minWidth: 0 },
  searchInput: { flex: 1, color: colors.ink, paddingVertical: 12 },
  clearSearch: { width: seed.size.touchTarget, height: seed.size.touchTarget, marginRight: -seed.spacing.x2 },
  ipFilter: { marginHorizontal: seed.spacing.globalGutter, marginTop: seed.spacing.componentDefault, padding: seed.spacing.x3_5, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.brandWeak, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.componentDefault },
  ipFilterCopy: { flex: 1 },
  ipFilterName: { color: colors.ink, fontWeight: "700" },
  clearFilter: { minHeight: seed.size.touchTarget, paddingHorizontal: seed.spacing.x2_5, flexDirection: "row", alignItems: "center", gap: seed.spacing.x0_5, borderRadius: seed.radius.r2, backgroundColor: seed.color.layer.default },
  clearFilterLabel: { color: colors.ink, fontWeight: "700" },
  filterButton: { width: seed.size.input, height: seed.size.input, minHeight: seed.size.touchTarget, borderWidth: 1, borderRadius: seed.radius.r2, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default, alignItems: "center", justifyContent: "center" },
  filterButtonActive: { borderColor: seed.color.stroke.brand, backgroundColor: seed.color.background.brandWeak },
  filterActiveDot: { position: "absolute", top: 5, right: 5, width: 5, height: 5, borderRadius: seed.radius.full, backgroundColor: colors.greenInk },
  comingSoon: { marginTop: seed.spacing.x7 },
  loading: { paddingHorizontal: seed.spacing.globalGutter, paddingVertical: 70, alignItems: "center", gap: 12 },
  loadingText: { color: colors.muted },
  inlineLoading: { minHeight: seed.size.touchTarget, alignItems: "center", justifyContent: "center" },
  refreshFailure: { marginHorizontal: seed.spacing.globalGutter, marginTop: seed.spacing.componentDefault, paddingLeft: seed.spacing.x3, borderLeftWidth: 2, borderLeftColor: colors.muted, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2 },
  refreshFailureText: { flex: 1, color: colors.muted },
  refreshFailureRetry: { minHeight: seed.size.touchTarget, justifyContent: "center", paddingHorizontal: seed.spacing.x2 },
  refreshFailureRetryText: { color: colors.ink },
  productGridTopSpacer: { height: seed.spacing.x7 },
  gachaColumn: { paddingHorizontal: seed.spacing.globalGutter, justifyContent: "space-between", columnGap: seed.spacing.componentDefault },
  kujiListItem: { paddingHorizontal: seed.spacing.globalGutter },
  gachaRowGap: { height: seed.spacing.x3 },
  kujiRowGap: { height: seed.spacing.x4_5 },
  listFooter: { minHeight: 84, paddingHorizontal: seed.spacing.globalGutter, alignItems: "center", justifyContent: "center", gap: seed.spacing.x2 },
  loadMoreRetry: { minHeight: seed.size.touchTarget, paddingHorizontal: seed.spacing.x4, borderRadius: seed.radius.r2_5, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" },
  productGrid: { marginTop: seed.spacing.x7, paddingHorizontal: seed.spacing.globalGutter, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", columnGap: seed.spacing.componentDefault },
  gachaProductGrid: { rowGap: seed.spacing.x3 },
  kujiProductGrid: { rowGap: seed.spacing.x4_5 },
  productCard: {
    ...catalogProductCardSurface,
  },
  kujiProductCard: { width: "100%" },
  productImageFrame: { width: "100%", overflow: "hidden", backgroundColor: seed.color.layer.default },
  gachaProductImageFrame: { aspectRatio: 8 / 7 },
  kujiProductImageFrame: { aspectRatio: 7 / 4 },
  productCardBody: {
    paddingHorizontal: seed.spacing.x3,
    paddingTop: seed.spacing.x2_5,
    paddingBottom: seed.spacing.x3,
    backgroundColor: seed.color.layer.default,
  },
  kujiProductCardBody: { paddingHorizontal: seed.spacing.x3, paddingTop: seed.spacing.x2_5, paddingBottom: seed.spacing.x3 },
  productIp: { color: colors.muted, ...seed.typography.catalogMetadata },
  productName: { minHeight: 40, color: colors.ink, ...seed.typography.catalogTitle, marginTop: seed.spacing.x1 },
  gachaProductName: { marginTop: 0 },
  kujiProductName: { minHeight: 0, marginTop: seed.spacing.x1, ...seed.typography.catalogTitleWide },
  productMeta: { marginTop: seed.spacing.x2, flexDirection: "row", alignItems: "baseline", gap: 4 },
  kujiProductMeta: { marginTop: seed.spacing.x2 },
  productPriceQualifier: { flexShrink: 0, color: colors.muted, ...seed.typography.catalogMetadata },
  productPrice: { flexShrink: 1, minWidth: 0, color: colors.ink, ...seed.typography.catalogPrice },
  kujiPrizeTiers: { marginTop: seed.spacing.x1_5 },
  productInventory: { marginTop: seed.spacing.x1_5 },
  kujiProductInventory: { marginTop: seed.spacing.x1_5 },
  empty: { minHeight: 320, marginHorizontal: seed.spacing.globalGutter, paddingVertical: seed.spacing.x14, paddingHorizontal: seed.spacing.x5, alignItems: "center", justifyContent: "center" },
  emptyBody: { color: colors.muted, textAlign: "center", marginTop: 6 },
  retryButton: { minHeight: seed.size.touchTarget, justifyContent: "center", paddingHorizontal: 16, marginTop: 15, borderRadius: seed.radius.r2_5, backgroundColor: colors.ink },
  retryLabel: { color: colors.white, fontWeight: "700" },
  drawerOverlay: { flex: 1, justifyContent: "flex-end" },
  drawerBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(7, 16, 11, 0.42)" },
  drawerSheet: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x2, borderTopLeftRadius: seed.radius.r6, borderTopRightRadius: seed.radius.r6, backgroundColor: seed.color.layer.elevated },
  drawerHandle: { alignSelf: "center", width: 38, height: 4, marginBottom: seed.spacing.x2, borderRadius: seed.radius.r0_5, backgroundColor: seed.color.stroke.contrast },
  drawerHeader: { minHeight: seed.size.topNavigation, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  drawerToggleRow: { minHeight: 70, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x4, paddingVertical: seed.spacing.x3 },
  drawerRowCopy: { flex: 1 },
  drawerRowTitle: { color: colors.ink },
  drawerRowBody: { marginTop: 3, color: colors.muted },
  switchTrack: { width: 46, height: 28, padding: 3, borderRadius: seed.radius.r3_5, backgroundColor: seed.color.background.neutralWeak },
  switchTrackActive: { backgroundColor: colors.brand },
  switchThumb: { width: 22, height: 22, borderRadius: seed.radius.full, backgroundColor: colors.white, shadowColor: colors.black, shadowOpacity: 0.14, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  switchThumbActive: { transform: [{ translateX: 18 }] },
  drawerDivider: { height: StyleSheet.hairlineWidth, backgroundColor: seed.color.stroke.neutral },
  drawerSectionLabel: { marginTop: seed.spacing.x4, marginBottom: seed.spacing.x2, color: colors.muted, fontWeight: "700" },
  sortRow: { minHeight: seed.size.touchTarget, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sortLabel: { color: colors.ink, fontWeight: "700" },
  sortLabelSelected: { color: colors.greenInk, fontWeight: "900" },
  drawerRowPressed: {
    opacity: seed.state.pressedOpacity,
    backgroundColor: seed.color.background.transparentPressed,
    transform: [{ translateY: seed.state.pressedTranslateY }, { scale: seed.state.pressedScale }],
  },
  drawerApplyButton: { marginTop: seed.spacing.x4, marginBottom: seed.spacing.x2 },
  pressed: {
    opacity: seed.state.pressedOpacity,
    transform: [{ translateY: seed.state.pressedTranslateY }, { scale: seed.state.pressedScale }],
  },
});
