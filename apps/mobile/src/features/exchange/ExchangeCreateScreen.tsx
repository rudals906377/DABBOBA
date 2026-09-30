import Constants from "expo-constants";
import { router, useFocusEffect, type Href } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
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
import { SeedActionButton, SeedInlineGuidance, SeedTextInput } from "@/design-system/components";
import { catalogProductCardSurface, catalogProductImageSurface } from "@/design-system/catalog";
import { subtleSectionHeaderRule } from "@/design-system/section";
import { seed } from "@/design-system/seed";
import { catalogPriceLabel } from "@/features/commerce/product-commerce-presentation";
import {
  categoryLabel,
  createExchangeListing,
  fetchExchangeListingInventory,
  type ExchangeListingInventorySnapshot,
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

const TITLE_LIMIT = 20;
const DETAILS_LIMIT = 5000;

export function ExchangeCreateScreen() {
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
  const [snapshot, setSnapshot] = useState<ExchangeListingInventorySnapshot | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
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
      const next = await fetchExchangeListingInventory(runtime.apiBaseUrl, tokens.accessToken);
      const currentTokens = await readAuthTokens();
      if (generation !== loadGeneration.current) return;
      if (currentTokens?.accessToken !== tokens.accessToken) {
        void loadRef.current();
        return;
      }
      setAccessToken(tokens.accessToken);
      setSessionStatus("authenticated");
      setSnapshot(next);
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
      setError(cause instanceof Error ? cause.message : "보관함 상품을 불러오지 못했어요.");
    } finally {
      if (generation === loadGeneration.current) setRefreshing(false);
    }
  }, [runtime.apiBaseUrl]);
  loadRef.current = load;

  useFocusEffect(useCallback(() => {
    void load();
    return () => {
      loadGeneration.current += 1;
    };
  }, [load]));

  const selected = snapshot?.items.filter((item) => selectedIds.includes(item.id)) ?? [];
  const hasEligibleItems = Boolean(snapshot?.items.length);
  const availableRatioLabel = selected.length === 1
    ? "가능 비율 1:1 · 1:2"
    : selected.length === 2
      ? "가능 비율 2:1 · 2:2"
      : "상품 1~2개 선택";
  const formComplete = Boolean(accessToken && selected.length > 0 && title.trim());
  const assetBaseUrl = runtime.assetBaseUrl
    ?? (__DEV__ ? runtime.apiBaseUrl.replace(/:8788$/, ":4174") : null);
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/exchange");
  };

  const submit = useCallback(() => {
    if (!accessToken || selected.length === 0 || !title.trim() || submitting) return;
    const trimmedTitle = title.trim();
    const trimmedDetails = details.trim() || trimmedTitle;
    Alert.alert(
      `선택한 상품 ${selected.length}개를 올릴까요?`,
      `${selected.map((item) => item.product.name).join("\n")}\n\n${availableRatioLabel}\n글이 열려 있는 동안 선택한 상품은 배송·환급·다른 교환에 사용할 수 없어요.`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "올리기",
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
                const created = await createExchangeListing(runtime.apiBaseUrl, accessToken, {
                  title: trimmedTitle,
                  details: trimmedDetails,
                  offeredInventoryUnitIds: selected.map((item) => item.id),
                });
                Alert.alert("교환 상품 등록 완료", `선택한 상품 ${selected.length}개를 교환방에 올렸어요.`, [
                  {
                    text: "확인",
                    onPress: () => router.replace({
                      pathname: "/exchange/[listingId]",
                      params: { listingId: created.id },
                    }),
                  },
                ]);
              } catch (cause) {
                Alert.alert(
                  "상품을 올리지 못했어요",
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
  }, [accessToken, availableRatioLabel, details, runtime.apiBaseUrl, selected, submitting, title]);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <DetailPageHeader title="교환 등록" titleMode="pixel" onBack={goBack} backLabel="교환방으로 돌아가기" />

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: hasEligibleItems ? floatingBottomInset + seed.spacing.x6 : seed.spacing.screenBottom },
          ]}
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.ink} />
          }
        >
          {sessionStatus === "loading" ? <LoadingState /> : null}

          {sessionStatus === "guest" || sessionStatus === "expired" ? (
            <ProfileSessionGate status={sessionStatus} returnTo="/exchange/new" guestBody="로그인하면 직접 뽑아 보관 중인 상품을 교환방에 올릴 수 있어요." />
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
              <DecorativeIonicon name="cube-outline" size={38} color={colors.muted} />
              <KoreanPixelTitle variant="section">등록 가능한 상품이 없어요</KoreanPixelTitle>
              <BalancedParagraphText
                paragraphs={[
                  "가챠로 뽑은 상품만 가능해요.",
                  "배송을 신청했거나 이미 받은 상품, 포인트 환급·다른 교환에 사용 중인 상품은 표시되지 않아요.",
                ]}
                style={styles.stateText}
              />
            </View>
          ) : null}

          {snapshot && snapshot.items.length > 0 ? (
            <View style={styles.selectionHeader}>
              <KoreanPixelTitle variant="section">교환 아이템 선택</KoreanPixelTitle>
              <View style={styles.selectionSummary}>
                <Text style={styles.selectionCount}>선택 {selectedIds.length}/2개</Text>
                <Text accessibilityLabel={availableRatioLabel} style={styles.selectionRatio}>{availableRatioLabel}</Text>
              </View>
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

          {sessionStatus === "authenticated" && hasEligibleItems ? (
            <View style={styles.formSection}>
              <KoreanPixelTitle variant="section">교환 메시지</KoreanPixelTitle>
              <SeedInlineGuidance style={styles.description}>목록에서 바로 이해할 수 있도록 짧게 적어 주세요.</SeedInlineGuidance>
              <FieldLabel label="메시지" count={`${title.length}/${TITLE_LIMIT}`} />
              <SeedTextInput
                value={title}
                onChangeText={setTitle}
                maxLength={TITLE_LIMIT}
                placeholder="예: 중복 상품 교환해요"
                placeholderTextColor={colors.muted}
                returnKeyType="next"
                style={styles.titleInput}
              />
              <FieldLabel label="추가 설명 (선택)" count={`${details.length}/${DETAILS_LIMIT}`} />
              <SeedTextInput
                value={details}
                onChangeText={setDetails}
                maxLength={DETAILS_LIMIT}
                multiline
                textAlignVertical="top"
                placeholder="상품 상태나 원하는 조건이 있다면 알려주세요."
                placeholderTextColor={colors.muted}
                style={styles.detailsInput}
              />
            </View>
          ) : null}
        </ScrollView>

      {sessionStatus === "authenticated" && hasEligibleItems ? <FloatingBottomActionPanel>
          <SeedActionButton
            label={selected.length ? "교환 등록하기" : "상품을 선택해 주세요"}
            disabled={!formComplete}
            loading={submitting}
            onPress={submit}
          />
      </FloatingBottomActionPanel> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function LoadingState() {
  return (
    <View style={styles.stateBox}>
      <ActivityIndicator color={colors.ink} />
      <Text style={styles.stateText}>보관함 상품을 불러오는 중</Text>
    </View>
  );
}

function FieldLabel({ label, count }: { label: string; count: string }) {
  return (
    <View style={styles.fieldHeader}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldCount}>{count}</Text>
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
      accessibilityLabel={`${item.product.name} 등록 상품 선택`}
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
        <Text style={styles.meta}>{categoryLabel(item.product.category)} · {inventorySourceLabel(item.sourceType)}</Text>
        <ProductInfoDivider style={styles.productFieldDivider} />
        <Text style={styles.price}>{catalogPriceLabel(item.product.price)}</Text>
      </View>
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected ? <DecorativeIonicon name="checkmark" size={15} color={colors.ink} /> : null}
      </View>
    </Pressable>
  );
}

function inventorySourceLabel(source: InventoryUnit["sourceType"]): string {
  if (source === "GACHA") return "가챠에서 뽑음";
  if (source === "KUJI") return "쿠지에서 뽑음";
  if (source === "PURCHASE") return "앱에서 구매";
  return "보관함 등록";
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  flex: { flex: 1 },
  header: { minHeight: seed.size.topNavigation, paddingHorizontal: seed.spacing.x3_5, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  backButton: { width: seed.size.touchTarget, height: seed.size.touchTarget, alignItems: "center", justifyContent: "center" },
  headerSpacer: { width: seed.size.touchTarget },
  content: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x5, paddingBottom: seed.spacing.x7 },
  description: { marginTop: seed.spacing.x2_5, marginBottom: seed.spacing.x2 },
  selectionHeader: { marginTop: seed.spacing.x3, ...subtleSectionHeaderRule, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x3 },
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
  meta: { color: colors.muted, ...seed.typography.catalogMetadata, marginTop: seed.spacing.x1 },
  productFieldDivider: { marginTop: seed.spacing.x2 },
  price: { color: colors.ink, ...seed.typography.catalogPrice, marginTop: seed.spacing.x1 },
  radio: { width: 24, height: 24, borderRadius: seed.radius.r3, borderWidth: 1.5, borderColor: seed.color.stroke.contrast, alignItems: "center", justifyContent: "center" },
  radioSelected: { borderColor: colors.greenInk, backgroundColor: colors.brand },
  formSection: { marginTop: seed.spacing.x8 },
  fieldHeader: { marginTop: seed.spacing.x4, marginBottom: seed.spacing.x2, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  fieldLabel: { color: colors.ink, fontSize: 13, lineHeight: 18, fontWeight: "800" },
  fieldCount: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  titleInput: { minHeight: seed.size.input, borderRadius: seed.radius.r3, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.elevated, paddingHorizontal: seed.spacing.x3_5, color: colors.ink, fontSize: 14 },
  detailsInput: { minHeight: 144, borderRadius: seed.radius.r3, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.elevated, paddingHorizontal: seed.spacing.x3_5, paddingVertical: seed.spacing.x3, color: colors.ink, fontSize: 14, lineHeight: 21 },
  pressed: { opacity: seed.state.pressedOpacity, transform: [{ scale: seed.state.pressedScale }] },
});
