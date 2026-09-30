import Constants from "expo-constants";
import { type Href, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Alert,
  FlatList,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { DecorativeIonicon } from "@/components/DecorativeIonicon";
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  FloatingBottomActionPanel,
  useFloatingBottomActionContentInset,
} from "@/components/FloatingBottomActionPanel";
import { KoreanPixelTitle, KoreanPixelTitleAccessory } from "@/components/RootCategoryTitle";
import { AppText as Text, BalancedAppText } from "@/components/Typography";
import { SeedActionButton, SeedInlineGuidance } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import {
  clearPendingGachaCheckoutOrderIntent,
  fetchCheckoutActorId,
  fetchCheckoutOrder,
  paidGachaOrderEntitlementIds,
  readPendingGachaCheckoutOrderIntent,
} from "@/features/checkout/checkout-api";
import {
  consumeDrawEntitlement,
  type DrawResult,
} from "@/features/draw/draw-reveal-api";
import { fetchCommittedDrawProductSnapshot } from "@/features/draw/draw-product-snapshot";
import {
  consumeDrawsSequentially,
  resolveDrawOpenMode,
  verifyCommittedDrawBatch,
  type DrawOpenMode,
} from "@/features/draw/draw-open-mode";
import {
  assertCommittedDrawResultMatchesRoute,
  isCommittedDrawSequenceConsumed,
  resolveCommittedDrawSequence,
} from "@/features/draw/draw-reveal-sequence";
import { GachaLeverMachine } from "@/features/draw/GachaLeverMachine";
import { fetchPaidGachaDrawCompletion } from "@/features/draw/gacha-completion-api";
import { assertPaidGachaDrawCompletion } from "@/features/draw/gacha-completion-state";
import { KujiPeelTicket } from "@/features/draw/KujiPeelTicket";
import { DRAW_MOTION } from "@/features/draw/draw-reveal-state";
import {
  createGachaFireflyConfigs,
  GACHA_FIREFLY_DURATION_MS,
  sampleKujiFireflyMotion,
  type KujiFireflyConfig,
} from "@/features/draw/kuji-firefly-motion";
import { parseKujiTicketNumbers } from "@/features/kuji/kuji-selection-state";
import {
  categoryLabel,
  type ProductDetailSnapshot,
} from "@/features/shop/shop-api";
import { productSubjectTitle } from "@/features/shop/product-title";
import { shopTabPathForCategory } from "@/features/shop/shop-navigation";
import {
  resolveCatalogImageUrl,
  resolveMobileRuntimeConfig,
  type MobilePlatform,
} from "@/lib/runtime-config";
import { readDrawSoundEnabled, writeDrawSoundEnabled } from "@/lib/local-database";
import { openCustomerLogin } from "@/features/auth/login-navigation";
import { readAuthTokens, subscribeAuthTokens, type StoredAuthTokens } from "@/lib/session-store";
import { colors } from "@/theme";

type RevealMode = DrawOpenMode;

class DrawLoginRequiredError extends Error {
  constructor() {
    super("로그인이 필요해요");
    this.name = "DrawLoginRequiredError";
  }
}

function hasUsableAccessToken(tokens: StoredAuthTokens | null): tokens is StoredAuthTokens {
  if (!tokens?.accessToken) return false;
  if (!tokens.expiresAt) return true;
  const expiresAtMs = Date.parse(tokens.expiresAt);
  return !Number.isFinite(expiresAtMs) || expiresAtMs > Date.now();
}

const MAX_LOGIN_RETURN_PATH_LENGTH = 300;

function drawRevealReturnPath(
  entitlementId: string,
  params: Record<string, string | string[] | undefined>,
  productId: string,
): string {
  const query = new URLSearchParams();
  for (const key of ["productId", "entitlementIds", "orderId", "category", "mode", "count", "tickets"] as const) {
    const value = params[key];
    const first = Array.isArray(value) ? value[0] : value;
    if (first) query.set(key, first);
  }
  const queryString = query.toString();
  const path = `/draw/reveal/${encodeURIComponent(entitlementId)}${queryString ? `?${queryString}` : ""}`;
  if (path.length <= MAX_LOGIN_RETURN_PATH_LENGTH) return path;
  return productId ? `/product/${encodeURIComponent(productId)}` : "/(tabs)/storage";
}
const smoothRevealEasing = Easing.bezier(0.16, 0.82, 0.28, 1);

