import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { type Href, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DecorativeIonicon } from "@/components/DecorativeIonicon";
import { CatalogProductImage } from "@/components/CatalogProductImage";
import { DetailPageHeader, DetailPageHeaderAction } from "@/components/DetailPageHeader";
import {
  FloatingBottomActionPanel,
  useFloatingBottomActionContentInset,
} from "@/components/FloatingBottomActionPanel";
import { ProductInfoDivider } from "@/components/ProductInfoDivider";
import { RemainingInventoryMeter } from "@/components/RemainingInventoryMeter";
import { KoreanPixelTitle } from "@/components/RootCategoryTitle";
import { AppText as Text } from "@/components/Typography";
import { seed } from "@/design-system/seed";
import { catalogProductCardSurface } from "@/design-system/catalog";
import type { HomeRecentDrawActivity } from "@dabboba/contracts";
import { checkoutNoticeSections } from "@/features/checkout/checkout-reference-notices";
import { GACHA_ONLY_FREE_SHIPPING_THRESHOLD, KUJI_INCLUDED_FREE_SHIPPING_THRESHOLD } from "@/features/profile/shipping-policy";
import { openCustomerLogin } from "@/features/auth/login-navigation";
import { CategoryAvailabilityState } from "@/features/catalog/CategoryAvailabilityState";
import { includedProductOpenQuantityLabel, shouldShowCatalogInventory } from "@/features/catalog/remaining-inventory";
import { useStorefrontCategorySettings } from "@/features/catalog/StorefrontCategorySettingsProvider";
import { useCommerceCapability } from "@/features/commerce/CommerceCapabilityProvider";
import {
  isProductPurchasable,
  productPriceLabel,
} from "@/features/commerce/product-commerce-presentation";
import {
  isCustomerProductCategoryComingSoon,
  productCategoryLabel,
} from "@/features/catalog/product-categories";
import { buildKujiRoomGatePath } from "@/features/kuji/kuji-entry-state";
import { kujiTierDisplayLabel } from "@/features/kuji/kuji-tier-availability";
import {
  categoryLabel,
  fetchProductDetail,
  fetchProductRecentDraws,
  fetchShopWishlistProductIds,
  isDrawCategory,
  productMetadataText,
  setProductWishlist,
  type ProductDetailSnapshot,
} from "@/features/shop/shop-api";
import { productSubjectTitle } from "@/features/shop/product-title";
import { shopTabPathForCategory } from "@/features/shop/shop-navigation";
import { readAuthTokens } from "@/lib/session-store";
import { recordRecentlyViewedProduct } from "@/lib/local-database";
import {
  resolveCatalogImageUrl,
  resolveMobileRuntimeConfig,
  type MobilePlatform,
} from "@/lib/runtime-config";
import { colors } from "@/theme";

