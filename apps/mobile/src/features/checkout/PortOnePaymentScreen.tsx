import { Payment } from "@portone/react-native-sdk";
import Constants from "expo-constants";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, Platform, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { DecorativeIonicon } from "@/components/DecorativeIonicon";
import { AppText as Text } from "@/components/Typography";
import { SeedActionButton } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import {
  confirmPortOnePayment,
  fetchCheckoutOrder,
  paidKujiOrderEntitlementIds,
  type CheckoutOrder,
} from "@/features/checkout/checkout-api";
import { presentDrawOpenModeChoice } from "@/features/draw/draw-open-mode-prompt";
import {
  resolveMobileRuntimeConfig,
  type MobilePlatform,
} from "@/lib/runtime-config";
import { readAuthTokens } from "@/lib/session-store";
import { colors } from "@/theme";

type PaymentPhase = "loading" | "paying" | "confirming" | "pending" | "failed";

export function PortOnePaymentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    orderId?: string | string[];
    productId?: string | string[];
    category?: string | string[];
    quantity?: string | string[];
    kujiEntryId?: string | string[];
    paymentId?: string | string[];
  }>();
  const orderId = firstParam(params.orderId) ?? "";
  const productId = firstParam(params.productId) ?? "";
  const requestedCategory = firstParam(params.category);
  const kujiEntryId = firstParam(params.kujiEntryId);
  const redirectPaymentId = firstParam(params.paymentId);
  const requestedQuantity = positiveInteger(firstParam(params.quantity), 1);
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
  const storeId = process.env.EXPO_PUBLIC_PORTONE_STORE_ID?.trim() ?? "";
  const channelKey = process.env.EXPO_PUBLIC_PORTONE_CHANNEL_KEY?.trim() ?? "";
  const [order, setOrder] = useState<CheckoutOrder | null>(null);
  const [phase, setPhase] = useState<PaymentPhase>("loading");
  const [message, setMessage] = useState("");
  const confirmingRef = useRef(false);
  const completedRef = useRef(false);

  const continueToDraw = useCallback((paidOrder: CheckoutOrder) => {
    if (completedRef.current) return;
    if (paidOrder.orderKind === "SHIPPING_FEE") {
      if (!paidOrder.shippingRequestId) {
        setPhase("failed");
        setMessage("결제는 확인됐지만 배송 신청 정보를 찾지 못했습니다. 고객지원에서 결제 번호를 알려 주세요.");
        return;
      }
      completedRef.current = true;
      router.replace(`/profile/shipping/${encodeURIComponent(paidOrder.shippingRequestId)}` as Href);
      return;
    }
    const category = paidOrder.lines[0]?.category ?? requestedCategory;
    const entitlementIds = paidOrder.drawEntitlementIds ?? [];
    if (entitlementIds.length < 1 || !productId) {
      setPhase("failed");
      setMessage("결제는 확인됐지만 추첨권을 아직 불러오지 못했습니다. 내정보의 결제·뽑기 복구에서 다시 확인해 주세요.");
      return;
    }
    completedRef.current = true;
    if (category === "kuji") {
      const quantity = paidKujiOrderEntitlementIds(paidOrder, requestedQuantity)?.length
        ?? entitlementIds.length;
      const query = new URLSearchParams({
        count: String(quantity),
        orderId: paidOrder.id,
        ...(kujiEntryId ? { kujiEntryId } : {}),
        entitlementIds: entitlementIds.join(","),
      });
      router.replace(`/kuji/draw/${encodeURIComponent(productId)}?${query.toString()}` as Href);
      return;
    }
    presentDrawOpenModeChoice(entitlementIds.length, (mode) => {
      const query = new URLSearchParams({
        productId,
        category: "gacha",
        orderId: paidOrder.id,
        entitlementIds: entitlementIds.join(","),
        mode,
      });
      router.replace(
        `/draw/reveal/${encodeURIComponent(entitlementIds[0]!)}?${query.toString()}` as Href,
      );
    });
  }, [kujiEntryId, productId, requestedCategory, requestedQuantity, router]);

  const confirm = useCallback(async () => {
    if (!order || confirmingRef.current || completedRef.current) return;
    confirmingRef.current = true;
    setPhase("confirming");
    setMessage("");
    try {
      const tokens = await readAuthTokens();
      if (!tokens?.accessToken) throw new Error("로그인 세션을 확인하지 못했습니다.");
      await confirmPortOnePayment(runtime.apiBaseUrl, tokens.accessToken, order.paymentId);
      const nextOrder = await fetchCheckoutOrder(runtime.apiBaseUrl, tokens.accessToken, order.id);
      setOrder(nextOrder);
      if (nextOrder.status === "PAID" || nextOrder.status === "FULFILLED") {
        continueToDraw(nextOrder);
        return;
      }
      if (["CANCELLED", "REFUNDED", "REFUND_REVIEW"].includes(nextOrder.status)) {
        setPhase("failed");
        setMessage(
          nextOrder.status === "REFUND_REVIEW"
            ? "결제 상태를 안전하게 확인하는 중입니다. 추가 결제는 하지 말고 고객지원 또는 내정보에서 상태를 확인해 주세요."
            : "결제가 완료되지 않았습니다. 상품과 결제 상태를 다시 확인해 주세요.",
        );
        return;
      }
      setPhase("pending");
      setMessage("결제사 승인 결과를 기다리고 있습니다. 잠시 후 다시 확인해 주세요.");
    } catch (error) {
      setPhase("pending");
      setMessage(error instanceof Error ? error.message : "결제 상태를 확인하지 못했습니다.");
    } finally {
      confirmingRef.current = false;
    }
  }, [continueToDraw, order, runtime.apiBaseUrl]);

  const load = useCallback(async () => {
    setPhase("loading");
    setMessage("");
    try {
      if (!orderId) throw new Error("주문 번호를 확인하지 못했습니다.");
      const tokens = await readAuthTokens();
      if (!tokens?.accessToken) throw new Error("로그인 후 결제를 계속해 주세요.");
      const nextOrder = await fetchCheckoutOrder(runtime.apiBaseUrl, tokens.accessToken, orderId);
      setOrder(nextOrder);
      if (nextOrder.status === "PAID" || nextOrder.status === "FULFILLED") {
        continueToDraw(nextOrder);
        return;
      }
      if (nextOrder.status !== "PENDING_PAYMENT") {
        setPhase("failed");
        setMessage("결제를 계속할 수 없는 주문입니다. 주문 내역에서 상태를 확인해 주세요.");
        return;
      }
      if (!storeId || !channelKey) {
        setPhase("failed");
        setMessage("결제 채널이 설치 빌드에 구성되지 않았습니다.");
        return;
      }
      setPhase("paying");
    } catch (error) {
      setPhase("failed");
      setMessage(error instanceof Error ? error.message : "결제 주문을 불러오지 못했습니다.");
    }
  }, [channelKey, continueToDraw, orderId, runtime.apiBaseUrl, storeId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!order || !redirectPaymentId || redirectPaymentId !== order.paymentId) return;
    void confirm();
  }, [confirm, order, redirectPaymentId]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && order?.status === "PENDING_PAYMENT") void confirm();
    });
    return () => subscription.remove();
  }, [confirm, order?.status]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const paymentRequest = useMemo(() => {
    if (!order || phase !== "paying" || order.total <= 0) return null;
    const orderName = order.orderKind === "SHIPPING_FEE"
      ? "다뽀바 배송비"
      : order.lines.length === 1
        ? order.lines[0]!.productName
        : `${order.lines[0]?.productName ?? "다뽀바 상품"} 외 ${Math.max(0, order.lines.length - 1)}건`;
    return {
      storeId,
      channelKey,
      paymentId: order.paymentId,
      orderName: orderName.slice(0, 100),
      totalAmount: order.total,
      currency: "KRW" as const,
      payMethod: "CARD" as const,
      productType: "REAL" as const,
      appScheme: "dabboba",
      redirectUrl: `dabboba://checkout/payment/${encodeURIComponent(order.id)}?paymentId=${encodeURIComponent(order.paymentId)}`,
      customer: { customerId: order.userId },
      customData: { orderId: order.id, orderKind: order.orderKind },
    };
  }, [channelKey, order, phase, storeId]);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <DetailPageHeader title="카드 결제" onBack={goBack} backLabel="결제 화면 닫기" />
      {paymentRequest ? (
        <Payment
          request={paymentRequest}
          onComplete={() => void confirm()}
          onError={(error) => {
            setPhase("pending");
            setMessage(error.message || "결제창을 열지 못했습니다.");
          }}
          style={styles.payment}
        />
      ) : (
        <View style={styles.state}>
          {phase === "loading" || phase === "confirming" ? (
            <ActivityIndicator color={colors.ink} />
          ) : (
            <DecorativeIonicon
              name={phase === "failed" ? "alert-circle-outline" : "time-outline"}
              size={38}
              color={colors.muted}
            />
          )}
          <Text style={styles.stateTitle}>
            {phase === "loading"
              ? "주문을 확인하고 있어요"
              : phase === "confirming"
                ? "결제 승인을 확인하고 있어요"
                : phase === "pending"
                  ? "결제 확인이 필요해요"
                  : "결제를 계속할 수 없어요"}
          </Text>
          {message ? <Text style={styles.stateBody}>{message}</Text> : null}
          {phase === "pending" ? (
            <SeedActionButton label="결제 상태 다시 확인" onPress={() => void confirm()} />
          ) : null}
          {phase === "failed" ? (
            <SeedActionButton label="주문 화면으로 돌아가기" variant="neutralSolid" onPress={goBack} />
          ) : null}
        </View>
      )}
    </SafeAreaView>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.trunc(parsed)) : fallback;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  payment: { flex: 1, backgroundColor: seed.color.layer.default },
  state: {
    flex: 1,
    paddingHorizontal: seed.spacing.globalGutter,
    alignItems: "center",
    justifyContent: "center",
    gap: seed.spacing.componentDefault,
  },
  stateTitle: { color: colors.ink, ...seed.typography.subtitle, textAlign: "center" },
  stateBody: { color: colors.muted, ...seed.typography.body, textAlign: "center" },
});
