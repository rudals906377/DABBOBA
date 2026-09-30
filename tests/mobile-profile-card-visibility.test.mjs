import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profileApiSource = readFileSync(
  path.join(root, "apps/mobile/src/features/profile/profile-api.ts"),
  "utf8",
);
const profileSectionSource = readFileSync(
  path.join(root, "apps/mobile/src/features/profile/ProfileSectionScreen.tsx"),
  "utf8",
);
const profilePolicySource = readFileSync(
  path.join(root, "apps/mobile/src/features/profile/profile-policies.ts"),
  "utf8",
);
const profileHomeSource = readFileSync(
  path.join(root, "apps/mobile/src/features/profile/ProfileHomeScreen.tsx"),
  "utf8",
);
const storageRootSource = readFileSync(
  path.join(root, "apps/mobile/src/features/profile/StorageRootScreen.tsx"),
  "utf8",
);
const exchangeRoomSource = readFileSync(
  path.join(root, "apps/mobile/src/features/exchange/ExchangeRoomScreen.tsx"),
  "utf8",
);

test("profile discovery hides card products without deleting owned or historical records", () => {
  assert.match(
    profileApiSource,
    /wishlist:\s*wishlistResult\?\.data\s*\?\s*wishlistResult\.data\.items\.filter\(\(item\) => isCustomerBrowsableCatalogCategory\(item\.product\.category\)\)\s*:\s*null/,
  );
  assert.match(
    profileApiSource,
    /attachWantedMediaUrls\([\s\S]*?\(wantedResult\??\.data\?\.items \?\? \[\]\)\.filter\(\(request\) => \([\s\S]*?isCustomerVisibleProductCategory\(request\.category\)/,
  );

  assert.match(profileApiSource, /catalogProducts: products/);
  assert.match(profileApiSource, /const inventoryItems = \[\.\.\.\(inventoryResult\??\.data\?\.items \?\? \[\]\)\]/);
  assert.match(profileApiSource, /inventory: inventoryResult\??\.data \? inventoryItems : null/);
  assert.match(profileApiSource, /orders: ordersResult\??\.data\?\.items \?\? null/);
  assert.match(profileApiSource, /return "카드"/);
});

test("current profile product copy omits the hidden card category", () => {
  const customerProductCopy = `${profileSectionSource}\n${profilePolicySource}`;

  assert.doesNotMatch(customerProductCopy, /피규어·카드|쿠지·피규어·카드/);
  assert.match(customerProductCopy, /쿠지 추첨 상품과 피규어 등 일반 구매 상품/);
  assert.match(customerProductCopy, /쿠지 상품이 하나라도 포함되면 상품 합계 54,900원 이상/);
  assert.match(customerProductCopy, /무료배송 기준 미달 시 배송비 3,000원/);
});

test("storage owns public exchange discovery while profile links only to my exchange activity", () => {
  const publicExchangeEntry = storageRootSource.indexOf('accessibilityLabel="교환방 열기"');
  const storageSessionGate = storageRootSource.indexOf("{isProfileSessionBlocked");

  assert.ok(publicExchangeEntry >= 0 && publicExchangeEntry < storageSessionGate);
  assert.match(storageRootSource, /onPress=\{\(\) => router\.push\("\/exchange"\)\}/);
  assert.match(profileHomeSource, /section: "exchange-activity", label: "내 교환 현황"/);
  assert.match(profileHomeSource, /section === "exchange-activity"[\s\S]*?router\.push\("\/exchange\/activity"\)/);
  assert.doesNotMatch(profileHomeSource, /label: "교환방"/);
  assert.match(exchangeRoomSource, /<DetailPageHeader title="교환방"/);
  assert.match(exchangeRoomSource, /router\.replace\("\/\(tabs\)\/storage"\)/);
  assert.doesNotMatch(exchangeRoomSource, /useRootNavigationScroll|ROOT_NAVIGATION_CONTENT_INSET/);
});

test("profile presents one summary group and three restrained menu groups", () => {
  const summaryStart = profileHomeSource.indexOf("<View style={styles.profileSummaryCard}>");
  const profileIndex = profileHomeSource.indexOf("styles.profileCard", summaryStart);
  const walletIndex = profileHomeSource.indexOf("styles.walletCard", profileIndex);
  const statsIndex = profileHomeSource.indexOf("styles.statsCard", walletIndex);
  const summaryEnd = profileHomeSource.indexOf("</View>", statsIndex);

  assert.ok(summaryStart >= 0 && profileIndex > summaryStart && walletIndex > profileIndex && statsIndex > walletIndex && summaryEnd > statsIndex);
  assert.match(profileHomeSource, /profileSummaryCard:\s*\{[^}]*borderWidth:\s*1[^}]*borderColor:\s*seed\.color\.stroke\.neutral/);
  assert.match(profileHomeSource, /<MenuGroup\s+title="쇼핑"\s+items=\{commerceEnabled/);
  assert.match(profileHomeSource, /COMMERCE_MENU\.filter\(\(item\) => item\.section !== "exchange-activity"\)/);
  assert.match(profileHomeSource, /<MenuGroup title="계정" items=\{ACCOUNT_MENU\}/);
  assert.match(profileHomeSource, /<MenuGroup title="지원" items=\{SUPPORT_MENU\}/);
  assert.match(profileHomeSource, /menuCard:\s*\{[^}]*borderWidth:\s*1/);
  assert.match(profileHomeSource, /menuRowDivider:\s*\{[^}]*marginHorizontal:\s*seed\.spacing\.x4/);
  assert.match(profileHomeSource, /section: "product-history", label: "상품 기록"/);
  assert.match(profileHomeSource, /section === "product-history"[\s\S]*?router\.push\("\/product-history"\)/);
});

test("storage removes the duplicate pills and reveals delivery details only after selection", () => {
  assert.doesNotMatch(profileSectionSource, /AvailabilityPill|storageAvailabilityRow/);
  assert.match(profileSectionSource, />보관 중 \{items\.length\}개</);
  assert.match(profileSectionSource, />진행 중 \{items\.length\}개</);
  assert.match(profileSectionSource, />환급 가능 \{items\.length\}개</);
  assert.match(profileSectionSource, /selectRow:\s*\{[^}]*borderWidth:\s*1/);
  assert.match(profileSectionSource, /selectRowActive:\s*\{\s*borderWidth:\s*2/);
  assert.match(profileSectionSource, /!selectedCount \? \([\s\S]*?styles\.shippingDefaultSummary[\s\S]*?: \([\s\S]*?styles\.shippingSelectionSummary/);
  assert.match(storageRootSource, /exchangeEntry:\s*\{[^}]*minHeight:\s*56/);
});
