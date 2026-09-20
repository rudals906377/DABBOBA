import assert from "node:assert/strict";
import test from "node:test";
import type { DatabasePool } from "@dabboba/db";
import { ExpoPushNotificationDelivery } from "./expo-push.js";
import type { Logger } from "./logger.js";
import type { Notification } from "./notifications.js";

const notification: Notification = {
  id: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000001",
  kind: "ORDER_PAID",
  title: "결제가 완료됐어요",
  body: "구매 내역에서 주문 상태를 확인해 주세요.",
  data: { orderId: "should-not-reach-push" },
  createdAt: "2026-09-20T12:00:00.000Z",
};

const deviceToken = "ExpoPushToken[abcdefgh_ABCDEFGH-12345678]";
const deliveryId = "30000000-0000-4000-8000-000000000001";
const deviceId = "40000000-0000-4000-8000-000000000001";

function silentLogger(entries: unknown[]): Logger {
  const record = (fields: unknown, message: string) => entries.push({ fields, message });
  return { debug: record, info: record, warn: record, error: record };
}

test("Expo delivery sends only the finite notification-detail payload and persists its ticket", async () => {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const logs: unknown[] = [];
  const requests: Array<{ url: string; init: RequestInit }> = [];
  let claimed = false;
  const pool = scriptedPool(async (sql, params) => {
    queries.push({ sql, ...(params ? { params } : {}) });
    if (sql.includes("JOIN notifications notification") && !claimed) {
      claimed = true;
      return { rowCount: 1, rows: [{
        delivery_id: deliveryId,
        notification_id: notification.id,
        push_device_token_id: deviceId,
        expo_push_token: deviceToken,
        title: notification.title,
        body: notification.body,
        send_attempt_count: 0,
      }] };
    }
    return { rowCount: 1, rows: [] };
  });
  const delivery = new ExpoPushNotificationDelivery(
    pool,
    "expo-server-access-token-for-tests",
    silentLogger(logs),
    {
      fetch: async (input, init) => {
        requests.push({ url: String(input), init: init! });
        return Response.json({ data: [{ status: "ok", id: "expo-ticket-1" }] });
      },
      now: () => new Date("2026-09-20T12:00:00.000Z"),
    },
  );

  await delivery.deliver(notification);

  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.url, "https://exp.host/--/api/v2/push/send");
  assert.equal((requests[0]!.init.headers as Record<string, string>).authorization, "Bearer expo-server-access-token-for-tests");
  assert.deepEqual(JSON.parse(String(requests[0]!.init.body)), [{
    to: deviceToken,
    title: notification.title,
    body: notification.body,
    data: { kind: "ACCOUNT_NOTIFICATION", notificationId: notification.id },
    sound: "default",
    priority: "high",
    channelId: "account",
  }]);
  assert.equal(queries.some(({ sql, params }) => sql.includes("status='TICKETED'") && params?.[1] === "expo-ticket-1"), true);
  assert.equal(JSON.stringify(logs).includes(deviceToken), false);
  assert.equal(JSON.stringify(logs).includes("expo-server-access-token-for-tests"), false);
});

test("Expo receipt DeviceNotRegistered invalidates both the delivery and device token", async () => {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const logs: unknown[] = [];
  let receiptClaimed = false;
  const pool = scriptedPool(async (sql, params) => {
    queries.push({ sql, ...(params ? { params } : {}) });
    if (sql.includes("status='TICKETED'") && sql.includes("FOR UPDATE") && !receiptClaimed) {
      receiptClaimed = true;
      return { rowCount: 1, rows: [{
        delivery_id: deliveryId,
        push_device_token_id: deviceId,
        expo_ticket_id: "expo-ticket-invalid",
        send_attempt_count: 1,
        receipt_attempt_count: 0,
      }] };
    }
    if (sql.includes("JOIN notifications notification")) return { rowCount: 0, rows: [] };
    return { rowCount: 1, rows: [] };
  });
  const delivery = new ExpoPushNotificationDelivery(
    pool,
    "expo-server-access-token-for-tests",
    silentLogger(logs),
    {
      fetch: async () => Response.json({
        data: {
          "expo-ticket-invalid": {
            status: "error",
            details: { error: "DeviceNotRegistered" },
          },
        },
      }),
      now: () => new Date("2026-09-20T12:20:00.000Z"),
    },
  );

  assert.equal(await delivery.reconcile(), 1);
  const disabled = queries.find(({ sql }) => sql.includes("UPDATE push_device_tokens"));
  assert.deepEqual(disabled?.params, [deviceId]);
  assert.match(disabled?.sql ?? "", /DEVICE_NOT_REGISTERED/);
  const invalid = queries.find(({ sql }) => sql.includes("status='INVALID'") && sql.includes("WHERE id=$1"));
  assert.deepEqual(invalid?.params, [deliveryId, "DeviceNotRegistered"]);
  assert.equal(JSON.stringify(logs).includes(deviceToken), false);
});

test("transient Expo gateway failures are rescheduled with bounded state and no secret logs", async () => {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const logs: unknown[] = [];
  let claimed = false;
  const pool = scriptedPool(async (sql, params) => {
    queries.push({ sql, ...(params ? { params } : {}) });
    if (sql.includes("JOIN notifications notification") && !claimed) {
      claimed = true;
      return { rowCount: 1, rows: [{
        delivery_id: deliveryId,
        notification_id: notification.id,
        push_device_token_id: deviceId,
        expo_push_token: deviceToken,
        title: notification.title,
        body: notification.body,
        send_attempt_count: 0,
      }] };
    }
    return { rowCount: 1, rows: [] };
  });
  const delivery = new ExpoPushNotificationDelivery(
    pool,
    "expo-server-access-token-for-tests",
    silentLogger(logs),
    {
      fetch: async () => new Response(null, { status: 503 }),
      now: () => new Date("2026-09-20T12:00:00.000Z"),
    },
  );

  await delivery.deliver(notification);
  const retry = queries.find(({ sql, params }) => sql.includes("SET status='PENDING'") && params?.[2] === "HTTP_503");
  assert.ok(retry);
  assert.ok(retry.params?.[1] instanceof Date);
  assert.equal(JSON.stringify(logs).includes(deviceToken), false);
  assert.equal(JSON.stringify(logs).includes("expo-server-access-token-for-tests"), false);
});

function scriptedPool(
  query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number; rows: unknown[] }>,
): DatabasePool {
  const client = {
    query,
    release() {},
  };
  return {
    query,
    async connect() { return client; },
  } as unknown as DatabasePool;
}
