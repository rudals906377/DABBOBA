import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobile = path.join(root, "apps/mobile");
const read = (relativePath) => readFileSync(path.join(mobile, relativePath), "utf8");

test("notification rows open immediately and acknowledge unread state optimistically", () => {
  const source = read("src/features/notifications/NotificationsScreen.tsx");
  const handlerStart = source.indexOf("const openNotification");
  const handlerEnd = source.indexOf("const loadMore", handlerStart);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, "openNotification handler is missing");

  const handler = source.slice(handlerStart, handlerEnd);
  assert.match(handler, /if \(notification\.readAt \|\| !accessToken\) return/);
  assert.match(handler, /markAccountNotificationRead/);
  assert.match(handler, /`\/notifications\/\$\{encodeURIComponent\(notification\.id\)\}`/);
  assert.ok(
    handler.indexOf("router.push") < handler.indexOf("markAccountNotificationRead"),
    "detail navigation must not wait for the read acknowledgement",
  );
  assert.match(handler, /setUnreadCount\(\(current\) => Math\.max\(0, current - 1\)\)/);
  assert.match(handler, /void markAccountNotificationRead/);
});

test("notification detail has a footer-free route and renders full safe fields", () => {
  const routePath = path.join(mobile, "app/notifications/[notificationId].tsx");
  assert.equal(existsSync(routePath), true, "notification detail route is missing");
  const route = read("app/notifications/[notificationId].tsx");
  const detail = read("src/features/notifications/NotificationDetailScreen.tsx");

  assert.match(route, /NotificationDetailScreen/);
  assert.match(detail, /fetchAccountNotification\(runtime\.apiBaseUrl, tokens\.accessToken, notificationId\)/);
  assert.match(detail, /markAccountNotificationRead/);
  assert.match(detail, /import \{ DetailPageHeader \} from "@\/components\/DetailPageHeader"/);
  assert.match(detail, /<DetailPageHeader title="알림 상세" titleMode="pixel" onBack=\{goBack\} backLabel="알림함으로 돌아가기" \/>/);
  assert.match(detail, /<Text style=\{styles\.title\}>\{notification\.title\}<\/Text>/);
  assert.match(detail, /<Text style=\{styles\.body\}>\{notification\.body\}<\/Text>/);
  assert.match(detail, /notification\.readAt \? "읽음" : "읽지 않음"/);
  assert.match(detail, /formatDateTime\(notification\.createdAt\)/);
  assert.match(detail, /paddingHorizontal: seed\.spacing\.globalGutter/);
  assert.doesNotMatch(detail, /JSON\.stringify|notification\.data|RootFloatingTabBar|RootNavigation/);
});

test("exchange notifications use the typed standalone exchange destination", () => {
  const navigation = read("src/features/notifications/notification-navigation.ts");

  assert.match(navigation, /detail\.kind === "exchange"/);
  assert.match(navigation, /href: `\/exchange\/\$\{encodeURIComponent\(detail\.id\)\}`/);
  assert.match(navigation, /SAFE_IDENTIFIER\.test\(detail\.id\)/);
  assert.match(navigation, /ROOT_TARGETS\[destination\.route\]/);
  assert.doesNotMatch(navigation, /\/\(tabs\)\/exchange/);
});
