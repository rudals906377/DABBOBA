import { Ionicons } from "@expo/vector-icons";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { components } from "@dabboba/contracts";
import { KoreanPixelTitle } from "@/components/RootCategoryTitle";
import { AppText as Text } from "@/components/Typography";
import { SeedInlineGuidance } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import {
  fetchAccountShippingRequestDetail,
  type AccountShippingRequest,
} from "@/features/profile/profile-detail-api";
import { categoryLabel, formatDate } from "@/features/profile/profile-api";
import { useProfileSnapshot } from "@/features/profile/use-profile-snapshot";
import { productSubjectTitle } from "@/features/shop/product-title";
import { colors } from "@/theme";

type AccountOrder = components["schemas"]["AccountOrder"];
type Notice = components["schemas"]["Notice"];

const ORDER_STATUS: Record<AccountOrder["status"], string> = {
  PENDING_PAYMENT: "결제 대기",
  PAID: "결제 완료",
  FULFILLED: "주문 완료",
  CANCELLED: "주문 취소",
  REFUND_REVIEW: "환불 검토",
  REFUNDED: "환불 완료",
};

const SHIPPING_STATUS: Record<AccountShippingRequest["status"], string> = {
  REQUESTED: "신청 완료",
  PROCESSING: "배송 준비",
  SHIPPED: "배송 중",
  DELIVERED: "배송 완료",
  CANCELLED: "신청 취소",
};

export function ProfileOrderDetailScreen() {
  const { orderId: rawOrderId } = useLocalSearchParams<{ orderId?: string | string[] }>();
  const orderId = singleParam(rawOrderId);
  const profileState = useProfileSnapshot();
  const snapshot = profileState.snapshot;
  const order = snapshot?.orders.find((item) => item.id === orderId) ?? null;

  return (
    <RecordFrame
      title="주문 상세"
      fallback="/profile/orders"
      refreshing={profileState.refreshing}
      onRefresh={profileState.reload}
    >
      {!snapshot && !profileState.message ? <LoadingState label="주문을 불러오는 중" /> : null}
      {!order && profileState.message ? (
        <ErrorState message={profileState.message} onRetry={profileState.reload} />
      ) : null}
      {snapshot && !order ? (
        <MissingState icon="receipt-outline" title="주문을 찾을 수 없어요" />
      ) : null}
      {order ? (
        <>
          {profileState.message ? <InlineMessage message={profileState.message} /> : null}
          {snapshot?.isExample ? <GuestPreview label="로그인 후 내 주문 내역을 확인할 수 있어요." /> : null}
          <OrderDetail order={order} profileState={profileState} />
        </>
      ) : null}
    </RecordFrame>
  );
}

export function ProfileShippingDetailScreen() {
  const { shippingRequestId: rawShippingRequestId } = useLocalSearchParams<{
    shippingRequestId?: string | string[];
  }>();
  const shippingRequestId = singleParam(rawShippingRequestId);
  const profileState = useProfileSnapshot();
  const [detail, setDetail] = useState<AccountShippingRequest | null>(null);
  const [detailMessage, setDetailMessage] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailRefreshing, setDetailRefreshing] = useState(false);
  const snapshotFallback = profileState.snapshot?.shippingRequests.find(
    (item) => item.id === shippingRequestId,
  ) ?? null;
  const shippingRequest = detail?.id === shippingRequestId ? detail : snapshotFallback;

  useEffect(() => {
    setDetailMessage("");
  }, [shippingRequestId]);

  const loadDetail = useCallback(async (manual = false) => {
    if (!profileState.accessToken || profileState.snapshot?.isExample || !shippingRequestId) {
      setDetailLoading(false);
      setDetailRefreshing(false);
      return;
    }

    if (manual) setDetailRefreshing(true);
    else if (!snapshotFallback) setDetailLoading(true);
    try {
      const next = await fetchAccountShippingRequestDetail(
        profileState.runtime.apiBaseUrl,
        profileState.accessToken,
        shippingRequestId,
      );
      setDetail(next);
      setDetailMessage("");
    } catch (error) {
      setDetailMessage(error instanceof Error ? error.message : "배송 신청 정보를 불러오지 못했습니다.");
    } finally {
      setDetailLoading(false);
      setDetailRefreshing(false);
    }
  }, [
    profileState.accessToken,
    profileState.runtime.apiBaseUrl,
    profileState.snapshot?.isExample,
    shippingRequestId,
    snapshotFallback,
  ]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const refresh = useCallback(() => {
    void profileState.reload();
    void loadDetail(true);
  }, [loadDetail, profileState]);

  const retry = useCallback(() => {
    void profileState.reload();
    void loadDetail();
  }, [loadDetail, profileState]);

  const combinedMessage = detailMessage || profileState.message;
  const initialLoading = !shippingRequest
    && !combinedMessage
    && (!profileState.snapshot || detailLoading);

  return (
    <RecordFrame
      title="배송 신청 상세"
      fallback="/profile/shipping"
      refreshing={profileState.refreshing || detailRefreshing}
      onRefresh={refresh}
    >
      {initialLoading ? <LoadingState label="배송 신청을 불러오는 중" /> : null}
      {!shippingRequest && combinedMessage ? (
        <ErrorState message={combinedMessage} onRetry={retry} />
      ) : null}
      {profileState.snapshot && !shippingRequest && !combinedMessage && !detailLoading ? (
        <MissingState icon="cube-outline" title="배송 신청을 찾을 수 없어요" />
      ) : null}
      {shippingRequest ? (
        <>
          {combinedMessage ? <InlineMessage message={combinedMessage} /> : null}
          {profileState.snapshot?.isExample ? (
            <GuestPreview label="로그인 후 내 배송 진행 상황을 확인할 수 있어요." />
          ) : null}
          <ShippingDetail shippingRequest={shippingRequest} />
        </>
      ) : null}
    </RecordFrame>
  );
}

