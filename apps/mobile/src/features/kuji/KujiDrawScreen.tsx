import Constants from "expo-constants";
import { type Href, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { DecorativeIonicon } from "@/components/DecorativeIonicon";
import {
  FloatingBottomActionPanel,
  useFloatingBottomActionContentInset,
} from "@/components/FloatingBottomActionPanel";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { ProductInfoDivider } from "@/components/ProductInfoDivider";
import { RemainingInventoryMeter } from "@/components/RemainingInventoryMeter";
import { KoreanPixelTitle, KoreanPixelTitleAccessory } from "@/components/RootCategoryTitle";
import { AppText as Text, BalancedAppText } from "@/components/Typography";
import { catalogProductCardSurface, catalogProductImageSurface } from "@/design-system/catalog";
import { SeedActionButton } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import { presentDrawOpenModeChoice } from "@/features/draw/draw-open-mode-prompt";
import { withDrawOpenMode } from "@/features/draw/draw-open-mode";
import {
  createKujiDrawLeaseClock,
  formatKujiDrawLeaseRemainingTime,
  kujiDrawLeaseRemainingSeconds,
  type KujiDrawLeaseClock,
} from "@/features/kuji/kuji-draw-lease-state";
import {
  formatKujiRarityLabel,
  hasExactKujiTicketSelection,
  type KujiRarityRemaining,
  toggleKujiTicketSelection,
} from "@/features/kuji/kuji-selection-state";
import {
  bindPaidKujiSlots,
  fetchPaidKujiSelection,
  type KujiSlotApiError,
} from "@/features/kuji/kuji-slot-api";
import {
  formatKujiSlotNumber,
  parseKujiPaidDrawRoute,
  validateKujiSlotBinding,
} from "@/features/kuji/kuji-slot-state";
import { paidKujiRevealPath, preparePaidKujiSelection } from "@/features/kuji/paid-kuji-selection-state";
import { createKujiSelectionRequestScope } from "@/features/kuji/kuji-selection-request-scope";
import { productSubjectTitle } from "@/features/shop/product-title";
import { readAuthTokens } from "@/lib/session-store";
import {
  resolveCatalogImageUrl,
  resolveMobileRuntimeConfig,
  type MobilePlatform,
} from "@/lib/runtime-config";
import { colors } from "@/theme";
import type { PaidKujiSelectionSnapshot, PublicKujiDeckSnapshot } from "@dabboba/contracts";

export function KujiDrawScreen() {
  const router = useRouter();
  const floatingBottomInset = useFloatingBottomActionContentInset();
  const params = useLocalSearchParams<{
    productId?: string | string[];
    count?: string | string[];
    orderId?: string | string[];
    kujiEntryId?: string | string[];
    entitlementIds?: string | string[];
  }>();
  const productId = firstParam(params.productId) ?? "";
  const paidDrawRoute = useMemo(() => parseKujiPaidDrawRoute({
    orderId: firstParam(params.orderId),
    roomEntryId: firstParam(params.kujiEntryId),
    entitlementIds: firstParam(params.entitlementIds),
    requestedCount: firstParam(params.count),
  }), [params.count, params.entitlementIds, params.kujiEntryId, params.orderId]);
  const purchasedCount = paidDrawRoute?.entitlementIds.length ?? 0;
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
  const [snapshot, setSnapshot] = useState<PaidKujiSelectionSnapshot | null>(null);
  const [board, setBoard] = useState<PublicKujiDeckSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [bindingMessage, setBindingMessage] = useState("");
  const [binding, setBinding] = useState(false);
  const bindingRef = useRef<symbol | null>(null);
  const requestScope = useMemo(() => createKujiSelectionRequestScope(), []);
  // Invalidate old callbacks during a parameter render, before navigation effects run.
  requestScope.setOwner(JSON.stringify([productId, paidDrawRoute]));
  const mountedRef = useRef(true);
  const [selectedTickets, setSelectedTickets] = useState<string[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [drawLeaseClock, setDrawLeaseClock] = useState<KujiDrawLeaseClock | null>(null);
  const remainingSeconds = drawLeaseClock
    ? kujiDrawLeaseRemainingSeconds(drawLeaseClock, nowMs)
    : 0;
  const remainingTime = formatKujiDrawLeaseRemainingTime(remainingSeconds);
  const ticketSlots = useMemo(() => board?.slots.map((slot) => ({
    ...slot,
    label: formatKujiSlotNumber(slot.slotNumber, board.totalSlots),
  })) ?? [], [board]);
  const availableTicketCount = useMemo(
    () => ticketSlots.filter((slot) => slot.available).length,
    [ticketSlots],
  );
  const availableTicketLabels = useMemo(
    () => new Set(ticketSlots.filter((slot) => slot.available).map((slot) => slot.label)),
    [ticketSlots],
  );
  const prizeRemaining: KujiRarityRemaining[] = useMemo(
    () => board?.tiers.map((tier) => ({
      rarity: tier.label,
      remainingQuantity: tier.remainingQuantity,
    })) ?? [],
    [board],
  );

  const load = useCallback(async () => {
    if (!requestScope.isFocused()) return;
    const current = requestScope.beginRequest();
    setLoading(true);
    try {
      if (!paidDrawRoute) {
        throw new Error("결제한 쿠지 주문과 추첨권 정보를 확인할 수 없습니다.");
      }
      const tokens = await readAuthTokens();
      if (!current()) return;
      if (!tokens?.accessToken) throw new Error("로그인 후 쿠지 번호를 선택해 주세요.");
      const next = await fetchPaidKujiSelection(runtime.apiBaseUrl, tokens.accessToken, paidDrawRoute.orderId);
      const latestTokens = await readAuthTokens();
      if (!current()) return;
      if (latestTokens?.accessToken !== tokens.accessToken) throw new Error("로그인 정보가 변경되었습니다. 다시 불러와 주세요.");
      const prepared = preparePaidKujiSelection(next, { ...paidDrawRoute, productId });
      if (prepared.kind === "DONE") throw new Error("이미 모두 연 쿠지 주문입니다. 구매 내역을 확인해 주세요.");
      if (prepared.kind === "REVEAL") {
        presentDrawOpenModeChoice(next.recovery.entitlementIds.length, (mode) => {
          if (!current()) return;
          requestScope.invalidate();
          router.replace(withDrawOpenMode(prepared.path, mode) as Href);
        });
        return;
      }
      const nextBoard = prepared.board;
      const clientNowMs = Date.now();
      const nextDrawLeaseClock = createKujiDrawLeaseClock(
        next.recovery.drawingExpiresAt,
        next.recovery.serverNow,
        next.recovery.roomState,
        clientNowMs,
      );
      if (!nextDrawLeaseClock.valid) throw new Error("쿠지 뽑기방의 남은 시간을 확인할 수 없습니다.");
      setNowMs(clientNowMs);
      setDrawLeaseClock(nextDrawLeaseClock);
      setSnapshot(next);
      setBoard(nextBoard);
      const available = new Set(nextBoard.slots.filter((slot) => slot.available).map((slot) => (
        formatKujiSlotNumber(slot.slotNumber, nextBoard.totalSlots)
      )));
      setSelectedTickets((current) => current.filter((ticket) => available.has(ticket)));
      setMessage("");
    } catch (error) {
      if (!current()) return;
      setSnapshot(null);
      setBoard(null);
      setDrawLeaseClock(null);
      setMessage(error instanceof Error ? error.message : "쿠지 뽑기방을 불러오지 못했습니다.");
    } finally {
      if (current()) setLoading(false);
    }
  }, [paidDrawRoute, productId, requestScope, router, runtime.apiBaseUrl]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; requestScope.invalidate(); };
  }, [requestScope]);

  useFocusEffect(useCallback(() => {
    requestScope.focus();
    void load();
    return () => requestScope.invalidate();
  }, [load, requestScope]));

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const goBack = () => {
    requestScope.invalidate();
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/kuji");
  };

  const openSelectedTickets = async () => {
    if (
      bindingRef.current
      || !requestScope.isFocused()
      || !paidDrawRoute
      || !board
      || !hasExactKujiTicketSelection(selectedTickets, purchasedCount)
    ) return;
    const selectedSlotNumbers = selectedTickets.map(Number).sort((left, right) => left - right);
    if (selectedSlotNumbers.some((slotNumber) => !board.slots.some((slot) => (
      slot.slotNumber === slotNumber && slot.available
    )))) {
      setBindingMessage("이미 선택된 번호가 있어 번호판을 새로 확인해 주세요.");
      void load();
      return;
    }

    const bindingRequest = Symbol("kuji-slot-binding");
    bindingRef.current = bindingRequest;
    const current = requestScope.captureCurrentRequest();
    setBinding(true);
    setBindingMessage("");
    try {
      const tokens = await readAuthTokens();
      if (!current()) return;
      if (!tokens?.accessToken) throw new Error("로그인 후 쿠지 번호를 선택해 주세요.");
      const result = await bindPaidKujiSlots(runtime.apiBaseUrl, tokens.accessToken, {
        productId,
        roomEntryId: paidDrawRoute.roomEntryId,
        orderId: paidDrawRoute.orderId,
        probabilityVersion: board.probabilityVersion,
        slotNumbers: selectedSlotNumbers,
      });
      const latestTokens = await readAuthTokens();
      if (!current()) return;
      if (latestTokens?.accessToken !== tokens.accessToken) throw new Error("로그인 정보가 변경되었습니다. 다시 불러와 주세요.");
      const bindings = validateKujiSlotBinding(result, {
        productId,
        roomEntryId: paidDrawRoute.roomEntryId,
        probabilityVersion: board.probabilityVersion,
        entitlementIds: paidDrawRoute.entitlementIds,
        slotNumbers: selectedSlotNumbers,
      });
      presentDrawOpenModeChoice(bindings.length, (mode) => {
        if (!current()) return;
        const revealPath = paidKujiRevealPath({
          productId, orderId: paidDrawRoute.orderId, roomEntryId: paidDrawRoute.roomEntryId,
          bindings, totalSlots: board.totalSlots, mode,
        });
        requestScope.invalidate();
        router.replace(revealPath as Href);
      });
    } catch (error) {
      if (!current()) return;
      const status = (error as KujiSlotApiError | undefined)?.status;
      setBindingMessage(error instanceof Error ? error.message : "선택한 쿠지 번호를 확정하지 못했습니다.");
      if (status === 409) void load();
    } finally {
      // Only this operation can release its lock, even after a blur/re-entry.
      if (bindingRef.current === bindingRequest) {
        bindingRef.current = null;
        if (mountedRef.current) setBinding(false);
      }
    }
  };

  const toggleTicket = (ticket: string) => {
    if (!availableTicketLabels.has(ticket) || binding) return;
    setBindingMessage("");
    setSelectedTickets((current) => toggleKujiTicketSelection(current, ticket, purchasedCount));
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <DetailPageHeader title="쿠지 뽑기" onBack={goBack} backLabel="상품 상세로 돌아가기" />

      {loading ? (
        <View style={styles.state}><ActivityIndicator color={colors.ink} /><Text style={styles.stateBody}>쿠지 뽑기방을 준비하는 중</Text></View>
      ) : message || !snapshot || !board ? (
        <View style={styles.state}>
          <DecorativeIonicon name="alert-circle-outline" size={34} color={colors.muted} />
          <Text style={styles.stateTitle}>{message || "쿠지 뽑기방을 확인할 수 없습니다."}</Text>
          <SeedActionButton label="다시 불러오기" variant="neutralSolid" onPress={() => void load()} />
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={[styles.content, { paddingBottom: floatingBottomInset }]}>
            <ProductStrip snapshot={snapshot} assetBaseUrl={runtime.assetBaseUrl} />

            <View style={styles.timerCard}>
              <KoreanPixelTitle variant="compact" style={styles.timerTitle}>남은 시간</KoreanPixelTitle>
              <Text style={[styles.timerValue, remainingSeconds <= 30 && styles.timerDanger]}>{remainingTime}</Text>
            </View>

            <View style={styles.drawBoard}>
              <View style={styles.boardHeader}>
                <KoreanPixelTitle variant="section" style={styles.boardTitle}>쿠지 선택</KoreanPixelTitle>
                <View style={styles.boardCountBlock}>
                  <KoreanPixelTitleAccessory style={styles.boardCount}>선택 {selectedTickets.length} / {purchasedCount}장</KoreanPixelTitleAccessory>
                  <RemainingInventoryMeter
                    category="kuji"
                    availableQuantity={availableTicketCount}
                    totalQuantity={board.totalSlots}
                    compact
                    dark
                    style={styles.boardInventory}
                  />
                </View>
              </View>
              <View style={styles.ticketGrid}>
                {ticketSlots.map((slot) => {
                  const ticket = slot.label;
                  const selected = selectedTickets.includes(ticket);
                  const sold = !slot.available;
                  const selectionFull = selectedTickets.length >= purchasedCount;
                  const disabled = binding || sold || (!selected && selectionFull);
                  return (
                    <Pressable
                      key={ticket}
                      accessibilityRole="checkbox"
                      accessibilityLabel={`${ticket}번 쿠지${
                        sold
                          ? ", 판매 완료"
                          : selected
                            ? ", 선택됨"
                            : selectionFull
                              ? ", 구매 수량 선택 완료"
                              : ", 선택 가능"
                      }`}
                      accessibilityState={{ checked: selected, disabled }}
                      disabled={disabled}
                      onPress={() => toggleTicket(ticket)}
                      style={({ pressed }) => [styles.ticket, sold && styles.ticketSold, selected && styles.ticketSelected, pressed && styles.ticketPressed]}
                    >
                      <Image
                        accessibilityIgnoresInvertColors
                        resizeMode="stretch"
                        source={require("../../../assets/draw/kuji/kuji-ticket-front.png")}
                        style={[styles.ticketArtwork, sold && styles.ticketArtworkSold]}
                      />
                      {sold ? <View style={styles.ticketSoldOverlay} /> : null}
                      <View style={[styles.ticketFace, sold && styles.ticketFaceSold, selected && styles.ticketFaceSelected]}>
                        <Text style={[styles.ticketNumber, sold && styles.ticketNumberSold]}>{ticket}</Text>
                        <View style={[styles.ticketState, selected && styles.ticketStateSelected]}>
                          {selected ? <DecorativeIonicon name="checkmark" size={9} color={colors.ink} /> : null}
                          <Text style={[styles.ticketLabel, sold && styles.ticketLabelSold, selected && styles.ticketLabelSelected]}>{sold ? "완료" : selected ? "선택" : "쿠지"}</Text>
                        </View>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <PrizeRemainingPanel items={prizeRemaining} />
            {bindingMessage ? (
              <BalancedAppText accessibilityRole="alert" style={styles.bindingMessage}>
                {bindingMessage}
              </BalancedAppText>
            ) : null}
          </ScrollView>

          <FloatingBottomActionPanel panelStyle={styles.footer}>
            <View
              accessible
              accessibilityLabel={`구매한 ${purchasedCount}장 중 ${selectedTickets.length}장 선택`}
              style={styles.selectionSummary}
            >
              <Text numberOfLines={1} style={styles.selectionSummaryCount}>선택 {selectedTickets.length}/{purchasedCount}장</Text>
              <Text numberOfLines={1} style={styles.selectionSummaryHint}>번호를 골라주세요</Text>
            </View>
            <SeedActionButton
              label="쿠지 뽑기"
              loading={binding}
              disabled={binding || selectedTickets.length !== purchasedCount}
              onPress={() => void openSelectedTickets()}
              style={styles.footerAction}
            />
          </FloatingBottomActionPanel>
        </>
      )}
    </SafeAreaView>
  );
}

function ProductStrip({ snapshot, assetBaseUrl }: { snapshot: PaidKujiSelectionSnapshot; assetBaseUrl: string | null }) {
  const imageUri = resolveCatalogImageUrl(snapshot.product.currentImageUrl, assetBaseUrl);
  return (
    <View style={styles.productStrip}>
      {imageUri ? <Image source={{ uri: imageUri }} resizeMode="contain" style={styles.productImage} /> : <View style={[styles.productImage, styles.productPlaceholder]}><DecorativeIonicon name="image-outline" size={22} color={colors.muted} /></View>}
      <View style={styles.productCopy}>
        <Text style={styles.ipName}>{snapshot.product.currentIpName ?? "등록 작품"}</Text>
        <Text numberOfLines={2} style={styles.productName}>{productSubjectTitle(snapshot.product.name, snapshot.product.currentIpName)}</Text>
        <ProductInfoDivider style={styles.productFieldDivider} />
        <Text style={styles.productMeta}>쿠지 · {snapshot.product.unitPrice.toLocaleString("ko-KR")}원</Text>
      </View>
    </View>
  );
}

function PrizeRemainingPanel({
  items,
}: {
  items: readonly KujiRarityRemaining[];
}) {
  return (
    <View style={styles.prizeRemainingPanel}>
      {items.length ? (
        <View style={styles.prizeRemainingRow}>
          <KoreanPixelTitle variant="compact" style={styles.prizeRemainingTitle}>남은 상</KoreanPixelTitle>
          <View style={styles.prizeRemainingItems}>
            {items.map((item) => (
              <View
                key={item.rarity}
                accessible
                accessibilityLabel={`${formatKujiRarityLabel(item.rarity)} ${item.remainingQuantity === null ? "수량 확인 중" : `${item.remainingQuantity}개 남음`}`}
                style={styles.prizeRemainingItem}
              >
                <Text numberOfLines={1} style={styles.prizeRarity}>{formatKujiRarityLabel(item.rarity)}</Text>
                <Text numberOfLines={1} style={styles.prizeRemainingValue}>{item.remainingQuantity === null ? "—" : `${item.remainingQuantity}개`}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : (
        <View style={styles.prizeRemainingRow}>
          <KoreanPixelTitle variant="compact" style={styles.prizeRemainingTitle}>남은 상</KoreanPixelTitle>
          <Text style={styles.prizeRemainingEmptyText}>공개된 수량을 확인 중이에요.</Text>
        </View>
      )}
    </View>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  state: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: seed.spacing.globalGutter, gap: seed.spacing.componentDefault },
  stateTitle: { color: colors.ink, ...seed.typography.subtitle, textAlign: "center" },
  stateBody: { color: colors.muted, ...seed.typography.body },
  expiredIcon: { width: 58, height: 58, borderRadius: seed.radius.full, backgroundColor: seed.color.background.brandWeak, alignItems: "center", justifyContent: "center" },
  expiredBody: { maxWidth: 330, color: colors.muted, ...seed.typography.body, textAlign: "center" },
  expiredAction: { width: "100%", marginTop: seed.spacing.x2 },
  content: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x4, paddingBottom: seed.spacing.x7, gap: seed.spacing.componentDefault },
  productStrip: { padding: seed.spacing.x3, ...catalogProductCardSurface, flexDirection: "row", alignItems: "center", gap: seed.spacing.componentDefault },
  productImage: { width: 68, height: 68, ...catalogProductImageSurface },
  productPlaceholder: { alignItems: "center", justifyContent: "center" },
  productCopy: { flex: 1, minWidth: 0 },
  ipName: { color: colors.muted, ...seed.typography.caption },
  productName: { marginTop: seed.spacing.x0_5, color: colors.ink, ...seed.typography.bodyStrong },
  productFieldDivider: { marginTop: seed.spacing.x1_5 },
  productMeta: { marginTop: seed.spacing.x1_5, color: colors.greenInk, ...seed.typography.label, fontWeight: "700" },
  timerCard: { minHeight: 76, paddingHorizontal: seed.spacing.x4, paddingVertical: seed.spacing.x3, borderRadius: seed.radius.r4, backgroundColor: colors.ink, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x3 },
  timerTitle: { color: colors.brand },
  timerValue: { color: colors.brand, fontSize: 34, lineHeight: 41, fontWeight: "900", fontVariant: ["tabular-nums"] },
  timerDanger: { color: "#FF9B86" },
  drawBoard: { padding: seed.spacing.x3, borderRadius: seed.radius.r5, backgroundColor: colors.ink },
  boardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: seed.spacing.x3 },
  boardTitle: { color: colors.white },
  boardCountBlock: { alignItems: "flex-end" },
  boardCount: { color: colors.brand, fontSize: 13, lineHeight: 18 },
  boardInventory: { width: 164, marginTop: seed.spacing.x0_5 },
  ticketGrid: { marginTop: seed.spacing.x3, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: seed.spacing.x2 },
  ticket: { width: "18.4%", minHeight: seed.size.touchTarget, aspectRatio: 1.36, overflow: "hidden", borderRadius: seed.radius.r1_5, borderWidth: 2, borderColor: colors.kujiOrangeDark, backgroundColor: colors.kujiOrange },
  ticketSold: { borderColor: "#555D55", backgroundColor: "#303630" },
  ticketSelected: { borderColor: colors.brand, backgroundColor: colors.kujiOrange },
  ticketPressed: { opacity: seed.state.pressedOpacity },
  ticketArtwork: { ...StyleSheet.absoluteFill, width: "100%", height: "100%" },
  ticketArtworkSold: { opacity: 0.22 },
  ticketSoldOverlay: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(35, 40, 35, 0.68)" },
  ticketFace: { zIndex: 1, flex: 1, paddingLeft: 11, paddingRight: 2, paddingVertical: 3, alignItems: "center", justifyContent: "center", gap: 1 },
  ticketFaceSold: { backgroundColor: "transparent" },
  ticketFaceSelected: { backgroundColor: "transparent" },
  ticketNumber: { color: colors.white, fontSize: 15, lineHeight: 18, fontWeight: "900", fontVariant: ["tabular-nums"] },
  ticketNumberSold: { color: "#A7ADA6" },
  ticketState: { minHeight: 11, paddingHorizontal: 3, borderRadius: seed.radius.full, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 1 },
  ticketStateSelected: { backgroundColor: colors.brand },
  ticketLabel: { color: "#FFF2E8", fontSize: 11, lineHeight: 15, fontWeight: "800" },
  ticketLabelSold: { color: "#D0D5CF" },
  ticketLabelSelected: { color: colors.ink },
  prizeRemainingPanel: { minHeight: 60, paddingHorizontal: seed.spacing.x3, paddingVertical: seed.spacing.x2_5, borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default, justifyContent: "center" },
  prizeRemainingRow: { flexDirection: "row", alignItems: "center", gap: seed.spacing.x2 },
  prizeRemainingTitle: { flexShrink: 0, color: colors.ink },
  prizeRemainingItems: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: seed.spacing.x1 },
  prizeRemainingItem: { flex: 1, minWidth: 0, minHeight: 34, paddingHorizontal: 2, borderRadius: seed.radius.r2, backgroundColor: seed.color.background.brandWeak, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2 },
  prizeRarity: { flexShrink: 1, color: colors.greenInk, fontSize: 11, lineHeight: 16, fontWeight: "800" },
  prizeRemainingValue: { flexShrink: 1, color: colors.ink, fontSize: 11, lineHeight: 16, fontWeight: "900", fontVariant: ["tabular-nums"] },
  prizeRemainingEmptyText: { flex: 1, color: colors.muted, ...seed.typography.caption },
  bindingMessage: { color: seed.color.foreground.critical, ...seed.typography.caption, textAlign: "center" },
  footer: { flexDirection: "row", alignItems: "center", gap: seed.spacing.x2 },
  selectionSummary: { width: 118, minHeight: seed.size.actionButton.large, paddingHorizontal: seed.spacing.x3, borderRadius: seed.radius.r3, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.basement, alignItems: "flex-start", justifyContent: "center" },
  selectionSummaryCount: { color: colors.muted, fontSize: 11, lineHeight: 15, fontWeight: "700" },
  selectionSummaryHint: { marginTop: 1, color: colors.ink, fontSize: 12, lineHeight: 18, fontWeight: "800" },
  footerAction: { flex: 1 },
});