export function DrawRevealScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const safeAreaInsets = useSafeAreaInsets();
  const floatingBottomInset = useFloatingBottomActionContentInset();
  const params = useLocalSearchParams<{
    entitlementId?: string | string[];
    productId?: string | string[];
    entitlementIds?: string | string[];
    orderId?: string | string[];
    category?: string | string[];
    mode?: string | string[];
    count?: string | string[];
    tickets?: string | string[];
  }>();
  const routeEntitlementId = firstParam(params.entitlementId) ?? "";
  const committedSequence = useMemo(
    () => resolveCommittedDrawSequence(
      routeEntitlementId,
      firstParam(params.entitlementIds),
    ),
    [params.entitlementIds, routeEntitlementId],
  );
  const entitlementId = committedSequence.activeEntitlementId ?? "";
  const productId = firstParam(params.productId) ?? "";
  const routeOrderId = firstParam(params.orderId) ?? "";
  const categoryHint = drawCategoryFromParam(firstParam(params.category));
  const requestedMode = firstParam(params.mode);
  const routeTickets = parseKujiTicketNumbers(firstParam(params.tickets));
  const count = Math.max(1, committedSequence.total);
  const mode: RevealMode = resolveDrawOpenMode(requestedMode, count);
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
  const [opening, setOpening] = useState(false);
  const [result, setResult] = useState<DrawResult | null>(null);
  const [batchResults, setBatchResults] = useState<DrawResult[]>([]);
  const [batchError, setBatchError] = useState("");
  const [batchRevealSettled, setBatchRevealSettled] = useState(false);
  const [revealSettled, setRevealSettled] = useState(false);
  const [revealRequestSignal, setRevealRequestSignal] = useState(0);
  const [revealResetSignal, setRevealResetSignal] = useState(0);
  const [message, setMessage] = useState("");
  const [loginRequired, setLoginRequired] = useState(false);
  // Seed from Reanimated's synchronous system flag so the stage never mounts
  // in Reduced Motion and then flips; the listener below tracks later changes.
  const systemReduceMotion = useReducedMotion();
  const [reduceMotion, setReduceMotion] = useState(systemReduceMotion);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundPreferenceReady, setSoundPreferenceReady] = useState(false);
  const [kujiDragActive, setKujiDragActive] = useState(false);
  const requestInFlightRef = useRef(false);
  const skipRequestedRef = useRef(false);
  const lastAnnouncementRef = useRef("");
  const completionScope = `${routeOrderId}:${productId}:${committedSequence.entitlementIds.join(",").toLowerCase()}`;
  const routeKey = `committed:${entitlementId}:${completionScope}`;
  const consumedSequenceRef = useRef<{ scope: string; ids: Set<string> }>({ scope: "", ids: new Set() });
  const returningRef = useRef(false);
  const completionFocusRef = useRef(false);
  const completionGenerationRef = useRef(0);
  const activeRouteKeyRef = useRef(routeKey);
  const requestGenerationRef = useRef(0);
  const requestMountedRef = useRef(true);
  // A parameter round-trip must not revive a completion from an earlier render.
  if (activeRouteKeyRef.current !== routeKey) completionGenerationRef.current += 1;
  activeRouteKeyRef.current = routeKey;
  const isCurrentRequest = useCallback((generation: number, owner: string) => (
    requestMountedRef.current
    && requestGenerationRef.current === generation
    && activeRouteKeyRef.current === owner
  ), []);
  const sourceCategory = snapshot?.product.category ?? categoryHint;
  const sourceProductId = result?.productId ?? batchResults[0]?.productId ?? snapshot?.product.id ?? productId;
  const committedBatchComplete = mode === "all"
    && committedSequence.total >= 2
    && batchResults.length === committedSequence.total
    && !batchError;
  const committedBatchReady = mode === "all" && batchResults.length > 0;
  // Both draw categories hold the committed batch summary until the stage's
  // finite first-result reveal has settled (Reduced Motion settles at once).
  const committedBatchSummaryVisible = committedBatchReady
    && ((sourceCategory !== "kuji" && sourceCategory !== "gacha") || batchRevealSettled);
  const settledCommittedResult = result ?? (committedBatchComplete ? batchResults.at(-1) ?? null : null);
  // The gacha stage opens onto the first committed batch result in "all" mode.
  const gachaStagePrize = result ?? batchResults[0] ?? null;
  const gachaStagePrizeView = useMemo(() => ({
    result: gachaStagePrize,
    imageUri: gachaStagePrize
      ? resolveCatalogImageUrl(gachaStagePrize.prizeImageUrl, runtime.assetBaseUrl)
      : null,
    ipName: snapshot?.ip?.nameKo,
  }), [gachaStagePrize, runtime.assetBaseUrl, snapshot?.ip?.nameKo]);
  const gachaBottomInset = safeAreaInsets.bottom + seed.spacing.x4;

  useFocusEffect(useCallback(() => {
    completionFocusRef.current = true;
    return () => {
      completionFocusRef.current = false;
      completionGenerationRef.current += 1;
    };
  }, []));

  useEffect(() => {
    if (!loginRequired) return;
    let active = true;
    const recheck = () => {
      void readAuthTokens().then((tokens) => {
        if (active && hasUsableAccessToken(tokens)) setLoginRequired(false);
      }).catch(() => undefined);
    };
    const unsubscribe = subscribeAuthTokens(recheck);
    recheck();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [loginRequired]);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let active = true;
    void readDrawSoundEnabled(db)
      .then((enabled) => {
        if (active) setSoundEnabled(enabled);
      })
      .catch(() => {
        if (active) setSoundEnabled(true);
      })
      .finally(() => {
        if (active) setSoundPreferenceReady(true);
      });
    return () => {
      active = false;
    };
  }, [db]);

  useEffect(() => {
    requestMountedRef.current = true;
    return () => {
      requestMountedRef.current = false;
      requestGenerationRef.current += 1;
    };
  }, []);

  // Route changes reset the stage; the initial mount already starts fresh and
  // must not bump the reset signal (the stage would replay a full reset).
  const resetRouteKeyRef = useRef(routeKey);
  useEffect(() => {
    if (resetRouteKeyRef.current === routeKey) return;
    resetRouteKeyRef.current = routeKey;
    requestGenerationRef.current += 1;
    requestInFlightRef.current = false;
    skipRequestedRef.current = false;
    lastAnnouncementRef.current = "";
    setOpening(false);
    setSnapshot(null);
    setResult(null);
    setBatchResults([]);
    setBatchError("");
    setBatchRevealSettled(false);
    setRevealSettled(false);
    setMessage("");
    setRevealResetSignal((current) => current + 1);
  }, [routeKey]);

  useEffect(() => {
    if (committedBatchSummaryVisible && batchResults.length === count && !batchError) {
      const announcementKey = `batch:${batchResults.map((item) => item.id).join(",")}`;
      if (lastAnnouncementRef.current === announcementKey) return;
      lastAnnouncementRef.current = announcementKey;
      AccessibilityInfo.announceForAccessibility(`${batchResults.length}개 상품 결과를 표시했어요.`);
      return;
    }
    const committedResultPresented = result && revealSettled;
    if (committedResultPresented) {
      const announcementKey = `result:${result.id}`;
      if (lastAnnouncementRef.current === announcementKey) return;
      lastAnnouncementRef.current = announcementKey;
      AccessibilityInfo.announceForAccessibility(
        `상품 오픈 완료, ${result.rarity}, ${productSubjectTitle(result.prizeName, snapshot?.ip?.nameKo)}`,
      );
      return;
    }
  }, [
    count,
    batchError,
    batchResults,
    committedBatchSummaryVisible,
    result,
    revealSettled,
    snapshot?.ip?.nameKo,
  ]);

  const goBack = () => {
    completionFocusRef.current = false;
    completionGenerationRef.current += 1;
    if (router.canGoBack()) router.back();
    else router.replace(shopTabPathForCategory(sourceCategory));
  };

  const returnToSourceProduct = async () => {
    if (returningRef.current || !completionFocusRef.current) return;
    returningRef.current = true;
    const owner = routeKey;
    const generation = completionGenerationRef.current;
    const isCurrentReturn = () => requestMountedRef.current && completionFocusRef.current
      && completionGenerationRef.current === generation && activeRouteKeyRef.current === owner;
    try {
      if (
        sourceCategory === "gacha" && routeOrderId
        && settledCommittedResult
        && (committedBatchComplete || (revealSettled && !committedSequence.nextEntitlementId))
        && consumedSequenceRef.current.scope === completionScope
      ) {
        const tokens = await readAuthTokens();
        if (!isCurrentReturn()) return;
        if (!tokens?.accessToken) throw new Error("로그인 계정을 확인하지 못했어요.");
        const actorId = await fetchCheckoutActorId(runtime.apiBaseUrl, tokens.accessToken);
        if (!isCurrentReturn()) return;
        const intent = await readPendingGachaCheckoutOrderIntent(db, { actorId, productId });
        if (!isCurrentReturn()) return;
        if (intent?.orderId === routeOrderId) {
          const order = await fetchCheckoutOrder(runtime.apiBaseUrl, tokens.accessToken, routeOrderId);
          if (!isCurrentReturn()) return;
          // The route may omit tickets or include tickets from another order.
          // Only the current user's exact server order can authorize retirement.
          const expectedIds = paidGachaOrderEntitlementIds(order, intent);
          let complete = expectedIds && isCommittedDrawSequenceConsumed(expectedIds, consumedSequenceRef.current.ids);
          if (
            expectedIds && !complete
            && isCommittedDrawSequenceConsumed(committedSequence.entitlementIds, consumedSequenceRef.current.ids)
          ) {
            const proof = await fetchPaidGachaDrawCompletion(runtime.apiBaseUrl, tokens.accessToken, routeOrderId);
            if (!isCurrentReturn()) return;
            assertPaidGachaDrawCompletion(proof, {
              intent, entitlementIds: expectedIds, currentEntitlementIds: committedSequence.entitlementIds,
              settledResult: settledCommittedResult,
            });
            complete = true;
          }
          if (complete) {
            const latestTokens = await readAuthTokens();
            if (!isCurrentReturn()) return;
            if (latestTokens?.accessToken !== tokens.accessToken) throw new Error("로그인 정보가 변경됐어요.");
            await clearPendingGachaCheckoutOrderIntent(db, intent, isCurrentReturn);
          }
        }
      }
    } catch {
      if (!isCurrentReturn()) return;
      Alert.alert("결과는 안전하게 보관됐어요", "구매 완료 확인이 지연되어 복구 정보를 유지했어요. 다음 구매 화면에서 이전 주문을 다시 확인할 수 있어요.");
    } finally {
      returningRef.current = false;
    }
    if (!isCurrentReturn()) return;
    completionFocusRef.current = false;
    completionGenerationRef.current += 1;
    if (!sourceProductId) {
      router.replace(shopTabPathForCategory(sourceCategory));
      return;
    }
    router.dismissTo(`/product/${encodeURIComponent(sourceProductId)}` as Href);
  };

  const openAllProducts = async () => {
    if (mode !== "all" || requestInFlightRef.current || committedBatchComplete) return;
    if (!routeOrderId || !productId || committedSequence.total < 2) {
      setMessage("한 번에 열 결제 주문과 추첨권을 확인할 수 없어요.");
      return;
    }
    if (committedSequence.activeIndex !== 0) {
      setMessage("한 번에 열 추첨권의 시작 순서를 다시 확인해 주세요.");
      return;
    }

    const generation = ++requestGenerationRef.current;
    const owner = routeKey;
    requestInFlightRef.current = true;
    setOpening(true);
    setBatchError("");
    setBatchRevealSettled(false);
    setMessage("");
    try {
      const tokens = await readAuthTokens();
      if (!isCurrentRequest(generation, owner)) return;
      if (!hasUsableAccessToken(tokens)) throw new DrawLoginRequiredError();
      const order = await fetchCheckoutOrder(runtime.apiBaseUrl, tokens.accessToken, routeOrderId);
      if (!isCurrentRequest(generation, owner)) return;
      const verified = verifyCommittedDrawBatch(order, {
        orderId: routeOrderId,
        productId,
        category: categoryHint,
        entitlementIds: committedSequence.entitlementIds,
      });
      if (verified.category === "kuji" && routeTickets.length !== verified.entitlementIds.length) {
        throw new Error("선택한 쿠지 번호와 추첨권 정보를 다시 확인해 주세요.");
      }

      const outcome = await consumeDrawsSequentially(
        verified.entitlementIds,
        async (currentEntitlementId, index) => {
          const committed = await consumeDrawEntitlement(
            runtime.apiBaseUrl,
            tokens.accessToken,
            currentEntitlementId,
          );
          if (!isCurrentRequest(generation, owner)) throw new Error("상품 확인 요청이 취소됐어요.");
          const expectedKujiSlot = verified.category === "kuji"
            ? Number(routeTickets[index])
            : undefined;
          assertCommittedDrawResultMatchesRoute(committed, {
            entitlementId: currentEntitlementId,
            productId,
            kujiSlotNumber: Number.isInteger(expectedKujiSlot) ? expectedKujiSlot : undefined,
          });
          return committed;
        },
      );
      if (!isCurrentRequest(generation, owner)) return;

      for (const committed of outcome.results) {
        const imageUri = resolveCatalogImageUrl(committed.prizeImageUrl, runtime.assetBaseUrl);
        if (imageUri) void Image.prefetch(imageUri).catch(() => undefined);
      }
      if (verified.category === "gacha" && routeOrderId) {
        if (consumedSequenceRef.current.scope !== completionScope) {
          consumedSequenceRef.current = { scope: completionScope, ids: new Set() };
        }
        for (const committed of outcome.results) {
          consumedSequenceRef.current.ids.add(committed.entitlementId.toLowerCase());
        }
      }

      const representative = outcome.results[0];
      if (representative) {
        setBatchResults(outcome.results);
        try {
          const committedSnapshot = await fetchCommittedDrawProductSnapshot(
            runtime.apiBaseUrl,
            representative.productId,
            tokens.accessToken,
          );
          if (isCurrentRequest(generation, owner)) setSnapshot(committedSnapshot);
        } catch {
          // Immutable draw results are still presentable if the catalog changed after payment.
        }
      }
      if (!isCurrentRequest(generation, owner)) return;
      if (outcome.error) {
        if (!outcome.results.length) throw outcome.error;
        setBatchError(
          `${outcome.results.length}개 결과는 서버에 확정되어 보관함에 저장됐어요. `
          + `나머지 ${outcome.remainingEntitlementIds.length}개는 다시 시도하거나 남은 뽑기에서 이어서 확인할 수 있어요.`,
        );
      }
    } catch (error) {
      if (!isCurrentRequest(generation, owner)) return;
      if (error instanceof DrawLoginRequiredError && !batchResults.length) {
        setBatchResults([]);
        setLoginRequired(true);
        return;
      }
      if (batchResults.length) {
        setBatchError("이미 확정된 결과는 보관함에 안전하게 유지돼요. 남은 결과는 다시 시도하거나 남은 뽑기에서 이어서 확인해 주세요.");
      } else {
        setBatchResults([]);
        setMessage(error instanceof Error ? error.message : "상품 결과를 확인하지 못했어요.");
      }
    } finally {
      if (isCurrentRequest(generation, owner)) {
        requestInFlightRef.current = false;
        setOpening(false);
      }
    }
  };

  const openProduct = async () => {
    if (mode === "all") {
      await openAllProducts();
      return;
    }
    if (requestInFlightRef.current || result) return;
    if (!entitlementId) {
      setMessage("사용할 수 있는 추첨권을 찾을 수 없어요.");
      return;
    }

    const generation = ++requestGenerationRef.current;
    const owner = routeKey;
    requestInFlightRef.current = true;
    setOpening(true);
    setRevealSettled(false);
    setMessage("");
    try {
      const tokens = await readAuthTokens();
      if (!isCurrentRequest(generation, owner)) return;
      if (!hasUsableAccessToken(tokens)) throw new DrawLoginRequiredError();
      const committed = await consumeDrawEntitlement(
        runtime.apiBaseUrl,
        tokens.accessToken,
        entitlementId,
      );
      if (!isCurrentRequest(generation, owner)) return;
      assertCommittedDrawResultMatchesRoute(committed, {
        entitlementId,
        productId: productId || undefined,
      });
      const committedImageUri = resolveCatalogImageUrl(
        committed.prizeImageUrl,
        runtime.assetBaseUrl,
      );
      if (committedImageUri) {
        void Image.prefetch(committedImageUri).catch(() => undefined);
      }
      let committedSnapshot: ProductDetailSnapshot | null = null;
      try {
        committedSnapshot = await fetchCommittedDrawProductSnapshot(
          runtime.apiBaseUrl,
          committed.productId,
          tokens.accessToken,
        );
      } catch {
        committedSnapshot = null;
      }
      if (!isCurrentRequest(generation, owner)) return;
      const committedCategory = committedSnapshot?.product.category ?? categoryHint;
      const expectedKujiSlot = committedCategory === "kuji"
        && routeTickets.length === committedSequence.total
        ? Number(routeTickets[committedSequence.activeIndex])
        : undefined;
      assertCommittedDrawResultMatchesRoute(committed, {
        entitlementId,
        productId: productId || undefined,
        kujiSlotNumber: Number.isInteger(expectedKujiSlot) ? expectedKujiSlot : undefined,
      });
      if (committedCategory === "gacha" && routeOrderId) {
        if (consumedSequenceRef.current.scope !== completionScope) {
          consumedSequenceRef.current = { scope: completionScope, ids: new Set() };
        }
        consumedSequenceRef.current.ids.add(committed.entitlementId.toLowerCase());
      }
      setSnapshot(committedSnapshot);
      setResult(committed);
      if (committedCategory === "gacha" && skipRequestedRef.current) {
        requestInFlightRef.current = false;
        setRevealSettled(true);
      } else if (committedCategory !== "kuji" && committedCategory !== "gacha") {
        requestInFlightRef.current = false;
        setRevealSettled(true);
      }
    } catch (error) {
      if (!isCurrentRequest(generation, owner)) return;
      requestInFlightRef.current = false;
      skipRequestedRef.current = false;
      setResult(null);
      setRevealSettled(false);
      setRevealResetSignal((current) => current + 1);
      if (error instanceof DrawLoginRequiredError) {
        setLoginRequired(true);
        return;
      }
      setMessage(error instanceof Error ? error.message : "상품 결과를 확인하지 못했어요.");
    } finally {
      if (isCurrentRequest(generation, owner)) setOpening(false);
    }
  };

  const handleRevealSettled = () => {
    requestInFlightRef.current = false;
    skipRequestedRef.current = false;
    if (
      (sourceCategory === "kuji" || sourceCategory === "gacha")
      && mode === "all"
      && batchResults.length > 0
    ) {
      setBatchRevealSettled(true);
      return;
    }
    if (result) setRevealSettled(true);
  };

  // The stage components read these through stable identities so a parent
  // render (opening, snapshot, sound) does not force a stage re-render.
  const openProductRef = useRef(openProduct);
  openProductRef.current = openProduct;
  const handleRevealSettledRef = useRef(handleRevealSettled);
  handleRevealSettledRef.current = handleRevealSettled;
  const requestStageOpen = useCallback(() => {
    void openProductRef.current();
  }, []);
  const settleStageReveal = useCallback(() => {
    handleRevealSettledRef.current();
  }, []);

  const prepareNextCommittedResult = () => {
    const nextEntitlementId = committedSequence.nextEntitlementId;
    if (!result || !revealSettled || !nextEntitlementId) return;

    requestInFlightRef.current = false;
    skipRequestedRef.current = false;
    setResult(null);
    setRevealSettled(false);
    setMessage("");
    setRevealResetSignal((current) => current + 1);
    router.setParams({ entitlementId: nextEntitlementId });
  };

  const handleGachaSkip = () => {
    if (sourceCategory !== "gacha") return;
    if (result && revealSettled && committedSequence.nextEntitlementId) {
      prepareNextCommittedResult();
      return;
    }
    skipRequestedRef.current = true;

    if (result) {
      requestInFlightRef.current = false;
      setRevealSettled(true);
      return;
    }

    if (mode === "all" && batchResults.length > 0) {
      // SKIP only reveals already committed server results.
      requestInFlightRef.current = false;
      setBatchRevealSettled(true);
      return;
    }

    if (!requestInFlightRef.current) void openProduct();
  };

  const sourceLabel = sourceCategory === "kuji" ? "쿠지" : sourceCategory === "gacha" ? "가챠" : "상품";
  const screenTitle = `${sourceLabel} 오픈`;
  const committedResultPresented = Boolean(result && revealSettled);
  const committedSequenceFinished = (committedBatchSummaryVisible && committedBatchComplete) || (
    committedResultPresented && committedSequence.nextEntitlementId === null
  );
  const drawSequenceFinished = committedSequenceFinished;
  const gachaResultFooterVisible = sourceCategory === "gacha"
    && drawSequenceFinished
    && !committedBatchSummaryVisible;
  const kujiMotionVisible = sourceCategory === "kuji"
    && !committedBatchSummaryVisible
    && !committedResultPresented;
  const kujiRevealInProgress = sourceCategory === "kuji"
    && !committedResultPresented
    && Boolean(
      opening
      || result
      || (committedBatchReady && !batchRevealSettled),
    );
  const gachaMotionVisible = sourceCategory === "gacha"
    && !committedBatchSummaryVisible
    && !committedResultPresented;
  const gachaRevealInProgress = sourceCategory === "gacha"
    && !committedResultPresented
    && Boolean(
      opening
      || result
      || (committedBatchReady && !batchRevealSettled),
    );
  const drawRevealInProgress = kujiRevealInProgress || gachaRevealInProgress;
  const completed = committedResultPresented || committedBatchSummaryVisible;
  const isDrawCategory = sourceCategory === "kuji" || sourceCategory === "gacha";
  const showStageHeader = !isDrawCategory;
  const remainingCommittedCount = Math.max(0, count - batchResults.length);
  const stageHeading = committedBatchSummaryVisible
    ? count === 1 ? "상품 오픈" : `${count}개 오픈 결과`
    : mode === "all"
      ? `${remainingCommittedCount}개 한 번에 오픈`
      : "상품 오픈";
  const currentCommittedTicket = committedSequence.activeIndex >= 0
    && routeTickets.length === committedSequence.total
    ? routeTickets[committedSequence.activeIndex]
    : undefined;
  // The ember seed suffix stays the established first-slot label so every
  // committed stage keeps its existing deterministic particle layout.
  const drawEmberSeed = `${sourceProductId || sourceCategory || "draw"}:01`;
  const actionLabel = drawSequenceFinished
    ? "상품으로 돌아가기"
    : committedResultPresented && committedSequence.nextEntitlementId
      ? `${committedSequence.activeIndex + 2}번째 쿠지 선택`
    : drawRevealInProgress
      ? "결과 확인 중"
      : mode === "all"
        ? `${remainingCommittedCount}개 한 번에 열기`
        : sourceCategory === "kuji" && count > 1
          ? `${committedSequence.activeIndex + 1}번째 쿠지 열기`
          : opening
            ? "상품 확인 중"
            : "상품 열기";

  const handleAction = () => {
    if (drawSequenceFinished) {
      returnToSourceProduct();
      return;
    }
    if (committedResultPresented && committedSequence.nextEntitlementId) {
      prepareNextCommittedResult();
      return;
    }
    if (kujiMotionVisible && !kujiRevealInProgress) {
      setRevealRequestSignal((current) => current + 1);
      return;
    }
    void openProduct();
  };

  const toggleDrawSound = useCallback(() => {
    if (!soundPreferenceReady) return;
    const previous = soundEnabled;
    const next = !previous;
    setSoundEnabled(next);
    void writeDrawSoundEnabled(db, next).catch(() => {
      if (!requestMountedRef.current) return;
      setSoundEnabled((current) => current === next ? previous : current);
      Alert.alert("효과음 설정", "효과음 설정을 저장하지 못했어요. 다시 시도해 주세요.");
    });
  }, [db, soundEnabled, soundPreferenceReady]);

  const targetImage = snapshot
    ? resolveCatalogImageUrl(snapshot.product.imageUrl, runtime.assetBaseUrl, snapshot.product.version)
    : null;

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="이전 화면으로 돌아가기"
          hitSlop={10}
          onPress={drawSequenceFinished ? returnToSourceProduct : goBack}
          style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
        >
          <DecorativeIonicon name="chevron-back" size={28} color={colors.white} />
        </Pressable>
        <KoreanPixelTitle variant="header" style={styles.headerTitle}>{screenTitle}</KoreanPixelTitle>
        {sourceCategory === "gacha" && !drawSequenceFinished && !committedBatchSummaryVisible ? committedResultPresented ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="다음 가챠 캡슐 준비하기"
            hitSlop={10}
            onPress={prepareNextCommittedResult}
            style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
          >
            <Text style={styles.skipText}>다음 열기</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="가챠 애니메이션 건너뛰기"
            hitSlop={10}
            onPress={handleGachaSkip}
            style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
          >
            <Text style={styles.skipText}>바로 열기</Text>
          </Pressable>
        ) : (
          <View style={styles.headerAction} />
        )}
      </View>

      {loginRequired && !result ? (
        <View style={styles.state}>
          <DecorativeIonicon name="lock-closed-outline" size={38} color={colors.brand} />
          <KoreanPixelTitle variant="section" style={styles.loginRequiredTitle}>로그인이 필요해요</KoreanPixelTitle>
          <BalancedAppText style={styles.stateText}>로그인하면 결제한 상품을 이어서 열 수 있어요.</BalancedAppText>
          <SeedActionButton
            label="로그인"
            onPress={() => openCustomerLogin(
              "로그인하면 결제한 상품을 이어서 열 수 있어요.",
              drawRevealReturnPath(routeEntitlementId, params, productId),
            )}
            style={styles.stateAction}
          />
        </View>
      ) : message && !result ? (
        <View style={styles.state}>
          <DecorativeIonicon name="alert-circle-outline" size={38} color={colors.brand} />
          <BalancedAppText style={styles.stateText}>{message}</BalancedAppText>
          <SeedActionButton
            label="다시 시도"
            onPress={() => void openProduct()}
            style={styles.stateAction}
          />
        </View>
      ) : (
        <>
          {committedBatchSummaryVisible ? (
            <View
              style={[
                styles.summaryContent,
                { paddingBottom: sourceCategory === "gacha" ? gachaBottomInset : floatingBottomInset },
              ]}
            >
              <View style={styles.stageHeader}>
                <View>
                  <Text style={styles.stageEyebrow}>{batchError ? "저장됨" : "열림"}</Text>
                  <KoreanPixelTitle variant="section" style={styles.stageTitle}>{stageHeading}</KoreanPixelTitle>
                </View>
              </View>
              <View style={[styles.stage, styles.summaryStage]}>
                <StageAmbient
                  sourceCategory={sourceCategory}
                  reduceMotion={reduceMotion}
                  seed={`${drawEmberSeed}:summary`}
                />
                <CommittedBatchSummary
                  results={batchResults}
                  total={count}
                  tickets={routeTickets}
                  sourceCategory={sourceCategory}
                  assetBaseUrl={runtime.assetBaseUrl}
                  errorMessage={batchError}
                  loading={opening}
                  reduceMotion={reduceMotion}
                  onAction={committedBatchComplete
                    ? () => void returnToSourceProduct()
                    : () => void openAllProducts()}
                />
              </View>
            </View>
          ) : (
            <ScrollView
              style={styles.drawScroll}
              scrollEnabled={!kujiDragActive}
              directionalLockEnabled
              nestedScrollEnabled
              contentContainerStyle={[
                styles.content,
                sourceCategory === "gacha" && styles.gachaContent,
                { paddingBottom: sourceCategory === "gacha" && !gachaResultFooterVisible ? gachaBottomInset : floatingBottomInset },
              ]}
            >
              {showStageHeader ? (
                <View style={styles.stageHeader}>
                  <View>
                    <Text style={styles.stageEyebrow}>{completed ? "열림" : "준비"}</Text>
                    <KoreanPixelTitle variant="section" style={styles.stageTitle}>{stageHeading}</KoreanPixelTitle>
                  </View>
                </View>
              ) : null}

              <View
                style={[
                  styles.stage,
                  isDrawCategory && styles.expandedDrawStage,
                  sourceCategory === "gacha" && styles.fullGachaStage,
                  sourceCategory === "gacha" && completed && styles.lightGachaStage,
                ]}
              >
                {sourceCategory === "gacha" && !drawSequenceFinished ? (
                  <Pressable
                    accessibilityRole="switch"
                    accessibilityLabel="가챠 효과음"
                    accessibilityState={{ checked: soundPreferenceReady && soundEnabled, disabled: !soundPreferenceReady }}
                    disabled={!soundPreferenceReady}
                    hitSlop={6}
                    onPress={toggleDrawSound}
                    style={({ pressed }) => [
                      styles.soundToggle,
                      !soundPreferenceReady && styles.soundToggleDisabled,
                      pressed && styles.pressed,
                    ]}
                  >
                    <DecorativeIonicon
                      name={soundPreferenceReady && soundEnabled ? "volume-medium-outline" : "volume-mute-outline"}
                      size={21}
                      color={soundPreferenceReady && soundEnabled ? colors.brand : seed.color.inverted.foregroundMuted}
                    />
                  </Pressable>
                ) : null}
                {!(sourceCategory === "gacha" && completed) ? (
                  <StageAmbient sourceCategory={sourceCategory} reduceMotion={reduceMotion} seed={drawEmberSeed} />
                ) : null}
                {sourceCategory === "kuji" ? (
                  <KujiPeelTicket
                    key={entitlementId || productId}
                    ticketNumber={currentCommittedTicket}
                    disabled={opening || completed}
                    settled={completed}
                    reduceMotion={reduceMotion}
                    resultReady={Boolean(result || batchResults.length)}
                    resultLabel={result?.rarity ?? batchResults[0]?.rarity ?? "RESULT"}
                    resultTitle={result?.prizeName
                      ?? batchResults[0]?.prizeName
                      ?? "결과를 확인하고 있어요"}
                    requestSignal={revealRequestSignal}
                    resetSignal={revealResetSignal}
                    onDragActiveChange={setKujiDragActive}
                    onRequestOpen={requestStageOpen}
                    onRevealSettled={settleStageReveal}
                    resultContent={result ? (
                      <CommittedResult
                        result={result}
                        imageUri={resolveCatalogImageUrl(result.prizeImageUrl, runtime.assetBaseUrl)}
                        ipName={snapshot?.ip?.nameKo ?? "등록 작품"}
                        reduceMotion
                      />
                    ) : batchResults[0] ? (
                      <CommittedResult
                        result={batchResults[0]}
                        imageUri={resolveCatalogImageUrl(batchResults[0].prizeImageUrl, runtime.assetBaseUrl)}
                        ipName={snapshot?.ip?.nameKo ?? "등록 작품"}
                        reduceMotion
                      />
                    ) : null}
                  />
                ) : sourceCategory === "gacha" ? (
                  <GachaLeverMachine
                    key={entitlementId || productId}
                    disabled={opening || completed}
                    settled={completed}
                    reduceMotion={reduceMotion}
                    soundEnabled={soundPreferenceReady && soundEnabled}
                    resultReady={Boolean(result || batchResults.length)}
                    requestSignal={revealRequestSignal}
                    resetSignal={revealResetSignal}
                    onRequestOpen={requestStageOpen}
                    onRevealSettled={settleStageReveal}
                    prize={gachaStagePrizeView}
                  />
                ) : result ? (
                  <CommittedResult
                    result={result}
                    imageUri={resolveCatalogImageUrl(result.prizeImageUrl, runtime.assetBaseUrl)}
                    ipName={snapshot?.ip?.nameKo ?? "등록 작품"}
                    reduceMotion={reduceMotion}
                  />
                ) : (
                  <SealedDraw />
                )}
              </View>

              {sourceCategory === "gacha" ? (
                <View
                  accessibilityElementsHidden={!gachaMotionVisible || gachaRevealInProgress}
                  importantForAccessibility={!gachaMotionVisible || gachaRevealInProgress ? "no-hide-descendants" : "auto"}
                  style={{ opacity: gachaMotionVisible && !gachaRevealInProgress ? 1 : 0 }}
                >
                  <SeedInlineGuidance style={styles.gachaInteractionHint}>
                    레버 6회 연속 터치 또는 시계 방향 1바퀴 드래그
                  </SeedInlineGuidance>
                </View>
              ) : null}

              {snapshot && sourceCategory !== "gacha" ? (
                <View style={styles.targetRow}>
                  {targetImage ? (
                    <Image source={{ uri: targetImage }} resizeMode="contain" style={styles.targetImage} />
                  ) : (
                    <View style={[styles.targetImage, styles.targetPlaceholder]}>
                      <DecorativeIonicon name="image-outline" size={22} color={colors.muted} />
                    </View>
                  )}
                  <View style={styles.targetCopy}>
                    <Text style={styles.targetCaption}>오픈 대상</Text>
                    <Text style={styles.targetIp}>{snapshot.ip?.nameKo ?? "등록 작품"}</Text>
                    <Text numberOfLines={2} style={styles.targetName}>
                      {productSubjectTitle(snapshot.product.name, snapshot.ip?.nameKo)}
                    </Text>
                  </View>
                </View>
              ) : null}

              {committedResultPresented && sourceCategory !== "gacha" ? (
                <SeedInlineGuidance>
                  서버에서 확정된 상품이 보관함에 등록됐어요.
                </SeedInlineGuidance>
              ) : null}
            </ScrollView>
          )}

          {(sourceCategory !== "gacha" || gachaResultFooterVisible) && !committedBatchSummaryVisible ? (
            <FloatingBottomActionPanel>
              <SeedActionButton
                label={actionLabel}
                loading={opening}
                disabled={opening || drawRevealInProgress}
                onPress={handleAction}
                style={styles.footerAction}
              />
            </FloatingBottomActionPanel>
          ) : null}
        </>
      )}
    </SafeAreaView>
  );
}

