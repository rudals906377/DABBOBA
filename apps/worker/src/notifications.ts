import type { DatabaseClient, DatabasePool } from "@dabboba/db";
import { withTransaction } from "@dabboba/db";
import type { Logger } from "./logger.js";
import type { OutboxEvent } from "./types.js";

type NotificationTemplate = { kind: string; title: string; body: string };

export type Notification = NotificationTemplate & {
  id: string;
  userId: string;
  data: Record<string, unknown>;
  createdAt: string;
};

export type NotificationDelivery = {
  deliver(notification: Notification): Promise<void>;
};

type NotificationRow = {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  created_at: Date;
};

type ExternalPreferenceRow = {
  exchange_updates: boolean;
  request_updates: boolean;
  restock_updates: boolean;
  marketing_sms: boolean;
  marketing_email: boolean;
  marketing_push: boolean;
  personalized_recommendations: boolean;
};

type ExternalPreferenceKey = keyof ExternalPreferenceRow;

function stringPayload(event: OutboxEvent, key: string): string | null {
  const value = event.payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function notificationTemplate(event: OutboxEvent): NotificationTemplate | null {
  switch (event.eventType) {
    case "order.paid":
      return { kind: "ORDER_PAID", title: "결제가 완료됐어요", body: "구매 내역에서 주문 상태를 확인해 주세요." };
    case "order.cancelled":
      return { kind: "ORDER_CANCELLED", title: "주문이 취소됐어요", body: "예약된 재고와 사용한 혜택이 복구됐습니다." };
    case "order.refunded":
      return { kind: "ORDER_REFUNDED", title: "환불이 완료됐어요", body: "구매 내역에서 환불 결과를 확인해 주세요." };
    case "draw.committed":
      return { kind: "DRAW_RESULT", title: "뽑기 결과가 보관됐어요", body: "보관함에서 획득한 상품을 확인해 주세요." };
    case "shipping.requested":
      return { kind: "SHIPPING_REQUESTED", title: "배송 신청이 접수됐어요", body: "배송 신청 내역에서 진행 상태를 확인해 주세요." };
    case "shipping.processing":
      return { kind: "SHIPPING_PROCESSING", title: "상품을 포장하고 있어요", body: "배송 신청 내역에서 진행 상태를 확인해 주세요." };
    case "shipping.shipped":
      return { kind: "SHIPPING_SHIPPED", title: "상품이 출고됐어요", body: "배송 신청 내역에서 운송장 정보를 확인해 주세요." };
    case "shipping.delivered":
      return { kind: "SHIPPING_DELIVERED", title: "배송이 완료됐어요", body: "수령한 상품을 확인해 주세요." };
    case "shipping.cancelled":
      return { kind: "SHIPPING_CANCELLED", title: "배송 신청이 취소됐어요", body: "배송 신청 내역에서 처리 결과를 확인해 주세요." };
    case "inquiry.answered":
      return { kind: "INQUIRY_ANSWERED", title: "문의 답변이 도착했어요", body: "고객센터에서 운영자 답변을 확인해 주세요." };
    case "user.warning_requested":
      return {
        kind: "USER_WARNING",
        title: "커뮤니티 이용 안내가 도착했어요",
        body: "안전한 이용을 위해 커뮤니티 운영 정책을 다시 확인해 주세요.",
      };
    case "catalog.request.decided":
      return stringPayload(event, "decision") === "APPROVED"
        ? { kind: "CATALOG_REQUEST_APPROVED", title: "상품 등록 요청이 반영됐어요", body: "신청방에서 처리 결과를 확인해 주세요." }
        : { kind: "CATALOG_REQUEST_REVIEWED", title: "상품 등록 요청 검토가 끝났어요", body: "신청방에서 운영자 답변을 확인해 주세요." };
    case "exchange.offer.created":
      return { kind: "EXCHANGE_OFFER_CREATED", title: "새 교환 제안이 도착했어요", body: "교환 글에서 제안 상품을 확인해 주세요." };
    case "exchange.offer.accepted":
      return { kind: "EXCHANGE_OFFER_ACCEPTED", title: "교환 제안이 수락됐어요", body: "교환방에서 다음 절차를 확인해 주세요." };
    case "exchange.offer.rejected":
      return { kind: "EXCHANGE_OFFER_REJECTED", title: "교환 제안 결과가 도착했어요", body: "등록한 상품은 다시 사용할 수 있습니다." };
    default:
      return null;
  }
}

export function externalPreferenceForNotification(kind: string): ExternalPreferenceKey | null {
  if (kind.startsWith("EXCHANGE_")) return "exchange_updates";
  if (kind.startsWith("CATALOG_REQUEST_") || kind.startsWith("WANTED_REQUEST_")) return "request_updates";
  if (kind.startsWith("RESTOCK_")) return "restock_updates";
  if (kind.startsWith("MARKETING_SMS_")) return "marketing_sms";
  if (kind.startsWith("MARKETING_EMAIL_")) return "marketing_email";
  if (kind.startsWith("MARKETING_PUSH_")) return "marketing_push";
  if (kind.startsWith("PERSONALIZED_RECOMMENDATION_")) return "personalized_recommendations";
  return null;
}

export async function shouldDeliverNotificationExternally(
  pool: DatabasePool,
  notification: Pick<Notification, "userId" | "kind">,
): Promise<boolean> {
  const preference = externalPreferenceForNotification(notification.kind);
  if (!preference) return true;
  const result = await pool.query<ExternalPreferenceRow>(
    `SELECT exchange_updates,request_updates,restock_updates,
      marketing_sms,marketing_email,marketing_push,personalized_recommendations
     FROM notification_preferences WHERE user_id=$1`,
    [notification.userId],
  );
  return result.rows[0]?.[preference] === true;
}

function notificationData(event: OutboxEvent): Record<string, unknown> {
  if (event.eventType === "user.warning_requested") {
    const reportId = stringPayload(event, "reportId");
    return {
      ...(reportId ? { reportId } : {}),
      outboxEventId: event.id,
    };
  }
  return { ...event.payload, outboxEventId: event.id, correlationId: event.correlationId };
}

async function resolveUserId(client: DatabaseClient, event: OutboxEvent): Promise<string | null> {
  for (const key of ["userId", "authorId", "proposerId"]) {
    const value = stringPayload(event, key);
    if (value) return value;
  }
  if (event.aggregateType === "ORDER") {
    const result = await client.query<{ user_id: string }>("SELECT user_id FROM orders WHERE id=$1", [event.aggregateId]);
    return result.rows[0]?.user_id || null;
  }
  if (event.aggregateType === "INQUIRY") {
    const result = await client.query<{ user_id: string }>("SELECT user_id FROM inquiries WHERE id=$1", [event.aggregateId]);
    return result.rows[0]?.user_id || null;
  }
  if (event.aggregateType === "SHIPPING_REQUEST") {
    const result = await client.query<{ user_id: string }>(
      "SELECT user_id FROM shipping_requests WHERE id=$1",
      [event.aggregateId],
    );
    return result.rows[0]?.user_id || null;
  }
  return null;
}

function mapNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    data: row.data,
    createdAt: row.created_at.toISOString(),
  };
}

