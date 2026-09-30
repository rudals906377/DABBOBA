import { Payment } from "@portone/react-native-sdk";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { DecorativeIonicon } from "@/components/DecorativeIonicon";
import { AppText as Text, AppTextInput as TextInput } from "@/components/Typography";
import { SeedActionButton, SeedInputShell } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import {
  claimPortOnePaymentAttempt,
  confirmPortOnePayment,
  fetchCheckoutActorId,
  fetchCheckoutOrder,
  fetchPaidKujiDrawRecovery,
  type CheckoutOrder,
} from "@/features/checkout/checkout-api";
import {
  paidKujiRoomEntryFromRecovery,
  paidProductDrawFromOrder,
} from "@/features/checkout/paid-order-draw-continuation";
import {
  clearPaymentAttempt,
  hasStartedPaymentAttempt,
  markPaymentAttemptStarted,
  paymentAttemptState,
  preparePaymentAttempt,
} from "@/features/checkout/payment-attempt";
import { normalizedPaymentCustomerName } from "@/features/checkout/payment-customer";
import {
  assertKujiPaymentLease,
  KujiPaymentLeaseExpiredError,
  KujiPaymentLeaseMismatchError,
} from "@/features/checkout/kuji-payment-lease";
import {
  PaymentResumeIdentityMismatchError,
  reconcileOwnedPaymentOnResume,
} from "@/features/checkout/payment-resume";
import { presentDrawOpenModeChoice } from "@/features/draw/draw-open-mode-prompt";
import { fetchKujiRoom } from "@/features/kuji/kuji-room-api";
import {
  resolveMobileRuntimeConfig,
  type MobilePlatform,
} from "@/lib/runtime-config";
import { readAuthTokens } from "@/lib/session-store";
import { colors } from "@/theme";

