import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HOME_GACHA_PRODUCT_CARD_WIDTH,
  HOME_GACHA_PRODUCT_MEDIA_ASPECT_RATIO,
  HOME_KUJI_PRODUCT_CARD_WIDTH,
  HOME_KUJI_PRODUCT_MEDIA_ASPECT_RATIO,
  HOME_NEW_PRODUCT_WINDOW_MS,
  buildPopularIpCoverProductByIpId,
  buildConfiguredHomeCollections,
  buildHomeFeaturedProducts,
  buildHomeCollections,
  buildTodayDrawGroups,
  getHomeProductCardWidth,
  getHomeProductMediaAspectRatio,
  getRecentDrawReelWindow,
  getTickerOverflowDistance,
  homeAnnouncementMessages,
  resolvePopularIpArtwork,
  resolveHomeProductImageUrl,
  resolveHomeProductBadge,
  shouldExpandHomeHero,
  shouldExpandHomeRecentDraw,
} from "../apps/mobile/src/features/home/home-feed.ts";

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

test("configured Home sections keep the admin title and order while filtering unsafe products", () => {
  const configured = buildConfiguredHomeCollections([
    {
      id: "one-piece-featured",
      title: "해적왕 추천",
      subtitle: "쿠지 추천",
      sortOrder: 20,
      isActive: true,
      layoutKind: "kuji",
      sourceKind: "IP",
      visibleLimit: 20,
      ip: ips[2],
      products: [products[4]],
    },
    {
      id: "demon-featured",
      title: "귀멸 특집",
      subtitle: null,
      sortOrder: 10,
      isActive: true,
      layoutKind: "gacha",
      sourceKind: "MANUAL",
      visibleLimit: 1,
      ip: ips[0],
      products: [products[2], products[3]],
    },
    {
      id: "hidden-featured",
      title: "숨긴 특집",
      subtitle: null,
      sortOrder: 0,
      isActive: false,
      layoutKind: "gacha",
      sourceKind: "IP",
      visibleLimit: 20,
      ip: ips[1],
      products: [products[0]],
    },
  ]);

  assert.deepEqual(configured.map(({ id, title }) => [id, title]), [
    ["demon-featured", "귀멸 특집"],
    ["one-piece-featured", "해적왕 추천"],
  ]);
  assert.deepEqual(configured[0].products.map((product) => product.id), ["demon-gacha"]);
  assert.deepEqual(configured.map(({ layoutKind }) => layoutKind), ["gacha", "kuji"]);
  assert.deepEqual(configured.map(({ subtitle, sourceKind, visibleLimit }) => ({ subtitle, sourceKind, visibleLimit })), [
    { subtitle: null, sourceKind: "MANUAL", visibleLimit: 1 },
    { subtitle: "쿠지 추천", sourceKind: "IP", visibleLimit: 20 },
  ]);
});

test("configured Home sections preserve empty active rails and reject products from the other layout", () => {
  const configured = buildConfiguredHomeCollections([
    {
      id: "empty-kuji",
      title: "쿠지 준비 중",
      subtitle: null,
      sortOrder: 0,
      isActive: true,
      layoutKind: "kuji",
      sourceKind: "NEW",
      visibleLimit: 4,
      ip: ips[0],
      products: [products[2]],
    },
  ]);

  assert.equal(configured.length, 1);
  assert.equal(configured[0].layoutKind, "kuji");
  assert.deepEqual(configured[0].products, []);
});

test("configured Home sections support global sources and enforce the operator visible limit", () => {
  const configured = buildConfiguredHomeCollections([{
    id: "global-gacha",
    title: "오늘의 인기상품",
    subtitle: "최근 30일 기준",
    sortOrder: 0,
    isActive: true,
    layoutKind: "gacha",
    sourceKind: "POPULAR",
    visibleLimit: 1,
    ip: null,
    products: [products[2], { ...products[2], id: "second-gacha", ipId: "pokemon" }],
  }]);

  assert.equal(configured.length, 1);
  assert.equal(configured[0].ip, null);
  assert.equal(configured[0].subtitle, "최근 30일 기준");
  assert.equal(configured[0].sourceKind, "POPULAR");
  assert.deepEqual(configured[0].products.map((product) => product.id), ["demon-gacha"]);
});

test("configured Home sections hide legacy cache rows without a valid layoutKind", () => {
  const configured = buildConfiguredHomeCollections([
    {
      id: "legacy-section",
      title: "예전 홈 섹션",
      sortOrder: 0,
      isActive: true,
      ip: ips[0],
      products: [products[2]],
    },
    {
      id: "invalid-section",
      title: "잘못된 홈 섹션",
      sortOrder: 1,
      isActive: true,
      layoutKind: "figure",
      ip: ips[1],
      products: [products[1]],
    },
  ]);

  assert.deepEqual(configured, []);
});

