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
  buildKujiCheckoutPath,
  buildKujiRoomGatePath,
  buildKujiTurnCall,
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

test("kuji product detail always enters its room gate before checkout", () => {
  const expiresAt = "2026-08-30T10:03:00.000Z";
  const serverNow = "2026-08-30T10:00:00.000Z";

  assert.equal(buildKujiRoomGatePath("one-piece-kuji"), "/kuji/queue/one-piece-kuji");
  assert.equal(
    buildKujiCheckoutPath("one-piece-kuji", "entry-1", expiresAt, serverNow),
    `/checkout/one-piece-kuji?kujiEntryId=entry-1&kujiCheckoutExpiresAt=${encodeURIComponent(expiresAt)}&serverNow=${encodeURIComponent(serverNow)}`,
  );
});

test("a promoted waiter notification re-enters through the authoritative room gate", () => {
  const now = new Date("2026-08-30T10:00:00.000Z").getTime();
  const serverNow = new Date(now).toISOString();
  const checkoutExpiresAt = new Date(now + 180_000).toISOString();
  const call = buildKujiTurnCall(
    "one-piece-kuji",
    "entry-1",
    checkoutExpiresAt,
    serverNow,
  );

  assert.equal(call.title, "차례가 됐어요");
  assert.equal(call.body, "결제 대기 시간이 시작되었어요.");
  assert.equal(call.entryId, "entry-1");
  assert.equal(resolveKujiTurnNotificationPath(call, now + 179_000), "/kuji/queue/one-piece-kuji");
  assert.equal(resolveKujiTurnNotificationPath(call, now + 180_000), "/kuji/queue/one-piece-kuji");
});

