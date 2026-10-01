import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  checkoutNeedsAgreement,
  checkoutPointUsed,
  checkoutPaymentAvailability,
  normalizedCheckoutPointInput,
  toggleCheckoutNoticeState,
} from "../apps/mobile/src/features/checkout/checkout-payment-ui.ts";
import { checkoutNoticeSections } from "../apps/mobile/src/features/checkout/checkout-reference-notices.ts";

const checkoutSource = await readFile(
    new URL("../apps/mobile/src/features/checkout/CheckoutScreen.tsx", import.meta.url),
  "utf8",
);
const connectionSource = await readFile(
  new URL("../apps/mobile/src/features/checkout/CheckoutConnectionScreen.tsx", import.meta.url),
  "utf8",
);
const noticeSource = await readFile(
  new URL("../apps/mobile/src/features/checkout/CheckoutNoticeSections.tsx", import.meta.url),
  "utf8",
);
const portOnePaymentSource = await readFile(
  new URL("../apps/mobile/src/features/checkout/PortOnePaymentScreen.tsx", import.meta.url),
  "utf8",
);

test("checkout point input accepts only whole points and caps to both balance and subtotal", () => {
  assert.equal(normalizedCheckoutPointInput("2500", 3_000, 15_000), "2500");
  assert.equal(normalizedCheckoutPointInput("3,000", 3_000, 15_000), "3000");
  assert.equal(normalizedCheckoutPointInput("99999", 3_000, 15_000), "3000");
  assert.equal(normalizedCheckoutPointInput("3000", 3_000, 1_000), "1000");
  assert.equal(normalizedCheckoutPointInput("-100", 3_000, 15_000), "0");
  assert.equal(normalizedCheckoutPointInput("1.5", 3_000, 15_000), "0");
  assert.equal(normalizedCheckoutPointInput("not-a-number", 3_000, 15_000), "0");
  assert.equal(checkoutPointUsed("3000", 3_000, 1_000), 1_000);
});

test("new checkout requires explicit agreement while pending gacha recovery remains reachable", () => {
  assert.equal(checkoutNeedsAgreement(false), true);
  assert.equal(checkoutNeedsAgreement(true), false);
  assert.match(checkoutSource, /useState\(false\).*agreementAccepted|agreementAccepted.*useState\(false\)/s);
  assert.match(checkoutSource, /recoveringGachaOrder[\s\S]*이전 주문 확인[\s\S]*checkoutNeedsAgreement\(recoveringGachaOrder\)/);
  assert.match(checkoutSource, /checkoutNeedsAgreement\(product\.category === "gacha" && Boolean\(pendingGachaIntent\)\)/);
});

test("checkout keeps unconfigured providers fail-closed while live, points, and internal test checkout remain explicit", () => {
  assert.equal(checkoutPaymentAvailability(6_500, false), "unavailable");
  assert.equal(checkoutPaymentAvailability(0, false), "points");
  assert.equal(checkoutPaymentAvailability(0, true), "points");
  assert.equal(checkoutPaymentAvailability(6_500, true), "demo");
  assert.equal(checkoutPaymentAvailability(6_500, false, true), "live");
  assert.match(checkoutSource, /결제 수단 준비 중/);
  assert.match(checkoutSource, /label=\{!recoveringGachaOrder && paymentAvailability === "unavailable"\s*\? "결제 수단 준비 중"\s*: "구매하기"\}/);
  assert.match(checkoutSource, /loading=\{submitting\}/);
  assert.match(checkoutSource, /paymentAvailability === "unavailable"/);
  assert.match(checkoutSource, /const testPaymentsEnabled = __DEV__ && demoEnabled/);
  assert.match(checkoutSource, /accessibilityRole="radio"/);
  assert.match(checkoutSource, /const paymentMethodsEnabled = testPaymentsEnabled \|\| livePaymentsEnabled/);
  assert.match(checkoutSource, /accessibilityState=\{\{ disabled: !paymentMethodsEnabled, selected \}\}/);
  assert.match(checkoutSource, /onPress=\{\(\) => setSelectedPaymentMethod\(method\.id\)\}/);
  assert.match(checkoutSource, /disabled=\{!paymentMethodsEnabled\}/);
  assert.match(checkoutSource, /paddingBottom: floatingBottomInset \+ seed\.spacing\.x6/);
  assert.match(checkoutSource, /<SeedInputShell focused=\{pointInputFocused\}/);
  assert.match(checkoutSource, /onFocus=\{\(\) => setPointInputFocused\(true\)\}/);
  assert.match(checkoutSource, /onBlur=\{\(\) => setPointInputFocused\(false\)\}/);
  assert.match(checkoutSource, /pressedTranslateY/);
  assert.match(checkoutSource, /pressedScale/);
});

