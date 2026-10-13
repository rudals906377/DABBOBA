import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { mergeFreshHomeCatalogWithCachedSections } from "../apps/mobile/src/features/home/home-catalog-recovery.ts";
import { isCurrentHomeSectionList } from "../apps/mobile/src/features/home/home-catalog-contract.ts";
import {
  readHomeCatalogCache,
  writeHomeCatalogCache,
} from "../apps/mobile/src/lib/local-database.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const homeSource = readFileSync(path.join(root, "apps/mobile/src/features/home/HomeScreen.tsx"), "utf8");
const catalogApiSource = readFileSync(path.join(root, "apps/mobile/src/features/catalog/catalog-api.ts"), "utf8");

const ip = (overrides = {}) => ({
  id: "demon-slayer",
  slug: "demon-slayer",
  nameKo: "귀멸의 칼날",
  nameEn: null,
  nameJa: null,
  aliases: [],
  description: null,
  imageUrl: null,
  isActive: true,
  version: 2,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-14T00:00:00.000Z",
  ...overrides,
});

const product = (overrides = {}) => ({
  id: "gacha-demon-slayer",
  sku: "GACHA-001",
  ipId: "demon-slayer",
  characterIds: [],
  category: "gacha",
  name: "귀멸의 칼날 캡슐",
  manufacturer: null,
  releaseDate: null,
  price: 5_500,
  availableQuantity: 79,
  totalQuantity: 80,
  remainingKujiTiers: [],
  metadata: {},
  imageUrl: "https://example.test/current.png",
  storefrontImageUrl: null,
  isActive: true,
  isPrizeOnly: false,
  version: 3,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-14T00:00:00.000Z",
  ...overrides,
});

const badgeState = {
  bestProductId: "gacha-demon-slayer",
  evaluatedAt: "2026-09-13T00:00:00.000Z",
};

test("Home section recovery keeps cached operator order while refreshing only currently visible products", () => {
  const currentProduct = product();
  const removedProduct = product({ id: "removed-product", isActive: false });
  const fresh = {
    ips: [ip()],
    products: [currentProduct],
    notices: [{ id: "fresh-notice" }],
    homeSections: null,
    homeProductBadges: { bestProductId: null, evaluatedAt: "2026-09-14T00:00:00.000Z" },
    recentDrawActivity: [{ id: "fresh-draw" }],
    fetchedAt: "2026-09-14T00:00:00.000Z",
  };
  const cached = {
    ...fresh,
    ips: [ip({ version: 1 })],
    products: [product({ version: 1 }), removedProduct],
    notices: [{ id: "cached-notice" }],
    homeSections: {
      configured: true,
      bestProductId: badgeState.bestProductId,
      evaluatedAt: badgeState.evaluatedAt,
      items: [{
        id: "operator-section",
        title: "관리자 지정 진열",
        subtitle: "운영자 추천",
        layoutKind: "gacha",
        sourceKind: "MANUAL",
        visibleLimit: 8,
        sortOrder: 10,
        isActive: true,
        version: 1,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-13T00:00:00.000Z",
        ip: ip({ version: 1 }),
        products: [product({ version: 1 }), removedProduct],
      }],
    },
    homeProductBadges: badgeState,
    recentDrawActivity: null,
    fetchedAt: "2026-09-13T00:00:00.000Z",
  };

  const recovered = mergeFreshHomeCatalogWithCachedSections(fresh, cached);

  assert.equal(recovered.fetchedAt, fresh.fetchedAt);
  assert.deepEqual(recovered.notices, fresh.notices);
  assert.deepEqual(recovered.recentDrawActivity, fresh.recentDrawActivity);
  assert.deepEqual(recovered.products, fresh.products);
  assert.equal(recovered.homeSections?.items[0]?.title, "관리자 지정 진열");
  assert.equal(recovered.homeSections?.items[0]?.ip.version, 2);
  assert.deepEqual(recovered.homeSections?.items[0]?.products, [currentProduct]);
  assert.deepEqual(recovered.homeProductBadges, badgeState);
});

