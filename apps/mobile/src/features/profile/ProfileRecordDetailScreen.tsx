import { type Href, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { components } from "@dabboba/contracts";
import { DecorativeIonicon, type DecorativeIoniconName } from "@/components/DecorativeIonicon";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { KoreanPixelTitle } from "@/components/RootCategoryTitle";
import { AppText as Text } from "@/components/Typography";
import { SeedInlineGuidance } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import { DemoPaymentControls } from "@/features/demo/DemoPaymentControls";
import {
  fetchAccountShippingRequestDetail,
  type AccountShippingRequestDetail,
} from "@/features/profile/profile-detail-api";
import { categoryLabel, formatDate, ProfileApiError } from "@/features/profile/profile-api";
import { profileSectionFailure } from "@/features/profile/profile-section-state";
import { useProfileSnapshot } from "@/features/profile/use-profile-snapshot";
import { ProfileSessionGate, isProfileSessionBlocked } from "@/features/profile/ProfileSessionGate";
import { productSubjectTitle } from "@/features/shop/product-title";
import { resolveCatalogImageUrl } from "@/lib/runtime-config";
import { readAuthTokens } from "@/lib/session-store";
import { colors } from "@/theme";

type AccountOrder = components["schemas"]["AccountOrder"];
type AccountShippingRequest = components["schemas"]["AccountShippingRequest"];
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
  PAYMENT_PENDING: "배송비 결제 대기",
  REQUESTED: "신청 완료",
  PROCESSING: "배송 준비",
  SHIPPED: "배송 중",
  DELIVERED: "배송 완료",
  CANCELLED: "신청 취소",
};

export function ProfileOrderDetailScreen() {
  const { orderId: rawOrderId } = useLocalSearchParams<{
    orderId?: string | string[];
  }>();
  const orderId = singleParam(rawOrderId);
  const profileState = useProfileSnapshot();
  const snapshot = profileState.snapshot;
  const order = snapshot?.orders?.find((item) => item.id === orderId) ?? null;
  const ordersFailure = snapshot ? profileSectionFailure(snapshot, "orders") : null;
  const blockedStatus = isProfileSessionBlocked(profileState.status) ? profileState.status : null;

  return (
    <RecordFrame
      title="주문 상세"
      fallback="/profile/orders"
      refreshing={profileState.refreshing}
      onRefresh={profileState.reload}
    >
      {blockedStatus ? <ProfileSessionGate status={blockedStatus} returnTo={`/profile/orders/${encodeURIComponent(orderId)}`} guestBody="로그인하면 내 주문 상세를 확인할 수 있어요." /> : <>
      {!snapshot && !profileState.message ? <LoadingState label="주문을 불러오는 중" /> : null}
      {!order && (profileState.message || ordersFailure) ? (
        <ErrorState message={profileState.message || ordersFailure || ""} onRetry={profileState.reload} />
      ) : null}
      {snapshot && !order && !ordersFailure ? (
        <MissingState icon="receipt-outline" title="주문을 찾을 수 없어요" />
      ) : null}
      {order ? (
        <>
          {profileState.message ? <InlineMessage message={profileState.message} /> : null}
          {snapshot?.isExample ? <GuestPreview label="로그인 후 내 주문 내역을 확인할 수 있어요." /> : null}
          <OrderDetail
            order={order}
            profileState={profileState}
          />
        </>
      ) : null}
      </>}
    </RecordFrame>
  );
}