function CommittedResult({
  result,
  imageUri,
  ipName,
  reduceMotion,
}: {
  result: DrawResult;
  imageUri: string | null;
  ipName: string;
  reduceMotion: boolean;
}) {
  return (
    <SmoothResultReveal reduceMotion={reduceMotion} style={styles.committedResult}>
      <ResultAura reduceMotion={reduceMotion}>
        <View style={styles.rarityBadge}><Text variant="subtitle" numberOfLines={1} style={styles.rarityText}>{result.rarity}</Text></View>
      </ResultAura>
      {imageUri ? (
        <SmoothResultImage uri={imageUri} reduceMotion={reduceMotion} />
      ) : (
        <View style={[styles.resultImage, styles.resultPlaceholder]}>
          <DecorativeIonicon name="gift-outline" size={68} color={colors.brand} />
        </View>
      )}
      <Text style={styles.resultIp}>{ipName}</Text>
      <Text style={styles.resultName}>{productSubjectTitle(result.prizeName, ipName)}</Text>
      <Text style={styles.resultMeta}>{categoryLabel(result.prizeCategory)}</Text>
    </SmoothResultReveal>
  );
}

function CommittedBatchSummary({
  results,
  total,
  tickets,
  sourceCategory,
  assetBaseUrl,
  errorMessage,
  loading,
  reduceMotion,
  onAction,
}: {
  results: DrawResult[];
  total: number;
  tickets: string[];
  sourceCategory: ProductDetailSnapshot["product"]["category"] | undefined;
  assetBaseUrl: string | null;
  errorMessage: string;
  loading: boolean;
  reduceMotion: boolean;
  onAction: () => void;
}) {
  const remaining = Math.max(0, total - results.length);
  const complete = results.length === total && !errorMessage;
  return (
    <SmoothResultReveal reduceMotion={reduceMotion} style={styles.committedBatchSummary}>
      <View style={styles.committedBatchHeader}>
        <KoreanPixelTitle variant="compact" style={styles.committedBatchTitle}>확정 결과</KoreanPixelTitle>
        <KoreanPixelTitleAccessory style={styles.committedBatchCount}>
          {results.length} / {total}
        </KoreanPixelTitleAccessory>
      </View>
      {errorMessage ? (
        <SeedInlineGuidance style={styles.committedBatchError}>{errorMessage}</SeedInlineGuidance>
      ) : null}
      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        initialNumToRender={Math.min(results.length, 8)}
        showsVerticalScrollIndicator={false}
        style={styles.committedBatchList}
        contentContainerStyle={styles.committedBatchListContent}
        renderItem={({ item, index }) => {
          const imageUri = resolveCatalogImageUrl(item.prizeImageUrl, assetBaseUrl);
          const ticket = sourceCategory === "kuji" ? tickets[index] : undefined;
          return (
            <View
              accessible
              accessibilityLabel={`${ticket ? `${ticket}번 쿠지, ` : ""}${item.rarity}, ${item.prizeName}`}
              style={styles.committedBatchItem}
            >
              {imageUri ? (
                <Image source={{ uri: imageUri }} resizeMode="contain" style={styles.committedBatchImage} />
              ) : (
                <View style={[styles.committedBatchImage, styles.committedBatchPlaceholder]}>
                  <DecorativeIonicon name="gift-outline" size={28} color={colors.brand} />
                </View>
              )}
              <View style={styles.committedBatchCopy}>
                <View style={styles.committedBatchMetaRow}>
                  <Text style={styles.committedBatchRarity}>{item.rarity}</Text>
                  {ticket ? <Text style={styles.committedBatchTicket}>KUJI {ticket}</Text> : null}
                </View>
                <Text numberOfLines={2} style={styles.committedBatchName}>{item.prizeName}</Text>
                <Text style={styles.committedBatchMeta}>{categoryLabel(item.prizeCategory)}</Text>
              </View>
            </View>
          );
        }}
      />
      <SeedActionButton
        label={complete ? "상품으로 돌아가기" : `남은 ${remaining}개 다시 확인`}
        loading={loading}
        disabled={loading}
        onPress={onAction}
        style={styles.committedBatchAction}
      />
    </SmoothResultReveal>
  );
}

