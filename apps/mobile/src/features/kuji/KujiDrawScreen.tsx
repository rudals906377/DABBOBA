import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
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
import {
  FloatingBottomActionPanel,
  useFloatingBottomActionContentInset,
} from "@/components/FloatingBottomActionPanel";
import { ProductInfoDivider } from "@/components/ProductInfoDivider";
import { KoreanPixelTitle, KoreanPixelTitleAccessory } from "@/components/RootCategoryTitle";
import { AppText as Text, BalancedAppText } from "@/components/Typography";
import { SeedActionButton } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import { normalizeDrawPurchaseCount } from "@/features/draw/draw-purchase-state";
import {
  KUJI_SESSION_LIMIT_SECONDS,
  formatKujiRemainingTime,
  kujiRemainingSeconds,
} from "@/features/kuji/kuji-queue-state";
import {
  aggregateKujiRemainingByRarity,
  buildKujiPreviewParams,
  createKujiTicketNumbers,
  formatKujiRarityLabel,
  hasExactKujiTicketSelection,
  KUJI_EXAMPLE_REMAINING,
  type KujiRarityRemaining,
  toggleKujiTicketSelection,
} from "@/features/kuji/kuji-selection-state";
import { fetchProductDetail, type ProductDetailSnapshot } from "@/features/shop/shop-api";
import { productSubjectTitle } from "@/features/shop/product-title";
import { readAuthTokens } from "@/lib/session-store";
import {
  resolveCatalogImageUrl,
  resolveMobileRuntimeConfig,
  type MobilePlatform,
} from "@/lib/runtime-config";
import { colors } from "@/theme";

const EXAMPLE_TICKETS = createKujiTicketNumbers();
const EXAMPLE_SOLD_TICKETS = new Set(["04", "11", "17", "23", "36", "42"]);
const EXAMPLE_AVAILABLE_TICKET_COUNT = EXAMPLE_TICKETS.length - EXAMPLE_SOLD_TICKETS.size;

