import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exchangeCreate = read("apps/mobile/src/features/exchange/ExchangeCreateScreen.tsx");
const exchangeOffer = read("apps/mobile/src/features/exchange/ExchangeOfferScreen.tsx");
const exchangeRoom = read("apps/mobile/src/features/exchange/ExchangeRoomScreen.tsx");
const exchangeDetail = read("apps/mobile/src/features/exchange/ExchangeListingDetailScreen.tsx");
const notifications = read("apps/mobile/src/features/notifications/NotificationsScreen.tsx");
const notificationsApi = read("apps/mobile/src/features/notifications/notifications-api.ts");
const home = read("apps/mobile/src/features/home/HomeScreen.tsx");
const ticker = read("apps/mobile/src/features/home/AnnouncementTicker.tsx");
const event = read("apps/mobile/src/features/events/EventDetailScreen.tsx");
const profileHome = read("apps/mobile/src/features/profile/ProfileHomeScreen.tsx");
const profileSection = read("apps/mobile/src/features/profile/ProfileSectionScreen.tsx");
const wantedDetail = read("apps/mobile/src/features/profile/WantedRequestDetailScreen.tsx");
const tabBar = read("apps/mobile/src/components/RootFloatingTabBar.tsx");

test("exchange registration and offer start with inventory choice without guidance cards", () => {
  assert.equal(existsSync(new URL("../apps/mobile/src/features/exchange/ExchangeGuidance.tsx", import.meta.url)), false);
  for (const source of [exchangeCreate, exchangeOffer]) {
    assert.doesNotMatch(source, /ExchangeSafetyNotice|ExchangeRuleList|ExchangeGuidance|notificationBanner/);
    assert.doesNotMatch(source, /fontFamily: "monospace"/);
    assert.match(source, /<Image accessible=\{false\}/);
  }
  const selectionIndex = exchangeCreate.indexOf("교환 아이템 선택");
  const messageIndex = exchangeCreate.indexOf("교환 메시지");
  assert.ok(selectionIndex > -1 && messageIndex > selectionIndex, "registration begins with the product choice");
  const submit = exchangeOffer.slice(exchangeOffer.indexOf("const submit = useCallback"), exchangeOffer.indexOf("return (\n    <SafeAreaView"));
  assert.match(submit, /Alert\.alert\([\s\S]*?다뽀바 밖에서 연락하거나 거래하면 보호받기 어려우니 교환은 앱 안에서만 진행해 주세요\./);
});

test("exchange room and detail use plain meta rows, spaced labels and login handoff", () => {
  assert.doesNotMatch(exchangeRoom, /#[0-9A-Fa-f]{6}|rgba\(/);
  assert.match(exchangeRoom, /modalScrim/);
  assert.match(exchangeDetail, /openCustomerLogin\(\s*"[^"]+",\s*`\/exchange\/\$\{listingId\}\/offer`,?\s*\)/);
  assert.doesNotMatch(exchangeDetail, /선택완료|A가 올린 상품|#[0-9A-Fa-f]{6}|fontSize: 17/);
  assert.match(exchangeDetail, /"선택 완료"/);
});

test("notification inbox guests and expired sessions use the shared session gate", () => {
  assert.doesNotMatch(notifications, /내정보로 이동/);
  assert.match(notifications, /<ProfileSessionGate[\s\S]*?status=\{sessionGate\}[\s\S]*?returnTo="\/notifications"/);
  assert.match(notifications, /error instanceof ProfileApiError && error\.status === 401[\s\S]*?setSessionGate\("expired"\)/);
  assert.match(notificationsApi, /throw new ProfileApiError\(result\.response\.status, errorMessage\(result\.error, "알림을 불러오지 못했어요\."\)\)/);
});

test("Home event banner is a light routed button and the notice chip uses the pixel accessory", () => {
  const banner = home.slice(home.indexOf("function HomeIntroBanner"), home.indexOf("export function HomeAnnouncement("));
  assert.match(banner, /accessibilityRole="button"/);
  assert.match(banner, /<KoreanPixelTitle variant="compact"/);
  assert.equal((banner.match(/<Text /g) ?? []).length, 1);
  assert.doesNotMatch(home, /#B9C1B9|rgba\(/);
  assert.match(ticker, /<KoreanPixelTitleAccessory style=\{styles\.labelText\}>공지<\/KoreanPixelTitleAccessory>/);
  assert.doesNotMatch(ticker, /fontFamily/);
  assert.doesNotMatch(tabBar, /NotoSansKR_700Bold/);
});

test("event and profile surfaces avoid solid brand blocks and near-black lead cards", () => {
  assert.doesNotMatch(event, /infoCard|brandSolid|width: 68/);
  assert.match(event, /backgroundColor: seed\.color\.background\.brandWeak/);
  assert.match(profileHome, /avatar: \{[^}]*backgroundColor: seed\.color\.background\.brandWeak/);
  assert.match(profileHome, /<KoreanPixelTitle variant="compact" style=\{styles\.menuSectionTitle\}>\{title\}<\/KoreanPixelTitle>/);
  assert.doesNotMatch(profileHome, /fontSize: 19/);
  assert.doesNotMatch(profileSection, /requestLeadTitle|#B8C0B9|#4C5FA8|#EEF0FA|#EEF1EC|<Text style=\{styles\.listHeading\}>/);
  assert.match(profileSection, /<SeedActionButton label="새 신청 작성"/);
  assert.match(profileSection, /<KoreanPixelTitle variant="compact" style=\{styles\.listHeading\}>/);
  assert.equal((profileSection.match(/<Image accessible=\{false\}/g) ?? []).length, 2);
  assert.match(wantedDetail, /<Image accessible=\{false\}/);
});
