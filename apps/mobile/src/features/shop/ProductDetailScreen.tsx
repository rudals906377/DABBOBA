import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { KoreanPixelTitle } from "@/components/RootCategoryTitle";
import { AppText as Text } from "@/components/Typography";
import { seed } from "@/design-system/seed";
import {
  LOCAL_KUJI_ROOM_AVAILABILITY,
  resolveKujiEntryPath,
} from "@/features/kuji/kuji-entry-state";
import {
  categoryLabel,
  fetchProductDetail,
  isDrawCategory,
  productMetadataText,
  setProductWishlist,
  type ProductDetailSnapshot,
} from "@/features/shop/shop-api";
import { productSubjectTitle } from "@/features/shop/product-title";
import { readAuthTokens } from "@/lib/session-store";
import { recordRecentlyViewedProduct } from "@/lib/local-database";
import {
  resolveCatalogImageUrl,
  resolveMobileRuntimeConfig,
  type MobilePlatform,
} from "@/lib/runtime-config";
import { colors } from "@/theme";

export function ProductDetailScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const params = useLocalSearchParams<{ productId?: string | string[] }>();
  const productId = firstParam(params.productId) ?? "";
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
      setAccessToken(tokens?.accessToken ?? null);
      const next = await fetchProductDetail(runtime.apiBaseUrl, productId, tokens?.accessToken);
      setSnapshot(next);
      void recordRecentlyViewedProduct(db, next.product.id).catch(() => undefined);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "상품 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [db, productId, runtime.apiBaseUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const product = snapshot?.product ?? null;
  const maxQuantity = Math.max(1, Math.min(product?.availableQuantity ?? 1, 10));
  const total = (product?.price ?? 0) * quantity;

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/ppoba");
  };

  const toggleWishlist = async () => {
    if (!snapshot || wishlistPending) return;
    if (!accessToken) {
      Alert.alert("로그인이 필요합니다", "찜 목록은 로그인한 계정에 저장됩니다.");
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
    if (!accessToken) {
      Alert.alert("로그인이 필요합니다", "주문과 추첨 결과는 로그인한 계정에 저장됩니다.");
      return;
    }
    if (product.category === "kuji") {
      router.push(resolveKujiEntryPath(product.id, LOCAL_KUJI_ROOM_AVAILABILITY) as Href);
      return;
    }
    Alert.alert(
      isDrawCategory(product.category) ? "뽑기 주문 준비 완료" : "구매 주문 준비 완료",
      `${quantity}개 · ${total.toLocaleString("ko-KR")}원으로 결제 화면에 이어질 예정입니다. 현재 로컬 앱에서는 실제 결제를 진행하지 않습니다.`,
      [
        {
          text: "OK",
          onPress: () => router.push(
            `/checkout/${encodeURIComponent(product.id)}?quantity=${quantity}` as Href,
          ),
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기" onPress={goBack} hitSlop={10} style={styles.headerAction}>
          <Ionicons name="chevron-back" size={28} color={colors.ink} />
        </Pressable>
        <View style={styles.headerTitle}><KoreanPixelTitle variant="header">상품 상세</KoreanPixelTitle></View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={snapshot?.wishedByViewer ? "찜 해제" : "찜하기"}
          accessibilityState={{ selected: snapshot?.wishedByViewer ?? false, busy: wishlistPending }}
          onPress={() => void toggleWishlist()}
          hitSlop={10}
          style={styles.headerAction}
        >
          <Ionicons name={snapshot?.wishedByViewer ? "heart" : "heart-outline"} size={25} color={snapshot?.wishedByViewer ? colors.greenInk : colors.ink} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.ink} /><Text style={styles.centerText}>상품 정보를 불러오는 중</Text></View>
      ) : message || !snapshot || !product ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={34} color={colors.muted} />
          <Text style={styles.errorTitle}>{message || "상품을 찾을 수 없습니다."}</Text>
          <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retryButton}><Text style={styles.retryLabel}>다시 불러오기</Text></Pressable>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.content}>
            <ProductHero snapshot={snapshot} assetBaseUrl={runtime.assetBaseUrl} />

            <View style={styles.detailCopy}>
              <View style={styles.badgeRow}>
                <View style={styles.categoryBadge}><Text style={styles.categoryBadgeLabel}>{categoryLabel(product.category)}</Text></View>
                <Text style={styles.stock}>{product.availableQuantity}개 남음</Text>
              </View>
              <Text style={styles.ipName}>{snapshot.ip?.nameKo ?? "등록 작품"}</Text>
              <Text style={styles.productName}>{productSubjectTitle(product.name, snapshot.ip?.nameKo)}</Text>
              <Text style={styles.price}>{product.price.toLocaleString("ko-KR")}원</Text>
              <Text style={styles.description}>{productMetadataText(product, "description") ?? `${snapshot.ip?.nameKo ?? "등록 작품"}의 정식 등록 상품입니다. 상품 구성과 판매 방식은 아래 안내를 확인해 주세요.`}</Text>
            </View>

            <View style={styles.factList}>
              <Fact icon="receipt-outline" text={isDrawCategory(product.category) ? "결제 후 서버가 확정한 결과로 추첨" : "표시된 상품을 그대로 구매"} />
              <Fact icon="cube-outline" text={isDrawCategory(product.category) ? "가챠·쿠지로 뽑은 상품은 내 보관함에 등록" : "구매 상품은 일반 배송 주문으로 처리"} />
              <Fact icon="car-outline" text={isDrawCategory(product.category) ? "보관함에서 여러 상품을 묶어 배송 신청" : "구매 내역에서 주문과 배송 상태 확인"} />
            </View>

            {isDrawCategory(product.category) ? (
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

          <View style={styles.footer}>
            <View style={styles.quantityBox}>
              <Pressable accessibilityRole="button" accessibilityLabel="수량 줄이기" disabled={quantity <= 1} onPress={() => setQuantity((current) => Math.max(1, current - 1))} style={styles.quantityButton}>
                <Ionicons name="remove" size={20} color={quantity <= 1 ? colors.line : colors.ink} />
              </Pressable>
              <Text style={styles.quantityLabel}>{quantity}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="수량 늘리기" disabled={quantity >= maxQuantity} onPress={() => setQuantity((current) => Math.min(maxQuantity, current + 1))} style={styles.quantityButton}>
                <Ionicons name="add" size={20} color={quantity >= maxQuantity ? colors.line : colors.ink} />
              </Pressable>
            </View>
            <Pressable accessibilityRole="button" onPress={continueCommerce} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
              <Text style={styles.primaryButtonMeta}>{total.toLocaleString("ko-KR")}원</Text>
              <Text style={styles.primaryButtonLabel}>{product.category === "kuji" ? "뽑으러 가기" : isDrawCategory(product.category) ? "뽑기 준비" : "구매 준비"}</Text>
            </Pressable>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

function ProductHero({ snapshot, assetBaseUrl }: { snapshot: ProductDetailSnapshot; assetBaseUrl: string | null }) {
  const uri = resolveCatalogImageUrl(snapshot.product.imageUrl, assetBaseUrl, snapshot.product.version);
  const [imageAspectRatio, setImageAspectRatio] = useState(1);

  useEffect(() => {
    let active = true;
    setImageAspectRatio(1);
    if (!uri) return () => { active = false; };

    Image.getSize(
      uri,
      (width, height) => {
        if (active && width > 0 && height > 0) setImageAspectRatio(width / height);
      },
      () => undefined,
    );
    return () => { active = false; };
  }, [uri]);

  return (
    <View style={styles.heroContainer}>
      <View style={[styles.hero, { aspectRatio: imageAspectRatio }]}>
        {uri ? (
          <Image
            source={{ uri }}
            resizeMode="contain"
            style={styles.heroImage}
            onLoad={({ nativeEvent }) => {
              const { width, height } = nativeEvent.source;
              if (width > 0 && height > 0) setImageAspectRatio(width / height);
            }}
          />
        ) : <View style={styles.placeholder}><Text style={styles.placeholderLabel}>IMAGE READY</Text></View>}
        <View style={styles.editionBadge}><Text style={styles.editionLabel}>{productMetadataText(snapshot.product, "edition") ?? snapshot.product.sku}</Text></View>
      </View>
    </View>
  );
}

function Fact({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return <View style={styles.fact}><Ionicons name={icon} size={21} color={colors.greenInk} /><Text style={styles.factText}>{text}</Text></View>;
}

function OddsSection({ snapshot }: { snapshot: ProductDetailSnapshot }) {
  const odds = snapshot.drawOdds;
  return (
    <View style={styles.section}>
      <KoreanPixelTitle variant="section" style={styles.sectionTitle}>현재 경품·확률</KoreanPixelTitle>
      {odds ? (
        <>
          {odds.entries.slice(0, 10).map((entry) => (
            <View key={entry.id} style={styles.oddsRow}>
              <View style={styles.rarity}><Text style={styles.rarityLabel}>{entry.rarity}</Text></View>
              <Text numberOfLines={2} style={styles.oddsName}>{entry.prizeName}</Text>
              <Text style={styles.oddsValue}>{entry.probabilityPercent.toFixed(2)}%</Text>
            </View>
          ))}
          <Text style={styles.disclosure}>확률표 v{odds.version} · 현재 남은 경품 수량과 서버 가중치를 기준으로 계산됩니다.</Text>
        </>
      ) : (
        <View style={styles.oddsEmpty}>
          <Ionicons name="lock-closed-outline" size={22} color={colors.muted} />
          <View style={styles.oddsEmptyCopy}><Text style={styles.oddsEmptyTitle}>공개된 확률표를 확인 중이에요</Text><Text style={styles.oddsEmptyBody}>확률표가 공개되기 전에는 실제 주문·추첨을 진행하지 않습니다.</Text></View>
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
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  header: { minHeight: seed.size.topNavigation, paddingHorizontal: seed.spacing.x3_5, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  headerAction: { width: seed.size.touchTarget, height: seed.size.touchTarget, alignItems: "center", justifyContent: "center" },
  headerTitle: { alignItems: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 12 },
  centerText: { color: colors.muted, fontSize: 14 },
  errorTitle: { color: colors.ink, fontSize: 16, lineHeight: 23, fontWeight: "800", textAlign: "center" },
  retryButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 18, borderRadius: 10, backgroundColor: colors.ink },
  retryLabel: { color: colors.white, fontSize: 13, fontWeight: "800" },
  content: { paddingBottom: seed.spacing.screenBottom },
  heroContainer: { marginHorizontal: seed.spacing.x2, marginVertical: seed.spacing.globalGutter },
  hero: { width: "100%", overflow: "hidden", borderRadius: seed.radius.r6 },
  heroImage: { width: "100%", height: "100%" },
  placeholder: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: seed.color.background.neutralWeak },
  placeholderLabel: { color: colors.muted, fontFamily: "monospace", fontSize: 10, fontWeight: "800" },
  editionBadge: { position: "absolute", left: 12, bottom: 12, maxWidth: "82%", paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: "rgba(7,16,11,0.88)" },
  editionLabel: { color: colors.white, fontFamily: "monospace", fontSize: 9, fontWeight: "800" },
  detailCopy: { paddingHorizontal: seed.spacing.globalGutter },
  badgeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  categoryBadge: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 7, backgroundColor: colors.brand },
  categoryBadgeLabel: { color: colors.ink, fontSize: 11, fontWeight: "900" },
  stock: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  ipName: { color: colors.muted, fontSize: 13, marginTop: 16 },
  productName: { color: seed.color.foreground.neutral, ...seed.typography.screenTitle, marginTop: seed.spacing.x1 },
  price: { color: colors.ink, fontSize: 22, fontWeight: "900", marginTop: 12 },
  description: { color: colors.muted, fontSize: 14, lineHeight: 22, marginTop: 14 },
  factList: { marginHorizontal: seed.spacing.globalGutter, marginTop: seed.spacing.x6, borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default, overflow: "hidden" },
  fact: { minHeight: 58, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  factText: { flex: 1, color: colors.ink, fontSize: 13, lineHeight: 19, fontWeight: "700" },
  section: { marginHorizontal: seed.spacing.globalGutter, marginTop: seed.spacing.x6, padding: seed.spacing.x4_5, borderRadius: seed.radius.r5, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  sectionTitle: { marginBottom: seed.spacing.x3_5 },
  oddsRow: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  rarity: { width: 36, height: 30, borderRadius: 8, backgroundColor: colors.black, alignItems: "center", justifyContent: "center" },
  rarityLabel: { color: colors.brand, fontFamily: "monospace", fontSize: 9, fontWeight: "900" },
  oddsName: { flex: 1, color: colors.ink, fontSize: 13, lineHeight: 18, fontWeight: "700" },
  oddsValue: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  disclosure: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 13 },
  oddsEmpty: { padding: seed.spacing.x3_5, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.neutralWeak, flexDirection: "row", alignItems: "flex-start", gap: seed.spacing.x2_5 },
  oddsEmptyCopy: { flex: 1 },
  oddsEmptyTitle: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  oddsEmptyBody: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  infoRow: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  infoLabel: { color: colors.muted, fontSize: 13 },
  infoValue: { flex: 1, color: colors.ink, fontSize: 13, fontWeight: "800", textAlign: "right" },
  footer: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.componentDefault, paddingBottom: seed.spacing.x1, borderTopWidth: 1, borderTopColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2_5 },
  quantityBox: { height: 54, borderRadius: seed.radius.r3_5, borderWidth: 1, borderColor: seed.color.stroke.neutral, flexDirection: "row", alignItems: "center", backgroundColor: seed.color.layer.basement },
  quantityButton: { width: 42, height: 52, alignItems: "center", justifyContent: "center" },
  quantityLabel: { minWidth: 24, color: colors.ink, fontSize: 16, fontWeight: "900", textAlign: "center" },
  primaryButton: { flex: 1, minHeight: seed.size.actionButton.large, paddingHorizontal: seed.spacing.x4, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.brandSolid, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x2_5 },
  primaryButtonMeta: { color: colors.ink, fontSize: 12, fontWeight: "800" },
  primaryButtonLabel: { color: colors.ink, fontSize: 16, fontWeight: "900" },
  pressed: { opacity: seed.state.pressedOpacity },
});
