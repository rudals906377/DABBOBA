import Constants from "expo-constants";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DecorativeIonicon, type DecorativeIoniconName } from "@/components/DecorativeIonicon";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { KoreanPixelTitleAccessory } from "@/components/RootCategoryTitle";
import { AppText as Text } from "@/components/Typography";
import { SeedActionButton } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import {
  fetchAccountNotificationPage,
  fetchAccountNotificationUnreadSummary,
  markAccountNotificationRead,
  type AccountNotification,
} from "@/features/notifications/notifications-api";
import { ProfileSessionGate } from "@/features/profile/ProfileSessionGate";
import { ProfileApiError } from "@/features/profile/profile-api";
import { resolveMobileRuntimeConfig, type MobilePlatform } from "@/lib/runtime-config";
import { readAuthTokens } from "@/lib/session-store";
import { colors } from "@/theme";

export function NotificationsScreen() {
  const router = useRouter();
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
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<AccountNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [sessionGate, setSessionGate] = useState<"guest" | "expired" | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  // A failed page stops automatic end-of-list loading until the next
  // successful load, so a persistent error cannot loop through onEndReached.
  const autoLoadMoreBlocked = useRef(false);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    else setLoading(true);
    try {
      const tokens = await readAuthTokens();
      if (!tokens) {
        setAccessToken(null);
        setSessionGate("guest");
        setNotifications([]);
        setNextCursor(null);
        setUnreadCount(0);
        setMessage("");
        return;
      }
      setSessionGate(null);
      setAccessToken(tokens.accessToken);
      const page = await fetchAccountNotificationPage(runtime.apiBaseUrl, tokens.accessToken);
      autoLoadMoreBlocked.current = false;
      setNotifications(page.items);
      setNextCursor(page.nextCursor);
      try {
        const summary = await fetchAccountNotificationUnreadSummary(runtime.apiBaseUrl, tokens.accessToken);
        setUnreadCount(summary.unreadCount);
        setMessage("");
      } catch (error) {
        setUnreadCount(page.items.filter((notification) => !notification.readAt).length);
        setMessage(error instanceof Error ? error.message : "읽지 않은 알림 수를 불러오지 못했어요.");
      }
    } catch (error) {
      if (error instanceof ProfileApiError && error.status === 401) {
        setAccessToken(null);
        setSessionGate("expired");
        setNotifications([]);
        setNextCursor(null);
        setUnreadCount(0);
        setMessage("");
        return;
      }
      setMessage(error instanceof Error ? error.message : "알림함을 불러오지 못했어요.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [runtime.apiBaseUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  };

  const openNotification = async (notification: AccountNotification) => {
    router.push(`/notifications/${encodeURIComponent(notification.id)}` as Href);
    if (notification.readAt || !accessToken) return;

    const optimisticReadAt = new Date().toISOString();
    setNotifications((current) => current.map((item) => (
      item.id === notification.id ? { ...item, readAt: optimisticReadAt } : item
    )));
    setUnreadCount((current) => Math.max(0, current - 1));
    void markAccountNotificationRead(runtime.apiBaseUrl, accessToken, notification.id)
      .then((updated) => {
        setNotifications((current) => current.map((item) => item.id === updated.id ? updated : item));
      })
      .catch((error: unknown) => {
        console.warn(
          "DABBOBA notification read acknowledgement failed.",
          error instanceof Error ? error.message : error,
        );
      });
  };

  const loadMore = async () => {
    if (!accessToken || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchAccountNotificationPage(runtime.apiBaseUrl, accessToken, nextCursor);
      setNotifications((current) => {
        const knownIds = new Set(current.map((notification) => notification.id));
        return [...current, ...page.items.filter((notification) => !knownIds.has(notification.id))];
      });
      setNextCursor(page.nextCursor);
      setMessage("");
      autoLoadMoreBlocked.current = false;
    } catch (error) {
      autoLoadMoreBlocked.current = true;
      setMessage(error instanceof Error ? error.message : "이전 알림을 불러오지 못했어요.");
    } finally {
      setLoadingMore(false);
    }
  };

  const showList = !loading && !sessionGate && notifications.length > 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <DetailPageHeader
        title="알림함"
        titleMode="pixel"
        onBack={goBack}
        action={unreadCount ? <KoreanPixelTitleAccessory style={styles.unreadCount}>{unreadCount > 99 ? "99+" : unreadCount}</KoreanPixelTitleAccessory> : null}
      />

      <FlatList
        data={showList ? notifications : []}
        keyExtractor={(notification) => notification.id}
        renderItem={({ item: notification }) => (
          <NotificationRow notification={notification} onPress={() => void openNotification(notification)} />
        )}
        ItemSeparatorComponent={NotificationSeparator}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.ink} />}
        ListHeaderComponent={(
          <>
            <Text style={styles.description}>주문·뽑기·교환·배송·문의처럼 서버에서 완료된 계정 활동을 시간순으로 보여드려요.</Text>
            {showList && message ? <View style={styles.inlineError}><Text style={styles.inlineErrorText}>{message}</Text></View> : null}
          </>
        )}
        ListEmptyComponent={loading ? (
          <State loading body="알림을 불러오는 중" />
        ) : sessionGate ? (
          <ProfileSessionGate
            status={sessionGate}
            returnTo="/notifications"
            guestBody="로그인하면 주문·교환·배송·문의 활동 알림을 확인할 수 있어요."
          />
        ) : message ? (
          <View style={styles.state}>
            <DecorativeIonicon name="alert-circle-outline" size={34} color={colors.muted} />
            <Text style={styles.stateTitle}>{message}</Text>
            <SeedActionButton label="다시 불러오기" size="small" variant="neutralSolid" onPress={() => void load(true)} style={styles.retryButton} />
          </View>
        ) : (
          <State icon="checkmark-done-outline" title="새 알림이 없어요" body="완료된 계정 활동이 생기면 이곳에서 확인할 수 있어요." />
        )}
        ListFooterComponent={showList && nextCursor ? (
          <SeedActionButton
            label={loadingMore ? "불러오는 중" : "이전 알림 더 보기"}
            size="small"
            variant="neutralSolid"
            disabled={loadingMore}
            onPress={() => void loadMore()}
            style={styles.loadMoreButton}
          />
        ) : null}
        onEndReached={() => {
          if (showList && !autoLoadMoreBlocked.current) void loadMore();
        }}
        onEndReachedThreshold={0.5}
      />
    </SafeAreaView>
  );
}