test("Home section recovery keeps global sections without inventing an IP scope", () => {
  const currentProduct = product({ ipId: "demon-slayer" });
  const fresh = {
    ips: [ip()],
    products: [currentProduct],
    notices: [],
    homeSections: null,
    homeProductBadges: { bestProductId: null, evaluatedAt: "2026-09-14T00:00:00.000Z" },
    recentDrawActivity: [],
    fetchedAt: "2026-09-14T00:00:00.000Z",
  };
  const cached = {
    ...fresh,
    homeSections: {
      configured: true,
      bestProductId: null,
      evaluatedAt: "2026-09-13T00:00:00.000Z",
      items: [{
        id: "global-popular",
        title: "오늘의 인기상품",
        subtitle: null,
        layoutKind: "gacha",
        sourceKind: "POPULAR",
        visibleLimit: 10,
        sortOrder: 0,
        isActive: true,
        version: 1,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-13T00:00:00.000Z",
        ip: null,
        products: [product({ version: 1 })],
      }],
    },
  };

  const recovered = mergeFreshHomeCatalogWithCachedSections(fresh, cached);

  assert.equal(recovered.homeSections?.items[0]?.ip, null);
  assert.deepEqual(recovered.homeSections?.items[0]?.products, [currentProduct]);
});

test("Home section recovery never replaces an available server response with cached configuration", () => {
  const liveSections = {
    configured: true,
    bestProductId: null,
    evaluatedAt: "2026-09-14T00:00:00.000Z",
    items: [],
  };
  const fresh = {
    ips: [ip()],
    products: [product()],
    notices: [],
    homeSections: liveSections,
    homeProductBadges: { bestProductId: null, evaluatedAt: liveSections.evaluatedAt },
    recentDrawActivity: [],
    fetchedAt: liveSections.evaluatedAt,
  };
  const cached = {
    ...fresh,
    homeSections: { ...liveSections, items: [{ id: "stale" }] },
  };

  assert.equal(mergeFreshHomeCatalogWithCachedSections(fresh, cached), fresh);
});

test("a legacy Home response is rejected instead of silently rendering a blank feed", () => {
  const currentSection = {
    id: "operator-section",
    title: "관리자 지정 진열",
    subtitle: null,
    layoutKind: "gacha",
    sourceKind: "MANUAL",
    visibleLimit: 8,
    sortOrder: 10,
    isActive: true,
    version: 1,
    products: [product()],
  };
  const response = {
    configured: true,
    bestProductId: null,
    evaluatedAt: "2026-09-14T00:00:00.000Z",
    items: [currentSection],
  };

  assert.equal(isCurrentHomeSectionList(response), true);
  assert.equal(isCurrentHomeSectionList({ ...response, items: [] }), true);
  assert.equal(isCurrentHomeSectionList({ ...response, items: [{ ...currentSection, layoutKind: undefined }] }), false);
  assert.equal(isCurrentHomeSectionList({ ...response, items: [{ ...currentSection, sourceKind: undefined }] }), false);
  assert.equal(isCurrentHomeSectionList({ ...response, items: [{ ...currentSection, products: [product({ category: "kuji" })] }] }), false);
  assert.equal(isCurrentHomeSectionList({ ...response, configured: false }), false);
  assert.match(catalogApiSource, /isCurrentHomeSectionList\(homeSectionResult\?\.data\)/);
});

test("partial Home snapshots cannot overwrite a previously verified section cache", async () => {
  const calls = [];
  const db = { runAsync: async (...args) => { calls.push(args); } };
  const snapshot = {
    ips: [ip()],
    products: [product()],
    notices: [],
    homeSections: null,
    homeProductBadges: { bestProductId: null, evaluatedAt: "2026-09-14T00:00:00.000Z" },
    recentDrawActivity: [],
    fetchedAt: "2026-09-14T00:00:00.000Z",
  };

  await writeHomeCatalogCache(db, snapshot);
  assert.equal(calls.length, 0);

  await writeHomeCatalogCache(db, {
    ...snapshot,
    homeSections: {
      configured: false,
      bestProductId: null,
      evaluatedAt: snapshot.fetchedAt,
      items: [],
    },
  });
  assert.equal(calls.length, 1);
});