export function ProfileShippingDetailScreen() {
  const { shippingRequestId: rawShippingRequestId } = useLocalSearchParams<{
    shippingRequestId?: string | string[];
  }>();
  const shippingRequestId = singleParam(rawShippingRequestId);
  const profileState = useProfileSnapshot();
  const [detail, setDetail] = useState<AccountShippingRequestDetail | null>(null);
  const [detailMessage, setDetailMessage] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailRefreshing, setDetailRefreshing] = useState(false);
  const [detailExpired, setDetailExpired] = useState(false);
  const detailGeneration = useRef(0);
  const hasFocusedOnce = useRef(false);
  const snapshotFallback = profileState.status === "authenticated"
    ? profileState.snapshot?.shippingRequests?.find((item) => item.id === shippingRequestId) ?? null
    : null;
  const shippingRequest = profileState.status === "authenticated"
    ? (detail?.id === shippingRequestId ? detail : snapshotFallback)
    : null;
  const assetBaseUrl = profileState.runtime.assetBaseUrl
    ?? (__DEV__ ? profileState.runtime.apiBaseUrl.replace(/:8788$/, ":4174") : null);
  const blockedStatus = detailExpired
    ? "expired"
    : isProfileSessionBlocked(profileState.status) ? profileState.status : null;

  useEffect(() => {
    detailGeneration.current += 1;
    setDetail(null);
    setDetailMessage("");
    setDetailExpired(false);
  }, [profileState.accessToken, profileState.status, shippingRequestId]);

  useFocusEffect(useCallback(() => {
    if (hasFocusedOnce.current) void profileState.reload();
    else hasFocusedOnce.current = true;
    return () => {
      detailGeneration.current += 1;
    };
  }, [profileState.reload]));

  const loadDetail = useCallback(async (manual = false) => {
    const generation = ++detailGeneration.current;
    const requestedAccessToken = profileState.accessToken;
    if (
      profileState.status !== "authenticated"
      || !requestedAccessToken
      || !shippingRequestId
    ) {
      setDetail(null);
      setDetailLoading(false);
      setDetailRefreshing(false);
      return;
    }

    if (manual) setDetailRefreshing(true);
    else if (!snapshotFallback) setDetailLoading(true);
    try {
      const next = await fetchAccountShippingRequestDetail(
        profileState.runtime.apiBaseUrl,
        requestedAccessToken,
        shippingRequestId,
      );
      const currentTokens = await readAuthTokens();
      if (generation !== detailGeneration.current) return;
      if (currentTokens?.accessToken !== requestedAccessToken) {
        setDetail(null);
        void profileState.reload();
        return;
      }
      setDetail(next);
      setDetailMessage("");
      setDetailExpired(false);
    } catch (error) {
      if (generation !== detailGeneration.current) return;
      setDetail(null);
      if (error instanceof ProfileApiError && error.status === 401) {
        setDetailExpired(true);
        setDetailMessage("");
        return;
      }
      setDetailMessage(error instanceof Error ? error.message : "배송 신청 정보를 불러오지 못했습니다.");
    } finally {
      if (generation === detailGeneration.current) {
        setDetailLoading(false);
        setDetailRefreshing(false);
      }
    }
  }, [
    profileState.accessToken,
    profileState.reload,
    profileState.runtime.apiBaseUrl,
    profileState.status,
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
      {blockedStatus ? <ProfileSessionGate status={blockedStatus} returnTo={`/profile/shipping/${encodeURIComponent(shippingRequestId)}`} guestBody="로그인하면 내 배송 신청 상세를 확인할 수 있어요." /> : <>
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
          <ShippingDetail shippingRequest={shippingRequest} assetBaseUrl={assetBaseUrl} />
        </>
      ) : null}
      </>}
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
      {profileState.publicLoading || (!snapshot && !profileState.message) ? (
        <LoadingState label="공지사항을 불러오는 중" />
      ) : null}
      {!notice && profileState.message ? (
        <ErrorState message={profileState.message} onRetry={profileState.reload} />
      ) : null}
      {snapshot && !notice && !profileState.message && !profileState.publicLoading ? (
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
      <DetailPageHeader title={title} titleMode="pixel" onBack={goBack} />
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
  const router = useRouter();
  const snapshot = profileState.snapshot!;
  return (
    <>
      <StatusCard
        icon={order.orderKind === "SHIPPING_FEE" ? "car-outline" : "receipt-outline"}
        status={ORDER_STATUS[order.status]}
        title={order.orderKind === "SHIPPING_FEE" ? "보관함 배송비" : `${order.lines.length.toLocaleString("ko-KR")}개 상품`}
        body={`${formatDate(order.createdAt)} ${order.orderKind === "SHIPPING_FEE" ? "배송 신청" : "주문"}`}
        tone={orderStatusTone(order.status)}
      />

      {!snapshot.isExample && order.orderKind === "PRODUCT" ? (
        <DemoPaymentControls
          surface="internal-commerce"
          apiBaseUrl={profileState.runtime.apiBaseUrl}
          orderId={order.id}
          orderStatus={order.status}
          onOrderChanged={() => profileState.reload()}
        />
      ) : null}

      {order.orderKind === "PRODUCT" ? <Section title="주문 상품">
        {order.lines.map((line, index) => {
          const catalogProduct = snapshot.catalogProducts.find((product) => product.id === line.productId);
          const ipName = catalogProduct
            ? snapshot.ipNames[catalogProduct.ipId] ?? "작품 정보 없음"
            : "작품 정보 없음";
          const content = (
            <>
              <Text style={styles.eyebrow}>{ipName}</Text>
              <Text style={styles.productName}>{productSubjectTitle(line.productName, ipName)}</Text>
              <View style={styles.productMetaRow}>
                <Text style={styles.productMeta}>
                  {categoryLabel(line.category)} · {formatWon(line.unitPrice)} × {line.quantity.toLocaleString("ko-KR")}
                </Text>
                <Text style={styles.lineTotal}>{formatWon(line.lineTotal)}</Text>
              </View>
              {catalogProduct ? (
                <View style={styles.productDetailHint}>
                  <Text style={styles.productDetailHintLabel}>상품 상세</Text>
                  <DecorativeIonicon name="chevron-forward" size={14} color={colors.muted} />
                </View>
              ) : null}
            </>
          );
          return catalogProduct ? (
            <Pressable
              key={`${line.productId}-${index}`}
              accessibilityRole="button"
              accessibilityLabel={`${line.productName} 상품 상세 보기`}
              onPress={() => router.push(`/product/${encodeURIComponent(line.productId)}` as Href)}
              style={({ pressed }) => [styles.orderLineCard, index > 0 && styles.dividerTop, pressed && styles.pressed]}
            >
              {content}
            </Pressable>
          ) : (
            <View key={`${line.productId}-${index}`} style={[styles.orderLineCard, index > 0 && styles.dividerTop]}>
              {content}
            </View>
          );
        })}
      </Section> : null}

      <Section title="결제 금액">
        <InfoRow label={order.orderKind === "SHIPPING_FEE" ? "배송비" : "상품 금액"} value={formatWon(order.subtotal)} />
        {order.orderKind === "PRODUCT" ? <InfoRow label="할인" value={formatDeduction(order.discountTotal)} /> : null}
        {order.orderKind === "PRODUCT" ? <InfoRow label="포인트 사용" value={formatDeduction(order.pointTotal)} /> : null}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>총 결제 금액</Text>
          <Text style={styles.totalValue}>{formatWon(order.total)}</Text>
        </View>
      </Section>

      <Section title={order.orderKind === "SHIPPING_FEE" ? "배송비 결제 정보" : "주문 정보"}>
        <InfoRow label={order.orderKind === "SHIPPING_FEE" ? "결제 요청일" : "주문일"} value={formatDate(order.createdAt)} />
        <InfoRow label="최근 처리일" value={formatDate(order.updatedAt)} />
        <InfoRow label="주문 번호" value={order.id} selectable />
      </Section>
    </>
  );
}

function ShippingDetail({
  shippingRequest,
  assetBaseUrl,
}: {
  shippingRequest: AccountShippingRequest | AccountShippingRequestDetail;
  assetBaseUrl: string | null;
}) {
  const router = useRouter();
  const destination = shippingRequest.destination;
  const destinationAddress = fullShippingDestination(
    destination.postalCode,
    destination.addressLine1,
    destination.addressLine2,
  );
  return (
    <>
      <StatusCard
        icon="cube-outline"
        status={SHIPPING_STATUS[shippingRequest.status]}
        title={`보관 상품 ${shippingRequest.inventoryUnitIds.length.toLocaleString("ko-KR")}개`}
        body={`${formatDate(shippingRequest.requestedAt)} 신청`}
        tone={shippingRequest.status === "CANCELLED"
          ? "critical"
          : shippingRequest.status === "DELIVERED"
            ? "success"
            : "neutral"}
      />

      {"items" in shippingRequest ? (
        <Section title="배송 상품">
          {shippingRequest.items.map((item, index) => {
            const imageUri = resolveCatalogImageUrl(item.imageUrl, assetBaseUrl, item.productVersion);
            const media = (
              <View style={styles.shippingProductImageFrame}>
                {imageUri ? (
                  <Image source={{ uri: imageUri }} resizeMode={item.category === "kuji" ? "contain" : "cover"} style={styles.shippingProductImage} />
                ) : (
                  <DecorativeIonicon name="image-outline" size={24} color={colors.muted} />
                )}
              </View>
            );
            return (
              <Pressable
                key={item.inventoryUnitId}
                accessibilityRole="button"
                accessibilityLabel={`${item.productName} 상품 상세 보기`}
                onPress={() => router.push(`/product/${encodeURIComponent(item.productId)}` as Href)}
                style={({ pressed }) => [styles.shippingProductRow, index > 0 && styles.dividerTop, pressed && styles.pressed]}
              >
                {media}
                <View style={styles.shippingProductCopy}>
                  <Text numberOfLines={1} style={styles.eyebrow}>{item.ipNameKo} · {categoryLabel(item.category)}</Text>
                  <Text numberOfLines={2} style={styles.shippingProductName}>{productSubjectTitle(item.productName, item.ipNameKo)}</Text>
                </View>
                <DecorativeIonicon name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            );
          })}
        </Section>
      ) : null}

      <Section title="받는 곳">
        <InfoRow label="받는 분" value={destination.recipientMasked} />
        <InfoRow label="연락처" value={destination.phoneMasked} />
        <View style={styles.addressBlock}>
          <Text style={styles.infoLabel}>주소</Text>
          <Text style={styles.addressText}>{destinationAddress}</Text>
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
  tone = "neutral",
}: {
  icon: DecorativeIoniconName;
  status: string;
  title: string;
  body: string;
  tone?: "success" | "critical" | "refund" | "neutral";
}) {
  const critical = tone === "critical";
  const refund = tone === "refund";
  const success = tone === "success";
  return (
    <View style={styles.statusCard}>
      <View style={[styles.statusIcon, success && styles.statusIconSuccess, critical && styles.statusIconCritical, refund && styles.statusIconRefund]}>
        <DecorativeIonicon name={icon} size={24} color={critical ? colors.danger : refund ? "#4C5FA8" : success ? colors.greenInk : colors.muted} />
      </View>
      <View style={styles.statusText}>
        <Text style={[styles.statusBadge, success && styles.statusBadgeSuccess, critical && styles.statusBadgeCritical, refund && styles.statusBadgeRefund]}>{status}</Text>
        <Text style={styles.statusTitle}>{title}</Text>
        <Text style={styles.statusBody}>{body}</Text>
      </View>
    </View>
  );
}

function orderStatusTone(status: AccountOrder["status"]): "success" | "critical" | "refund" | "neutral" {
  if (status === "PAID" || status === "FULFILLED") return "success";
  if (status === "CANCELLED") return "critical";
  if (status === "REFUND_REVIEW" || status === "REFUNDED") return "refund";
  return "neutral";
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
      <DecorativeIonicon name="cloud-offline-outline" size={17} color={colors.muted} />
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
      <DecorativeIonicon name="alert-circle-outline" size={34} color={colors.muted} />
      <Text style={styles.stateTitle}>정보를 불러오지 못했어요</Text>
      <Text style={styles.stateBody}>{message}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="정보 다시 불러오기"
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
  icon: DecorativeIoniconName;
  title: string;
}) {
  return (
    <View style={styles.state}>
      <View style={styles.missingIcon}>
        <DecorativeIonicon name={icon} size={29} color={colors.muted} />
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

function fullShippingDestination(
  postalCode: string,
  addressLine1: string,
  addressLine2?: string | null,
): string {
  const primary = addressLine1.trim().replace(/\s+/g, " ");
  if (!primary || /(?:테스트(?:\s*전용)?\s*주소|배송\s*금지|demo)/i.test(primary)) {
    return "배송지 정보를 확인해 주세요.";
  }
  const secondary = addressLine2?.trim().replace(/\s+/g, " ");
  return `[${postalCode}] ${primary}${secondary ? `\n${secondary}` : ""}`;
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
  pressed: { opacity: seed.state.pressedOpacity, transform: [{ scale: seed.state.pressedScale }] },
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
    backgroundColor: seed.color.background.neutralWeak,
  },
  statusIconSuccess: { backgroundColor: seed.color.background.brandWeak },
  statusIconCritical: { backgroundColor: seed.color.background.criticalWeak },
  statusIconRefund: { backgroundColor: "#EEF0FA" },
  statusText: { flex: 1, minWidth: 0 },
  statusBadge: {
    alignSelf: "flex-start",
    overflow: "hidden",
    borderRadius: seed.radius.r2,
    paddingHorizontal: seed.spacing.x2,
    paddingVertical: seed.spacing.x1,
    color: colors.muted,
    backgroundColor: seed.color.background.neutralWeak,
    ...seed.typography.finePrint,
    fontWeight: "800",
  },
  statusBadgeSuccess: { color: colors.greenInk, backgroundColor: seed.color.background.brandWeak },
  statusBadgeCritical: {
    color: colors.danger,
    backgroundColor: seed.color.background.criticalWeak,
  },
  statusBadgeRefund: { color: "#4C5FA8", backgroundColor: "#EEF0FA" },
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
    ...seed.typography.catalogMetadata,
  },
  productName: {
    color: colors.ink,
    ...seed.typography.catalogTitle,
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
  productMeta: { flex: 1, color: colors.muted, ...seed.typography.finePrint },
  lineTotal: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "900",
  },
  productDetailHint: { flexDirection: "row", alignItems: "center", gap: seed.spacing.x1, marginTop: seed.spacing.x2 },
  productDetailHintLabel: { color: colors.muted, ...seed.typography.finePrint, fontWeight: "800" },
  shippingProductRow: { minHeight: 96, flexDirection: "row", alignItems: "center", gap: seed.spacing.x3, padding: seed.spacing.x3 },
  shippingProductImageFrame: { width: 72, height: 72, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: seed.color.layer.basement },
  shippingProductImage: { width: "100%", height: "100%" },
  shippingProductCopy: { flex: 1, minWidth: 0 },
  shippingProductName: { color: colors.ink, ...seed.typography.catalogTitle, fontWeight: "900", marginTop: seed.spacing.x1 },
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
    ...seed.typography.finePrint,
    fontWeight: "800",
  },
  noticeDate: { color: colors.muted, ...seed.typography.finePrint },
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
  noticeUpdated: { color: colors.muted, ...seed.typography.finePrint },
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
