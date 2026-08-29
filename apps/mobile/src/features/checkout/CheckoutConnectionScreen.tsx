import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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

const PAYMENT_LABELS: Record<PaymentMethodId, string> = {
  card: "간편카드",
  kakao: "카카오페이",
  naver: "네이버페이",
};

export function CheckoutConnectionScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    productId?: string | string[];
    quantity?: string | string[];
    pointUsed?: string | string[];
    paymentMethod?: string | string[];
  }>();
  const productId = firstParam(params.productId) ?? "";
  const requestedQuantity = positiveInteger(firstParam(params.quantity), 1, 10);
  const requestedPointUsed = nonNegativeInteger(firstParam(params.pointUsed));
  const paymentMethod = paymentMethodFromParam(firstParam(params.paymentMethod));
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
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const tokens = await readAuthTokens();
      const nextSnapshot = await fetchProductDetail(
        runtime.apiBaseUrl,
        productId,
        tokens?.accessToken,
      );
      setSnapshot(nextSnapshot);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "결제 연결 정보를 불러오지 못했습니다.");
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
  const pointUsed = Math.min(requestedPointUsed, subtotal);
  const paymentTotal = Math.max(0, subtotal - pointUsed);
  const assetBaseUrl = runtime.assetBaseUrl
    ?? (__DEV__ ? runtime.apiBaseUrl.replace(/:8788$/, ":4174") : null);
  const imageUri = product
    ? resolveCatalogImageUrl(product.imageUrl, assetBaseUrl, product.version)
    : null;

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/ppoba");
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="결제 준비로 돌아가기"
          hitSlop={10}
          onPress={goBack}
          style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={28} color={colors.ink} />
        </Pressable>
        <KoreanPixelTitle variant="header">결제 연결 안내</KoreanPixelTitle>
        <View style={styles.headerAction} />
      </View>

      {loading ? (
        <View style={styles.state}>
          <ActivityIndicator color={colors.ink} />
          <Text style={styles.stateBody}>다음 단계를 불러오는 중</Text>
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
            <View style={styles.hero}>
              <View style={styles.heroIcon}>
                <Ionicons name="link-outline" size={26} color={colors.greenInk} />
              </View>
              <Text style={styles.heroTitle}>실제 결제가 연결되면 이렇게 진행돼요</Text>
              <BalancedAppText style={styles.heroBody}>
                지금 선택한 상품과 결제 수단은 확인용이며 아직 돈이 결제되거나 주문이 만들어지지 않았어요.
              </BalancedAppText>
              <View style={styles.statusPill}>
                <View style={styles.statusDot} />
                <Text style={styles.statusText}>현재 상태 · 결제 전</Text>
              </View>
            </View>

            <View style={styles.section}>
              <KoreanPixelTitle variant="section" style={styles.sectionTitle}>주문 예정 상품</KoreanPixelTitle>
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
                    <Text style={styles.quantity}>{quantity}개</Text>
                  </View>
                </View>
              </View>
            </View>

            <View style={styles.section}>
              <KoreanPixelTitle variant="section" style={styles.sectionTitle}>선택 내용</KoreanPixelTitle>
              <SummaryRow label="결제 수단" value={PAYMENT_LABELS[paymentMethod]} />
              <SummaryRow label="포인트 사용 예정" value={`${pointUsed.toLocaleString("ko-KR")}P`} />
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>결제 예정 금액</Text>
                <Text style={styles.totalValue}>{paymentTotal.toLocaleString("ko-KR")}원</Text>
              </View>
            </View>

            <View style={styles.section}>
              <KoreanPixelTitle variant="section" style={styles.sectionTitle}>실제 서비스 진행 순서</KoreanPixelTitle>
              <CheckoutStep
                number={1}
                title="가격·재고 재확인"
                body="서버가 최신 가격, 재고, 포인트를 다시 계산해요."
              />
              <CheckoutStep
                number={2}
                title="PG 결제 승인"
                body="선택한 결제수단의 안전한 결제창에서 승인을 받아요."
              />
              <CheckoutStep
                number={3}
                title="서버 주문 확정"
                body="서명된 결제 결과를 확인한 뒤 주문을 한 번만 만들어요."
              />
              <CheckoutStep
                number={4}
                title={isDrawCategory(product.category) ? "추첨권 발급" : "배송 준비 등록"}
                body={isDrawCategory(product.category)
                  ? `결제가 확인된 뒤 서버가 추첨권 ${quantity}장을 발급해요.`
                  : "결제가 확인된 상품만 구매 내역과 배송 준비에 등록해요."}
                last
              />
            </View>

            <View style={styles.boundaryNote}>
              <Ionicons name="lock-closed-outline" size={20} color={colors.greenInk} />
              <BalancedAppText style={styles.boundaryText}>
                현재 로컬 앱에서는 PG 결제 요청을 보내지 않습니다. 따라서 결제 완료, 주문 번호, 추첨권도 생성되지 않아요.
              </BalancedAppText>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <View style={styles.footerTotal}>
              <Text style={styles.footerCaption}>결제 예정 금액</Text>
              <Text style={styles.footerValue}>{paymentTotal.toLocaleString("ko-KR")}원</Text>
            </View>
            <SeedActionButton
              label="뽀바로 돌아가기"
              onPress={() => router.replace("/(tabs)/ppoba")}
              style={styles.footerAction}
            />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function CheckoutStep({
  number,
  title,
  body,
  last = false,
}: {
  number: number;
  title: string;
  body: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.step, !last && styles.stepBorder]}>
      <View style={styles.stepNumber}><Text style={styles.stepNumberText}>{number}</Text></View>
      <View style={styles.stepCopy}>
        <Text style={styles.stepTitle}>{title}</Text>
        <BalancedAppText style={styles.stepBody}>{body}</BalancedAppText>
      </View>
      <Text style={styles.stepState}>대기</Text>
    </View>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInteger(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(Math.trunc(parsed), max)) : fallback;
}

function nonNegativeInteger(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function paymentMethodFromParam(value: string | undefined): PaymentMethodId {
  return value === "kakao" || value === "naver" ? value : "card";
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  header: { minHeight: seed.size.topNavigation, paddingHorizontal: seed.spacing.x3_5, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  headerAction: { width: seed.size.touchTarget, height: seed.size.touchTarget, alignItems: "center", justifyContent: "center" },
  state: { flex: 1, minHeight: 420, paddingHorizontal: seed.spacing.x7, alignItems: "center", justifyContent: "center", gap: seed.spacing.componentDefault },
  stateTitle: { color: colors.ink, ...seed.typography.subtitle, textAlign: "center" },
  stateBody: { color: colors.muted, ...seed.typography.body },
  content: { paddingHorizontal: seed.spacing.x3_5, paddingTop: seed.spacing.x3_5, paddingBottom: seed.spacing.x7, gap: seed.spacing.componentDefault },
  hero: { padding: seed.spacing.x5, borderRadius: seed.radius.r5, backgroundColor: seed.color.layer.inverted, alignItems: "flex-start" },
  heroIcon: { width: 48, height: 48, borderRadius: seed.radius.r3_5, backgroundColor: seed.color.layer.default, alignItems: "center", justifyContent: "center" },
  heroTitle: { marginTop: seed.spacing.x4, color: seed.color.foreground.inverted, fontSize: 21, lineHeight: 29, fontWeight: "900" },
  heroBody: { marginTop: seed.spacing.x2, color: "#C8CEC8", ...seed.typography.body },
  statusPill: { minHeight: 34, marginTop: seed.spacing.x4, paddingHorizontal: seed.spacing.x3, borderRadius: seed.radius.full, backgroundColor: "rgba(145,233,142,0.16)", flexDirection: "row", alignItems: "center", gap: seed.spacing.x2 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: seed.color.background.brandSolid },
  statusText: { color: colors.brand, ...seed.typography.label, fontWeight: "700" },
  section: { padding: seed.spacing.x3_5, borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  sectionTitle: { marginBottom: seed.spacing.x3 },
  productRow: { flexDirection: "row", alignItems: "center", gap: seed.spacing.componentDefault },
  productImage: { width: 84, height: 84, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.neutralWeak },
  productPlaceholder: { alignItems: "center", justifyContent: "center" },
  productCopy: { flex: 1, minWidth: 0 },
  ipName: { color: colors.muted, ...seed.typography.caption },
  productName: { marginTop: seed.spacing.x1, color: colors.ink, ...seed.typography.bodyStrong },
  productMeta: { marginTop: seed.spacing.x2, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2 },
  category: { paddingHorizontal: seed.spacing.x2, paddingVertical: seed.spacing.x1, borderRadius: seed.radius.r1_5, overflow: "hidden", color: colors.ink, backgroundColor: colors.brand, fontSize: 11, lineHeight: 15, fontWeight: "700" },
  quantity: { color: colors.muted, ...seed.typography.label, fontWeight: "700" },
  summaryRow: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x3, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.muted },
  summaryLabel: { color: colors.muted, ...seed.typography.body },
  summaryValue: { color: colors.ink, ...seed.typography.bodyStrong },
  totalRow: { minHeight: 52, paddingTop: seed.spacing.x2, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x3 },
  totalLabel: { color: colors.ink, ...seed.typography.bodyStrong },
  totalValue: { color: colors.ink, fontSize: 20, lineHeight: 27, fontWeight: "900" },
  step: { minHeight: 78, paddingVertical: seed.spacing.x3, flexDirection: "row", alignItems: "flex-start", gap: seed.spacing.x3 },
  stepBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.muted },
  stepNumber: { width: 30, height: 30, borderRadius: seed.radius.r2, backgroundColor: seed.color.background.neutralWeak, alignItems: "center", justifyContent: "center" },
  stepNumberText: { color: colors.ink, ...seed.typography.label, fontWeight: "900" },
  stepCopy: { flex: 1 },
  stepTitle: { color: colors.ink, ...seed.typography.bodyStrong },
  stepBody: { marginTop: seed.spacing.x1, color: colors.muted, ...seed.typography.caption },
  stepState: { overflow: "hidden", paddingHorizontal: seed.spacing.x2, paddingVertical: seed.spacing.x1, borderRadius: seed.radius.r2, color: colors.muted, backgroundColor: seed.color.background.neutralWeak, fontSize: 10, lineHeight: 14, fontWeight: "700" },
  boundaryNote: { minHeight: 82, padding: seed.spacing.x3_5, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.brandWeak, flexDirection: "row", alignItems: "flex-start", gap: seed.spacing.x2_5 },
  boundaryText: { flex: 1, color: colors.greenInk, ...seed.typography.bodyStrong },
  footer: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.componentDefault, paddingBottom: seed.spacing.x1, borderTopWidth: 1, borderTopColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default, flexDirection: "row", alignItems: "center", gap: seed.spacing.componentDefault },
  footerTotal: { width: 116 },
  footerCaption: { color: colors.muted, ...seed.typography.caption },
  footerValue: { marginTop: seed.spacing.x0_5, color: colors.ink, fontSize: 18, lineHeight: 24, fontWeight: "900" },
  footerAction: { flex: 1 },
  pressed: { opacity: seed.state.pressedOpacity },
});
