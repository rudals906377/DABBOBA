import assert from "node:assert/strict";
import test from "node:test";
import type { AccountNotification } from "../apps/mobile/src/features/notifications/notifications-api";
import {
  resolveAccountNotificationResponsePath,
  resolveNotificationTarget,
} from "../apps/mobile/src/features/notifications/notification-navigation";

function notification(
  destination: AccountNotification["destination"],
): AccountNotification {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    kind: "TEST",
    title: "알림",
    body: "알림 본문",
    data: { href: "https://attacker.example/steal" },
    destination,
    readAt: null,
    createdAt: "2026-09-20T10:00:00.000Z",
  };
}

test("notification destinations map only finite roots and supported detail routes", () => {
  assert.deepEqual(resolveNotificationTarget(notification({ route: "home", detail: null })), {
    href: "/(tabs)",
    label: "홈으로 이동",
  });
  assert.deepEqual(resolveNotificationTarget(notification({ route: "storage", detail: null })), {
    href: "/(tabs)/storage",
    label: "보관함 보기",
  });
  assert.deepEqual(resolveNotificationTarget(notification({
    route: "profile",
    detail: { kind: "shipping", id: "20000000-0000-4000-8000-000000000001" },
  })), {
    href: "/profile/shipping/20000000-0000-4000-8000-000000000001",
    label: "배송 상세 보기",
  });
});

test("invalid detail identifiers fall back to their canonical root", () => {
  assert.deepEqual(resolveNotificationTarget(notification({
    route: "profile",
    detail: { kind: "order", id: "../../admin" },
  })), {
    href: "/(tabs)/profile",
    label: "내정보 보기",
  });
});

test("cold-start payloads require the account kind and a valid notification UUID", () => {
  assert.equal(resolveAccountNotificationResponsePath({
    kind: "ACCOUNT_NOTIFICATION",
    notificationId: "10000000-0000-4000-8000-000000000001",
    href: "https://attacker.example/steal",
  }), "/notifications/10000000-0000-4000-8000-000000000001");
  assert.equal(resolveAccountNotificationResponsePath({
    kind: "ACCOUNT_NOTIFICATION",
    notificationId: "../../admin",
  }), null);
  assert.equal(resolveAccountNotificationResponsePath({
    kind: "ORDER_PAID",
    notificationId: "10000000-0000-4000-8000-000000000001",
  }), null);
});