function NotificationRow({ notification, onPress }: { notification: AccountNotification; onPress: () => void }) {
  const unread = !notification.readAt;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${notification.title}${unread ? ", 읽지 않음" : ""}`} onPress={onPress} style={({ pressed }) => [styles.notification, unread && styles.notificationUnread, pressed && styles.pressed]}>
      <View style={[styles.kindIcon, unread && styles.kindIconUnread]}><DecorativeIonicon name={notificationIcon(notification.kind)} size={21} color={colors.ink} /></View>
      <View style={styles.notificationCopy}>
        <View style={styles.notificationTitleRow}><Text numberOfLines={1} style={styles.notificationTitle}>{notification.title}</Text>{unread ? <View style={styles.unreadDot} /> : null}</View>
        <Text numberOfLines={3} style={styles.notificationBody}>{notification.body}</Text>
        <Text style={styles.notificationDate}>{formatDateTime(notification.createdAt)}{unread ? " · 눌러서 읽음 처리" : ""}</Text>
      </View>
    </Pressable>
  );
}

function NotificationSeparator() {
  return <View style={styles.listGap} />;
}

function State({ icon = "notifications-outline", title, body, loading = false }: { icon?: DecorativeIoniconName; title?: string; body: string; loading?: boolean }) {
  return <View style={styles.state}>{loading ? <ActivityIndicator color={colors.ink} /> : <DecorativeIonicon name={icon} size={34} color={colors.muted} />}{title ? <Text style={styles.stateTitle}>{title}</Text> : null}<Text style={styles.stateBody}>{body}</Text></View>;
}

function notificationIcon(kind: string): DecorativeIoniconName {
  if (kind.includes("ORDER") || kind.includes("PAYMENT")) return "receipt-outline";
  if (kind.includes("EXCHANGE")) return "swap-horizontal-outline";
  if (kind.includes("SHIPPING")) return "car-outline";
  if (kind.includes("INQUIRY")) return "chatbubble-ellipses-outline";
  if (kind.includes("DRAW") || kind.includes("GACHA") || kind.includes("KUJI")) return "cube-outline";
  return "notifications-outline";
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  unreadCount: { minWidth: 24, height: 24, paddingHorizontal: 6, borderRadius: seed.radius.r3, overflow: "hidden", backgroundColor: colors.brand, color: colors.ink, fontSize: 11, lineHeight: 24, textAlign: "center" },
  content: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x4, paddingBottom: seed.spacing.screenBottom },
  description: { color: colors.muted, fontSize: 12, lineHeight: 18, marginBottom: 18 },
  listGap: { height: 10 },
  notification: { minHeight: 112, padding: seed.spacing.x3_5, borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default, flexDirection: "row", alignItems: "flex-start", gap: seed.spacing.componentDefault },
  notificationUnread: { borderColor: seed.color.stroke.brand, backgroundColor: seed.color.layer.default },
  pressed: { opacity: seed.state.pressedOpacity, transform: [{ translateY: seed.state.pressedTranslateY }, { scale: seed.state.pressedScale }] },
  kindIcon: { width: seed.size.touchTarget, height: seed.size.touchTarget, borderRadius: seed.radius.r3, alignItems: "center", justifyContent: "center", backgroundColor: seed.color.background.neutralWeak },
  kindIconUnread: { backgroundColor: seed.color.background.brandWeak },
  notificationCopy: { flex: 1, minWidth: 0 },
  notificationTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  notificationTitle: { flex: 1, color: colors.ink, fontSize: 14, fontWeight: "900" },
  unreadDot: { width: 7, height: 7, borderRadius: seed.radius.r1, backgroundColor: colors.greenInk },
  notificationBody: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 6 },
  notificationDate: { color: colors.muted, ...seed.typography.finePrint, marginTop: 8 },
  inlineError: { padding: seed.spacing.componentDefault, marginBottom: seed.spacing.componentDefault, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.criticalWeak },
  inlineErrorText: { color: colors.ink, fontSize: 12, lineHeight: 18 },
  state: { minHeight: 420, paddingHorizontal: 28, alignItems: "center", justifyContent: "center" },
  stateTitle: { color: colors.ink, ...seed.typography.subtitle, textAlign: "center", marginTop: 14 },
  stateBody: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 7 },
  retryButton: { marginTop: seed.spacing.x4 },
  loadMoreButton: { alignSelf: "center", marginTop: seed.spacing.x4 },
});