export function KujiDrawScreen() {
  const router = useRouter();
  const floatingBottomInset = useFloatingBottomActionContentInset();
  const params = useLocalSearchParams<{
    productId?: string | string[];
    claimExpiresAt?: string | string[];
    count?: string | string[];
  }>();
  const productId = firstParam(params.productId) ?? "";
  const claimExpiresAt = firstParam(params.claimExpiresAt);
  const purchasedCount = normalizeDrawPurchaseCount(
    firstParam(params.count),
    EXAMPLE_AVAILABLE_TICKET_COUNT,
  );
  const claimAccepted = useMemo(() => {
    if (!claimExpiresAt) return true;
    const expiry = Date.parse(claimExpiresAt);
    return Number.isFinite(expiry) && Date.now() < expiry;
  }, [claimExpiresAt]);
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
  const [selectedTickets, setSelectedTickets] = useState<string[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [expiresAt] = useState(() => new Date(Date.now() + KUJI_SESSION_LIMIT_SECONDS * 1_000).toISOString());
  const remainingSeconds = kujiRemainingSeconds(expiresAt, nowMs);
  const remainingTime = formatKujiRemainingTime(remainingSeconds);
  const livePrizeRemaining = useMemo(
    () => aggregateKujiRemainingByRarity(snapshot?.drawOdds?.entries ?? []),
    [snapshot?.drawOdds?.entries],
  );
  const prizeRemaining = livePrizeRemaining.length || !__DEV__
    ? livePrizeRemaining
    : KUJI_EXAMPLE_REMAINING;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const tokens = await readAuthTokens();
      const next = await fetchProductDetail(runtime.apiBaseUrl, productId, tokens?.accessToken);
      if (next.product.category !== "kuji") throw new Error("쿠지 상품에서만 뽑기방에 입장할 수 있어요.");
      setSnapshot(next);
      setMessage("");
    } catch (error) {
      setSnapshot(null);
      setMessage(error instanceof Error ? error.message : "쿠지 뽑기방을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [productId, runtime.apiBaseUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/ppoba");
  };

  const returnToQueue = () => {
    router.replace(`/kuji/queue/${encodeURIComponent(productId)}?count=${purchasedCount}` as Href);
  };

  const openSelectedTickets = () => {
    if (!hasExactKujiTicketSelection(selectedTickets, purchasedCount) || remainingSeconds <= 0) return;
    router.push({
      pathname: `/draw/preview/${encodeURIComponent(productId)}`,
      params: buildKujiPreviewParams(selectedTickets, "single"),
    } as Href);
  };

  const toggleTicket = (ticket: string) => {
    if (EXAMPLE_SOLD_TICKETS.has(ticket)) return;
    setSelectedTickets((current) => toggleKujiTicketSelection(current, ticket, purchasedCount));
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="상품 상세로 돌아가기" onPress={goBack} hitSlop={10} style={styles.headerAction}>
          <Ionicons name="chevron-back" size={28} color={colors.ink} />
        </Pressable>
        <KoreanPixelTitle variant="header">쿠지 뽑기</KoreanPixelTitle>
        <View style={styles.headerAction} />
      </View>

      {!claimAccepted ? (
        <View style={styles.state}>
          <View style={styles.expiredIcon}>
            <Ionicons name="time-outline" size={30} color={colors.greenInk} />
          </View>
          <KoreanPixelTitle variant="section" style={styles.stateTitle}>입장 시간이 지났어요</KoreanPixelTitle>
          <BalancedAppText style={styles.expiredBody}>
            차례 알림 후 10초 안에 입장하지 않아 다음 대기자에게 순서가 넘어갔어요.
          </BalancedAppText>
          <SeedActionButton label="대기 현황으로 돌아가기" onPress={returnToQueue} style={styles.expiredAction} />
        </View>
      ) : loading ? (
        <View style={styles.state}><ActivityIndicator color={colors.ink} /><Text style={styles.stateBody}>쿠지 뽑기방을 준비하는 중</Text></View>
      ) : message || !snapshot ? (
        <View style={styles.state}>
          <Ionicons name="alert-circle-outline" size={34} color={colors.muted} />
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
                  <Text style={styles.boardTotal}>{EXAMPLE_AVAILABLE_TICKET_COUNT}장 남음 · 총 50장</Text>
                </View>
              </View>
              <View style={styles.ticketGrid}>
                {EXAMPLE_TICKETS.map((ticket) => {
                  const selected = selectedTickets.includes(ticket);
                  const sold = EXAMPLE_SOLD_TICKETS.has(ticket);
                  const selectionFull = selectedTickets.length >= purchasedCount;
                  const disabled = sold || remainingSeconds <= 0 || (!selected && selectionFull);
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
                        source={require("../../../assets/kuji-ticket-front.png")}
                        style={[styles.ticketArtwork, sold && styles.ticketArtworkSold]}
                      />
                      {sold ? <View style={styles.ticketSoldOverlay} /> : null}
                      <View style={[styles.ticketFace, sold && styles.ticketFaceSold, selected && styles.ticketFaceSelected]}>
                        <Text style={[styles.ticketNumber, sold && styles.ticketNumberSold]}>{ticket}</Text>
                        <View style={[styles.ticketState, selected && styles.ticketStateSelected]}>
                          {selected ? <Ionicons name="checkmark" size={9} color={colors.ink} /> : null}
                          <Text style={[styles.ticketLabel, sold && styles.ticketLabelSold, selected && styles.ticketLabelSelected]}>{sold ? "완료" : selected ? "선택" : "쿠지"}</Text>
                        </View>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <PrizeRemainingPanel items={prizeRemaining} />
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
              label={remainingSeconds <= 0 ? "입장 시간이 끝났어요" : "쿠지 뽑기"}
              disabled={selectedTickets.length !== purchasedCount || remainingSeconds <= 0}
              onPress={openSelectedTickets}
              style={styles.footerAction}
            />
          </FloatingBottomActionPanel>
        </>
      )}
    </SafeAreaView>
  );
}

function ProductStrip({ snapshot, assetBaseUrl }: { snapshot: ProductDetailSnapshot; assetBaseUrl: string | null }) {
  const imageUri = resolveCatalogImageUrl(snapshot.product.imageUrl, assetBaseUrl, snapshot.product.version);
  return (
    <View style={styles.productStrip}>
      {imageUri ? <Image source={{ uri: imageUri }} resizeMode="contain" style={styles.productImage} /> : <View style={[styles.productImage, styles.productPlaceholder]}><Ionicons name="image-outline" size={22} color={colors.muted} /></View>}
      <View style={styles.productCopy}>
        <Text style={styles.ipName}>{snapshot.ip?.nameKo ?? "등록 작품"}</Text>
        <Text numberOfLines={2} style={styles.productName}>{productSubjectTitle(snapshot.product.name, snapshot.ip?.nameKo)}</Text>
        <ProductInfoDivider style={styles.productFieldDivider} />
        <Text style={styles.productMeta}>쿠지 · {snapshot.product.price.toLocaleString("ko-KR")}원</Text>
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
  header: { minHeight: seed.size.topNavigation, paddingHorizontal: seed.spacing.x3_5, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  headerAction: { width: seed.size.touchTarget, height: seed.size.touchTarget, alignItems: "center", justifyContent: "center" },
  state: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: seed.spacing.globalGutter, gap: seed.spacing.componentDefault },
  stateTitle: { color: colors.ink, ...seed.typography.subtitle, textAlign: "center" },
  stateBody: { color: colors.muted, ...seed.typography.body },
  expiredIcon: { width: 58, height: 58, borderRadius: seed.radius.full, backgroundColor: seed.color.background.brandWeak, alignItems: "center", justifyContent: "center" },
  expiredBody: { maxWidth: 330, color: colors.muted, ...seed.typography.body, textAlign: "center" },
  expiredAction: { width: "100%", marginTop: seed.spacing.x2 },
  content: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x4, paddingBottom: seed.spacing.x7, gap: seed.spacing.componentDefault },
  productStrip: { padding: seed.spacing.x3, borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default, flexDirection: "row", alignItems: "center", gap: seed.spacing.componentDefault },
  productImage: { width: 68, height: 68, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.neutralWeak },
  productPlaceholder: { alignItems: "center", justifyContent: "center" },
  productCopy: { flex: 1, minWidth: 0 },
  ipName: { color: colors.muted, ...seed.typography.caption },
  productName: { marginTop: seed.spacing.x0_5, color: colors.ink, ...seed.typography.bodyStrong },
  productFieldDivider: { marginTop: seed.spacing.x1_5 },
  productMeta: { marginTop: seed.spacing.x1_5, color: colors.greenInk, ...seed.typography.label, fontWeight: "700" },
  timerCard: { minHeight: 76, paddingHorizontal: seed.spacing.x4, paddingVertical: seed.spacing.x3, borderRadius: seed.radius.r4, backgroundColor: colors.ink, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x3 },
  timerTitle: { color: colors.brand },
  timerValue: { color: colors.brand, fontFamily: "Galmuri11", fontSize: 34, lineHeight: 41, fontWeight: "400", fontVariant: ["tabular-nums"] },
  timerDanger: { color: "#FF9B86" },
  drawBoard: { padding: seed.spacing.x3, borderRadius: seed.radius.r5, backgroundColor: colors.ink },
  boardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: seed.spacing.x3 },
  boardTitle: { color: colors.white },
  boardCountBlock: { alignItems: "flex-end" },
  boardCount: { color: colors.brand, fontSize: 13, lineHeight: 18 },
  boardTotal: { marginTop: 2, color: "#8E978D", fontSize: 10, lineHeight: 14, fontWeight: "700" },
  ticketGrid: { marginTop: seed.spacing.x3, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: seed.spacing.x2 },
  ticket: { width: "18.4%", minHeight: seed.size.touchTarget, aspectRatio: 1.36, overflow: "hidden", borderRadius: seed.radius.r1_5, borderWidth: 1, borderColor: "#A83C15", backgroundColor: "#F36B2C" },
  ticketSold: { borderColor: "#555D55", backgroundColor: "#303630" },
  ticketSelected: { borderWidth: 2, borderColor: colors.brand, backgroundColor: "#F36B2C" },
  ticketPressed: { opacity: seed.state.pressedOpacity },
  ticketArtwork: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  ticketArtworkSold: { opacity: 0.22 },
  ticketSoldOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(35, 40, 35, 0.68)" },
  ticketFace: { zIndex: 1, flex: 1, paddingLeft: 11, paddingRight: 2, paddingVertical: 3, alignItems: "center", justifyContent: "center", gap: 1 },
  ticketFaceSold: { backgroundColor: "transparent" },
  ticketFaceSelected: { backgroundColor: "transparent" },
  ticketNumber: { color: colors.white, fontSize: 15, lineHeight: 18, fontWeight: "900", fontVariant: ["tabular-nums"] },
  ticketNumberSold: { color: "#A7ADA6" },
  ticketState: { minHeight: 11, paddingHorizontal: 3, borderRadius: seed.radius.full, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 1 },
  ticketStateSelected: { backgroundColor: colors.brand },
  ticketLabel: { color: "#FFF2E8", fontFamily: "Galmuri11", fontSize: 7, lineHeight: 10, fontWeight: "400" },
  ticketLabelSold: { color: "#D0D5CF" },
  ticketLabelSelected: { color: colors.ink },
  prizeRemainingPanel: { minHeight: 60, paddingHorizontal: seed.spacing.x3, paddingVertical: seed.spacing.x2_5, borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default, justifyContent: "center" },
  prizeRemainingRow: { flexDirection: "row", alignItems: "center", gap: seed.spacing.x2 },
  prizeRemainingTitle: { flexShrink: 0, color: colors.ink },
  prizeRemainingItems: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: seed.spacing.x1 },
  prizeRemainingItem: { flex: 1, minWidth: 0, minHeight: 34, paddingHorizontal: 2, borderRadius: seed.radius.r2, backgroundColor: seed.color.background.brandWeak, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2 },
  prizeRarity: { flexShrink: 1, color: colors.greenInk, fontFamily: "Galmuri11", fontSize: 10, lineHeight: 14, fontWeight: "400" },
  prizeRemainingValue: { flexShrink: 1, color: colors.ink, fontSize: 10, lineHeight: 14, fontWeight: "900", fontVariant: ["tabular-nums"] },
  prizeRemainingEmptyText: { flex: 1, color: colors.muted, ...seed.typography.caption },
  footer: { flexDirection: "row", alignItems: "center", gap: seed.spacing.x2 },
  selectionSummary: { width: 118, minHeight: seed.size.actionButton.large, paddingHorizontal: seed.spacing.x3, borderRadius: seed.radius.r3, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.basement, alignItems: "flex-start", justifyContent: "center" },
  selectionSummaryCount: { color: colors.muted, fontSize: 11, lineHeight: 15, fontWeight: "700" },
  selectionSummaryHint: { marginTop: 1, color: colors.ink, fontSize: 12, lineHeight: 18, fontWeight: "800" },
  footerAction: { flex: 1 },
});
