import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  KUJI_CHECKOUT_LIMIT_SECONDS,
  KUJI_MAX_SERVER_CLOCK_OFFSET_MS,
  createKujiCheckoutClock,
  formatKujiCheckoutRemainingTime,
  kujiCheckoutRemainingSeconds,
  measureKujiServerClockOffset,
  normalizeKujiServerClockOffset,
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

test("a measured server offset keeps the full lease on a skewed device clock", () => {
  const serverNow = Date.parse("2026-09-24T02:00:00.000Z");
  const expiresAt = new Date(serverNow + 180_000).toISOString();

  for (const deviceSkewMs of [10 * 60_000, -10 * 60_000, 3 * 60 * 60_000]) {
    const receivedAt = serverNow + deviceSkewMs;
    const offset = measureKujiServerClockOffset(new Date(serverNow).toISOString(), receivedAt);
    assert.equal(offset, -deviceSkewMs);
    const clock = createKujiCheckoutClock(expiresAt, new Date(serverNow).toISOString(), receivedAt, offset);
    assert.equal(clock.valid, true);
    assert.equal(kujiCheckoutRemainingSeconds(clock, receivedAt), 180);
    assert.equal(kujiCheckoutRemainingSeconds(clock, receivedAt + 60_000), 120);
    assert.equal(resolveKujiCheckoutPhase(clock, receivedAt + 180_000), "EXPIRED");
  }

  // Re-entering later with the same route keeps the absolute server deadline.
  const receivedAt = serverNow + 10 * 60_000;
  const offset = measureKujiServerClockOffset(new Date(serverNow).toISOString(), receivedAt);
  const reopened = createKujiCheckoutClock(
    expiresAt,
    new Date(serverNow).toISOString(),
    receivedAt + 150_000,
    offset,
  );
  assert.equal(kujiCheckoutRemainingSeconds(reopened, receivedAt + 150_000), 30);
});

test("unmeasured or corrupt clock offsets fall back to the non-extending snapshot rule", () => {
  assert.equal(normalizeKujiServerClockOffset("-600000"), -600_000);
  assert.equal(normalizeKujiServerClockOffset(12.5), null);
  assert.equal(normalizeKujiServerClockOffset("12ms"), null);
  assert.equal(normalizeKujiServerClockOffset(KUJI_MAX_SERVER_CLOCK_OFFSET_MS + 1), null);
  assert.equal(measureKujiServerClockOffset("not-a-date", Date.now()), null);

  const clientNow = Date.parse("2026-09-01T10:00:00.000Z");
  const clock = createKujiCheckoutClock(
    new Date(clientNow + 120_000).toISOString(),
    new Date(clientNow - 60_000).toISOString(),
    clientNow,
    normalizeKujiServerClockOffset("not-a-number"),
  );
  assert.equal(clock.measuredOffset, false);
  assert.equal(kujiCheckoutRemainingSeconds(clock, clientNow), 120);
});

test("kuji queue forwards the measured clock offset instead of blocking checkout", async () => {
  const screen = await readFile(
    new URL("../apps/mobile/src/features/kuji/KujiQueueScreen.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(screen, /isKujiServerClockSkewed|시간이 맞지 않아 결제를 시작할 수 없어요/);
  assert.match(screen, /measureKujiServerClockOffset\(next\.serverNow, Date\.now\(\)\)/);

  const checkout = await readFile(
    new URL("../apps/mobile/src/features/checkout/CheckoutScreen.tsx", import.meta.url),
    "utf8",
  );
  assert.match(checkout, /normalizeKujiServerClockOffset\(firstParam\(params\.serverClockOffsetMs\)\)/);
  assert.match(checkout, /serverClockOffsetMs: measureKujiServerClockOffset\(room\.serverNow, Date\.now\(\)\)/);
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
  assert.match(source, /const confirmKujiCheckoutCancellation = useCallback\(\(\) => \{\s*if \(!checkoutFocusedRef\.current \|\| orderSubmittingRef\.current\) return;/);
  assert.match(source, /`\/kuji\/draw\/\$\{encodeURIComponent\(product\.id\)\}\?\$\{query\.toString\(\)\}`/);
  assert.match(source, /kujiCheckoutExpired \|\| !drawAvailable \|\| quantity <= 0/);
  assert.doesNotMatch(source, /setRemainingSeconds\(\(current\) => current - 1\)/);
  assert.match(source, /useFocusEffect\(useCallback\(\(\) => \{\s*if \(!isKujiCheckout\) return undefined;[\s\S]*?const timer = setInterval\(syncNow, 1_000\)/);
  assert.match(source, /const expireKujiCheckout = useCallback\(\(\) => \{\s*if \(!checkoutFocusedRef\.current\) return;/);
  assert.match(source, /navigation\.addListener\("beforeRemove", \(event\) => \{[\s\S]*?!checkoutFocusedRef\.current/);
});
