import Constants from "expo-constants";
import { type Href, useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  AppState,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DecorativeIonicon, type DecorativeIoniconName } from "@/components/DecorativeIonicon";
import {
  FloatingBottomActionPanel,
  useFloatingBottomActionContentInset,
} from "@/components/FloatingBottomActionPanel";
import { CatalogProductImage } from "@/components/CatalogProductImage";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { ProductInfoDivider } from "@/components/ProductInfoDivider";
import { AppText as Text, AppTextInput as TextInput } from "@/components/Typography";
import { SeedActionButton, SeedInlineGuidance, SeedInputShell } from "@/design-system/components";
import { catalogProductCardSurface } from "@/design-system/catalog";
import { seed } from "@/design-system/seed";
import { CategoryAvailabilityState } from "@/features/catalog/CategoryAvailabilityState";
import { useStorefrontCategorySettings } from "@/features/catalog/StorefrontCategorySettingsProvider";
import { isCustomerProductCategoryComingSoon } from "@/features/catalog/product-categories";
import { catalogPriceLabel } from "@/features/commerce/product-commerce-presentation";
import { CheckoutNoticeSections } from "@/features/checkout/CheckoutNoticeSections";
import {
  checkoutNeedsAgreement,
  checkoutPaymentAvailability,
  checkoutPointUsed,
  normalizedCheckoutPointInput,
} from "@/features/checkout/checkout-payment-ui";
import {
  canRetireGachaIntentAfterCreateError,
  claimPendingGachaCheckoutOrderIntent,
  clearPendingGachaCheckoutOrderIntent,
  CheckoutOrderApiError,
  createGachaCheckoutOrder,
  createKujiCheckoutOrder,
  type CheckoutOrder,
  fetchCheckoutActorId,
  fetchCheckoutOrder,
  fetchCheckoutPointBalance,
  paidGachaOrderEntitlementIds,
  paidKujiOrderEntitlementIds,
  readPendingGachaCheckoutOrderIntent,
  recordPendingGachaCheckoutOrder,
} from "@/features/checkout/checkout-api";
import {
  canAutomaticallyReplayGachaOrderCreation,
  canRetireGachaCheckoutIntentForOrderStatus,
  sameGachaCheckoutOrderPayload,
  type GachaCheckoutOrderIntent,
} from "@/features/checkout/gacha-checkout-intent";
import { DemoPaymentControls } from "@/features/demo/DemoPaymentControls";
import {
  ensureInternalCustomerSession,
  sessionStillCurrent,
  transitionDemoPayment,
} from "@/features/demo/demo-api";
import { continuePendingDemoCheckout } from "@/features/demo/demo-checkout-continuation";
import { useDemoPaymentAvailability } from "@/features/demo/useDemoPaymentAvailability";
import {
  DRAW_PURCHASE_MAX_QUANTITY,
  normalizeDrawPurchaseCount,
} from "@/features/draw/draw-purchase-state";
import { presentDrawOpenModeChoice } from "@/features/draw/draw-open-mode-prompt";
import {
  createKujiCheckoutClock,
  formatKujiCheckoutRemainingTime,
  kujiCheckoutRemainingSeconds,
  resolveKujiCheckoutPhase,
} from "@/features/kuji/kuji-checkout-state";
import { fetchKujiRoom, leaveKujiRoom } from "@/features/kuji/kuji-room-api";
import { buildDrawPaymentConfirmation } from "@/features/kuji/kuji-selection-state";
import {
  categoryLabel,
  fetchProductDetail,
  isDrawCategory,
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

type PaymentMethodId = "card";

const PAYMENT_METHODS: Array<{
  id: PaymentMethodId;
  label: string;
  unavailableCaption: string;
  icon: DecorativeIoniconName;
}> = [
  { id: "card", label: "신용/체크카드", unavailableCaption: "결제 채널 미설정", icon: "card-outline" },
];

export function CheckoutScreen() {
  useStorefrontCategorySettings();
  const router = useRouter();
  const navigation = useNavigation();
  const db = useSQLiteContext();
  const floatingBottomInset = useFloatingBottomActionContentInset();
  const params = useLocalSearchParams<{
    productId?: string | string[];
    quantity?: string | string[];
    kujiEntryId?: string | string[];
    kujiCheckoutExpiresAt?: string | string[];
    checkoutExpiresAt?: string | string[];
    serverNow?: string | string[];
    kujiRoomFixture?: string | string[];
    internalCommerce?: string | string[];
  }>();
  const productId = firstParam(params.productId) ?? "";
  const requestedQuantity = normalizeDrawPurchaseCount(firstParam(params.quantity));
  const kujiEntryId = firstParam(params.kujiEntryId);
  const kujiCheckoutExpiresAt = firstParam(params.kujiCheckoutExpiresAt)
    ?? firstParam(params.checkoutExpiresAt);
  const kujiServerNow = firstParam(params.serverNow);
  const kujiRoomFixture = firstParam(params.kujiRoomFixture);
  const showInternalCommerceControls = __DEV__
    && firstParam(params.internalCommerce) === "enabled";
  const [verifiedKujiLease, setVerifiedKujiLease] = useState<{
    checkoutExpiresAt: string;
    serverNow: string;
  } | null>(null);
  const effectiveKujiCheckoutExpiresAt = verifiedKujiLease?.checkoutExpiresAt
    ?? kujiCheckoutExpiresAt;
  const effectiveKujiServerNow = verifiedKujiLease?.serverNow ?? kujiServerNow;
  const kujiCheckoutClock = useMemo(
    () => createKujiCheckoutClock(
      effectiveKujiCheckoutExpiresAt,
      effectiveKujiServerNow,
      Date.now(),
    ),
    [effectiveKujiCheckoutExpiresAt, effectiveKujiServerNow, kujiEntryId, productId],
  );
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
  const [pointInput, setPointInput] = useState("0");
  const [pointInputFocused, setPointInputFocused] = useState(false);
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [quantity, setQuantity] = useState(requestedQuantity);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingGachaIntent, setPendingGachaIntent] = useState<GachaCheckoutOrderIntent | null>(null);
  const [demoOrder, setDemoOrder] = useState<CheckoutOrder | null>(null);
  const demoEnabled = useDemoPaymentAvailability(runtime.apiBaseUrl);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethodId>("card");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const checkoutCompletedRef = useRef(false);
  const checkoutExpiredHandledRef = useRef(false);
  const orderSubmittingRef = useRef(false);
  const checkoutFocusedRef = useRef(false);
  const demoActionGenerationRef = useRef(0);
  const demoOrderIdRef = useRef<string | null>(null);
  const checkoutRouteIdentityRef = useRef("");
  demoOrderIdRef.current = demoOrder?.id ?? null;
  checkoutRouteIdentityRef.current = `${productId}\u0000${kujiEntryId ?? ""}`;

  useFocusEffect(useCallback(() => {
    checkoutFocusedRef.current = true;
    return () => {
      checkoutFocusedRef.current = false;
      demoActionGenerationRef.current += 1;
    };
  }, []));

  useEffect(() => {
    demoActionGenerationRef.current += 1;
  }, [demoOrder?.id]);

  const load = useCallback(async () => {
    setLoading(true);
    setPendingGachaIntent(null);
    setDemoOrder(null);
    try {
      const tokens = __DEV__
        ? (await ensureInternalCustomerSession(runtime.apiBaseUrl).catch(() => null))
          ?? await readAuthTokens()
        : await readAuthTokens();
      if (!tokens?.accessToken) throw new Error("로그인 후 결제 준비 화면을 확인할 수 있어요.");
      const actorId = await fetchCheckoutActorId(runtime.apiBaseUrl, tokens.accessToken);
      let nextPendingGachaIntent = await readPendingGachaCheckoutOrderIntent(db, {
        actorId,
        productId,
      });
      setPendingGachaIntent(nextPendingGachaIntent);
      if (nextPendingGachaIntent?.orderId) {
        const pendingOrder = await fetchCheckoutOrder(
          runtime.apiBaseUrl,
          tokens.accessToken,
          nextPendingGachaIntent.orderId,
        );
        nextPendingGachaIntent = await recordPendingGachaCheckoutOrder(
          db,
          nextPendingGachaIntent,
          pendingOrder,
        );
        setPendingGachaIntent(nextPendingGachaIntent);
        if (pendingOrder.status === "PENDING_PAYMENT") setDemoOrder(pendingOrder);
      }
      const [nextSnapshot, nextPointBalance] = await Promise.all([
        fetchProductDetail(runtime.apiBaseUrl, productId, tokens.accessToken),
        fetchCheckoutPointBalance(runtime.apiBaseUrl, tokens.accessToken),
      ]);
      if (nextSnapshot.product.category === "kuji") {
        if (!kujiEntryId || !kujiCheckoutExpiresAt) {
          throw new Error("쿠지 대기실에서 순서를 확인한 뒤 결제를 시작해 주세요.");
        }
        if (__DEV__ && kujiRoomFixture === "development") {
          setVerifiedKujiLease({
            checkoutExpiresAt: kujiCheckoutExpiresAt,
            serverNow: kujiServerNow ?? new Date().toISOString(),
          });
        } else {
          const room = await fetchKujiRoom(
            runtime.apiBaseUrl,
            tokens.accessToken,
            productId,
            kujiEntryId,
          );
          const checkoutOwnsDrawingTransition = room.viewer.state === "DRAWING"
            && (orderSubmittingRef.current || checkoutCompletedRef.current);
          if (
            room.viewer.entryId !== kujiEntryId
            || (
              room.viewer.state !== "CHECKOUT_PENDING"
              && !checkoutOwnsDrawingTransition
            )
            || (
              room.viewer.state === "CHECKOUT_PENDING"
              && !room.viewer.checkoutExpiresAt
            )
          ) {
            throw new Error("현재 결제 가능한 쿠지 순서가 아닙니다. 대기실에서 다시 확인해 주세요.");
          }
          if (room.viewer.state === "CHECKOUT_PENDING" && room.viewer.checkoutExpiresAt) {
            setVerifiedKujiLease({
              checkoutExpiresAt: room.viewer.checkoutExpiresAt,
              serverNow: room.serverNow,
            });
          }
        }
      } else {
        setVerifiedKujiLease(null);
      }
      setSnapshot(nextSnapshot);
      setPointBalance(nextPointBalance);
      setMessage("");
    } catch (error) {
      setSnapshot(null);
      setVerifiedKujiLease(null);
      setMessage(error instanceof Error ? error.message : "결제 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [
    db,
    kujiCheckoutExpiresAt,
    kujiEntryId,
    kujiRoomFixture,
    kujiServerNow,
    productId,
    runtime.apiBaseUrl,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  const product = snapshot?.product ?? null;
  const productComingSoon = isCustomerProductCategoryComingSoon(product?.category);
  const drawMode = product ? isDrawCategory(product.category) : false;
  const hasKujiCheckoutRouteLease = Boolean(kujiEntryId && kujiCheckoutExpiresAt);
  const isKujiCheckout = product?.category === "kuji" || hasKujiCheckoutRouteLease;
  const kujiCheckoutRemaining = isKujiCheckout
    ? kujiCheckoutRemainingSeconds(kujiCheckoutClock, nowMs)
    : 0;
  const kujiCheckoutExpired = isKujiCheckout && kujiCheckoutRemaining <= 0;
  const kujiCheckoutRemainingTime = formatKujiCheckoutRemainingTime(kujiCheckoutRemaining);
  const drawAvailable = product
    ? !drawMode || (
      typeof product.price === "number"
      && product.price > 0
      && product.availableQuantity > 0
      && (__DEV__ || (snapshot?.drawOdds?.entries.length ?? 0) > 0)
    )
    : false;
  const maxQuantity = normalizeDrawPurchaseCount(
    DRAW_PURCHASE_MAX_QUANTITY,
    product?.availableQuantity,
  );

  useEffect(() => {
    setQuantity(requestedQuantity);
    setPointInput("0");
    setAgreementAccepted(false);
    setSelectedPaymentMethod("card");
  }, [productId, requestedQuantity]);

  useEffect(() => {
    if (!product) return;
    setQuantity((current) => normalizeDrawPurchaseCount(current, product.availableQuantity));
  }, [productId, product?.availableQuantity]);

  useEffect(() => {
    if (!isKujiCheckout) return undefined;

    const syncNow = () => setNowMs(Date.now());
    syncNow();
    const timer = setInterval(syncNow, 1_000);
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") syncNow();
    });

    return () => {
      clearInterval(timer);
      appStateSubscription.remove();
    };
  }, [isKujiCheckout, kujiCheckoutClock]);

  const subtotal = (product?.price ?? 0) * quantity;
  const pointUsed = checkoutPointUsed(pointInput, pointBalance, subtotal);
  const paymentTotal = Math.max(0, subtotal - pointUsed);
  const testPaymentsEnabled = __DEV__ && demoEnabled;
  const livePaymentsEnabled = Boolean(
    process.env.EXPO_PUBLIC_PORTONE_STORE_ID?.trim()
    && process.env.EXPO_PUBLIC_PORTONE_CHANNEL_KEY?.trim(),
  );
  const paymentAvailability = checkoutPaymentAvailability(
    paymentTotal,
    testPaymentsEnabled,
    livePaymentsEnabled,
  );
  const selectedPaymentLabel = PAYMENT_METHODS.find(
    (method) => method.id === selectedPaymentMethod,
  )?.label ?? "신용/체크카드";
  const recoveringGachaOrder = product?.category === "gacha" && Boolean(pendingGachaIntent);
  const assetBaseUrl = runtime.assetBaseUrl
    ?? (__DEV__ ? runtime.apiBaseUrl.replace(/:8788$/, ":4174") : null);
  const imageUri = product
    ? resolveCatalogImageUrl(product.imageUrl, assetBaseUrl, product.version)
    : null;

  const checkoutRequestStillCurrent = useCallback(async (
    accessToken: string,
    expectedRouteIdentity: string,
  ): Promise<boolean> => {
    if (
      !checkoutFocusedRef.current
      || checkoutRouteIdentityRef.current !== expectedRouteIdentity
    ) return false;
    if (!(await sessionStillCurrent(accessToken))) return false;
    return checkoutFocusedRef.current
      && checkoutRouteIdentityRef.current === expectedRouteIdentity;
  }, []);

  const continueTestPayment = useCallback(async (
    order: CheckoutOrder,
    accessToken: string,
    expectedRouteIdentity: string,
  ): Promise<CheckoutOrder | null> => continuePendingDemoCheckout({
    enabled: testPaymentsEnabled,
    order,
    approve: (orderId) => transitionDemoPayment(
      runtime.apiBaseUrl,
      accessToken,
      orderId,
      "approve",
    ),
    isCurrent: () => checkoutRequestStillCurrent(accessToken, expectedRouteIdentity),
  }), [checkoutRequestStillCurrent, runtime.apiBaseUrl, testPaymentsEnabled]);

  useEffect(() => {
    setPointInput((current) => normalizedCheckoutPointInput(current, pointBalance, subtotal));
  }, [pointBalance, subtotal]);

  const replaceWithProduct = useCallback(() => {
    router.replace(`/product/${encodeURIComponent(productId)}` as Href);
  }, [productId, router]);

  const openLivePayment = useCallback((order: CheckoutOrder) => {
    const category = order.lines[0]?.category ?? product?.category;
    router.push({
      pathname: `/checkout/payment/${encodeURIComponent(order.id)}`,
      params: {
        productId,
        category: category ?? "gacha",
        quantity: String(quantity),
        ...(kujiEntryId ? { kujiEntryId } : {}),
      },
    } as Href);
  }, [kujiEntryId, product?.category, productId, quantity, router]);

  const releaseKujiEntryBestEffort = useCallback(async () => {
    if (!kujiEntryId) return;
    try {
      const tokens = await readAuthTokens();
      if (!tokens?.accessToken) return;
      await leaveKujiRoom(runtime.apiBaseUrl, tokens.accessToken, productId, kujiEntryId);
    } catch {
      // Returning to the product must not be blocked by a temporary release failure.
    }
  }, [kujiEntryId, productId, runtime.apiBaseUrl]);

  const expireKujiCheckout = useCallback(() => {
    const phase = resolveKujiCheckoutPhase(
      kujiCheckoutClock,
      Date.now(),
      checkoutCompletedRef.current,
      orderSubmittingRef.current,
    );
    if (checkoutExpiredHandledRef.current || phase !== "EXPIRED") return;
    checkoutExpiredHandledRef.current = true;
    void releaseKujiEntryBestEffort();
    AccessibilityInfo.announceForAccessibility(
      "결제 대기 시간이 끝나 자동으로 취소됐어요. 상품 페이지로 이동합니다.",
    );
    replaceWithProduct();
    Alert.alert(
      "결제 시간이 끝났어요",
      "3분이 지나 결제가 자동으로 취소됐어요.",
    );
  }, [kujiCheckoutClock, releaseKujiEntryBestEffort, replaceWithProduct]);

  const cancelKujiCheckout = useCallback(() => {
    checkoutExpiredHandledRef.current = true;
    void releaseKujiEntryBestEffort();
    AccessibilityInfo.announceForAccessibility("결제를 취소하고 상품 페이지로 이동합니다.");
    replaceWithProduct();
  }, [releaseKujiEntryBestEffort, replaceWithProduct]);

  const confirmKujiCheckoutCancellation = useCallback(() => {
    if (orderSubmittingRef.current) return;
    const remaining = kujiCheckoutRemainingSeconds(kujiCheckoutClock, Date.now());
    if (remaining <= 0) {
      expireKujiCheckout();
      return;
    }
    Alert.alert(
      "결제를 취소할까요?",
      "결제를 취소하면 상품 페이지로 돌아가요.",
      [
        { text: "계속 결제", style: "cancel" },
        { text: "결제 취소", style: "destructive", onPress: cancelKujiCheckout },
      ],
    );
  }, [cancelKujiCheckout, expireKujiCheckout, kujiCheckoutClock]);

  useEffect(() => {
    checkoutCompletedRef.current = false;
    checkoutExpiredHandledRef.current = false;
    setNowMs(Date.now());
  }, [kujiEntryId, productId]);

  useEffect(() => {
    if (!isKujiCheckout || !kujiCheckoutExpired) return;
    if (!hasKujiCheckoutRouteLease && loading) return;
    if (submitting) return;
    expireKujiCheckout();
  }, [
    expireKujiCheckout,
    hasKujiCheckoutRouteLease,
    isKujiCheckout,
    kujiCheckoutExpired,
    loading,
    submitting,
  ]);

  useEffect(() => navigation.addListener("beforeRemove", (event) => {
    if (
      !isKujiCheckout
      || checkoutCompletedRef.current
      || checkoutExpiredHandledRef.current
    ) return;

    event.preventDefault();
    confirmKujiCheckoutCancellation();
  }), [
    confirmKujiCheckoutCancellation,
    kujiCheckoutExpiresAt,
    kujiEntryId,
    isKujiCheckout,
    navigation,
  ]);

  const goBack = () => {
    if (
      isKujiCheckout
      && !checkoutCompletedRef.current
    ) {
      confirmKujiCheckoutCancellation();
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace(isKujiCheckout ? "/(tabs)/kuji" : shopTabPathForCategory(product?.category));
  };

  const openCommittedGachaReveal = (
    intent: GachaCheckoutOrderIntent,
    orderId: string,
    entitlementIds: string[],
  ) => {
    presentDrawOpenModeChoice(entitlementIds.length, (mode) => {
      if (!checkoutFocusedRef.current) return;
      const query = new URLSearchParams({
        productId: intent.payload.productId,
        category: "gacha",
        orderId,
        entitlementIds: entitlementIds.join(","),
        mode,
      });
      router.replace(
        `/draw/reveal/${encodeURIComponent(entitlementIds[0]!)}?${query.toString()}` as Href,
      );
    });
  };

  const offerRecoveredGachaOrder = (
    intent: GachaCheckoutOrderIntent,
    orderId: string,
    entitlementIds: string[],
  ) => {
    Alert.alert(
      "이전 구매가 확인됐어요",
      "결제 완료된 가챠 결과를 이어서 확인할 수 있어요.",
      [
        { text: "닫기", style: "cancel" },
        {
          text: "결과 보기",
          onPress: () => openCommittedGachaReveal(intent, orderId, entitlementIds),
        },
      ],
    );
  };

  const showGachaOrderError = (error: unknown) => {
    const providerUnavailable = error instanceof CheckoutOrderApiError
      && error.code === "PAYMENT_NOT_CONFIGURED";
    Alert.alert(
      providerUnavailable ? "외부 결제 연결 준비 중" : "주문을 접수하지 못했어요",
      providerUnavailable
        ? "카드·간편결제 제공 서비스가 아직 연결되지 않아 주문과 결제를 접수하지 않았어요. 포인트로 전액 결제할 수 있는 경우에는 서버에서 바로 완료돼요."
        : error instanceof Error
          ? error.message
          : "가챠 주문을 다시 확인해 주세요.",
    );
  };

  const executeGachaOrderIntent = async (
    intent: GachaCheckoutOrderIntent,
    accessToken: string,
    options: {
      intentCreatedThisAttempt: boolean;
      offerRecoveryChoice: boolean;
    },
  ) => {
    const expectedRouteIdentity = checkoutRouteIdentityRef.current;
    if (
      !intent.orderId
      && !canAutomaticallyReplayGachaOrderCreation(intent, Date.now())
    ) {
      Alert.alert(
        "이전 주문 확인이 필요해요",
        "24시간이 지난 미확정 주문 요청은 중복 결제를 막기 위해 자동으로 다시 보내지 않아요. 내정보의 주문 내역을 먼저 확인해 주세요.",
      );
      return;
    }

    const creatingOrder = !intent.orderId;
    try {
      let order = intent.orderId
        ? await fetchCheckoutOrder(runtime.apiBaseUrl, accessToken, intent.orderId)
        : await createGachaCheckoutOrder(
          runtime.apiBaseUrl,
          accessToken,
          { ...intent.payload, idempotencyKey: intent.idempotencyKey },
        );
      let recordedIntent = await recordPendingGachaCheckoutOrder(db, intent, order);
      if (creatingOrder && !options.intentCreatedThisAttempt) {
        order = await fetchCheckoutOrder(runtime.apiBaseUrl, accessToken, order.id);
        recordedIntent = await recordPendingGachaCheckoutOrder(db, recordedIntent, order);
      }
      const automaticallyApprovingTestOrder = order.status === "PENDING_PAYMENT"
        && testPaymentsEnabled;
      if (automaticallyApprovingTestOrder) {
        // Keep the server-created order recoverable if the automatic TEST_PG
        // transition is interrupted after the customer confirms payment.
        setDemoOrder(order);
      }
      const continuedOrder = await continueTestPayment(
        order,
        accessToken,
        expectedRouteIdentity,
      );
      if (!continuedOrder) return;
      if (continuedOrder !== order) {
        order = continuedOrder;
        recordedIntent = await recordPendingGachaCheckoutOrder(db, recordedIntent, order);
      }
      if (!(await checkoutRequestStillCurrent(accessToken, expectedRouteIdentity))) return;
      setPendingGachaIntent(recordedIntent);
      const entitlementIds = paidGachaOrderEntitlementIds(order, recordedIntent);
      if (entitlementIds) {
        setDemoOrder(null);
        if (options.offerRecoveryChoice && !automaticallyApprovingTestOrder) {
          offerRecoveredGachaOrder(recordedIntent, order.id, entitlementIds);
        } else {
          openCommittedGachaReveal(recordedIntent, order.id, entitlementIds);
        }
        return;
      }

      if (order.status === "PENDING_PAYMENT") {
        setDemoOrder(order);
        if (livePaymentsEnabled) {
          openLivePayment(order);
          return;
        }
        Alert.alert(
          "결제 승인을 기다리고 있어요",
          "주문은 서버에 접수됐지만 결제가 확인되지 않아 뽑기로 이동하지 않았어요. 결제 확인 전에는 추첨권이나 결과를 만들지 않아요.",
        );
        return;
      }
      if (canRetireGachaCheckoutIntentForOrderStatus(order.status)) {
        await clearPendingGachaCheckoutOrderIntent(db, recordedIntent);
        setPendingGachaIntent(null);
        Alert.alert(
          "이전 주문이 종료됐어요",
          "새 주문은 상품·수량·포인트와 구매 금액을 다시 확인한 뒤 진행해 주세요.",
        );
        return;
      }
      Alert.alert(
        order.status === "REFUND_REVIEW" ? "결제 상태 확인이 필요해요" : "추첨권을 확인하고 있어요",
        order.status === "REFUND_REVIEW"
          ? "결제 확인이 끝나기 전에는 새 주문이나 가챠 뽑기를 진행하지 않아요."
          : "서버에서 결제 완료와 정확한 추첨권 발급이 모두 확인되지 않아 뽑기로 이동하지 않았어요.",
      );
    } catch (error) {
      if (
        creatingOrder
        && options.intentCreatedThisAttempt
        && canRetireGachaIntentAfterCreateError(error)
      ) {
        try {
          await clearPendingGachaCheckoutOrderIntent(db, intent);
          setPendingGachaIntent(null);
        } catch {
          // Persistence is authoritative when cleanup cannot be confirmed.
        }
      }
      showGachaOrderError(error);
    }
  };

  const resumeStoredGachaIntent = async (intent: GachaCheckoutOrderIntent) => {
    if (orderSubmittingRef.current) return;
    orderSubmittingRef.current = true;
    setSubmitting(true);
    try {
      const tokens = await readAuthTokens();
      if (!tokens?.accessToken) throw new Error("로그인 후 이전 가챠 주문을 확인해 주세요.");
      const actorId = await fetchCheckoutActorId(runtime.apiBaseUrl, tokens.accessToken);
      const storedIntent = await readPendingGachaCheckoutOrderIntent(db, {
        actorId,
        productId: intent.payload.productId,
      });
      if (!storedIntent || storedIntent.idempotencyKey !== intent.idempotencyKey) {
        throw new Error("이전 가챠 주문 요청이 변경되어 다시 확인이 필요해요.");
      }
      await executeGachaOrderIntent(storedIntent, tokens.accessToken, {
        intentCreatedThisAttempt: false,
        offerRecoveryChoice: Boolean(storedIntent.orderId),
      });
    } catch (error) {
      showGachaOrderError(error);
    } finally {
      orderSubmittingRef.current = false;
      setSubmitting(false);
    }
  };

  const promptGachaPayloadConflict = (intent: GachaCheckoutOrderIntent) => {
    Alert.alert(
      "이전 주문 요청이 남아 있어요",
      `중복 결제를 막기 위해 이전 요청(${intent.payload.quantity}개 · 포인트 ${intent.payload.pointAmount.toLocaleString("ko-KR")}원)을 먼저 확인해야 해요. 현재 선택으로 새 주문을 자동 생성하지 않아요.`,
      [
        { text: "닫기", style: "cancel" },
        {
          text: "이전 주문 확인",
          onPress: () => void resumeStoredGachaIntent(intent),
        },
      ],
    );
  };

  const submitGachaOrder = async () => {
    if (orderSubmittingRef.current) return;
    orderSubmittingRef.current = true;
    setSubmitting(true);
    try {
      const tokens = await readAuthTokens();
      if (!tokens?.accessToken) throw new Error("로그인 후 가챠 주문을 진행해 주세요.");
      const actorId = await fetchCheckoutActorId(runtime.apiBaseUrl, tokens.accessToken);
      const existingIntent = await readPendingGachaCheckoutOrderIntent(db, {
        actorId,
        productId,
      });
      if (existingIntent) {
        setPendingGachaIntent(existingIntent);
        const currentPayload = product?.category === "gacha"
          && quantity > 0
          && snapshot?.drawOdds?.version
          ? {
            productId: product.id,
            quantity,
            expectedDrawVersion: snapshot.drawOdds.version,
            pointAmount: pointUsed,
          }
          : null;
        const payloadChanged = currentPayload
          ? !sameGachaCheckoutOrderPayload(existingIntent.payload, currentPayload)
          : false;
        if (payloadChanged && !existingIntent.orderId) {
          promptGachaPayloadConflict(existingIntent);
          return;
        }
        await executeGachaOrderIntent(existingIntent, tokens.accessToken, {
          intentCreatedThisAttempt: false,
          offerRecoveryChoice: Boolean(existingIntent.orderId),
        });
        return;
      }

      if (
        !product
        || product.category !== "gacha"
        || quantity <= 0
        || !drawAvailable
      ) {
        throw new Error("현재 새로 구매할 수 있는 가챠 상품이 아닙니다.");
      }
      const expectedDrawVersion = snapshot?.drawOdds?.version;
      if (!expectedDrawVersion) {
        throw new Error("결제 전 확인한 최신 확률표가 없어 주문을 접수하지 않았어요.");
      }
      const claim = await claimPendingGachaCheckoutOrderIntent(db, {
        actorId,
        payload: {
          productId: product.id,
          quantity,
          expectedDrawVersion,
          pointAmount: pointUsed,
        },
      });
      setPendingGachaIntent(claim.intent);
      if (claim.kind === "payload-conflict" && !claim.intent.orderId) {
        promptGachaPayloadConflict(claim.intent);
        return;
      }
      await executeGachaOrderIntent(claim.intent, tokens.accessToken, {
        intentCreatedThisAttempt: claim.kind === "created",
        offerRecoveryChoice: Boolean(claim.intent.orderId),
      });
    } catch (error) {
      showGachaOrderError(error);
    } finally {
      orderSubmittingRef.current = false;
      setSubmitting(false);
    }
  };

  const submitKujiOrder = async () => {
    if (
      orderSubmittingRef.current
      || !product
      || product.category !== "kuji"
      || !kujiEntryId
    ) return;
    const currentNowMs = Date.now();
    if (kujiCheckoutRemainingSeconds(kujiCheckoutClock, currentNowMs) <= 0) {
      setNowMs(currentNowMs);
      expireKujiCheckout();
      return;
    }
    if (kujiRoomFixture === "development") {
      Alert.alert(
        "실제 대기실 연결이 필요해요",
        "현재 대기 정보로는 주문이나 추첨권을 만들지 않아요. 실시간 대기실이 연결된 뒤 다시 시작해 주세요.",
      );
      return;
    }
    const expectedDrawVersion = snapshot?.drawOdds?.version;
    if (!expectedDrawVersion) {
      Alert.alert(
        "확률표를 다시 확인해 주세요",
        "결제 전 확인한 최신 확률표가 없어 주문을 접수하지 않았어요.",
      );
      return;
    }

    orderSubmittingRef.current = true;
    setSubmitting(true);
    const expectedRouteIdentity = checkoutRouteIdentityRef.current;
    try {
      const tokens = await readAuthTokens();
      if (!tokens?.accessToken) throw new Error("로그인 후 쿠지 주문을 진행해 주세요.");
      let order = await createKujiCheckoutOrder(
        runtime.apiBaseUrl,
        tokens.accessToken,
        {
          productId: product.id,
          quantity,
          expectedDrawVersion,
          pointAmount: pointUsed,
          kujiRoomEntryId: kujiEntryId,
        },
      );
      if (order.status === "PENDING_PAYMENT" && testPaymentsEnabled) {
        // Preserve a visible recovery path when the TEST_PG response is lost
        // after the server has already accepted the order.
        setDemoOrder(order);
      }
      const continuedOrder = await continueTestPayment(
        order,
        tokens.accessToken,
        expectedRouteIdentity,
      );
      if (!continuedOrder) return;
      order = continuedOrder;
      const entitlementIds = paidKujiOrderEntitlementIds(order, quantity);
      if (!entitlementIds) {
        if (order.status === "PENDING_PAYMENT") {
          setDemoOrder(order);
          if (livePaymentsEnabled) {
            openLivePayment(order);
            return;
          }
          Alert.alert(
            "결제 승인을 기다리고 있어요",
            "주문은 서버에 접수됐지만 결제가 확인되지 않아 뽑기로 이동하지 않았어요. 남은 결제 시간이 끝나면 주문과 대기 순서가 자동으로 취소돼요.",
          );
          return;
        }
        Alert.alert(
          "추첨권을 확인하고 있어요",
          "서버에서 결제 완료와 추첨권 발급이 모두 확인되지 않아 뽑기로 이동하지 않았어요.",
        );
        return;
      }
      if (!(await checkoutRequestStillCurrent(tokens.accessToken, expectedRouteIdentity))) return;

      checkoutCompletedRef.current = true;
      setDemoOrder(null);
      const query = new URLSearchParams({
        count: String(entitlementIds.length),
        orderId: order.id,
        kujiEntryId,
        entitlementIds: entitlementIds.join(","),
      });
      router.replace(
        `/kuji/draw/${encodeURIComponent(product.id)}?${query.toString()}` as Href,
      );
    } catch (error) {
      const providerUnavailable = error instanceof CheckoutOrderApiError && error.status === 503;
      Alert.alert(
        providerUnavailable ? "외부 결제 연결 준비 중" : "주문을 접수하지 못했어요",
        providerUnavailable
          ? "카드·간편결제 제공 서비스가 아직 연결되지 않아 주문과 결제를 접수하지 않았어요. 포인트로 전액 결제할 수 있는 경우에는 서버에서 바로 완료돼요."
          : error instanceof Error
            ? error.message
            : "쿠지 주문을 다시 확인해 주세요.",
      );
    } finally {
      orderSubmittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleDemoOrderChanged = async (order: CheckoutOrder, accessToken: string) => {
    if (order.id !== demoOrder?.id) return;
    const generation = demoActionGenerationRef.current;
    const isCurrent = () => (
      checkoutFocusedRef.current
      && demoActionGenerationRef.current === generation
      && demoOrderIdRef.current === order.id
    );
    if (!isCurrent() || !(await sessionStillCurrent(accessToken))) return;
    if (product?.category === "gacha") {
      if (!pendingGachaIntent) return;
      const recordedIntent = await recordPendingGachaCheckoutOrder(
        db,
        pendingGachaIntent,
        order,
      );
      if (!isCurrent() || !(await sessionStillCurrent(accessToken))) return;
      setPendingGachaIntent(recordedIntent);
      const entitlementIds = paidGachaOrderEntitlementIds(order, recordedIntent);
      if (entitlementIds) {
        setDemoOrder(null);
        openCommittedGachaReveal(recordedIntent, order.id, entitlementIds);
        return;
      }
      if (canRetireGachaCheckoutIntentForOrderStatus(order.status)) {
        if (!isCurrent() || !(await sessionStillCurrent(accessToken))) return;
        await clearPendingGachaCheckoutOrderIntent(db, recordedIntent);
        if (!isCurrent() || !(await sessionStillCurrent(accessToken))) return;
        setPendingGachaIntent(null);
        setDemoOrder(null);
        Alert.alert("주문이 종료됐어요", "상품과 수량을 다시 확인한 뒤 새 주문을 진행해 주세요.");
        return;
      }
      setDemoOrder(order);
      Alert.alert("결제 상태 확인", "승인되지 않은 주문에는 추첨권이나 결과를 만들지 않아요.");
      return;
    }
    if (product?.category === "kuji") {
      if (!isCurrent() || !(await sessionStillCurrent(accessToken))) return;
      const entitlementIds = paidKujiOrderEntitlementIds(order, quantity);
      if (entitlementIds && kujiEntryId) {
        checkoutCompletedRef.current = true;
        setDemoOrder(null);
        const query = new URLSearchParams({
          count: String(entitlementIds.length),
          orderId: order.id,
          kujiEntryId,
          entitlementIds: entitlementIds.join(","),
        });
        router.replace(
          `/kuji/draw/${encodeURIComponent(product.id)}?${query.toString()}` as Href,
        );
        return;
      }
      if (order.status === "CANCELLED" || order.status === "REFUNDED") {
        checkoutCompletedRef.current = true;
        setDemoOrder(null);
        Alert.alert("주문이 종료됐어요", "대기실에서 새 순서를 받은 뒤 다시 진행해 주세요.", [
          { text: "확인", onPress: replaceWithProduct },
        ]);
        return;
      }
      setDemoOrder(order);
      Alert.alert("결제 상태 확인", "승인되지 않은 주문에는 추첨권이나 결과를 만들지 않아요.");
    }
  };

  const finishPreparation = () => {
    if (!product) return;
    if (recoveringGachaOrder && pendingGachaIntent) {
      Alert.alert(
        "이전 주문 확인",
        "저장된 주문 상태를 먼저 확인한 뒤 결제가 완료된 결과를 이어서 볼 수 있어요.",
        [
          { text: "닫기", style: "cancel" },
          { text: "확인하기", onPress: () => void submitGachaOrder() },
        ],
      );
      return;
    }
    if (checkoutNeedsAgreement(recoveringGachaOrder) && !agreementAccepted) {
      Alert.alert("결제 동의가 필요해요", "주문내용과 결제 안내를 확인한 뒤 동의해 주세요.");
      return;
    }
    if (typeof product.price !== "number" || !Number.isFinite(product.price) || product.price <= 0) {
      Alert.alert("가격 공개 전이에요", "가격이 확정된 뒤 주문을 진행할 수 있어요.");
      return;
    }
    if (paymentAvailability === "unavailable") {
      Alert.alert(
        "결제 수단 준비 중",
        "카드·간편결제 연결이 완료되기 전에는 주문을 접수하지 않아요. 포인트로 전액 결제할 수 있는 경우에만 진행할 수 있어요.",
      );
      return;
    }
    if (isDrawCategory(product.category)) {
      if (
        product.category === "kuji"
        && kujiCheckoutRemainingSeconds(kujiCheckoutClock, Date.now()) <= 0
      ) {
        expireKujiCheckout();
        return;
      }
      if (!drawAvailable || quantity <= 0) {
        Alert.alert(
          "지금은 구매할 수 없어요",
          product.availableQuantity <= 0
            ? "남은 수량이 없어 구매할 수 없어요."
            : "확률표가 공개된 뒤 구매할 수 있어요.",
        );
        return;
      }
      const unit = product.category === "kuji" ? "장" : "개";
      const paymentLabel = paymentAvailability === "demo"
        ? `${selectedPaymentLabel} · TEST_PG 결제 후 뽑기로 이동`
        : paymentAvailability === "live"
          ? `${selectedPaymentLabel} 결제 후 뽑기로 이동`
          : "포인트 전액 결제";
      const paymentConfirmation = buildDrawPaymentConfirmation(product.price, quantity, unit);
      const pointLine = pointUsed > 0
        ? `\n포인트 사용 -${pointUsed.toLocaleString("ko-KR")}원`
        : "";
      if (product.category === "kuji") {
        Alert.alert(
          "구매 금액 확인",
          `${paymentConfirmation.message}${pointLine}\n최종 결제 예정 ${paymentTotal.toLocaleString("ko-KR")}원 · ${paymentLabel}`,
          [
            { text: "취소", style: "cancel" },
            { text: "구매하기", onPress: () => void submitKujiOrder() },
          ],
        );
        return;
      }
      Alert.alert(
        "구매 금액 확인",
        `${paymentConfirmation.message}${pointLine}\n최종 결제 예정 ${paymentTotal.toLocaleString("ko-KR")}원 · ${paymentLabel}`,
        [
          { text: "취소", style: "cancel" },
          { text: "구매하기", onPress: () => void submitGachaOrder() },
        ],
      );
      return;
    }
    Alert.alert(
      "결제 준비가 끝났어요",
      `${quantity}개 · ${paymentTotal.toLocaleString("ko-KR")}원으로 확인했어요. 일반 상품 주문 연결이 완료되기 전에는 주문이 접수되지 않아요.`,
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <DetailPageHeader title="결제" onBack={goBack} backLabel="상품 상세로 돌아가기" />

      {loading ? (
        <View style={styles.state}>
          <ActivityIndicator color={colors.ink} />
          <Text style={styles.stateBody}>주문 정보를 불러오는 중</Text>
        </View>
      ) : message || !snapshot || !product ? (
        <View style={styles.state}>
          <DecorativeIonicon name="alert-circle-outline" size={34} color={colors.muted} />
          <Text style={styles.stateTitle}>{message || "상품을 찾을 수 없습니다."}</Text>
          {pendingGachaIntent ? (
            <SeedActionButton
              label="이전 주문 확인"
              disabled={submitting}
              onPress={() => void submitGachaOrder()}
            />
          ) : null}
          <SeedActionButton label="다시 불러오기" variant="neutralSolid" onPress={() => void load()} />
        </View>
      ) : productComingSoon ? (
        <CategoryAvailabilityState category={product.category} />
      ) : (
        <>
          <ScrollView contentContainerStyle={[styles.content, { paddingBottom: floatingBottomInset + seed.spacing.x6 }]}>
            {showInternalCommerceControls && product.category === "kuji" && kujiRoomFixture === "development" ? (
              <SeedInlineGuidance
                paragraphs={["INTERNAL QUEUE · 주문과 추첨권은 생성되지 않아요."]}
              />
            ) : null}

            {testPaymentsEnabled && demoOrder ? (
              <DemoPaymentControls
                surface="internal-commerce"
                apiBaseUrl={runtime.apiBaseUrl}
                orderId={demoOrder.id}
                orderStatus={demoOrder.status}
                onOrderChanged={handleDemoOrderChanged}
              />
            ) : null}

            {product.category === "kuji" ? (
              <View
                accessible
                accessibilityLabel={`결제 남은 시간 ${kujiCheckoutRemainingTime}`}
                accessibilityHint="시간이 끝나면 결제가 자동으로 취소되고 상품 페이지로 이동합니다."
                style={[
                  styles.checkoutTimer,
                  kujiCheckoutExpired && styles.checkoutTimerExpired,
                ]}
              >
                <View style={styles.checkoutTimerCopy}>
                  <Text style={styles.checkoutTimerTitle}>결제 남은 시간</Text>
                  <Text style={styles.checkoutTimerCaption}>
                    3분 안에 결제를 완료해 주세요.
                  </Text>
                </View>
                <Text style={styles.checkoutTimerValue}>{kujiCheckoutRemainingTime}</Text>
              </View>
            ) : null}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>구매 상품</Text>
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
                    <Text style={styles.productPrice}>{catalogPriceLabel(product.price)}</Text>
                  </View>
                </View>
              </View>
              {drawMode ? (
                <View style={styles.quantityRow}>
                  <View style={styles.quantityCopy}>
                    <Text style={styles.quantityTitle}>구매 수량</Text>
                    <Text style={styles.quantityCaption}>
                      {drawAvailable
                        ? `최대 ${maxQuantity}${product.category === "kuji" ? "장" : "개"}까지 선택할 수 있어요.`
                        : "현재 구매할 수 있는 수량이 없어요."}
                    </Text>
                  </View>
                  <View style={styles.quantityBox}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="수량 줄이기"
                      accessibilityState={{ disabled: submitting || kujiCheckoutExpired || quantity <= 1 }}
                      disabled={submitting || kujiCheckoutExpired || quantity <= 1}
                      onPress={() => setQuantity((current) => (
                        normalizeDrawPurchaseCount(current - 1, product.availableQuantity)
                      ))}
                      style={({ pressed }) => [styles.quantityButton, pressed && styles.pressed]}
                    >
                      <DecorativeIonicon name="remove" size={20} color={submitting || kujiCheckoutExpired || quantity <= 1 ? colors.line : colors.ink} />
                    </Pressable>
                    <Text style={styles.quantityValue}>{quantity}</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="수량 늘리기"
                      accessibilityState={{ disabled: submitting || kujiCheckoutExpired || quantity >= maxQuantity }}
                      disabled={submitting || kujiCheckoutExpired || quantity >= maxQuantity}
                      onPress={() => setQuantity((current) => (
                        normalizeDrawPurchaseCount(current + 1, product.availableQuantity)
                      ))}
                      style={({ pressed }) => [styles.quantityButton, pressed && styles.pressed]}
                    >
                      <DecorativeIonicon name="add" size={20} color={submitting || kujiCheckoutExpired || quantity >= maxQuantity ? colors.line : colors.ink} />
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>쿠폰 사용</Text>
              <View
                accessible
                accessibilityLabel="쿠폰 사용, 미적용, 사용 가능 0장"
                style={styles.couponRow}
              >
                <Text style={styles.rowTitle}>쿠폰 <Text style={styles.unavailableBadge}>미적용</Text></Text>
                <Text style={styles.rowValue}>사용 가능 0장</Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>포인트 사용</Text>
              <View style={styles.pointRow}>
                <SeedInputShell focused={pointInputFocused} style={styles.pointInputShell}>
                  <TextInput
                    accessibilityLabel="사용할 포인트"
                    value={pointInput}
                    editable={!submitting && pointBalance > 0}
                    keyboardType="number-pad"
                    maxLength={10}
                    onChangeText={(value) => setPointInput(
                      normalizedCheckoutPointInput(value, pointBalance, subtotal),
                    )}
                    onBlur={() => setPointInputFocused(false)}
                    onFocus={() => setPointInputFocused(true)}
                    selectTextOnFocus
                    style={styles.pointInput}
                  />
                  <Text style={styles.pointUnit}>원</Text>
                </SeedInputShell>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="보유 포인트 모두 사용"
                  accessibilityState={{ disabled: submitting || pointBalance <= 0 }}
                  disabled={submitting || pointBalance <= 0}
                  onPress={() => setPointInput(
                    normalizedCheckoutPointInput(String(pointBalance), pointBalance, subtotal),
                  )}
                  style={({ pressed }) => [styles.useAllButton, pressed && styles.pressed, pointBalance <= 0 && styles.disabled]}
                >
                  <Text style={styles.useAllLabel}>모두 사용</Text>
                </Pressable>
              </View>
              <Text style={styles.pointBalance}>보유 {pointBalance.toLocaleString("ko-KR")}P</Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>결제 수단</Text>
              {testPaymentsEnabled ? (
                <SeedInlineGuidance
                  paragraphs={[
                    "TEST_PG · 실제 과금 없음",
                    "아래 수단은 모두 동일한 테스트 결제로 처리하며 카드나 간편결제 정보는 입력하지 않아요.",
                  ]}
                />
              ) : livePaymentsEnabled && paymentTotal > 0 ? (
                <Text style={styles.sectionCaption}>
                  KG이니시스 카드 결제창에서 결제를 완료하면 서버 승인 확인 후 추첨권이 발급돼요.
                </Text>
              ) : (
                <Text style={styles.sectionCaption}>
                  {isDrawCategory(product.category)
                    ? paymentTotal === 0
                      ? "포인트 전액 결제는 서버 확인 후 바로 추첨권이 발급돼요."
                      : "카드·간편결제 제공 화면은 연결 준비 중이며, 완료 전에는 추첨권이 발급되지 않아요."
                    : "결제 서비스 연결 전에는 결제 수단을 선택하거나 주문을 접수할 수 없어요."}
                </Text>
              )}
              <View style={styles.paymentList}>
                {PAYMENT_METHODS.map((method, index) => {
                  const paymentMethodsEnabled = testPaymentsEnabled || livePaymentsEnabled;
                  const selected = paymentMethodsEnabled && selectedPaymentMethod === method.id;
                  const caption = testPaymentsEnabled
                    ? selected
                      ? "선택됨 · 공통 TEST_PG"
                      : "테스트용 선택 가능 · 공통 TEST_PG"
                    : livePaymentsEnabled
                      ? "KG이니시스 카드 결제"
                      : method.unavailableCaption;
                  return (
                    <Pressable
                      key={method.id}
                      accessibilityRole="radio"
                      accessibilityLabel={`${method.label}, ${caption}`}
                      accessibilityState={{ disabled: !paymentMethodsEnabled, selected }}
                      disabled={!paymentMethodsEnabled}
                      onPress={() => setSelectedPaymentMethod(method.id)}
                      style={({ pressed }) => [
                        styles.paymentMethod,
                        index > 0 && styles.paymentMethodBorder,
                        selected && styles.paymentMethodSelected,
                        !paymentMethodsEnabled && styles.paymentMethodDisabled,
                        pressed && styles.pressed,
                      ]}
                    >
                      <DecorativeIonicon
                        name={method.icon}
                        size={22}
                        color={selected ? colors.greenInk : colors.muted}
                      />
                      <View style={styles.paymentCopy}>
                        <Text style={styles.paymentTitle}>{method.label}</Text>
                        <Text style={styles.paymentCaption}>{caption}</Text>
                      </View>
                      <DecorativeIonicon
                        name={paymentMethodsEnabled
                          ? selected ? "radio-button-on" : "radio-button-off"
                          : "lock-closed-outline"}
                        size={20}
                        color={selected ? colors.greenInk : colors.muted}
                      />
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>결제 금액</Text>
              <PriceRow label="상품 금액" value={`${subtotal.toLocaleString("ko-KR")}원`} />
              <PriceRow label="쿠폰 할인 금액" value="0원" />
              <PriceRow label="포인트 사용" value={pointUsed ? `-${pointUsed.toLocaleString("ko-KR")}원` : "0원"} />
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>총 결제 금액</Text>
                <Text style={styles.totalValue}>{paymentTotal.toLocaleString("ko-KR")}원</Text>
              </View>
            </View>

            <View style={styles.agreementSection}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: agreementAccepted, disabled: submitting }}
                accessibilityLabel="주문내용 확인 및 결제 동의"
                disabled={submitting}
                onPress={() => setAgreementAccepted((current) => !current)}
                style={({ pressed }) => [styles.agreementRow, pressed && styles.pressed]}
              >
                <View style={[styles.agreementCheck, agreementAccepted && styles.agreementCheckSelected]}>
                  {agreementAccepted ? <DecorativeIonicon name="checkmark" size={16} color={seed.color.foreground.onBrand} /> : null}
                </View>
                <Text style={styles.agreementLabel}>주문내용 확인 및 결제 동의</Text>
              </Pressable>
              <CheckoutNoticeSections />
            </View>

          </ScrollView>

          <FloatingBottomActionPanel panelStyle={styles.footer}>
            <SeedActionButton
              label={submitting
                ? "주문 확인 중"
                : product.category === "gacha" && pendingGachaIntent
                  ? "이전 주문 확인"
                  : paymentAvailability === "demo"
                    ? `${paymentTotal.toLocaleString("ko-KR")}원 테스트 결제`
                    : paymentAvailability === "live"
                      ? `${paymentTotal.toLocaleString("ko-KR")}원 결제하기`
                    : paymentAvailability === "points"
                      ? "포인트로 구매하기"
                      : "결제 수단 준비 중"}
              disabled={submitting || (
                checkoutNeedsAgreement(product.category === "gacha" && Boolean(pendingGachaIntent))
                && !agreementAccepted
              ) || (
                !recoveringGachaOrder
                && paymentAvailability === "unavailable"
              ) || (
                drawMode
                && !(product.category === "gacha" && pendingGachaIntent)
                && (kujiCheckoutExpired || !drawAvailable || quantity <= 0)
              )}
              onPress={finishPreparation}
              style={styles.footerAction}
            />
          </FloatingBottomActionPanel>
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

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  state: { flex: 1, minHeight: 420, paddingHorizontal: seed.spacing.globalGutter, alignItems: "center", justifyContent: "center", gap: seed.spacing.componentDefault },
  stateTitle: { color: colors.ink, ...seed.typography.subtitle, textAlign: "center" },
  stateBody: { color: colors.muted, ...seed.typography.body },
  content: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x3_5, paddingBottom: seed.spacing.x7 },
  checkoutTimer: { minHeight: 88, paddingHorizontal: seed.spacing.x3_5, paddingVertical: seed.spacing.x3, borderRadius: seed.radius.r4, borderWidth: 1, borderColor: colors.brand, backgroundColor: seed.color.background.brandWeak, flexDirection: "row", alignItems: "center", gap: seed.spacing.x3 },
  checkoutTimerExpired: { borderColor: seed.color.stroke.critical, backgroundColor: seed.color.background.criticalWeak },
  checkoutTimerCopy: { flex: 1, minWidth: 0 },
  checkoutTimerTitle: { marginBottom: seed.spacing.x1, color: colors.ink, ...seed.typography.bodyStrong },
  checkoutTimerCaption: { color: colors.muted, ...seed.typography.caption },
  checkoutTimerValue: { minWidth: 84, color: colors.greenInk, fontSize: 24, lineHeight: 31, fontWeight: "900", fontVariant: ["tabular-nums"], textAlign: "right" },
  section: { paddingVertical: seed.spacing.x3_5, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral },
  sectionTitle: { marginBottom: seed.spacing.x3, color: colors.ink, ...seed.typography.subtitle },
  sectionCaption: { marginTop: -seed.spacing.x1_5, marginBottom: seed.spacing.x3, color: colors.muted, ...seed.typography.caption },
  productRow: { padding: seed.spacing.x3, ...catalogProductCardSurface, flexDirection: "row", alignItems: "center", gap: seed.spacing.componentDefault },
  productImage: { width: 64, height: 64, overflow: "hidden", borderRadius: seed.radius.r2, backgroundColor: seed.color.background.neutralWeak },
  productImageAsset: { width: "100%", height: "100%" },
  productCopy: { flex: 1, minWidth: 0 },
  ipName: { color: colors.muted, ...seed.typography.caption },
  productName: { marginTop: seed.spacing.x1, color: colors.ink, ...seed.typography.bodyStrong },
  productFieldDivider: { marginTop: seed.spacing.x2 },
  productMeta: { marginTop: seed.spacing.x2, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x2 },
  category: { paddingHorizontal: seed.spacing.x2, paddingVertical: seed.spacing.x1, borderRadius: seed.radius.r1_5, overflow: "hidden", color: colors.ink, backgroundColor: colors.brand, fontSize: 11, lineHeight: 15, fontWeight: "700" },
  productPrice: { flex: 1, color: colors.ink, ...seed.typography.label, fontWeight: "700", textAlign: "right" },
  quantityRow: { marginTop: seed.spacing.x3, paddingTop: seed.spacing.x3, minHeight: 58, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: seed.color.stroke.muted, flexDirection: "row", alignItems: "center", gap: seed.spacing.x3 },
  quantityCopy: { flex: 1 },
  quantityTitle: { color: colors.ink, ...seed.typography.bodyStrong },
  quantityCaption: { marginTop: seed.spacing.x0_5, color: colors.muted, ...seed.typography.caption },
  quantityBox: { height: 48, borderRadius: seed.radius.r3, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.basement, flexDirection: "row", alignItems: "center" },
  quantityButton: { width: seed.size.touchTarget, height: seed.size.touchTarget, alignItems: "center", justifyContent: "center" },
  quantityValue: { minWidth: 28, color: colors.ink, fontSize: 16, lineHeight: 22, fontWeight: "900", textAlign: "center", fontVariant: ["tabular-nums"] },
  couponRow: { minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x3 },
  unavailableBadge: { color: colors.muted, ...seed.typography.caption },
  pointRow: { minHeight: seed.size.touchTarget, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2 },
  pointInputShell: { flex: 1, minWidth: 0, minHeight: seed.size.touchTarget, paddingHorizontal: seed.spacing.x3, backgroundColor: seed.color.layer.default },
  pointInput: { flex: 1, minWidth: 0, paddingVertical: seed.spacing.x2, color: colors.ink, ...seed.typography.bodyStrong, textAlign: "left", fontVariant: ["tabular-nums"] },
  pointUnit: { marginLeft: seed.spacing.x1, color: colors.muted, ...seed.typography.body },
  useAllButton: { minHeight: seed.size.touchTarget, paddingHorizontal: seed.spacing.x3, borderWidth: 1, borderColor: seed.color.stroke.neutral, borderRadius: seed.radius.r3, backgroundColor: seed.color.layer.default, alignItems: "center", justifyContent: "center" },
  useAllLabel: { color: colors.ink, ...seed.typography.label, fontWeight: "700" },
  pointBalance: { marginTop: seed.spacing.x1_5, color: colors.muted, ...seed.typography.caption, textAlign: "left" },
  rowTitle: { color: colors.ink, ...seed.typography.bodyStrong },
  rowValue: { color: colors.muted, ...seed.typography.label, fontWeight: "700" },
  paymentList: { overflow: "hidden", borderRadius: seed.radius.r3, borderWidth: 1, borderColor: seed.color.stroke.neutral },
  paymentMethod: { minHeight: 62, paddingHorizontal: seed.spacing.x3, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2_5, backgroundColor: seed.color.layer.basement },
  paymentMethodBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: seed.color.stroke.neutral },
  paymentMethodSelected: { backgroundColor: seed.color.background.brandWeak },
  paymentMethodDisabled: { opacity: seed.state.disabledOpacity },
  paymentCopy: { flex: 1 },
  paymentTitle: { color: colors.ink, ...seed.typography.bodyStrong },
  paymentCaption: { marginTop: seed.spacing.x0_5, color: colors.muted, ...seed.typography.caption },
  priceRow: { minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x3 },
  priceLabel: { color: colors.muted, ...seed.typography.body },
  priceValue: { color: colors.ink, ...seed.typography.bodyStrong },
  totalRow: { marginTop: seed.spacing.x2, paddingTop: seed.spacing.x3, borderTopWidth: 1, borderTopColor: seed.color.stroke.neutral, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x3 },
  totalLabel: { color: colors.ink, ...seed.typography.bodyStrong },
  totalValue: { color: colors.ink, fontSize: 20, lineHeight: 27, fontWeight: "900" },
  agreementSection: { paddingVertical: seed.spacing.x3_5, gap: seed.spacing.x2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral },
  agreementRow: { minHeight: seed.size.touchTarget, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2_5 },
  agreementCheck: { width: 24, height: 24, borderRadius: seed.radius.r1_5, borderWidth: 1, borderColor: seed.color.stroke.contrast, alignItems: "center", justifyContent: "center" },
  agreementCheckSelected: { borderColor: seed.color.background.brandSolid, backgroundColor: seed.color.background.brandSolid },
  agreementLabel: { flex: 1, color: colors.ink, ...seed.typography.bodyStrong },
  footer: {},
  footerAction: { width: "100%" },
  pressed: { opacity: seed.state.pressedOpacity, transform: [{ translateY: seed.state.pressedTranslateY }, { scale: seed.state.pressedScale }] },
  disabled: { opacity: seed.state.disabledOpacity },
});
