import Constants from "expo-constants";
import { type Href, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { DecorativeIonicon } from "@/components/DecorativeIonicon";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { ProductInfoDivider } from "@/components/ProductInfoDivider";
import { KoreanPixelTitle, KoreanPixelTitleAccessory } from "@/components/RootCategoryTitle";
import { AppText as Text } from "@/components/Typography";
import { catalogProductCardSurface } from "@/design-system/catalog";
import { SeedActionButton, SeedInlineGuidance } from "@/design-system/components";
import { subtleSectionHeaderRule } from "@/design-system/section";
import { seed } from "@/design-system/seed";
import {
  buildKujiCheckoutPath,
} from "@/features/kuji/kuji-entry-state";
import { isKujiServerClockSkewed } from "@/features/kuji/kuji-checkout-state";
import {
  KUJI_LOCAL_CHECKOUT_SECONDS,
  createKujiRoomFallback,
  formatKujiActivityAge,
  sortKujiRecentActivity,
} from "@/features/kuji/kuji-queue-state";
import {
  fetchKujiRoom,
  isKujiRoomApiUnavailable,
  joinKujiRoom,
  leaveKujiRoom,
  type KujiRecentDrawActivity,
  type KujiRoomSnapshot,
  type KujiRoomWaitingPerson,
} from "@/features/kuji/kuji-room-api";
import { scheduleKujiTurnExampleNotification } from "@/features/kuji/kuji-notifications";
import { fetchProductDetail, type ProductDetailSnapshot } from "@/features/shop/shop-api";
import { productSubjectTitle } from "@/features/shop/product-title";
import { readAuthTokens } from "@/lib/session-store";
import {
  resolveMobileRuntimeConfig,
  type MobilePlatform,
} from "@/lib/runtime-config";
import { colors } from "@/theme";

const KUJI_ROOM_POLL_INTERVAL_MS = 2_000;

export function KujiQueueScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{
    productId?: string | string[];
    internalQueue?: string | string[];
  }>();
  const productId = firstParam(params.productId) ?? "";
  const internalQueueEnabled = __DEV__
    && firstParam(params.internalQueue) === "enabled";
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
  const accessTokenRef = useRef<string | null>(null);
  const loadPendingRef = useRef(false);
  const redirectedRef = useRef(false);
  const allowNavigationRef = useRef(false);
  const fallbackStartedAtRef = useRef(Date.now());
  const [productSnapshot, setProductSnapshot] = useState<ProductDetailSnapshot | null>(null);
  const [room, setRoom] = useState<KujiRoomSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [usingFallback, setUsingFallback] = useState(false);
  const [notificationPending, setNotificationPending] = useState(false);
  const [leavePending, setLeavePending] = useState(false);

  const continueToCheckout = useCallback((
    next: KujiRoomSnapshot,
    developmentFixture = false,
  ): boolean => {
    const { viewer } = next;
    if (
      viewer.state !== "CHECKOUT_PENDING"
      || !viewer.checkoutExpiresAt
      || redirectedRef.current
    ) return false;
    if (isKujiServerClockSkewed(next.serverNow, Date.now())) {
      setMessage("기기와 서버의 시간이 맞지 않아 결제를 시작할 수 없어요. 기기의 자동 시간 설정을 확인한 뒤 다시 불러와 주세요.");
      return false;
    }
    redirectedRef.current = true;
    router.replace(
      buildKujiCheckoutPath(
        productId,
        viewer.entryId,
        viewer.checkoutExpiresAt,
        next.serverNow,
        developmentFixture,
      ) as Href,
    );
    return true;
  }, [productId, router]);

  const load = useCallback(async () => {
    if (loadPendingRef.current) return;
    loadPendingRef.current = true;
    redirectedRef.current = false;
    setLoading(true);
    setMessage("");
    setSyncMessage("");
    try {
      const tokens = await readAuthTokens();
      if (!tokens?.accessToken) throw new Error("로그인 정보를 확인한 뒤 다시 시도해 주세요.");
      accessTokenRef.current = tokens.accessToken;

      const productRequest = fetchProductDetail(
        runtime.apiBaseUrl,
        productId,
        tokens.accessToken,
      ).then((nextProduct) => (
        nextProduct.product.category === "kuji" ? nextProduct : null
      )).catch(() => null);

      let nextRoom: KujiRoomSnapshot;
      let usedFallback = false;
      try {
        nextRoom = await joinKujiRoom(runtime.apiBaseUrl, tokens.accessToken, productId);
        setUsingFallback(false);
      } catch (error) {
        if (!internalQueueEnabled || !isKujiRoomApiUnavailable(error)) throw error;
        nextRoom = createKujiRoomFallback(productId, fallbackStartedAtRef.current);
        usedFallback = true;
        setUsingFallback(true);
      }
      void productRequest.then(setProductSnapshot);
      if (!continueToCheckout(nextRoom, usedFallback)) setRoom(nextRoom);
    } catch (error) {
      setRoom(null);
      setMessage(error instanceof Error ? error.message : "쿠지 대기실을 불러오지 못했어요.");
    } finally {
      loadPendingRef.current = false;
      if (!redirectedRef.current) setLoading(false);
    }
  }, [continueToCheckout, internalQueueEnabled, productId, runtime.apiBaseUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const entryId = room?.viewer.entryId ?? "";
  const shouldPoll = Boolean(
    room
      && !usingFallback
      && room.viewer.state === "WAITING"
      && accessTokenRef.current,
  );

  useEffect(() => {
    if (!shouldPoll || !entryId) return;
    let mounted = true;
    let requestPending = false;
    const poll = async () => {
      if (requestPending || !accessTokenRef.current) return;
      requestPending = true;
      try {
        const next = await fetchKujiRoom(
          runtime.apiBaseUrl,
          accessTokenRef.current,
          productId,
          entryId,
        );
        if (!mounted) return;
        setSyncMessage("");
        if (continueToCheckout(next)) return;
        setRoom((current) => (
          !current || next.version >= current.version ? next : current
        ));
      } catch {
        if (mounted) setSyncMessage("대기 순서를 다시 연결하는 중이에요.");
      } finally {
        requestPending = false;
      }
    };
    const timer = setInterval(() => void poll(), KUJI_ROOM_POLL_INTERVAL_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [continueToCheckout, entryId, productId, runtime.apiBaseUrl, shouldPoll]);

  const confirmLeave = useCallback(async () => {
    if (!room || leavePending) return;
    setLeavePending(true);
    try {
      if (!usingFallback && accessTokenRef.current) {
        await leaveKujiRoom(
          runtime.apiBaseUrl,
          accessTokenRef.current,
          productId,
          room.viewer.entryId,
        );
      }
      allowNavigationRef.current = true;
      router.replace(`/product/${encodeURIComponent(productId)}` as Href);
    } catch (error) {
      Alert.alert(
        "대기를 취소하지 못했어요",
        error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setLeavePending(false);
    }
  }, [leavePending, productId, room, router, runtime.apiBaseUrl, usingFallback]);

  const browseOtherPages = async () => {
    if (notificationPending || !room) return;
    setNotificationPending(true);
    try {
      if (usingFallback) {
        const checkoutExpiresAt = new Date(
          Date.now() + (KUJI_LOCAL_CHECKOUT_SECONDS + 5) * 1_000,
        ).toISOString();
        await scheduleKujiTurnExampleNotification(
          productId,
          room.viewer.entryId,
          checkoutExpiresAt,
        );
      }
      allowNavigationRef.current = true;
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

  const askToLeave = useCallback(() => {
    Alert.alert("대기를 취소할까요?", "취소하면 현재 순서를 잃게 돼요.", [
      { text: "계속 대기", style: "cancel" },
      { text: "대기 취소", style: "destructive", onPress: () => void confirmLeave() },
    ]);
  }, [confirmLeave]);

  const goBack = () => {
    if (room?.viewer.state === "WAITING" || room?.viewer.state === "CHECKOUT_PENDING") {
      askToLeave();
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace(`/product/${encodeURIComponent(productId)}` as Href);
  };

  useEffect(() => navigation.addListener("beforeRemove", (event) => {
    if (
      allowNavigationRef.current
      || redirectedRef.current
      || !room
      || !["WAITING", "CHECKOUT_PENDING"].includes(room.viewer.state)
    ) return;
    event.preventDefault();
    askToLeave();
  }), [askToLeave, navigation, room]);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <DetailPageHeader title="쿠지 대기실" titleMode="pixel" onBack={goBack} backLabel="상품 상세로 돌아가기" />

      {loading ? (
        <View style={styles.state}>
          <ActivityIndicator color={colors.ink} />
          <Text style={styles.stateBody}>쿠지방을 확인하는 중</Text>
        </View>
      ) : message || !room ? (
        <View style={styles.state}>
          <DecorativeIonicon name="alert-circle-outline" size={34} color={colors.muted} />
          <Text style={styles.stateTitle}>{message || "대기실을 확인할 수 없어요."}</Text>
          <SeedActionButton label="다시 불러오기" variant="neutralSolid" onPress={() => void load()} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {usingFallback ? (
            <SeedInlineGuidance
              paragraphs={["INTERNAL QUEUE · 주문과 추첨권은 생성되지 않아요."]}
            />
          ) : null}

          <LiveDrawSection room={room} />
          <WaitingSection room={room} />

          {productSnapshot ? (
            <View style={styles.productLine} accessibilityRole="summary">
              <View style={styles.productLineIcon}>
                <DecorativeIonicon name="ticket-outline" size={20} color={colors.greenInk} />
              </View>
              <ProductInfoDivider orientation="vertical" />
              <View style={styles.productLineCopy}>
                <Text style={styles.productIp}>{productSnapshot.ip?.nameKo ?? "등록 작품"}</Text>
                <Text numberOfLines={2} style={styles.productName}>
                  {productSubjectTitle(productSnapshot.product.name, productSnapshot.ip?.nameKo)}
                </Text>
              </View>
            </View>
          ) : null}

          {syncMessage ? <Text style={styles.syncMessage}>{syncMessage}</Text> : null}

          <SeedActionButton
            label={notificationPending ? "이동 준비 중" : "다른 상품 둘러보기"}
            variant="neutralSolid"
            disabled={notificationPending}
            onPress={() => void browseOtherPages()}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="쿠지 대기 취소"
            accessibilityState={{ disabled: leavePending }}
            disabled={leavePending}
            onPress={askToLeave}
            style={({ pressed }) => [styles.leaveButton, pressed && styles.pressed]}
          >
            <Text style={styles.leaveLabel}>{leavePending ? "취소 중" : "대기 취소"}</Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function LiveDrawSection({ room }: { room: KujiRoomSnapshot }) {
  const activity = sortKujiRecentActivity(room.recentActivity);
  return (
    <View style={styles.liveCard}>
      <View style={styles.liveHeader}>
        <KoreanPixelTitle variant="section" style={styles.liveTitle}>실시간 뽑기 현황</KoreanPixelTitle>
        <View style={styles.liveBadge}><Text style={styles.liveBadgeText}>실시간</Text></View>
      </View>

      <View style={styles.activeLine}>
        <View style={styles.activeDot} />
        <Text style={styles.activeText}>
          {room.active
            ? `${room.active.displayName}님이 ${room.active.phase === "DRAWING" ? "뽑는 중" : "결제 준비 중"}`
            : "지금 이용 중인 사람이 없어요"}
        </Text>
      </View>

      <View style={styles.recentHeader}>
        <Text style={styles.recentLabel}>최근 결과</Text>
        <Text style={styles.recentCount}>{activity.length}개</Text>
      </View>

      {activity.length ? (
        <View style={styles.activityList}>
          {activity.map((item) => (
            <ActivityRow key={item.id} activity={item} serverNow={room.serverNow} />
          ))}
        </View>
      ) : (
        <View style={styles.activityEmpty}>
          <DecorativeIonicon name="sparkles-outline" size={20} color={seed.color.inverted.foregroundSubtle} />
          <Text style={styles.activityEmptyText}>아직 공개된 결과가 없어요.</Text>
        </View>
      )}
    </View>
  );
}

function ActivityRow({
  activity,
  serverNow,
}: {
  activity: KujiRecentDrawActivity;
  serverNow: string;
}) {
  const age = formatKujiActivityAge(activity.committedAt, serverNow);
  return (
    <View
      style={styles.activityRow}
      accessible
      accessibilityLabel={`${activity.displayName}님이 ${activity.prizeName} 뽑음, ${activity.rarity}상, ${age}`}
    >
      {activity.prizeImageUrl ? (
        <Image source={{ uri: activity.prizeImageUrl }} style={styles.activityImage} />
      ) : (
        <View style={styles.rarityTile}><Text variant="subtitle" numberOfLines={1} style={styles.rarityText}>{activity.rarity}</Text></View>
      )}
      <View style={styles.activityCopy}>
        <Text style={styles.activityName}>{activity.displayName}님</Text>
        <Text numberOfLines={1} style={styles.activityPrize}>{activity.prizeName}</Text>
      </View>
      <Text style={styles.activityAge}>{age}</Text>
    </View>
  );
}

function WaitingSection({ room }: { room: KujiRoomSnapshot }) {
  return (
    <View style={styles.waitingCard}>
      <View style={styles.sectionHeader}>
        <KoreanPixelTitle variant="section">대기 중</KoreanPixelTitle>
        <KoreanPixelTitleAccessory>{room.waitingCount}명</KoreanPixelTitleAccessory>
      </View>

      <View
        style={styles.viewerSummary}
        accessible
        accessibilityLabel={room.viewer.position
          ? `내 순서 ${room.viewer.position}번째, 앞에 ${room.viewer.peopleAhead}명`
          : "입장 순서를 확인하는 중"}
      >
        <Text style={styles.viewerSummaryLabel}>내 순서</Text>
        <Text style={styles.viewerSummaryValue}>
          {room.viewer.position ? `${room.viewer.position}번째` : "확인 중"}
        </Text>
        <Text style={styles.viewerSummaryMeta}>앞에 {room.viewer.peopleAhead}명</Text>
      </View>

      {room.waitingPeople.length ? (
        <View style={styles.queueList}>
          {room.waitingPeople.map((person) => (
            <QueueRow key={person.entryId} person={person} />
          ))}
        </View>
      ) : (
        <Text style={styles.waitingEmpty}>대기 중인 사람이 없어요.</Text>
      )}
    </View>
  );
}

function QueueRow({ person }: { person: KujiRoomWaitingPerson }) {
  return (
    <View
      style={[styles.queueRow, person.isViewer && styles.viewerRow]}
      accessible
      accessibilityLabel={`${person.position}번째, ${person.displayName}${person.isViewer ? ", 내 순서" : ""}`}
    >
      <View style={[styles.positionBadge, person.isViewer && styles.viewerPositionBadge]}>
        <Text style={styles.positionBadgeText}>{person.position}</Text>
      </View>
      <Text style={styles.queueName}>{person.displayName}</Text>
      {person.isViewer ? <View style={styles.meBadge}><Text style={styles.meBadgeText}>나</Text></View> : null}
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
  content: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x4, paddingBottom: seed.spacing.x8, gap: seed.spacing.componentDefault },
  liveCard: { overflow: "hidden", borderRadius: seed.radius.r5, backgroundColor: colors.ink, padding: seed.spacing.x4 },
  liveHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x3 },
  liveTitle: { color: colors.white },
  liveBadge: { paddingHorizontal: seed.spacing.x2, paddingVertical: seed.spacing.x1, borderRadius: seed.radius.r1_5, backgroundColor: colors.brand },
  liveBadgeText: { color: colors.ink, fontSize: 11, lineHeight: 16, fontWeight: "900" },
  activeLine: { minHeight: seed.size.touchTarget, marginTop: seed.spacing.x2, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2 },
  activeDot: { width: 7, height: 7, borderRadius: seed.radius.full, backgroundColor: colors.brand },
  activeText: { flex: 1, color: seed.color.inverted.foregroundMuted, ...seed.typography.caption },
  recentHeader: { minHeight: 30, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: seed.color.inverted.stroke, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  recentLabel: { color: seed.color.inverted.foregroundMuted, ...seed.typography.caption, fontWeight: "700" },
  recentCount: { color: seed.color.inverted.foregroundSubtle, ...seed.typography.caption },
  activityList: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: seed.color.inverted.stroke },
  activityRow: { minHeight: 66, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.inverted.stroke, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2_5 },
  activityImage: { width: 42, height: 42, borderRadius: seed.radius.r2_5, backgroundColor: seed.color.inverted.surfaceSubtle },
  rarityTile: { width: 42, height: 42, borderRadius: seed.radius.r2_5, borderWidth: 1, borderColor: seed.color.inverted.strokeStrong, alignItems: "center", justifyContent: "center", backgroundColor: seed.color.inverted.surfaceRaised },
  rarityText: { color: colors.brand, fontWeight: "900" },
  activityCopy: { flex: 1, minWidth: 0 },
  activityName: { color: seed.color.inverted.foregroundMuted, ...seed.typography.caption },
  activityPrize: { marginTop: seed.spacing.x0_5, color: colors.white, ...seed.typography.bodyStrong },
  activityAge: { color: seed.color.inverted.foregroundSubtle, ...seed.typography.caption },
  activityEmpty: { minHeight: 78, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: seed.color.inverted.stroke, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: seed.spacing.x2 },
  activityEmptyText: { color: seed.color.inverted.foregroundMuted, ...seed.typography.caption },
  waitingCard: { borderRadius: seed.radius.r5, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default, padding: seed.spacing.x4 },
  sectionHeader: { ...subtleSectionHeaderRule, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x3 },
  viewerSummary: { minHeight: 64, marginTop: seed.spacing.x3, paddingHorizontal: seed.spacing.x3, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.brandWeak, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2 },
  viewerSummaryLabel: { color: colors.greenInk, ...seed.typography.caption, fontWeight: "700" },
  viewerSummaryValue: { flex: 1, color: colors.ink, ...seed.typography.subtitle },
  viewerSummaryMeta: { color: colors.muted, ...seed.typography.caption },
  queueList: { marginTop: seed.spacing.x3, overflow: "hidden", borderRadius: seed.radius.r3, borderWidth: 1, borderColor: seed.color.stroke.neutral },
  queueRow: { minHeight: 58, paddingHorizontal: seed.spacing.x3, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral, flexDirection: "row", alignItems: "center", gap: seed.spacing.x3 },
  viewerRow: { backgroundColor: seed.color.background.brandWeak },
  positionBadge: { width: 32, height: 32, borderRadius: seed.radius.full, backgroundColor: seed.color.background.neutralWeak, alignItems: "center", justifyContent: "center" },
  viewerPositionBadge: { backgroundColor: seed.color.background.brandSolid },
  positionBadgeText: { color: colors.ink, ...seed.typography.label, fontWeight: "900" },
  queueName: { flex: 1, color: colors.ink, ...seed.typography.bodyStrong },
  meBadge: { paddingHorizontal: seed.spacing.x2, paddingVertical: seed.spacing.x1, borderRadius: seed.radius.r1_5, backgroundColor: colors.ink },
  meBadgeText: { color: colors.brand, fontSize: 11, lineHeight: 16, fontWeight: "900" },
  waitingEmpty: { marginTop: seed.spacing.x4, color: colors.muted, ...seed.typography.body, textAlign: "center" },
  productLine: { minHeight: 70, paddingHorizontal: seed.spacing.x3, ...catalogProductCardSurface, flexDirection: "row", alignItems: "center", gap: seed.spacing.x3 },
  productLineIcon: { width: 40, height: 40, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.brandWeak, alignItems: "center", justifyContent: "center" },
  productLineCopy: { flex: 1, minWidth: 0 },
  productIp: { color: colors.muted, ...seed.typography.caption },
  productName: { marginTop: seed.spacing.x0_5, color: colors.ink, ...seed.typography.bodyStrong },
  syncMessage: { color: colors.muted, ...seed.typography.caption, textAlign: "center" },
  leaveButton: { minHeight: seed.size.touchTarget, alignItems: "center", justifyContent: "center" },
  leaveLabel: { color: seed.color.foreground.critical, ...seed.typography.label, fontWeight: "700" },
  pressed: { opacity: seed.state.pressedOpacity },
});