test("native kuji products expose a footer-free room gate with live results before the queue", async () => {
  const [checkoutScreen, queueRoute, queueScreen, drawRoute, drawScreen, notificationSource, rootLayout] = await Promise.all([
    readFile(new URL("../apps/mobile/src/features/checkout/CheckoutScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../apps/mobile/app/kuji/queue/[productId].tsx", import.meta.url), "utf8"),
    readFile(new URL("../apps/mobile/src/features/kuji/KujiQueueScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../apps/mobile/app/kuji/draw/[productId].tsx", import.meta.url), "utf8"),
    readFile(new URL("../apps/mobile/src/features/kuji/KujiDrawScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../apps/mobile/src/features/kuji/kuji-notifications.ts", import.meta.url), "utf8"),
    readFile(new URL("../apps/mobile/app/_layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(checkoutScreen, /product\.category === "kuji"/);
  assert.match(checkoutScreen, /kujiCheckoutExpiresAt/);
  assert.match(checkoutScreen, /결제 남은 시간/);
  assert.match(checkoutScreen, /createKujiCheckoutOrder/);
  assert.match(checkoutScreen, /paidKujiOrderEntitlementIds\(order, quantity\)/);
  assert.match(checkoutScreen, /`\/kuji\/draw\/\$\{encodeURIComponent\(product\.id\)\}\?\$\{query\.toString\(\)\}`/);
  assert.match(checkoutScreen, /checkoutNeedsAgreement/);
  assert.match(checkoutScreen, /결제 수단 준비 중/);
  assert.match(checkoutScreen, /label=\{!recoveringGachaOrder && paymentAvailability === "unavailable"\s*\? "결제 수단 준비 중"\s*: "구매하기"\}/);
  assert.match(queueRoute, /KujiQueueScreen/);
  assert.doesNotMatch(queueRoute, /Redirect|__DEV__/);
  for (const copy of ["쿠지 대기실", "실시간 뽑기 현황", "최근 결과", "내 순서", "앞에", "대기 중", "다른 상품 둘러보기", "대기 취소"]){
    assert.match(queueScreen, new RegExp(copy));
  }
  assert.ok(queueScreen.indexOf("실시간 뽑기 현황") < queueScreen.indexOf("대기 중"));
  assert.match(queueScreen, /joinKujiRoom/);
  assert.match(queueScreen, /fetchKujiRoom/);
  assert.match(queueScreen, /KUJI_ROOM_POLL_INTERVAL_MS\s*=\s*2_000/);
  assert.match(queueScreen, /continueToCheckout/);
  assert.match(queueScreen, /beforeRemove/);
  assert.match(queueScreen, /대기를 취소할까요/);
  assert.doesNotMatch(queueScreen, /Math\.random|결제 완료|추첨권 발급 완료/);
  assert.match(drawRoute, /KujiDrawScreen/);
  assert.doesNotMatch(drawRoute, /Redirect|__DEV__/);
  assert.doesNotMatch(checkoutScreen, /openGachaPreview|\/draw\/preview|체험하기/);
  for (const copy of ["쿠지 뽑기", "남은 시간", "쿠지 선택", "남은 상", "board.totalSlots"]){
    assert.match(drawScreen, new RegExp(copy));
  }
  assert.match(drawScreen, /selectedTickets/);
  assert.match(drawScreen, /const purchasedCount = paidDrawRoute\?\.entitlementIds\.length \?\? 0/);
  assert.match(drawScreen, /<FloatingBottomActionPanel panelStyle=\{styles\.footer\}>/);
  assert.match(drawScreen, /accessibilityLabel=\{`구매한 \$\{purchasedCount\}장 중 \$\{selectedTickets\.length\}장 선택`\}/);
  assert.match(drawScreen, /선택 \{selectedTickets\.length\} \/ \{purchasedCount\}장/);
  assert.match(drawScreen, /selectionSummary:\s*\{[^}]*minHeight:\s*seed\.size\.actionButton\.large/);
  assert.match(drawScreen, /footerAction:\s*\{ flex: 1 \}/);
  assert.match(drawScreen, /hasExactKujiTicketSelection\(selectedTickets, purchasedCount\)/);
  assert.match(drawScreen, /selectedTickets\.length !== purchasedCount/);
  assert.match(drawScreen, /fetchPaidKujiSelection/);
  assert.match(drawScreen, /bindPaidKujiSlots/);
  assert.match(drawScreen, /validateKujiSlotBinding/);
  assert.match(drawScreen, /paidKujiRevealPath/);
  assert.doesNotMatch(drawScreen, /결제 금액 확인|buildKujiPaymentConfirmation/);
  assert.match(drawScreen, /presentDrawOpenModeChoice\(bindings\.length/);
  assert.match(drawScreen, /totalSlots: board\.totalSlots, mode/);
  assert.match(drawScreen, /timerValue:\s*\{[^}]*fontWeight:\s*"900"/);
  assert.doesNotMatch(drawScreen, /timerValue:\s*\{[^}]*fontFamily:\s*"Galmuri11"/);
  assert.match(drawScreen, /prizeRemainingRow:\s*\{[^}]*flexDirection:\s*"row"/);
  assert.doesNotMatch(drawScreen, /화면 예시|50 TICKETS|입장 후 제한시간은 5분이에요|5분이 지나면 현재 입장은 종료되고|대기 중 받은 차례 알림/);
  assert.doesNotMatch(drawScreen, /previewModeBar|timerCaption|ruleCard|turnRuleCard/);
  assert.doesNotMatch(drawScreen, /Math\.random|결제 완료|추첨권 발급 완료/);
  assert.match(notificationSource, /scheduleNotificationAsync/);
  assert.match(notificationSource, /requestPermissionsAsync/);
  assert.match(notificationSource, /buildKujiTurnCall/);
  assert.match(notificationSource, /entryId: call\.entryId/);
  assert.match(notificationSource, /checkoutExpiresAt: call\.checkoutExpiresAt/);
  assert.doesNotMatch(notificationSource, /count: call\.count/);
  assert.match(rootLayout, /KujiNotificationObserver/);
});

test("native kuji keeps the five-column spread while each slot uses the orange pull-tab ticket anatomy", async () => {
  const drawScreen = await readFile(
    new URL("../apps/mobile/src/features/kuji/KujiDrawScreen.tsx", import.meta.url),
    "utf8",
  );
  const theme = await readFile(new URL("../apps/mobile/src/theme.ts", import.meta.url), "utf8");

  assert.match(drawScreen, /styles\.ticketGrid/);
  assert.match(drawScreen, /ticketGrid:\s*\{[^}]*flexWrap:\s*"wrap"/);
  assert.match(drawScreen, /ticket:\s*\{[^}]*width:\s*"18\.4%"[^}]*minHeight:\s*seed\.size\.touchTarget/);
  assert.match(theme, /kujiOrange:\s*"#F36B2C"/);
  assert.match(drawScreen, /backgroundColor:\s*colors\.kujiOrange/);
  assert.match(drawScreen, /require\("\.\.\/\.\.\/\.\.\/assets\/draw\/kuji\/kuji-ticket-front\.png"\)/);
  assert.match(drawScreen, /styles\.ticketArtwork/);
  assert.match(drawScreen, /styles\.ticketFace/);
  assert.match(drawScreen, /styles\.ticketArtworkSold/);
  assert.match(drawScreen, /styles\.ticketSoldOverlay/);
  assert.match(drawScreen, /styles\.ticketState/);
  assert.doesNotMatch(drawScreen, /ticketPerforation|ticketStub|>NO\.<\/Text>/);
  assert.doesNotMatch(drawScreen, /ticketStrip|KUJI_TICKET_ROWS|nestedScrollEnabled/);
  assert.doesNotMatch(drawScreen, /뽑을 쿠지를 선택해 주세요\./);
});