function StageAmbient({
  sourceCategory,
  reduceMotion,
  seed,
}: {
  sourceCategory: ProductDetailSnapshot["product"]["category"] | undefined;
  reduceMotion: boolean;
  seed: string;
}) {
  if (sourceCategory === "kuji" || sourceCategory === "gacha") {
    return <DrawEmbers seed={seed} reduceMotion={reduceMotion} />;
  }
  return (
    <View pointerEvents="none" style={styles.staticSparkField}>
      <View style={[styles.spark, styles.sparkOne]} />
      <View style={[styles.spark, styles.sparkTwo]} />
      <View style={[styles.spark, styles.sparkThree]} />
    </View>
  );
}

function DrawEmbers({ seed, reduceMotion }: {
  seed: string;
  reduceMotion: boolean;
}) {
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  // Both draw types use the same dispersed field, sized to their own stage.
  const particles = useMemo(() => createGachaFireflyConfigs(seed, stageSize), [seed, stageSize]);
  if (reduceMotion) return null;

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.drawEmberField}
      onLayout={({ nativeEvent }) => {
        const { width, height } = nativeEvent.layout;
        setStageSize((current) => current.width === width && current.height === height ? current : { width, height });
      }}
    >
      {particles.length > 0 && <DrawEmberLoop key={seed} particles={particles} />}
    </View>
  );
}

