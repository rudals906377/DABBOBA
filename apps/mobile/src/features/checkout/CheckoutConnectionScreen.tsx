import Constants from "expo-constants";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  FloatingBottomActionPanel,
  useFloatingBottomActionContentInset,
} from "@/components/FloatingBottomActionPanel";
import { CatalogProductImage } from "@/components/CatalogProductImage";
import { DecorativeIonicon } from "@/components/DecorativeIonicon";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { ProductInfoDivider } from "@/components/ProductInfoDivider";
import { AppText as Text } from "@/components/Typography";
import { SeedActionButton, SeedInlineGuidance } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import { CategoryAvailabilityState } from "@/features/catalog/CategoryAvailabilityState";
import { useStorefrontCategorySettings } from "@/features/catalog/StorefrontCategorySettingsProvider";
import { isCustomerProductCategoryComingSoon } from "@/features/catalog/product-categories";
import {
  categoryLabel,
  fetchProductDetail,
  type ProductDetailSnapshot,
} from "@/features/shop/shop-api";
import { productSubjectTitle } from "@/features/shop/product-title";
import { shopTabPathForCategory } from "@/features/shop/shop-navigation";
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
  useStorefrontCategorySettings();
  const router = useRouter();
  const floatingBottomInset = useFloatingBottomActionContentInset();
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
  const productComingSoon = isCustomerProductCategoryComingSoon(product?.category);
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
    else router.replace(shopTabPathForCategory(product?.category));
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <DetailPageHeader title="결제 연결 안내" onBack={goBack} backLabel="결제 준비로 돌아가기" />

      {loading ? (
        <View style={styles.state}>
          <ActivityIndicator color={colors.ink} />
          <Text style={styles.stateBody}>다음 단계를 불러오는 중</Text>
        </View>
      ) : message || !snapshot || !product ? (
        <View style={styles.state}>
          <DecorativeIonicon name="alert-circle-outline" size={34} color={colors.muted} />
          <Text style={styles.stateTitle}>{message || "상품을 찾을 수 없습니다."}</Text>
          <SeedActionButton label="다시 불러오기" variant="neutralSolid" onPress={() => void load()} />
        </View>
      ) : productComingSoon ? (
        <CategoryAvailabilityState category={product.category} />
      ) : (
        <>
          <ScrollView contentContainerStyle={[styles.content, { paddingBottom: floatingBottomInset + seed.spacing.x6 }]}>
            <SeedInlineGuidance>
              카드·간편결제 제공 화면은 아직 연결 준비 중이에요. 이 화면에서는 결제·주문·추첨권 발급을 진행하지 않아요.
            </SeedInlineGuidance>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>주문 예정 상품</Text>
              <View style={styles.productRow}>
                <View style={styles.productImage}>
                  <CatalogProductImage
                    uri={imageUri}
                    requestKey={product.version}
                    resizeMode="contain"
                    style={styles.productImageAsset}
                  />
                </View>
                <View style={styles.productCopy}>
                  <Text style={styles.ipName}>{snapshot.ip?.nameKo ?? "등록 작품"}</Text>
                  <Text numberOfLines={2} style={styles.productName}>
                    {productSubjectTitle(product.name, snapshot.ip?.nameKo)}
                  </Text>
                  <ProductInfoDivider style={styles.productFieldDivider} />
                  <View style={styles.productMeta}>
                    <Text style={styles.category}>{categoryLabel(product.category)}</Text>
                    <Text style={styles.quantity}>{quantity}개</Text>
                  </View>
                </View>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>선택 내용</Text>
              <SummaryRow label="요청된 결제 수단" value={`${PAYMENT_LABELS[paymentMethod]} · 준비 중`} />
              <SummaryRow label="포인트 사용 예정" value={`${pointUsed.toLocaleString("ko-KR")}P`} />
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>결제 예정 금액</Text>
                <Text style={styles.totalValue}>{paymentTotal.toLocaleString("ko-KR")}원</Text>
              </View>
            </View>

          </ScrollView>

          <FloatingBottomActionPanel panelStyle={styles.footer}>
            <View style={styles.footerTotal}>
              <Text style={styles.footerCaption}>결제 예정 금액</Text>
              <Text style={styles.footerValue}>{paymentTotal.toLocaleString("ko-KR")}원</Text>
            </View>
            <SeedActionButton
              label="결제 준비로 돌아가기"
              onPress={goBack}
              style={styles.footerAction}
            />
          </FloatingBottomActionPanel>
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
  state: { flex: 1, minHeight: 420, paddingHorizontal: seed.spacing.globalGutter, alignItems: "center", justifyContent: "center", gap: seed.spacing.componentDefault },
  stateTitle: { color: colors.ink, ...seed.typography.subtitle, textAlign: "center" },
  stateBody: { color: colors.muted, ...seed.typography.body },
  content: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x3_5, paddingBottom: seed.spacing.x7, gap: seed.spacing.componentDefault },
  section: { padding: seed.spacing.x3_5, borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  sectionTitle: { marginBottom: seed.spacing.x3, color: colors.ink, ...seed.typography.subtitle },
  productRow: { flexDirection: "row", alignItems: "center", gap: seed.spacing.componentDefault },
  productImage: { width: 84, height: 84, overflow: "hidden", borderRadius: seed.radius.r3, backgroundColor: seed.color.background.neutralWeak },
  productImageAsset: { width: "100%", height: "100%" },
  productCopy: { flex: 1, minWidth: 0 },
  ipName: { color: colors.muted, ...seed.typography.caption },
  productName: { marginTop: seed.spacing.x1, color: colors.ink, ...seed.typography.bodyStrong },
  productFieldDivider: { marginTop: seed.spacing.x2 },
  productMeta: { marginTop: seed.spacing.x2, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2 },
  category: { paddingHorizontal: seed.spacing.x2, paddingVertical: seed.spacing.x1, borderRadius: seed.radius.r1_5, overflow: "hidden", color: colors.ink, backgroundColor: colors.brand, fontSize: 11, lineHeight: 15, fontWeight: "700" },
  quantity: { color: colors.muted, ...seed.typography.label, fontWeight: "700" },
  summaryRow: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x3, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.muted },
  summaryLabel: { color: colors.muted, ...seed.typography.body },
  summaryValue: { color: colors.ink, ...seed.typography.bodyStrong },
  totalRow: { minHeight: 52, paddingTop: seed.spacing.x2, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x3 },
  totalLabel: { color: colors.ink, ...seed.typography.bodyStrong },
  totalValue: { color: colors.ink, fontSize: 20, lineHeight: 27, fontWeight: "900" },
  footer: { flexDirection: "row", alignItems: "center", gap: seed.spacing.componentDefault },
  footerTotal: { width: 116 },
  footerCaption: { color: colors.muted, ...seed.typography.caption },
  footerValue: { marginTop: seed.spacing.x0_5, color: colors.ink, fontSize: 18, lineHeight: 24, fontWeight: "900" },
  footerAction: { flex: 1 },
});
