import Constants from "expo-constants";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
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
import { SeedInlineGuidance } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import { catalogProductCardSurface } from "@/design-system/catalog";
import { subtleSectionHeaderRule } from "@/design-system/section";
import { openCustomerLogin } from "@/features/auth/login-navigation";
import { CategoryAvailabilityState } from "@/features/catalog/CategoryAvailabilityState";
import { shouldShowCatalogInventory } from "@/features/catalog/remaining-inventory";
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
import {
  categoryLabel,
  fetchProductDetail,
  isDrawCategory,
  productMetadataText,
  setProductWishlist,
  type ProductDetailSnapshot,
} from "@/features/shop/shop-api";
import { includedPrizes } from "@/features/shop/included-prizes";
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const tokens = await readAuthTokens();
      const next = await fetchProductDetail(
        runtime.apiBaseUrl,
        productId,
        tokens?.accessToken,
        exchangeListingId ? { exchangeListingId } : {},
      );
      const currentTokens = await readAuthTokens();
      setAccessToken(currentTokens?.accessToken ?? null);
      setSnapshot(next);
      if (!next.ownedCollectible && !next.exchangeReference) {
        void recordRecentlyViewedProduct(db, next.product.id).catch(() => undefined);
      }
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "상품 정보를 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }, [db, exchangeListingId, productId, runtime.apiBaseUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const product = snapshot?.product ?? null;
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
        || (!__DEV__ && (snapshot?.drawOdds?.entries.length ?? 0) === 0)
      ),
  );

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace(shopTabPathForCategory(product?.category));
  };

  const toggleWishlist = async () => {
    if (!snapshot || snapshot.ownedCollectible || snapshot.exchangeReference || wishlistPending) return;
    if (!accessToken) {
      openCustomerLogin(
        "찜 목록은 로그인한 계정에 저장돼요.",
        `/product/${encodeURIComponent(productId)}`,
      );
      return;
    }
    const next = !snapshot.wishedByViewer;
    setWishlistPending(true);
    try {
      await setProductWishlist(runtime.apiBaseUrl, accessToken, snapshot.product.id, next);
      setSnapshot((current) => current ? { ...current, wishedByViewer: next } : current);
    } catch (error) {
      Alert.alert("찜을 변경하지 못했어요", error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
    } finally {
      setWishlistPending(false);
    }
  };

  const continueCommerce = () => {
    if (!product) return;
    if (!commerceEnabled) {
      void toggleWishlist();
      return;
    }
    if (productComingSoon) {
      Alert.alert(
        "준비중입니다.",
        `${productCategoryLabel(product.category)} 상품은 준비가 끝나는 대로 공개할게요.`,
      );
      return;
    }
    if (!accessToken) {
      openCustomerLogin(
        "주문과 추첨 결과는 로그인한 계정에 저장돼요.",
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
            : "확률표가 공개된 뒤 구매할 수 있어요.",
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
      `${quantity}개 · ${total.toLocaleString("ko-KR")}원이에요. 결제 화면에서 포인트와 최종 결제 금액을 확인해 주세요.`,
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
        titleMode="pixel"
        onBack={goBack}
        action={readOnlyReference || productComingSoon ? null : (
          <DetailPageHeaderAction
            label={snapshot?.wishedByViewer ? "찜 해제" : "찜하기"}
            disabled={wishlistPending}
            onPress={() => void toggleWishlist()}
          >
            <DecorativeIonicon
              name={snapshot?.wishedByViewer ? "heart" : "heart-outline"}
              size={25}
              color={snapshot?.wishedByViewer ? colors.greenInk : colors.ink}
            />
          </DetailPageHeaderAction>
        )}
      />

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.ink} /><Text style={styles.centerText}>상품 정보를 불러오는 중</Text></View>
      ) : message || !snapshot || !product ? (
        <View style={styles.center}>
          <DecorativeIonicon name="alert-circle-outline" size={34} color={colors.muted} />
          <Text style={styles.errorTitle}>{message || "상품을 찾을 수 없어요."}</Text>
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
              <Text style={styles.ipName}>{snapshot.ip?.nameKo ?? "등록 작품"}</Text>
              <Text style={styles.productName}>{productSubjectTitle(product.name, snapshot.ip?.nameKo)}</Text>
              <ProductInfoDivider style={styles.detailFieldDivider} />
              <Text style={styles.price}>{productPriceLabel(product, commerceEnabled)}</Text>
              <View style={styles.badgeRow}>
                <View style={styles.categoryBadge}><Text style={styles.categoryBadgeLabel}>{categoryLabel(product.category)}</Text></View>
                {readOnlyReference ? (
                  <Text style={styles.stock}>{ownedCollectible ? "내 보관 상품" : "교환 등록 상품"}</Text>
                ) : shouldShowCatalogInventory(product, commerceEnabled) ? (
                  <RemainingInventoryMeter
                    category={product.category}
                    availableQuantity={product.availableQuantity}
                    totalQuantity={product.totalQuantity}
                    style={styles.detailInventory}
                  />
                ) : null}
              </View>
            </View>

            {readOnlyReference ? (
              <View style={styles.section}>
                <KoreanPixelTitle variant="section" style={styles.sectionTitle}>{ownedCollectible ? "보유 상품 안내" : "교환 상품 안내"}</KoreanPixelTitle>
                <InfoRow label="상품 구분" value="뽑기 결과 상품" />
                <InfoRow label="확인 위치" value={ownedCollectible ? "보관함·배송·교환 내역" : "교환 글"} />
              </View>
            ) : isDrawCategory(product.category) ? (
              <OddsSection snapshot={snapshot} />
            ) : (
              <View style={styles.section}>
                <KoreanPixelTitle variant="section" style={styles.sectionTitle}>구매 안내</KoreanPixelTitle>
                <InfoRow label="판매 방식" value="일반 상품 직접 구매" />
                <InfoRow label="제조사" value={product.manufacturer ?? "상품 상세 고지 예정"} />
                <InfoRow label="출시일" value={product.releaseDate ?? "상품 상세 고지 예정"} />
              </View>
            )}
          </ScrollView>

          {!readOnlyReference ? <FloatingBottomActionPanel panelStyle={styles.footer}>
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
                ? snapshot.wishedByViewer ? "관심 상품에서 삭제" : "관심 상품 저장"
                : isDrawCategory(product.category) ? "뽑으러 가기" : `${quantity}개 구매 준비`}
              accessibilityState={{ disabled: commerceEnabled ? drawUnavailable : wishlistPending, busy: wishlistPending }}
              disabled={commerceEnabled ? drawUnavailable : wishlistPending}
              onPress={continueCommerce}
              style={({ pressed }) => [
                styles.primaryButton,
                (!commerceEnabled || isDrawCategory(product.category)) && styles.primaryButtonCentered,
                pressed && styles.pressed,
                (commerceEnabled ? drawUnavailable : wishlistPending) && styles.disabled,
              ]}
            >
              {!commerceEnabled || isDrawCategory(product.category) ? null : <Text style={styles.primaryButtonMeta}>{total.toLocaleString("ko-KR")}원</Text>}
              <Text style={styles.primaryButtonLabel}>
                {!commerceEnabled
                  ? snapshot.wishedByViewer ? "관심 상품에서 삭제" : "관심 상품 저장"
                  : isDrawCategory(product.category) ? "뽑으러 가기" : "구매 준비"}
              </Text>
            </Pressable>
          </FloatingBottomActionPanel> : null}
        </>
      )}
    </SafeAreaView>
  );
}