function useEmberPhase(durationMs: number) {
  const phase = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(phase);
    phase.value = 0;
    phase.value = withRepeat(
      withTiming(1, {
        duration: durationMs,
        easing: Easing.linear,
      }),
      -1,
      false,
    );
    return () => cancelAnimation(phase);
  }, [durationMs, phase]);

  return phase;
}

function DrawEmberLoop({ particles }: { particles: KujiFireflyConfig[] }) {
  const phase = useEmberPhase(GACHA_FIREFLY_DURATION_MS);
  return <>{particles.map((particle) => <DrawEmber key={particle.id} particle={particle} phase={phase} dispersed />)}</>;
}

function DrawEmber({ particle, phase, dispersed = false }: {
  particle: KujiFireflyConfig;
  phase: SharedValue<number>;
  dispersed?: boolean;
}) {

  const fireflyStyle = useAnimatedStyle(() => {
    const localProgress = (phase.value + particle.startOffset) % 1;
    const frame = sampleKujiFireflyMotion(particle, localProgress);
    return {
      opacity: frame.opacity,
      transform: [
        { translateX: frame.translateX },
        { translateY: frame.translateY },
        { rotate: `${frame.rotateDeg}deg` },
        { scale: frame.scale },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        styles.drawEmber,
        dispersed && styles.dispersedGachaEmber,
        {
          left: `${particle.leftPercent}%`,
          top: `${particle.startTopPercent}%`,
          width: particle.size,
          height: particle.size,
        },
        fireflyStyle,
      ]}
    />
  );
}

function SealedDraw() {
  return (
    <View style={styles.sealedBlock}>
      <View style={styles.unknownDraw}>
        <DecorativeIonicon name="gift-outline" size={68} color={colors.brand} />
      </View>
      <KoreanPixelTitle variant="header" style={styles.sealedCode}>DRAW</KoreanPixelTitle>
      <Text style={styles.sealedLabel}>상품을 열어 주세요</Text>
    </View>
  );
}

const RESULT_AURA_PARTICLES = [
  { x: -92, y: -52, size: 7, rotate: -34 },
  { x: -76, y: 66, size: 5, rotate: 24 },
  { x: -28, y: -98, size: 4, rotate: -18 },
  { x: 36, y: -94, size: 6, rotate: 28 },
  { x: 94, y: -44, size: 5, rotate: 42 },
  { x: 98, y: 48, size: 7, rotate: 18 },
  { x: 42, y: 96, size: 5, rotate: -22 },
  { x: -38, y: 94, size: 6, rotate: 36 },
] as const;

function SmoothResultReveal({
  children,
  reduceMotion,
  style,
}: {
  children: ReactNode;
  reduceMotion: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const progress = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    cancelAnimation(progress);
    if (reduceMotion) {
      progress.value = 1;
      return;
    }
    progress.value = 0;
    progress.value = withTiming(1, {
      duration: DRAW_MOTION.resultEnterMs,
      easing: smoothRevealEasing,
    });
    return () => cancelAnimation(progress);
  }, [progress, reduceMotion]);

  const revealStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.18, 1], [0.24, 1, 1], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [8, 0], Extrapolation.CLAMP) },
      { scale: interpolate(progress.value, [0, 1], [0.96, 1], Extrapolation.CLAMP) },
    ],
  }));

  return <Animated.View style={[style, revealStyle]}>{children}</Animated.View>;
}

