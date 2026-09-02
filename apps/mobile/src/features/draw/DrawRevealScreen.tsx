import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
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
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  FloatingBottomActionPanel,
  useFloatingBottomActionContentInset,
} from "@/components/FloatingBottomActionPanel";
import { KoreanPixelTitle, KoreanPixelTitleAccessory } from "@/components/RootCategoryTitle";
import { AppText as Text, BalancedAppText } from "@/components/Typography";
import { SeedActionButton, SeedInlineGuidance } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import {
  consumeDrawEntitlement,
  type DrawResult,
} from "@/features/draw/draw-reveal-api";
import { GachaLeverMachine } from "@/features/draw/GachaLeverMachine";
import { KujiPeelTicket } from "@/features/draw/KujiPeelTicket";
import {
  DRAW_MOTION,
  advancePreviewRevealState,
  buildPreviewOpenActions,
  completePreviewRevealState,
  createPreviewResultItems,
  createPreviewRevealState,
  currentPreviewTicketIndex,
  resolvePreviewNextTicketAction,
  startPreviewOpenAll,
  type PreviewResultItem,
} from "@/features/draw/draw-reveal-state";
import {
  createKujiFireflyConfigs,
  sampleKujiFireflyMotion,
  type KujiFireflyConfig,
} from "@/features/draw/kuji-firefly-motion";
import { parseKujiTicketNumbers } from "@/features/kuji/kuji-selection-state";
import {
  categoryLabel,
  fetchProductDetail,
  isDrawCategory as isProductDrawCategory,
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

type RevealMode = "single" | "all";
const smoothRevealEasing = Easing.bezier(0.16, 0.82, 0.28, 1);

export function DrawRevealScreen({ preview = false }: { preview?: boolean }) {
  const router = useRouter();
  const floatingBottomInset = useFloatingBottomActionContentInset();
  const params = useLocalSearchParams<{
    entitlementId?: string | string[];
    productId?: string | string[];
    category?: string | string[];
    mode?: string | string[];
    count?: string | string[];
    tickets?: string | string[];
    stage?: string | string[];
  }>();
  const entitlementId = firstParam(params.entitlementId) ?? "";
  const productId = firstParam(params.productId) ?? "";
  const categoryHint = drawCategoryFromParam(firstParam(params.category));
  const requestedMode: RevealMode = preview && firstParam(params.mode) === "all" ? "all" : "single";
  const previewTickets = preview ? parseKujiTicketNumbers(firstParam(params.tickets)) : [];
  const count = preview
    ? previewTickets.length || boundedCount(firstParam(params.count))
    : 1;
  const mode: RevealMode = count === 1 ? "single" : requestedMode;
  const previewStartsAtSummary = preview
    && __DEV__
    && firstParam(params.stage) === "summary";
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
  const [previewLoading, setPreviewLoading] = useState(preview);
  const [previewState, setPreviewState] = useState(() => initialPreviewRevealState(
    mode,
    count,
    previewStartsAtSummary,
  ));
  const [opening, setOpening] = useState(false);
  const [result, setResult] = useState<DrawResult | null>(null);
  const [previewResultReady, setPreviewResultReady] = useState(false);
  const [revealSettled, setRevealSettled] = useState(false);
  const [revealRequestSignal, setRevealRequestSignal] = useState(0);
  const [revealResetSignal, setRevealResetSignal] = useState(0);
  const [queuedPreviewOpen, setQueuedPreviewOpen] = useState<"all" | null>(null);
  const [message, setMessage] = useState("");
  const [reduceMotion, setReduceMotion] = useState(false);
  const requestInFlightRef = useRef(false);
  const lastAnnouncementRef = useRef("");
  const sourceCategory = snapshot?.product.category ?? categoryHint;
  const sourceProductId = result?.productId ?? snapshot?.product.id ?? productId;

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => subscription.remove();
  }, []);

  const loadPreview = useCallback(async () => {
    if (!preview) return;
    if (!__DEV__) {
      setMessage("임시 오픈 화면은 개발 앱에서만 확인할 수 있어요.");
      setPreviewLoading(false);
      return;
    }
    if (!productId) {
      setMessage("오픈할 상품을 찾을 수 없습니다.");
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    try {
      const tokens = await readAuthTokens();
      const next = await fetchProductDetail(runtime.apiBaseUrl, productId, tokens?.accessToken);
      if (!isProductDrawCategory(next.product.category)) {
        throw new Error("가챠와 쿠지 상품만 오픈 화면을 사용할 수 있어요.");
      }
      setSnapshot(next);
      setMessage("");
    } catch (error) {
      setSnapshot(null);
      setMessage(error instanceof Error ? error.message : "오픈 화면을 준비하지 못했습니다.");
    } finally {
      setPreviewLoading(false);
    }
  }, [preview, productId, runtime.apiBaseUrl]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  useEffect(() => {
    if (!preview) return;
    setPreviewState(initialPreviewRevealState(mode, count, previewStartsAtSummary));
    setPreviewResultReady(false);
    setRevealSettled(false);
    setRevealResetSignal((current) => current + 1);
    setQueuedPreviewOpen(null);
    requestInFlightRef.current = false;
    lastAnnouncementRef.current = "";
  }, [count, mode, preview, previewStartsAtSummary]);

  useEffect(() => {
    if (!preview || !queuedPreviewOpen || previewState.phase !== "sealed") return;
    setQueuedPreviewOpen(null);
    setRevealRequestSignal((current) => current + 1);
  }, [
    preview,
    previewState.mode,
    previewState.openedCount,
    previewState.phase,
    queuedPreviewOpen,
  ]);

  useEffect(() => {
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
    if (!preview) return;
    if (previewState.phase === "revealed") {
      const index = currentPreviewTicketIndex(previewState);
      const ticketNumber = previewTickets[index] ?? String(index + 1).padStart(2, "0");
      const announcementKey = `preview:${previewState.openedCount}:revealed`;
      if (lastAnnouncementRef.current === announcementKey) return;
      lastAnnouncementRef.current = announcementKey;
      AccessibilityInfo.announceForAccessibility(
        sourceCategory === "kuji"
          ? `${ticketNumber}번 쿠지 결과가 열렸어요.`
          : `가챠 ${previewState.openedCount}번째 결과가 열렸어요.`,
      );
    } else if (previewState.phase === "summary") {
      const announcementKey = `preview:${count}:summary`;
      if (lastAnnouncementRef.current === announcementKey) return;
      lastAnnouncementRef.current = announcementKey;
      AccessibilityInfo.announceForAccessibility(`${count}개 오픈 결과를 표시했어요.`);
    }
  }, [
    count,
    preview,
    previewState,
    previewTickets.join(","),
    result,
    revealSettled,
    snapshot?.ip?.nameKo,
    sourceCategory,
  ]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/ppoba");
  };

  const returnToSourceProduct = () => {
    if (!sourceProductId) {
      router.replace("/(tabs)/ppoba");
      return;
    }
    router.dismissTo(`/product/${encodeURIComponent(sourceProductId)}` as Href);
  };

  const openProduct = async () => {
    if (preview) {
      if (!__DEV__ || previewState.phase === "summary") return;
      if (previewState.phase === "revealed") {
        setPreviewResultReady(false);
        requestInFlightRef.current = false;
        setPreviewState((current) => advancePreviewRevealState(current));
        return;
      }
      if (requestInFlightRef.current) return;
      if (sourceCategory === "kuji" || sourceCategory === "gacha") {
        requestInFlightRef.current = true;
        setPreviewResultReady(true);
        return;
      }
      setPreviewState((current) => advancePreviewRevealState(current));
      return;
    }
    if (requestInFlightRef.current || result) return;
    if (!entitlementId) {
      setMessage("사용할 수 있는 추첨권을 찾을 수 없습니다.");
      return;
    }

    requestInFlightRef.current = true;
    setOpening(true);
    setRevealSettled(false);
    setMessage("");
    try {
      const tokens = await readAuthTokens();
      if (!tokens?.accessToken) throw new Error("로그인 후 상품을 열어 주세요.");
      const committed = await consumeDrawEntitlement(
        runtime.apiBaseUrl,
        tokens.accessToken,
        entitlementId,
      );
      const committedImageUri = resolveCatalogImageUrl(
        committed.prizeImageUrl,
        runtime.assetBaseUrl,
      );
      if (committedImageUri) {
        void Image.prefetch(committedImageUri).catch(() => undefined);
      }
      let committedSnapshot: ProductDetailSnapshot | null = null;
      try {
        committedSnapshot = await fetchProductDetail(
          runtime.apiBaseUrl,
          committed.productId,
          tokens.accessToken,
        );
      } catch {
        committedSnapshot = null;
      }
      setSnapshot(committedSnapshot);
      setResult(committed);
      const committedCategory = committedSnapshot?.product.category ?? categoryHint;
      if (committedCategory !== "kuji" && committedCategory !== "gacha") {
        requestInFlightRef.current = false;
        setRevealSettled(true);
      }
    } catch (error) {
      requestInFlightRef.current = false;
      setResult(null);
      setRevealSettled(false);
      setRevealResetSignal((current) => current + 1);
      setMessage(error instanceof Error ? error.message : "상품 결과를 확인하지 못했습니다.");
    } finally {
      setOpening(false);
    }
  };

  const handleRevealSettled = () => {
    requestInFlightRef.current = false;
    if (preview) {
      setPreviewResultReady(false);
      setPreviewState((current) => (
        current.mode === "all"
          ? completePreviewRevealState(current)
          : current.phase === "sealed"
            ? advancePreviewRevealState(current)
            : current
      ));
      return;
    }
    if (result) setRevealSettled(true);
  };

  const sourceLabel = sourceCategory === "kuji" ? "쿠지" : sourceCategory === "gacha" ? "가챠" : "상품";
  const screenTitle = `${sourceLabel} 오픈`;
  const previewOpened = previewState.phase === "revealed";
  const previewCompleted = previewState.phase === "summary";
  const singlePreviewFinished = preview && count === 1 && previewOpened;
  const committedResultPresented = Boolean(result && revealSettled);
  const drawSequenceFinished = committedResultPresented || previewCompleted || singlePreviewFinished;
  const kujiMotionVisible = sourceCategory === "kuji"
    && !previewOpened
    && !previewCompleted
    && !committedResultPresented;
  const kujiRevealInProgress = sourceCategory === "kuji"
    && !committedResultPresented
    && Boolean(opening || previewResultReady || result || queuedPreviewOpen);
  const gachaMotionVisible = sourceCategory === "gacha"
    && !previewOpened
    && !previewCompleted
    && !committedResultPresented;
  const gachaRevealInProgress = sourceCategory === "gacha"
    && !committedResultPresented
    && Boolean(opening || previewResultReady || result);
  const drawRevealInProgress = kujiRevealInProgress || gachaRevealInProgress;
  const completed = committedResultPresented || previewOpened || previewCompleted;
  const isDrawCategory = sourceCategory === "kuji" || sourceCategory === "gacha";
  const showStageHeader = !isDrawCategory;
  const activeMode: RevealMode = preview ? previewState.mode : mode;
  const remainingPreviewCount = Math.max(0, count - previewState.openedCount);
  const previewOpenActions = buildPreviewOpenActions(previewState);
  const showSplitOpenActions = Boolean(
    preview
      && sourceCategory === "kuji"
      && !drawSequenceFinished
      && previewState.mode === "single"
      && previewOpenActions.openAllLabel,
  );
  const stageHeading = previewCompleted
    ? count === 1 ? "상품 오픈" : `${count}개 오픈 결과`
    : activeMode === "all"
      ? `${remainingPreviewCount}개 한 번에 오픈`
    : preview && count > 1
      ? `${count}개 한 장씩 오픈`
      : "상품 오픈";
  const currentPreviewIndex = currentPreviewTicketIndex(previewState);
  const previewItems = useMemo(
    () => createPreviewResultItems(previewTickets, count),
    [count, previewTickets.join(",")],
  );
  const drawEmberSeed = `${sourceProductId || sourceCategory || "draw"}:${previewItems[currentPreviewIndex]?.ticketNumber ?? `${activeMode}-${count}`}`;
  const actionLabel = drawSequenceFinished
    ? "상품으로 돌아가기"
      : drawRevealInProgress
        ? "결과 확인 중"
      : activeMode === "all"
        ? `${remainingPreviewCount}개 한 번에 열기`
        : preview && sourceCategory === "kuji"
          ? previewState.phase === "revealed" && previewState.openedCount >= count
            ? "전체 결과 보기"
            : previewOpenActions.nextLabel
          : previewState.phase === "revealed"
            ? previewState.openedCount >= count
              ? "전체 결과 보기"
              : "다음 상품 준비"
          : sourceCategory === "kuji" && count > 1
            ? `${previewState.openedCount + 1}번째 쿠지 열기`
            : sourceCategory === "gacha"
              ? "레버 돌리기"
            : opening
              ? "상품 확인 중"
              : "상품 열기";
  const footerPanelStyle = showSplitOpenActions
    ? styles.footerSplitPanel
    : sourceCategory === "gacha"
      ? styles.footerGachaPanel
      : undefined;

  const handleOpenNextTicket = () => {
    const nextAction = resolvePreviewNextTicketAction(previewState);
    if (
      !preview
      || sourceCategory !== "kuji"
      || nextAction === "none"
      || kujiRevealInProgress
    ) return;

    setPreviewResultReady(false);
    requestInFlightRef.current = false;
    if (nextAction === "prepare") {
      setRevealResetSignal((current) => current + 1);
      setPreviewState((current) => (
        current.phase === "revealed"
          ? advancePreviewRevealState(current)
          : current
      ));
      return;
    }
    if (nextAction === "open") {
      setRevealRequestSignal((current) => current + 1);
    }
  };

  const handleOpenAllRemaining = () => {
    if (
      !preview
      || sourceCategory !== "kuji"
      || !previewOpenActions.openAllLabel
      || kujiRevealInProgress
    ) return;

    setPreviewResultReady(false);
    requestInFlightRef.current = false;
    setRevealResetSignal((current) => current + 1);
    setPreviewState((current) => startPreviewOpenAll(current));
    setQueuedPreviewOpen("all");
  };

  const handleAction = () => {
    if (drawSequenceFinished) {
      returnToSourceProduct();
      return;
    }
    if (
      preview
      && sourceCategory === "kuji"
      && previewState.mode === "single"
      && previewState.openedCount < count
    ) {
      handleOpenNextTicket();
      return;
    }
    if (kujiMotionVisible && !kujiRevealInProgress) {
      setRevealRequestSignal((current) => current + 1);
      return;
    }
    if (gachaMotionVisible && !gachaRevealInProgress) {
      setRevealRequestSignal((current) => current + 1);
      return;
    }
    void openProduct();
  };

  const targetImage = snapshot
    ? resolveCatalogImageUrl(snapshot.product.imageUrl, runtime.assetBaseUrl, snapshot.product.version)
    : null;

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <StatusBar style="light" backgroundColor={colors.ink} />
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="이전 화면으로 돌아가기"
          hitSlop={10}
          onPress={drawSequenceFinished ? returnToSourceProduct : goBack}
          style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={28} color={colors.white} />
        </Pressable>
        <KoreanPixelTitle variant="header" style={styles.headerTitle}>{screenTitle}</KoreanPixelTitle>
        <View style={styles.headerAction} />
      </View>

      {previewLoading ? (
        <View style={styles.state}>
          <ActivityIndicator color={colors.brand} />
          <Text style={styles.stateText}>오픈 화면을 준비하는 중</Text>
        </View>
      ) : message && !result ? (
        <View style={styles.state}>
          <Ionicons name="alert-circle-outline" size={38} color={colors.brand} />
          <BalancedAppText style={styles.stateText}>{message}</BalancedAppText>
          <SeedActionButton
            label={preview ? "다시 불러오기" : "다시 시도"}
            onPress={preview ? () => void loadPreview() : () => void openProduct()}
            style={styles.stateAction}
          />
        </View>
      ) : (
        <>
          {previewCompleted ? (
            <View style={[styles.summaryContent, { paddingBottom: floatingBottomInset }]}>
              <View style={styles.stageHeader}>
                <View>
                  <Text style={styles.stageEyebrow}>OPENED</Text>
                  <KoreanPixelTitle variant="section" style={styles.stageTitle}>{stageHeading}</KoreanPixelTitle>
                </View>
              </View>
              <View style={[styles.stage, styles.summaryStage]}>
                <StageAmbient
                  sourceCategory={sourceCategory}
                  reduceMotion={reduceMotion}
                  seed={`${drawEmberSeed}:summary`}
                />
                <PreviewResultSummary
                  items={previewItems}
                  sourceCategory={sourceCategory}
                  reduceMotion={reduceMotion}
                />
              </View>
            </View>
          ) : (
            <ScrollView contentContainerStyle={[styles.content, { paddingBottom: floatingBottomInset }]}>
              {showStageHeader ? (
                <View style={styles.stageHeader}>
                  <View>
                    <Text style={styles.stageEyebrow}>{completed ? "OPENED" : "READY"}</Text>
                    <KoreanPixelTitle variant="section" style={styles.stageTitle}>{stageHeading}</KoreanPixelTitle>
                  </View>
                </View>
              ) : null}

              <View style={[styles.stage, isDrawCategory && styles.expandedDrawStage]}>
                <StageAmbient
                  sourceCategory={sourceCategory}
                  reduceMotion={reduceMotion}
                  seed={drawEmberSeed}
                />
                {kujiMotionVisible ? (
                  <KujiPeelTicket
                    key={preview
                      ? previewItems[currentPreviewIndex]?.ticketNumber ?? `all-${count}`
                      : entitlementId || productId}
                    ticketNumber={preview && activeMode === "single"
                      ? previewItems[currentPreviewIndex]?.ticketNumber
                      : undefined}
                    total={preview && activeMode === "all" ? remainingPreviewCount : undefined}
                    disabled={opening}
                    reduceMotion={reduceMotion}
                    resultReady={preview ? previewResultReady : Boolean(result)}
                    resultLabel={preview
                      ? `RESULT ${String(previewState.openedCount + 1).padStart(2, "0")}`
                      : result?.rarity ?? "RESULT"}
                    requestSignal={revealRequestSignal}
                    resetSignal={revealResetSignal}
                    onRequestOpen={() => void openProduct()}
                    onRevealSettled={handleRevealSettled}
                  />
                ) : gachaMotionVisible ? (
                  <GachaLeverMachine
                    key={entitlementId || productId}
                    disabled={opening}
                    reduceMotion={reduceMotion}
                    resultReady={preview ? previewResultReady : Boolean(result)}
                    requestSignal={revealRequestSignal}
                    resetSignal={revealResetSignal}
                    onRequestOpen={() => void openProduct()}
                    onRevealSettled={handleRevealSettled}
                  />
                ) : result ? (
                  <CommittedResult
                    result={result}
                    imageUri={resolveCatalogImageUrl(result.prizeImageUrl, runtime.assetBaseUrl)}
                    ipName={snapshot?.ip?.nameKo ?? "등록 작품"}
                    reduceMotion={reduceMotion}
                  />
                ) : (
                  <PreviewResultStage
                    opened={previewOpened}
                    openedIndex={previewState.openedCount}
                    total={count}
                    ticketNumber={previewItems[currentPreviewIndex]?.ticketNumber}
                    sourceCategory={sourceCategory}
                    reduceMotion={reduceMotion}
                  />
                )}
              </View>

              {snapshot ? (
                <View style={styles.targetRow}>
                  {targetImage ? (
                    <Image source={{ uri: targetImage }} resizeMode="contain" style={styles.targetImage} />
                  ) : (
                    <View style={[styles.targetImage, styles.targetPlaceholder]}>
                      <Ionicons name="image-outline" size={22} color={colors.muted} />
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

              {committedResultPresented ? (
                <SeedInlineGuidance>
                  서버에서 확정된 상품이 보관함에 등록됐어요.
                </SeedInlineGuidance>
              ) : null}
            </ScrollView>
          )}

          <FloatingBottomActionPanel
            panelStyle={footerPanelStyle}
          >
            {showSplitOpenActions && previewOpenActions.openAllLabel ? (
              <View style={styles.footerActions}>
                <SeedActionButton
                  label={previewOpenActions.nextLabel}
                  disabled={opening || kujiRevealInProgress}
                  onPress={handleOpenNextTicket}
                  style={styles.footerSplitAction}
                />
                <SeedActionButton
                  label={previewOpenActions.openAllLabel}
                  variant="neutralWeak"
                  disabled={opening || kujiRevealInProgress}
                  onPress={handleOpenAllRemaining}
                  style={[styles.footerSplitAction, styles.footerOpenAllAction]}
                />
              </View>
            ) : (
              <SeedActionButton
                label={actionLabel}
                loading={opening}
                  disabled={opening || drawRevealInProgress}
                  onPress={handleAction}
                style={styles.footerAction}
              />
            )}
          </FloatingBottomActionPanel>
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
        <View style={styles.rarityBadge}><Text style={styles.rarityText}>{result.rarity}</Text></View>
      </ResultAura>
      {imageUri ? (
        <SmoothResultImage uri={imageUri} reduceMotion={reduceMotion} />
      ) : (
        <View style={[styles.resultImage, styles.resultPlaceholder]}>
          <Ionicons name="gift-outline" size={68} color={colors.brand} />
        </View>
      )}
      <Text style={styles.resultIp}>{ipName}</Text>
      <Text style={styles.resultName}>{productSubjectTitle(result.prizeName, ipName)}</Text>
      <Text style={styles.resultMeta}>{categoryLabel(result.prizeCategory)} · {result.prizeSku}</Text>
    </SmoothResultReveal>
  );
}

function PreviewResultStage({
  opened,
  openedIndex,
  total,
  ticketNumber,
  sourceCategory,
  reduceMotion,
}: {
  opened: boolean;
  openedIndex: number;
  total: number;
  ticketNumber: string | undefined;
  sourceCategory: ProductDetailSnapshot["product"]["category"] | undefined;
  reduceMotion: boolean;
}) {
  if (opened) {
    return (
      <SmoothResultReveal reduceMotion={reduceMotion} style={styles.previewOpened}>
        <ResultAura reduceMotion={reduceMotion}>
          <View style={styles.previewResultIcon}><Ionicons name="gift-outline" size={64} color={colors.brand} /></View>
        </ResultAura>
        {sourceCategory === "kuji" && ticketNumber ? (
          <Text style={styles.previewTicketNumber}>KUJI {ticketNumber}</Text>
        ) : null}
        <Text style={styles.previewResultCode}>RESULT {String(openedIndex).padStart(2, "0")}</Text>
        {total > 1 ? <Text style={styles.previewProgress}>{openedIndex} / {total}</Text> : null}
      </SmoothResultReveal>
    );
  }
  if (sourceCategory === "gacha") return <SealedCapsule reduceMotion={reduceMotion} />;
  return <SealedDraw />;
}

function PreviewResultSummary({
  items,
  sourceCategory,
  reduceMotion,
}: {
  items: PreviewResultItem[];
  sourceCategory: ProductDetailSnapshot["product"]["category"] | undefined;
  reduceMotion: boolean;
}) {
  if (items.length === 1) {
    const [single] = items;
    if (!single) return null;
    return (
      <PreviewResultStage
        opened
        openedIndex={single.order}
        total={1}
        ticketNumber={single.ticketNumber}
        sourceCategory={sourceCategory}
        reduceMotion={reduceMotion}
      />
    );
  }
  const [featured, ...remaining] = items;
  if (!featured) return null;
  const isKuji = sourceCategory === "kuji";
  const sourceLabel = sourceCategory === "gacha" ? "가챠" : isKuji ? "쿠지" : "상품";
  return (
    <SmoothResultReveal reduceMotion={reduceMotion} style={styles.summaryLayout}>
      <View
        accessible
        accessibilityLabel={isKuji && featured.ticketNumber
          ? `대표 결과 영역, 쿠지 ${featured.ticketNumber}번, 결과 ${featured.order}번`
          : `대표 결과 영역, ${sourceLabel} 결과 ${featured.order}번`}
        style={styles.summaryFeatured}
      >
        <View style={styles.bestResultBadge}><Text style={styles.bestResultBadgeText}>대표 결과</Text></View>
        <ResultAura reduceMotion={reduceMotion}>
          <View style={styles.featuredResultIcon}><Ionicons name="gift-outline" size={54} color={colors.brand} /></View>
        </ResultAura>
        <Text style={styles.featuredResultCode}>RESULT {String(featured.order).padStart(2, "0")}</Text>
        {isKuji && featured.ticketNumber ? (
          <Text style={styles.featuredTicket}>KUJI {featured.ticketNumber}</Text>
        ) : null}
      </View>
      <View style={styles.summaryRail}>
        <View style={styles.summaryRailHeader}>
          <KoreanPixelTitle variant="compact" style={styles.summaryRailTitle}>나머지 결과</KoreanPixelTitle>
          <KoreanPixelTitleAccessory style={styles.summaryRailCount}>{remaining.length}</KoreanPixelTitleAccessory>
        </View>
        <FlatList
          data={remaining}
          initialNumToRender={8}
          keyExtractor={(item) => item.id}
          nestedScrollEnabled
          removeClippedSubviews
          renderItem={({ item }) => (
            <View
              accessible
              accessibilityLabel={isKuji && item.ticketNumber
                ? `쿠지 ${item.ticketNumber}번 결과`
                : `${sourceLabel} 결과 ${item.order}번`}
              style={styles.summaryRailItem}
            >
              <View style={styles.summaryRailIcon}><Ionicons name="gift-outline" size={20} color={colors.brand} /></View>
              <View style={styles.summaryRailCopy}>
                <Text style={styles.summaryRailCode}>RESULT {String(item.order).padStart(2, "0")}</Text>
                {isKuji && item.ticketNumber ? (
                  <Text style={styles.summaryRailTicket}>KUJI {item.ticketNumber}</Text>
                ) : null}
              </View>
            </View>
          )}
          showsVerticalScrollIndicator={false}
          style={styles.summaryRailList}
          contentContainerStyle={styles.summaryRailListContent}
        />
      </View>
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

function DrawEmbers({ seed, reduceMotion }: { seed: string; reduceMotion: boolean }) {
  const particles = useMemo(() => createKujiFireflyConfigs(seed), [seed]);
  if (reduceMotion) return null;

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.drawEmberField}
    >
      {particles.map((particle) => (
        <DrawEmber key={particle.id} particle={particle} />
      ))}
    </View>
  );
}

function DrawEmber({ particle }: { particle: KujiFireflyConfig }) {
  const phase = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(phase);
    phase.value = 0;
    phase.value = withRepeat(
      withTiming(1, {
        duration: particle.durationMs,
        easing: Easing.linear,
      }),
      -1,
      false,
    );
    return () => cancelAnimation(phase);
  }, [particle.durationMs, phase]);

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

function SealedCapsule({ reduceMotion }: { reduceMotion: boolean }) {
  const idleProgress = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(idleProgress);
    if (reduceMotion) {
      idleProgress.value = 0;
      return;
    }
    idleProgress.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1_100, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 1_100, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
    );
    return () => cancelAnimation(idleProgress);
  }, [idleProgress, reduceMotion]);

  const idleStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(idleProgress.value, [0, 1], [0, -4]) },
      { scale: interpolate(idleProgress.value, [0, 1], [1, 1.008]) },
    ],
  }));

  return (
    <Animated.View style={[styles.sealedBlock, idleStyle]}>
      <View style={styles.capsule}>
        <View style={styles.capsuleTop} />
        <View style={styles.capsuleBottom} />
        <View style={styles.capsuleSeam} />
      </View>
      <Text style={styles.sealedCode}>GACHA</Text>
      <Text style={styles.sealedLabel}>캡슐을 열어 주세요</Text>
    </Animated.View>
  );
}

