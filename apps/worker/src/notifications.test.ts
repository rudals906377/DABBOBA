import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { DatabasePool } from "@dabboba/db";
import {
  ensureNotification,
  externalPreferenceForNotification,
  HttpNotificationDelivery,
  notificationTemplate,
  shouldDeliverNotificationExternally,
  type Notification,
} from "./notifications.js";
import type { OutboxEvent } from "./types.js";

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

function event(eventType: string, payload: Record<string, unknown> = {}): OutboxEvent {
  return {
    id: "event-1",
    aggregateType: "ORDER",
    aggregateId: "order-1",
    eventType,
    payload,
    correlationId: "request-1",
    createdAt: "2026-08-24T00:00:00.000Z",
  };
}

test("user-facing events map to stable in-app notification kinds", () => {
  assert.equal(notificationTemplate(event("order.paid"))?.kind, "ORDER_PAID");
  assert.equal(notificationTemplate(event("exchange.offer.accepted"))?.kind, "EXCHANGE_OFFER_ACCEPTED");
  assert.equal(notificationTemplate(event("inquiry.answered"))?.kind, "INQUIRY_ANSWERED");
  assert.equal(notificationTemplate(event("user.warning_requested"))?.kind, "USER_WARNING");
  assert.equal(notificationTemplate(event("shipping.shipped"))?.kind, "SHIPPING_SHIPPED");
  assert.deepEqual(
    notificationTemplate(event("inventory.storage_expiry_reminder", { remainingDays: 7 })),
    {
      kind: "STORAGE_EXPIRY_REMINDER",
      title: "보관 만료 7일 전이에요",
      body: "보관함에서 만료일과 현재 상품 상태를 확인해 주세요.",
    },
  );
  assert.equal(notificationTemplate(event("inventory.storage_expiry_reminder", { remainingDays: 2 })), null);
  assert.equal(notificationTemplate(event("inventory.storage_expired_hold"))?.kind, "STORAGE_EXPIRED_HOLD");
});

test("only optional external deliveries are mapped to mutable user preferences", async () => {
  assert.equal(externalPreferenceForNotification("EXCHANGE_OFFER_CREATED"), "exchange_updates");
  assert.equal(externalPreferenceForNotification("CATALOG_REQUEST_APPROVED"), "request_updates");
  assert.equal(externalPreferenceForNotification("RESTOCK_AVAILABLE"), "restock_updates");
  assert.equal(externalPreferenceForNotification("MARKETING_SMS_CAMPAIGN"), "marketing_sms");
  assert.equal(externalPreferenceForNotification("ORDER_PAID"), null);
  assert.equal(externalPreferenceForNotification("SHIPPING_SHIPPED"), null);
  assert.equal(externalPreferenceForNotification("INQUIRY_ANSWERED"), null);
  assert.equal(externalPreferenceForNotification("USER_WARNING"), null);
  assert.equal(externalPreferenceForNotification("STORAGE_EXPIRY_REMINDER"), null);
  assert.equal(externalPreferenceForNotification("STORAGE_EXPIRED_HOLD"), null);

  let preferenceQueries = 0;
  const optedOutPool = {
    async query() {
      preferenceQueries += 1;
      return {
        rowCount: 1,
        rows: [{
          exchange_updates: false,
          request_updates: false,
          restock_updates: false,
          marketing_sms: false,
          marketing_email: false,
          marketing_push: false,
          personalized_recommendations: false,
        }],
      };
    },
  } as unknown as DatabasePool;
  assert.equal(await shouldDeliverNotificationExternally(optedOutPool, {
    userId: "user-1",
    kind: "EXCHANGE_OFFER_CREATED",
  }), false);
  assert.equal(preferenceQueries, 1);
  assert.equal(await shouldDeliverNotificationExternally(optedOutPool, {
    userId: "user-1",
    kind: "ORDER_PAID",
  }), true);
  assert.equal(preferenceQueries, 1);
});

test("catalog decisions keep approval and non-approval copy distinct", () => {
  assert.equal(notificationTemplate(event("catalog.request.decided", { decision: "APPROVED" }))?.kind, "CATALOG_REQUEST_APPROVED");
  assert.equal(notificationTemplate(event("catalog.request.decided", { decision: "REJECTED" }))?.kind, "CATALOG_REQUEST_REVIEWED");
});