export function ProductDetailScreen() {
  useStorefrontCategorySettings();
  const { commerceEnabled } = useCommerceCapability();
  const db = useSQLiteContext();
  const router = useRouter();
  const floatingBottomInset = useFloatingBottomActionContentInset();
  const params = useLocalSearchParams<{
    productId?: string | string[];
    exchangeListingId?: string | string[];
  }>();
  const productId = firstParam(params.productId) ?? "";
  const exchangeListingId = firstParam(params.exchangeListingId);
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
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ProductDetailSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [wishlistPending, setWishlistPending] = useState(false);
  const [recentDrawState, setRecentDrawState] = useState<{
    productId: string;
    items: readonly HomeRecentDrawActivity[] | null | undefined;
  } | null>(null);
  const [recentReloadKey, setRecentReloadKey] = useState(0);
  const loadAbortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    setLoading(true);
    try {
      const tokens = await readAuthTokens();
      if (controller.signal.aborted) return;
      const next = await fetchProductDetail(
        runtime.apiBaseUrl,
        productId,
        tokens?.accessToken,
        { includeDrawOdds: false, signal: controller.signal, ...(exchangeListingId ? { exchangeListingId } : {}) },
      );
      if (controller.signal.aborted) return;
      const currentTokens = await readAuthTokens();
      if (controller.signal.aborted) return;
      setAccessToken(currentTokens?.accessToken ?? null);
      setSnapshot(next);
      if (!next.ownedCollectible && !next.exchangeReference) {
        void recordRecentlyViewedProduct(db, next.product.id).catch(() => undefined);
      }
      setMessage("");
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "상품 정보를 불러오지 못했습니다.");
    } finally {
      if (loadAbortRef.current === controller) {
        loadAbortRef.current = null;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
  }, [db, exchangeListingId, productId, runtime.apiBaseUrl]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => {
      loadAbortRef.current?.abort();
      loadAbortRef.current = null;
    };
  }, [load]));

  useEffect(() => {
    if (!snapshot || !commerceEnabled || snapshot.ownedCollectible || snapshot.exchangeReference || !isDrawCategory(snapshot.product.category)) {
      setRecentDrawState(null);
      return;
    }
    const controller = new AbortController();
    const recentProductId = snapshot.product.id;
    setRecentDrawState({ productId: recentProductId, items: undefined });
    void fetchProductRecentDraws(runtime.apiBaseUrl, snapshot.product.id, controller.signal)
      .then((items) => { if (!controller.signal.aborted) setRecentDrawState({ productId: recentProductId, items }); })
      .catch(() => { if (!controller.signal.aborted) setRecentDrawState({ productId: recentProductId, items: null }); });
    return () => controller.abort();
  }, [commerceEnabled, recentReloadKey, runtime.apiBaseUrl, snapshot?.product.id, snapshot?.ownedCollectible, snapshot?.exchangeReference]);

  const product = snapshot?.product.id === productId ? snapshot.product : null;
  const recentDraws = recentDrawState && recentDrawState.productId === product?.id ? recentDrawState.items : undefined;
  const ownedCollectible = snapshot?.ownedCollectible ?? false;
  const exchangeReference = snapshot?.exchangeReference ?? false;
  const readOnlyReference = ownedCollectible || exchangeReference;
  const productComingSoon = !readOnlyReference && isCustomerProductCategoryComingSoon(product?.category);
  const maxQuantity = Math.max(1, Math.min(product?.availableQuantity ?? 1, 10));
  const total = (product?.price ?? 0) * quantity;
  const productPurchasable = product ? isProductPurchasable(product, commerceEnabled) : false;
  const drawUnavailable = Boolean(
    product
      && !readOnlyReference
      && isDrawCategory(product.category)
      && (
        !productPurchasable
        || product.availableQuantity <= 0
        || snapshot?.includedProductsLoaded !== true
        || snapshot.includedProducts.length === 0
      ),
  );

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace(shopTabPathForCategory(product?.category));
  };

  const toggleWishlist = async () => {
    if (!snapshot || snapshot.ownedCollectible || snapshot.exchangeReference || wishlistPending) return;
    const wishlistProductId = snapshot.product.id;
    if (!accessToken) {
      openCustomerLogin(
        "찜 목록은 로그인한 계정에 저장됩니다.",
        `/product/${encodeURIComponent(productId)}`,
      );
      return;
    }
    if (!snapshot.wishlistLoaded) {
      setWishlistPending(true);
      try {
        const ids = await fetchShopWishlistProductIds(runtime.apiBaseUrl, accessToken);
        setSnapshot((current) => current?.product.id === wishlistProductId ? {
          ...current,
          wishedByViewer: ids.has(current.product.id),
          wishlistLoaded: true,
        } : current);
      } catch {
        Alert.alert("찜 상태를 확인하지 못했어요", "연결 상태를 확인하고 다시 눌러 주세요.");
      } finally {
        setWishlistPending(false);
      }
      return;
    }
    const next = !snapshot.wishedByViewer;
    setWishlistPending(true);
    try {
      await setProductWishlist(runtime.apiBaseUrl, accessToken, wishlistProductId, next);
      setSnapshot((current) => current?.product.id === wishlistProductId ? { ...current, wishedByViewer: next } : current);
    } catch (error) {
      Alert.alert("찜을 변경하지 못했어요", error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
    } finally {
      setWishlistPending(false);
    }
  };

  const shareProduct = async () => {
    if (!product || readOnlyReference) return;
    try {
      await Share.share({
        message: `${product.name}\n${Linking.createURL(`/product/${encodeURIComponent(product.id)}`)}`,
      });
    } catch {
      Alert.alert("공유하지 못했어요", "잠시 후 다시 시도해 주세요.");
    }
  };

  const continueCommerce = () => {
    if (!product) return;
    if (!commerceEnabled) return;
    if (productComingSoon) {
      Alert.alert(
        "준비중입니다.",
        `${productCategoryLabel(product.category)} 상품은 준비가 끝나는 대로 공개할게요.`,
      );
      return;
    }
    if (!accessToken) {
      openCustomerLogin(
        "주문과 추첨 결과는 로그인한 계정에 저장됩니다.",
        isDrawCategory(product.category) && product.category === "kuji"
          ? buildKujiRoomGatePath(product.id)
          : `/checkout/${encodeURIComponent(product.id)}`,
      );
      return;
    }
    if (isDrawCategory(product.category)) {
      if (drawUnavailable) {
        Alert.alert(
          "지금은 뽑을 수 없어요",
          product.availableQuantity <= 0
            ? "남은 수량이 없어 구매할 수 없어요."
            : product.category === "kuji"
              ? "쿠지 구성과 등급별 남은 수량이 공개된 뒤 구매할 수 있어요."
              : "가챠 구성 정보가 준비되면 구매할 수 있어요.",
        );
        return;
      }
      router.push(
        product.category === "kuji"
          ? buildKujiRoomGatePath(product.id) as Href
          : `/checkout/${encodeURIComponent(product.id)}` as Href,
      );
      return;
    }
    Alert.alert(
      "결제 화면으로 이동할까요?",
      `${quantity}개 · ${total.toLocaleString("ko-KR")}원입니다. 결제 화면에서 포인트와 최종 결제 금액을 확인해 주세요.`,
      [
        {
          text: "확인",
          onPress: () => router.push(
            `/checkout/${encodeURIComponent(product.id)}?quantity=${quantity}` as Href,
          ),
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={readOnlyReference || productComingSoon ? ["top", "bottom", "left", "right"] : ["top", "left", "right"]}>
      <DetailPageHeader
        title="상품 상세"
        onBack={goBack}
        action={readOnlyReference || productComingSoon ? null : (
          <DetailPageHeaderAction
            label="상품 공유하기"
            onPress={() => void shareProduct()}
          >
            <DecorativeIonicon
              name="share-social-outline"
              size={24}
              color={colors.ink}
            />
          </DetailPageHeaderAction>
        )}
      />

      {loading || (!message && snapshot !== null && product === null) ? (
        <View style={styles.center}><ActivityIndicator color={colors.ink} /><Text style={styles.centerText}>상품 정보를 불러오는 중</Text></View>
      ) : message || !snapshot || !product ? (
        <View style={styles.center}>
          <DecorativeIonicon name="alert-circle-outline" size={34} color={colors.muted} />
          <Text style={styles.errorTitle}>{message || "상품을 찾을 수 없습니다."}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="상품 상세 다시 불러오기" onPress={() => void load()} style={styles.retryButton}><Text style={styles.retryLabel}>다시 불러오기</Text></Pressable>
        </View>
      ) : productComingSoon ? (
        <CategoryAvailabilityState category={product.category} />
      ) : (
        <>
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={[styles.content, { paddingBottom: readOnlyReference ? seed.spacing.screenBottom : floatingBottomInset }]}
          >
            <ProductHero snapshot={snapshot} assetBaseUrl={runtime.assetBaseUrl} />

            <View style={styles.detailCopy}>
              <View style={styles.identityEyebrow}>
                <View style={styles.categoryBadge}><Text style={styles.categoryBadgeLabel}>{categoryLabel(product.category)}</Text></View>
                <Text style={styles.ipName}>{snapshot.ip?.nameKo ?? "등록 작품"}</Text>
              </View>
              <Text style={styles.productName}>{productSubjectTitle(product.name, snapshot.ip?.nameKo)}</Text>
              <ProductInfoDivider style={styles.detailFieldDivider} />
              <Text style={styles.price}>{productPriceLabel(product, commerceEnabled)}</Text>
              {readOnlyReference ? (
                <Text style={styles.stock}>{ownedCollectible ? "내 보관 상품" : "교환 등록 상품"}</Text>
              ) : !isDrawCategory(product.category) && shouldShowCatalogInventory(product, commerceEnabled) ? (
                <View style={styles.inventoryRow}>
                  <RemainingInventoryMeter
                    category={product.category}
                    availableQuantity={product.availableQuantity}
                    totalQuantity={product.totalQuantity}
                    style={styles.detailInventory}
                  />
                </View>
              ) : null}
            </View>

            {readOnlyReference ? (
              <View style={styles.section}>
                <KoreanPixelTitle variant="section" style={styles.sectionTitle}>{ownedCollectible ? "보유 상품 안내" : "교환 상품 안내"}</KoreanPixelTitle>
                <InfoRow label="상품 구분" value="뽑기 결과 상품" />
                <InfoRow label="확인 위치" value={ownedCollectible ? "보관함·배송·교환 내역" : "교환 글"} />
              </View>
            ) : isDrawCategory(product.category) ? (
              <>
                <DrawHighlights category={product.category} prelaunch={!commerceEnabled} />
                <OddsSection snapshot={snapshot} onRetry={() => { void load(); }} />
                <RecentDrawSection items={recentDraws} prelaunch={!commerceEnabled} onRetry={() => {
                  setRecentReloadKey((current) => current + 1);
                }} />
                {product.category === "gacha" ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="중복 가챠 상품 교환방 보기"
                    onPress={() => router.push("/exchange" as Href)}
                    style={({ pressed }) => [styles.exchangeBanner, pressed && styles.pressed]}
                  >
                    <DecorativeIonicon name="swap-horizontal-outline" size={25} color={colors.white} />
                    <View style={styles.exchangeBannerCopy}>
                      <Text style={styles.exchangeBannerTitle}>중복 상품이 생겼나요?</Text>
                      <Text style={styles.exchangeBannerBody}>직접 뽑아 보관 중인 가챠 상품은 교환방에서 교환할 수 있어요.</Text>
                    </View>
                    <DecorativeIonicon name="chevron-forward" size={19} color={colors.white} />
                  </Pressable>
                ) : null}
                <DrawProductInformation snapshot={snapshot} />
                <DrawProductNotices category={product.category} prelaunch={!commerceEnabled} />
              </>
            ) : (
              <View style={styles.section}>
                <KoreanPixelTitle variant="section" style={styles.sectionTitle}>구매 안내</KoreanPixelTitle>
                <InfoRow label="판매 방식" value="일반 상품 직접 구매" />
                <InfoRow label="제조사" value={product.manufacturer ?? "상품 상세 고지 예정"} />
                <InfoRow label="출시일" value={product.releaseDate ?? "상품 상세 고지 예정"} />
              </View>
            )}

            {!isDrawCategory(product.category) ? <CommerceGuidance
              category={product.category}
              ownedCollectible={ownedCollectible}
              exchangeReference={exchangeReference}
              prelaunch={!commerceEnabled}
            /> : null}
          </ScrollView>

          {!readOnlyReference ? <FloatingBottomActionPanel panelStyle={styles.footer}>
            {isDrawCategory(product.category) ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={!snapshot.wishlistLoaded ? "찜 상태 다시 불러오기" : snapshot.wishedByViewer ? "찜 해제" : "찜하기"}
                accessibilityState={{ busy: wishlistPending }}
                disabled={wishlistPending}
                onPress={() => void toggleWishlist()}
                style={({ pressed }) => [styles.wishlistButton, pressed && styles.pressed]}
              >
                <DecorativeIonicon name={snapshot.wishedByViewer ? "heart" : "heart-outline"} size={26} color={snapshot.wishedByViewer ? colors.greenInk : colors.ink} />
                <Text style={styles.wishlistLabel}>{!snapshot.wishlistLoaded ? "재확인" : snapshot.wishedByViewer ? "찜함" : "찜"}</Text>
              </Pressable>
            ) : null}
            {commerceEnabled && !isDrawCategory(product.category) ? (
              <View style={styles.quantityBox}>
                <Pressable accessibilityRole="button" accessibilityLabel="수량 줄이기" accessibilityState={{ disabled: quantity <= 1 }} disabled={quantity <= 1} onPress={() => setQuantity((current) => Math.max(1, current - 1))} style={({ pressed }) => [styles.quantityButton, pressed && styles.pressed]}>
                  <DecorativeIonicon name="remove" size={20} color={quantity <= 1 ? colors.line : colors.ink} />
                </Pressable>
                <Text style={styles.quantityLabel}>{quantity}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="수량 늘리기" accessibilityState={{ disabled: quantity >= maxQuantity }} disabled={quantity >= maxQuantity} onPress={() => setQuantity((current) => Math.min(maxQuantity, current + 1))} style={({ pressed }) => [styles.quantityButton, pressed && styles.pressed]}>
                  <DecorativeIonicon name="add" size={20} color={quantity >= maxQuantity ? colors.line : colors.ink} />
                </Pressable>
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={!commerceEnabled
                ? "뽑기 오픈 준비 중"
                : isDrawCategory(product.category) ? "뽑으러 가기" : `${quantity}개 구매 준비`}
              accessibilityState={{ disabled: !commerceEnabled || drawUnavailable }}
              disabled={!commerceEnabled || drawUnavailable}
              onPress={continueCommerce}
              style={({ pressed }) => [
                styles.primaryButton,
                (!commerceEnabled || isDrawCategory(product.category)) && styles.primaryButtonCentered,
                pressed && styles.pressed,
                !commerceEnabled ? styles.prelaunchButton : drawUnavailable && styles.disabled,
              ]}
            >
              {!commerceEnabled || isDrawCategory(product.category) ? null : <Text style={styles.primaryButtonMeta}>{total.toLocaleString("ko-KR")}원</Text>}
              <Text style={styles.primaryButtonLabel}>
                {!commerceEnabled
                  ? "뽑기 오픈 준비 중"
                  : isDrawCategory(product.category) ? "뽑으러 가기" : "구매 준비"}
              </Text>
            </Pressable>
          </FloatingBottomActionPanel> : null}
        </>
      )}
    </SafeAreaView>
  );
}

function ProductHero({ snapshot, assetBaseUrl }: { snapshot: ProductDetailSnapshot; assetBaseUrl: string | null }) {
  const uri = resolveCatalogImageUrl(snapshot.product.imageUrl, assetBaseUrl, snapshot.product.version);
  const editionLabel = productMetadataText(snapshot.product, "edition")?.trim();
  const [aspectRatio, setAspectRatio] = useState(snapshot.product.category === "kuji" ? 16 / 9 : 4 / 3);

  useEffect(() => {
    setAspectRatio(snapshot.product.category === "kuji" ? 16 / 9 : 4 / 3);
  }, [snapshot.product.id, snapshot.product.category]);

  return (
    <View style={styles.heroContainer}>
      <View style={[styles.hero, { aspectRatio }]}>
        <CatalogProductImage
          uri={uri}
          requestKey={snapshot.product.version}
          resizeMode="contain"
          style={styles.heroImage}
          onDimensions={(width, height) => setAspectRatio(Math.max(0.85, Math.min(width / height, 2)))}
        />
        {editionLabel ? (
          <View style={styles.editionBadge}><Text style={styles.editionLabel}>{editionLabel}</Text></View>
        ) : null}
      </View>
    </View>
  );
}

function DrawHighlights({ category, prelaunch }: { category: "gacha" | "kuji"; prelaunch: boolean }) {
  const threshold = category === "kuji" ? KUJI_INCLUDED_FREE_SHIPPING_THRESHOLD : GACHA_ONLY_FREE_SHIPPING_THRESHOLD;
  return (
    <View style={styles.highlights}>
      {prelaunch ? <View style={styles.highlightRow}>
        <DecorativeIonicon name="shield-checkmark-outline" size={21} color={colors.ink} />
        <Text style={styles.highlightText}>사전오픈 중 · 결제와 뽑기는 아직 이용할 수 없어요.</Text>
      </View> : null}
      <View style={styles.highlightRow}>
        <DecorativeIonicon name="videocam-outline" size={21} color={colors.ink} />
        <Text style={styles.highlightText}>오배송·파손 문의 시 포장과 개봉 상태를 확인할 수 있는 사진이나 영상이 도움이 됩니다.</Text>
      </View>
      <View style={styles.highlightRow}>
        <DecorativeIonicon name="car-outline" size={21} color={colors.ink} />
        <Text style={styles.highlightText}>
          보관 상품 배송 신청 합계 {threshold.toLocaleString("ko-KR")}원부터 무료배송
        </Text>
      </View>
    </View>
  );
}

function OddsSection({ snapshot, onRetry }: { snapshot: ProductDetailSnapshot; onRetry: () => void }) {
  const included = snapshot.includedProducts;
  const countLabel = includedProductOpenQuantityLabel(snapshot.product, included.length);
  return (
    <View style={styles.section}>
      <View style={styles.includedHeader}>
        <KoreanPixelTitle variant="section">상품 목록</KoreanPixelTitle>
        {countLabel ? (
          <Text style={styles.includedCount}>
            {countLabel}
          </Text>
        ) : null}
      </View>
      {!snapshot.includedProductsLoaded ? (
        <View style={styles.oddsEmpty}>
          <DecorativeIonicon name="alert-circle-outline" size={22} color={colors.muted} />
          <View style={styles.oddsEmptyCopy}>
            <Text style={styles.oddsEmptyTitle}>상품 목록을 불러오지 못했어요</Text>
            <Pressable accessibilityRole="button" onPress={onRetry} style={styles.historyRetry}>
              <Text style={styles.historyRetryLabel}>다시 불러오기</Text>
            </Pressable>
          </View>
        </View>
      ) : included.length ? (
        <>
          <View style={styles.includedGrid}>
            {included.map((entry) => (
              <View key={entry.id} style={styles.includedCard}>
                <View style={styles.includedImageFrame}>
                  <View style={styles.includedImageTile}>
                    <CatalogProductImage
                      uri={entry.imageUrl}
                      requestKey={entry.id}
                      resizeMode="contain"
                      style={styles.includedImage}
                    />
                  </View>
                </View>
                <View style={styles.includedCopy}>
                  <Text numberOfLines={2} style={styles.includedName}>{entry.name}</Text>
                </View>
              </View>
            ))}
          </View>
          <Text style={styles.disclosure}>
            {snapshot.product.category === "kuji"
              ? "쿠지는 봉인된 번호별 정확한 상품을 열기 전까지 알 수 없습니다."
              : "가챠는 포함 상품 중 하나가 지급되며, 같은 상품이 중복될 수 있어요. 결과에 따라 남은 구성과 확률은 달라질 수 있습니다."}
          </Text>
          {snapshot.product.category === "gacha" ? (
            <Text style={styles.disclosure}>
              계산 예시 · A·B·C·D 각 50개, 시크릿 2개라면 총 202개 중 A는 50/202, 시크릿은 2/202입니다. 이 숫자는 계산 방식을 설명하는 예시이며 이 상품의 실제 수량이나 확률이 아닙니다.
            </Text>
          ) : null}
          {snapshot.product.category === "kuji" && (snapshot.product.remainingKujiTiers?.length ?? 0) > 0 ? (
            <Text style={styles.disclosure}>
              남은 상 · {[...(snapshot.product.remainingKujiTiers ?? [])]
                .sort((left, right) => left.tierRank - right.tierRank)
                .map((tier) => `${kujiTierDisplayLabel(tier)} ${tier.remainingQuantity.toLocaleString("ko-KR")}개`)
                .join(" · ")}
            </Text>
          ) : null}
        </>
      ) : (
        <View style={styles.oddsEmpty}>
          <DecorativeIonicon name="lock-closed-outline" size={22} color={colors.muted} />
          <View style={styles.oddsEmptyCopy}><Text style={styles.oddsEmptyTitle}>포함 상품 정보를 준비 중이에요</Text><Text style={styles.oddsEmptyBody}>상품 구성이 공개되면 이곳에서 바로 확인할 수 있어요.</Text></View>
        </View>
      )}
    </View>
  );
}

function RecentDrawSection({
  items,
  prelaunch,
  onRetry,
}: {
  items: readonly HomeRecentDrawActivity[] | null | undefined;
  prelaunch: boolean;
  onRetry: () => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.includedHeader}>
        <KoreanPixelTitle variant="section">최근 히스토리</KoreanPixelTitle>
        {items === null ? (
          <Pressable accessibilityRole="button" onPress={onRetry} style={styles.historyRetry}>
            <Text style={styles.historyRetryLabel}>다시 불러오기</Text>
          </Pressable>
        ) : null}
      </View>
      {prelaunch ? <Text style={styles.disclosure}>정식 오픈 후 확정된 뽑기 기록이 생기면 이곳에 표시돼요.</Text>
        : items === undefined ? <Text style={styles.disclosure}>최근 기록을 확인하는 중이에요.</Text>
        : items === null ? <Text style={styles.disclosure}>최근 기록을 불러오지 못했어요.</Text>
          : items.length === 0 ? <Text style={styles.disclosure}>아직 공개할 뽑기 기록이 없어요.</Text>
            : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.historyRail}>
              {items.map((item) => (
                <View key={item.id} style={styles.historyItem}>
                  <View style={styles.historyImageFrame}>
                    <CatalogProductImage uri={item.prizeImageUrl} requestKey={item.id} resizeMode="contain" style={styles.historyImage} />
                  </View>
                  <Text numberOfLines={2} style={styles.historyPrize}>{item.prizeName}</Text>
                  <Text style={styles.historyDate}>{formatRecentDrawDate(item.committedAt)}</Text>
                </View>
              ))}
            </ScrollView>}
      <Text style={styles.disclosure}>서버에서 확정된 결과만 표시하며 고객 정보는 공개하지 않아요.</Text>
    </View>
  );
}

function formatRecentDrawDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function DrawProductInformation({ snapshot }: { snapshot: ProductDetailSnapshot }) {
  const origin = productMetadataText(snapshot.product, "originCountry")?.trim();
  const manufacturer = snapshot.product.manufacturer?.trim();
  const releaseDate = snapshot.product.releaseDate?.trim();
  if (!origin && !manufacturer && !releaseDate) return null;
  return (
    <View style={styles.section}>
      <KoreanPixelTitle variant="section" style={styles.sectionTitle}>상품 정보</KoreanPixelTitle>
      {origin ? <InfoRow label="원산지" value={origin} /> : null}
      {manufacturer ? <InfoRow label="제조사·수입사" value={manufacturer} /> : null}
      {releaseDate ? <InfoRow label="출시일" value={releaseDate} /> : null}
    </View>
  );
}

function DrawProductNotices({ category, prelaunch }: { category: "gacha" | "kuji"; prelaunch: boolean }) {
  const sections = checkoutNoticeSections(category);
  return (
    <View style={styles.noticeSection}>
      <KoreanPixelTitle variant="section" style={styles.noticeHeading}>이용 안내</KoreanPixelTitle>
      {prelaunch ? <Text style={styles.noticeCopy}>현재는 상품 탐색과 찜만 가능합니다. 아래 안내는 정식 오픈 시 적용될 구매·보관 흐름입니다.</Text> : null}
      {sections.map((section) => (
        <View key={section.id} style={styles.noticeGroup}>
          <Text style={styles.noticeGroupTitle}>{section.title}</Text>
          {section.groups.map((group, groupIndex) => (
            <View key={`${section.id}-${groupIndex}`}>
              {group.title ? <Text style={styles.noticeSubheading}>{group.title}</Text> : null}
              {group.items.map((item) => (
                <View key={item.text} style={styles.noticeLine}>
                  <Text style={styles.noticeBullet}>•</Text>
                  <Text style={styles.noticeCopy}>{item.text}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function CommerceGuidance({
  category,
  ownedCollectible,
  exchangeReference,
  prelaunch,
}: {
  category: ProductDetailSnapshot["product"]["category"];
  ownedCollectible: boolean;
  exchangeReference: boolean;
  prelaunch: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const drawCategory = isDrawCategory(category);
  const title = ownedCollectible || exchangeReference
    ? "보관·교환 안내"
    : prelaunch ? "사전오픈 안내" : "구매·보관 안내";
  const facts = ownedCollectible
    ? [
        { icon: "shield-checkmark-outline" as const, text: "로그인한 계정의 보유 기록으로 확인된 상품이에요." },
        { icon: "cube-outline" as const, text: "배송·교환 상태는 보관함과 각 신청 내역에서 확인해 주세요." },
      ]
    : exchangeReference
      ? [
          { icon: "swap-horizontal-outline" as const, text: "교환 글에서 확인된 등록 상품이에요." },
          { icon: "cube-outline" as const, text: "교환 상태와 신청은 원래 교환 글에서 확인해 주세요." },
        ]
      : prelaunch
        ? [
            { icon: "heart-outline" as const, text: "첫 공개판에서는 상품 탐색과 관심 상품 저장만 제공해요." },
            { icon: "lock-closed-outline" as const, text: "결제·뽑기·재고 사용·배송 신청은 아직 열리지 않아요." },
            { icon: "notifications-outline" as const, text: "정식 오픈 일정과 이용 안내는 앱 공지에서 알려드릴게요." },
          ]
        : [
          { icon: "list-outline" as const, text: category === "kuji" ? "결제 전에 포함 상품과 등급별 남은 수량을 확인해요." : category === "gacha" ? "결제 전에 포함 상품 목록과 전체·오픈 수량을 확인해요." : "표시된 상품을 그대로 구매해요." },
          ...(drawCategory ? [{ icon: "receipt-outline" as const, text: category === "kuji" ? "결제 확인 후 선택한 티켓을 열면 획득한 상품을 결과에서 확인해요." : "결제 확인 후 캡슐을 열면 획득한 상품을 결과에서 확인해요." }] : []),
          { icon: "cube-outline" as const, text: drawCategory ? "뽑은 상품은 내 보관함에 등록돼요." : "구매 상품은 일반 배송 주문으로 처리돼요." },
          { icon: "car-outline" as const, text: drawCategory ? "보관함에서 여러 상품을 묶어 배송 신청할 수 있어요." : "구매 내역에서 주문과 배송 상태를 확인해 주세요." },
        ];

  return (
    <View style={styles.guidance}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={expanded ? "안내 내용을 접습니다" : "안내 내용을 펼칩니다"}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => [styles.guidanceTrigger, pressed && styles.pressed]}
      >
        <View style={styles.guidanceTitleRow}>
          <DecorativeIonicon name="information-circle-outline" size={21} color={colors.greenInk} />
          <Text style={styles.guidanceTitle}>{title}</Text>
        </View>
        <DecorativeIonicon name={expanded ? "chevron-up" : "chevron-down"} size={20} color={colors.muted} />
      </Pressable>
      {expanded ? (
        <View style={styles.guidanceBody}>
          {facts.map((fact) => (
            <View key={fact.text} style={styles.fact}>
              <DecorativeIonicon name={fact.icon} size={20} color={colors.greenInk} />
              <Text style={styles.factText}>{fact.text}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <View style={styles.infoRow}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, position: "relative", backgroundColor: seed.color.layer.basement },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: seed.spacing.globalGutter, paddingVertical: 28, gap: 12 },
  centerText: { color: colors.muted, fontSize: 14 },
  errorTitle: { color: colors.ink, fontSize: 16, lineHeight: 23, fontWeight: "800", textAlign: "center" },
  retryButton: { minHeight: seed.size.touchTarget, justifyContent: "center", paddingHorizontal: 18, borderRadius: seed.radius.r2_5, backgroundColor: colors.ink },
  retryLabel: { color: colors.white, fontSize: 13, fontWeight: "800" },
  scrollView: { flex: 1 },
  content: { paddingBottom: seed.spacing.screenBottom },
  heroContainer: { marginBottom: seed.spacing.x2_5 },
  hero: { width: "100%", overflow: "hidden", backgroundColor: colors.white },
  heroImage: { width: "100%", height: "100%" },
  editionBadge: { position: "absolute", left: 12, bottom: 12, maxWidth: "82%", paddingHorizontal: 10, paddingVertical: 7, borderRadius: seed.radius.r2, backgroundColor: "rgba(7,16,11,0.88)" },
  editionLabel: { color: colors.white, fontSize: 11, lineHeight: 16, fontWeight: "800" },
  detailCopy: { paddingHorizontal: seed.spacing.globalGutter },
  identityEyebrow: { flexDirection: "row", alignItems: "center", gap: seed.spacing.x2, minHeight: 28 },
  categoryBadge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: seed.radius.r1_75, backgroundColor: colors.brand },
  categoryBadgeLabel: { color: colors.ink, fontSize: 11, fontWeight: "900" },
  inventoryRow: { marginTop: seed.spacing.x2_5 },
  stock: { color: colors.muted, fontSize: 12, fontWeight: "800", marginTop: seed.spacing.x2_5 },
  detailInventory: { minWidth: 0 },
  detailFieldDivider: { marginTop: seed.spacing.x2_5 },
  ipName: { color: colors.muted, fontSize: 13 },
  productName: { color: seed.color.foreground.neutral, ...seed.typography.screenTitle, fontSize: 20, lineHeight: 28, marginTop: seed.spacing.x1 },
  price: { color: colors.ink, fontSize: 21, fontWeight: "900", marginTop: seed.spacing.x2 },
  highlights: { marginHorizontal: seed.spacing.globalGutter, marginTop: seed.spacing.x4, gap: seed.spacing.x2 },
  highlightRow: { minHeight: 46, paddingHorizontal: seed.spacing.x3_5, paddingVertical: seed.spacing.x2, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.neutralWeak, flexDirection: "row", alignItems: "center", gap: seed.spacing.x3 },
  highlightText: { flex: 1, color: colors.ink, fontSize: 13, lineHeight: 20, fontWeight: "700" },
  guidance: { marginHorizontal: seed.spacing.globalGutter, marginTop: seed.spacing.x4, borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default, overflow: "hidden" },
  guidanceTrigger: { minHeight: seed.size.touchTarget, paddingHorizontal: seed.spacing.x3_5, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x3 },
  guidanceTitleRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2_5 },
  guidanceTitle: { color: colors.ink, fontSize: 13, lineHeight: 19, fontWeight: "900" },
  guidanceBody: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: seed.color.stroke.neutral, paddingVertical: seed.spacing.x1 },
  fact: { minHeight: 48, paddingHorizontal: seed.spacing.x3_5, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2_5 },
  factText: { flex: 1, color: colors.ink, fontSize: 13, lineHeight: 19, fontWeight: "700" },
  section: { marginHorizontal: seed.spacing.globalGutter, marginTop: seed.spacing.x6, paddingTop: seed.spacing.x4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: seed.color.stroke.neutral },
  sectionTitle: { marginBottom: seed.spacing.x3_5 },
  includedHeader: { marginBottom: seed.spacing.x2_5, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  includedCount: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  includedGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: seed.spacing.x3 },
  includedCard: { width: "48.3%", ...catalogProductCardSurface },
  includedImageFrame: { width: "100%", height: 92, alignItems: "center", justifyContent: "center", backgroundColor: seed.color.layer.default },
  includedImageTile: { width: 56, height: 56 },
  includedImage: { width: "100%", height: "100%" },
  includedCopy: { minHeight: 46, paddingHorizontal: 8, paddingVertical: 6, alignItems: "center", justifyContent: "center" },
  includedName: { width: "100%", color: colors.ink, fontSize: 13, lineHeight: 18, fontWeight: "700", textAlign: "center" },
  disclosure: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 13 },
  historyRetry: { minHeight: seed.size.touchTarget, justifyContent: "center", paddingHorizontal: seed.spacing.x2 },
  historyRetryLabel: { color: colors.greenInk, fontSize: 12, fontWeight: "800" },
  historyRail: { gap: seed.spacing.x3, paddingVertical: seed.spacing.x2 },
  historyItem: { width: 100, gap: 4 },
  historyImageFrame: { width: 100, height: 100, borderWidth: StyleSheet.hairlineWidth, borderColor: seed.color.stroke.neutral, borderRadius: seed.radius.r2, overflow: "hidden", backgroundColor: colors.white },
  historyImage: { width: "100%", height: "100%" },
  historyPrize: { color: colors.ink, fontSize: 12, lineHeight: 17, fontWeight: "700" },
  historyDate: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  exchangeBanner: { minHeight: 88, marginHorizontal: seed.spacing.globalGutter, marginTop: seed.spacing.x5, paddingHorizontal: seed.spacing.x4, paddingVertical: seed.spacing.x3, borderRadius: seed.radius.r3, backgroundColor: colors.ink, flexDirection: "row", alignItems: "center", gap: seed.spacing.x3 },
  exchangeBannerCopy: { flex: 1, gap: 3 },
  exchangeBannerTitle: { color: colors.white, fontSize: 14, lineHeight: 20, fontWeight: "800" },
  exchangeBannerBody: { color: colors.white, opacity: 0.82, fontSize: 12, lineHeight: 18 },
  noticeSection: { marginHorizontal: seed.spacing.globalGutter, marginTop: seed.spacing.x6, paddingTop: seed.spacing.x4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: seed.color.stroke.neutral },
  noticeHeading: { marginBottom: seed.spacing.x3 },
  noticeGroup: { marginTop: seed.spacing.x4 },
  noticeGroupTitle: { color: colors.ink, fontSize: 14, lineHeight: 20, fontWeight: "800", marginBottom: seed.spacing.x2 },
  noticeSubheading: { color: colors.ink, fontSize: 13, lineHeight: 20, fontWeight: "700", marginTop: seed.spacing.x2, marginBottom: seed.spacing.x1 },
  noticeLine: { flexDirection: "row", alignItems: "flex-start", gap: seed.spacing.x1_5, marginTop: seed.spacing.x1_5 },
  noticeBullet: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  noticeCopy: { flex: 1, flexShrink: 1, minWidth: 0, color: colors.muted, fontSize: 13, lineHeight: 20 },
  oddsEmpty: { padding: seed.spacing.x3_5, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.neutralWeak, flexDirection: "row", alignItems: "flex-start", gap: seed.spacing.x2_5 },
  oddsEmptyCopy: { flex: 1 },
  oddsEmptyTitle: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  oddsEmptyBody: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  infoRow: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  infoLabel: { color: colors.muted, fontSize: 13 },
  infoValue: { flex: 1, color: colors.ink, fontSize: 13, fontWeight: "800", textAlign: "right" },
  footer: { flexDirection: "row", alignItems: "center", gap: seed.spacing.x2_5 },
  wishlistButton: { minWidth: 54, minHeight: 54, justifyContent: "center", alignItems: "center", gap: 2 },
  wishlistLabel: { color: colors.ink, fontSize: 11, lineHeight: 16, fontWeight: "700" },
  quantityBox: { height: 54, borderRadius: seed.radius.r3_5, borderWidth: 1, borderColor: seed.color.stroke.neutral, flexDirection: "row", alignItems: "center", backgroundColor: seed.color.layer.basement },
  quantityButton: { width: seed.size.touchTarget, height: 52, alignItems: "center", justifyContent: "center" },
  quantityLabel: { minWidth: 24, color: colors.ink, fontSize: 16, fontWeight: "900", textAlign: "center" },
  primaryButton: { flex: 1, minHeight: seed.size.actionButton.large, paddingHorizontal: seed.spacing.x4, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.brandSolid, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x2_5 },
  prelaunchButton: { backgroundColor: seed.color.background.neutralWeak, borderWidth: StyleSheet.hairlineWidth, borderColor: seed.color.stroke.neutral },
  primaryButtonCentered: { justifyContent: "center" },
  primaryButtonMeta: { color: colors.ink, fontSize: 12, fontWeight: "800" },
  primaryButtonLabel: { color: colors.ink, fontSize: 16, fontWeight: "900" },
  pressed: { opacity: seed.state.pressedOpacity, transform: [{ translateY: seed.state.pressedTranslateY }, { scale: seed.state.pressedScale }] },
  disabled: { opacity: seed.state.disabledOpacity },
});