function SealedDraw() {
  return (
    <View style={styles.sealedBlock}>
      <View style={styles.unknownDraw}>
        <Ionicons name="gift-outline" size={68} color={colors.brand} />
      </View>
      <Text style={styles.sealedCode}>DRAW</Text>
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

function boundedCount(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(Math.trunc(parsed), 50)) : 1;
}

function initialPreviewRevealState(mode: RevealMode, count: number, startAtSummary: boolean) {
  const initial = createPreviewRevealState(mode, count);
  return startAtSummary ? completePreviewRevealState(initial) : initial;
}

function drawCategoryFromParam(
  value: string | undefined,
): ProductDetailSnapshot["product"]["category"] | undefined {
  return value === "gacha" || value === "kuji" ? value : undefined;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.ink },
  header: { minHeight: seed.size.topNavigation, paddingHorizontal: seed.spacing.x3, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#303730", backgroundColor: colors.ink },
  headerAction: { width: seed.size.touchTarget, height: seed.size.touchTarget, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: colors.white },
  pressed: { opacity: seed.state.pressedOpacity },
  state: { flex: 1, paddingHorizontal: seed.spacing.globalGutter, alignItems: "center", justifyContent: "center", gap: seed.spacing.componentDefault },
  stateText: { maxWidth: 330, color: "#D8DED6", ...seed.typography.body, textAlign: "center" },
  stateAction: { width: "100%", marginTop: seed.spacing.x2 },
  content: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x4, paddingBottom: seed.spacing.x7, gap: seed.spacing.componentDefault },
  summaryContent: { flex: 1, paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x4, gap: seed.spacing.componentDefault },
  stageHeader: { minHeight: 54, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x3 },
  stageEyebrow: { marginBottom: seed.spacing.x1, color: colors.brand, fontSize: 10, lineHeight: 14, fontWeight: "900", letterSpacing: 1.2 },
  stageTitle: { color: colors.white },
  stage: { minHeight: 430, padding: seed.spacing.x4, borderRadius: seed.radius.r5, borderWidth: 1, borderColor: "#3A4339", backgroundColor: "#151A15", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  expandedDrawStage: { minHeight: 496 },
  summaryStage: { flex: 1, minHeight: 0, padding: seed.spacing.x2_5 },
  staticSparkField: { ...StyleSheet.absoluteFillObject },
  spark: { position: "absolute", width: 7, height: 7, backgroundColor: colors.brand },
  sparkOne: { top: 42, left: 32 },
  sparkTwo: { top: 78, right: 38, width: 4, height: 4 },
  sparkThree: { bottom: 48, right: 58, width: 5, height: 5 },
  drawEmberField: { ...StyleSheet.absoluteFillObject },
  drawEmber: { position: "absolute", borderRadius: 1.5, backgroundColor: colors.brand, shadowColor: colors.brand, shadowOpacity: 0.58, shadowRadius: 5, shadowOffset: { width: 0, height: 0 } },
  sealedBlock: { alignItems: "center" },
  capsule: { width: 156, height: 104, borderRadius: 54, borderWidth: 3, borderColor: colors.white, overflow: "hidden", transform: [{ rotate: "-8deg" }] },
  capsuleTop: { flex: 1, backgroundColor: colors.brand },
  capsuleBottom: { flex: 1, backgroundColor: "#F3F4EC" },
  capsuleSeam: { position: "absolute", left: -4, right: -4, top: 49, height: 6, backgroundColor: colors.ink, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.white },
  unknownDraw: { width: 156, height: 156, borderRadius: seed.radius.full, borderWidth: 2, borderColor: "#697469", alignItems: "center", justifyContent: "center", backgroundColor: "#202620" },
  sealedCode: { marginTop: seed.spacing.x5, color: colors.brand, fontFamily: "Galmuri11", fontSize: 17, lineHeight: 23, fontWeight: "400", letterSpacing: 0.6 },
  sealedLabel: { marginTop: seed.spacing.x1_5, color: "#CBD2C9", ...seed.typography.bodyStrong },
  previewOpened: { alignItems: "center" },
  resultAuraWrap: { alignItems: "center", justifyContent: "center" },
  resultAuraFlash: { position: "absolute", width: 164, height: 164, borderRadius: seed.radius.full, backgroundColor: "#FFF6D8" },
  resultAura: { position: "absolute", width: 174, height: 174, borderRadius: seed.radius.full, borderWidth: 2, borderColor: "#F7A34A", backgroundColor: "rgba(243, 107, 44, 0.1)", shadowColor: "#F38B35", shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 0 } },
  resultAuraOuter: { position: "absolute", width: 194, height: 194, borderRadius: seed.radius.full, borderWidth: 1, borderColor: colors.brand },
  resultAuraParticle: { position: "absolute", left: "50%", top: "50%", marginLeft: -3, marginTop: -3, borderRadius: 2, backgroundColor: colors.brand },
  previewResultIcon: { width: 158, height: 158, borderRadius: seed.radius.full, borderWidth: 1, borderColor: "#4A5549", backgroundColor: "#202620", alignItems: "center", justifyContent: "center" },
  previewResultCode: { marginTop: seed.spacing.x4, color: colors.brand, fontFamily: "Galmuri11", fontSize: 20, lineHeight: 28, fontWeight: "400" },
  previewTicketNumber: { marginTop: seed.spacing.x4, color: "#CBD2C9", ...seed.typography.caption, fontWeight: "800", letterSpacing: 0.7 },
  previewProgress: { marginTop: seed.spacing.x1, color: "#CBD2C9", ...seed.typography.bodyStrong, fontVariant: ["tabular-nums"] },
  summaryLayout: { flex: 1, width: "100%", minHeight: 0, flexDirection: "row", gap: seed.spacing.x2 },
  summaryFeatured: { flex: 1.35, minWidth: 0, padding: seed.spacing.x3, borderRadius: seed.radius.r4, borderWidth: 1, borderColor: "#4A5549", backgroundColor: "#202620", alignItems: "center", justifyContent: "center" },
  bestResultBadge: { minHeight: 30, paddingHorizontal: seed.spacing.x2_5, borderRadius: seed.radius.r2, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  bestResultBadgeText: { color: colors.ink, fontFamily: "Galmuri11", fontSize: 11, lineHeight: 16, fontWeight: "400" },
  featuredResultIcon: { width: 108, height: 108, marginTop: seed.spacing.x4, borderRadius: seed.radius.full, borderWidth: 1, borderColor: "#4A5549", backgroundColor: "#171C17", alignItems: "center", justifyContent: "center" },
  featuredResultCode: { marginTop: seed.spacing.x4, color: colors.brand, fontFamily: "Galmuri11", fontSize: 15, lineHeight: 21, fontWeight: "400", textAlign: "center" },
  featuredTicket: { marginTop: seed.spacing.x1_5, color: "#CBD2C9", fontSize: 10, lineHeight: 14, fontWeight: "800", letterSpacing: 0.6 },
  summaryRail: { flex: 1, minWidth: 0, borderRadius: seed.radius.r4, borderWidth: 1, borderColor: "#353D35", backgroundColor: "#1B201B", overflow: "hidden" },
  summaryRailHeader: { minHeight: 42, paddingHorizontal: seed.spacing.x2, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#353D35" },
  summaryRailTitle: { flex: 1, color: "#D8DED6", fontSize: 9, lineHeight: 13 },
  summaryRailCount: { color: colors.brand, fontSize: 10, lineHeight: 14, fontVariant: ["tabular-nums"] },
  summaryRailList: { flex: 1 },
  summaryRailListContent: { paddingHorizontal: seed.spacing.x2, paddingBottom: seed.spacing.x2 },
  summaryRailItem: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: seed.spacing.x1_5, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#313831" },
  summaryRailIcon: { width: 34, height: 34, borderRadius: seed.radius.r2, backgroundColor: "#252B25", alignItems: "center", justifyContent: "center" },
  summaryRailCopy: { flex: 1, minWidth: 0 },
  summaryRailCode: { color: "#D8DED6", fontSize: 10, lineHeight: 14, fontWeight: "900" },
  summaryRailTicket: { marginTop: 2, color: "#8F988E", fontSize: 9, lineHeight: 13, fontWeight: "800", letterSpacing: 0.3 },
  committedResult: { width: "100%", alignItems: "center" },
  rarityBadge: { minWidth: 64, height: 38, paddingHorizontal: seed.spacing.x3, borderRadius: seed.radius.r2_5, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  rarityText: { color: colors.ink, fontFamily: "Galmuri11", fontSize: 17, lineHeight: 23, fontWeight: "400" },
  resultImage: { width: "100%", height: 232, marginTop: seed.spacing.x4 },
  resultPlaceholder: { alignItems: "center", justifyContent: "center", borderRadius: seed.radius.r4, backgroundColor: "#202620" },
  resultIp: { marginTop: seed.spacing.x3, color: "#9EA69D", ...seed.typography.caption },
  resultName: { marginTop: seed.spacing.x1, color: colors.white, ...seed.typography.sectionTitle, textAlign: "center" },
  resultMeta: { marginTop: seed.spacing.x2, color: colors.brand, ...seed.typography.label, fontWeight: "800" },
  targetRow: { minHeight: 92, padding: seed.spacing.x3, borderRadius: seed.radius.r4, backgroundColor: "#F6F6F1", flexDirection: "row", alignItems: "center", gap: seed.spacing.componentDefault },
  targetImage: { width: 68, height: 68, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.neutralWeak },
  targetPlaceholder: { alignItems: "center", justifyContent: "center" },
  targetCopy: { flex: 1, minWidth: 0 },
  targetCaption: { color: colors.greenInk, ...seed.typography.caption, fontWeight: "800" },
  targetIp: { marginTop: seed.spacing.x0_5, color: colors.muted, ...seed.typography.caption },
  targetName: { marginTop: seed.spacing.x0_5, color: colors.ink, ...seed.typography.bodyStrong },
  footerSplitPanel: { borderWidth: 0, backgroundColor: seed.color.background.transparent, shadowOpacity: 0, shadowRadius: 0, elevation: 0 },
  footerGachaPanel: { minHeight: 0, padding: 0, borderWidth: 0, backgroundColor: seed.color.background.transparent, shadowOpacity: 0, shadowRadius: 0, elevation: 0 },
  footerActions: { flexDirection: "row", alignItems: "center", gap: seed.spacing.x2 },
  footerSplitAction: { flex: 1, minWidth: 0, paddingHorizontal: seed.spacing.x2 },
  footerOpenAllAction: { backgroundColor: seed.color.layer.elevated },
  footerAction: { width: "100%" },
});