export function ProfileNoticeDetailScreen() {
  const { noticeId: rawNoticeId } = useLocalSearchParams<{ noticeId?: string | string[] }>();
  const noticeId = singleParam(rawNoticeId);
  const profileState = useProfileSnapshot();
  const snapshot = profileState.snapshot;
  const notice = snapshot?.notices.find((item) => item.id === noticeId) ?? null;

  return (
    <RecordFrame
      title="공지사항"
      fallback="/profile/notices"
      refreshing={profileState.refreshing}
      onRefresh={profileState.reload}
    >
      {!snapshot && !profileState.message ? <LoadingState label="공지사항을 불러오는 중" /> : null}
      {!notice && profileState.message ? (
        <ErrorState message={profileState.message} onRetry={profileState.reload} />
      ) : null}
      {snapshot && !notice ? (
        <MissingState icon="megaphone-outline" title="공지사항을 찾을 수 없어요" />
      ) : null}
      {notice ? (
        <>
          {profileState.message ? <InlineMessage message={profileState.message} /> : null}
          <NoticeDetail notice={notice} />
        </>
      ) : null}
    </RecordFrame>
  );
}

function RecordFrame({
  title,
  fallback,
  refreshing,
  onRefresh,
  children,
}: {
  title: string;
  fallback: Href;
  refreshing: boolean;
  onRefresh: () => void;
  children: ReactNode;
}) {
  const router = useRouter();
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace(fallback);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="뒤로 가기"
          hitSlop={10}
          onPress={goBack}
          style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={26} color={colors.ink} />
        </Pressable>
        <View style={styles.headerTitle}>
          <KoreanPixelTitle variant="header">{title}</KoreanPixelTitle>
        </View>
        <View style={styles.headerAction} />
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={(
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.ink} />
        )}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

