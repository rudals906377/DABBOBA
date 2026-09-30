import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("functional inventory and account metadata stay on the readable type scale", () => {
  const inventorySource = readSource("apps/mobile/src/components/RemainingInventoryMeter.tsx");
  const catalogRowSource = readSource("apps/mobile/src/components/CatalogProductRow.tsx");
  const notificationSources = [
    readSource("apps/mobile/src/features/notifications/NotificationsScreen.tsx"),
    readSource("apps/mobile/src/features/notifications/NotificationDetailScreen.tsx"),
  ].join("\n");
  const communitySources = [
    readSource("apps/mobile/src/features/dukroom/DukroomScreen.tsx"),
    readSource("apps/mobile/src/features/dukroom/DukroomDetailScreen.tsx"),
  ].join("\n");

  assert.match(inventorySource, /seed\.typography\.catalogMetadata/);
  assert.match(inventorySource, /variant="catalogMetadata"/);
  assert.doesNotMatch(inventorySource, /fontSize:\s*(?:7|8|9|10)(?:\D|$)/);
  assert.match(catalogRowSource, /import \{ CatalogProductImage/);
  assert.match(catalogRowSource, /storefrontUri \?\? primaryUri/);
  assert.match(catalogRowSource, /<CatalogProductImage/);
  assert.match(inventorySource, /flexWrap:\s*"wrap"/g);
  assert.match(inventorySource, /minWidth:\s*64/);
  assert.doesNotMatch(catalogRowSource, />이미지 없음<\/Text>/);
  assert.doesNotMatch(catalogRowSource, />IMAGE<\/Text>/);
  assert.doesNotMatch(notificationSources, /fontSize:\s*(?:7|8|9|10)(?:\D|$)/);
  assert.doesNotMatch(communitySources, /commentDate:[^\n]*fontSize:\s*(?:7|8|9|10)(?:\D|$)/);
});

test("frequent retry and compact controls retain at least a 44 point hit target", () => {
  for (const relativePath of [
    "apps/mobile/src/features/search/ProductSearchScreen.tsx",
    "apps/mobile/src/features/history/ProductHistoryScreen.tsx",
    "apps/mobile/src/features/notifications/NotificationsScreen.tsx",
    "apps/mobile/src/features/dukroom/DukroomScreen.tsx",
  ]) {
    const source = readSource(relativePath);
    assert.match(source, /retryButton:\s*\{[^}]*minHeight:\s*(?:seed\.size\.touchTarget|44)|<SeedActionButton[^>]*size="small"/);
  }

  const seedComponents = readSource("apps/mobile/src/design-system/components.tsx");
  assert.match(seedComponents, /chipTouchTarget:\s*\{[^}]*minHeight:\s*seed\.size\.touchTarget/);
  assert.match(seedComponents, /styles\.chipTouchTarget/);
  assert.match(seedComponents, /styles\.chip,[\s\S]*?selected && styles\.chipSelected/);
});

test("raw account and exchange fields share the visible dark-green focus treatment", () => {
  const seedComponents = readSource("apps/mobile/src/design-system/components.tsx");
  assert.match(seedComponents, /export function SeedTextInput/);
  assert.match(seedComponents, /focused && styles\.textInputFocused/);
  assert.match(seedComponents, /textInputFocused:\s*\{\s*borderColor:\s*seed\.color\.stroke\.focus,\s*borderWidth:\s*2/);

  for (const relativePath of [
    "apps/mobile/src/features/exchange/ExchangeCreateScreen.tsx",
    "apps/mobile/src/features/profile/WantedRequestCreateScreen.tsx",
    "apps/mobile/src/features/profile/AccountBasicInfoEditScreen.tsx",
    "apps/mobile/src/features/profile/AddressEditScreen.tsx",
    "apps/mobile/src/features/profile/ProfileSectionScreen.tsx",
  ]) {
    const source = readSource(relativePath);
    assert.match(source, /SeedTextInput/);
    assert.doesNotMatch(source, /<AppTextInput\b|<TextInput\b/);
  }
});

test("the shared detail header owns stable geometry and accessible actions", () => {
  const source = readSource("apps/mobile/src/components/DetailPageHeader.tsx");
  assert.match(source, /minHeight:\s*seed\.size\.topNavigation/);
  assert.match(source, /seed\.size\.touchTarget/);
  assert.match(source, /<SeedIconButton label=/);

  for (const relativePath of [
    "apps/mobile/src/features/notifications/NotificationsScreen.tsx",
    "apps/mobile/src/features/notifications/NotificationDetailScreen.tsx",
    "apps/mobile/src/features/history/ProductHistoryScreen.tsx",
    "apps/mobile/src/features/dukroom/DukroomDetailScreen.tsx",
    "apps/mobile/src/features/events/EventDetailScreen.tsx",
    "apps/mobile/src/features/auth/LoginScreen.tsx",
    "apps/mobile/src/features/exchange/ExchangeActivityScreen.tsx",
    "apps/mobile/src/features/exchange/ExchangeCreateScreen.tsx",
    "apps/mobile/src/features/exchange/ExchangeOfferScreen.tsx",
    "apps/mobile/src/features/exchange/ExchangeListingDetailScreen.tsx",
    "apps/mobile/src/features/profile/AccountBasicInfoEditScreen.tsx",
    "apps/mobile/src/features/profile/AddressEditScreen.tsx",
    "apps/mobile/src/features/profile/InquiryCreateScreen.tsx",
    "apps/mobile/src/features/profile/InquiryDetailScreen.tsx",
    "apps/mobile/src/features/profile/ProfileMemberDetailScreen.tsx",
    "apps/mobile/src/features/profile/ProfilePolicyDetailScreen.tsx",
    "apps/mobile/src/features/profile/ProfileRecordDetailScreen.tsx",
    "apps/mobile/src/features/profile/ProfileSectionScreen.tsx",
    "apps/mobile/src/features/profile/WantedRequestCreateScreen.tsx",
    "apps/mobile/src/features/profile/WantedRequestDetailScreen.tsx",
  ]) {
    assert.match(readSource(relativePath), /<DetailPageHeader/);
  }
});

test("exchange and account screens keep readable copy, stable selection borders, and one press response", () => {
  const accountSources = [
    "apps/mobile/src/features/exchange/ExchangeActivityScreen.tsx",
    "apps/mobile/src/features/exchange/ExchangeCreateScreen.tsx",
    "apps/mobile/src/features/exchange/ExchangeListingDetailScreen.tsx",
    "apps/mobile/src/features/exchange/ExchangeOfferScreen.tsx",
    "apps/mobile/src/features/exchange/ExchangeRoomScreen.tsx",
    "apps/mobile/src/features/profile/ProfileHomeScreen.tsx",
    "apps/mobile/src/features/profile/ProfileMemberDetailScreen.tsx",
    "apps/mobile/src/features/profile/ProfileRecordDetailScreen.tsx",
    "apps/mobile/src/features/profile/ProfileSectionScreen.tsx",
  ].map(readSource).join("\n");

  assert.doesNotMatch(accountSources, /fontSize:\s*(?:7|8|9|10)(?:\D|$)/);
  assert.doesNotMatch(accountSources, /borderRadius:\s*(?:7|9|13|17|18|21)(?:\D|$)/);
  assert.doesNotMatch(accountSources, /작품 정보 확인 중/);
  assert.doesNotMatch(accountSources, />ITEM<|>ME</);
  assert.match(accountSources, />이미지 없음</);
  assert.match(accountSources, />내 글</);
  assert.match(accountSources, /pressed:\s*\{\s*opacity:\s*seed\.state\.pressedOpacity,\s*transform:\s*\[\{\s*scale:\s*seed\.state\.pressedScale/);
  assert.doesNotMatch(accountSources, /pressed:\s*\{[^}]*opacity:\s*(?:0\.|1(?:\.0)?\b)/);
  assert.match(accountSources, /borderWidth:\s*2,\s*borderColor:\s*seed\.color\.stroke\.neutral/);
  assert.doesNotMatch(accountSources, /selectionRatio:[^\n]*seed\.typography\.micro|status:[^\n]*seed\.typography\.micro/);
});

test("dynamic policy titles wrap readably and kuji selection reserves its border", () => {
  const policySource = readSource("apps/mobile/src/features/profile/ProfilePolicyDetailScreen.tsx");
  const kujiSource = readSource("apps/mobile/src/features/kuji/KujiDrawScreen.tsx");

  assert.match(policySource, /<DetailPageHeader title=\{title\} titleMode="readable" titleNumberOfLines=\{2\}/);
  assert.match(kujiSource, /ticketCard:\s*\{[^}]*aspectRatio:\s*KUJI_TICKET_ASPECT_RATIO[^}]*borderWidth:\s*2/);
  assert.match(kujiSource, /const KUJI_TICKET_ASPECT_RATIO = 1517 \/ 1037;/);
  assert.match(kujiSource, /resizeMode="contain"\s*source=\{require\("\.\.\/\.\.\/\.\.\/assets\/draw\/kuji\/kuji-ticket-front\.png"\)\}/);
  assert.doesNotMatch(kujiSource, /resizeMode="stretch"/);
  assert.doesNotMatch(kujiSource, /ticketSelected:\s*\{[^}]*borderWidth/);
});

test("customer routes capability-gate test payments and hide synthetic community posts", () => {
  const checkout = readSource("apps/mobile/src/features/checkout/CheckoutScreen.tsx");
  const recordDetail = readSource("apps/mobile/src/features/profile/ProfileRecordDetailScreen.tsx");
  const queue = readSource("apps/mobile/src/features/kuji/KujiQueueScreen.tsx");
  const dukroom = readSource("apps/mobile/src/features/dukroom/DukroomScreen.tsx");
  const dukroomDetail = readSource("apps/mobile/src/features/dukroom/DukroomDetailScreen.tsx");

  assert.match(checkout, /const testPaymentsEnabled = __DEV__ && demoEnabled/);
  assert.match(checkout, /testPaymentsEnabled && demoOrder/);
  assert.match(recordDetail, /!snapshot\.isExample[\s\S]*?<DemoPaymentControls/);
  assert.doesNotMatch(recordDetail, /internalCommerce/);
  assert.match(queue, /if \(!internalQueueEnabled \|\| !isKujiRoomApiUnavailable\(error\)\) throw error/);
  assert.match(dukroom, /\.filter\(\(item\) => !item\.isExample\)/);
  assert.match(dukroomDetail, /snapshot\?\.item\.isExample \? null/);
  assert.doesNotMatch(`${checkout}\n${queue}\n${dukroom}\n${dukroomDetail}`, /테스트 계정|데모 계정|계정 A|계정 B|화면 예시/);
});

test("root tab headers stay fixed above their scroll body", () => {
  const dukroomSource = readSource("apps/mobile/src/features/dukroom/DukroomScreen.tsx");
  assert.match(dukroomSource, /<RootPageScaffold header=\{<RootPageHeader>/);
  assert.doesNotMatch(dukroomSource, /<ScrollView[\s\S]*?<RootHeaderActions/);
});

test("Home hero uses a real machine asset and the storage dock always explains the free-shipping gap", () => {
  const homeSource = readSource("apps/mobile/src/features/home/HomeScreen.tsx");
  const storageSource = readSource("apps/mobile/src/features/profile/ProfileSectionScreen.tsx");

  assert.match(homeSource, /capsule-machine-front-empty\.png/);
  assert.match(homeSource, /source=\{HERO_MACHINE\}/);
  assert.doesNotMatch(homeSource, /heroDecor|heroPixel/);
  assert.match(storageSource, /const shippingFee = quote\?\.shippingFee \?\? policy\.shippingFee[\s\S]*?const resultLabel = !policy\.hasSelection[\s\S]*?배송비.*shippingFee[\s\S]*?무료까지/);
  assert.match(storageSource, /<View[\s\S]*?style=\{styles\.shippingProgressRow\}[\s\S]*?<View style=\{styles\.shippingProgressTrack\}>/);
  assert.doesNotMatch(storageSource, /\{selectedCount \? \(\s*<>\s*<View[\s\S]*?style=\{styles\.shippingProgressRow\}/);
});