const HERO_ASPECT_RATIO_BOUNDS = { min: 0.6, max: 2.4 } as const;

function ProductHero({ snapshot, assetBaseUrl }: { snapshot: ProductDetailSnapshot; assetBaseUrl: string | null }) {
  const uri = resolveCatalogImageUrl(snapshot.product.imageUrl, assetBaseUrl, snapshot.product.version);
  const editionLabel = productMetadataText(snapshot.product, "edition")?.trim();
  const [measured, setMeasured] = useState<{ uri: string | null; aspectRatio: number } | null>(null);
  // Until the source is measured, reserve a neutral loading footprint; the hero then
  // takes the image's own aspect ratio so the complete photo shows without a frame.
  const loadingAspectRatio = snapshot.product.category === "kuji" ? 16 / 9 : 1;
  const heroAspectRatio = measured?.uri === uri ? measured.aspectRatio : loadingAspectRatio;

  return (
    <View style={styles.heroContainer}>
      <View style={[styles.hero, { aspectRatio: heroAspectRatio }]}>
        <CatalogProductImage
          uri={uri}
          requestKey={snapshot.product.version}
          resizeMode="contain"
          style={styles.heroImage}
          onDimensions={(width, height) => setMeasured({
            uri,
            aspectRatio: Math.min(
              HERO_ASPECT_RATIO_BOUNDS.max,
              Math.max(HERO_ASPECT_RATIO_BOUNDS.min, width / height),
            ),
          })}
        />
        {editionLabel ? (
          <View style={styles.editionBadge}><Text style={styles.editionLabel}>{editionLabel}</Text></View>
        ) : null}
      </View>
    </View>
  );
}