function OrderDetail({
  order,
  profileState,
}: {
  order: AccountOrder;
  profileState: ReturnType<typeof useProfileSnapshot>;
}) {
  const snapshot = profileState.snapshot!;
  return (
    <>
      <StatusCard
        icon="receipt-outline"
        status={ORDER_STATUS[order.status]}
        title={`${order.lines.length.toLocaleString("ko-KR")}개 상품`}
        body={`${formatDate(order.createdAt)} 주문`}
        critical={order.status === "CANCELLED" || order.status === "REFUNDED"}
      />

      <Section title="주문 상품">
        {order.lines.map((line, index) => {
          const catalogProduct = snapshot.catalogProducts.find((product) => product.id === line.productId);
          const ipName = catalogProduct
            ? snapshot.ipNames[catalogProduct.ipId] ?? "등록 작품"
            : "등록 작품";
          return (
            <View
              key={`${line.productId}-${index}`}
              style={[styles.orderLineCard, index > 0 && styles.dividerTop]}
            >
              <Text style={styles.eyebrow}>{ipName}</Text>
              <Text style={styles.productName}>{productSubjectTitle(line.productName, ipName)}</Text>
              <View style={styles.productMetaRow}>
                <Text style={styles.productMeta}>
                  {categoryLabel(line.category)} · {formatWon(line.unitPrice)} × {line.quantity.toLocaleString("ko-KR")}
                </Text>
                <Text style={styles.lineTotal}>{formatWon(line.lineTotal)}</Text>
              </View>
            </View>
          );
        })}
      </Section>

      <Section title="결제 금액">
        <InfoRow label="상품 금액" value={formatWon(order.subtotal)} />
        <InfoRow label="할인" value={formatDeduction(order.discountTotal)} />
        <InfoRow label="포인트 사용" value={formatDeduction(order.pointTotal)} />
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>총 결제 금액</Text>
          <Text style={styles.totalValue}>{formatWon(order.total)}</Text>
        </View>
      </Section>

      <Section title="주문 정보">
        <InfoRow label="주문일" value={formatDate(order.createdAt)} />
        <InfoRow label="최근 처리일" value={formatDate(order.updatedAt)} />
        <InfoRow label="주문 번호" value={order.id} selectable />
      </Section>
    </>
  );
}

function ShippingDetail({ shippingRequest }: { shippingRequest: AccountShippingRequest }) {
  const destination = shippingRequest.destination;
  const critical = shippingRequest.status === "CANCELLED";
  return (
    <>
      <StatusCard
        icon="cube-outline"
        status={SHIPPING_STATUS[shippingRequest.status]}
        title={`보관 상품 ${shippingRequest.inventoryUnitIds.length.toLocaleString("ko-KR")}개`}
        body={`${formatDate(shippingRequest.requestedAt)} 신청`}
        critical={critical}
      />

      <Section title="받는 곳">
        <InfoRow label="받는 분" value={destination.recipientMasked} />
        <InfoRow label="연락처" value={destination.phoneMasked} />
        <View style={styles.addressBlock}>
          <Text style={styles.infoLabel}>주소</Text>
          <Text style={styles.addressText}>
            [{destination.postalCode}] {destination.addressLine1}
            {destination.addressLine2 ? `\n${destination.addressLine2}` : ""}
          </Text>
        </View>
      </Section>

      <Section title="배송 정보">
        <InfoRow label="택배사" value={shippingRequest.trackingCarrier ?? "등록 전"} />
        <InfoRow
          label="운송장 번호"
          value={shippingRequest.trackingNumber ?? "등록 전"}
          selectable={Boolean(shippingRequest.trackingNumber)}
        />
        <InfoRow label="신청일" value={formatDate(shippingRequest.requestedAt)} />
        <InfoRow label="최근 처리일" value={formatDate(shippingRequest.updatedAt)} />
        {shippingRequest.shippedAt ? (
          <InfoRow label="발송일" value={formatDate(shippingRequest.shippedAt)} />
        ) : null}
        <InfoRow label="배송 신청 번호" value={shippingRequest.id} selectable />
      </Section>
    </>
  );
}

function NoticeDetail({ notice }: { notice: Notice }) {
  const publishedAt = notice.publishedAt ?? notice.createdAt;
  return (
    <View style={styles.noticeCard}>
      <View style={styles.noticeMeta}>
        {notice.isPinned ? <Text style={styles.pinBadge}>중요</Text> : null}
        <Text style={styles.noticeDate}>{formatDate(publishedAt)}</Text>
      </View>
      <Text style={styles.noticeTitle}>{notice.title}</Text>
      <View style={styles.noticeDivider} />
      <Text selectable style={styles.noticeContent}>{notice.content}</Text>
      <View style={styles.noticeFooter}>
        <Text style={styles.noticeUpdated}>최근 수정 {formatDate(notice.updatedAt)}</Text>
      </View>
    </View>
  );
}

