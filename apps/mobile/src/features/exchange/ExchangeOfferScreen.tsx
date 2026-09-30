import Constants from "expo-constants";
import { router, useFocusEffect, useLocalSearchParams, type Href } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
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
import type { InventoryUnit } from "@dabboba/contracts";
import { DecorativeIonicon } from "@/components/DecorativeIonicon";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import {
  FloatingBottomActionPanel,
  useFloatingBottomActionContentInset,
} from "@/components/FloatingBottomActionPanel";
import { ProductInfoDivider } from "@/components/ProductInfoDivider";
import { KoreanPixelTitle } from "@/components/RootCategoryTitle";
import { AppText as Text, BalancedParagraphText } from "@/components/Typography";
import { catalogProductCardSurface, catalogProductImageSurface } from "@/design-system/catalog";
import { seed } from "@/design-system/seed";
import { catalogPriceLabel } from "@/features/commerce/product-commerce-presentation";
import {
  categoryLabel,
  createExchangeOffer,
  fetchExchangeDetail,
  fetchExchangeOfferInventory,
  type ExchangeDetailSnapshot,
  type ExchangeOfferInventorySnapshot,
} from "@/features/exchange/exchange-api";
import { toggleExchangeInventorySelection } from "@/features/exchange/exchange-selection";
import { ProfileSessionGate } from "@/features/profile/ProfileSessionGate";
import { ProfileApiError } from "@/features/profile/profile-api";
import { productSubjectTitle } from "@/features/shop/product-title";
import { ensureUgcOperationsPolicyAcceptance } from "@/features/trust-safety/ugc-policy-consent";
import {
  resolveCatalogImageUrl,
  resolveMobileRuntimeConfig,
  type MobilePlatform,
} from "@/lib/runtime-config";
import { readAuthTokens } from "@/lib/session-store";
import { colors } from "@/theme";

