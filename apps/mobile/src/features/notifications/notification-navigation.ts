import type { AccountNotification } from "@/features/notifications/notifications-api";

export type NotificationTarget = {
  href: string;
  label: string;
};

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;
const SAFE_NOTIFICATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The one identifier check shared by every notification route: a server
 * product, order, entry or similar ID (which includes UUIDs) must be a short
 * `[A-Za-z0-9_-]` token before it may become part of an in-app path.
 */
export function isSafeNotificationIdentifier(value: unknown): value is string {
  return typeof value === "string" && SAFE_IDENTIFIER.test(value);
}

const ROOT_TARGETS: Record<AccountNotification["destination"]["route"], NotificationTarget> = {
  home: { href: "/(tabs)", label: "홈으로 이동" },
  gacha: { href: "/(tabs)/gacha", label: "가챠샵 보기" },
  kuji: { href: "/(tabs)/kuji", label: "쿠지샵 보기" },
  storage: { href: "/(tabs)/storage", label: "보관함 보기" },
  profile: { href: "/(tabs)/profile", label: "내정보 보기" },
};

/**
 * Maps the server's finite destination contract to app-owned routes. Neither
 * notification copy nor arbitrary data fields are ever treated as a URL.
 */
export function resolveNotificationTarget(notification: AccountNotification): NotificationTarget {
  const { destination } = notification;
  const detail = destination.detail;
  if (!detail || !SAFE_IDENTIFIER.test(detail.id)) return ROOT_TARGETS[destination.route];

  if (detail.kind === "product") {
    return { href: `/product/${encodeURIComponent(detail.id)}`, label: "상품 상세 보기" };
  }
  if (detail.kind === "order") {
    return { href: `/profile/orders/${encodeURIComponent(detail.id)}`, label: "주문 상세 보기" };
  }
  if (detail.kind === "shipping") {
    return { href: `/profile/shipping/${encodeURIComponent(detail.id)}`, label: "배송 상세 보기" };
  }
  if (detail.kind === "inquiry") {
    return { href: `/profile/inquiries/${encodeURIComponent(detail.id)}`, label: "문의 답변 보기" };
  }
  if (detail.kind === "exchange") {
    return { href: `/exchange/${encodeURIComponent(detail.id)}`, label: "교환 상세 보기" };
  }
  if (detail.kind === "request") {
    return { href: `/profile/requests/${encodeURIComponent(detail.id)}`, label: "신청 결과 보기" };
  }
  return ROOT_TARGETS[destination.route];
}

/** A push tap always opens the authenticated notification detail first. */
export function resolveAccountNotificationResponsePath(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const payload = data as Record<string, unknown>;
  if (payload.kind !== "ACCOUNT_NOTIFICATION") return null;
  const notificationId = payload.notificationId;
  if (typeof notificationId !== "string" || !SAFE_NOTIFICATION_ID.test(notificationId)) return null;
  return `/notifications/${encodeURIComponent(notificationId)}`;
}
