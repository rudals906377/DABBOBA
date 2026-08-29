import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
  KUJI_SESSION_LIMIT_SECONDS,
  formatKujiRemainingTime,
  kujiRemainingSeconds,
} from "@/features/kuji/kuji-queue-state";
import { fetchProductDetail, type ProductDetailSnapshot } from "@/features/shop/shop-api";
import { productSubjectTitle } from "@/features/shop/product-title";
import { readAuthTokens } from "@/lib/session-store";
import {
  resolveCatalogImageUrl,
  resolveMobileRuntimeConfig,
  type MobilePlatform,
} from "@/lib/runtime-config";
import { colors } from "@/theme";

const EXAMPLE_TICKETS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"));

export function KujiDrawScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    productId?: string | string[];
    claimExpiresAt?: string | string[];
  }>();
  const productId = firstParam(params.productId) ?? "";
  const claimExpiresAt = firstParam(params.claimExpiresAt);
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
    router.replace(`/kuji/queue/${encodeURIComponent(productId)}` as Href);
  };

  const chooseOpenMode = () => {
    if (!selectedTickets.length) return;
    Alert.alert(
      "오픈 방식 선택",
      `${selectedTickets.length}장의 결과를 어떻게 확인할까요?`,
      [
        { text: "한 장씩 오픈", onPress: () => setTimeout(() => confirmOpenMode("한 장씩 오픈"), 220) },
        { text: "한 번에 오픈", onPress: () => setTimeout(() => confirmOpenMode("한 번에 오픈"), 220) },
      ],
    );
  };

  const confirmOpenMode = (mode: "한 장씩 오픈" | "한 번에 오픈") => {
    Alert.alert(
      `${mode} 선택 완료`,
      `선택한 ${selectedTickets.length}장을 ${mode} 방식으로 확인할 예정이에요. 현재 화면은 예시이며 실제 서비스에서는 결제와 서버 추첨이 확정된 뒤 결과를 공개해요.`,
      [{ text: "확인" }],
    );
  };

  const confirmPaymentAmount = () => {
    if (!snapshot || !selectedTickets.length || remainingSeconds <= 0) return;
    const total = snapshot.product.price * selectedTickets.length;
    Alert.alert(
      "결제 금액 확인",
      `${selectedTickets.length}장 · ${total.toLocaleString("ko-KR")}원이에요. 현재 로컬 화면에서는 실제 결제나 추첨을 진행하지 않아요.`,
      [
        { text: "취소", style: "cancel" },
        { text: "오픈 방식 선택", onPress: chooseOpenMode },
      ],
    );
  };

  const toggleTicket = (ticket: string) => {
    setSelectedTickets((current) => (
      current.includes(ticket)
        ? current.filter((value) => value !== ticket)
        : [...current, ticket].sort()
    ));
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
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
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.exampleNotice}>
              <View style={styles.exampleBadge}><Text style={styles.exampleBadgeText}>화면 예시</Text></View>
              <BalancedAppText style={styles.exampleText}>
                실제 입장은 결제된 추첨권과 서버의 빈 방 확인이 끝난 뒤에만 가능해요.
              </BalancedAppText>
            </View>

            <ProductStrip snapshot={snapshot} assetBaseUrl={runtime.assetBaseUrl} />

            <View style={styles.timerCard}>
              <View>
                <KoreanPixelTitle variant="compact" style={styles.timerTitle}>남은 시간</KoreanPixelTitle>
                <Text style={styles.timerCaption}>입장 후 제한시간은 5분이에요.</Text>
              </View>
              <Text style={[styles.timerValue, remainingSeconds <= 30 && styles.timerDanger]}>{remainingTime}</Text>
            </View>

            <View style={styles.drawBoard}>
              <View style={styles.boardHeader}>
                <View>
                  <KoreanPixelTitle variant="section" style={styles.boardTitle}>쿠지 선택</KoreanPixelTitle>
                  <Text style={styles.boardCaption}>뽑을 쿠지를 선택해 주세요.</Text>
                </View>
                <Text style={styles.boardCount}>{selectedTickets.length ? `${selectedTickets.length}장 선택` : "12장"}</Text>
              </View>
              <View style={styles.ticketGrid}>
                {EXAMPLE_TICKETS.map((ticket) => {
                  const selected = selectedTickets.includes(ticket);
                  return (
                    <Pressable
                      key={ticket}
                      accessibilityRole="checkbox"
                      accessibilityLabel={`${ticket}번 쿠지`}
                      accessibilityState={{ checked: selected, disabled: remainingSeconds <= 0 }}
                      disabled={remainingSeconds <= 0}
                      onPress={() => toggleTicket(ticket)}
                      style={({ pressed }) => [styles.ticket, selected && styles.ticketSelected, pressed && styles.ticketPressed]}
                    >
                      <View style={[styles.ticketSeal, selected && styles.ticketSealSelected]}>
                        <Text style={styles.ticketNumber}>{ticket}</Text>
                      </View>
                      <Text style={[styles.ticketLabel, selected && styles.ticketLabelSelected]}>{selected ? "선택" : "KUJI"}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.ruleCard}>
              <Ionicons name="time-outline" size={21} color={colors.greenInk} />
              <BalancedAppText style={styles.ruleText}>
                5분이 지나면 현재 입장은 종료되고 다음 대기자에게 순서가 넘어가요. 앱을 닫아도 서버 만료 시각은 멈추지 않아요.
              </BalancedAppText>
            </View>

            <View style={styles.turnRuleCard}>
              <Ionicons name="notifications-outline" size={21} color={colors.ink} />
              <BalancedAppText style={styles.turnRuleText}>
                대기 중 받은 차례 알림은 10초 안에 눌러 입장해야 해요. 시간 안에 입장하면 그때부터 5분 제한시간이 시작돼요.
              </BalancedAppText>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <SeedActionButton
              label={remainingSeconds <= 0 ? "입장 시간이 끝났어요" : "쿠지 뽑기"}
              disabled={!selectedTickets.length || remainingSeconds <= 0}
              onPress={confirmPaymentAmount}
              style={styles.footerAction}
            />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

function ProductStrip({ snapshot, assetBaseUrl }: { snapshot: ProductDetailSnapshot; assetBaseUrl: string | null }) {
  const imageUri = resolveCatalogImageUrl(snapshot.product.imageUrl, assetBaseUrl, snapshot.product.version);
  return (
    <View style={styles.productStrip}>
      {imageUri ? <Image source={{ uri: imageUri }} resizeMode="cover" style={styles.productImage} /> : <View style={[styles.productImage, styles.productPlaceholder]}><Ionicons name="image-outline" size={22} color={colors.muted} /></View>}
      <View style={styles.productCopy}>
        <Text style={styles.ipName}>{snapshot.ip?.nameKo ?? "등록 작품"}</Text>
        <Text numberOfLines={2} style={styles.productName}>{productSubjectTitle(snapshot.product.name, snapshot.ip?.nameKo)}</Text>
        <Text style={styles.productMeta}>쿠지 · {snapshot.product.price.toLocaleString("ko-KR")}원</Text>
      </View>
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
  state: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: seed.spacing.x7, gap: seed.spacing.componentDefault },
  stateTitle: { color: colors.ink, ...seed.typography.subtitle, textAlign: "center" },
  stateBody: { color: colors.muted, ...seed.typography.body },
  expiredIcon: { width: 58, height: 58, borderRadius: seed.radius.full, backgroundColor: seed.color.background.brandWeak, alignItems: "center", justifyContent: "center" },
  expiredBody: { maxWidth: 330, color: colors.muted, ...seed.typography.body, textAlign: "center" },
  expiredAction: { width: "100%", marginTop: seed.spacing.x2 },
  content: { padding: seed.spacing.globalGutter, paddingBottom: seed.spacing.x7, gap: seed.spacing.componentDefault },
  exampleNotice: { minHeight: 58, padding: seed.spacing.x3, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.brandWeak, flexDirection: "row", alignItems: "flex-start", gap: seed.spacing.x2_5 },
  exampleBadge: { paddingHorizontal: seed.spacing.x2, paddingVertical: seed.spacing.x1, borderRadius: seed.radius.r1_5, backgroundColor: colors.ink },
  exampleBadgeText: { color: colors.white, fontSize: 9, lineHeight: 13, fontWeight: "900" },
  exampleText: { flex: 1, color: colors.greenInk, ...seed.typography.caption },
  productStrip: { padding: seed.spacing.x3, borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default, flexDirection: "row", alignItems: "center", gap: seed.spacing.componentDefault },
  productImage: { width: 68, height: 68, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.neutralWeak },
  productPlaceholder: { alignItems: "center", justifyContent: "center" },
  productCopy: { flex: 1, minWidth: 0 },
  ipName: { color: colors.muted, ...seed.typography.caption },
  productName: { marginTop: seed.spacing.x0_5, color: colors.ink, ...seed.typography.bodyStrong },
  productMeta: { marginTop: seed.spacing.x1_5, color: colors.greenInk, ...seed.typography.label, fontWeight: "700" },
  timerCard: { minHeight: 92, paddingHorizontal: seed.spacing.x4, paddingVertical: seed.spacing.x3_5, borderRadius: seed.radius.r4, backgroundColor: colors.ink, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x3 },
  timerTitle: { color: colors.brand },
  timerCaption: { marginTop: seed.spacing.x1, color: "#C7CDC5", ...seed.typography.caption },
  timerValue: { color: colors.brand, fontFamily: "Galmuri11", fontSize: 34, lineHeight: 41, fontWeight: "400", fontVariant: ["tabular-nums"] },
  timerDanger: { color: "#FF9B86" },
  drawBoard: { padding: seed.spacing.x4, borderRadius: seed.radius.r5, backgroundColor: colors.ink },
  boardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: seed.spacing.x3 },
  boardTitle: { color: colors.white },
  boardCaption: { marginTop: seed.spacing.x1, color: "#C7CDC5", ...seed.typography.caption },
  boardCount: { color: colors.brand, ...seed.typography.label, fontWeight: "800" },
  ticketGrid: { marginTop: seed.spacing.x4, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: seed.spacing.x2_5 },
  ticket: { width: "23%", aspectRatio: 0.78, paddingVertical: seed.spacing.x2, borderRadius: seed.radius.r2_5, borderWidth: 1, borderColor: "#3A413A", backgroundColor: "#202520", alignItems: "center", justifyContent: "space-between" },
  ticketSelected: { borderColor: colors.brand, backgroundColor: "#E9F7E7" },
  ticketPressed: { opacity: seed.state.pressedOpacity },
  ticketSeal: { width: 38, height: 38, borderRadius: seed.radius.full, borderWidth: 1, borderColor: "#5A6259", backgroundColor: "#111411", alignItems: "center", justifyContent: "center" },
  ticketSealSelected: { borderColor: colors.ink, backgroundColor: colors.brand },
  ticketNumber: { color: colors.white, fontSize: 12, lineHeight: 16, fontWeight: "900" },
  ticketLabel: { color: "#9CA49B", fontSize: 8, lineHeight: 12, fontWeight: "900", letterSpacing: 0.8 },
  ticketLabelSelected: { color: colors.greenInk },
  ruleCard: { minHeight: 78, padding: seed.spacing.x3_5, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.brandWeak, flexDirection: "row", alignItems: "flex-start", gap: seed.spacing.x2_5 },
  ruleText: { flex: 1, color: colors.greenInk, ...seed.typography.caption },
  turnRuleCard: { minHeight: 78, padding: seed.spacing.x3_5, borderRadius: seed.radius.r3, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default, flexDirection: "row", alignItems: "flex-start", gap: seed.spacing.x2_5 },
  turnRuleText: { flex: 1, color: colors.ink, ...seed.typography.caption },
  footer: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.componentDefault, paddingBottom: seed.spacing.x1, borderTopWidth: 1, borderTopColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  footerAction: { width: "100%" },
});