export function ExchangeOfferScreen() {
  const { listingId } = useLocalSearchParams<{ listingId?: string }>();
  const floatingBottomInset = useFloatingBottomActionContentInset();
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
  const [snapshot, setSnapshot] = useState<ExchangeOfferInventorySnapshot | null>(null);
  const [detail, setDetail] = useState<ExchangeDetailSnapshot | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<"loading" | "guest" | "authenticated" | "expired" | "error">("loading");
  const loadGeneration = useRef(0);
  const loadRef = useRef<(manual?: boolean) => Promise<void>>(async () => undefined);

  const load = useCallback(async (manual = false) => {
    const generation = ++loadGeneration.current;
    let requestedAccessToken: string | null = null;
    if (manual) setRefreshing(true);
    setSessionStatus("loading");
    setAccessToken(null);
    setSnapshot(null);
    setError("");
    try {
      const tokens = await readAuthTokens();
      if (generation !== loadGeneration.current) return;
      if (!tokens) {
        setAccessToken(null);
        setSnapshot(null);
        setSessionStatus("guest");
        setError("");
        return;
      }
      requestedAccessToken = tokens.accessToken;
      if (!listingId) throw new Error("교환 글 주소를 확인해 주세요.");
      const [next, nextDetail] = await Promise.all([
        fetchExchangeOfferInventory(runtime.apiBaseUrl, tokens.accessToken),
        fetchExchangeDetail(runtime.apiBaseUrl, listingId, tokens.accessToken),
      ]);
      const currentTokens = await readAuthTokens();
      if (generation !== loadGeneration.current) return;
      if (currentTokens?.accessToken !== tokens.accessToken) {
        void loadRef.current();
        return;
      }
      setAccessToken(tokens.accessToken);
      setSessionStatus("authenticated");
      setSnapshot(next);
      setDetail(nextDetail);
      setSelectedIds((current) => current.filter((id) => next.items.some((item) => item.id === id)).slice(0, 2));
      setError("");
    } catch (cause) {
      const currentTokens = await readAuthTokens();
      if (generation !== loadGeneration.current) return;
      if (currentTokens?.accessToken && currentTokens.accessToken !== requestedAccessToken) {
        void loadRef.current();
        return;
      }
      if (cause instanceof ProfileApiError && cause.status === 401) {
        setAccessToken(null);
        setSnapshot(null);
        setSessionStatus("expired");
        setError("");
        return;
      }
      setSessionStatus("error");
      setError(cause instanceof Error ? cause.message : "내가 뽑은 상품을 불러오지 못했어요.");
    } finally {
      if (generation === loadGeneration.current) setRefreshing(false);
    }
  }, [listingId, runtime.apiBaseUrl]);
  loadRef.current = load;

  useFocusEffect(useCallback(() => {
    void load();
    return () => {
      loadGeneration.current += 1;
    };
  }, [load]));

  const selected = snapshot?.items.filter((item) => selectedIds.includes(item.id)) ?? [];
  const targetProductCount = detail
    ? (detail.item.products.length || 1)
    : 1;
  const hasEligibleItems = Boolean(snapshot?.items.length);
  const ratioLabel = selected.length
    ? `교환 비율 ${targetProductCount}:${selected.length}`
    : `교환 비율 ${targetProductCount}:1~2`;
  const assetBaseUrl = runtime.assetBaseUrl
    ?? (__DEV__ ? runtime.apiBaseUrl.replace(/:8788$/, ":4174") : null);
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace(listingId ? `/exchange/${listingId}` : "/exchange");
  };

  const submit = useCallback(() => {
    if (!listingId || !accessToken || selected.length === 0 || submitting) return;
    Alert.alert(
      `선택한 상품 ${selected.length}개로 신청할까요?`,
      `${selected.map((item) => item.product.name).join("\n")}\n\n신청에는 별도 글이 포함되지 않으며 선택한 상품 정보만 전달돼요.\n다뽀바 밖에서 연락하거나 거래하면 보호받기 어려우니 교환은 앱 안에서만 진행해 주세요.`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "교환 신청",
          onPress: () => {
            void (async () => {
              try {
                setSubmitting(true);
                const accepted = await ensureUgcOperationsPolicyAcceptance({
                  apiBaseUrl: runtime.apiBaseUrl,
                  accessToken,
                  openPolicy: () => router.push("/legal/exchange-request" as Href),
                });
                if (!accepted) return;
                await createExchangeOffer(
                  runtime.apiBaseUrl,
                  accessToken,
                  listingId,
                  selected.map((item) => item.id),
                );
                Alert.alert("교환 신청 완료", `선택한 상품 ${selected.length}개로 교환을 신청했어요.`, [
                  {
                    text: "확인",
                    onPress: () => router.replace(`/exchange/${listingId}`),
                  },
                ]);
              } catch (cause) {
                Alert.alert(
                  "신청하지 못했어요",
                  cause instanceof Error ? cause.message : "잠시 후 다시 시도해 주세요.",
                );
              } finally {
                setSubmitting(false);
              }
            })();
          },
        },
      ],
    );
  }, [accessToken, listingId, runtime.apiBaseUrl, selected, submitting]);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <DetailPageHeader title="교환 신청하기" titleMode="pixel" onBack={goBack} backLabel="교환 상세로 돌아가기" />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: hasEligibleItems ? floatingBottomInset + seed.spacing.x6 : seed.spacing.screenBottom },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.ink} />
        }
      >
        {detail ? (
          <View style={styles.targetSection}>
            <View style={styles.targetOwnerRow}>
              <View style={styles.avatar}><Text style={styles.avatarLabel}>{detail.item.authorNickname.slice(0, 1)}</Text></View>
              <Text style={styles.targetOwner}>@{detail.item.authorNickname}</Text>
              <Text style={styles.targetDday}>D-{Math.max(0, Math.ceil((new Date(detail.item.expiresAt).getTime() - Date.now()) / 86_400_000))}</Text>
            </View>
            <Text numberOfLines={2} style={styles.targetTitle}>{detail.item.title}</Text>
            <TargetListingProducts detail={detail} assetBaseUrl={assetBaseUrl} />
          </View>
        ) : null}

        {sessionStatus === "authenticated" ? (
          <>
            <View style={styles.selectionHeader}>
              <KoreanPixelTitle variant="section">교환 아이템 선택</KoreanPixelTitle>
              {snapshot && snapshot.items.length > 0 ? (
                <View style={styles.selectionSummary}>
                  <Text style={styles.selectionCount}>선택 {selectedIds.length}/2개</Text>
                  <Text accessibilityLabel={ratioLabel} style={styles.selectionRatio}>{ratioLabel}</Text>
                </View>
              ) : null}
            </View>
          </>
        ) : null}

        {sessionStatus === "loading" ? (
          <View style={styles.stateBox}>
            <ActivityIndicator color={colors.ink} />
            <Text style={styles.stateText}>교환 가능한 상품을 불러오는 중</Text>
          </View>
        ) : null}

        {sessionStatus === "guest" || sessionStatus === "expired" ? (
          <ProfileSessionGate status={sessionStatus} returnTo={`/exchange/${encodeURIComponent(listingId ?? "")}/offer`} guestBody="로그인하면 직접 뽑아 보관 중인 상품으로 교환을 신청할 수 있어요." />
        ) : null}

        {sessionStatus === "error" && error ? (
          <View style={styles.stateBox}>
            <KoreanPixelTitle variant="section">상품을 확인할 수 없어요</KoreanPixelTitle>
            <Text style={styles.stateText}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => void load(true)} style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
              <Text style={styles.retryLabel}>다시 불러오기</Text>
            </Pressable>
          </View>
        ) : null}

        {snapshot && snapshot.items.length === 0 ? (
          <View style={styles.stateBox}>
            <KoreanPixelTitle variant="section">신청할 상품이 없어요</KoreanPixelTitle>
            <BalancedParagraphText
              paragraphs={[
                "가챠로 뽑은 상품만 가능해요.",
                "배송을 신청했거나 이미 받은 상품, 포인트 환급·다른 교환에 사용 중인 상품은 표시되지 않아요.",
              ]}
              style={styles.stateText}
            />
          </View>
        ) : null}

        {snapshot?.items.map((item) => (
          <InventoryChoice
            key={item.id}
            item={item}
            ipName={snapshot.ipNames[item.product.ipId] ?? null}
            assetBaseUrl={assetBaseUrl}
            selected={selectedIds.includes(item.id)}
            onSelect={() => {
              if (!selectedIds.includes(item.id) && selectedIds.length >= 2) {
                Alert.alert("최대 2개까지 선택할 수 있어요", "선택한 상품을 하나 해제한 뒤 다시 골라 주세요.");
                return;
              }
              setSelectedIds((current) => toggleExchangeInventorySelection(current, item.id));
            }}
          />
        ))}
      </ScrollView>

      {sessionStatus === "authenticated" && hasEligibleItems ? <FloatingBottomActionPanel>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={selected.length ? `${ratioLabel}, 교환 신청하기` : "교환 신청 상품을 선택해 주세요"}
          disabled={selected.length === 0 || submitting}
          onPress={submit}
          style={({ pressed }) => [
            styles.submitButton,
            (selected.length === 0 || submitting) && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          {submitting ? (
            <ActivityIndicator color={colors.ink} />
          ) : (
            <Text variant="button" style={styles.submitLabel}>{selected.length ? "교환 신청하기" : "상품을 선택해 주세요"}</Text>
          )}
        </Pressable>
      </FloatingBottomActionPanel> : null}
    </SafeAreaView>
  );
}

