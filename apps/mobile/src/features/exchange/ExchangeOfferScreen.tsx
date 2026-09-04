import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  FloatingBottomActionPanel,
  useFloatingBottomActionContentInset,
} from "@/components/FloatingBottomActionPanel";
import { ProductInfoDivider } from "@/components/ProductInfoDivider";
import { KoreanPixelTitle } from "@/components/RootCategoryTitle";
import { AppText as Text, BalancedParagraphText } from "@/components/Typography";
import { seed } from "@/design-system/seed";
import {
  categoryLabel,
  createExchangeOffer,
  fetchExchangeOfferInventory,
  type ExchangeOfferInventorySnapshot,
} from "@/features/exchange/exchange-api";
import { toggleExchangeInventorySelection } from "@/features/exchange/exchange-selection";
import { productSubjectTitle } from "@/features/shop/product-title";
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
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
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
        setError("로그인 후 가챠로 직접 뽑아 현재 보관 중인 상품을 선택할 수 있어요.");
        return;
      }
      const next = await fetchExchangeOfferInventory(runtime.apiBaseUrl, tokens.accessToken);
      setAccessToken(tokens.accessToken);
      setSnapshot(next);
      setSelectedIds((current) => current.filter((id) => next.items.some((item) => item.id === id)).slice(0, 2));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "내가 뽑은 상품을 불러오지 못했습니다.");
    } finally {
      setRefreshing(false);
    }
  }, [runtime.apiBaseUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = snapshot?.items.filter((item) => selectedIds.includes(item.id)) ?? [];
  const assetBaseUrl = runtime.assetBaseUrl
    ?? (__DEV__ ? runtime.apiBaseUrl.replace(/:8788$/, ":4174") : null);

  const submit = useCallback(() => {
    if (!listingId || !accessToken || selected.length === 0 || submitting) return;
    Alert.alert(
      `선택한 상품 ${selected.length}개로 신청할까요?`,
      `${selected.map((item) => item.product.name).join("\n")}\n\n신청에는 별도 글이 포함되지 않으며 선택한 상품 정보만 전달돼요.`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "교환 신청",
          onPress: () => {
            void (async () => {
              try {
                setSubmitting(true);
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
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="교환 상세로 돌아가기"
          hitSlop={10}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
        <KoreanPixelTitle variant="header">교환 신청</KoreanPixelTitle>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: floatingBottomInset }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.ink} />
        }
      >
        <KoreanPixelTitle variant="section">내가 뽑은 상품</KoreanPixelTitle>
        <Text style={styles.description}>
          가챠로 직접 뽑아 현재 보관 중인 상품을 최대 2개까지 선택할 수 있어요. 글이나 설명은 작성하지 않아요.
        </Text>

        {snapshot && snapshot.items.length > 0 ? (
          <Text style={styles.selectionCount}>선택 {selectedIds.length}/2개</Text>
        ) : null}

        {!snapshot && !error ? (
          <View style={styles.stateBox}>
            <ActivityIndicator color={colors.ink} />
            <Text style={styles.stateText}>교환 가능한 상품을 불러오는 중</Text>
          </View>
        ) : null}

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

      <FloatingBottomActionPanel>
        <Pressable
          accessibilityRole="button"
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
            <Text style={styles.submitLabel}>{selected.length ? `선택한 ${selected.length}개로 교환 신청하기` : "상품을 선택해 주세요"}</Text>
          )}
        </Pressable>
      </FloatingBottomActionPanel>
    </SafeAreaView>
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
      accessibilityLabel={`${item.product.name} 교환 신청 상품 선택`}
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
        <Text style={styles.meta}>{categoryLabel(item.product.category)} · {item.sourceType === "GACHA" ? "가챠에서 뽑음" : "쿠지에서 뽑음"}</Text>
        <ProductInfoDivider style={styles.productFieldDivider} />
        <Text style={styles.price}>{item.product.price.toLocaleString("ko-KR")}원</Text>
      </View>
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected ? <Ionicons name="checkmark" size={15} color={colors.ink} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  header: { minHeight: seed.size.topNavigation, paddingHorizontal: seed.spacing.x3_5, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  backButton: { width: seed.size.touchTarget, height: seed.size.touchTarget, alignItems: "center", justifyContent: "center" },
  headerSpacer: { width: seed.size.touchTarget },
  content: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x5, paddingBottom: seed.spacing.screenBottom },
  description: { color: colors.muted, fontSize: 13, lineHeight: 21, marginTop: seed.spacing.x2_5, marginBottom: seed.spacing.x2 },
  selectionCount: { alignSelf: "flex-end", color: colors.greenInk, fontSize: 12, lineHeight: 18, fontWeight: "800" },
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
  submitButton: { minHeight: seed.size.actionButton.large, borderRadius: seed.radius.r3, alignItems: "center", justifyContent: "center", backgroundColor: seed.color.background.brandSolid },
  submitLabel: { color: colors.ink, fontSize: 15, fontWeight: "900" },
  pressed: { opacity: seed.state.pressedOpacity },
  disabled: { opacity: seed.state.disabledOpacity },
});
