import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildKujiCheckoutPath,
  buildKujiRoomGatePath,
  buildKujiTurnCall,
  resolveKujiTurnNotificationPath,
} from "../apps/mobile/src/features/kuji/kuji-entry-state.ts";
import {
  createKujiRoomFallback,
  formatKujiActivityAge,
  isKujiRoomEndpointUnavailable,
  sortKujiRecentActivity,
} from "../apps/mobile/src/features/kuji/kuji-queue-state.ts";

test("kuji enters the room gate before checkout and carries the authoritative lease", () => {
  const checkoutExpiresAt = "2026-09-01T03:03:00.000Z";
  const serverNow = "2026-09-01T03:00:00.000Z";
  assert.equal(buildKujiRoomGatePath("eva kuji"), "/kuji/queue/eva%20kuji");
  assert.equal(
    buildKujiCheckoutPath("eva kuji", "entry/1", checkoutExpiresAt, serverNow),
    `/checkout/eva%20kuji?kujiEntryId=entry%2F1&kujiCheckoutExpiresAt=${encodeURIComponent(checkoutExpiresAt)}&serverNow=${encodeURIComponent(serverNow)}`,
  );
  assert.match(
    buildKujiCheckoutPath("eva kuji", "entry/1", checkoutExpiresAt, serverNow, true),
    /&kujiRoomFixture=development$/,
  );
  assert.match(
    buildKujiCheckoutPath("eva kuji", "entry/1", checkoutExpiresAt, serverNow, false, -600_000),
    /&serverClockOffsetMs=-600000$/,
  );
  assert.doesNotMatch(
    buildKujiCheckoutPath("eva kuji", "entry/1", checkoutExpiresAt, serverNow, false, null),
    /serverClockOffsetMs/,
  );
});

test("kuji turn notifications always return through the authoritative room gate", () => {
  const now = Date.parse("2026-09-01T03:00:00.000Z");
  const checkoutExpiresAt = "2026-09-01T03:03:00.000Z";
  const call = buildKujiTurnCall(
    "eva-kuji",
    "entry-1",
    checkoutExpiresAt,
    "2026-09-01T03:00:00.000Z",
  );

  assert.equal(call.entryId, "entry-1");
  assert.equal("count" in call, false);
  assert.equal(resolveKujiTurnNotificationPath(call, now + 179_000), "/kuji/queue/eva-kuji");
  assert.equal(resolveKujiTurnNotificationPath(call, now + 180_000), "/kuji/queue/eva-kuji");
});

test("development fallback is deterministic and keeps the occupied-room example honest", () => {
  const startedAt = Date.parse("2026-09-01T03:00:00.000Z");
  const occupied = createKujiRoomFallback("evangelion-kuji", startedAt);
  const available = createKujiRoomFallback("hunter-x-hunter-kuji", startedAt);

  assert.equal(occupied.viewer.state, "WAITING");
  assert.equal(occupied.viewer.position, 3);
  assert.equal(occupied.viewer.peopleAhead, 2);
  assert.equal(occupied.waitingCount, 3);
  assert.equal(occupied.waitingPeople.filter((person) => person.isViewer).length, 1);
  assert.equal(available.viewer.state, "CHECKOUT_PENDING");
  assert.equal(Date.parse(available.viewer.checkoutExpiresAt), startedAt + 180_000);
  assert.deepEqual(createKujiRoomFallback("evangelion-kuji", startedAt), occupied);
});

test("development fallback never hides a missing product or invalid room entry", () => {
  assert.equal(
    isKujiRoomEndpointUnavailable(404, "Route POST:/v1/kuji/rooms/eva/entries not found"),
    true,
  );
  assert.equal(
    isKujiRoomEndpointUnavailable(404, "상품을 찾을 수 없습니다."),
    false,
  );
  assert.equal(
    isKujiRoomEndpointUnavailable(404, "대기 정보를 찾을 수 없습니다."),
    false,
  );
});

test("recent committed results are newest first and use server time for age labels", () => {
  const activity = [
    { id: "old", displayName: "A", prizeName: "D상", prizeImageUrl: null, rarity: "D", committedAt: "2026-09-01T02:58:00.000Z" },
    { id: "new", displayName: "B", prizeName: "A상", prizeImageUrl: null, rarity: "A", committedAt: "2026-09-01T02:59:52.000Z" },
  ];
  assert.deepEqual(sortKujiRecentActivity(activity).map((item) => item.id), ["new", "old"]);
  assert.equal(formatKujiActivityAge(activity[1].committedAt, "2026-09-01T03:00:00.000Z"), "방금");
  assert.equal(formatKujiActivityAge(activity[0].committedAt, "2026-09-01T03:00:00.000Z"), "2분 전");
});

test("native waiting room joins once, polls every two seconds, promotes to checkout, and can leave", async () => {
  const [productDetail, queueScreen, roomApi, notifications] = await Promise.all([
    readFile(new URL("../apps/mobile/src/features/shop/ProductDetailScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../apps/mobile/src/features/kuji/KujiQueueScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../apps/mobile/src/features/kuji/kuji-room-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../apps/mobile/src/features/kuji/kuji-notifications.ts", import.meta.url), "utf8"),
  ]);

  assert.match(productDetail, /product\.category === "kuji"[\s\S]*buildKujiRoomGatePath\(product\.id\)/);
  assert.match(productDetail, /: `\/checkout\/\$\{encodeURIComponent\(product\.id\)\}`/);
  assert.match(queueScreen, /joinKujiRoom\(/);
  assert.match(queueScreen, /fetchKujiRoom\(/);
  assert.match(queueScreen, /leaveKujiRoom\(/);
  assert.match(queueScreen, /KUJI_ROOM_POLL_INTERVAL_MS = 2_000/);
  assert.match(queueScreen, /continueToCheckout\(next\)/);
  assert.match(queueScreen, /beforeRemove/);
  assert.match(queueScreen, /대기를 취소할까요/);
  assert.match(queueScreen, /실시간 뽑기 현황/);
  assert.match(queueScreen, /대기 중/);
  assert.ok(
    queueScreen.indexOf("실시간 뽑기 현황") < queueScreen.indexOf("대기 중"),
    "live committed results must appear before the waiting list",
  );
  assert.match(queueScreen, /internalQueueEnabled/);
  assert.match(queueScreen, /INTERNAL QUEUE · 주문과 추첨권은 생성되지 않아요/);
  assert.doesNotMatch(queueScreen, /개발용 대기 현황/);
  assert.doesNotMatch(queueScreen, /Math\.random|purchasedCount|결제 완료|추첨권 발급 완료/);
  assert.match(roomApi, /\/v1\/kuji\/rooms\/\$\{encodeURIComponent\(productId\)\}\/entries/);
  assert.match(roomApi, /method: "POST" \| "GET" \| "DELETE"/);
  assert.doesNotMatch(notifications, /count:/);
});