test("today's ppoba keeps gacha and kuji in separate groups and omits coming-soon products", () => {
  const groups = buildTodayDrawGroups(products, 4);

  assert.deepEqual(groups.map(({ category, label }) => [category, label]), [
    ["gacha", "가챠"],
    ["kuji", "쿠지"],
  ]);
  assert.deepEqual(groups[0].products.map((product) => product.id), ["demon-gacha"]);
  assert.deepEqual(groups[1].products.map((product) => product.id), ["one-piece-kuji"]);
  assert.ok(groups.every((group) => group.products.every((product) => product.category !== "figure" && product.category !== "tcg")));
});

test("today's ppoba keeps both group headings when the catalog is empty", () => {
  const groups = buildTodayDrawGroups([], 4);

  assert.deepEqual(groups.map(({ category, label, products: items }) => ({
    category,
    label,
    productCount: items.length,
  })), [
    { category: "gacha", label: "가챠", productCount: 0 },
    { category: "kuji", label: "쿠지", productCount: 0 },
  ]);
});

test("Home featured products keep at most two eligible products and place BEST first", () => {
  const featured = buildHomeFeaturedProducts(products, "one-piece-kuji");

  assert.deepEqual(featured.map((product) => product.id), ["one-piece-kuji", "demon-gacha"]);
  assert.ok(featured.every((product) => product.isActive && !product.isPrizeOnly));
  assert.ok(featured.every((product) => product.category === "gacha" || product.category === "kuji"));
});

test("category rails exclude featured products before applying their item limit", () => {
  const gachaProducts = Array.from({ length: 6 }, (_, index) => ({
    id: `gacha-${index + 1}`,
    ipId: "demon-slayer",
    category: "gacha",
    name: `가챠 ${index + 1}`,
    isActive: true,
    isPrizeOnly: false,
  }));
  const groups = buildTodayDrawGroups(gachaProducts, 3, ["gacha-1", "gacha-2"]);

  assert.deepEqual(groups[0].products.map((product) => product.id), ["gacha-3", "gacha-4", "gacha-5"]);
  assert.equal(groups[1].products.length, 0);
});

test("Home section layoutKind selects distinct gacha and kuji card geometry", () => {
  assert.equal(HOME_GACHA_PRODUCT_CARD_WIDTH, 172);
  assert.equal(HOME_KUJI_PRODUCT_CARD_WIDTH, 228);
  assert.equal(getHomeProductCardWidth("gacha"), HOME_GACHA_PRODUCT_CARD_WIDTH);
  assert.equal(getHomeProductCardWidth("kuji"), HOME_KUJI_PRODUCT_CARD_WIDTH);
  assert.equal(getHomeProductMediaAspectRatio("gacha"), HOME_GACHA_PRODUCT_MEDIA_ASPECT_RATIO);
  assert.equal(getHomeProductMediaAspectRatio("kuji"), HOME_KUJI_PRODUCT_MEDIA_ASPECT_RATIO);
});

test("home announcements include only nonempty published pinned ACTIVE notices", () => {
  const notices = [
    { title: "일반 공지", isPinned: false, isPublished: true, status: "ACTIVE" },
    { title: "홈 상단 공지", isPinned: true, isPublished: true, status: "ACTIVE" },
    { title: "미게시 공지", isPinned: true, isPublished: false, status: "ACTIVE" },
    { title: "숨김 공지", isPinned: true, isPublished: true, status: "HIDDEN" },
  ];

  assert.deepEqual(homeAnnouncementMessages(notices), ["홈 상단 공지"]);
  assert.deepEqual(homeAnnouncementMessages([]), []);
  assert.deepEqual(
    homeAnnouncementMessages(notices.filter((notice) => notice.title !== "홈 상단 공지")),
    [],
  );
  assert.deepEqual(
    homeAnnouncementMessages([
      { title: "같은 제목", isPinned: true, isPublished: true, status: "ACTIVE" },
      { title: "같은 제목", isPinned: true, isPublished: true, status: "ACTIVE" },
    ]),
    ["같은 제목", "같은 제목"],
  );
});

test("home product media keeps low-profile gacha and wide kuji proportions", () => {
  assert.equal(HOME_GACHA_PRODUCT_MEDIA_ASPECT_RATIO, 7 / 5);
  assert.equal(HOME_KUJI_PRODUCT_MEDIA_ASPECT_RATIO, 7 / 4);
});

test("popular IP artwork prefers the dedicated IP square before product thumbnails", () => {
  const ip = { imageUrl: "https://cdn.example/ip-square.webp", version: 4 };
  const product = {
    imageUrl: "https://cdn.example/product.webp",
    storefrontImageUrl: "https://cdn.example/product-list.webp",
    version: 9,
  };

  assert.deepEqual(resolvePopularIpArtwork(ip, product), {
    imageUrl: ip.imageUrl,
    imageVersion: ip.version,
    resizeMode: "cover",
    fallbackArtwork: [
      { imageUrl: product.storefrontImageUrl, imageVersion: product.version, resizeMode: "contain" },
      { imageUrl: product.imageUrl, imageVersion: product.version, resizeMode: "contain" },
    ],
  });
  assert.deepEqual(resolvePopularIpArtwork({ imageUrl: null, version: 4 }, product), {
    imageUrl: product.storefrontImageUrl,
    imageVersion: product.version,
    resizeMode: "contain",
    fallbackArtwork: [
      { imageUrl: product.imageUrl, imageVersion: product.version, resizeMode: "contain" },
    ],
  });
});