function TargetListingProducts({
  detail,
  assetBaseUrl,
}: {
  detail: ExchangeDetailSnapshot;
  assetBaseUrl: string | null;
}) {
  const products = detail.item.products.length ? detail.item.products : [detail.item.product];
  return (
    <View style={styles.targetProducts}>
      {products.map((product, index) => {
        const imageUri = resolveCatalogImageUrl(product.imageUrl, assetBaseUrl, product.version);
        const productIpName = detail.ipNames[product.ipId] ?? "작품 정보 없음";
        return (
          <View
            key={`${product.id}-${index}`}
            accessible
            accessibilityLabel={`등록 상품 ${index + 1}/${products.length}: ${productIpName}, ${product.name}, ${categoryLabel(product.category)}, ${catalogPriceLabel(product.price)}`}
            style={styles.targetProductRow}
          >
            {imageUri ? (
              <Image accessible={false} source={{ uri: imageUri }} resizeMode="contain" style={styles.targetImage} />
            ) : <View style={styles.targetImage} />}
            <View style={styles.targetCopy}>
              {products.length > 1 ? (
                <Text style={styles.targetItemIndex}>등록 상품 {index + 1}/{products.length}</Text>
              ) : null}
              <Text numberOfLines={1} style={styles.targetIpName}>{productIpName}</Text>
              <Text numberOfLines={2} style={styles.targetProductName}>
                {productSubjectTitle(product.name, productIpName)}
              </Text>
              <Text style={styles.targetCategory}>{categoryLabel(product.category)}</Text>
              <ProductInfoDivider style={styles.targetProductDivider} />
              <Text style={styles.targetMeta}>{catalogPriceLabel(product.price)}</Text>
              {index === 0 && detail.item.storageExpiresAt ? (
                <Text style={styles.storageExpiry}>보관 {Math.max(0, Math.ceil((Date.parse(detail.item.storageExpiresAt) - Date.now()) / 86_400_000))}일 남음</Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function InventoryChoice({
  item,
  ipName,
  assetBaseUrl,
  selected,
  onSelect,
}: {
  item: InventoryUnit;
  ipName: string | null;
  assetBaseUrl: string | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const imageUri = resolveCatalogImageUrl(item.product.imageUrl, assetBaseUrl, item.product.version);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${ipName ?? "작품 정보 없음"}, ${item.product.name}, ${categoryLabel(item.product.category)}, ${catalogPriceLabel(item.product.price)}, 교환 신청 상품 ${selected ? "선택됨" : "선택 안 됨"}`}
      onPress={onSelect}
      style={({ pressed }) => [styles.productCard, selected && styles.productCardSelected, pressed && styles.pressed]}
    >
      <View style={styles.imageFrame}>
        {imageUri ? (
          <Image accessible={false} source={{ uri: imageUri }} resizeMode="cover" style={styles.image} />
        ) : (
          <View style={styles.imagePlaceholder}><Text variant="finePrint" style={styles.imagePlaceholderText}>이미지 없음</Text></View>
        )}
      </View>
      <View style={styles.productInfo}>
        <Text numberOfLines={1} style={styles.ipName}>{ipName ?? "작품 정보 없음"}</Text>
        <Text numberOfLines={2} style={styles.productName}>{productSubjectTitle(item.product.name, ipName)}</Text>
        <Text style={styles.meta}>{categoryLabel(item.product.category)} · {item.sourceType === "GACHA" ? "가챠에서 뽑음" : "쿠지에서 뽑음"}</Text>
        <ProductInfoDivider style={styles.productFieldDivider} />
        <Text style={styles.price}>{catalogPriceLabel(item.product.price)}</Text>
      </View>
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected ? <DecorativeIonicon name="checkmark" size={15} color={colors.ink} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  header: { minHeight: seed.size.topNavigation, paddingHorizontal: seed.spacing.x3_5, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  backButton: { width: seed.size.touchTarget, height: seed.size.touchTarget, alignItems: "center", justifyContent: "center" },
  headerSpacer: { width: seed.size.touchTarget },
  content: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x4, paddingBottom: seed.spacing.screenBottom },
  targetSection: { marginHorizontal: -seed.spacing.globalGutter, paddingHorizontal: seed.spacing.globalGutter, paddingBottom: seed.spacing.x5, borderBottomWidth: 8, borderBottomColor: seed.color.background.neutralWeak },
  targetOwnerRow: { flexDirection: "row", alignItems: "center", gap: seed.spacing.x2 },
  avatar: { width: 34, height: 34, borderRadius: seed.radius.full, backgroundColor: seed.color.background.neutralWeak, alignItems: "center", justifyContent: "center" },
  avatarLabel: { color: colors.greenInk, ...seed.typography.caption, fontWeight: "900" },
  targetOwner: { color: colors.ink, ...seed.typography.bodyStrong },
  targetDday: { marginLeft: "auto", overflow: "hidden", borderRadius: seed.radius.full, paddingHorizontal: seed.spacing.x3, paddingVertical: seed.spacing.x1_5, color: colors.muted, backgroundColor: seed.color.background.neutralWeak, ...seed.typography.caption, fontWeight: "800" },
  targetTitle: { marginTop: seed.spacing.x4, color: colors.ink, ...seed.typography.subtitle },
  targetProducts: { marginTop: seed.spacing.x3, gap: seed.spacing.x2 },
  targetProductRow: { minHeight: 104, borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.elevated, padding: seed.spacing.x3, flexDirection: "row", alignItems: "center", gap: seed.spacing.x3 },
  targetImage: { width: 80, height: 80, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.neutralWeak },
  targetCopy: { flex: 1, minWidth: 0 },
  targetItemIndex: { marginBottom: seed.spacing.x1, color: colors.greenInk, ...seed.typography.catalogMetadata, fontWeight: "700" },
  targetIpName: { color: colors.muted, ...seed.typography.catalogMetadata },
  targetProductName: { marginTop: seed.spacing.x1, color: colors.ink, ...seed.typography.catalogTitle },
  targetCategory: { marginTop: seed.spacing.x1, color: colors.muted, ...seed.typography.catalogMetadata },
  targetProductDivider: { marginTop: seed.spacing.x2 },
  targetMeta: { marginTop: seed.spacing.x1_5, color: colors.ink, ...seed.typography.catalogPrice },
  storageExpiry: { marginTop: seed.spacing.x1, color: colors.muted, ...seed.typography.caption },
  selectionHeader: { marginTop: seed.spacing.x6, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x3 },
  selectionSummary: { alignItems: "flex-end" },
  selectionCount: { color: colors.greenInk, ...seed.typography.caption, fontWeight: "800" },
  selectionRatio: { marginTop: seed.spacing.x0_5, color: colors.muted, ...seed.typography.finePrint },
  stateBox: { minHeight: 180, marginTop: seed.spacing.x4, borderRadius: seed.radius.r4, padding: seed.spacing.x5, alignItems: "center", justifyContent: "center", gap: seed.spacing.x2_5, backgroundColor: seed.color.layer.default },
  stateText: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: "center" },
  retryButton: { minHeight: seed.size.touchTarget, marginTop: seed.spacing.x2, paddingHorizontal: seed.spacing.x4, alignItems: "center", justifyContent: "center", borderRadius: seed.radius.r3, backgroundColor: seed.color.background.neutralSolid },
  retryLabel: { color: colors.white, fontSize: 13, fontWeight: "800" },
  productCard: { minHeight: 142, marginTop: seed.spacing.x3, flexDirection: "row", alignItems: "center", gap: seed.spacing.x3, ...catalogProductCardSurface, borderWidth: 2, borderColor: seed.color.stroke.neutral, padding: seed.spacing.x3 },
  productCardSelected: { borderColor: colors.greenInk, backgroundColor: seed.color.background.brandWeak },
  imageFrame: { width: 106, aspectRatio: 1, ...catalogProductImageSurface },
  image: { width: "100%", height: "100%" },
  imagePlaceholder: { flex: 1, alignItems: "center", justifyContent: "center" },
  imagePlaceholderText: { color: colors.muted, fontWeight: "700" },
  productInfo: { flex: 1, minWidth: 0 },
  ipName: { color: colors.muted, ...seed.typography.catalogMetadata },
  productName: { color: colors.ink, ...seed.typography.catalogTitle, marginTop: 3 },
  meta: { color: colors.muted, ...seed.typography.catalogMetadata, marginTop: 5 },
  productFieldDivider: { marginTop: 7 },
  price: { color: colors.ink, ...seed.typography.catalogPrice, marginTop: 5 },
  radio: { width: 24, height: 24, borderRadius: seed.radius.r3, borderWidth: 1.5, borderColor: seed.color.stroke.contrast, alignItems: "center", justifyContent: "center" },
  radioSelected: { borderColor: colors.greenInk, backgroundColor: colors.brand },
  submitButton: { minHeight: seed.size.actionButton.large, borderRadius: seed.radius.r3, alignItems: "center", justifyContent: "center", backgroundColor: seed.color.background.brandSolid },
  submitLabel: { color: colors.ink },
  pressed: { opacity: seed.state.pressedOpacity, transform: [{ scale: seed.state.pressedScale }] },
  disabled: { opacity: seed.state.disabledOpacity },
});
