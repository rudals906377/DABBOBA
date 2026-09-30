import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const device = read("apps/mobile/src/features/notifications/push-device.ts");
const observer = read("apps/mobile/src/features/notifications/AccountNotificationObserver.tsx");
const api = read("apps/mobile/src/features/notifications/notifications-api.ts");
const account = read("apps/mobile/src/features/profile/ProfileMemberDetailScreen.tsx");
const sessionStore = read("apps/mobile/src/lib/session-store.ts");

test("mobile push registration is session-aware and never requests permission on cold start", () => {
  assert.match(observer, /synchronizeAccountPushDevice\(runtime\.apiBaseUrl, tokens\.accessToken\)/);
  assert.doesNotMatch(observer, /requestPermission:\s*true/);
  assert.match(observer, /subscribeAuthTokens\(sync\)/);
  assert.match(observer, /addPushTokenListener/);
  assert.match(sessionStore, /notifyAuthTokenListeners\(\)/);
});

test("mobile push requires a real EAS project and sends no provider credential from the app", () => {
  assert.match(device, /EXPO_PUBLIC_EAS_PROJECT_ID/);
  assert.match(device, /getExpoPushTokenAsync\(\{ projectId \}\)/);
  assert.match(device, /UUID\.test\(configured\)/);
  assert.doesNotMatch(device, /EXPO_PUSH_ACCESS_TOKEN|Authorization|Bearer/);
  assert.match(api, /\/v1\/account\/push-devices/);
});

test("permission prompts remain user-triggered and logout unregisters the installation", () => {
  assert.match(account, /requestPermission:\s*true/);
  assert.match(account, /이 기기 푸시 연결/);
  assert.match(account, /unregisterCurrentAccountPushDevice/);
  const unregisterAt = account.indexOf("await unregisterCurrentAccountPushDevice");
  const logoutAt = account.indexOf("await logoutAccount", unregisterAt);
  assert.ok(unregisterAt >= 0 && logoutAt > unregisterAt);
});

test("foreground push renders safely while taps always open validated notification detail", () => {
  const handler = read("apps/mobile/src/features/notifications/notification-handler.ts");
  const dispatcher = read("apps/mobile/src/features/notifications/notification-response.ts");
  assert.match(observer, /ensureForegroundNotificationHandler\(\);/);
  assert.match(handler, /setNotificationHandler/);
  assert.match(handler, /shouldShowBanner:\s*true/);
  assert.match(observer, /installNotificationResponseDispatcher/);
  assert.match(dispatcher, /resolveAccountNotificationResponsePath/);
  assert.match(dispatcher, /getLastNotificationResponse/);
});