function OddsSection({ snapshot }: { snapshot: ProductDetailSnapshot }) {
  const odds = snapshot.drawOdds;
  const prizes = includedPrizes(snapshot);
  return (
    <View style={styles.section}>
      <View style={styles.includedHeader}>
        <KoreanPixelTitle variant="section">포함 상품</KoreanPixelTitle>
        {prizes.length ? <Text style={styles.includedCount}>총 {prizes.length}종</Text> : null}
      </View>
      {prizes.length ? (
        <>
          <View style={styles.includedGrid}>
            {prizes.map((prize) => (
              <View
                key={prize.id}
                style={styles.includedCard}
                accessible
                accessibilityLabel={[prize.prizeName, prize.accessibilityDetail].filter(Boolean).join(", ")}
              >
                <View style={styles.includedImageFrame}>
                  <CatalogProductImage
                    uri={prize.prizeImageUrl}
                    requestKey={prize.id}
                    resizeMode="contain"
                    style={styles.includedImage}
                  />
                </View>
                <View style={styles.includedCopy}>
                  <Text numberOfLines={2} style={styles.includedName}>{prize.prizeName}</Text>
                  {prize.detail ? <Text style={styles.includedOdds}>{prize.detail}</Text> : null}
                </View>
              </View>
            ))}
          </View>
          {odds?.entries.length ? (
            <SeedInlineGuidance
              accessibilityLabel={`확률표 버전 ${odds.version}. 확률은 남은 수량에 따라 실시간으로 바뀌어요`}
              style={styles.disclosure}
            >
              확률은 남은 수량에 따라 실시간으로 바뀌어요
            </SeedInlineGuidance>
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
  heroContainer: { marginHorizontal: seed.spacing.x2, marginVertical: seed.spacing.x4 },
  hero: { width: "100%", overflow: "hidden" },
  heroImage: { width: "100%", height: "100%" },
  editionBadge: { position: "absolute", left: 12, bottom: 12, maxWidth: "82%", paddingHorizontal: 10, paddingVertical: 7, borderRadius: seed.radius.r2, backgroundColor: seed.color.inverted.surface },
  editionLabel: { color: colors.white, fontSize: 11, lineHeight: 16, fontWeight: "800" },
  detailCopy: { paddingHorizontal: seed.spacing.globalGutter },
  badgeRow: { marginTop: seed.spacing.x3, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  categoryBadge: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: seed.radius.r1_75, backgroundColor: colors.brand },
  categoryBadgeLabel: { color: colors.ink, fontSize: 11, fontWeight: "900" },
  stock: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  detailInventory: { minWidth: 0, flex: 1, marginLeft: seed.spacing.x3 },
  detailFieldDivider: { marginTop: seed.spacing.x3_5 },
  ipName: { color: colors.muted, fontSize: 13 },
  productName: { color: seed.color.foreground.neutral, ...seed.typography.screenTitle, marginTop: seed.spacing.x1 },
  price: { color: colors.ink, fontSize: 22, fontWeight: "900", marginTop: seed.spacing.x3 },
  section: { marginHorizontal: seed.spacing.globalGutter, marginTop: seed.spacing.x6, padding: seed.spacing.x4_5, borderRadius: seed.radius.r5, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  sectionTitle: { marginBottom: seed.spacing.x3_5 },
  includedHeader: { marginBottom: seed.spacing.x3_5, ...subtleSectionHeaderRule, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  includedCount: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  includedGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: seed.spacing.x3 },
  includedCard: { width: "48.3%", ...catalogProductCardSurface },
  includedImageFrame: { width: "100%", aspectRatio: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.white },
  includedImage: { width: "100%", height: "100%" },
  includedCopy: { minHeight: 66, paddingHorizontal: 10, paddingVertical: 9 },
  includedName: { color: colors.ink, fontSize: 12, lineHeight: 17, fontWeight: "800" },
  includedOdds: { color: colors.greenInk, fontSize: 11, fontWeight: "900", marginTop: 5 },
  disclosure: { marginTop: seed.spacing.x3 },
  oddsEmpty: { padding: seed.spacing.x3_5, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.neutralWeak, flexDirection: "row", alignItems: "flex-start", gap: seed.spacing.x2_5 },
  oddsEmptyCopy: { flex: 1 },
  oddsEmptyTitle: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  oddsEmptyBody: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  infoRow: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  infoLabel: { color: colors.muted, fontSize: 13 },
  infoValue: { flex: 1, color: colors.ink, fontSize: 13, fontWeight: "800", textAlign: "right" },
  footer: { flexDirection: "row", alignItems: "center", gap: seed.spacing.x2_5 },
  quantityBox: { height: 54, borderRadius: seed.radius.r3_5, borderWidth: 1, borderColor: seed.color.stroke.neutral, flexDirection: "row", alignItems: "center", backgroundColor: seed.color.layer.basement },
  quantityButton: { width: seed.size.touchTarget, height: 52, alignItems: "center", justifyContent: "center" },
  quantityLabel: { minWidth: 24, color: colors.ink, fontSize: 16, fontWeight: "900", textAlign: "center" },
  primaryButton: { flex: 1, minHeight: seed.size.actionButton.large, paddingHorizontal: seed.spacing.x4, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.brandSolid, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x2_5 },
  primaryButtonCentered: { justifyContent: "center" },
  primaryButtonMeta: { color: colors.ink, fontSize: 12, fontWeight: "800" },
  primaryButtonLabel: { color: colors.ink, fontSize: 16, fontWeight: "900" },
  pressed: { opacity: seed.state.pressedOpacity, transform: [{ translateY: seed.state.pressedTranslateY }, { scale: seed.state.pressedScale }] },
  disabled: { opacity: seed.state.disabledOpacity },
});
