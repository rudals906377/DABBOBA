import Constants from "expo-constants";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DecorativeIonicon, type DecorativeIoniconName } from "@/components/DecorativeIonicon";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { AppText as Text } from "@/components/Typography";
import { seed } from "@/design-system/seed";
import {
  fetchAccountNotification,
  markAccountNotificationRead,
  type AccountNotification,
} from "@/features/notifications/notifications-api";
import { resolveNotificationTarget } from "@/features/notifications/notification-navigation";
import {
  resolveMobileRuntimeConfig,
  type MobilePlatform,
} from "@/lib/runtime-config";
import { readAuthTokens } from "@/lib/session-store";
import { colors } from "@/theme";

export function NotificationDetailScreen() {
  const router = useRouter();
  const { notificationId } = useLocalSearchParams<{ notificationId?: string }>();
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
  const [notification, setNotification] = useState<AccountNotification | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const relatedTarget = notification ? resolveNotificationTarget(notification) : null;

  const load = useCallback(async () => {
    if (!notificationId) {
      setNotification(null);
      setMessage("알림 주소를 확인해 주세요.");
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const tokens = await readAuthTokens();
      if (!tokens) {
        setNotification(null);
        setMessage("로그인하면 내 알림 상세를 확인할 수 있어요.");
        return;
      }
      const selected = await fetchAccountNotification(runtime.apiBaseUrl, tokens.accessToken, notificationId);
      setNotification(selected);
      setMessage("");
      if (!selected.readAt) {
        void markAccountNotificationRead(runtime.apiBaseUrl, tokens.accessToken, selected.id)
          .then(setNotification)
          .catch((error: unknown) => {
            console.warn(
              "DABBOBA notification read acknowledgement failed.",
              error instanceof Error ? error.message : error,
            );
          });
      }
    } catch (error) {
      setNotification(null);
      setMessage(error instanceof Error ? error.message : "알림 상세를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [notificationId, runtime.apiBaseUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/notifications");
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <DetailPageHeader title="알림 상세" titleMode="pixel" onBack={goBack} backLabel="알림함으로 돌아가기" />

      <ScrollView contentContainerStyle={styles.content}>
        {loading ? (
          <View style={styles.state}>
            <ActivityIndicator color={colors.ink} />
            <Text style={styles.stateBody}>알림 상세를 불러오는 중</Text>
          </View>
        ) : message || !notification ? (
          <View style={styles.state}>
            <DecorativeIonicon name="alert-circle-outline" size={34} color={colors.muted} />
            <Text style={styles.stateTitle}>{message || "알림을 찾을 수 없어요."}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void load()}
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
            >
              <Text style={styles.retryLabel}>다시 불러오기</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.detailCard}>
            <View style={styles.statusRow}>
              <View style={styles.kindIcon}>
                <DecorativeIonicon name={notificationIcon(notification.kind)} size={22} color={colors.ink} />
              </View>
              <View style={styles.statusCopy}>
                <Text style={styles.kindLabel}>{notificationKindLabel(notification.kind)}</Text>
                <Text style={styles.createdAt}>{formatDateTime(notification.createdAt)}</Text>
              </View>
              <Text style={[styles.statusBadge, !notification.readAt && styles.statusBadgeUnread]}>
                {notification.readAt ? "읽음" : "읽지 않음"}
              </Text>
            </View>

            <View style={styles.divider} />
            <Text style={styles.title}>{notification.title}</Text>
            <Text style={styles.body}>{notification.body}</Text>

            <View style={styles.metaCard}>
              <MetaRow label="받은 시각" value={formatDateTime(notification.createdAt)} />
              <MetaRow
                label="읽은 시각"
                value={notification.readAt ? formatDateTime(notification.readAt) : "아직 읽지 않음"}
                last
              />
            </View>
            {relatedTarget ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={relatedTarget.label}
                onPress={() => router.push(relatedTarget.href as Href)}
                style={({ pressed }) => [styles.relatedButton, pressed && styles.pressed]}
              >
                <View>
                  <Text style={styles.relatedCaption}>관련 화면 보기</Text>
                  <Text style={styles.relatedLabel}>{relatedTarget.label}</Text>
                </View>
                <DecorativeIonicon name="chevron-forward" size={19} color={colors.greenInk} />
              </Pressable>
            ) : null}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function MetaRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.metaRow, !last && styles.metaRowBorder]}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

function notificationKindLabel(kind: string): string {
  if (kind.includes("ORDER") || kind.includes("PAYMENT")) return "주문·결제";
  if (kind.includes("EXCHANGE")) return "교환";
  if (kind.includes("SHIPPING")) return "배송";
  if (kind.includes("STORAGE")) return "보관";
  if (kind.includes("INQUIRY")) return "문의";
  if (kind.includes("DRAW") || kind.includes("GACHA") || kind.includes("KUJI")) return "뽑기";
  return "서비스 알림";
}

function notificationIcon(kind: string): DecorativeIoniconName {
  if (kind.includes("ORDER") || kind.includes("PAYMENT")) return "receipt-outline";
  if (kind.includes("EXCHANGE")) return "swap-horizontal-outline";
  if (kind.includes("SHIPPING")) return "car-outline";
  if (kind.includes("STORAGE")) return "cube-outline";
  if (kind.includes("INQUIRY")) return "chatbubble-ellipses-outline";
  if (kind.includes("DRAW") || kind.includes("GACHA") || kind.includes("KUJI")) return "cube-outline";
  return "notifications-outline";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "시간 정보 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  content: {
    flexGrow: 1,
    paddingHorizontal: seed.spacing.globalGutter,
    paddingTop: seed.spacing.x4_5,
    paddingBottom: seed.spacing.screenBottom,
  },
  pressed: { opacity: seed.state.pressedOpacity, transform: [{ translateY: seed.state.pressedTranslateY }, { scale: seed.state.pressedScale }] },
  state: {
    minHeight: 420,
    paddingHorizontal: seed.spacing.x5,
    alignItems: "center",
    justifyContent: "center",
    gap: seed.spacing.x2_5,
  },
  stateTitle: { color: colors.ink, fontSize: 17, lineHeight: 24, fontWeight: "900", textAlign: "center" },
  stateBody: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: "center" },
  retryButton: {
    minHeight: seed.size.touchTarget,
    justifyContent: "center",
    paddingHorizontal: seed.spacing.x4,
    marginTop: seed.spacing.x2,
    borderRadius: seed.radius.r3,
    backgroundColor: colors.ink,
  },
  retryLabel: { color: colors.white, fontSize: 13, fontWeight: "800" },
  detailCard: {
    borderRadius: seed.radius.r5,
    borderWidth: 1,
    borderColor: seed.color.stroke.neutral,
    padding: seed.spacing.x4_5,
    backgroundColor: seed.color.layer.default,
  },
  statusRow: { minHeight: seed.size.touchTarget, flexDirection: "row", alignItems: "center", gap: seed.spacing.x3 },
  kindIcon: {
    width: seed.size.touchTarget,
    height: seed.size.touchTarget,
    borderRadius: seed.radius.r3,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: seed.color.background.brandWeak,
  },
  statusCopy: { flex: 1, minWidth: 0 },
  kindLabel: { color: colors.ink, fontSize: 13, lineHeight: 19, fontWeight: "800" },
  createdAt: { color: colors.muted, ...seed.typography.finePrint, marginTop: 2 },
  statusBadge: {
    overflow: "hidden",
    borderRadius: seed.radius.r2,
    paddingHorizontal: seed.spacing.x2_5,
    paddingVertical: seed.spacing.x1_5,
    color: colors.muted,
    backgroundColor: seed.color.background.neutralWeak,
    ...seed.typography.finePrint,
    fontWeight: "800",
  },
  statusBadgeUnread: { color: colors.greenInk, backgroundColor: seed.color.background.brandWeak },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: seed.spacing.x4, backgroundColor: seed.color.stroke.neutral },
  title: { color: seed.color.foreground.neutral, ...seed.typography.screenTitle },
  body: { color: colors.ink, fontSize: 15, lineHeight: 24, marginTop: seed.spacing.x3_5 },
  metaCard: {
    overflow: "hidden",
    marginTop: seed.spacing.x6,
    borderRadius: seed.radius.r4,
    backgroundColor: seed.color.background.neutralWeak,
  },
  metaRow: { minHeight: 54, paddingHorizontal: seed.spacing.x3_5, flexDirection: "row", alignItems: "center", gap: seed.spacing.x3 },
  metaRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral },
  metaLabel: { width: 64, color: colors.muted, fontSize: 11, lineHeight: 17, fontWeight: "700" },
  metaValue: { flex: 1, color: colors.ink, fontSize: 12, lineHeight: 18, textAlign: "right", fontWeight: "700" },
  relatedButton: {
    minHeight: 64,
    marginTop: seed.spacing.x4,
    borderRadius: seed.radius.r3,
    paddingHorizontal: seed.spacing.x4,
    backgroundColor: seed.color.background.brandWeak,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  relatedCaption: { color: colors.muted, ...seed.typography.finePrint },
  relatedLabel: { color: colors.ink, fontSize: 13, lineHeight: 19, fontWeight: "900", marginTop: 2 },
});
