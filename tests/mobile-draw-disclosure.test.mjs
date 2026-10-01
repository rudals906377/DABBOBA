import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const detailSource = await readFile(
  new URL("../apps/mobile/src/features/shop/ProductDetailScreen.tsx", import.meta.url),
  "utf8",
);
const quantitySource = await readFile(
  new URL("../apps/mobile/src/features/catalog/remaining-inventory.ts", import.meta.url),
  "utf8",
);
const shopApiSource = await readFile(
  new URL("../apps/mobile/src/features/shop/shop-api.ts", import.meta.url),
  "utf8",
);
const checkoutSource = await readFile(
  new URL("../apps/mobile/src/features/checkout/CheckoutScreen.tsx", import.meta.url),
  "utf8",
);

test("product detail shows included products without presenting illustrative odds as actual odds", () => {
  assert.match(detailSource, /snapshot\.product\.category === "kuji"/);
  assert.match(detailSource, /봉인된 번호별 정확한 상품을 열기 전까지 알 수 없습니다/);
  assert.match(detailSource, /includedProductOpenQuantityLabel\(snapshot\.product, included\.length\)/);
  assert.match(detailSource, /!isDrawCategory\(product\.category\) && shouldShowCatalogInventory\(product, commerceEnabled\)/);
  assert.match(quantitySource, /\$\{totalQuantity\.toLocaleString\("ko-KR"\)\}개 중 \$\{openedQuantity\.toLocaleString\("ko-KR"\)\}개 오픈/);
  assert.match(detailSource, /이 숫자는 계산 방식을 설명하는 예시이며 이 상품의 실제 수량이나 확률이 아닙니다/);
  assert.doesNotMatch(detailSource, /현재 확률 \{entry\.probabilityPercent/);
  assert.doesNotMatch(detailSource, /남은 상품 \{entry\.remainingQuantity/);
  assert.doesNotMatch(detailSource, /includeDrawOdds: false/);
  assert.match(detailSource, /includedPrizes\(snapshot\)/);
  assert.match(detailSource, /entry\.detail \? <Text style=\{styles\.includedOdds\}/);
  assert.match(detailSource, /!snapshot\.includedProductsLoaded/);
  assert.match(detailSource, /snapshot\?\.includedProductsLoaded !== true/);
  assert.match(detailSource, /snapshot\.includedProducts\.length === 0/);
  assert.match(detailSource, /상품 목록을 불러오지 못했어요/);
  assert.match(shopApiSource, /includedProductsLoaded: Boolean\(drawOdds \|\| prizeLineup\)/);
  assert.doesNotMatch(detailSource, /snapshot\?\.drawOdds/);
  assert.match(shopApiSource, /if \(!drawOdds\) \{/);
  assert.match(shopApiSource, /\/prize-lineup/);
  assert.match(checkoutSource, /fetchProductDetail\(runtime\.apiBaseUrl, productId, tokens\.accessToken\)/);
  assert.match(detailSource, /snapshot\.product\.remainingKujiTiers\?\.length \?\? 0/);
  assert.match(detailSource, /남은 상 ·/);
  assert.match(detailSource, /kujiTierDisplayLabel\(tier\)/);
  assert.match(detailSource, /tier\.remainingQuantity\.toLocaleString\("ko-KR"\)/);
});

test("customer and store-review copy distinguish prepayment disclosure from the post-open exact result", () => {
  assert.match(detailSource, /<DrawHighlights category=\{product\.category\}/);
  assert.match(detailSource, /<DrawProductNotices category=\{product\.category\}/);
  assert.match(detailSource, /checkoutNoticeSections\(category\)/);
  assert.doesNotMatch(detailSource, /결제 후 서버가 확정한 결과로 추첨/);
  assert.match(detailSource, /쿠지 구성과 등급별 남은 수량이 공개된 뒤 구매할 수 있어요/);
  assert.match(checkoutSource, /결제 전 확인한 최신 쿠지 구성 정보가 없어 주문을 접수하지 않았어요/);
  assert.match(checkoutSource, /결제 전 확인할 최신 가챠 구성 정보가 없어 주문을 접수하지 않았어요/);
  assert.match(checkoutSource, /가챠 상품 구성이 공개된 뒤 구매할 수 있어요/);
  assert.doesNotMatch(checkoutSource, /확률표가 없어|확률이 공개된 뒤/);
});

test("draw detail exposes the referenced hierarchy without inventing odds or recent results", () => {
  assert.match(detailSource, /상품 목록/);
  assert.match(detailSource, /<CatalogProductImage\s+uri=\{entry\.imageUrl\}/);
  assert.match(detailSource, /<Text numberOfLines=\{2\} style=\{styles\.includedName\}>\{entry\.name\}<\/Text>/);
  assert.match(detailSource, /<RecentDrawSection items=\{recentDraws\}/);
  assert.match(detailSource, /!commerceEnabled \|\| snapshot\.ownedCollectible/);
  assert.match(detailSource, /정식 오픈 후 확정된 뽑기 기록이 생기면 이곳에 표시돼요/);
  assert.match(detailSource, /서버에서 확정된 결과만 표시하며 고객 정보는 공개하지 않아요/);
  assert.match(detailSource, /<DrawProductInformation snapshot=\{snapshot\}/);
  assert.match(detailSource, /중복 상품이 생겼나요/);
  assert.match(detailSource, /상품 공유하기/);
  assert.doesNotMatch(detailSource, /무조건 환불 불가|미확정 재고.*\d+개/);
});

test("product detail cancels stale product and recent-result requests", () => {
  assert.match(detailSource, /loadAbortRef\.current\?\.abort\(\)/);
  assert.match(detailSource, /signal: controller\.signal/);
  assert.match(detailSource, /if \(controller\.signal\.aborted\) return/);
  assert.match(detailSource, /return \(\) => controller\.abort\(\)/);
  assert.match(detailSource, /recentReloadKey, runtime\.apiBaseUrl, snapshot\?\.product\.id/);
  assert.match(detailSource, /setRecentReloadKey\(\(current\) => current \+ 1\)/);
  assert.match(detailSource, /recentDrawState && recentDrawState\.productId === product\?\.id/);
  assert.match(detailSource, /current\?\.product\.id === wishlistProductId/);
  assert.match(detailSource, /!message && snapshot !== null && product === null/);
  assert.doesNotMatch(detailSource, /fetchProductRecentDraws\(runtime\.apiBaseUrl, product\.id\)/);
});
