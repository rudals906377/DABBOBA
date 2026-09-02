import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  FloatingBottomActionPanel,
  useFloatingBottomActionContentInset,
} from "@/components/FloatingBottomActionPanel";
import { ProductInfoDivider } from "@/components/ProductInfoDivider";
import { KoreanPixelTitle } from "@/components/RootCategoryTitle";
import { AppText as Text, AppTextInput, BalancedParagraphText } from "@/components/Typography";
import { SeedActionButton } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import {
  categoryLabel,
  createExchangeListing,
  fetchExchangeListingInventory,
  type ExchangeListingInventorySnapshot,
} from "@/features/exchange/exchange-api";
import { productSubjectTitle } from "@/features/shop/product-title";
import {
  resolveCatalogImageUrl,
  resolveMobileRuntimeConfig,
  type MobilePlatform,
} from "@/lib/runtime-config";
import { readAuthTokens } from "@/lib/session-store";
import { colors } from "@/theme";

const TITLE_LIMIT = 160;
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const tokens = await readAuthTokens();
      if (!tokens) {
        setAccessToken(null);
        setSnapshot(null);
        setError("로그인 후 가챠로 직접 뽑아 현재 보관 중인 상품을 교환방에 올릴 수 있어요.");
        return;
      }
      const next = await fetchExchangeListingInventory(runtime.apiBaseUrl, tokens.accessToken);
      setAccessToken(tokens.accessToken);
      setSnapshot(next);
      setSelectedId((current) => next.items.some((item) => item.id === current) ? current : null);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "보관함 상품을 불러오지 못했습니다.");
    } finally {
      setRefreshing(false);
    }
  }, [runtime.apiBaseUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = snapshot?.items.find((item) => item.id === selectedId) ?? null;
  const formComplete = Boolean(accessToken && selected && title.trim() && details.trim());
  const assetBaseUrl = runtime.assetBaseUrl
    ?? (__DEV__ ? runtime.apiBaseUrl.replace(/:8788$/, ":4174") : null);

  const submit = useCallback(() => {
    if (!accessToken || !selected || !title.trim() || !details.trim() || submitting) return;
    const trimmedTitle = title.trim();
    const trimmedDetails = details.trim();
    Alert.alert(
      "이 상품을 교환방에 올릴까요?",
      `${selected.product.name}\n\n글이 열려 있는 동안 선택한 상품은 배송·환급·다른 교환에 사용할 수 없어요.`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "올리기",
          onPress: () => {
            void (async () => {
              try {
                setSubmitting(true);
                const created = await createExchangeListing(runtime.apiBaseUrl, accessToken, {
                  title: trimmedTitle,
                  details: trimmedDetails,
                  offeredInventoryUnitId: selected.id,
                });
                Alert.alert("교환 상품 등록 완료", "선택한 상품을 교환방에 올렸어요.", [
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
  }, [accessToken, details, runtime.apiBaseUrl, selected, submitting, title]);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="교환방으로 돌아가기"
          hitSlop={10}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
        <KoreanPixelTitle variant="header">교환 상품 등록</KoreanPixelTitle>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: floatingBottomInset }]}
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.ink} />
          }
        >
          {!snapshot && !error ? <LoadingState /> : null}

          {error ? (
            <View style={styles.stateBox}>
              <KoreanPixelTitle variant="section">상품을 확인할 수 없어요</KoreanPixelTitle>
              <Text style={styles.stateText}>{error}</Text>
              <Pressable accessibilityRole="button" onPress={() => void load(true)} style={styles.retryButton}>
                <Text style={styles.retryLabel}>다시 불러오기</Text>
              </Pressable>
            </View>
          ) : null}

          {snapshot && snapshot.items.length === 0 ? (
            <View style={styles.stateBox}>
              <Ionicons name="cube-outline" size={38} color={colors.muted} />
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

          {snapshot?.items.map((item) => (
            <InventoryChoice
              key={item.id}
              item={item}
              ipName={snapshot.ipNames[item.product.ipId] ?? null}
              assetBaseUrl={assetBaseUrl}
              selected={selectedId === item.id}
              onSelect={() => setSelectedId(item.id)}
            />
          ))}

          {snapshot && snapshot.items.length > 0 ? (
            <View style={styles.formSection}>
              <KoreanPixelTitle variant="section">교환글 작성</KoreanPixelTitle>
              <Text style={styles.description}>
                원하는 교환 조건과 상품 상태를 적어 주세요. 신청자는 글 없이 본인이 뽑은 상품 1개만 보낼 수 있어요.
              </Text>

              <FieldLabel label="교환글 제목" count={`${title.length}/${TITLE_LIMIT}`} />
              <AppTextInput
                value={title}
                onChangeText={setTitle}
                maxLength={TITLE_LIMIT}
                placeholder="예: 중복으로 나온 상품 교환해요"
                placeholderTextColor={colors.muted}
                returnKeyType="next"
                style={styles.titleInput}
              />

              <FieldLabel label="상품 설명" count={`${details.length}/${DETAILS_LIMIT}`} />
              <AppTextInput
                value={details}
                onChangeText={setDetails}
                maxLength={DETAILS_LIMIT}
                multiline
                textAlignVertical="top"
                placeholder="상품 상태와 원하는 교환 조건을 알려주세요."
                placeholderTextColor={colors.muted}
                style={styles.detailsInput}
              />

            </View>
          ) : null}
        </ScrollView>

        <FloatingBottomActionPanel>
          <SeedActionButton
            label={selected ? "교환 상품 올리기" : "상품을 선택해 주세요"}
            disabled={!formComplete}
            loading={submitting}
            onPress={submit}
          />
        </FloatingBottomActionPanel>
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
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${item.product.name} 등록 상품 선택`}
      onPress={onSelect}
      style={({ pressed }) => [styles.productCard, selected && styles.productCardSelected, pressed && styles.pressed]}
    >
      <View style={styles.imageFrame}>
        {imageUri ? (
          <Image source={{ uri: imageUri }} resizeMode="cover" style={styles.image} />
        ) : (
          <View style={styles.imagePlaceholder}><Text style={styles.imagePlaceholderText}>ITEM</Text></View>
        )}
      </View>
      <View style={styles.productInfo}>
        <Text numberOfLines={1} style={styles.ipName}>{ipName ?? "작품 정보 확인 중"}</Text>
        <Text numberOfLines={2} style={styles.productName}>{productSubjectTitle(item.product.name, ipName)}</Text>
        <Text style={styles.meta}>{categoryLabel(item.product.category)} · {inventorySourceLabel(item.sourceType)}</Text>
        <ProductInfoDivider style={styles.productFieldDivider} />
        <Text style={styles.price}>{item.product.price.toLocaleString("ko-KR")}원</Text>
      </View>
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected ? <Ionicons name="checkmark" size={15} color={colors.ink} /> : null}
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
  description: { color: colors.muted, fontSize: 13, lineHeight: 21, marginTop: seed.spacing.x2_5, marginBottom: seed.spacing.x2 },
  stateBox: { minHeight: 180, marginTop: seed.spacing.x4, borderRadius: seed.radius.r4, padding: seed.spacing.x5, alignItems: "center", justifyContent: "center", gap: seed.spacing.x2_5, backgroundColor: seed.color.layer.default },
  stateText: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: "center" },
  retryButton: { minHeight: seed.size.touchTarget, marginTop: seed.spacing.x2, paddingHorizontal: seed.spacing.x4, alignItems: "center", justifyContent: "center", borderRadius: seed.radius.r3, backgroundColor: seed.color.background.neutralSolid },
  retryLabel: { color: colors.white, fontSize: 13, fontWeight: "800" },
  productCard: { minHeight: 142, marginTop: seed.spacing.x3, flexDirection: "row", alignItems: "center", gap: seed.spacing.x3, borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default, padding: seed.spacing.x3 },
  productCardSelected: { borderWidth: 2, borderColor: colors.greenInk, backgroundColor: seed.color.background.brandWeak },
  imageFrame: { width: 106, aspectRatio: 1, overflow: "hidden", borderRadius: seed.radius.r3, backgroundColor: seed.color.layer.basement },
  image: { width: "100%", height: "100%" },
  imagePlaceholder: { flex: 1, alignItems: "center", justifyContent: "center" },
  imagePlaceholderText: { color: colors.muted, fontFamily: "monospace", fontSize: 10, fontWeight: "800" },
  productInfo: { flex: 1, minWidth: 0 },
  ipName: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  productName: { color: colors.ink, fontSize: 15, lineHeight: 21, fontWeight: "900", marginTop: 3 },
  meta: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 5 },
  productFieldDivider: { marginTop: 7 },
  price: { color: colors.ink, fontSize: 16, lineHeight: 22, fontWeight: "900", marginTop: 5 },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: seed.color.stroke.contrast, alignItems: "center", justifyContent: "center" },
  radioSelected: { borderColor: colors.greenInk, backgroundColor: colors.brand },
  formSection: { marginTop: seed.spacing.x8 },
  fieldHeader: { marginTop: seed.spacing.x4, marginBottom: seed.spacing.x2, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  fieldLabel: { color: colors.ink, fontSize: 13, lineHeight: 18, fontWeight: "800" },
  fieldCount: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  titleInput: { minHeight: seed.size.input, borderRadius: seed.radius.r3, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.elevated, paddingHorizontal: seed.spacing.x3_5, color: colors.ink, fontSize: 14 },
  detailsInput: { minHeight: 144, borderRadius: seed.radius.r3, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.elevated, paddingHorizontal: seed.spacing.x3_5, paddingVertical: seed.spacing.x3, color: colors.ink, fontSize: 14, lineHeight: 21 },
  pressed: { opacity: seed.state.pressedOpacity },
});