test("internal and cache-only events do not create user notifications", () => {
  assert.equal(notificationTemplate(event("catalog.product.created")), null);
  assert.equal(notificationTemplate(event("notice.published")), null);
});

test("HTTP notification delivery rejects redirects before the notification body reaches the target", async (context) => {
  const targetBodies: string[] = [];
  const target = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk.toString();
    targetBodies.push(body);
    response.writeHead(204).end();
  });
  const targetUrl = await listen(target);
  const redirect = createServer((_request, response) => {
    response.writeHead(307, { location: `${targetUrl}/internal-delivery` }).end();
  });
  const redirectUrl = await listen(redirect);
  context.after(async () => {
    await closeServer(redirect);
    await closeServer(target);
  });

  const notification: Notification = {
    id: "notification-redirect-test",
    userId: "user-1",
    kind: "ORDER_PAID",
    title: "결제가 완료됐어요",
    body: "구매 내역에서 주문 상태를 확인해 주세요.",
    data: {},
    createdAt: "2026-08-25T03:00:00.000Z",
  };

  await assert.rejects(() => new HttpNotificationDelivery(`${redirectUrl}/deliver`, null).deliver(notification));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(targetBodies, []);
});

test("HTTP notification delivery preserves direct provider requests and idempotency headers", async (context) => {
  const received: Array<{ body: unknown; idempotencyKey: string | undefined; authorization: string | undefined }> = [];
  const provider = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk.toString();
    const idempotencyKey = request.headers["idempotency-key"];
    received.push({
      body: JSON.parse(body) as unknown,
      idempotencyKey: Array.isArray(idempotencyKey) ? idempotencyKey[0] : idempotencyKey,
      authorization: request.headers.authorization,
    });
    response.writeHead(204).end();
  });
  const providerUrl = await listen(provider);
  context.after(() => closeServer(provider));
  const notification: Notification = {
    id: "notification-direct-test",
    userId: "user-1",
    kind: "ORDER_PAID",
    title: "결제가 완료됐어요",
    body: "구매 내역에서 주문 상태를 확인해 주세요.",
    data: { orderId: "order-1" },
    createdAt: "2026-08-25T03:00:00.000Z",
  };

  await new HttpNotificationDelivery(`${providerUrl}/deliver`, "provider-token").deliver(notification);

  assert.deepEqual(received, [{
    body: {
      ...notification,
      pushData: {
        kind: "ACCOUNT_NOTIFICATION",
        notificationId: notification.id,
      },
    },
    idempotencyKey: notification.id,
    authorization: "Bearer provider-token",
  }]);
});

test("user warnings persist an in-app notification without exposing the internal admin reason", async () => {
  const insertedPayloads: string[] = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      if (sql.startsWith("SELECT * FROM notifications")) return { rowCount: 0, rows: [] };
      if (sql.includes("INSERT INTO notifications")) {
        const data = String(params[4]);
        insertedPayloads.push(data);
        return {
          rowCount: 1,
          rows: [{
            id: "notification-1",
            user_id: params[0],
            kind: params[1],
            title: params[2],
            body: params[3],
            data: JSON.parse(data) as Record<string, unknown>,
            created_at: new Date("2026-08-24T01:00:00.000Z"),
          }],
        };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  const pool = { connect: async () => client } as unknown as DatabasePool;
  const warningEvent = event("user.warning_requested", {
    userId: "user-1",
    reportId: "report-1",
    reason: "내부 관리자 검토 사유 — 사용자에게 노출하면 안 됨",
  });
  warningEvent.aggregateType = "USER";
  warningEvent.aggregateId = "user-1";

  const notification = await ensureNotification(pool, warningEvent);

  assert.equal(notification?.kind, "USER_WARNING");
  assert.deepEqual(notification?.data, {
    reportId: "report-1",
    aggregateType: "USER",
    aggregateId: "user-1",
    outboxEventId: "event-1",
  });
  assert.equal(insertedPayloads.length, 1);
  assert.equal(insertedPayloads[0]?.includes("내부 관리자 검토 사유"), false);
  assert.equal(insertedPayloads[0]?.includes("reason"), false);
});
