import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
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
import { AppText as Text, BalancedAppText } from "@/components/Typography";
import { SeedActionButton } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import { fetchCheckoutPointBalance } from "@/features/checkout/checkout-api";
import {
  categoryLabel,
  fetchProductDetail,
  isDrawCategory,
  type ProductDetailSnapshot,
} from "@/features/shop/shop-api";
import { productSubjectTitle } from "@/features/shop/product-title";
import {
  resolveCatalogImageUrl,
  resolveMobileRuntimeConfig,
  type MobilePlatform,
} from "@/lib/runtime-config";
import { readAuthTokens } from "@/lib/session-store";
import { colors } from "@/theme";

type PaymentMethodId = "card" | "kakao" | "naver";

const PAYMENT_METHODS: Array<{
  id: PaymentMethodId;
  label: string;
  caption: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  { id: "card", label: "간편카드", caption: "PG 연동 준비 중", icon: "card-outline" },
  { id: "kakao", label: "카카오페이", caption: "PG 연동 준비 중", icon: "chatbubble-ellipses-outline" },
  { id: "naver", label: "네이버페이", caption: "PG 연동 준비 중", icon: "wallet-outline" },
];

export function CheckoutScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    productId?: string | string[];
    quantity?: string | string[];
  }>();
  const productId = firstParam(params.productId) ?? "";
  const requestedQuantity = quantityFromParam(firstParam(params.quantity));
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
  const [snapshot, setSnapshot] = useState<ProductDetailSnapshot | null>(null);
  const [pointBalance, setPointBalance] = useState(0);
  const [usePoints, setUsePoints] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodId>("card");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const tokens = await readAuthTokens();
      if (!tokens?.accessToken) throw new Error("로그인 후 결제 준비 화면을 확인할 수 있어요.");
      const [nextSnapshot, nextPointBalance] = await Promise.all([
        fetchProductDetail(runtime.apiBaseUrl, productId, tokens.accessToken),
        fetchCheckoutPointBalance(runtime.apiBaseUrl, tokens.accessToken),
      ]);
      setSnapshot(nextSnapshot);
      setPointBalance(nextPointBalance);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "결제 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [productId, runtime.apiBaseUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const product = snapshot?.product ?? null;
  const quantity = Math.max(
    1,
    Math.min(requestedQuantity, product?.availableQuantity ?? requestedQuantity, 10),
  );
  const subtotal = (product?.price ?? 0) * quantity;
  const pointUsed = usePoints ? Math.min(pointBalance, subtotal) : 0;
  const paymentTotal = Math.max(0, subtotal - pointUsed);
  const selectedPayment = PAYMENT_METHODS.find((method) => method.id === paymentMethod)
    ?? PAYMENT_METHODS[0]!;
  const assetBaseUrl = runtime.assetBaseUrl
    ?? (__DEV__ ? runtime.apiBaseUrl.replace(/:8788$/, ":4174") : null);
  const imageUri = product
    ? resolveCatalogImageUrl(product.imageUrl, assetBaseUrl, product.version)
    : null;

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/ppoba");
  };

  const openConnectionGuide = () => {
    if (!product) return;
    const query = new URLSearchParams({
      quantity: String(quantity),
      pointUsed: String(pointUsed),
      paymentMethod,
    });
    router.push(
      `/checkout/connect/${encodeURIComponent(product.id)}?${query.toString()}` as Href,
    );
  };

  const finishPreparation = () => {
    if (!product) return;
    Alert.alert(
      "결제 준비가 끝났어요",
      `${quantity}개 · ${paymentTotal.toLocaleString("ko-KR")}원 · ${selectedPayment.label}을 선택했어요. 현재 로컬 앱에서는 PG 결제와 주문 생성은 진행되지 않습니다.`,
      [{ text: "확인", onPress: openConnectionGuide }],
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="상품 상세로 돌아가기"
          hitSlop={10}
          onPress={goBack}
          style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={28} color={colors.ink} />
        </Pressable>
        <KoreanPixelTitle variant="header">결제 준비</KoreanPixelTitle>
        <View style={styles.headerAction} />
      </View>

      {loading ? (
        <View style={styles.state}>
          <ActivityIndicator color={colors.ink} />
          <Text style={styles.stateBody}>주문 정보를 불러오는 중</Text>
        </View>
      ) : message || !snapshot || !product ? (
        <View style={styles.state}>
          <Ionicons name="alert-circle-outline" size={34} color={colors.muted} />
          <Text style={styles.stateTitle}>{message || "상품을 찾을 수 없습니다."}</Text>
          <SeedActionButton label="다시 불러오기" variant="neutralSolid" onPress={() => void load()} />
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.lead}>
              <View style={styles.leadIcon}>
                <Ionicons name="shield-checkmark-outline" size={22} color={colors.greenInk} />
              </View>
              <View style={styles.leadCopy}>
                <KoreanPixelTitle variant="compact">주문 내용을 확인해 주세요</KoreanPixelTitle>
                <BalancedAppText style={styles.leadBody}>
                  상품과 금액을 다시 확인한 뒤 테스트 결제 수단을 선택해요.
                </BalancedAppText>
              </View>
            </View>

            <View style={styles.section}>
              <KoreanPixelTitle variant="section" style={styles.sectionTitle}>주문 상품</KoreanPixelTitle>
              <View style={styles.productRow}>
                {imageUri ? (
                  <Image source={{ uri: imageUri }} resizeMode="cover" style={styles.productImage} />
                ) : (
                  <View style={[styles.productImage, styles.productPlaceholder]}>
                    <Ionicons name="image-outline" size={24} color={colors.muted} />
                  </View>
                )}
                <View style={styles.productCopy}>
                  <Text style={styles.ipName}>{snapshot.ip?.nameKo ?? "등록 작품"}</Text>
                  <Text numberOfLines={2} style={styles.productName}>
                    {productSubjectTitle(product.name, snapshot.ip?.nameKo)}
                  </Text>
                  <View style={styles.productMeta}>
                    <Text style={styles.category}>{categoryLabel(product.category)}</Text>
                    <Text style={styles.productPrice}>{product.price.toLocaleString("ko-KR")}원 · {quantity}개</Text>
                  </View>
                </View>
              </View>
            </View>

            <View style={styles.section}>
              <KoreanPixelTitle variant="section" style={styles.sectionTitle}>할인·포인트</KoreanPixelTitle>
              <View style={styles.discountRow}>
                <View style={styles.rowIcon}>
                  <Ionicons name="ticket-outline" size={21} color={colors.ink} />
                </View>
                <View style={styles.rowCopy}>
                  <Text style={styles.rowTitle}>쿠폰</Text>
                  <Text style={styles.rowCaption}>쿠폰 기능 연결 준비 중</Text>
                </View>
                <Text style={styles.rowValue}>사용 안 함</Text>
              </View>
              <Pressable
                accessibilityRole="switch"
                accessibilityLabel="보유 포인트 모두 사용"
                accessibilityState={{ checked: usePoints, disabled: pointBalance <= 0 }}
                disabled={pointBalance <= 0}
                onPress={() => setUsePoints((current) => !current)}
                style={({ pressed }) => [styles.discountRow, pressed && styles.pressed, pointBalance <= 0 && styles.disabled]}
              >
                <View style={styles.rowIcon}>
                  <Ionicons name="diamond-outline" size={21} color={colors.ink} />
                </View>
                <View style={styles.rowCopy}>
                  <Text style={styles.rowTitle}>포인트</Text>
                  <Text style={styles.rowCaption}>보유 {pointBalance.toLocaleString("ko-KR")}P</Text>
                </View>
                <View style={[styles.toggle, usePoints && styles.toggleSelected]}>
                  <View style={[styles.toggleKnob, usePoints && styles.toggleKnobSelected]} />
                </View>
              </Pressable>
            </View>

            <View style={styles.section}>
              <KoreanPixelTitle variant="section" style={styles.sectionTitle}>결제 수단</KoreanPixelTitle>
              <Text style={styles.sectionCaption}>화면 확인용 선택이며 아직 PG와 연결되지 않았어요.</Text>
              <View style={styles.paymentList} accessibilityRole="radiogroup">
                {PAYMENT_METHODS.map((method, index) => {
                  const selected = paymentMethod === method.id;
                  return (
                    <Pressable
                      key={method.id}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      onPress={() => setPaymentMethod(method.id)}
                      style={({ pressed }) => [
                        styles.paymentMethod,
                        index > 0 && styles.paymentMethodBorder,
                        selected && styles.paymentMethodSelected,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Ionicons name={method.icon} size={22} color={selected ? colors.greenInk : colors.ink} />
                      <View style={styles.paymentCopy}>
                        <Text style={styles.paymentTitle}>{method.label}</Text>
                        <Text style={styles.paymentCaption}>{method.caption}</Text>
                      </View>
                      <Ionicons
                        name={selected ? "checkmark-circle" : "ellipse-outline"}
                        size={22}
                        color={selected ? colors.greenInk : seed.color.stroke.contrast}
                      />
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.section}>
              <KoreanPixelTitle variant="section" style={styles.sectionTitle}>결제 금액</KoreanPixelTitle>
              <PriceRow label="상품 금액" value={`${subtotal.toLocaleString("ko-KR")}원`} />
              <PriceRow label="포인트 사용" value={pointUsed ? `-${pointUsed.toLocaleString("ko-KR")}원` : "0원"} />
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>최종 결제 예정 금액</Text>
                <Text style={styles.totalValue}>{paymentTotal.toLocaleString("ko-KR")}원</Text>
              </View>
            </View>

            {isDrawCategory(product.category) ? (
              <View style={styles.drawNote}>
                <Ionicons name="dice-outline" size={21} color={colors.greenInk} />
                <BalancedAppText style={styles.drawNoteText}>
                  실제 결제가 확인된 뒤에만 서버가 추첨권 {quantity}장을 발급하고 결과를 확정해요.
                </BalancedAppText>
              </View>
            ) : null}

            <View style={styles.secureNote}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.muted} />
              <BalancedAppText style={styles.secureNoteText}>
                현재 로컬 화면에서는 PG 결제와 주문 생성은 진행되지 않습니다. 실제 서비스에서는 서버가 가격·재고·포인트를 다시 확인한 뒤 PG 승인 결과로 주문을 확정합니다.
              </BalancedAppText>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <View style={styles.footerTotal}>
              <Text style={styles.footerCaption}>결제 예정 금액</Text>
              <Text style={styles.footerValue}>{paymentTotal.toLocaleString("ko-KR")}원</Text>
            </View>
            <SeedActionButton
              label="결제 준비 완료"
              onPress={finishPreparation}
              style={styles.footerAction}
            />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

function PriceRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.priceRow}>
      <Text style={styles.priceLabel}>{label}</Text>
      <Text style={styles.priceValue}>{value}</Text>
    </View>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function quantityFromParam(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(Math.trunc(parsed), 10)) : 1;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  header: { minHeight: seed.size.topNavigation, paddingHorizontal: seed.spacing.x3_5, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  headerAction: { width: seed.size.touchTarget, height: seed.size.touchTarget, alignItems: "center", justifyContent: "center" },
  state: { flex: 1, minHeight: 420, paddingHorizontal: seed.spacing.x7, alignItems: "center", justifyContent: "center", gap: seed.spacing.componentDefault },
  stateTitle: { color: colors.ink, ...seed.typography.subtitle, textAlign: "center" },
  stateBody: { color: colors.muted, ...seed.typography.body },
  content: { paddingHorizontal: seed.spacing.x3_5, paddingTop: seed.spacing.x3_5, paddingBottom: seed.spacing.x7, gap: seed.spacing.componentDefault },
  lead: { minHeight: 88, padding: seed.spacing.x3_5, borderRadius: seed.radius.r4, backgroundColor: seed.color.background.brandWeak, flexDirection: "row", alignItems: "flex-start", gap: seed.spacing.x3 },
  leadIcon: { width: seed.size.touchTarget, height: seed.size.touchTarget, borderRadius: seed.radius.r3, backgroundColor: seed.color.layer.default, alignItems: "center", justifyContent: "center" },
  leadCopy: { flex: 1, paddingTop: seed.spacing.x0_5 },
  leadBody: { marginTop: seed.spacing.x1_5, color: colors.muted, ...seed.typography.body },
  section: { padding: seed.spacing.x3_5, borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  sectionTitle: { marginBottom: seed.spacing.x3 },
  sectionCaption: { marginTop: -seed.spacing.x1_5, marginBottom: seed.spacing.x3, color: colors.muted, ...seed.typography.caption },
  productRow: { flexDirection: "row", alignItems: "center", gap: seed.spacing.componentDefault },
  productImage: { width: 88, height: 88, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.neutralWeak },
  productPlaceholder: { alignItems: "center", justifyContent: "center" },
  productCopy: { flex: 1, minWidth: 0 },
  ipName: { color: colors.muted, ...seed.typography.caption },
  productName: { marginTop: seed.spacing.x1, color: colors.ink, ...seed.typography.bodyStrong },
  productMeta: { marginTop: seed.spacing.x2, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x2 },
  category: { paddingHorizontal: seed.spacing.x2, paddingVertical: seed.spacing.x1, borderRadius: seed.radius.r1_5, overflow: "hidden", color: colors.ink, backgroundColor: colors.brand, fontSize: 11, lineHeight: 15, fontWeight: "700" },
  productPrice: { flex: 1, color: colors.ink, ...seed.typography.label, fontWeight: "700", textAlign: "right" },
  discountRow: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2_5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: seed.color.stroke.muted },
  rowIcon: { width: 36, height: 36, borderRadius: seed.radius.r2_5, backgroundColor: seed.color.background.neutralWeak, alignItems: "center", justifyContent: "center" },
  rowCopy: { flex: 1 },
  rowTitle: { color: colors.ink, ...seed.typography.bodyStrong },
  rowCaption: { marginTop: seed.spacing.x0_5, color: colors.muted, ...seed.typography.caption },
  rowValue: { color: colors.muted, ...seed.typography.label, fontWeight: "700" },
  toggle: { width: 46, height: 28, padding: 3, borderRadius: seed.radius.full, backgroundColor: seed.color.background.disabled, justifyContent: "center" },
  toggleSelected: { backgroundColor: seed.color.background.brandSolid },
  toggleKnob: { width: 22, height: 22, borderRadius: seed.radius.full, backgroundColor: seed.color.layer.elevated },
  toggleKnobSelected: { alignSelf: "flex-end" },
  paymentList: { overflow: "hidden", borderRadius: seed.radius.r3, borderWidth: 1, borderColor: seed.color.stroke.neutral },
  paymentMethod: { minHeight: 62, paddingHorizontal: seed.spacing.x3, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2_5, backgroundColor: seed.color.layer.basement },
  paymentMethodBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: seed.color.stroke.neutral },
  paymentMethodSelected: { backgroundColor: seed.color.background.brandWeak },
  paymentCopy: { flex: 1 },
  paymentTitle: { color: colors.ink, ...seed.typography.bodyStrong },
  paymentCaption: { marginTop: seed.spacing.x0_5, color: colors.muted, ...seed.typography.caption },
  priceRow: { minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x3 },
  priceLabel: { color: colors.muted, ...seed.typography.body },
  priceValue: { color: colors.ink, ...seed.typography.bodyStrong },
  totalRow: { marginTop: seed.spacing.x2, paddingTop: seed.spacing.x3, borderTopWidth: 1, borderTopColor: seed.color.stroke.neutral, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x3 },
  totalLabel: { color: colors.ink, ...seed.typography.bodyStrong },
  totalValue: { color: colors.ink, fontSize: 20, lineHeight: 27, fontWeight: "900" },
  drawNote: { minHeight: 64, padding: seed.spacing.x3_5, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.brandWeak, flexDirection: "row", alignItems: "flex-start", gap: seed.spacing.x2_5 },
  drawNoteText: { flex: 1, color: colors.greenInk, ...seed.typography.bodyStrong },
  secureNote: { paddingHorizontal: seed.spacing.x1, paddingTop: seed.spacing.x1, flexDirection: "row", alignItems: "flex-start", gap: seed.spacing.x2 },
  secureNoteText: { flex: 1, color: colors.muted, ...seed.typography.caption },
  footer: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.componentDefault, paddingBottom: seed.spacing.x1, borderTopWidth: 1, borderTopColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default, flexDirection: "row", alignItems: "center", gap: seed.spacing.componentDefault },
  footerTotal: { width: 116 },
  footerCaption: { color: colors.muted, ...seed.typography.caption },
  footerValue: { marginTop: seed.spacing.x0_5, color: colors.ink, fontSize: 18, lineHeight: 24, fontWeight: "900" },
  footerAction: { flex: 1 },
  pressed: { opacity: seed.state.pressedOpacity },
  disabled: { opacity: seed.state.disabledOpacity },
});