export async function ensureNotification(pool: DatabasePool, event: OutboxEvent): Promise<Notification | null> {
  const template = notificationTemplate(event);
  if (!template) return null;

  return withTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`notification:${event.id}`]);
    const userId = await resolveUserId(client, event);
    if (!userId) return null;

    const existing = await client.query<NotificationRow>(
      "SELECT * FROM notifications WHERE user_id=$1 AND data->>'outboxEventId'=$2 ORDER BY created_at DESC LIMIT 1",
      [userId, event.id],
    );
    if (existing.rowCount) return mapNotification(existing.rows[0]!);

    const data = notificationData(event);
    const created = await client.query<NotificationRow>(
      `INSERT INTO notifications(user_id,kind,title,body,data)
       VALUES($1,$2,$3,$4,$5)
       RETURNING *`,
      [userId, template.kind, template.title, template.body, JSON.stringify(data)],
    );
    return mapNotification(created.rows[0]!);
  });
}

export class LogOnlyNotificationDelivery implements NotificationDelivery {
  constructor(private readonly logger: Logger) {}

  async deliver(notification: Notification): Promise<void> {
    this.logger.info(
      { notificationId: notification.id, userId: notification.userId, kind: notification.kind, externalDelivery: "not_configured" },
      "In-app notification persisted; external delivery is disabled",
    );
  }
}

export class HttpNotificationDelivery implements NotificationDelivery {
  constructor(private readonly url: string, private readonly token: string | null) {}

  async deliver(notification: Notification): Promise<void> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": notification.id,
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify(notification),
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Notification delivery failed with HTTP ${response.status}`);
  }
}