function StatusCard({
  icon,
  status,
  title,
  body,
  critical = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  status: string;
  title: string;
  body: string;
  critical?: boolean;
}) {
  return (
    <View style={styles.statusCard}>
      <View style={[styles.statusIcon, critical && styles.statusIconCritical]}>
        <Ionicons name={icon} size={24} color={critical ? colors.danger : colors.greenInk} />
      </View>
      <View style={styles.statusText}>
        <Text style={[styles.statusBadge, critical && styles.statusBadgeCritical]}>{status}</Text>
        <Text style={styles.statusTitle}>{title}</Text>
        <Text style={styles.statusBody}>{body}</Text>
      </View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <KoreanPixelTitle variant="compact" style={styles.sectionTitle}>{title}</KoreanPixelTitle>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function InfoRow({
  label,
  value,
  selectable = false,
}: {
  label: string;
  value: string;
  selectable?: boolean;
}) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text selectable={selectable} style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function GuestPreview({ label }: { label: string }) {
  return <SeedInlineGuidance style={styles.guestGuidance}>{label}</SeedInlineGuidance>;
}

function InlineMessage({ message }: { message: string }) {
  return (
    <View style={styles.inlineMessage}>
      <Ionicons name="cloud-offline-outline" size={17} color={colors.muted} />
      <Text style={styles.inlineMessageText}>{message}</Text>
    </View>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <View style={styles.state}>
      <ActivityIndicator color={colors.ink} />
      <Text style={styles.stateBody}>{label}</Text>
    </View>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.state}>
      <Ionicons name="alert-circle-outline" size={34} color={colors.muted} />
      <Text style={styles.stateTitle}>정보를 불러오지 못했어요</Text>
      <Text style={styles.stateBody}>{message}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
      >
        <Text style={styles.retryLabel}>다시 불러오기</Text>
      </Pressable>
    </View>
  );
}

function MissingState({
  icon,
  title,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
}) {
  return (
    <View style={styles.state}>
      <View style={styles.missingIcon}>
        <Ionicons name={icon} size={29} color={colors.muted} />
      </View>
      <Text style={styles.stateTitle}>{title}</Text>
    </View>
  );
}

function singleParam(value?: string | string[]): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function formatWon(value: number): string {
  return `${value.toLocaleString("ko-KR")}원`;
}

function formatDeduction(value: number): string {
  return value > 0 ? `-${formatWon(value)}` : "0원";
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: seed.color.layer.basement,
  },
  header: {
    minHeight: seed.size.topNavigation,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: seed.color.stroke.neutral,
    backgroundColor: seed.color.layer.default,
  },
  headerAction: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    alignItems: "center",
  },
  content: {
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    paddingHorizontal: seed.spacing.globalGutter,
    paddingTop: seed.spacing.x4_5,
    paddingBottom: seed.spacing.screenBottom,
  },
  pressed: { opacity: seed.state.pressedOpacity },
  guestGuidance: { marginBottom: seed.spacing.x3 },
  inlineMessage: {
    minHeight: seed.size.actionButton.medium,
    flexDirection: "row",
    alignItems: "center",
    gap: seed.spacing.x2,
    borderRadius: seed.radius.r3,
    paddingHorizontal: seed.spacing.x3_5,
    marginBottom: seed.spacing.x3,
    backgroundColor: seed.color.background.neutralWeak,
  },
  inlineMessageText: {
    flex: 1,
    color: colors.muted,
    fontSize: 11,
    lineHeight: 17,
  },
  statusCard: {
    minHeight: 116,
    flexDirection: "row",
    alignItems: "center",
    gap: seed.spacing.x3_5,
    borderRadius: seed.radius.r5,
    borderWidth: 1,
    borderColor: seed.color.stroke.neutral,
    padding: seed.spacing.x4,
    backgroundColor: seed.color.layer.default,
  },
  statusIcon: {
    width: 50,
    height: 50,
    borderRadius: seed.radius.r4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: seed.color.background.brandWeak,
  },
  statusIconCritical: { backgroundColor: seed.color.background.criticalWeak },
  statusText: { flex: 1, minWidth: 0 },
  statusBadge: {
    alignSelf: "flex-start",
    overflow: "hidden",
    borderRadius: seed.radius.r2,
    paddingHorizontal: seed.spacing.x2,
    paddingVertical: seed.spacing.x1,
    color: colors.greenInk,
    backgroundColor: seed.color.background.brandWeak,
    fontSize: 10,
    fontWeight: "800",
  },
  statusBadgeCritical: {
    color: colors.danger,
    backgroundColor: seed.color.background.criticalWeak,
  },
  statusTitle: {
    color: colors.ink,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "900",
    marginTop: seed.spacing.x2,
  },
  statusBody: {
    color: colors.muted,
    fontSize: 11,
    marginTop: seed.spacing.x1,
  },
  section: {
    marginTop: seed.spacing.x4,
  },
  sectionTitle: {
    marginBottom: seed.spacing.x2_5,
  },
  sectionBody: {
    overflow: "hidden",
    borderRadius: seed.radius.r4,
    borderWidth: 1,
    borderColor: seed.color.stroke.neutral,
    backgroundColor: seed.color.layer.default,
  },
  orderLineCard: {
    padding: seed.spacing.x4,
  },
  dividerTop: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: seed.color.stroke.neutral,
  },
  eyebrow: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 17,
  },
  productName: {
    color: colors.ink,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: "900",
    marginTop: seed.spacing.x1,
  },
  productMetaRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: seed.spacing.x3,
    marginTop: seed.spacing.x3,
  },
  productMeta: {
    flex: 1,
    color: colors.muted,
    fontSize: 10,
    lineHeight: 16,
  },
  lineTotal: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "900",
  },
  infoRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: seed.spacing.x3,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: seed.color.stroke.neutral,
    paddingHorizontal: seed.spacing.x4,
    paddingVertical: seed.spacing.x3,
  },
  infoLabel: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 17,
  },
  infoValue: {
    flexShrink: 1,
    maxWidth: "66%",
    color: colors.ink,
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "700",
    textAlign: "right",
  },
  totalRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: seed.spacing.x3,
    paddingHorizontal: seed.spacing.x4,
  },
  totalLabel: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "900",
  },
  totalValue: {
    color: colors.ink,
    fontSize: 19,
    fontWeight: "900",
  },
  addressBlock: {
    padding: seed.spacing.x4,
  },
  addressText: {
    color: colors.ink,
    fontSize: 12,
    lineHeight: 20,
    fontWeight: "700",
    marginTop: seed.spacing.x2,
  },
  noticeCard: {
    borderRadius: seed.radius.r5,
    borderWidth: 1,
    borderColor: seed.color.stroke.neutral,
    padding: seed.spacing.x4_5,
    backgroundColor: seed.color.layer.default,
  },
  noticeMeta: {
    minHeight: 26,
    flexDirection: "row",
    alignItems: "center",
    gap: seed.spacing.x2,
  },
  pinBadge: {
    overflow: "hidden",
    borderRadius: seed.radius.r2,
    paddingHorizontal: seed.spacing.x2,
    paddingVertical: seed.spacing.x1,
    color: colors.greenInk,
    backgroundColor: seed.color.background.brandWeak,
    fontSize: 10,
    fontWeight: "800",
  },
  noticeDate: {
    color: colors.muted,
    fontSize: 10,
  },
  noticeTitle: {
    color: colors.ink,
    fontSize: 22,
    lineHeight: 31,
    fontWeight: "900",
    marginTop: seed.spacing.x3,
  },
  noticeDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: seed.spacing.x4,
    backgroundColor: seed.color.stroke.neutral,
  },
  noticeContent: {
    color: colors.ink,
    ...seed.typography.articleBody,
  },
  noticeFooter: {
    alignItems: "flex-end",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: seed.color.stroke.neutral,
    marginTop: seed.spacing.x6,
    paddingTop: seed.spacing.x3,
  },
  noticeUpdated: {
    color: colors.muted,
    fontSize: 10,
  },
  state: {
    minHeight: 420,
    alignItems: "center",
    justifyContent: "center",
    gap: seed.spacing.x2,
    paddingHorizontal: seed.spacing.x5,
  },
  missingIcon: {
    width: 58,
    height: 58,
    borderRadius: seed.radius.r5,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: seed.spacing.x2,
    backgroundColor: seed.color.background.neutralWeak,
  },
  stateTitle: {
    color: colors.ink,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: "900",
    textAlign: "center",
  },
  stateBody: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 18,
    textAlign: "center",
  },
  retryButton: {
    minHeight: seed.size.actionButton.medium,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: seed.radius.r3,
    paddingHorizontal: seed.spacing.x5,
    marginTop: seed.spacing.x3,
    backgroundColor: seed.color.background.brandSolid,
  },
  retryLabel: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "900",
  },
});
