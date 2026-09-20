import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  KUJI_CHECKOUT_LIMIT_SECONDS,
  createKujiCheckoutClock,
  formatKujiCheckoutRemainingTime,
  kujiCheckoutRemainingSeconds,
  resolveKujiCheckoutPhase,
} from "../apps/mobile/src/features/kuji/kuji-checkout-state.ts";

test("kuji checkout keeps one absolute three-minute lease with server clock correction", () => {
  const clientNow = Date.parse("2026-09-01T00:00:00.000Z");
  const serverNow = Date.parse("2026-09-01T00:02:00.000Z");
  const expiresAt = new Date(serverNow + 180_000).toISOString();
  const clock = createKujiCheckoutClock(
    expiresAt,
    new Date(serverNow).toISOString(),
    clientNow,
  );

  assert.equal(KUJI_CHECKOUT_LIMIT_SECONDS, 180);
  assert.equal(kujiCheckoutRemainingSeconds(clock, clientNow), 180);
  assert.equal(kujiCheckoutRemainingSeconds(clock, clientNow + 1_001), 179);
  assert.equal(kujiCheckoutRemainingSeconds(clock, clientNow + 179_001), 1);
  assert.equal(kujiCheckoutRemainingSeconds(clock, clientNow + 180_000), 0);
});

test("kuji checkout countdown rounds up, clamps, and formats as MM:SS", () => {
  const now = Date.parse("2026-09-01T10:00:00.000Z");
  const clock = createKujiCheckoutClock(
    new Date(now + 60_001).toISOString(),
    undefined,
    now,
  );

  assert.equal(kujiCheckoutRemainingSeconds(clock, now), 61);
  assert.equal(
    kujiCheckoutRemainingSeconds(
      createKujiCheckoutClock(new Date(now + 600_000).toISOString(), undefined, now),
      now,
    ),
    180,
  );
  assert.equal(formatKujiCheckoutRemainingTime(61), "01:01");
  assert.equal(formatKujiCheckoutRemainingTime(999), "03:00");
  assert.equal(formatKujiCheckoutRemainingTime(Number.NaN), "00:00");
});

test("a stale serverNow snapshot never extends the absolute checkout deadline", () => {
  const clientNow = Date.parse("2026-09-01T10:00:00.000Z");
  const staleServerNow = Date.parse("2026-09-01T09:59:00.000Z");
  const clock = createKujiCheckoutClock(
    new Date(clientNow + 120_000).toISOString(),
    new Date(staleServerNow).toISOString(),
    clientNow,
  );

  assert.equal(kujiCheckoutRemainingSeconds(clock, clientNow), 120);
});

test("invalid or past kuji checkout leases fail closed while paid takes precedence", () => {
  const now = Date.parse("2026-09-01T10:00:00.000Z");
  const missing = createKujiCheckoutClock(undefined, undefined, now);
  const invalid = createKujiCheckoutClock("not-a-date", undefined, now);
  const invalidServerClock = createKujiCheckoutClock(
    new Date(now + 180_000).toISOString(),
    "not-a-date",
    now,
  );
  const past = createKujiCheckoutClock(
    new Date(now - 1).toISOString(),
    undefined,
    now,
  );

  for (const clock of [missing, invalid, invalidServerClock, past]) {
    assert.equal(kujiCheckoutRemainingSeconds(clock, now), 0);
    assert.equal(resolveKujiCheckoutPhase(clock, now), "EXPIRED");
    assert.equal(resolveKujiCheckoutPhase(clock, now, false, true), "SUBMITTING");
    assert.equal(resolveKujiCheckoutPhase(clock, now, true), "PAID");
    assert.equal(resolveKujiCheckoutPhase(clock, now, true, true), "PAID");
  }
});

test("native checkout binds kuji expiry to route state and never resets it on rerender", async () => {
  const source = await readFile(
    new URL("../apps/mobile/src/features/checkout/CheckoutScreen.tsx", import.meta.url),
    "utf8",
  );

  for (const contract of [
    "kujiEntryId",
    "kujiCheckoutExpiresAt",
    "checkoutExpiresAt",
    "serverNow",
    "결제 남은 시간",
    "AppState.addEventListener",
    "AccessibilityInfo.announceForAccessibility",
    "fetchKujiRoom",
    "leaveKujiRoom",
    "beforeRemove",
    "kujiRoomFixture",
  ]) {
    assert.match(source, new RegExp(contract));
  }
  assert.match(
    source,
    /const showInternalCommerceControls = __DEV__[\s\S]*?internalCommerce\) === "enabled"/,
  );
  assert.match(
    source,
    /if \(kujiRoomFixture === "development"\) \{[\s\S]*?Alert\.alert\([\s\S]*?"실제 대기실 연결이 필요해요"[\s\S]*?"현재 대기 정보로는 주문이나 추첨권을 만들지 않아요\./,
  );
  assert.match(
    source,
    /showInternalCommerceControls && product\.category === "kuji" && kujiRoomFixture === "development"[\s\S]*?INTERNAL QUEUE · 주문과 추첨권은 생성되지 않아요\./,
  );
  assert.match(source, /createKujiCheckoutClock/);
  assert.match(source, /room\.viewer\.state !== "CHECKOUT_PENDING"/);
  assert.match(source, /room\.viewer\.entryId !== kujiEntryId/);
  assert.match(source, /쿠지 대기실에서 순서를 확인한 뒤 결제를 시작해 주세요/);
  assert.match(source, /router\.replace\(`\/product\/\$\{encodeURIComponent\(productId\)\}`/);
  assert.match(source, /createKujiCheckoutOrder/);
  assert.match(source, /paidKujiOrderEntitlementIds\(order, quantity\)/);
  assert.match(source, /resolveKujiCheckoutPhase\([\s\S]*?checkoutCompletedRef\.current,[\s\S]*?orderSubmittingRef\.current/);
  assert.match(source, /room\.viewer\.state === "DRAWING"[\s\S]*?orderSubmittingRef\.current/);
  assert.match(source, /checkoutCompletedRef\.current = false;[\s\S]{0,180}\}, \[kujiEntryId, productId\]\);/);
  assert.match(source, /const confirmKujiCheckoutCancellation = useCallback\(\(\) => \{\s*if \(orderSubmittingRef\.current\) return;/);
  assert.match(source, /`\/kuji\/draw\/\$\{encodeURIComponent\(product\.id\)\}\?\$\{query\.toString\(\)\}`/);
  assert.match(source, /kujiCheckoutExpired \|\| !drawAvailable \|\| quantity <= 0/);
  assert.doesNotMatch(source, /setRemainingSeconds\(\(current\) => current - 1\)/);
});