test("popular IP product fallback prefers a later storefront asset over an earlier primary-only product", () => {
  const primaryOnly = { ipId: "same-ip", imageUrl: "https://cdn.example/primary.webp", storefrontImageUrl: null, version: 1 };
  const storefront = { ipId: "same-ip", imageUrl: "https://cdn.example/second-primary.webp", storefrontImageUrl: "https://cdn.example/square.webp", version: 2 };
  const blank = { ipId: "blank-ip", imageUrl: " ", storefrontImageUrl: null, version: 3 };
  const otherPrimary = { ipId: "other-ip", imageUrl: "https://cdn.example/other.webp", storefrontImageUrl: null, version: 4 };

  const coverProducts = buildPopularIpCoverProductByIpId([primaryOnly, storefront, blank, otherPrimary]);

  assert.equal(coverProducts.get("same-ip"), storefront);
  assert.equal(coverProducts.has("blank-ip"), false);
  assert.equal(coverProducts.get("other-ip"), otherPrimary);
});

test("home cards prefer dedicated storefront artwork for both draw categories", () => {
  const artwork = {
    imageUrl: "https://cdn.example/product.webp",
    storefrontImageUrl: "https://cdn.example/product-list.webp",
  };

  assert.equal(resolveHomeProductImageUrl({ ...artwork, category: "gacha" }), artwork.storefrontImageUrl);
  assert.equal(resolveHomeProductImageUrl({ ...artwork, category: "kuji" }), artwork.storefrontImageUrl);
});

test("home announcement ticker stays still when the full line fits", () => {
  assert.equal(getTickerOverflowDistance(280, 280), 0);
  assert.equal(getTickerOverflowDistance(280, 264.5), 0);
});

test("home announcement ticker scrolls only by the actual overflow distance", () => {
  assert.ok(Math.abs(getTickerOverflowDistance(280, 312.4) - 32.4) < 0.001);
  assert.equal(getTickerOverflowDistance(0, 312.4), 0);
});

test("Home product badges prefer BEST over NEW and keep the NEW window inclusive to 30 days", () => {
  const evaluatedAt = "2026-09-11T00:00:00.000Z";
  const newProduct = { id: "new-product", createdAt: "2026-08-12T00:00:00.000Z" };

  assert.equal(resolveHomeProductBadge(newProduct, "new-product", evaluatedAt), "BEST");
  assert.equal(resolveHomeProductBadge(newProduct, null, evaluatedAt), "NEW");
  assert.equal(
    resolveHomeProductBadge(
      { id: "old-product", createdAt: new Date(Date.parse(evaluatedAt) - HOME_NEW_PRODUCT_WINDOW_MS - 1).toISOString() },
      null,
      evaluatedAt,
    ),
    null,
  );
});

test("Home product badges reject future or invalid registration timestamps", () => {
  const evaluatedAt = "2026-09-11T00:00:00.000Z";

  assert.equal(resolveHomeProductBadge({ id: "future", createdAt: "2026-09-12T00:00:00.000Z" }, null, evaluatedAt), null);
  assert.equal(resolveHomeProductBadge({ id: "invalid", createdAt: "not-a-date" }, null, evaluatedAt), null);
});

test("recent draw reel keeps one clear record and uses only distinct real neighbors", () => {
  const activity = [
    { id: "draw-1", prizeName: "리치 피규어" },
    { id: "draw-2", prizeName: "어깨쿵 빌런편" },
    { id: "draw-3", prizeName: "인형과 함께" },
  ];

  assert.deepEqual(getRecentDrawReelWindow(activity, 0), {
    previous: activity[2],
    current: activity[0],
    next: activity[1],
  });
  assert.deepEqual(getRecentDrawReelWindow(activity.slice(0, 2), 0), {
    previous: null,
    current: activity[0],
    next: activity[1],
  });
  assert.deepEqual(getRecentDrawReelWindow(activity.slice(0, 1), 0), {
    previous: null,
    current: activity[0],
    next: null,
  });
  assert.deepEqual(getRecentDrawReelWindow([], 0), {
    previous: null,
    current: null,
    next: null,
  });
});

test("recent draw reel leaves fixed-height slot mode before accessibility text clips", () => {
  assert.equal(shouldExpandHomeRecentDraw(1), false);
  assert.equal(shouldExpandHomeRecentDraw(1.3), false);
  assert.equal(shouldExpandHomeRecentDraw(1.3001), true);
  assert.equal(shouldExpandHomeRecentDraw(2), true);
  assert.equal(shouldExpandHomeRecentDraw(Number.NaN), false);
});

test("Home hero expands only after the compact visual scale stops being safe", () => {
  assert.equal(shouldExpandHomeHero(1), false);
  assert.equal(shouldExpandHomeHero(1.3), false);
  assert.equal(shouldExpandHomeHero(1.3001), true);
  assert.equal(shouldExpandHomeHero(2), true);
  assert.equal(shouldExpandHomeHero(Number.NaN), false);
});