test("Home cache never replays stale recent draw records", async () => {
  const recentDrawActivity = [
    { id: "draw-1" },
    { id: "draw-2" },
    { id: "draw-3" },
  ];
  const writes = [];
  const writableDb = { runAsync: async (...args) => { writes.push(args); } };
  const snapshot = {
    ips: [ip()],
    products: [product()],
    notices: [],
    homeSections: {
      configured: false,
      bestProductId: null,
      evaluatedAt: "2026-09-14T00:00:00.000Z",
      items: [],
    },
    homeProductBadges: { bestProductId: null, evaluatedAt: "2026-09-14T00:00:00.000Z" },
    recentDrawActivity,
    fetchedAt: "2026-09-14T00:00:00.000Z",
  };

  await writeHomeCatalogCache(writableDb, snapshot);
  const writtenPayload = JSON.parse(writes[0][2]);
  assert.equal(writtenPayload.recentDrawActivity, null);

  const readableDb = {
    getFirstAsync: async () => ({ payload: JSON.stringify(snapshot) }),
  };
  const cached = await readHomeCatalogCache(readableDb);
  assert.equal(cached?.recentDrawActivity, null);
});

test("Home cache refuses old mixed sections while preserving usable catalog data", async () => {
  const cached = await readHomeCatalogCache({
    getFirstAsync: async () => ({ payload: JSON.stringify({
      ips: [ip()],
      products: [product()],
      notices: [],
      homeSections: {
        configured: true,
        bestProductId: null,
        evaluatedAt: "2026-09-14T00:00:00.000Z",
        items: [{ id: "old-mixed-section", title: "예전 진열", products: [product()] }],
      },
      recentDrawActivity: [{ id: "stale-draw" }],
      fetchedAt: "2026-09-14T00:00:00.000Z",
    }) }),
  });
  assert.equal(cached?.products.length, 1);
  assert.equal(cached?.homeSections, null);
  assert.equal(cached?.recentDrawActivity, null);
});

test("Home settles catalog and recent activity independently", () => {
  assert.match(catalogApiSource, /return result\.data\.items\.slice\(0, 2\)/);
  assert.doesNotMatch(catalogApiSource, /recentDrawRequest = client\.GET/);
  assert.match(homeSource, /Promise\.allSettled\(\[/);
  assert.match(homeSource, /fetchHomeCatalog\(runtime\.apiBaseUrl\)/);
  assert.match(homeSource, /fetchHomeRecentDrawActivity\(runtime\.apiBaseUrl\)/);
  assert.match(homeSource, /recentResult\.status === "fulfilled"/);
  assert.doesNotMatch(homeSource, /cached\?\.recentDrawActivity \?\? null/);
  assert.match(homeSource, /<RecentDrawActivityPanel[\s\S]*?activity=\{recentDrawActivity\}/);
});

test("Home isolates section request failure and renders truthful operator-feed recovery states", () => {
  assert.match(catalogApiSource, /homeSectionRequest = client\.GET\("\/v1\/catalog\/home-sections"\)\.catch\(\(\) => null\)/);
  assert.match(homeSource, /mergeFreshHomeCatalogWithCachedSections\(fresh, cached\)/);
  assert.match(homeSource, /홈 진열 정보를 불러오지 못해 마지막으로 확인한 구성을 보여드려요\./);
  assert.match(homeSource, /홈 상품을 불러오지 못했어요/);
  assert.match(homeSource, /홈에 진열된 상품이 아직 없어요\./);
  assert.match(homeSource, /!snapshot\.homeSections\.configured \|\| snapshot\.homeSections\.items\.length === 0/);
  assert.match(homeSource, /error \? "다시 불러오기" : "가챠샵 둘러보기"/);
  assert.match(homeSource, /router\.push\("\/\(tabs\)\/gacha" as Href\)/);
  assert.doesNotMatch(homeSource, /buildTodayDrawGroups|buildHomeFeaturedProducts|buildHomeCollections|DEFAULT_HOME_COLLECTION_IP_IDS/);
});
