import Constants from "expo-constants";
import { randomUUID } from "expo-crypto";
import { type Href, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { errorMessage } from "@dabboba/api-client";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { CatalogProductImage } from "@/components/CatalogProductImage";
import { FloatingBottomActionPanel, useFloatingBottomActionContentInset } from "@/components/FloatingBottomActionPanel";
import { AppText as Text } from "@/components/Typography";
import { SeedActionButton } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import { openCustomerLogin } from "@/features/auth/login-navigation";
import { useCommerceCapability } from "@/features/commerce/CommerceCapabilityProvider";
import { fetchCheckoutActorId, fetchCheckoutOrder, fetchCheckoutPointBalance } from "./checkout-api";
import { assertDirectPurchaseOrder, parseDirectPurchaseIntent, type DirectPurchaseIntent } from "./direct-purchase-intent";
import { CheckoutNoticeSections } from "./CheckoutNoticeSections";
import { fetchProductDetail, isDirectPurchase, type ProductDetailSnapshot } from "@/features/shop/shop-api";
import { createMobileDabbobaClient } from "@/lib/mobile-api-client";
import { resolveMobileRuntimeConfig, type MobilePlatform } from "@/lib/runtime-config";
import { readAuthTokens } from "@/lib/session-store";

export function DirectPurchaseCheckoutScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ productId: string; quantity?: string }>();
  const productId = typeof params.productId === "string" ? params.productId : "";
  const db = useSQLiteContext();
  const { commerceEnabled } = useCommerceCapability();
  const bottomInset = useFloatingBottomActionContentInset();
  const runtime = useMemo(() => resolveMobileRuntimeConfig({
    configuredApiUrl: process.env.EXPO_PUBLIC_DABBOBA_API_URL,
    configuredAssetBaseUrl: process.env.EXPO_PUBLIC_DABBOBA_ASSET_BASE_URL,
    metroHostUri: Constants.expoConfig?.hostUri, platform: Platform.OS as MobilePlatform, development: __DEV__,
  }), []);
  const [snapshot, setSnapshot] = useState<ProductDetailSnapshot | null>(null);
  const [actorId, setActorId] = useState("");
  const [balance, setBalance] = useState(0);
  const [quantity, setQuantity] = useState(() => Math.max(1, Math.min(20, Number.parseInt(params.quantity ?? "1", 10) || 1)));
  const [usePoints, setUsePoints] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<DirectPurchaseIntent | null>(null);
  const mutation = useRef(false);
  const preferenceKey = (id: string) => `checkout.direct.pending.v1.${id}.${productId}`;

  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    setMessage("");
    void (async () => {
      const tokens = await readAuthTokens();
      if (!tokens) {
        if (active) openCustomerLogin("구매 내역은 로그인한 계정에 저장돼요.", `/checkout/direct/${productId}`);
        return;
      }
      const id = await fetchCheckoutActorId(runtime.apiBaseUrl, tokens.accessToken);
      const row = await db.getFirstAsync<{preference_value: string}>(
        "SELECT preference_value FROM app_preferences WHERE preference_key=?", preferenceKey(id));
      const saved = row ? parseDirectPurchaseIntent(row.preference_value) : null;
      if (saved && (saved.actorId !== id || saved.payload.productId !== productId)) throw new Error("저장된 주문의 계정과 상품을 확인해 주세요.");
      if (active) { setActorId(id); setPending(saved); }
      const [detail, points] = await Promise.all([
        fetchProductDetail(runtime.apiBaseUrl, productId, tokens.accessToken),
        fetchCheckoutPointBalance(runtime.apiBaseUrl, tokens.accessToken),
      ]);
      if (active) { setSnapshot(detail); setBalance(points); }
    })().catch(error => { if (active) setMessage(error instanceof Error ? error.message : "주문 정보를 불러오지 못했어요."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [db, productId, runtime.apiBaseUrl]));

  const product = snapshot?.product;
  const displayedQuantity = pending?.payload.quantity ?? quantity;
  const displayedUnitPrice = pending?.payload.unitPrice ?? product?.price ?? 0;
  const subtotal = displayedUnitPrice * displayedQuantity;
  const points = pending?.payload.pointAmount ?? (usePoints ? Math.min(balance, subtotal) : 0);
  const maxQuantity = Math.max(1, Math.min(product?.availableQuantity ?? 0, 20));

  async function purchase(recovery = false) {
    if (mutation.current || !actorId) return;
    mutation.current = true; setBusy(true); setMessage("");
    try {
      const tokens = await readAuthTokens();
      if (!tokens || await fetchCheckoutActorId(runtime.apiBaseUrl, tokens.accessToken) !== actorId) throw new Error("로그인 계정이 변경됐어요. 다시 로그인해 주세요.");
      let intent: DirectPurchaseIntent | null = null;
      await db.withExclusiveTransactionAsync(async transaction => {
        const row = await transaction.getFirstAsync<{preference_value: string}>(
          "SELECT preference_value FROM app_preferences WHERE preference_key=?", preferenceKey(actorId));
        if (row) intent = parseDirectPurchaseIntent(row.preference_value);
        else {
          if (recovery) throw new Error("복구할 주문이 없어요.");
          if (!commerceEnabled || !agreed || !product || !isDirectPurchase(product) || product.category === "kuji" || !product.purchasable
            || quantity > product.availableQuantity || !product.price) throw new Error("구매할 상품과 수량, 결제 동의를 다시 확인해 주세요.");
          intent = {actorId, key: `direct-order:${randomUUID()}`, payload: {productId, quantity, pointAmount: points, unitPrice: product.price}, createdAt: Date.now(), orderId: null};
          await transaction.runAsync("INSERT INTO app_preferences(preference_key,preference_value,updated_at) VALUES(?,?,?)",
            preferenceKey(actorId), JSON.stringify(intent), new Date().toISOString());
        }
      });
      const saved = intent as DirectPurchaseIntent | null;
      if (!saved || saved.actorId !== actorId || saved.payload.productId !== productId) throw new Error("주문 요청 정보가 달라요.");
      setPending(saved);
      const client = createMobileDabbobaClient({baseUrl: runtime.apiBaseUrl, token: () => tokens.accessToken, requestId: randomUUID});
      let orderId = saved.orderId;
      if (!orderId) {
        if (!commerceEnabled) throw new Error("이전 주문 확인은 판매 연결이 복구된 뒤 진행할 수 있어요.");
        if (Date.now() - saved.createdAt > 24 * 60 * 60 * 1000) throw new Error("이전 주문의 접수 여부를 고객센터에서 확인해 주세요. 새 주문은 만들지 않습니다.");
        const result = await client.POST("/v1/orders", {params: {header: {"Idempotency-Key": saved.key}},
          body: {items: [{productId: saved.payload.productId, quantity: saved.payload.quantity}], pointAmount: saved.payload.pointAmount}});
        if (!result.data) throw new Error(errorMessage(result.error, "주문 접수 여부를 확인하지 못했어요. 이전 주문 확인을 눌러 주세요."));
        assertDirectPurchaseOrder(saved, result.data);
        orderId = result.data.id;
        saved.orderId = orderId;
        await db.withExclusiveTransactionAsync(async transaction => {
          const row = await transaction.getFirstAsync<{preference_value: string}>("SELECT preference_value FROM app_preferences WHERE preference_key=?", preferenceKey(actorId));
          if (!row || parseDirectPurchaseIntent(row.preference_value).key !== saved.key) throw new Error("저장된 주문 요청이 바뀌었어요.");
          await transaction.runAsync("UPDATE app_preferences SET preference_value=?,updated_at=? WHERE preference_key=?", JSON.stringify(saved), new Date().toISOString(), preferenceKey(actorId));
        });
      }
      const order = await fetchCheckoutOrder(runtime.apiBaseUrl, tokens.accessToken, orderId);
      assertDirectPurchaseOrder(saved, order);
      const latest = await readAuthTokens();
      if (!latest || latest.accessToken !== tokens.accessToken) throw new Error("로그인 정보가 변경됐어요. 이전 주문 확인을 다시 눌러 주세요.");
      if (["PAID", "FULFILLED", "CANCELLED", "REFUNDED"].includes(order.status)) {
        await db.withExclusiveTransactionAsync(async transaction => {
          const row = await transaction.getFirstAsync<{preference_value: string}>("SELECT preference_value FROM app_preferences WHERE preference_key=?", preferenceKey(actorId));
          if (row && parseDirectPurchaseIntent(row.preference_value).key === saved.key) await transaction.runAsync("DELETE FROM app_preferences WHERE preference_key=?", preferenceKey(actorId));
        });
        setPending(null);
        router.replace(`/profile/orders/${encodeURIComponent(order.id)}` as Href);
      } else if (order.status === "PENDING_PAYMENT") {
        if (!commerceEnabled) throw new Error("판매 연결을 확인한 뒤 같은 주문의 결제를 계속해 주세요.");
        router.push(`/checkout/payment/${encodeURIComponent(order.id)}?productId=${encodeURIComponent(productId)}` as Href);
      } else throw new Error("확인이 필요한 주문이에요. 구매 내역 또는 고객센터에서 확인해 주세요.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "주문 상태를 확인하지 못했어요."); }
    finally { mutation.current = false; setBusy(false); }
  }

  return <SafeAreaView style={styles.page} edges={["top", "left", "right"]}>
    <DetailPageHeader title="주문·결제" titleMode="pixel" onBack={() => router.canGoBack() ? router.back() : router.replace("/(tabs)/gacha")} />
    <ScrollView contentContainerStyle={[styles.content, {paddingBottom: bottomInset}]}>
      {loading ? <ActivityIndicator /> : null}
      {message ? <Text accessibilityRole="alert" style={styles.copy}>{message}</Text> : null}
      {pending ? <SeedActionButton label="이전 주문 확인·계속하기" loading={busy} onPress={() => void purchase(true)} /> : null}
      {product ? <>
        <CatalogProductImage uri={product.imageUrl} resizeMode="contain" style={styles.image} />
        {snapshot.ip ? <Text style={styles.caption}>{snapshot.ip.nameKo}</Text> : null}
        <Text style={styles.title}>{product.name}</Text>
        <Text style={styles.copy}>상품 단가 {displayedUnitPrice.toLocaleString("ko-KR")}원</Text>
        <View style={styles.quantity}>
          <SeedActionButton label="−" accessibilityLabel="구매 수량 줄이기" disabled={busy || !!pending || quantity <= 1} onPress={() => setQuantity(q => q - 1)} />
          <Text accessibilityLiveRegion="polite" style={styles.copy}>{displayedQuantity}개</Text>
          <SeedActionButton label="＋" accessibilityLabel="구매 수량 늘리기" disabled={busy || !!pending || quantity >= maxQuantity} onPress={() => setQuantity(q => q + 1)} />
        </View>
        <Pressable accessibilityRole="checkbox" accessibilityState={{checked: usePoints, disabled: !!pending || busy}} disabled={!!pending || busy} onPress={() => setUsePoints(value => !value)} style={styles.check}>
          <Text style={styles.copy}>{usePoints ? "☑" : "☐"} 포인트 사용 · 보유 {balance.toLocaleString("ko-KR")}P</Text>
        </Pressable>
        <Text style={styles.copy}>신용카드 · 포인트 {points.toLocaleString("ko-KR")}P 사용</Text>
        <Text style={styles.title}>결제 금액 {(subtotal - points).toLocaleString("ko-KR")}원</Text>
        <CheckoutNoticeSections category="direct" />
        <Pressable accessibilityRole="checkbox" accessibilityState={{checked: agreed}} onPress={() => setAgreed(value => !value)} style={styles.check}>
          <Text style={styles.copy}>{agreed ? "☑" : "☐"} 선택한 상품·수량·금액과 취소·배송 규정을 확인하고 구매에 동의해요. (필수)</Text>
        </Pressable>
      </> : null}
    </ScrollView>
    <FloatingBottomActionPanel><SeedActionButton label={pending ? "이전 주문 확인" : "구매하기"} loading={busy}
      disabled={loading || !actorId || (!pending && (!commerceEnabled || product?.category === "kuji" || !product?.purchasable || !agreed || !isDirectPurchase(product)))} onPress={() => void purchase(!!pending)} /></FloatingBottomActionPanel>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: seed.color.layer.basement},
  content: {padding: seed.spacing.globalGutter, gap: seed.spacing.x4},
  image: {width: "100%", aspectRatio: 1},
  title: {fontSize: 18, lineHeight: 24, fontWeight: "700", color: seed.color.foreground.neutral},
  copy: {fontSize: 14, lineHeight: 20, color: seed.color.foreground.neutral},
  caption: {fontSize: 12, lineHeight: 18, color: seed.color.foreground.neutral},
  quantity: {flexDirection: "row", alignItems: "center", justifyContent: "space-between"},
  check: {minHeight: 44, justifyContent: "center"},
});
