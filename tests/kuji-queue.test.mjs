import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  KUJI_SESSION_LIMIT_SECONDS,
  buildKujiQueueView,
  formatKujiRemainingTime,
  kujiRemainingSeconds,
} from "../apps/mobile/src/features/kuji/kuji-queue-state.ts";
import {
  KUJI_ENTRY_CLAIM_SECONDS,
  buildKujiTurnCall,
  resolveKujiEntryPath,
  resolveKujiTurnNotificationPath,
} from "../apps/mobile/src/features/kuji/kuji-entry-state.ts";

const snapshot = {
  productId: "one-piece-kuji",
  viewerUserId: "viewer",
  active: { userId: "active-user", displayName: "럭키덕후", sequence: 10, state: "ACTIVE", expiresAt: "2026-08-30T10:05:00.000Z" },
  waiting: [
    { userId: "first", displayName: "쿠지마스터", sequence: 11, state: "WAITING" },
    { userId: "second", displayName: "애니콜렉터", sequence: 12, state: "WAITING" },
    { userId: "viewer", displayName: "나", sequence: 13, state: "WAITING" },
  ],
};

test("kuji queue includes the active room occupant when calculating my entrance order", () => {
  const view = buildKujiQueueView(snapshot);

  assert.equal(view.viewerPosition, 4);
  assert.equal(view.peopleAheadCount, 3);
  assert.equal(view.canEnter, false);
  assert.deepEqual(view.peopleAhead.map((person) => person.displayName), ["럭키덕후", "쿠지마스터", "애니콜렉터"]);
  assert.deepEqual(view.orderedPeople.map((person) => person.position), [1, 2, 3, 4]);
});

test("only the server-designated active viewer can enter the one-person kuji room", () => {
  const view = buildKujiQueueView({
    ...snapshot,
    viewerUserId: "active-user",
  });

  assert.equal(view.viewerPosition, 1);
  assert.equal(view.peopleAheadCount, 0);
  assert.equal(view.canEnter, true);
  assert.equal(view.orderedPeople.filter((person) => person.state === "ACTIVE").length, 1);
});

test("the kuji room uses one non-resetting five-minute server deadline", () => {
  assert.equal(KUJI_SESSION_LIMIT_SECONDS, 300);
  assert.equal(kujiRemainingSeconds("2026-08-30T10:05:00.000Z", new Date("2026-08-30T10:00:00.000Z").getTime()), 300);
  assert.equal(kujiRemainingSeconds("2026-08-30T10:05:00.000Z", new Date("2026-08-30T10:01:01.000Z").getTime()), 239);
  assert.equal(kujiRemainingSeconds("2026-08-30T10:05:00.000Z", new Date("2026-08-30T10:05:01.000Z").getTime()), 0);
  assert.equal(formatKujiRemainingTime(239), "03:59");
});

test("kuji entry opens the draw room only when free and otherwise opens the queue", () => {
  assert.equal(resolveKujiEntryPath("one-piece-kuji", "AVAILABLE"), "/kuji/draw/one-piece-kuji");
  assert.equal(resolveKujiEntryPath("one-piece-kuji", "OCCUPIED"), "/kuji/queue/one-piece-kuji");
});

test("a promoted waiter gets ten seconds to open the notification before returning to queue", () => {
  const now = new Date("2026-08-30T10:00:00.000Z").getTime();
  const call = buildKujiTurnCall("one-piece-kuji", now);

  assert.equal(KUJI_ENTRY_CLAIM_SECONDS, 10);
  assert.equal(call.title, "차례가 되었습니다");
  assert.equal(call.body, "뽑으러 가시겠어요? 10초 안에 입장해 주세요.");
  assert.equal(Date.parse(call.claimExpiresAt), now + 10_000);
  assert.equal(resolveKujiTurnNotificationPath(call, now + 9_000), `/kuji/draw/one-piece-kuji?claimExpiresAt=${encodeURIComponent(call.claimExpiresAt)}`);
  assert.equal(resolveKujiTurnNotificationPath(call, now + 11_000), "/kuji/queue/one-piece-kuji");
});

test("native kuji products expose a footer-free, explicitly example-only queue page", async () => {
  const [productDetail, queueRoute, queueScreen, drawRoute, drawScreen, notificationSource, rootLayout] = await Promise.all([
    readFile(new URL("../apps/mobile/src/features/shop/ProductDetailScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../apps/mobile/app/kuji/queue/[productId].tsx", import.meta.url), "utf8"),
    readFile(new URL("../apps/mobile/src/features/kuji/KujiQueueScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../apps/mobile/app/kuji/draw/[productId].tsx", import.meta.url), "utf8"),
    readFile(new URL("../apps/mobile/src/features/kuji/KujiDrawScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../apps/mobile/src/features/kuji/kuji-notifications.ts", import.meta.url), "utf8"),
    readFile(new URL("../apps/mobile/app/_layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(productDetail, /product\.category === "kuji"/);
  assert.match(productDetail, /resolveKujiEntryPath/);
  assert.match(productDetail, /뽑으러 가기/);
  assert.match(queueRoute, /KujiQueueScreen/);
  for (const copy of ["쿠지 대기", "내 입장 순서", "앞에", "현재 입장 중", "대기 중", "화면 예시", "한 명만", "남은 시간", "5분", "다른 페이지 둘러보기"]){
    assert.match(queueScreen, new RegExp(copy));
  }
  assert.doesNotMatch(queueScreen, /Math\.random|결제 완료|추첨권 발급 완료/);
  assert.match(drawRoute, /KujiDrawScreen/);
  assert.match(queueScreen, /timerValue:\s*\{[^}]*fontFamily:\s*"Galmuri11"/);
  for (const copy of ["쿠지 뽑기", "남은 시간", "5분", "10초", "쿠지 선택", "결제 금액 확인", "오픈 방식 선택", "한 장씩 오픈", "한 번에 오픈", "화면 예시"]){
    assert.match(drawScreen, new RegExp(copy));
  }
  assert.match(drawScreen, /selectedTickets/);
  assert.match(drawScreen, /timerValue:\s*\{[^}]*fontFamily:\s*"Galmuri11"/);
  assert.doesNotMatch(drawScreen, /Math\.random|결제 완료|추첨권 발급 완료/);
  assert.match(notificationSource, /scheduleNotificationAsync/);
  assert.match(notificationSource, /requestPermissionsAsync/);
  assert.match(notificationSource, /buildKujiTurnCall/);
  assert.match(rootLayout, /KujiNotificationObserver/);
});
