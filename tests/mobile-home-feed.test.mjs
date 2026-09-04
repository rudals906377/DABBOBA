import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HOME_ANNOUNCEMENT_FALLBACKS,
  buildDrawActivityExamples,
  buildDrawActivityTickerWindow,
  buildHomeCollections,
  getHomeProductCardWidth,
  getTickerOverflowDistance,
  homeAnnouncementMessages,
} from "../apps/mobile/src/features/home/home-feed.ts";
import { productSubjectTitle } from "../apps/mobile/src/features/shop/product-title.ts";

const ips = [
  { id: "demon-slayer", nameKo: "귀멸의 칼날" },
  { id: "pokemon", nameKo: "포켓몬스터" },
  { id: "one-piece", nameKo: "원피스" },
];

const products = [
  { id: "pokemon-card", ipId: "pokemon", category: "tcg", name: "포켓몬 카드", isActive: true, isPrizeOnly: false },
  { id: "pokemon-figure", ipId: "pokemon", category: "figure", name: "포켓몬 피규어", isActive: true, isPrizeOnly: false },
  { id: "demon-gacha", ipId: "demon-slayer", category: "gacha", name: "귀멸의 칼날 귀멸 캡슐", isActive: true, isPrizeOnly: false },
  { id: "demon-prize", ipId: "demon-slayer", category: "gacha", name: "직접 판매 불가 경품", isActive: true, isPrizeOnly: true },
  { id: "one-piece-kuji", ipId: "one-piece", category: "kuji", name: "원피스 쿠지", isActive: true, isPrizeOnly: false },
  { id: "inactive", ipId: "pokemon", category: "gacha", name: "판매 종료", isActive: false, isPrizeOnly: false },
];

test("home collections follow an externally supplied IP order and omit unavailable product categories", () => {
  const collections = buildHomeCollections(ips, products, ["demon-slayer", "pokemon", "missing"]);

  assert.deepEqual(collections.map((collection) => collection.id), ["demon-slayer"]);
  assert.deepEqual(collections.map((collection) => collection.title), ["귀멸의 칼날 컬렉션"]);
  assert.deepEqual(collections[0].products.map((product) => product.id), ["demon-gacha"]);
});

test("home kuji cards use the available phone width while other categories stay compact", () => {
  assert.equal(getHomeProductCardWidth("kuji", 368, 16), 336);
  assert.equal(getHomeProductCardWidth("gacha", 368, 16), 164);
  assert.equal(getHomeProductCardWidth("figure", 368, 16), 164);
  assert.equal(getHomeProductCardWidth("tcg", 368, 16), 164);
  assert.equal(getHomeProductCardWidth("kuji", 834, 24), 520);
});

test("home announcements prefer published pinned notices and otherwise use safe service guidance", () => {
  const notices = [
    { title: "일반 공지", isPinned: false, isPublished: true, status: "ACTIVE" },
    { title: "홈 상단 공지", isPinned: true, isPublished: true, status: "ACTIVE" },
    { title: "숨김 공지", isPinned: true, isPublished: true, status: "HIDDEN" },
  ];

  assert.deepEqual(homeAnnouncementMessages(notices), ["홈 상단 공지"]);
  assert.deepEqual(homeAnnouncementMessages([]), [...HOME_ANNOUNCEMENT_FALLBACKS]);
  assert.ok(HOME_ANNOUNCEMENT_FALLBACKS.every((message) => !message.includes("카드")));
});

test("home announcement ticker stays still when the full line fits", () => {
  assert.equal(getTickerOverflowDistance(280, 280), 0);
  assert.equal(getTickerOverflowDistance(280, 264.5), 0);
});

test("home announcement ticker scrolls only by the actual overflow distance", () => {
  assert.ok(Math.abs(getTickerOverflowDistance(280, 312.4) - 32.4) < 0.001);
  assert.equal(getTickerOverflowDistance(0, 312.4), 0);
});

test("draw activity examples use only draw categories and stay explicitly non-live", () => {
  const activity = buildDrawActivityExamples(products, ips, productSubjectTitle);

  assert.deepEqual(activity.map((item) => item.productId), ["demon-gacha", "one-piece-kuji"]);
  assert.ok(activity.every((item) => item.isExample));
  assert.deepEqual(activity.map((item) => item.personName), ["모찌수집가", "캡슐헌터"]);
  assert.deepEqual(activity.map((item) => item.productName), ["귀멸 캡슐", "쿠지"]);
  assert.ok(activity.every((item) => !item.message.includes("귀멸의 칼날") && !item.message.includes("원피스")));
  assert.ok(activity.every((item) => item.message.endsWith("뽑았어요")));
  assert.match(activity[0].message, /귀멸 캡슐을 뽑았어요$/);
  assert.match(activity[1].message, /쿠지를 뽑았어요$/);
});

test("draw activity ticker keeps three visible rows and stages the next item below them", () => {
  const items = [
    { id: "draw-a" },
    { id: "draw-b" },
    { id: "draw-c" },
    { id: "draw-d" },
  ];

  assert.deepEqual(
    buildDrawActivityTickerWindow(items, 0, 3).map((item) => item.id),
    ["draw-a", "draw-b", "draw-c", "draw-d"],
  );
  assert.deepEqual(
    buildDrawActivityTickerWindow(items, 2, 3).map((item) => item.id),
    ["draw-c", "draw-d", "draw-a", "draw-b"],
  );
  assert.deepEqual(
    buildDrawActivityTickerWindow(items.slice(0, 3), 0, 3).map((item) => item.id),
    ["draw-a", "draw-b", "draw-c", "draw-a"],
  );
  assert.deepEqual(buildDrawActivityTickerWindow([], 0, 3), []);
});
