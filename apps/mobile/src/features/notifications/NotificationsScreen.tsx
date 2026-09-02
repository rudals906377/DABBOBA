import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { KoreanPixelTitle, KoreanPixelTitleAccessory } from "@/components/RootCategoryTitle";
import { AppText as Text } from "@/components/Typography";
import { seed } from "@/design-system/seed";
import {
  fetchAccountNotifications,
  markAccountNotificationRead,
  type AccountNotification,
} from "@/features/notifications/notifications-api";
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
  const [guest, setGuest] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    else setLoading(true);
    try {
      const tokens = await readAuthTokens();
      if (!tokens) {
        setAccessToken(null);
        setGuest(true);
        setNotifications([]);
        setMessage("");
        return;
      }
      setGuest(false);
      setAccessToken(tokens.accessToken);
      setNotifications(await fetchAccountNotifications(runtime.apiBaseUrl, tokens.accessToken));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "알림함을 불러오지 못했습니다.");
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
    if (!notification.readAt) {
      if (!accessToken || pendingId) return;
      setPendingId(notification.id);
      try {
        const updated = await markAccountNotificationRead(runtime.apiBaseUrl, accessToken, notification.id);
        setNotifications((current) => current.map((item) => item.id === updated.id ? updated : item));
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "알림을 읽음 처리하지 못했습니다.");
        return;
      } finally {
        setPendingId(null);
      }
    }

    router.push(`/notifications/${encodeURIComponent(notification.id)}` as Href);
  };

  const unreadCount = notifications.filter((notification) => !notification.readAt).length;

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기" onPress={goBack} style={styles.headerAction}>
          <Ionicons name="chevron-back" size={27} color={colors.ink} />
        </Pressable>
        <KoreanPixelTitle variant="header">알림함</KoreanPixelTitle>
        <View style={styles.headerAction}>{unreadCount ? <KoreanPixelTitleAccessory style={styles.unreadCount}>{unreadCount > 99 ? "99+" : unreadCount}</KoreanPixelTitleAccessory> : null}</View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.ink} />}
      >
        <Text style={styles.description}>주문·뽑기·교환·배송·문의처럼 서버에서 완료된 계정 활동을 시간순으로 보여드려요.</Text>

        {loading ? (
          <State loading body="알림을 불러오는 중" />
        ) : guest ? (
          <View style={styles.state}>
            <View style={styles.stateIcon}><Ionicons name="notifications-outline" size={30} color={colors.ink} /></View>
            <Text style={styles.stateTitle}>로그인이 필요해요</Text>
            <Text style={styles.stateBody}>로그인하면 주문·교환·배송·문의 활동 알림을 확인할 수 있어요.</Text>
            <Pressable accessibilityRole="button" onPress={() => router.replace("/(tabs)/profile")} style={styles.primaryButton}><Text style={styles.primaryButtonLabel}>내정보로 이동</Text></Pressable>
          </View>
        ) : message && !notifications.length ? (
          <View style={styles.state}>
            <Ionicons name="alert-circle-outline" size={34} color={colors.muted} />
            <Text style={styles.stateTitle}>{message}</Text>
            <Pressable accessibilityRole="button" onPress={() => void load(true)} style={styles.retryButton}><Text style={styles.retryLabel}>다시 불러오기</Text></Pressable>
          </View>
        ) : notifications.length ? (
          <>
            {message ? <View style={styles.inlineError}><Text style={styles.inlineErrorText}>{message}</Text></View> : null}
            <View style={styles.list}>
              {notifications.map((notification) => (
                <NotificationRow key={notification.id} notification={notification} pending={pendingId === notification.id} onPress={() => void openNotification(notification)} />
              ))}
            </View>
          </>
        ) : (
          <State icon="checkmark-done-outline" title="새 알림이 없어요" body="완료된 계정 활동이 생기면 이곳에서 확인할 수 있어요." />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function NotificationRow({ notification, pending, onPress }: { notification: AccountNotification; pending: boolean; onPress: () => void }) {
  const unread = !notification.readAt;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${notification.title}${unread ? ", 읽지 않음" : ""}`} accessibilityState={{ busy: pending }} onPress={onPress} style={({ pressed }) => [styles.notification, unread && styles.notificationUnread, pressed && styles.pressed]}>
      <View style={[styles.kindIcon, unread && styles.kindIconUnread]}><Ionicons name={notificationIcon(notification.kind)} size={21} color={colors.ink} /></View>
      <View style={styles.notificationCopy}>
        <View style={styles.notificationTitleRow}><Text numberOfLines={1} style={styles.notificationTitle}>{notification.title}</Text>{unread ? <View style={styles.unreadDot} /> : null}</View>
        <Text numberOfLines={3} style={styles.notificationBody}>{notification.body}</Text>
        <Text style={styles.notificationDate}>{formatDateTime(notification.createdAt)}{unread ? " · 눌러서 읽음 처리" : ""}</Text>
      </View>
      {pending ? <ActivityIndicator size="small" color={colors.greenInk} /> : null}
    </Pressable>
  );
}

function State({ icon = "notifications-outline", title, body, loading = false }: { icon?: keyof typeof Ionicons.glyphMap; title?: string; body: string; loading?: boolean }) {
  return <View style={styles.state}>{loading ? <ActivityIndicator color={colors.ink} /> : <Ionicons name={icon} size={34} color={colors.muted} />}{title ? <Text style={styles.stateTitle}>{title}</Text> : null}<Text style={styles.stateBody}>{body}</Text></View>;
}

function notificationIcon(kind: string): keyof typeof Ionicons.glyphMap {
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
  header: { minHeight: seed.size.topNavigation, paddingHorizontal: seed.spacing.x2_5, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerAction: { width: seed.size.touchTarget, height: seed.size.touchTarget, alignItems: "center", justifyContent: "center" },
  unreadCount: { minWidth: 24, height: 24, paddingHorizontal: 6, borderRadius: 12, overflow: "hidden", backgroundColor: colors.brand, color: colors.ink, fontSize: 11, lineHeight: 24, textAlign: "center" },
  content: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x4, paddingBottom: seed.spacing.screenBottom },
  description: { color: colors.muted, fontSize: 12, lineHeight: 18, marginBottom: 18 },
  list: { gap: 10 },
  notification: { minHeight: 112, padding: seed.spacing.x3_5, borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default, flexDirection: "row", alignItems: "flex-start", gap: seed.spacing.componentDefault },
  notificationUnread: { borderColor: seed.color.stroke.brand, backgroundColor: seed.color.background.brandWeak },
  pressed: { opacity: seed.state.pressedOpacity },
  kindIcon: { width: seed.size.touchTarget, height: seed.size.touchTarget, borderRadius: seed.radius.r3, alignItems: "center", justifyContent: "center", backgroundColor: seed.color.background.neutralWeak },
  kindIconUnread: { backgroundColor: seed.color.background.brandSolid },
  notificationCopy: { flex: 1, minWidth: 0 },
  notificationTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  notificationTitle: { flex: 1, color: colors.ink, fontSize: 14, fontWeight: "900" },
  unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.greenInk },
  notificationBody: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 6 },
  notificationDate: { color: colors.muted, fontSize: 10, marginTop: 8 },
  inlineError: { padding: seed.spacing.componentDefault, marginBottom: seed.spacing.componentDefault, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.criticalWeak },
  inlineErrorText: { color: colors.ink, fontSize: 12, lineHeight: 18 },
  state: { minHeight: 420, paddingHorizontal: 28, alignItems: "center", justifyContent: "center" },
  stateIcon: { width: seed.spacing.x16, height: seed.spacing.x16, borderRadius: seed.radius.r5, alignItems: "center", justifyContent: "center", backgroundColor: seed.color.background.brandSolid },
  stateTitle: { color: colors.ink, fontSize: 17, lineHeight: 24, fontWeight: "900", textAlign: "center", marginTop: 14 },
  stateBody: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 7 },
  primaryButton: { minHeight: seed.size.actionButton.large, justifyContent: "center", paddingHorizontal: seed.spacing.x5, marginTop: seed.spacing.x4_5, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.brandSolid },
  primaryButtonLabel: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  retryButton: { minHeight: 42, justifyContent: "center", paddingHorizontal: 16, marginTop: 15, borderRadius: 10, backgroundColor: colors.ink },
  retryLabel: { color: colors.white, fontSize: 13, fontWeight: "800" },
});