function SmoothResultImage({ uri, reduceMotion }: { uri: string; reduceMotion: boolean }) {
  const progress = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    cancelAnimation(progress);
    progress.value = reduceMotion ? 1 : 0;
    return () => cancelAnimation(progress);
  }, [progress, reduceMotion, uri]);

  const revealImage = useCallback(() => {
    if (reduceMotion) {
      progress.value = 1;
      return;
    }
    progress.value = withTiming(1, {
      duration: DRAW_MOTION.resultImageFadeMs,
      easing: smoothRevealEasing,
    });
  }, [progress, reduceMotion]);

  const imageStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.985, 1], Extrapolation.CLAMP) }],
  }));

  return (
    <Animated.Image
      source={{ uri }}
      resizeMode="contain"
      onLoad={revealImage}
      onError={revealImage}
      style={[styles.resultImage, imageStyle]}
    />
  );
}

function ResultAura({ children, reduceMotion }: { children: ReactNode; reduceMotion: boolean }) {
  const progress = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    cancelAnimation(progress);
    if (reduceMotion) {
      progress.value = 1;
      return;
    }
    progress.value = 0;
    progress.value = withTiming(1, {
      duration: DRAW_MOTION.resultAuraMs,
      easing: smoothRevealEasing,
    });
    return () => cancelAnimation(progress);
  }, [progress, reduceMotion]);

  const contentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.14, 1], [0, 1, 1], Extrapolation.CLAMP),
    transform: [{
      scale: interpolate(progress.value, [0, 0.4, 0.72, 1], [0.9, 1.025, 0.995, 1], Extrapolation.CLAMP),
    }],
  }));
  const innerRingStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.14, 0.62, 1], [0, 0.95, 0.32, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.54, 1.18]) }],
  }));
  const outerRingStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.08, 0.24, 0.72, 1], [0, 0.78, 0.22, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.42, 1.5]) }],
  }));
  const flashStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.08, 0.28, 1], [0, 0.75, 0.16, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(progress.value, [0, 0.42], [0.45, 1.22], Extrapolation.CLAMP) }],
  }));

  return (
    <View style={styles.resultAuraWrap}>
      {!reduceMotion ? (
        <>
          <Animated.View pointerEvents="none" style={[styles.resultAuraFlash, flashStyle]} />
          <Animated.View pointerEvents="none" style={[styles.resultAura, innerRingStyle]} />
          <Animated.View pointerEvents="none" style={[styles.resultAuraOuter, outerRingStyle]} />
          {RESULT_AURA_PARTICLES.map((particle, index) => (
            <ResultAuraParticle
              key={`${particle.x}-${particle.y}`}
              index={index}
              progress={progress}
            />
          ))}
        </>
      ) : null}
      <Animated.View style={contentStyle}>{children}</Animated.View>
    </View>
  );
}