test("the legacy connection route cannot bypass payment into a draw preview", () => {
  assert.match(connectionSource, /<DetailPageHeader title="결제 연결 안내"/);
  assert.match(connectionSource, /<CatalogProductImage/);
  assert.match(connectionSource, /resizeMode="contain"/);
  assert.match(connectionSource, /label="결제 준비로 돌아가기"/);
  assert.match(connectionSource, /결제·주문·추첨권 발급을 진행하지 않아요/);
  assert.doesNotMatch(connectionSource, /\/draw\/preview\//);
  assert.doesNotMatch(connectionSource, /openNextScreen|상품 뽑기/);
  assert.doesNotMatch(connectionSource, /<KoreanPixelTitle/);
  assert.doesNotMatch(connectionSource, /fontSize:\s*(?:7|8|9|10)(?:\D|$)/);
});

test("checkout notices open independently and distinguish gacha from sealed kuji", () => {
  const gachaSections = checkoutNoticeSections("gacha");
  const kujiSections = checkoutNoticeSections("kuji");
  assert.deepEqual(
    gachaSections.map(({ id, title }) => ({ id, title })),
    [
      { id: "payment-refund", title: "결제 및 결과 안내" },
      { id: "shipping-exchange", title: "보관·배송·포인트 안내" },
      { id: "post-shipping", title: "배송 후 문의 안내" },
    ],
  );
  assert.deepEqual(kujiSections.map(({ id }) => id), gachaSections.map(({ id }) => id));
  const firstOpen = toggleCheckoutNoticeState({}, "payment-refund");
  const secondOpen = toggleCheckoutNoticeState(firstOpen, "shipping-exchange");
  assert.deepEqual(secondOpen, { "payment-refund": true, "shipping-exchange": true });
  assert.deepEqual(toggleCheckoutNoticeState(secondOpen, "payment-refund"), {
    "payment-refund": false,
    "shipping-exchange": true,
  });

  const gachaCopy = JSON.stringify(gachaSections);
  const kujiCopy = JSON.stringify(kujiSections);
  const copy = gachaCopy + kujiCopy;
  assert.match(gachaCopy, /결제 전에 포함 상품 목록과 전체·오픈 수량을 확인할 수 있습니다/);
  assert.match(gachaCopy, /각 캡슐을 직접 열 때 서버가 남은 구성에 따라 획득 상품을 확정/);
  assert.match(kujiCopy, /결제 전에 쿠지의 포함 상품과 등급별 남은 수량/);
  assert.match(kujiCopy, /선택한 티켓을 직접 열 때 서버가 획득 상품을 확정/);
  assert.match(copy, /받을 정확한 상품은 결제 전에 알 수 없습니다|봉인된 번호별 정확한 상품은 열기 전까지 알 수 없습니다/);
  assert.match(copy, /결과 화면과 보관함/);
  assert.doesNotMatch(gachaCopy, /봉인된 번호별/);
  assert.doesNotMatch(kujiCopy, /각 캡슐/);
  assert.match(copy, /보관함/);
  assert.match(copy, /다시 결제하지 마세요/);
  assert.match(copy, /24,900원/);
  assert.match(copy, /54,900원/);
  assert.match(copy, /3,000원/);
  assert.match(copy, /60일/);
  assert.match(copy, /50%/);
  assert.doesNotMatch(copy, /결제 시 해당 상품군 내 여러 아이템 중 1종이 무작위로 지급|단순 변심.*환불은 불가능|영상 제출이 필수|쿠폰은 반환·재발급되지 않습니다/);
  assert.doesNotMatch(copy, /픽앤팝|팝페이/);
  assert.match(noticeSource, /accessibilityState=\{\{ expanded: open \}\}/);
  assert.match(noticeSource, /useState<Record<string, boolean>>\(\{ "payment-refund": true \}\)/);
  assert.match(noticeSource, /toggleCheckoutNoticeState\(current, section\.id\)/);
  assert.match(checkoutSource, /<CheckoutNoticeSections category=\{product\.category\} \/>/);
});

test("checkout follows the compact reference hierarchy and exposes only the configured KG INICIS card method", () => {
  for (const label of [
    "구매 상품",
    "쿠폰 사용",
    "포인트 사용",
    "결제 수단",
    "결제 금액",
    "주문내용 확인 및 결제 동의",
    "신용/체크카드",
    "KG이니시스 카드 결제",
  ]) {
    assert.match(checkoutSource, new RegExp(label));
  }
  assert.match(checkoutSource, /unavailableCaption: "결제 채널 미설정"/);
  assert.match(checkoutSource, /EXPO_PUBLIC_PORTONE_STORE_ID/);
  assert.match(checkoutSource, /EXPO_PUBLIC_PORTONE_CHANNEL_KEY/);
  assert.match(checkoutSource, /쿠폰 할인 금액" value="0원"/);
  assert.match(checkoutSource, /AppTextInput as TextInput/);
  assert.match(checkoutSource, /styles\.quantityRow/);
  assert.doesNotMatch(checkoutSource, /<KoreanPixelTitle[^>]*>수량 선택<\/KoreanPixelTitle>/);
  assert.doesNotMatch(checkoutSource, /24,900|54,900|60일|15%/);
  assert.match(checkoutSource, /width: "100%"/);
  for (const title of ["구매 상품", "쿠폰 사용", "포인트 사용", "결제 수단", "결제 금액"]) {
    assert.match(checkoutSource, new RegExp(`<KoreanPixelTitle variant="section" style=\\{styles\\.sectionTitle\\}>${title}</KoreanPixelTitle>`));
  }
  assert.doesNotMatch(checkoutSource, /couponRow[\s\S]*?chevron-down/);
});

test("PortOne return and foreground recovery always re-query the server before opening a draw", () => {
  assert.match(portOnePaymentSource, /payMethod: "CARD"/);
  assert.match(portOnePaymentSource, /currency: "KRW"/);
  assert.match(portOnePaymentSource, /productType: "REAL"/);
  assert.match(portOnePaymentSource, /appScheme: "dabboba:\/\/"/);
  assert.match(portOnePaymentSource, /customer: \{ customerId: order\.userId, fullName: customerName \}/);
  assert.match(portOnePaymentSource, /if \(!customerName\) return null;/);
  assert.match(portOnePaymentSource, /await preparePaymentAttempt\(SecureStore, nextOrder\);\s*const claim = await claimPortOnePaymentAttempt\([\s\S]*?await markPaymentAttemptStarted\(SecureStore, nextOrder\);\s*setOrder\(nextOrder\);\s*setPayerName\(customerName\);\s*setPhase\("paying"\)/);
  assert.match(portOnePaymentSource, /redirectUrl: `dabboba:\/\/checkout\/payment\/\$\{encodeURIComponent\(order\.id\)\}\?paymentId=\$\{encodeURIComponent\(order\.paymentId\)\}`/);
  assert.match(portOnePaymentSource, /await confirmPortOnePayment\([\s\S]*?await fetchCheckoutOrder/);
  assert.match(portOnePaymentSource, /nextOrder\.status === "PAID" \|\| nextOrder\.status === "FULFILLED"/);
  assert.match(portOnePaymentSource, /state !== "active" \|\| order\?\.status !== "PENDING_PAYMENT"/);
  assert.match(portOnePaymentSource, /phase === "paying"\) void refreshOrderOnResume\(order\)/);
  assert.match(portOnePaymentSource, /reconcileOwnedPaymentOnResume\([\s\S]*?\(paymentId\) => confirmPortOnePayment\(/);
  assert.match(portOnePaymentSource, /phase === "pending"\) void load\(\)/);
  assert.match(portOnePaymentSource, /if \(nextOrder\.paymentAttemptStartedAt \|\| await hasStartedPaymentAttempt\(SecureStore, nextOrder\)\) \{[\s\S]*?await confirmPayment\(nextOrder\);[\s\S]*?return;/);
  assert.match(portOnePaymentSource, /await assertPayableKujiOrder\(nextOrder, accessToken\);[\s\S]*?await preparePaymentAttempt\(SecureStore, nextOrder\);[\s\S]*?await claimPortOnePaymentAttempt\(/);
  assert.match(portOnePaymentSource, /if \(nextOrder\.paymentAttemptStartedAt\) \{[\s\S]*?await confirmPayment\(nextOrder\);[\s\S]*?return;/);
  assert.match(portOnePaymentSource, /const localAttemptState = await paymentAttemptState\(SecureStore, nextOrder\);[\s\S]*?if \(localAttemptState === "started"\) \{[\s\S]*?await confirmPayment\(nextOrder\);/);
  assert.match(portOnePaymentSource, /await assertPayableKujiOrder\(nextOrder, tokens\.accessToken\);[\s\S]*?setPhase\("details"\)/);
  assert.match(portOnePaymentSource, /if \(localAttemptState === "preparing"\) \{[\s\S]*?다시 시도해 주세요/);
  assert.match(portOnePaymentSource, /label="주문·뽑기 상태 다시 확인" onPress=\{\(\) => \{ void load\(\); \}\}/);
  assert.doesNotMatch(portOnePaymentSource, /onComplete=\{[^}]*continueToDraw/);
});
