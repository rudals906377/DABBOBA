import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("storage selection rows expose product detail without stealing the selection action", () => {
  const source = read("apps/mobile/src/features/profile/ProfileSectionScreen.tsx");

  assert.match(source, /function SelectableInventoryRow/);
  assert.match(source, /accessibilityLabel=\{`\$\{product\.name\} 상세 보기`\}/);
  assert.match(source, /router\.push\(`\/product\/\$\{encodeURIComponent\(product\.id\)\}`/);
  assert.match(source, /accessibilityRole="checkbox"/);
});

test("exchange and order product summaries open the shared product detail", () => {
  const exchange = read("apps/mobile/src/features/exchange/ExchangeListingDetailScreen.tsx");
  const records = read("apps/mobile/src/features/profile/ProfileRecordDetailScreen.tsx");

  assert.match(exchange, /accessibilityLabel=\{`\$\{product\.name\} 상품 상세 보기`\}/);
  assert.match(exchange, /exchangeListingId=\$\{encodeURIComponent\(exchangeListingId\)\}/);
  assert.match(records, /accessibilityLabel=\{`\$\{line\.productName\} 상품 상세 보기`\}/);
  assert.match(records, /router\.push\(`\/product\/\$\{encodeURIComponent\(line\.productId\)\}`/);
});

test("owned prize links resolve to a read-only shared product detail", () => {
  const api = read("apps/api/src/modules/account.ts");
  const shopApi = read("apps/mobile/src/features/shop/shop-api.ts");
  const detail = read("apps/mobile/src/features/shop/ProductDetailScreen.tsx");

  assert.match(api, /\/v1\/account\/owned-products\/:productId/);
  assert.match(api, /iu\.owner_id=\$1 AND iu\.product_id=\$2/);
  assert.match(shopApi, /\/v1\/account\/owned-products\/\{productId\}/);
  assert.match(shopApi, /\/v1\/catalog\/products\/\{productId\}/);
  assert.match(shopApi, /\/v1\/exchange\/listings\/\{listingId\}/);
  assert.match(shopApi, /candidate\.id === productId/);
  assert.match(shopApi, /ownedCollectible/);
  assert.match(shopApi, /exchangeReference/);
  assert.match(detail, /snapshot\.ownedCollectible/);
  assert.match(detail, /snapshot\?\.exchangeReference/);
  assert.match(detail, /const readOnlyReference = ownedCollectible \|\| exchangeReference/);
  assert.match(detail, /내 보관 상품/);
  assert.match(detail, /교환 등록 상품/);
});

test("customer shipping detail returns and renders product snapshots", () => {
  const openapi = read("packages/contracts/openapi/dabboba.openapi.yaml");
  const api = read("apps/api/src/modules/account.ts");
  const records = read("apps/mobile/src/features/profile/ProfileRecordDetailScreen.tsx");

  assert.match(openapi, /AccountShippingRequestDetail:/);
  assert.match(openapi, /items:\s*\{ type: array, items: \{ \$ref: "#\/components\/schemas\/AccountShippingItem" \} \}/);
  assert.match(api, /loadShippingRequestItems/);
  assert.match(records, /shippingRequest\.items\.map/);
  assert.match(records, /배송 상품/);
});

test("notification detail exposes only validated related-screen navigation", () => {
  const detail = read("apps/mobile/src/features/notifications/NotificationDetailScreen.tsx");
  const target = read("apps/mobile/src/features/notifications/notification-navigation.ts");

  assert.match(detail, /resolveNotificationTarget/);
  assert.match(detail, /관련 화면 보기/);
  assert.match(target, /encodeURIComponent/);
  assert.match(target, /detail\.kind === "order"/);
  assert.match(target, /detail\.kind === "shipping"/);
  assert.match(target, /detail\.kind === "exchange"/);
  assert.match(target, /SAFE_IDENTIFIER\.test\(detail\.id\)/);
  assert.match(target, /ROOT_TARGETS\[destination\.route\]/);
  assert.doesNotMatch(target, /as Href/);
  assert.doesNotMatch(target, /notification\.data|data\.href|data\.url/);
});

test("home omits the unsupported event placeholder", () => {
  const route = "apps/mobile/app/events.tsx";
  const home = read("apps/mobile/src/features/home/HomeScreen.tsx");

  assert.equal(existsSync(path.join(root, route)), true);
  assert.match(read(route), /EventDetailScreen/);
  assert.doesNotMatch(home, /EventNoticeCard|새 이벤트 준비 중/);
});
