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
  buildKujiQueueView,
  createKujiQueueExample,
  formatKujiRemainingTime,
  kujiRemainingSeconds,
  type KujiQueuePersonView,
} from "@/features/kuji/kuji-queue-state";
import { scheduleKujiTurnExampleNotification } from "@/features/kuji/kuji-notifications";
import { fetchProductDetail, type ProductDetailSnapshot } from "@/features/shop/shop-api";
import { productSubjectTitle } from "@/features/shop/product-title";
import { readAuthTokens } from "@/lib/session-store";
import {
  resolveCatalogImageUrl,
  resolveMobileRuntimeConfig,
  type MobilePlatform,
} from "@/lib/runtime-config";
import { colors } from "@/theme";

export function KujiQueueScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ productId?: string | string[] }>();
  const productId = firstParam(params.productId) ?? "";
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
  const [notificationPending, setNotificationPending] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const queueSnapshot = useMemo(() => createKujiQueueExample(productId), [productId]);
  const queue = useMemo(() => buildKujiQueueView(queueSnapshot), [queueSnapshot]);
  const activePerson = queue.orderedPeople.find((person) => person.state === "ACTIVE") ?? null;
  const remainingTime = formatKujiRemainingTime(kujiRemainingSeconds(activePerson?.expiresAt, nowMs));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const tokens = await readAuthTokens();
      const next = await fetchProductDetail(runtime.apiBaseUrl, productId, tokens?.accessToken);
      if (next.product.category !== "kuji") throw new Error("쿠지 상품에서만 대기 현황을 확인할 수 있어요.");
      setSnapshot(next);
      setMessage("");
    } catch (error) {
      setSnapshot(null);
      setMessage(error instanceof Error ? error.message : "쿠지 대기 현황을 불러오지 못했습니다.");
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

  const browseOtherPages = async () => {
    if (notificationPending) return;
    setNotificationPending(true);
    try {
      await scheduleKujiTurnExampleNotification(productId);
      router.replace("/(tabs)" as Href);
    } catch (error) {
      Alert.alert(
        "알림을 켤 수 없어요",
        error instanceof Error ? error.message : "기기의 알림 설정을 확인해 주세요.",
      );
    } finally {
      setNotificationPending(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="상품 상세로 돌아가기" onPress={goBack} hitSlop={10} style={styles.headerAction}>
          <Ionicons name="chevron-back" size={28} color={colors.ink} />
        </Pressable>
        <KoreanPixelTitle variant="header">쿠지 대기</KoreanPixelTitle>
        <View style={styles.headerAction} />
      </View>

      {loading ? (
        <View style={styles.state}>
          <ActivityIndicator color={colors.ink} />
          <Text style={styles.stateBody}>대기 현황을 불러오는 중</Text>
        </View>
      ) : message || !snapshot ? (
        <View style={styles.state}>
          <Ionicons name="alert-circle-outline" size={34} color={colors.muted} />
          <Text style={styles.stateTitle}>{message || "대기 현황을 확인할 수 없습니다."}</Text>
          <SeedActionButton label="다시 불러오기" variant="neutralSolid" onPress={() => void load()} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.exampleNotice}>
            <View style={styles.exampleBadge}><Text style={styles.exampleBadgeText}>화면 예시</Text></View>
            <BalancedAppText style={styles.exampleText}>
              아직 실제 대기열 API와 연결되지 않았어요. 운영에서는 서버가 결제된 추첨권을 확인한 뒤 순서를 확정해요.
            </BalancedAppText>
          </View>

          <ProductSummary snapshot={snapshot} assetBaseUrl={runtime.assetBaseUrl} />

          <View style={styles.positionCard}>
            <KoreanPixelTitle variant="compact">내 입장 순서</KoreanPixelTitle>
            <View style={styles.positionValueRow}>
              <Text style={styles.positionValue}>{queue.viewerPosition ?? "-"}</Text>
              <Text style={styles.positionUnit}>번째</Text>
            </View>
            <Text style={styles.aheadText}>앞에 {queue.peopleAheadCount}명이 기다리고 있어요.</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.max(18, 100 / Math.max(queue.viewerPosition ?? 1, 1))}%` }]} />
            </View>
          </View>

          <View style={styles.activeCard}>
            <View style={styles.activeHeader}>
              <View>
                <KoreanPixelTitle variant="compact" style={styles.activeTitle}>현재 입장 중</KoreanPixelTitle>
                <Text style={styles.activeName}>{queue.orderedPeople[0]?.displayName ?? "입장 준비 중"}</Text>
              </View>
              <View style={styles.timerBlock}>
                <Text style={styles.timerLabel}>남은 시간</Text>
                <Text style={styles.timerValue}>{remainingTime}</Text>
              </View>
            </View>
            <BalancedAppText style={styles.activeBody}>
              쿠지방에는 한 명만 입장할 수 있고 제한시간은 5분이에요. 시간이 끝나면 다음 순서가 자동으로 열려요.
            </BalancedAppText>
          </View>

          <View style={styles.queueSection}>
            <View style={styles.sectionHeader}>
              <KoreanPixelTitle variant="section">대기 중</KoreanPixelTitle>
              <Text style={styles.queueCount}>{queue.orderedPeople.filter((person) => person.state === "WAITING").length}명</Text>
            </View>
            <View style={styles.queueList}>
              {queue.orderedPeople.filter((person) => person.state === "WAITING").map((person) => (
                <QueueRow key={person.userId} person={person} />
              ))}
            </View>
          </View>

          <View style={styles.guideCard}>
            <Ionicons name="information-circle-outline" size={21} color={colors.greenInk} />
            <BalancedAppText style={styles.guideText}>
              대기 중에는 다른 페이지를 둘러봐도 괜찮아요. 앞사람이 끝나면 휴대폰 상단 알림으로 차례를 알려드려요.
            </BalancedAppText>
          </View>

          <SeedActionButton
            label={notificationPending ? "알림 준비 중" : "다른 페이지 둘러보기"}
            variant="neutralSolid"
            disabled={notificationPending}
            onPress={() => void browseOtherPages()}
          />

          <BalancedAppText style={styles.restoreText}>
            실제 서비스에서는 앱을 다시 열어도 서버가 같은 순서를 복원하고, 차례 알림 후 10초 동안만 입장을 선점할 수 있어요.
          </BalancedAppText>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ProductSummary({ snapshot, assetBaseUrl }: { snapshot: ProductDetailSnapshot; assetBaseUrl: string | null }) {
  const imageUri = resolveCatalogImageUrl(snapshot.product.imageUrl, assetBaseUrl, snapshot.product.version);
  return (
    <View style={styles.productCard}>
      {imageUri ? (
        <Image source={{ uri: imageUri }} resizeMode="cover" style={styles.productImage} />
      ) : (
        <View style={[styles.productImage, styles.productPlaceholder]}><Ionicons name="image-outline" size={24} color={colors.muted} /></View>
      )}
      <View style={styles.productCopy}>
        <Text style={styles.ipName}>{snapshot.ip?.nameKo ?? "등록 작품"}</Text>
        <Text numberOfLines={2} style={styles.productName}>{productSubjectTitle(snapshot.product.name, snapshot.ip?.nameKo)}</Text>
        <Text style={styles.productMeta}>쿠지 · {snapshot.product.price.toLocaleString("ko-KR")}원</Text>
      </View>
    </View>
  );
}

function QueueRow({ person }: { person: KujiQueuePersonView }) {
  return (
    <View style={[styles.queueRow, person.isViewer && styles.viewerRow]}>
      <View style={[styles.positionBadge, person.isViewer && styles.viewerPositionBadge]}>
        <Text style={styles.positionBadgeText}>{person.position}</Text>
      </View>
      <View style={styles.queuePersonCopy}>
        <Text style={styles.queueName}>{person.displayName}</Text>
        <Text style={styles.queueStatus}>{person.isViewer ? "내 순서" : "대기 중"}</Text>
      </View>
      {person.isViewer ? <View style={styles.meBadge}><Text style={styles.meBadgeText}>ME</Text></View> : null}
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
  content: { padding: seed.spacing.globalGutter, paddingBottom: seed.spacing.x8, gap: seed.spacing.componentDefault },
  exampleNotice: { minHeight: 60, padding: seed.spacing.x3, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.brandWeak, flexDirection: "row", alignItems: "flex-start", gap: seed.spacing.x2_5 },
  exampleBadge: { paddingHorizontal: seed.spacing.x2, paddingVertical: seed.spacing.x1, borderRadius: seed.radius.r1_5, backgroundColor: colors.ink },
  exampleBadgeText: { color: colors.white, fontSize: 9, lineHeight: 13, fontWeight: "900" },
  exampleText: { flex: 1, color: colors.greenInk, ...seed.typography.caption },
  productCard: { padding: seed.spacing.x3, borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default, flexDirection: "row", alignItems: "center", gap: seed.spacing.componentDefault },
  productImage: { width: 76, height: 76, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.neutralWeak },
  productPlaceholder: { alignItems: "center", justifyContent: "center" },
  productCopy: { flex: 1, minWidth: 0 },
  ipName: { color: colors.muted, ...seed.typography.caption },
  productName: { marginTop: seed.spacing.x1, color: colors.ink, ...seed.typography.bodyStrong },
  productMeta: { marginTop: seed.spacing.x2, color: colors.greenInk, ...seed.typography.label, fontWeight: "700" },
  positionCard: { minHeight: 188, padding: seed.spacing.x4_5, borderRadius: seed.radius.r5, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default, alignItems: "center" },
  positionValueRow: { marginTop: seed.spacing.x2, flexDirection: "row", alignItems: "flex-end" },
  positionValue: { color: colors.ink, fontSize: 64, lineHeight: 72, fontWeight: "900" },
  positionUnit: { marginBottom: seed.spacing.x2, marginLeft: seed.spacing.x1, color: colors.ink, ...seed.typography.subtitle },
  aheadText: { marginTop: seed.spacing.x1, color: colors.muted, ...seed.typography.bodyStrong },
  progressTrack: { width: "100%", height: 6, marginTop: seed.spacing.x4, overflow: "hidden", borderRadius: seed.radius.full, backgroundColor: seed.color.background.neutralWeak },
  progressFill: { height: "100%", borderRadius: seed.radius.full, backgroundColor: seed.color.background.brandSolid },
  activeCard: { minHeight: 136, padding: seed.spacing.x4_5, borderRadius: seed.radius.r5, backgroundColor: colors.ink },
  activeHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: seed.spacing.x3 },
  activeTitle: { color: colors.brand },
  activeName: { marginTop: seed.spacing.x2, color: colors.white, ...seed.typography.subtitle },
  timerBlock: { minWidth: 82, paddingHorizontal: seed.spacing.x2_5, paddingVertical: seed.spacing.x2, borderRadius: seed.radius.r3, backgroundColor: "rgba(145, 233, 142, 0.13)", alignItems: "flex-end" },
  timerLabel: { color: "#C7CDC5", fontSize: 10, lineHeight: 14 },
  timerValue: { marginTop: seed.spacing.x0_5, color: colors.brand, fontFamily: "Galmuri11", fontSize: 18, lineHeight: 23, fontWeight: "400", fontVariant: ["tabular-nums"] },
  activeBody: { marginTop: seed.spacing.x3, color: "#C7CDC5", ...seed.typography.caption },
  queueSection: { marginTop: seed.spacing.x2 },
  sectionHeader: { marginBottom: seed.spacing.x3, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  queueCount: { color: colors.muted, ...seed.typography.label, fontWeight: "700" },
  queueList: { overflow: "hidden", borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  queueRow: { minHeight: 64, paddingHorizontal: seed.spacing.x3_5, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral, flexDirection: "row", alignItems: "center", gap: seed.spacing.x3 },
  viewerRow: { backgroundColor: seed.color.background.brandWeak },
  positionBadge: { width: 34, height: 34, borderRadius: seed.radius.full, backgroundColor: seed.color.background.neutralWeak, alignItems: "center", justifyContent: "center" },
  viewerPositionBadge: { backgroundColor: seed.color.background.brandSolid },
  positionBadgeText: { color: colors.ink, ...seed.typography.label, fontWeight: "900" },
  queuePersonCopy: { flex: 1 },
  queueName: { color: colors.ink, ...seed.typography.bodyStrong },
  queueStatus: { marginTop: seed.spacing.x0_5, color: colors.muted, ...seed.typography.caption },
  meBadge: { paddingHorizontal: seed.spacing.x2, paddingVertical: seed.spacing.x1, borderRadius: seed.radius.r1_5, backgroundColor: colors.ink },
  meBadgeText: { color: colors.brand, fontSize: 9, lineHeight: 13, fontWeight: "900" },
  guideCard: { minHeight: 76, padding: seed.spacing.x3_5, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.brandWeak, flexDirection: "row", alignItems: "flex-start", gap: seed.spacing.x2_5 },
  guideText: { flex: 1, color: colors.greenInk, ...seed.typography.caption },
  restoreText: { color: colors.muted, ...seed.typography.caption, textAlign: "center" },
});
