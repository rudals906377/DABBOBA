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
  assert.match(productDetail, /!__DEV__ && \(snapshot\?\.drawOdds\?\.entries\.length \?\? 0\) === 0/);
  assert.match(productDetail, /disabled=\{drawUnavailable\}/);
  assert.match(productDetail, /buildKujiRoomGatePath/);
  assert.doesNotMatch(productDetail, /buildGachaPreviewParams|resolveKujiEntryPath|결제 금액 확인/);

  for (const copy of ["수량 선택", "구매 수량", "구매하기"]) {
    assert.match(checkout, new RegExp(copy));
  }
  assert.match(checkout, /buildGachaPreviewParams\(quantity\)/);
  assert.match(checkout, /kujiCheckoutExpiresAt/);
  assert.match(checkout, /결제 남은 시간/);
  assert.match(checkout, /createKujiCheckoutOrder/);
  assert.match(checkout, /expectedDrawVersion/);
  assert.match(checkout, /pointAmount: pointUsed/);
  assert.match(checkout, /kujiRoomEntryId: kujiEntryId/);
  assert.match(checkout, /paidKujiOrderEntitlementIds\(order, quantity\)/);
  assert.match(checkout, /orderId: order\.id/);
  assert.match(checkout, /entitlementIds: entitlementIds\.join\(","\)/);
  assert.match(checkout, /`\/kuji\/draw\/\$\{encodeURIComponent\(product\.id\)\}\?\$\{query\.toString\(\)\}`/);
  assert.doesNotMatch(checkout, /resolveKujiEntryPath|LOCAL_KUJI_ROOM_AVAILABILITY/);
  assert.match(checkout, /const drawAvailable = product/);
  assert.match(checkout, /__DEV__ \|\| \(snapshot\?\.drawOdds\?\.entries\.length \?\? 0\) > 0/);
  assert.match(checkout, /if \(!__DEV__\)/);
  assert.match(checkout, /최종 결제 예정 \$\{paymentTotal\.toLocaleString\("ko-KR"\)\}원/);
  assert.match(checkout, /order\.status === "PENDING_PAYMENT"/);
  assert.match(checkout, /kujiRoomFixture === "development"[\s\S]*?실제 대기실 연결이 필요해요/);

  assert.match(kujiDraw, /선택 \{selectedTickets\.length\} \/ \{purchasedCount\}장/);
  assert.match(kujiDraw, /selectedTickets\.length !== purchasedCount/);
  assert.match(kujiDraw, /구매 수량 선택 완료/);
  assert.doesNotMatch(kujiDraw, /buildKujiPaymentConfirmation|결제 금액 확인/);
});
