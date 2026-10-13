import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DRAW_PURCHASE_MAX_QUANTITY,
  normalizeDrawPurchaseCount,
} from "../apps/mobile/src/features/draw/draw-purchase-state.ts";
import {
  hasExactKujiTicketSelection,
  toggleKujiTicketSelection,
} from "../apps/mobile/src/features/kuji/kuji-selection-state.ts";

test("draw purchase quantity stays inside stock and the shared purchase limit", () => {
  assert.equal(DRAW_PURCHASE_MAX_QUANTITY, 10);
  assert.equal(normalizeDrawPurchaseCount(undefined, 30), 1);
  assert.equal(normalizeDrawPurchaseCount("3", 30), 3);
  assert.equal(normalizeDrawPurchaseCount("30", 30), 10);
  assert.equal(normalizeDrawPurchaseCount("8", 4), 4);
  assert.equal(normalizeDrawPurchaseCount("1", 0), 0);
  assert.equal(normalizeDrawPurchaseCount("0", 30), 1);
  assert.equal(normalizeDrawPurchaseCount("not-a-number", 30), 1);
});

test("kuji selection stops at the purchased count while still allowing replacements", () => {
  let selected = [];
  selected = toggleKujiTicketSelection(selected, "01", 2);
  selected = toggleKujiTicketSelection(selected, "02", 2);
  selected = toggleKujiTicketSelection(selected, "03", 2);
  assert.deepEqual(selected, ["01", "02"]);
  assert.equal(hasExactKujiTicketSelection(selected, 2), true);

  selected = toggleKujiTicketSelection(selected, "01", 2);
  selected = toggleKujiTicketSelection(selected, "03", 2);
  assert.deepEqual(selected, ["02", "03"]);
  assert.equal(hasExactKujiTicketSelection(selected, 3), false);
});

test("gacha opens checkout while kuji claims its one-person room before checkout", async () => {
  const [productDetail, checkout, kujiDraw] = await Promise.all([
    readFile(new URL("../apps/mobile/src/features/shop/ProductDetailScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../apps/mobile/src/features/checkout/CheckoutScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../apps/mobile/src/features/kuji/KujiDrawScreen.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(productDetail, /product\.category === "kuji"[\s\S]*?buildKujiRoomGatePath\(product\.id\)[\s\S]*?`\/checkout\/\$\{encodeURIComponent\(product\.id\)\}`/);
  assert.match(productDetail, /isDrawCategory\(product\.category\) \? "뽑으러 가기" : "구매 준비"/);
  assert.match(productDetail, /const drawUnavailable = Boolean/);
  assert.match(productDetail, /snapshot\?\.includedProductsLoaded !== true/);
  assert.match(productDetail, /\(commerceEnabled && !snapshot\.drawOdds\?\.entries\.length\)/);
  assert.match(productDetail, /snapshot\.includedProducts\.length === 0/);
  assert.match(productDetail, /disabled=\{!commerceEnabled \|\| drawUnavailable\}/);
  assert.match(productDetail, /if \(!commerceEnabled\) return;/);
  assert.match(productDetail, /buildKujiRoomGatePath/);
  assert.doesNotMatch(productDetail, /buildGachaPreviewParams|resolveKujiEntryPath|결제 금액 확인/);

  for (const copy of ["구매 상품", "구매 수량", "결제 수단 준비 중", "구매하기"]) {
    assert.match(checkout, new RegExp(copy));
  }
  assert.doesNotMatch(checkout, /포인트로 구매하기|원 테스트 결제`|원 결제하기`/);
  assert.doesNotMatch(checkout, /buildGachaPreviewParams|openGachaPreview|\/draw\/preview|체험하기/);
  assert.match(checkout, /createGachaCheckoutOrder/);
  assert.match(checkout, /fetchCheckoutActorId/);
  assert.match(checkout, /readPendingGachaCheckoutOrderIntent/);
  assert.match(checkout, /claimPendingGachaCheckoutOrderIntent/);
  assert.match(checkout, /recordPendingGachaCheckoutOrder\(db, intent, order\)/);
  assert.match(checkout, /paidGachaOrderEntitlementIds\(order, recordedIntent\)/);
  assert.match(checkout, /presentDrawOpenModeChoice\(entitlementIds\.length/);
  assert.match(checkout, /entitlementIds: entitlementIds\.join\(","\),[\s\S]*?mode,/);
  assert.match(checkout, /`\/draw\/reveal\/\$\{encodeURIComponent\(entitlementIds\[0\]!\)\}\?\$\{query\.toString\(\)\}`/);
  assert.match(checkout, /intentCreatedThisAttempt: claim\.kind === "created"/);
  assert.match(checkout, /24시간이 지난 미확정 주문 요청은 중복 결제를 막기 위해 자동으로 다시 보내지 않아요/);
  assert.match(checkout, /kujiCheckoutExpiresAt/);
  assert.match(checkout, /결제 남은 시간/);
  assert.match(checkout, /createKujiCheckoutOrder/);
  assert.match(checkout, /expectedDrawVersion/);
  assert.match(checkout, /pointAmount: pointUsed/);
  assert.match(checkout, /kujiRoomEntryId: kujiEntryId/);
  assert.match(checkout, /paidKujiOrderEntitlementIds\(order, quantity\)/);
  assert.match(checkout, /orderId: order\.id/);
  assert.match(checkout, /kujiEntryId,/);
  assert.match(checkout, /entitlementIds: entitlementIds\.join\(","\)/);
  assert.match(checkout, /`\/kuji\/draw\/\$\{encodeURIComponent\(product\.id\)\}\?\$\{query\.toString\(\)\}`/);
  assert.doesNotMatch(checkout, /resolveKujiEntryPath|LOCAL_KUJI_ROOM_AVAILABILITY/);
  assert.match(checkout, /const drawAvailable = product/);
  assert.match(checkout, /__DEV__ \|\| \(snapshot\?\.drawOdds\?\.entries\.length \?\? 0\) > 0/);
  assert.match(checkout, /최종 결제 예정 \$\{paymentTotal\.toLocaleString\("ko-KR"\)\}원/);
  assert.match(checkout, /order\.status === "PENDING_PAYMENT"/);
  assert.match(checkout, /kujiRoomFixture === "development"[\s\S]*?실제 대기실 연결이 필요해요/);

  assert.match(kujiDraw, /선택 \{selectedTickets\.length\} \/ \{purchasedCount\}장/);
  assert.match(kujiDraw, /selectedTickets\.length !== purchasedCount/);
  assert.match(kujiDraw, /구매 수량 선택 완료/);
  assert.match(kujiDraw, /fetchPaidKujiSelection/);
  assert.match(kujiDraw, /bindPaidKujiSlots/);
  assert.match(kujiDraw, /paidKujiRevealPath/);
  assert.doesNotMatch(kujiDraw, /buildKujiPaymentConfirmation|결제 금액 확인/);
});