function ResultAuraParticle({ index, progress }: { index: number; progress: SharedValue<number> }) {
  const particle = RESULT_AURA_PARTICLES[index]!;
  const animatedStyle = useAnimatedStyle(() => ({
    width: particle.size,
    height: particle.size,
    opacity: interpolate(progress.value, [0, 0.12, 0.5, 1], [0, 1, 0.72, 0], Extrapolation.CLAMP),
    transform: [
      { translateX: progress.value * particle.x },
      { translateY: progress.value * particle.y },
      { rotate: `${progress.value * particle.rotate}deg` },
      { scale: interpolate(progress.value, [0, 0.2, 1], [0.25, 1, 0.55], Extrapolation.CLAMP) },
    ],
  }));
  return <Animated.View pointerEvents="none" style={[styles.resultAuraParticle, animatedStyle]} />;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function drawCategoryFromParam(
  value: string | undefined,
): "gacha" | "kuji" | undefined {
  return value === "gacha" || value === "kuji" ? value : undefined;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.ink },
  header: { minHeight: seed.size.topNavigation, paddingHorizontal: seed.spacing.x3, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.inverted.stroke, backgroundColor: colors.ink },
  headerAction: { width: 78, minHeight: seed.size.touchTarget, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: colors.white },
  skipText: { color: colors.brand, ...seed.typography.label, fontWeight: "800" },
  soundToggle: { position: "absolute", zIndex: 30, top: seed.spacing.x2, right: seed.spacing.x2, width: seed.size.touchTarget, height: seed.size.touchTarget, borderRadius: seed.radius.full, borderWidth: StyleSheet.hairlineWidth, borderColor: seed.color.inverted.strokeStrong, backgroundColor: seed.color.inverted.surfaceRaised, alignItems: "center", justifyContent: "center" },
  soundToggleDisabled: { opacity: 0.48 },
  pressed: { opacity: seed.state.pressedOpacity },
  state: { flex: 1, paddingHorizontal: seed.spacing.globalGutter, alignItems: "center", justifyContent: "center", gap: seed.spacing.componentDefault },
  stateText: { maxWidth: 330, color: seed.color.inverted.foregroundMuted, ...seed.typography.body, textAlign: "center" },
  stateAction: { width: "100%", marginTop: seed.spacing.x2 },
  loginRequiredTitle: { color: seed.color.inverted.foreground, textAlign: "center" },
  content: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x4, paddingBottom: seed.spacing.x7, gap: seed.spacing.componentDefault },
  drawScroll: { flex: 1 },
  gachaContent: { flexGrow: 1 },
  gachaInteractionHint: { alignSelf: "center", color: seed.color.inverted.foregroundMuted, textAlign: "center" },
  summaryContent: { flex: 1, paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x4, gap: seed.spacing.componentDefault },
  stageHeader: { minHeight: 54, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x3 },
  stageEyebrow: { marginBottom: seed.spacing.x1, color: colors.brand, fontSize: 11, lineHeight: 16, fontWeight: "900", letterSpacing: 0.8 },
  stageTitle: { color: colors.white },
  stage: { minHeight: 430, padding: seed.spacing.x4, borderRadius: seed.radius.r5, borderWidth: 1, borderColor: seed.color.inverted.stroke, backgroundColor: seed.color.inverted.surface, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  expandedDrawStage: { minHeight: 496 },
  fullGachaStage: { flexGrow: 1 },
  lightGachaStage: { backgroundColor: seed.color.layer.default, borderColor: seed.color.layer.default },
  summaryStage: { flex: 1, minHeight: 0, padding: seed.spacing.x2_5 },
  staticSparkField: { ...StyleSheet.absoluteFill },
  spark: { position: "absolute", width: 7, height: 7, backgroundColor: colors.brand },
  sparkOne: { top: 42, left: 32 },
  sparkTwo: { top: 78, right: 38, width: 4, height: 4 },
  sparkThree: { bottom: 48, right: 58, width: 5, height: 5 },
  drawEmberField: { ...StyleSheet.absoluteFill },
  drawEmber: { position: "absolute", borderRadius: 1.5, backgroundColor: colors.brand, shadowColor: colors.brand, shadowOpacity: 0.58, shadowRadius: 5, shadowOffset: { width: 0, height: 0 } },
  dispersedGachaEmber: { shadowOpacity: 0.36, shadowRadius: 3.5 },
  sealedBlock: { alignItems: "center" },
  unknownDraw: { width: 156, height: 156, borderRadius: seed.radius.full, borderWidth: 2, borderColor: seed.color.inverted.strokeStrong, alignItems: "center", justifyContent: "center", backgroundColor: seed.color.inverted.surfaceRaised },
  sealedCode: { marginTop: seed.spacing.x5, color: colors.brand },
  sealedLabel: { marginTop: seed.spacing.x1_5, color: seed.color.inverted.foregroundMuted, ...seed.typography.bodyStrong },
  resultAuraWrap: { alignItems: "center", justifyContent: "center" },
  resultAuraFlash: { position: "absolute", width: 164, height: 164, borderRadius: seed.radius.full, backgroundColor: seed.color.kuji.weakStrong },
  resultAura: { position: "absolute", width: 174, height: 174, borderRadius: seed.radius.full, borderWidth: 2, borderColor: seed.color.kuji.stroke, backgroundColor: seed.color.background.transparent, shadowColor: seed.color.kuji.solid, shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 0 } },
  resultAuraOuter: { position: "absolute", width: 194, height: 194, borderRadius: seed.radius.full, borderWidth: 1, borderColor: colors.brand },
  resultAuraParticle: { position: "absolute", left: "50%", top: "50%", marginLeft: -3, marginTop: -3, borderRadius: 2, backgroundColor: colors.brand },
  committedBatchSummary: { flex: 1, width: "100%", minHeight: 0, gap: seed.spacing.x2 },
  committedBatchHeader: { minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x2 },
  committedBatchTitle: { color: colors.white },
  committedBatchCount: { color: colors.brand, fontVariant: ["tabular-nums"] },
  committedBatchError: { color: seed.color.inverted.foregroundMuted },
  committedBatchList: { flex: 1 },
  committedBatchListContent: { gap: seed.spacing.x2, paddingBottom: seed.spacing.x1 },
  committedBatchItem: { minHeight: 92, padding: seed.spacing.x2, borderRadius: seed.radius.r3, borderWidth: 1, borderColor: seed.color.inverted.stroke, backgroundColor: seed.color.inverted.surfaceRaised, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2 },
  committedBatchImage: { width: 72, height: 72, borderRadius: seed.radius.r2, backgroundColor: seed.color.layer.basement },
  committedBatchPlaceholder: { alignItems: "center", justifyContent: "center", backgroundColor: seed.color.inverted.surfaceSubtle },
  committedBatchCopy: { flex: 1, minWidth: 0 },
  committedBatchMetaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x2 },
  committedBatchRarity: { color: colors.brand, ...seed.typography.caption, fontWeight: "900" },
  committedBatchTicket: { color: seed.color.inverted.foregroundMuted, ...seed.typography.caption, fontWeight: "800", fontVariant: ["tabular-nums"] },
  committedBatchName: { marginTop: seed.spacing.x0_5, color: colors.white, ...seed.typography.bodyStrong },
  committedBatchMeta: { marginTop: seed.spacing.x0_5, color: seed.color.inverted.foregroundSubtle, ...seed.typography.caption },
  committedBatchAction: { width: "100%", marginTop: seed.spacing.x1 },
  committedResult: { width: "100%", alignItems: "center" },
  rarityBadge: { minWidth: 64, height: 38, paddingHorizontal: seed.spacing.x3, borderRadius: seed.radius.r2_5, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  rarityText: { color: colors.ink },
  resultImage: { width: "100%", height: 232, marginTop: seed.spacing.x4 },
  resultPlaceholder: { alignItems: "center", justifyContent: "center", borderRadius: seed.radius.r4, backgroundColor: seed.color.inverted.surfaceRaised },
  resultIp: { marginTop: seed.spacing.x3, color: seed.color.inverted.foregroundSubtle, ...seed.typography.caption },
  resultName: { marginTop: seed.spacing.x1, color: colors.white, ...seed.typography.sectionTitle, textAlign: "center" },
  resultMeta: { marginTop: seed.spacing.x2, color: colors.brand, ...seed.typography.label, fontWeight: "800" },
  targetRow: { minHeight: 92, padding: seed.spacing.x3, borderRadius: seed.radius.r4, backgroundColor: seed.color.layer.basement, flexDirection: "row", alignItems: "center", gap: seed.spacing.componentDefault },
  targetImage: { width: 68, height: 68, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.neutralWeak },
  targetPlaceholder: { alignItems: "center", justifyContent: "center" },
  targetCopy: { flex: 1, minWidth: 0 },
  targetCaption: { color: colors.greenInk, ...seed.typography.caption, fontWeight: "800" },
  targetIp: { marginTop: seed.spacing.x0_5, color: colors.muted, ...seed.typography.caption },
  targetName: { marginTop: seed.spacing.x0_5, color: colors.ink, ...seed.typography.bodyStrong },
  footerAction: { width: "100%" },
});
