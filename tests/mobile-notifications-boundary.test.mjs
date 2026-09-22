import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const api = readFileSync(new URL("../apps/mobile/src/features/notifications/notifications-api.ts", import.meta.url), "utf8");
const list = readFileSync(new URL("../apps/mobile/src/features/notifications/NotificationsScreen.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("../apps/mobile/src/features/notifications/NotificationDetailScreen.tsx", import.meta.url), "utf8");
const navigation = readFileSync(new URL("../apps/mobile/src/features/notifications/notification-navigation.ts", import.meta.url), "utf8");
const observer = readFileSync(new URL("../apps/mobile/src/features/notifications/AccountNotificationObserver.tsx", import.meta.url), "utf8");

test("mobile notifications consume one cursor page and dedicated detail/summary endpoints", () => {
  assert.match(api, /fetchAccountNotificationPage/);
  assert.match(api, /\/v1\/account\/notifications\/\{notificationId\}/);
  assert.match(api, /\/v1\/account\/notifications\/unread-summary/);
  assert.doesNotMatch(api, /while\s*\(true\)/);
  assert.match(list, /setNextCursor\(page\.nextCursor\)/);
  assert.match(list, /이전 알림 더 보기/);
  assert.match(detail, /fetchAccountNotification\(/);
  assert.doesNotMatch(detail, /\.find\(\(notification\)/);
});

test("opening a list item navigates before background read acknowledgement", () => {
  const handlerStart = list.indexOf("const openNotification");
  const handlerEnd = list.indexOf("const loadMore", handlerStart);
  const handler = list.slice(handlerStart, handlerEnd);
  assert.ok(handler.indexOf("router.push") >= 0);
  assert.ok(handler.indexOf("markAccountNotificationRead") > handler.indexOf("router.push"));
  assert.match(handler, /void markAccountNotificationRead/);
});

test("notification navigation is finite and cold-start responses open detail by validated id", () => {
  assert.match(navigation, /home: \{ href:/);
  assert.match(navigation, /gacha: \{ href:/);
  assert.match(navigation, /kuji: \{ href:/);
  assert.match(navigation, /storage: \{ href:/);
  assert.match(navigation, /profile: \{ href:/);
  assert.doesNotMatch(navigation, /notification\.data/);
  assert.match(navigation, /SAFE_NOTIFICATION_ID/);
  assert.match(observer, /getLastNotificationResponse/);
  assert.match(observer, /addNotificationResponseReceivedListener/);
});

test("notification screens hide decorative icon-font glyphs from assistive technology", () => {
  assert.doesNotMatch(list, /import \{ Ionicons \}/);
  assert.doesNotMatch(detail, /import \{ Ionicons \}/);
  assert.match(list, /DecorativeIonicon/);
  assert.match(detail, /DecorativeIonicon/);
});
