import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobile = path.join(root, "apps/mobile");
const read = (relativePath) => readFileSync(path.join(mobile, relativePath), "utf8");

test("notification rows mark unread items before opening the native detail route", () => {
  const source = read("src/features/notifications/NotificationsScreen.tsx");
  const handlerStart = source.indexOf("const openNotification");
  const handlerEnd = source.indexOf("const unreadCount", handlerStart);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, "openNotification handler is missing");

  const handler = source.slice(handlerStart, handlerEnd);
  assert.match(handler, /if \(!notification\.readAt\)/);
  assert.match(handler, /markAccountNotificationRead/);
  assert.match(handler, /`\/notifications\/\$\{encodeURIComponent\(notification\.id\)\}`/);
  assert.ok(
    handler.indexOf("markAccountNotificationRead") < handler.indexOf("router.push"),
    "unread notifications must be marked before navigation",
  );
  assert.doesNotMatch(handler, /notification\.readAt\s*\|\|/);
});

test("notification detail has a footer-free route and renders full safe fields", () => {
  const routePath = path.join(mobile, "app/notifications/[notificationId].tsx");
  assert.equal(existsSync(routePath), true, "notification detail route is missing");
  const route = read("app/notifications/[notificationId].tsx");
  const detail = read("src/features/notifications/NotificationDetailScreen.tsx");

  assert.match(route, /NotificationDetailScreen/);
  assert.match(detail, /fetchAccountNotifications/);
  assert.match(detail, /notification\.id === notificationId/);
  assert.match(detail, /<KoreanPixelTitle variant="header">알림 상세<\/KoreanPixelTitle>/);
  assert.match(detail, /<Text style=\{styles\.title\}>\{notification\.title\}<\/Text>/);
  assert.match(detail, /<Text style=\{styles\.body\}>\{notification\.body\}<\/Text>/);
  assert.match(detail, /notification\.readAt \? "읽음" : "읽지 않음"/);
  assert.match(detail, /formatDateTime\(notification\.createdAt\)/);
  assert.match(detail, /paddingHorizontal: seed\.spacing\.globalGutter/);
  assert.doesNotMatch(detail, /JSON\.stringify|notification\.data|RootFloatingTabBar|RootNavigation/);
});