type PaymentPhase = "loading" | "details" | "paying" | "confirming" | "pending" | "failed";

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
  const redirectPaymentId = firstParam(params.paymentId);
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
  const [payerName, setPayerName] = useState("");
  const confirmingRef = useRef(false);
  const startingRef = useRef(false);
  const resumingRef = useRef(false);
  const continuingRef = useRef(false);
  const completedRef = useRef(false);

  const continueToDraw = useCallback(async (paidOrder: CheckoutOrder) => {
    if (completedRef.current || continuingRef.current) return;
    continuingRef.current = true;
    try {
      if (paidOrder.id !== orderId) throw new Error("결제 주문 번호가 일치하지 않아요.");
      const currentToken = await verifiedCheckoutToken(runtime.apiBaseUrl, paidOrder.userId);
      if (paidOrder.orderKind === "SHIPPING_FEE") {
        if (!paidOrder.shippingRequestId) throw new Error("결제한 배송 신청 정보를 찾지 못했어요.");
        completedRef.current = true;
        router.replace(`/profile/shipping/${encodeURIComponent(paidOrder.shippingRequestId)}` as Href);
        return;
      }
      const draw = paidProductDrawFromOrder(paidOrder, orderId);
      if (draw.category === "kuji") {
        const recovery = await fetchPaidKujiDrawRecovery(runtime.apiBaseUrl, currentToken, paidOrder.id);
        const roomEntryId = paidKujiRoomEntryFromRecovery(recovery, paidOrder, draw);
        await verifiedCheckoutToken(runtime.apiBaseUrl, paidOrder.userId);
        completedRef.current = true;
        const query = new URLSearchParams({
          count: String(draw.quantity),
          orderId: paidOrder.id,
          kujiEntryId: roomEntryId,
          entitlementIds: draw.entitlementIds.join(","),
        });
        router.replace(`/kuji/draw/${encodeURIComponent(draw.productId)}?${query.toString()}` as Href);
        return;
      }
      completedRef.current = true;
      presentDrawOpenModeChoice(draw.quantity, (mode) => {
        void (async () => {
          try {
            await verifiedCheckoutToken(runtime.apiBaseUrl, paidOrder.userId);
          } catch {
            completedRef.current = false;
            setPhase("failed");
            setMessage("로그인 계정이 변경됐어요. 결제·뽑기 복구에서 다시 확인해 주세요.");
            return;
          }
          const query = new URLSearchParams({
            productId: draw.productId,
            category: "gacha",
            orderId: paidOrder.id,
            entitlementIds: draw.entitlementIds.join(","),
            mode,
          });
          router.replace(
            `/draw/reveal/${encodeURIComponent(draw.entitlementIds[0]!)}?${query.toString()}` as Href,
          );
        })();
      });
    } catch (error) {
      setPhase("pending");
      setMessage(error instanceof Error ? error.message : "결제한 뽑기 정보를 확인하지 못했어요.");
    } finally {
      continuingRef.current = false;
    }
  }, [orderId, router, runtime.apiBaseUrl]);

  const confirmPayment = useCallback(async (paymentOrder: CheckoutOrder) => {
    if (confirmingRef.current || completedRef.current) return;
    confirmingRef.current = true;
    setPhase("confirming");
    setMessage("");
    try {
      const tokens = await readAuthTokens();
      if (!tokens?.accessToken) throw new Error("로그인 세션을 확인하지 못했어요.");
      const confirmation = await confirmPortOnePayment(runtime.apiBaseUrl, tokens.accessToken, paymentOrder.paymentId);
      if (confirmation.orderId !== paymentOrder.id || confirmation.paymentId !== paymentOrder.paymentId) {
        throw new Error("결제사 승인 정보와 주문이 일치하지 않아요.");
      }
      const nextOrder = await fetchCheckoutOrder(runtime.apiBaseUrl, tokens.accessToken, paymentOrder.id);
      if (nextOrder.id !== paymentOrder.id || nextOrder.paymentId !== paymentOrder.paymentId) {
        throw new Error("결제한 주문 정보를 다시 확인하지 못했어요.");
      }
      setOrder(nextOrder);
      if (nextOrder.status === "PAID" || nextOrder.status === "FULFILLED") {
        void clearPaymentAttempt(SecureStore, nextOrder).catch(() => undefined);
        await continueToDraw(nextOrder);
        return;
      }
      if (["CANCELLED", "REFUNDED", "REFUND_REVIEW"].includes(nextOrder.status)) {
        void clearPaymentAttempt(SecureStore, nextOrder).catch(() => undefined);
        setPhase("failed");
        setMessage(
          nextOrder.status === "REFUND_REVIEW"
            ? "결제 상태를 안전하게 확인하는 중이에요. 추가 결제는 하지 말고 고객지원 또는 내정보에서 상태를 확인해 주세요."
            : "결제가 완료되지 않았어요. 상품과 결제 상태를 다시 확인해 주세요.",
        );
        return;
      }
      setPhase("pending");
      setMessage("결제사 승인 결과를 기다리고 있어요. 추가 결제는 하지 말고 잠시 후 다시 확인해 주세요.");
    } catch (error) {
      setPhase("pending");
      setMessage(`${error instanceof Error ? error.message : "결제 상태를 확인하지 못했어요."} 추가 결제는 하지 말고 상태를 다시 확인해 주세요.`);
    } finally {
      confirmingRef.current = false;
    }
  }, [continueToDraw, runtime.apiBaseUrl]);

  const assertPayableKujiOrder = useCallback(async (paymentOrder: CheckoutOrder, accessToken: string) => {
    const kujiLine = paymentOrder.lines.find((line) => line.category === "kuji");
    if (!kujiLine) return;
    if (paymentOrder.lines.length !== 1 || !paymentOrder.kujiRoomEntryId) {
      throw new KujiPaymentLeaseMismatchError();
    }
    const room = await fetchKujiRoom(
      runtime.apiBaseUrl,
      accessToken,
      kujiLine.productId,
      paymentOrder.kujiRoomEntryId,
    );
    assertKujiPaymentLease(paymentOrder, room);
  }, [runtime.apiBaseUrl]);

  const startPayment = useCallback(async (paymentOrder: CheckoutOrder) => {
    if (startingRef.current || completedRef.current) return;
    const customerName = normalizedPaymentCustomerName(payerName);
    if (!customerName) return;
    startingRef.current = true;
    setPhase("loading");
    setMessage("");
    try {
      const accessToken = await verifiedCheckoutToken(runtime.apiBaseUrl, paymentOrder.userId);
      const nextOrder = await fetchCheckoutOrder(runtime.apiBaseUrl, accessToken, paymentOrder.id);
      if (
        nextOrder.id !== paymentOrder.id
        || nextOrder.paymentId !== paymentOrder.paymentId
        || nextOrder.userId !== paymentOrder.userId
        || nextOrder.total !== paymentOrder.total
        || nextOrder.status !== "PENDING_PAYMENT"
      ) throw new Error("결제 주문이 변경되었거나 종료됐어요. 추가 결제 전에 주문 상태를 확인해 주세요.");
      if (nextOrder.paymentAttemptStartedAt || await hasStartedPaymentAttempt(SecureStore, nextOrder)) {
        await confirmPayment(nextOrder);
        return;
      }
      await assertPayableKujiOrder(nextOrder, accessToken);
      // A PREPARING marker is recoverable if the server never accepted the
      // claim. Only a server-claimed window becomes a STARTED local attempt.
      await preparePaymentAttempt(SecureStore, nextOrder);
      const claim = await claimPortOnePaymentAttempt(runtime.apiBaseUrl, accessToken, nextOrder.paymentId);
      if (claim.paymentId !== nextOrder.paymentId || claim.orderId !== nextOrder.id) {
        throw new Error("결제 시도 정보와 주문이 일치하지 않아요.");
      }
      await markPaymentAttemptStarted(SecureStore, nextOrder);
      setOrder(nextOrder);
      setPayerName(customerName);
      setPhase("paying");
    } catch (error) {
      if (error instanceof KujiPaymentLeaseExpiredError) {
        router.replace(("/product/" + encodeURIComponent(error.productId)) as Href);
        return;
      }
      if ((await paymentAttemptState(SecureStore, paymentOrder).catch(() => "started")) !== "none") {
        setPhase("pending");
        setMessage("결제 시도 결과를 다시 확인해 주세요. 상태가 불확실할 때는 새 결제창을 열지 않아요.");
      } else {
        setPhase("failed");
        setMessage(error instanceof Error ? error.message : "결제 주문을 다시 확인하지 못했어요.");
      }
    } finally {
      startingRef.current = false;
    }
  }, [assertPayableKujiOrder, confirmPayment, payerName, router, runtime.apiBaseUrl]);

  // A bank-app return may precede the native callback or webhook. Keep the PG
  // component mounted while the server re-queries PortOne for this owned order.
  const refreshOrderOnResume = useCallback(async (paymentOrder: CheckoutOrder) => {
    if (resumingRef.current || completedRef.current) return;
    resumingRef.current = true;
    try {
      const tokens = await readAuthTokens();
      if (!tokens?.accessToken) return;
      const nextOrder = await reconcileOwnedPaymentOnResume(
        paymentOrder,
        () => fetchCheckoutOrder(runtime.apiBaseUrl, tokens.accessToken, paymentOrder.id),
        (paymentId) => confirmPortOnePayment(runtime.apiBaseUrl, tokens.accessToken, paymentId),
      );
      if (nextOrder.status === "PAID" || nextOrder.status === "FULFILLED") {
        setOrder(nextOrder);
        void clearPaymentAttempt(SecureStore, nextOrder).catch(() => undefined);
        await continueToDraw(nextOrder);
      } else if (["CANCELLED", "REFUNDED", "REFUND_REVIEW"].includes(nextOrder.status)) {
        setOrder(nextOrder);
        void clearPaymentAttempt(SecureStore, nextOrder).catch(() => undefined);
        setPhase("failed");
        setMessage(nextOrder.status === "REFUND_REVIEW"
          ? "결제 상태를 안전하게 확인하는 중이에요. 추가 결제는 하지 말고 고객지원 또는 내정보에서 상태를 확인해 주세요."
          : "결제가 완료되지 않았어요. 상품과 결제 상태를 다시 확인해 주세요.");
      }
    } catch (error) {
      if (error instanceof PaymentResumeIdentityMismatchError) {
        setPhase("failed");
        setMessage("결제 주문 정보가 변경됐어요. 추가 결제는 하지 말고 고객지원에서 확인해 주세요.");
      }
      // A transient API/provider failure must not close an in-progress PG screen.
    } finally {
      resumingRef.current = false;
    }
  }, [continueToDraw, runtime.apiBaseUrl]);

  const load = useCallback(async () => {
    setPhase("loading");
    setMessage("");
    try {
      if (!orderId) throw new Error("주문 번호를 확인하지 못했어요.");
      const tokens = await readAuthTokens();
      if (!tokens?.accessToken) throw new Error("로그인 후 결제를 계속해 주세요.");
      const nextOrder = await fetchCheckoutOrder(runtime.apiBaseUrl, tokens.accessToken, orderId);
      if (nextOrder.id !== orderId) throw new Error("결제 주문 번호가 일치하지 않아요.");
      if (redirectPaymentId && redirectPaymentId !== nextOrder.paymentId) {
        throw new Error("결제 복귀 정보와 주문이 일치하지 않아요.");
      }
      setOrder(nextOrder);
      if (nextOrder.status === "PAID" || nextOrder.status === "FULFILLED") {
        void clearPaymentAttempt(SecureStore, nextOrder).catch(() => undefined);
        await continueToDraw(nextOrder);
        return;
      }
      if (nextOrder.status !== "PENDING_PAYMENT") {
        void clearPaymentAttempt(SecureStore, nextOrder).catch(() => undefined);
        setPhase("failed");
        setMessage("결제를 계속할 수 없는 주문이에요. 주문 내역에서 상태를 확인해 주세요.");
        return;
      }
      if (redirectPaymentId) {
        await confirmPayment(nextOrder);
        return;
      }
      if (nextOrder.paymentAttemptStartedAt) {
        // A different device may have opened the one server-owned PG window.
        await confirmPayment(nextOrder);
        return;
      }
      const localAttemptState = await paymentAttemptState(SecureStore, nextOrder);
      if (localAttemptState === "started") {
        // A killed process cannot prove whether the previous native PG session charged.
        // Confirm the same order instead of silently mounting a second payment window.
        await confirmPayment(nextOrder);
        return;
      }
      if (!storeId || !channelKey) {
        setPhase("failed");
        setMessage("결제 채널이 설치 빌드에 구성되지 않았어요.");
        return;
      }
      await assertPayableKujiOrder(nextOrder, tokens.accessToken);
      if (localAttemptState === "preparing") {
        // The server has no PG-window claim, so reusing this order cannot create
        // a second payment. The claim endpoint still arbitrates a concurrent device.
        setMessage("결제창이 열리지 않았어요. 입력 내용을 확인하고 다시 시도해 주세요.");
      }
      setPhase("details");
    } catch (error) {
      if (error instanceof KujiPaymentLeaseExpiredError) {
        router.replace(("/product/" + encodeURIComponent(error.productId)) as Href);
        return;
      }
      setPhase("failed");
      setMessage(error instanceof Error ? error.message : "결제 주문을 불러오지 못했어요.");
    }
  }, [assertPayableKujiOrder, channelKey, confirmPayment, continueToDraw, orderId, redirectPaymentId, router, runtime.apiBaseUrl, storeId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" || order?.status !== "PENDING_PAYMENT") return;
      if (phase === "paying") void refreshOrderOnResume(order);
      else if (phase === "pending") void load();
    });
    return () => subscription.remove();
  }, [load, order, phase, refreshOrderOnResume]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const paymentRequest = useMemo(() => {
    if (!order || phase !== "paying" || order.total <= 0) return null;
    const customerName = normalizedPaymentCustomerName(payerName);
    if (!customerName) return null;
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
      appScheme: "dabboba://",
      redirectUrl: `dabboba://checkout/payment/${encodeURIComponent(order.id)}?paymentId=${encodeURIComponent(order.paymentId)}`,
      customer: { customerId: order.userId, fullName: customerName },
      customData: { orderId: order.id, orderKind: order.orderKind },
    };
  }, [channelKey, order, payerName, phase, storeId]);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <DetailPageHeader title="카드 결제" titleMode="pixel" onBack={goBack} backLabel="결제 화면 닫기" />
      {phase === "details" ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.state}
        >
          <Text style={styles.stateTitle}>결제자 이름을 입력해 주세요</Text>
          <Text style={styles.stateBody}>KG이니시스 카드 결제에 사용하며, 본인확인을 대신하지 않아요.</Text>
          {message ? <Text style={styles.stateBody}>{message}</Text> : null}
          <SeedInputShell style={styles.nameInputShell}>
            <TextInput
              accessibilityLabel="결제자 이름"
              autoComplete="name"
              maxLength={30}
              onChangeText={setPayerName}
              placeholder="결제자 이름"
              returnKeyType="done"
              textContentType="name"
              value={payerName}
              style={styles.nameInput}
            />
          </SeedInputShell>
          {payerName.trim() && !normalizedPaymentCustomerName(payerName) ? (
            <Text style={styles.stateBody}>결제자 이름은 한글 10자 이내(최대 30바이트)로 입력해 주세요.</Text>
          ) : null}
          <SeedActionButton
            label="카드 결제창 열기"
            disabled={!normalizedPaymentCustomerName(payerName)}
            onPress={() => { if (order) void startPayment(order); }}
          />
        </KeyboardAvoidingView>
      ) : paymentRequest ? (
        <Payment
          request={paymentRequest}
          onComplete={() => { if (order) void confirmPayment(order); }}
          onError={() => { if (order) void confirmPayment(order); }}
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
                  ? order?.status === "PAID" || order?.status === "FULFILLED"
                    ? "결제 후 뽑기 정보를 확인하고 있어요"
                    : "결제 확인이 필요해요"
                  : "결제를 계속할 수 없어요"}
          </Text>
          {message ? <Text style={styles.stateBody}>{message}</Text> : null}
          {phase === "pending" ? (
            <SeedActionButton label="주문·뽑기 상태 다시 확인" onPress={() => { void load(); }} />
          ) : null}
          {(phase === "pending" || phase === "failed")
            && (order?.status === "PAID" || order?.status === "FULFILLED") ? (
              <SeedActionButton
                label="내 주문에서 뽑기 복구"
                variant="neutralSolid"
                onPress={() => router.replace("/profile/orders" as Href)}
              />
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

async function verifiedCheckoutToken(apiBaseUrl: string, expectedActorId: string): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const tokens = await readAuthTokens();
    if (!tokens?.accessToken) break;
    const actorId = await fetchCheckoutActorId(apiBaseUrl, tokens.accessToken);
    const latestTokens = await readAuthTokens();
    if (latestTokens?.accessToken !== tokens.accessToken) continue;
    if (actorId === expectedActorId) return tokens.accessToken;
    break;
  }
  throw new Error("로그인 계정이 변경됐어요. 결제·뽑기 복구에서 다시 확인해 주세요.");
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
  nameInputShell: { width: "100%", minHeight: seed.size.touchTarget, paddingHorizontal: seed.spacing.x3 },
  nameInput: { minHeight: seed.size.touchTarget, color: colors.ink, ...seed.typography.body },
});
