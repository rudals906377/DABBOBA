import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readOptionalSource = (relativePath) => {
  const filePath = path.join(root, relativePath);
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
};
const mobilePackage = JSON.parse(readFileSync(path.join(root, "apps/mobile/package.json"), "utf8"));
const mobileAppConfig = JSON.parse(readFileSync(path.join(root, "apps/mobile/app.json"), "utf8"));
const mobileSource = readFileSync(path.join(root, "apps/mobile/App.tsx"), "utf8");
const webShellSource = readFileSync(path.join(root, "apps/mobile/webShell.ts"), "utf8");
const rootLayoutSource = readFileSync(path.join(root, "apps/mobile/app/_layout.tsx"), "utf8");
const tabsLayoutSource = readFileSync(path.join(root, "apps/mobile/app/(tabs)/_layout.tsx"), "utf8");
const gachaCapsuleIconSource = readFileSync(path.join(root, "apps/mobile/src/components/GachaCapsuleIcon.tsx"), "utf8");
const kujiTicketIconSource = readOptionalSource("apps/mobile/src/components/KujiTicketIcon.tsx");
const rootObjectTabIconSource = readOptionalSource("apps/mobile/src/components/RootObjectTabIcon.tsx");
const homeSource = readFileSync(path.join(root, "apps/mobile/src/features/home/HomeScreen.tsx"), "utf8");
const homeFeedSource = readOptionalSource("apps/mobile/src/features/home/home-feed.ts");
const announcementTickerSource = readOptionalSource("apps/mobile/src/features/home/AnnouncementTicker.tsx");
const exchangeRouteSource = readFileSync(path.join(root, "apps/mobile/app/exchange/index.tsx"), "utf8");
const exchangeDetailRouteSource = readFileSync(path.join(root, "apps/mobile/app/exchange/[listingId].tsx"), "utf8");
const exchangeCreateRouteSource = readOptionalSource("apps/mobile/app/exchange/new.tsx");
const exchangeOfferRouteSource = readOptionalSource("apps/mobile/app/exchange/[listingId]/offer.tsx");
const exchangeActivityRouteSource = readOptionalSource("apps/mobile/app/exchange/activity.tsx");
const exchangeRoomSource = readFileSync(path.join(root, "apps/mobile/src/features/exchange/ExchangeRoomScreen.tsx"), "utf8");
const exchangeDetailSource = readFileSync(path.join(root, "apps/mobile/src/features/exchange/ExchangeListingDetailScreen.tsx"), "utf8");
const exchangeCreateSource = readOptionalSource("apps/mobile/src/features/exchange/ExchangeCreateScreen.tsx");
const exchangeOfferSource = readOptionalSource("apps/mobile/src/features/exchange/ExchangeOfferScreen.tsx");
const exchangeActivitySource = readOptionalSource("apps/mobile/src/features/exchange/ExchangeActivityScreen.tsx");
const exchangeApiSource = readFileSync(path.join(root, "apps/mobile/src/features/exchange/exchange-api.ts"), "utf8");
const exchangeVisibilitySource = readFileSync(path.join(root, "apps/mobile/src/features/exchange/exchange-visibility.ts"), "utf8");
const gachaRouteSource = readFileSync(path.join(root, "apps/mobile/app/(tabs)/gacha.tsx"), "utf8");
const kujiRouteSource = readFileSync(path.join(root, "apps/mobile/app/(tabs)/kuji.tsx"), "utf8");
const legacyPpobaRouteSource = readFileSync(path.join(root, "apps/mobile/app/ppoba.tsx"), "utf8");
const productDetailRouteSource = readFileSync(path.join(root, "apps/mobile/app/product/[productId].tsx"), "utf8");
const checkoutRouteSource = readOptionalSource("apps/mobile/app/checkout/[productId].tsx");
const checkoutConnectionRouteSource = readOptionalSource("apps/mobile/app/checkout/connect/[productId].tsx");
const shopSource = readFileSync(path.join(root, "apps/mobile/src/features/shop/ShopScreen.tsx"), "utf8");
const shopNavigationSource = readOptionalSource("apps/mobile/src/features/shop/shop-navigation.ts");
const shopFilterSource = readOptionalSource("apps/mobile/src/features/shop/shop-filter.ts");
const productDetailSource = readFileSync(path.join(root, "apps/mobile/src/features/shop/ProductDetailScreen.tsx"), "utf8");
const shopApiSource = readFileSync(path.join(root, "apps/mobile/src/features/shop/shop-api.ts"), "utf8");
const checkoutScreenSource = readOptionalSource("apps/mobile/src/features/checkout/CheckoutScreen.tsx");
const checkoutConnectionScreenSource = readOptionalSource("apps/mobile/src/features/checkout/CheckoutConnectionScreen.tsx");
const checkoutApiSource = readOptionalSource("apps/mobile/src/features/checkout/checkout-api.ts");
const drawRevealSource = readOptionalSource("apps/mobile/src/features/draw/DrawRevealScreen.tsx");
const kujiDrawSource = readOptionalSource("apps/mobile/src/features/kuji/KujiDrawScreen.tsx");
const kujiQueueSource = readOptionalSource("apps/mobile/src/features/kuji/KujiQueueScreen.tsx");
const storageRouteSource = readFileSync(path.join(root, "apps/mobile/app/(tabs)/storage.tsx"), "utf8");
const storageRootSource = readOptionalSource("apps/mobile/src/features/profile/StorageRootScreen.tsx");
const dukroomDetailRouteSource = readFileSync(path.join(root, "apps/mobile/app/dukroom/[postId].tsx"), "utf8");
const dukroomSource = readFileSync(path.join(root, "apps/mobile/src/features/dukroom/DukroomScreen.tsx"), "utf8");
const dukroomDetailSource = readFileSync(path.join(root, "apps/mobile/src/features/dukroom/DukroomDetailScreen.tsx"), "utf8");
const dukroomApiSource = readFileSync(path.join(root, "apps/mobile/src/features/dukroom/dukroom-api.ts"), "utf8");
const profileRouteSource = readFileSync(path.join(root, "apps/mobile/app/(tabs)/profile.tsx"), "utf8");
const homeDeepLinkRouteSource = readFileSync(path.join(root, "apps/mobile/app/home.tsx"), "utf8");
const profileDetailRouteSource = readFileSync(path.join(root, "apps/mobile/app/profile/[section].tsx"), "utf8");
const profileMemberRouteSource = readFileSync(path.join(root, "apps/mobile/app/profile/member/[section].tsx"), "utf8");
const profileHomeSource = readFileSync(path.join(root, "apps/mobile/src/features/profile/ProfileHomeScreen.tsx"), "utf8");
const profileSectionSource = readFileSync(path.join(root, "apps/mobile/src/features/profile/ProfileSectionScreen.tsx"), "utf8");
const profileMemberSource = readFileSync(path.join(root, "apps/mobile/src/features/profile/ProfileMemberDetailScreen.tsx"), "utf8");
const profileRecordDetailSource = readOptionalSource("apps/mobile/src/features/profile/ProfileRecordDetailScreen.tsx");
const profileApiSource = readFileSync(path.join(root, "apps/mobile/src/features/profile/profile-api.ts"), "utf8");
const shippingPolicySource = readFileSync(path.join(root, "apps/mobile/src/features/profile/shipping-policy.ts"), "utf8");
const rootHeaderActionsSource = readOptionalSource("apps/mobile/src/components/RootHeaderActions.tsx");
const rootPageHeaderSource = readOptionalSource("apps/mobile/src/components/RootPageHeader.tsx");
const rootFloatingTabBarSource = readOptionalSource("apps/mobile/src/components/RootFloatingTabBar.tsx");
const searchRouteSource = readOptionalSource("apps/mobile/app/search.tsx");
const searchScreenSource = readOptionalSource("apps/mobile/src/features/search/ProductSearchScreen.tsx");
const productHistoryRouteSource = readOptionalSource("apps/mobile/app/product-history.tsx");
const productHistoryScreenSource = readOptionalSource("apps/mobile/src/features/history/ProductHistoryScreen.tsx");
const notificationsRouteSource = readOptionalSource("apps/mobile/app/notifications.tsx");
const notificationsScreenSource = readOptionalSource("apps/mobile/src/features/notifications/NotificationsScreen.tsx");
const notificationsApiSource = readOptionalSource("apps/mobile/src/features/notifications/notifications-api.ts");
const notificationNavigationSource = readOptionalSource("apps/mobile/src/features/notifications/notification-navigation.ts");
const prototypeCss = readFileSync(path.join(root, "src/prototype.css"), "utf8");
const catalogApiSource = readFileSync(path.join(root, "apps/mobile/src/features/catalog/catalog-api.ts"), "utf8");
const productCategoriesSource = readFileSync(path.join(root, "apps/mobile/src/features/catalog/product-categories.ts"), "utf8");
const localDatabaseSource = readFileSync(path.join(root, "apps/mobile/src/lib/local-database.ts"), "utf8");
const sessionStoreSource = readFileSync(path.join(root, "apps/mobile/src/lib/session-store.ts"), "utf8");
const demoApiSource = readOptionalSource("apps/mobile/src/features/demo/demo-api.ts");
const rootCategoryTitleSource = readOptionalSource("apps/mobile/src/components/RootCategoryTitle.tsx");
const typographySource = readOptionalSource("apps/mobile/src/components/Typography.tsx");
const catalogProductRowSource = readOptionalSource("apps/mobile/src/components/CatalogProductRow.tsx");
const catalogProductImageSource = readOptionalSource("apps/mobile/src/components/CatalogProductImage.tsx");
const catalogDiscoveryImageSource = readOptionalSource("apps/mobile/src/components/CatalogDiscoveryImage.tsx");
const catalogProductImageStateSource = readOptionalSource("apps/mobile/src/components/catalog-product-image-state.ts");
const seedTokensSource = readOptionalSource("apps/mobile/src/design-system/seed.ts");
const seedComponentsSource = readOptionalSource("apps/mobile/src/design-system/components.tsx");
const brandAccentSource = readOptionalSource("apps/mobile/src/design-system/brand-accent.ts");
const runtimeConfigSource = readFileSync(path.join(root, "apps/mobile/src/lib/runtime-config.ts"), "utf8");
const nativeIntentSource = readFileSync(path.join(root, "apps/mobile/app/+native-intent.ts"), "utf8");
const runtimeSource = readFileSync(path.join(root, "src/mobile/MobileRuntime.tsx"), "utf8");
const requireFromMobile = createRequire(path.join(root, "apps/mobile/package.json"));
const ts = requireFromMobile("typescript");

function loadCatalogProductImageStateModule() {
  const output = ts.transpileModule(catalogProductImageStateSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "catalog-product-image-state.ts",
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, JSON });
  return module.exports;
}

const catalogProductImageState = loadCatalogProductImageStateModule();

function collectTsxSources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTsxSources(entryPath);
    if (!entry.isFile() || !entry.name.endsWith(".tsx")) return [];
    return [[path.relative(root, entryPath), readFileSync(entryPath, "utf8")]];
  });
}

function loadWebShellModule() {
  const output = ts.transpileModule(webShellSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "webShell.ts",
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, URL });
  return module.exports;
}

const webShell = loadWebShellModule();

function loadRuntimeConfigModule() {
  const output = ts.transpileModule(runtimeConfigSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "runtime-config.ts",
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, URL });
  return module.exports;
}

const runtimeConfig = loadRuntimeConfigModule();

function loadNativeIntentModule() {
  const output = ts.transpileModule(nativeIntentSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "+native-intent.ts",
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports });
  return module.exports;
}

const nativeIntent = loadNativeIntentModule();

test("native intent rejects unsafe system paths before Expo Router parsing", () => {
  const { MAX_SYSTEM_PATH_LENGTH, redirectSystemPath } = nativeIntent;
  assert.ok(Number.isInteger(MAX_SYSTEM_PATH_LENGTH));
  assert.ok(MAX_SYSTEM_PATH_LENGTH >= 1024 && MAX_SYSTEM_PATH_LENGTH <= 8192);
  assert.equal((nativeIntentSource.match(/\bdecodeURIComponent\s*\(/g) ?? []).length, 1);
  assert.ok(
    nativeIntentSource.indexOf("path.length > MAX_SYSTEM_PATH_LENGTH")
      < nativeIntentSource.indexOf("decodeURIComponent(path)"),
    "length rejection must run before percent-decoding validation",
  );

  for (const path of [
    "/",
    "/product/product-123?from=notification%2Fdetail#result",
    "dabboba://auth/callback?code=valid%2Bcode&state=state%3Dvalue",
    "exp://127.0.0.1:8084/--/(tabs)?platform=ios",
  ]) {
    assert.equal(redirectSystemPath({ path, initial: true }), path);
    assert.equal(redirectSystemPath({ path, initial: false }), path);
  }

  const boundaryPath = `/${"a".repeat(MAX_SYSTEM_PATH_LENGTH - 1)}`;
  assert.equal(boundaryPath.length, MAX_SYSTEM_PATH_LENGTH);
  assert.equal(redirectSystemPath({ path: boundaryPath, initial: true }), boundaryPath);
  assert.equal(redirectSystemPath({ path: `${boundaryPath}a`, initial: true }), "/");
  assert.equal(redirectSystemPath({ path: `${boundaryPath}a`, initial: false }), null);

  for (const path of ["/search?q=%", "/search?q=%GG", "/search?q=%E0%A4", "/search?q=%C0%AF"]) {
    assert.equal(redirectSystemPath({ path, initial: true }), "/");
    assert.equal(redirectSystemPath({ path, initial: false }), null);
  }
});

test("the public English home deep link resolves to the native Home tab", () => {
  assert.match(homeDeepLinkRouteSource, /<Redirect href="\/\(tabs\)" \/>/);
});

test("Expo entry is native-first with typed routes, API contracts, secure tokens, and disposable cache", () => {
  assert.equal(mobilePackage.dependencies.expo, "~57.0.25");
  assert.equal(mobilePackage.dependencies.react, "19.2.3");
  assert.equal(mobilePackage.dependencies["react-dom"], "19.2.3");
  assert.equal(mobilePackage.dependencies["expo-splash-screen"], "~57.0.9");
  assert.equal(mobilePackage.dependencies["react-native"], "0.86.3");
  assert.equal(mobilePackage.dependencies["react-native-reanimated"], "4.5.1");
  assert.equal(mobilePackage.dependencies["react-native-worklets"], "0.10.1");
  assert.equal(mobilePackage.main, "expo-router/entry");
  assert.equal(mobilePackage.dependencies["@dabboba/api-client"], "workspace:*");
  assert.equal(mobilePackage.dependencies["expo-secure-store"], "~57.0.4");
  assert.equal(mobilePackage.dependencies["expo-sqlite"], "~57.0.3");
  assert.equal(mobilePackage.dependencies["expo-image-picker"], "~57.0.20");
  assert.equal(mobilePackage.dependencies["expo-image-manipulator"], "~57.0.20");
  assert.equal(mobilePackage.dependencies["expo-notifications"], "~57.0.21");
  assert.equal(mobilePackage.dependencies["expo-auth-session"], "~57.0.13");
  assert.equal(mobilePackage.dependencies["expo-linking"], "~57.0.11");
  assert.equal(mobilePackage.dependencies["expo-web-browser"], "~57.0.3");
  assert.equal(mobilePackage.dependencies["expo-router"], "~57.0.23");
  assert.equal(mobilePackage.dependencies["@react-navigation/bottom-tabs"], undefined);
  assert.ok(mobilePackage.dependencies["@supabase/supabase-js"]);
  assert.equal(mobilePackage.scripts.start, "node ../../scripts/dabboba-mobile-launch.mjs");
  assert.equal(mobilePackage.scripts.ios, "node ../../scripts/dabboba-mobile-launch.mjs --ios");
  assert.equal(mobilePackage.scripts.android, "node ../../scripts/dabboba-mobile-launch.mjs --android");
  for (const hook of ["prestart", "preios", "preandroid"]) {
    assert.equal(mobilePackage.scripts[hook], "corepack pnpm run prepare:workspace");
  }
  assert.equal(mobilePackage.scripts.test, "node --test ../../tests/expo-shell-structure.test.mjs");
  assert.equal(mobileAppConfig.expo.scheme, "dabboba");
  assert.equal(mobileAppConfig.expo.experiments.typedRoutes, true);
  assert.deepEqual(Array.from(mobileAppConfig.expo.plugins), [
    ["expo-splash-screen", {
      image: "./assets/brand/dabboba-wordmark.png",
      imageWidth: 200,
      resizeMode: "contain",
      backgroundColor: "#F5F5F1",
    }],
    "expo-router",
    ["expo-secure-store", { faceIDPermission: false }],
    "expo-sqlite",
    "expo-font",
    [
      "expo-image-picker",
      {
        photosPermission: "신청 상품 사진을 첨부하기 위해 사진 보관함 접근이 필요합니다.",
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
    "expo-notifications",
    "expo-web-browser",
    "expo-asset",
    "@portone/react-native-sdk/plugin",
  ]);
  assert.equal(mobileAppConfig.expo.splash, undefined, "SDK57 uses the splash plugin, not the removed config field");
  assert.match(rootLayoutSource, /SQLiteProvider/);
  assert.match(rootLayoutSource, /StorefrontCategorySettingsProvider/);
  assert.match(
    tabsLayoutSource,
    /name="gacha"[\s\S]*?name="kuji"[\s\S]*?name="index"[\s\S]*?name="storage"[\s\S]*?name="profile"/,
    "root navigation order must stay 가챠샵 → 쿠지샵 → 홈 → 보관함 → 내정보",
  );
  assert.match(tabsLayoutSource, /name="gacha"[\s\S]*?title: "가챠샵"[\s\S]*?tabBarIcon: GachaCapsuleIcon/);
  assert.match(
    tabsLayoutSource,
    /name="kuji"[\s\S]*?title: "쿠지샵"[\s\S]*?tabBarIcon: KujiTicketIcon[\s\S]*?tabBarActiveTintColor: colors\.kujiOrangeDark/,
  );
  assert.doesNotMatch(tabsLayoutSource, /name="exchange"|name="ppoba"/);
  assert.equal(existsSync(path.join(root, "apps/mobile/app/(tabs)/exchange.tsx")), false);
  assert.equal(existsSync(path.join(root, "apps/mobile/app/(tabs)/ppoba.tsx")), false);
  assert.doesNotMatch(tabsLayoutSource, /tabIcon\("storefront-outline"\)/);
  assert.equal(existsSync(path.join(root, "apps/mobile/assets/icons/gacha-capsule-light.png")), true);
  assert.equal(existsSync(path.join(root, "apps/mobile/assets/icons/gacha-capsule-light-active.png")), true);
  assert.match(
    gachaCapsuleIconSource,
    /const GACHA_CAPSULE_INACTIVE = require\("\.\.\/\.\.\/assets\/icons\/gacha-capsule-light\.png"\)/,
  );
  assert.match(
    gachaCapsuleIconSource,
    /const GACHA_CAPSULE_ACTIVE = require\("\.\.\/\.\.\/assets\/icons\/gacha-capsule-light-active\.png"\)/,
  );
  assert.match(
    gachaCapsuleIconSource,
    /<Image[\s\S]*?source=\{isActive \? GACHA_CAPSULE_ACTIVE : GACHA_CAPSULE_INACTIVE\}[\s\S]*?resizeMode="contain"/,
  );
  assert.match(gachaCapsuleIconSource, /color === seed\.color\.foreground\.brand/);
  assert.match(gachaCapsuleIconSource, /opacity: isActive \? 1 : 0\.82/);
  assert.doesNotMatch(gachaCapsuleIconSource, /react-native-svg|<Svg|<Path|<Circle/);
  assert.doesNotMatch(gachaCapsuleIconSource, /cabinet|controlSlot|dispensingChute/);
  assert.equal(existsSync(path.join(root, "apps/mobile/assets/icons/kuji-ticket-chunky.png")), true);
  assert.equal(existsSync(path.join(root, "apps/mobile/assets/icons/kuji-ticket-chunky-active.png")), true);
  assert.match(
    kujiTicketIconSource,
    /const KUJI_TICKET_INACTIVE = require\("\.\.\/\.\.\/assets\/icons\/kuji-ticket-chunky\.png"\)/,
  );
  assert.match(
    kujiTicketIconSource,
    /const KUJI_TICKET_ACTIVE = require\("\.\.\/\.\.\/assets\/icons\/kuji-ticket-chunky-active\.png"\)/,
  );
  assert.match(
    kujiTicketIconSource,
    /source=\{isActive \? KUJI_TICKET_ACTIVE : KUJI_TICKET_INACTIVE\}/,
  );
  assert.match(kujiTicketIconSource, /color === colors\.kujiOrangeDark/);
  assert.doesNotMatch(kujiTicketIconSource, /react-native-svg|<Svg|<Path|<Circle|ticket-outline/);
  for (const assetName of [
    "home-chunky.png",
    "home-chunky-active.png",
    "storage-chunky.png",
    "storage-chunky-active.png",
    "profile-chunky.png",
    "profile-chunky-active.png",
  ]) {
    assert.equal(existsSync(path.join(root, "apps/mobile/assets/icons", assetName)), true);
    assert.match(rootObjectTabIconSource, new RegExp(`assets/icons/${assetName.replace(".", "\\.")}`));
  }
  assert.match(rootObjectTabIconSource, /export function HomeTabIcon/);
  assert.match(rootObjectTabIconSource, /export function StorageTabIcon/);
  assert.match(rootObjectTabIconSource, /export function ProfileTabIcon/);
  assert.match(rootObjectTabIconSource, /opacity: isActive \? 1 : 0\.78/);
  assert.match(tabsLayoutSource, /name="index"[\s\S]*?title: "홈"[\s\S]*?tabBarIcon: HomeTabIcon/);
  assert.match(tabsLayoutSource, /name="storage"[\s\S]*?title: "보관함"[\s\S]*?tabBarIcon: StorageTabIcon/);
  assert.match(tabsLayoutSource, /name="profile"[\s\S]*?title: "내정보"[\s\S]*?tabBarIcon: ProfileTabIcon/);
  assert.doesNotMatch(tabsLayoutSource, /home-outline|cube-outline|person-circle-outline/);
  assert.doesNotMatch(tabsLayoutSource, /title: "덕룸"/);
  assert.match(rootFloatingTabBarSource, /gacha: "가챠샵"[\s\S]*?kuji: "쿠지샵"[\s\S]*?index: "홈"[\s\S]*?storage: "보관함"[\s\S]*?profile: "내정보"/);
  assert.doesNotMatch(rootFloatingTabBarSource, /exchange: "교환방"|ppoba: "뽀바"/);
  assert.match(catalogApiSource, /createDabbobaClient/);
  assert.match(catalogApiSource, /\/v1\/catalog\/home-sections/);
  assert.match(catalogApiSource, /\/v1\/catalog\/recent-draws/);
  assert.match(catalogApiSource, /\n\s*homeSections,\n/);
  assert.match(catalogApiSource, /isCurrentHomeSectionList\(homeSectionResult\?\.data\)/);
  assert.match(catalogApiSource, /homeSectionRequest = client\.GET\("\/v1\/catalog\/home-sections"\)\.catch\(\(\) => null\)/);
  assert.doesNotMatch(catalogApiSource, /recentDrawRequest = client\.GET/);
  assert.match(catalogApiSource, /function fetchHomeRecentDrawActivity/);
  assert.match(catalogApiSource, /return result\.data\.items\.slice\(0, 2\)/);
  assert.match(catalogApiSource, /최근 당첨 기록을 불러오지 못했습니다/);
  assert.match(homeSource, /fetchHomeCatalog/);
  assert.match(homeSource, /readHomeCatalogCache/);
  assert.match(homeSource, /<RootPageHeader>[\s\S]*?accessibilityLabel="DABBOBA"[\s\S]*?<\/RootPageHeader>/);
  assert.match(rootPageHeaderSource, /height:\s*seed\.size\.rootTopNavigation/);
  assert.match(seedTokensSource, /rootTopNavigation:\s*56/);
  assert.match(homeSource, /wordmark:\s*\{\s*width:\s*116,\s*height:\s*17\s*\}/);
  assert.doesNotMatch(homeSource, /<SeedChip|PRODUCT_CATEGORY_OPTIONS\.map|<HomeCategoryNavigation/);
  assert.match(seedComponentsSource, /minHeight:\s*seed\.size\.chip,[\s\S]*?paddingHorizontal:\s*14,[\s\S]*?borderWidth:\s*1,[\s\S]*?borderRadius:\s*seed\.radius\.r2,/);
  assert.match(localDatabaseSource, /CREATE TABLE IF NOT EXISTS catalog_cache/);
  assert.doesNotMatch(localDatabaseSource, /parsed\.recentDrawActivity\.slice\(0, 2\)/);
  assert.match(localDatabaseSource, /recentDrawActivity:\s*null/);
  assert.match(localDatabaseSource, /JSON\.stringify\(cacheSnapshot\)/);
  assert.match(localDatabaseSource, /CREATE TABLE IF NOT EXISTS exchange_listing_cache/);
  assert.match(localDatabaseSource, /CREATE TABLE IF NOT EXISTS recent_searches/);
  assert.match(localDatabaseSource, /CREATE TABLE IF NOT EXISTS post_drafts/);
  assert.match(localDatabaseSource, /CREATE TABLE IF NOT EXISTS upload_queue/);
  assert.match(localDatabaseSource, /CREATE TABLE IF NOT EXISTS sync_state/);
  assert.doesNotMatch(localDatabaseSource, /orders|payments|points|draw_results/i);
  assert.match(sessionStoreSource, /SecureStore\.setItemAsync/);
  assert.match(sessionStoreSource, /access-token/);
  assert.match(sessionStoreSource, /refresh-token/);
  assert.match(rootLayoutSource, /InternalCustomerSessionBootstrap enabled=\{__DEV__\}/);
  assert.match(rootLayoutSource, /ensureInternalCustomerSession/);
  assert.match(demoApiSource, /\/v1\/auth\/me/);
  assert.match(demoApiSource, /\/v1\/demo\/session/);
  assert.doesNotMatch(`${rootLayoutSource}\n${demoApiSource}`, /\/v1\/auth\/dev-session|mobile-test@dabboba\.local/);
  assert.match(demoApiSource, /writeAuthTokens/);
  assert.doesNotMatch(`${rootLayoutSource}\n${tabsLayoutSource}\n${homeSource}`, /WebView/);
});

test("native Home follows the operator-defined editorial structure and layoutKind geometry", () => {
  assert.match(homeSource, /원하는 거 다 뽀바/);
  const tickerIndex = homeSource.indexOf("<HomeAnnouncement");
  const introIndex = homeSource.indexOf("<HomeIntroBanner");
  const recentDrawIndex = homeSource.indexOf("<RecentDrawActivityPanel");
  const collectionsIndex = homeSource.indexOf("{homeCollections.map");
  assert.ok(
    tickerIndex > -1
      && introIndex > tickerIndex
      && recentDrawIndex > introIndex
      && collectionsIndex > recentDrawIndex,
  );
  assert.match(homeSource, /function HomeIntroBanner/);
  assert.match(homeSource, /<HomeIntroBanner \/>/);
  assert.match(homeSource, /accessibilityRole="summary"[\s\S]*?accessibilityLabel="새 소식 준비 중/);
  assert.doesNotMatch(homeSource, /<HomeCategoryNavigation|<SeedChip/);
  assert.doesNotMatch(homeSource, /<HomePopularIpSection|<HomeFeaturedProductsSection|<TodayDrawGroup/);
  assert.doesNotMatch(homeSource, /buildTodayDrawGroups|buildHomeFeaturedProducts|buildHomeCollections|DEFAULT_HOME_COLLECTION_IP_IDS/);
  assert.doesNotMatch(homeSource, /selectedCategory|categoryRail/);
  assert.doesNotMatch(homeSource, /전체보기|openCatalogCategory|categoryNavigationSequence|onViewAll|onTrailingPress/);
  assert.match(homeSource, /homeCollections\.map\(\(collection\) => \([\s\S]*?<OperatorHomeSection/);
  assert.match(homeSource, /function OperatorHomeSection[\s\S]*?<ScrollView[\s\S]*?horizontal[\s\S]*?contentContainerStyle=\{styles\.productRail\}/);
  assert.match(homeSource, /layoutKind=\{section\.layoutKind\}/);
  assert.match(homeSource, /getHomeProductCardWidth\(layoutKind\)/);
  assert.match(homeSource, /getHomeProductMediaAspectRatio\(layoutKind\)/);
  assert.doesNotMatch(homeSource, /Image\.getSize\(/);
  assert.match(homeFeedSource, /HOME_GACHA_PRODUCT_CARD_WIDTH = 172/);
  assert.match(homeFeedSource, /HOME_KUJI_PRODUCT_CARD_WIDTH = 228/);
  assert.match(homeFeedSource, /HOME_GACHA_PRODUCT_MEDIA_ASPECT_RATIO = 7 \/ 5/);
  assert.match(homeFeedSource, /HOME_KUJI_PRODUCT_MEDIA_ASPECT_RATIO = 7 \/ 4/);
  assert.match(homeSource, /<CatalogDiscoveryImage/);
  assert.match(homeSource, /targetAspectRatio=\{mediaAspectRatio\}/);
  assert.doesNotMatch(homeSource, /imageAspectRatio|onDimensions=/);
  assert.match(homeSource, /collectionImageFrame:\s*\{\s*width:\s*"100%"/);
  assert.doesNotMatch(homeSource, /productGrid|flexWrap:\s*"wrap"/);
  assert.doesNotMatch(homeSource, /다뽀바 인기 작품|다뽀바 덕룸|fetchDukroomHomePreview/);
  assert.match(homeSource, /buildConfiguredHomeCollections\(snapshot\.homeSections\.items\.map/);
  assert.doesNotMatch(homeSource, /seenProductIds/);
  assert.match(localDatabaseSource, /homeSections:\s*isCurrentHomeSectionList\(parsed\.homeSections\) \? parsed\.homeSections : null/);
  assert.match(announcementTickerSource, /Animated\.timing\(translateX/);
  assert.match(announcementTickerSource, /Animated\.timing\(translateY/);
  assert.match(announcementTickerSource, /AccessibilityInfo\.isReduceMotionEnabled/);
  assert.doesNotMatch(homeSource, /화면 예시|IMAGE READY/);
  assert.match(homeSource, /<HomeIntroBanner[\s\S]*?<RecentDrawActivityPanel[\s\S]*?activity=\{recentDrawActivity\}[\s\S]*?\{homeCollections\.map/);
  assert.match(
    homeSource,
    /useFocusEffect\([\s\S]*?initialLoadCompleted\.current[\s\S]*?void load\(\)/,
  );
  assert.match(homeSource, /initialLoadCompleted\.current/);
  assert.match(homeSource, /당첨 기록을 확인하고 있어요\./);
  assert.match(homeSource, /당첨 기록을 불러오지 못했어요\./);
  assert.match(homeSource, /아직 공개된 당첨 기록이 없어요\./);
  assert.match(homeSource, /getRecentDrawReelWindow\(\(activity \?\? \[\]\)\.slice\(0, 2\), 0\)/);
  assert.match(homeSource, /accessibilityElementsHidden=\{!current\}/);
  assert.match(homeSource, /importantForAccessibility=\{current \? "yes" : "no-hide-descendants"\}/);
  assert.doesNotMatch(`${homeSource}\n${homeFeedSource}`, /가상 소식|DRAW_ACTIVITY_NAMES|buildDrawActivityExamples/);
  assert.doesNotMatch(
    `${homeSource}\n${homeFeedSource}`,
    /HomePopularProductsPanel|PopularProductMarquee|PopularProductMessage|HomePopularItem|buildHomePopularItems|buildDrawActivityTickerWindow|getContinuousTickerLoopDistance/,
  );
  assert.match(
    homeSource,
    /variant=\{layoutKind === "kuji" \? "catalogTitleWide" : "catalogTitle"\}/,
  );
  assert.match(homeSource, /collectionProductName:\s*\{[^}]*minHeight:\s*40[^}]*flexShrink:\s*1/);
  assert.match(announcementTickerSource, /AccessibilityInfo\.isReduceMotionEnabled/);
});

test("native Home uses the approved restrained arcade treatment", () => {
  assert.match(announcementTickerSource, /backgroundColor:\s*seed\.color\.layer\.default/);
  assert.match(announcementTickerSource, /onPress\?: \(message: string, index: number\) => void/);
  assert.match(announcementTickerSource, /accessibilityRole="text"[\s\S]*?style=\{styles\.messageTarget\}/);
  assert.match(announcementTickerSource, /\{onPress \? <DecorativeIonicon name="chevron-forward"/);
  assert.match(homeSource, /const hasActionableAnnouncement = useMemo/);
  assert.match(homeSource, /onPress=\{hasActionableAnnouncement \?/);
  assert.match(announcementTickerSource, /styles\.led/);
  assert.match(announcementTickerSource, /Animated\.loop\(Animated\.sequence/);
  assert.match(announcementTickerSource, /if \(reduceMotion \|\| paused\) return undefined/);
  assert.match(homeSource, /<HomeIntroBanner \/>/);
  assert.match(homeSource, /style=\{\[styles\.hero, expanded && styles\.heroLargeText\]\}/);
  assert.match(homeSource, /style=\{styles\.heroAction\}>새 소식 준비 중<\/Text>/);
  assert.doesNotMatch(homeSource, />LIVE<\/Text>|실시간 상품/);
  assert.doesNotMatch(homeSource, /ArcadeDotTexture|ArcadeScanlineTexture|dotTexture|scanlineTexture/);
  assert.doesNotMatch(homeSource, /activityCard|activityProduct/);
  assert.equal((homeSource.match(/<CatalogProductTopIndicator category=\{layoutKind\} \/>/g) ?? []).length, 1);
  assert.match(homeSource, /homeStatusBadge:[^\n]*minWidth:\s*42[^\n]*minHeight:\s*22/);
  assert.match(homeSource, /badge === "BEST" \? "인기 상품, " : badge === "NEW" \? "신상품, "/);
  assert.match(homeSource, /recentDrawSummary:\s*\{[\s\S]*?minHeight:\s*58[\s\S]*?marginHorizontal:\s*seed\.spacing\.globalGutter[\s\S]*?borderWidth:\s*StyleSheet\.hairlineWidth/);
  assert.match(homeSource, /recentDrawSummaryPopulated:\s*\{\s*minHeight:\s*72\s*\}/);
  assert.match(homeSource, /recentDrawReel:\s*\{[^}]*overflow:\s*"hidden"/);
  assert.doesNotMatch(homeSource, /recentDrawReelPrevious/);
  assert.match(homeSource, /recentDrawReelNext:[^\n]*opacity:\s*0\.42/);
  assert.match(homeSource, /connectionNotice:\s*\{[\s\S]*?minHeight:\s*seed\.size\.touchTarget/);
  assert.match(homeSource, /source === "cache" \? "새로고침" : "다시 불러오기"/);
  assert.match(homeSource, /retryCache:[^\n]*backgroundColor:\s*seed\.color\.background\.transparent/);
  assert.doesNotMatch(homeSource, /getHomeFeaturedCardWidth|featuredGachaProductMediaSize|variant === "featured"/);
  assert.doesNotMatch(homeSource, /KujiSelectionPanel|kujiPanelDecor|kujiPanelLights|kujiPanelSlot/);
  assert.doesNotMatch(homeSource, /kujiProductCardBody|#F7F8F4/);
  assert.doesNotMatch(homeSource, /expo-av|Audio\.|playAsync|sound/i);
  assert.match(homeSource, /pressed:\s*\{[\s\S]*?pressedTranslateY[\s\S]*?pressedScale/);
});

test("only Home keeps the DABBOBA wordmark while category roots use compact Korean headers", () => {
  assert.match(homeSource, /accessibilityLabel="DABBOBA"/);

  for (const [source, title] of [
    [storageRootSource, "보관함"],
    [profileHomeSource, "내정보"],
  ]) {
    assert.match(source, /RootCategoryTitle/);
    assert.match(source, new RegExp(`<RootCategoryTitle>${title}<\\/RootCategoryTitle>`));
    assert.doesNotMatch(source, /accessibilityLabel="DABBOBA"|const WORDMARK|styles\.wordmark/);
    assert.doesNotMatch(source, /styles\.eyebrow|styles\.pageTitle|styles\.title/);
  }
  assert.match(shopSource, /const shopTitle = `\$\{categoryLabel\(category\)\}샵`/);
  assert.match(shopSource, /<RootCategoryTitle>\{shopTitle\}<\/RootCategoryTitle>/);
  assert.match(exchangeRoomSource, /<DetailPageHeader title="교환방" titleMode="pixel"/);
  assert.doesNotMatch(`${shopSource}\n${exchangeRoomSource}`, /accessibilityLabel="DABBOBA"|const WORDMARK|styles\.wordmark/);

  assert.equal(mobilePackage.dependencies.galmuri, "2.40.3");
  assert.match(rootLayoutSource, /useFonts\(\{\s*Galmuri11:\s*require\("galmuri\/dist\/Galmuri11-Bold\.ttf"\)/);
  assert.match(rootCategoryTitleSource, /accessibilityRole="header"/);
  assert.match(rootCategoryTitleSource, /fontFamily:\s*"DabbobaKoreanPixelBold"/);
  assert.match(rootCategoryTitleSource, /fontWeight:\s*"400"/);
  assert.match(rootCategoryTitleSource, /root:\s*\{[\s\S]*?fontSize:\s*21,[\s\S]*?lineHeight:\s*29/);
});

test("readable app copy uses Noto Sans while fixed pixel brand surfaces stay isolated", () => {
  assert.equal(mobilePackage.dependencies["@expo-google-fonts/noto-sans"], "0.4.2");
  assert.equal(mobilePackage.dependencies["@expo-google-fonts/noto-sans-kr"], "0.4.3");
  for (const font of [
    "NotoSans_400Regular",
    "NotoSans_500Medium",
    "NotoSans_700Bold",
    "NotoSans_900Black",
    "NotoSansKR_400Regular",
    "NotoSansKR_500Medium",
    "NotoSansKR_700Bold",
    "NotoSansKR_900Black",
  ]) {
    assert.match(rootLayoutSource, new RegExp(font));
    assert.match(typographySource, new RegExp(font));
  }
  assert.match(typographySource, /export function AppText/);
  assert.match(typographySource, /export function BalancedAppText/);
  assert.match(typographySource, /lineBreakStrategyIOS = "hangul-word"/);
  assert.match(typographySource, /textBreakStrategy = "balanced"/);
  assert.match(typographySource, /export function AppTextInput/);
  assert.match(typographySource, /HANGUL_PATTERN/);
  assert.match(typographySource, /function canonicalReadableVariant/);
  assert.match(typographySource, /fontSize === 12[\s\S]*?"catalogMetadata"[\s\S]*?"caption"/);
  assert.match(typographySource, /fontSize === 15[\s\S]*?"articleBody"[\s\S]*?"body"/);
  assert.match(typographySource, /readableMetrics\(style, "input"\)/);
  assert.match(rootFloatingTabBarSource, /fontFamily:\s*"NotoSansKR_700Bold"/);

  const pixelOnlyNativeText = new Set([
    "apps/mobile/src/components/RootCategoryTitle.tsx",
    "apps/mobile/src/components/RootHeaderActions.tsx",
  ]);
  for (const [relativePath, source] of [
    ...collectTsxSources(path.join(root, "apps/mobile/app")),
    ...collectTsxSources(path.join(root, "apps/mobile/src")),
  ]) {
    if (!/<Text\b/.test(source) || pixelOnlyNativeText.has(relativePath)) continue;
    assert.match(source, /import \{[^}]*AppText as Text[^}]*\} from "@\/components\/Typography";/, `${relativePath} must use the shared readable text component`);
  }

  assert.match(rootCategoryTitleSource, /fontFamily:\s*"DabbobaKoreanPixelBold"/);
  assert.match(rootLayoutSource, /Galmuri11Readable:\s*require\("galmuri\/dist\/Galmuri11\.ttf"\)/);
  assert.match(rootCategoryTitleSource, /section:\s*\{[\s\S]*?fontSize:\s*19/);
  assert.match(rootHeaderActionsSource, /import \{ AppText as Text \} from "@\/components\/Typography"/);
  assert.match(rootHeaderActionsSource, /<Text style=\{styles\.unreadBadge\}>/);
  assert.doesNotMatch(rootHeaderActionsSource, /fontFamily:/);
});

test("app-authored title blocks use one Korean pixel title instead of stacked English eyebrows", () => {
  assert.match(rootCategoryTitleSource, /export function KoreanPixelTitle/);
  assert.match(rootCategoryTitleSource, /fontFamily:\s*"DabbobaKoreanPixelBold"/);

  for (const source of [
    exchangeRoomSource,
    exchangeDetailSource,
    shopSource,
    productDetailSource,
    storageRootSource,
    profileHomeSource,
    profileSectionSource,
    profileMemberSource,
    notificationsScreenSource,
    productHistoryScreenSource,
  ]) {
    assert.match(source, /KoreanPixelTitle|RootCategoryTitle|<DetailPageHeader[^>]*titleMode="pixel"/);
    assert.doesNotMatch(
      source,
      /NATIVE APP|IP SELECT|AVAILABLE NOW|OPEN LISTINGS|OFFERS TO A|MY OFFER|PURCHASE GUIDE|LIVE ODDS|SHOWCASE|WISH BOARD|PROFILE EDIT|MY WISHLIST|MY STORAGE|MEMBER INFO|PAYMENT SETTINGS|>PRODUCT<|>DUKROOM<|IP FILTER|IP ROOM|DEFAULT ADDRESS/,
    );
  }

  assert.doesNotMatch(profileSectionSource, /eyebrow:/);
  assert.doesNotMatch(profileMemberSource, /eyebrow:/);
});

test("section titles and their compact accessories share one locked bold Korean pixel face", () => {
  assert.match(rootLayoutSource, /DabbobaKoreanPixelBold:\s*require\("galmuri\/dist\/Galmuri11-Bold\.ttf"\)/);
  assert.match(rootCategoryTitleSource, /export function KoreanPixelTitleAccessory/);
  assert.match(rootCategoryTitleSource, /fixedPixelFace:\s*\{[\s\S]*?fontFamily:\s*"DabbobaKoreanPixelBold"[\s\S]*?fontWeight:\s*"400"/);
  assert.match(rootCategoryTitleSource, /style=\{\[styles\.base, styles\[variant\], style, styles\.fixedPixelFace\]\}/);
  assert.match(rootCategoryTitleSource, /style=\{\[styles\.accessory, style, styles\.fixedPixelFace\]\}/);
  assert.match(rootCategoryTitleSource, /accessory:\s*\{[\s\S]*?fontSize:\s*12/);

  for (const source of [
    exchangeRoomSource,
    exchangeDetailSource,
    searchScreenSource,
    notificationsScreenSource,
    dukroomSource,
    dukroomDetailSource,
    kujiDrawSource,
    kujiQueueSource,
    drawRevealSource,
  ]) {
    assert.match(source, /KoreanPixelTitleAccessory/);
  }

  assert.doesNotMatch(homeSource, /KoreanPixelTitleAccessory|sectionTrailingButton/);
  assert.doesNotMatch(homeSource, /<Text style=\{styles\.sectionTrailing\}>/);
  assert.doesNotMatch(searchScreenSource, /<Text style=\{styles\.result(?:Title|Count)\}>/);
  assert.doesNotMatch(kujiDrawSource, /<Text style=\{styles\.boardCount\}>/);
  assert.doesNotMatch(exchangeDetailSource, /<Text style=\{styles\.oneChoiceBadge\}>/);
  assert.doesNotMatch(notificationsScreenSource, /<Text style=\{styles\.unreadCount\}>/);
  assert.doesNotMatch(drawRevealSource, /<Text style=\{styles\.summaryRail(?:Title|Count)\}>/);
});

test("Expo app applies a native SEED-compatible design layer without web-only packages", () => {
  assert.equal(mobilePackage.dependencies["@seed-design/react"], undefined);
  assert.equal(mobilePackage.dependencies["@seed-design/css"], undefined);
  assert.match(seedTokensSource, /export const seed/);
  assert.match(seedTokensSource, /globalGutter:\s*20/);
  assert.match(seedTokensSource, /componentDefault:\s*12/);
  assert.match(seedTokensSource, /betweenChips:\s*8/);
  assert.match(seedTokensSource, /screenTitle:\s*\{\s*fontSize:\s*24,\s*lineHeight:\s*34,\s*fontWeight:\s*"700"/);
  assert.match(seedTokensSource, /articleBody:\s*\{\s*fontSize:\s*16,\s*lineHeight:\s*24,\s*fontWeight:\s*"400"/);
  assert.match(seedTokensSource, /body:\s*\{\s*fontSize:\s*14,\s*lineHeight:\s*20,\s*fontWeight:\s*"400"/);
  assert.match(seedTokensSource, /caption:\s*\{\s*fontSize:\s*12,\s*lineHeight:\s*18,\s*fontWeight:\s*"400"/);
  assert.match(seedTokensSource, /input:\s*\{\s*fontSize:\s*16,\s*lineHeight:\s*24,\s*fontWeight:\s*"400"/);
  assert.match(seedTokensSource, /touchTarget:\s*44/);
  assert.match(seedTokensSource, /chip:\s*36/);
  assert.match(seedTokensSource, /input:\s*52/);

  for (const component of ["SeedActionButton", "SeedCard", "SeedChip", "SeedIconButton", "SeedInputShell", "SeedTextInput"]) {
    assert.match(seedComponentsSource, new RegExp(`export function ${component}`));
  }
  assert.match(seedComponentsSource, /chipTouchTarget:\s*\{[\s\S]*?minHeight:\s*seed\.size\.touchTarget/);
  assert.match(seedComponentsSource, /minHeight:\s*seed\.size\.chip/);
  assert.match(seedComponentsSource, /paddingHorizontal:\s*14/);
  assert.match(seedComponentsSource, /borderWidth:\s*1/);
  assert.match(seedComponentsSource, /borderRadius:\s*seed\.radius\.r2/);
  assert.match(seedComponentsSource, /accessibilityState=\{\{\s*selected,\s*disabled:\s*unavailable\s*\}\}/);
  assert.match(seedComponentsSource, /pressed && styles\.chipPressed/);

  for (const source of [homeSource, exchangeRoomSource, shopSource, storageRootSource, profileHomeSource, tabsLayoutSource]) {
    assert.match(source, /@\/design-system\/seed|@\/design-system\/components/);
  }

  const styledAppSurfaces = [
    ...collectTsxSources(path.join(root, "apps/mobile/src/features")),
    ["apps/mobile/src/components/CatalogProductRow.tsx", readOptionalSource("apps/mobile/src/components/CatalogProductRow.tsx")],
    ["apps/mobile/src/components/MigrationScreen.tsx", readOptionalSource("apps/mobile/src/components/MigrationScreen.tsx")],
  ];
  for (const [relativePath, source] of styledAppSurfaces) {
    if (!/StyleSheet\.create/.test(source)) continue;
    assert.match(source, /@\/design-system\/seed/, `${relativePath} must use the shared native SEED tokens`);
  }
});

test("native brand accents keep the fixed DABBOBA 90/8/2 visual balance", () => {
  assert.match(brandAccentSource, /neutralPercent:\s*90/);
  assert.match(brandAccentSource, /weakPercent:\s*8/);
  assert.match(brandAccentSource, /solidPercent:\s*2/);
  assert.match(brandAccentSource, /solid:\s*colors\.brand/);
  assert.match(seedTokensSource, /brandSolid:\s*brandAccentPolicy\.color\.solid/);
  assert.match(seedTokensSource, /brandWeak:\s*brandAccentPolicy\.color\.weak/);
  assert.match(seedTokensSource, /brand:\s*brandAccentPolicy\.color\.focusStroke/);
  assert.match(profileHomeSource, /requestCard:[\s\S]*?backgroundColor:\s*seed\.color\.layer\.default/);
  assert.match(profileHomeSource, /requestIcon:[\s\S]*?backgroundColor:\s*seed\.color\.background\.brandWeak/);
  assert.match(profileSectionSource, /pointHero:[\s\S]*?backgroundColor:\s*seed\.color\.background\.brandWeak/);

  const customerNativeSource = collectTsxSources(path.join(root, "apps/mobile/src"))
    .filter(([relativePath]) => !relativePath.includes("/features/draw/"))
    .map(([, source]) => source)
    .join("\n");
  assert.doesNotMatch(customerNativeSource, /#E9F7E7/i, "brand tints must come from the shared accent policy");
});

test("native advisory guidance uses one text-only caption treatment across customer screens", () => {
  assert.match(seedComponentsSource, /export function SeedInlineGuidance/);
  assert.match(seedComponentsSource, /inlineGuidance:\s*\{[^}]*seed\.typography\.caption/);
  assert.doesNotMatch(
    seedComponentsSource,
    /inlineGuidance:\s*\{[^}]*(?:backgroundColor|borderColor|borderRadius|borderWidth|padding)/,
  );

  for (const source of [
    checkoutScreenSource,
    checkoutConnectionScreenSource,
    drawRevealSource,
    kujiQueueSource,
    profileSectionSource,
    profileMemberSource,
    profileRecordDetailSource,
    productHistoryScreenSource,
  ]) {
    assert.match(source, /SeedInlineGuidance/);
  }
  assert.doesNotMatch(profileHomeSource, /SeedInlineGuidance/);

  const guidanceSources = [
    checkoutScreenSource,
    checkoutConnectionScreenSource,
    drawRevealSource,
    exchangeCreateSource,
    kujiQueueSource,
    storageRootSource,
    profileHomeSource,
    profileSectionSource,
    profileMemberSource,
    profileRecordDetailSource,
    productHistoryScreenSource,
    dukroomSource,
    dukroomDetailSource,
  ].join("\n");
  assert.doesNotMatch(
    guidanceSources,
    /(?:drawNote|boundaryNote|storageNote|referenceNotice|guideCard|exampleNotice|exampleBanner|guestBanner|infoBox):\s*\{[^}]*(?:backgroundColor|borderColor|borderRadius|borderWidth|padding)/,
  );
  assert.doesNotMatch(checkoutScreenSource, /주문 내용을 확인해 주세요|styles\.lead|leadIcon/);
  assert.doesNotMatch(checkoutConnectionScreenSource, /실제 결제가 연결되면 이렇게 진행돼요|styles\.hero|heroIcon|statusPill/);
});

test("fixed Korean guidance separates semantic paragraphs without forcing breaks into dynamic copy", () => {
  assert.match(typographySource, /export function BalancedParagraphText/);
  assert.match(typographySource, /paragraphs\.map\(\(paragraph\) => paragraph\.trim\(\)\)\.filter\(Boolean\)/);
  assert.match(typographySource, /normalizedParagraphs\.join\("\\n"\)/);
  assert.match(seedComponentsSource, /paragraphs\?: readonly string\[\]/);
  assert.match(seedComponentsSource, /<BalancedParagraphText[\s\S]*?paragraphs=\{paragraphs\}/);

  assert.doesNotMatch(profileSectionSource, /직접 뽑아 보관 중인 가챠·쿠지만 배송 신청할 수 있어요|예상 환급 포인트는 상품 기준가의 50%예요|styles\.storageGuidance|styles\.modeDescription/);

  for (const source of [checkoutScreenSource, kujiQueueSource]) {
    assert.match(source, /<SeedInlineGuidance[\s\S]*?paragraphs=\{\[/);
  }
});

test("root headers keep only search and account notifications", () => {
  for (const source of [homeSource, shopSource, storageRootSource, profileHomeSource]) {
    assert.match(source, /RootPageHeader/);
    assert.doesNotMatch(source, /pointsPill|pointsLabel|>0P</);
  }
  assert.match(exchangeRoomSource, /DetailPageHeader/);
  assert.doesNotMatch(exchangeRoomSource, /RootPageHeader|pointsPill|pointsLabel|>0P</);

  assert.match(rootPageHeaderSource, /RootHeaderActions/);

  for (const label of ["검색", "알림함"]) {
    assert.match(rootHeaderActionsSource, new RegExp(`label: "${label}`));
  }
  assert.match(rootHeaderActionsSource, /검색 열기[\s\S]*알림함 열기/);
  assert.doesNotMatch(rootHeaderActionsSource, /상품 기록 열기|\/product-history/);
  assert.match(rootHeaderActionsSource, /label=\{action\.route === "\/notifications" && unreadCount > 0/);
  assert.match(rootHeaderActionsSource, /읽지 않은 알림 \$\{unreadCount\}개/);
  assert.match(rootHeaderActionsSource, /fetchAccountNotificationUnreadSummary/);
  for (const route of ["/search", "/notifications"]) {
    assert.match(rootHeaderActionsSource, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.doesNotMatch(rootHeaderActionsSource, /ProductHistoryCapsuleIcon|capsuleFrame|capsuleImage/);
  assert.doesNotMatch(rootHeaderActionsSource, />DABBOBA<\/Text>|capsuleWordmark/);
  assert.doesNotMatch(rootHeaderActionsSource, /function CapsuleIcon|capsuleHalf|capsuleDivider/);

  assert.match(searchRouteSource, /ProductSearchScreen/);
  assert.match(searchScreenSource, /fetchCatalogProductPage/);
  assert.match(searchScreenSource, /상품명·작품 검색/);
  assert.match(searchScreenSource, /\/product\//);

  assert.match(productHistoryRouteSource, /ProductHistoryScreen/);
  assert.match(productHistoryScreenSource, /readRecentlyViewedProductIds/);
  assert.match(productHistoryScreenSource, /내가 본 상품/);
  assert.match(productHistoryScreenSource, /내가 뽑은 상품/);
  assert.match(productHistoryScreenSource, /찜한 상품/);
  assert.match(productHistoryScreenSource, /profileState\.snapshot\?\.wishlist/);
  assert.match(productHistoryScreenSource, /item\.product\.ipNameKo/);
  assert.match(productHistoryScreenSource, /상품 상세에서 하트를 누르면 여기에 모아볼 수 있어요/);
  assert.match(productHistoryScreenSource, /sourceType === "GACHA"|sourceType === "KUJI"/);
  assert.match(localDatabaseSource, /CREATE TABLE IF NOT EXISTS recently_viewed_products/);
  assert.match(productDetailSource, /recordRecentlyViewedProduct/);

  assert.match(notificationsRouteSource, /NotificationsScreen/);
  assert.match(notificationsScreenSource, /readAuthTokens/);
  assert.match(notificationsScreenSource, /로그인하면 주문·교환·배송·문의 활동 알림을 확인할 수 있어요/);
  assert.match(notificationsApiSource, /\/v1\/account\/notifications/);
  assert.match(notificationsApiSource, /notifications\/\{notificationId\}\/read/);
  assert.match(notificationsApiSource, /"Idempotency-Key": randomUUID\(\)/);
  assert.match(notificationNavigationSource, /detail\.kind === "exchange"/);
  assert.match(notificationNavigationSource, /href: `\/exchange\/\$\{encodeURIComponent\(detail\.id\)\}`/);
  assert.match(notificationNavigationSource, /SAFE_IDENTIFIER\.test\(detail\.id\)/);
  assert.match(notificationNavigationSource, /ROOT_TARGETS\[destination\.route\]/);
  assert.doesNotMatch(notificationNavigationSource, /\/\(tabs\)\/exchange/);
});

test("root tabs share the Home-sized header and use an accessible soft transition", () => {
  assert.match(rootPageHeaderSource, /height:\s*seed\.size\.rootTopNavigation/);
  assert.match(rootPageHeaderSource, /paddingHorizontal:\s*seed\.spacing\.globalGutter/);
  assert.match(rootPageHeaderSource, /borderBottomWidth:\s*StyleSheet\.hairlineWidth/);
  assert.match(seedTokensSource, /rootTopNavigation:\s*56/);
  assert.match(tabsLayoutSource, /AccessibilityInfo\.isReduceMotionEnabled/);
  assert.match(tabsLayoutSource, /animation:\s*reduceMotion \? "none" : "fade"/);
});

test("native root navigation stays flat and full-width with icon-and-label selection only", () => {
  assert.match(tabsLayoutSource, /RootNavigationMotionProvider/);
  assert.match(tabsLayoutSource, /tabBar=\{\(props\) => <RootFloatingTabBar \{\.\.\.props\} \/>\}/);

  for (const source of [homeSource, profileHomeSource]) {
    assert.match(source, /useRootNavigationScroll/);
    assert.match(source, /ROOT_NAVIGATION_CONTENT_INSET/);
    assert.match(source, /<ScrollView\s+\{\.\.\.rootNavigationScroll\}/);
    assert.match(source, /paddingBottom: ROOT_NAVIGATION_CONTENT_INSET/);
  }
  assert.match(shopSource, /useRootNavigationScroll/);
  assert.match(shopSource, /ROOT_NAVIGATION_CONTENT_INSET/);
  assert.match(shopSource, /<FlatList[\s\S]*?\{\.\.\.rootNavigationScroll\}/);
  assert.match(shopSource, /paddingBottom: ROOT_NAVIGATION_CONTENT_INSET/);
  assert.doesNotMatch(exchangeRoomSource, /useRootNavigationScroll|ROOT_NAVIGATION_CONTENT_INSET/);
  assert.match(storageRootSource, /useRootNavigationScroll/);
  assert.match(storageRootSource, /ROOT_NAVIGATION_CONTENT_INSET/);
  assert.match(storageRootSource, /rootScrollProps=\{rootNavigationScroll\}/);
  assert.match(storageRootSource, /paddingBottom: ROOT_NAVIGATION_CONTENT_INSET/);
  assert.match(profileSectionSource, /<ScrollView[\s\S]*?\{\.\.\.rootScrollProps\}/);

  assert.match(rootFloatingTabBarSource, /const activeColor = route\.name === "kuji" \? colors\.kujiOrangeDark : seed\.color\.foreground\.brand/);
  assert.match(rootFloatingTabBarSource, /const color = selected \? activeColor : seed\.color\.foreground\.muted/);
  assert.match(rootFloatingTabBarSource, /route\.name === "kuji" \? \([\s\S]*?<KujiTicketIcon color=\{color\} size=\{25\} \/>/);
  assert.match(rootFloatingTabBarSource, /route\.name === "index" \? \([\s\S]*?<HomeTabIcon color=\{color\} size=\{25\} \/>/);
  assert.match(rootFloatingTabBarSource, /route\.name === "storage" \? \([\s\S]*?<StorageTabIcon color=\{color\} size=\{25\} \/>/);
  assert.match(rootFloatingTabBarSource, /route\.name === "profile" \? \([\s\S]*?<ProfileTabIcon color=\{color\} size=\{25\} \/>/);
  assert.doesNotMatch(rootFloatingTabBarSource, /home-outline|cube-outline|person-circle-outline/);
  assert.match(rootFloatingTabBarSource, /style=\{\[styles\.label, selected && \{ color \}\]\}/);
  assert.doesNotMatch(rootFloatingTabBarSource, /selectionTrack|selectionIndicator|Animated\.spring|Animated\.multiply/);
  assert.match(rootFloatingTabBarSource, /backgroundColor: seed\.color\.layer\.default/);
  assert.match(rootFloatingTabBarSource, /label:\s*\{[\s\S]*?fontSize:\s*11,[\s\S]*?lineHeight:\s*16/);
  assert.match(rootFloatingTabBarSource, /position: "absolute"/);
  assert.match(rootFloatingTabBarSource, /borderTopWidth: StyleSheet\.hairlineWidth/);
  assert.match(rootFloatingTabBarSource, /backgroundColor: seed\.color\.background\.transparent/);
  assert.match(rootFloatingTabBarSource, /ROOT_NAVIGATION_CONTENT_INSET = seed\.size\.bottomNavigation \+ seed\.spacing\.screenBottom/);
  assert.match(rootFloatingTabBarSource, /minWidth: seed\.size\.touchTarget/);
  assert.match(rootFloatingTabBarSource, /minHeight: seed\.size\.touchTarget/);
  assert.match(rootFloatingTabBarSource, /AccessibilityInfo\.isReduceMotionEnabled/);
  assert.doesNotMatch(rootFloatingTabBarSource, /compactWidth|animatedBarStyle|labelAnimatedStyle/);
  assert.doesNotMatch(rootFloatingTabBarSource, /display:\s*"none"|height:\s*0\s*[,}]/);
});

test("native exchange room uses server records and opens registration, activity, detail, and offer flows", () => {
  for (const source of [
    exchangeRouteSource,
    exchangeDetailRouteSource,
    exchangeCreateRouteSource,
    exchangeOfferRouteSource,
    exchangeActivityRouteSource,
  ]) {
    assert.match(source, /CommerceRouteGate/);
  }
  assert.match(exchangeRouteSource, /<CommerceRouteGate fallback="\/\(tabs\)\/storage">/);
  assert.match(exchangeDetailRouteSource, /<CommerceRouteGate fallback="\/\(tabs\)\/storage">/);
  assert.match(exchangeCreateRouteSource, /<CommerceRouteGate fallback="\/\(tabs\)\/storage">/);
  assert.match(exchangeOfferRouteSource, /<CommerceRouteGate fallback="\/\(tabs\)\/storage">/);
  assert.match(exchangeActivityRouteSource, /<CommerceRouteGate fallback="\/\(tabs\)\/profile">/);
  assert.match(exchangeRouteSource, /ExchangeRoomScreen/);
  assert.doesNotMatch(exchangeRouteSource, /MigrationScreen/);
  assert.match(exchangeRoomSource, /<DetailPageHeader title="교환방" titleMode="pixel" onBack=\{goBack\} backLabel="보관함으로 돌아가기" \/>/);
  assert.match(exchangeRoomSource, /if \(router\.canGoBack\(\)\) router\.back\(\);[\s\S]*?else router\.replace\("\/\(tabs\)\/storage"\)/);
  assert.doesNotMatch(exchangeRoomSource, /useRootNavigationScroll|ROOT_NAVIGATION_CONTENT_INSET|<RootPageHeader/);
  assert.match(exchangeApiSource, /createDabbobaClient/);
  assert.match(exchangeApiSource, /\/v1\/exchange\/listings/);
  assert.match(exchangeApiSource, /\/v1\/catalog\/products/);
  assert.match(exchangeApiSource, /customerProductCategoryValues\("exchange"\)/);
  assert.doesNotMatch(exchangeRoomSource, /useStorefrontCategoryOptions\("exchange"\)|selectedCategory|categoryRail/);
  assert.match(exchangeApiSource, /EXAMPLE_PREFIX/);
  assert.match(exchangeRoomSource, /fetchExchangeRoom/);
  assert.match(exchangeRoomSource, /readExchangeListingCache/);
  assert.match(exchangeRoomSource, /writeExchangeListingCache/);
  assert.doesNotMatch(exchangeRoomSource, /화면 구성을 확인할 수 있는 예시 글이에요|Fastify API|ITEM IMAGE/);
  assert.match(exchangeRoomSource, /아직 등록된 교환 상품이 없어요/);
  assert.match(exchangeRoomSource, /searchEmpty:\s*\{[^}]*minHeight:\s*320/);
  assert.doesNotMatch(exchangeRoomSource, /searchEmpty:\s*\{[^}]*(?:borderWidth|backgroundColor)/);
  assert.doesNotMatch(exchangeRoomSource, /가챠샵 기준가 · 판매가 아님/);
  assert.doesNotMatch(exchangeDetailSource, /가챠샵 기준가 · 판매가 아님/);
  assert.match(exchangeRoomSource, /BalancedAppText/);
  assert.match(exchangeRoomSource, /useFocusEffect/);
  assert.match(exchangeRoomSource, /<Modal/);
  assert.match(exchangeRoomSource, /<ExchangeRulesModal/);
  assert.match(exchangeRoomSource, /교환 규칙/);
  assert.match(exchangeRoomSource, /accessibilityRole="checkbox"/);
  assert.match(exchangeRoomSource, /다시 보지 않기/);
  assert.match(exchangeRoomSource, /readExchangeRulesDismissed/);
  assert.match(exchangeRoomSource, /writeExchangeRulesDismissed/);
  assert.match(localDatabaseSource, /DATABASE_VERSION = 4/);
  assert.match(localDatabaseSource, /CREATE TABLE IF NOT EXISTS app_preferences/);
  assert.match(localDatabaseSource, /exchange\.rules\.dismissed\.v2/);
  assert.match(localDatabaseSource, /exchange\.listings\.v3/);
  assert.match(exchangeRoomSource, /등록글은 7일 동안 공개/);
  assert.match(exchangeRoomSource, /남은 보관 기간이 14일보다 짧으면 14일로 연장/);
  assert.match(exchangeRoomSource, /교환으로 받은 상품은 포인트 환급 대상이 아니며, 본인이 가챠에서 직접 뽑아 보관 중인 상품만 포인트로 환급/);
  assert.doesNotMatch(exchangeRoomSource, /표시 금액은 판매가가 아닌 앱 기준가예요/);
  assert.doesNotMatch(exchangeRoomSource, /<ExchangeRuleCard/);
  assert.doesNotMatch(exchangeRoomSource, /가챠샵에서 구매해 보관함에 등록된 상품만 올릴 수 있어요/);
  assert.match(exchangeRoomSource, /<SeedInputShell/);
  assert.match(exchangeRoomSource, /placeholder="상품명·작품 검색"/);
  assert.match(exchangeRoomSource, /accessibilityLabel="교환방 상품 검색"/);
  assert.match(exchangeRoomSource, /keyboardShouldPersistTaps="handled"/);
  assert.match(exchangeRoomSource, /검색 결과가 없어요/);
  assert.match(exchangeRoomSource, /검색어 지우기/);
  assert.match(exchangeRoomSource, /const tokens = await readAuthTokens\(\)/);
  assert.match(exchangeRoomSource, /fetchExchangeRoom\([\s\S]*?runtime\.apiBaseUrl,[\s\S]*?undefined,[\s\S]*?debouncedQuery,[\s\S]*?false,[\s\S]*?tokens\?\.accessToken/);
  assert.match(exchangeApiSource, /includePreview = false/);
  assert.match(exchangeApiSource, /items\.length === 0 && includePreview/);
  assert.match(exchangeApiSource, /query:\s*\{\s*limit:\s*30,\s*category,\s*q:\s*search\s*\}/);
  assert.match(exchangeRoomSource, /router\.push\("\/exchange\/new"\)/);
  assert.match(exchangeRoomSource, />상품 올리기</);
  assert.match(exchangeRoomSource, />현황</);
  assert.match(exchangeRoomSource, /accessibilityLabel="교환 상품 올리기"/);
  assert.match(exchangeRoomSource, /accessibilityLabel="내 교환 현황"/);
  assert.match(exchangeActivityRouteSource, /ExchangeActivityScreen/);
  assert.match(exchangeActivitySource, /fetchMyExchangeActivity/);
  assert.match(exchangeActivitySource, /등록한 글/);
  assert.match(exchangeActivitySource, /신청한 교환/);
  assert.doesNotMatch(exchangeRoomSource, /등록 화면은 다음 단계예요|이어(?:서)? 만들 예정/);
  assert.match(exchangeRoomSource, /productSubjectTitle\(product\.name, productIpName\)/);
  assert.match(exchangeRoomSource, /accessibilityLabel=\{listingAccessibilityLabel\}/);
  assert.match(exchangeCreateRouteSource, /ExchangeCreateScreen/);
  assert.match(exchangeCreateSource, /fetchExchangeListingInventory/);
  assert.match(exchangeCreateSource, /createExchangeListing/);
  assert.match(exchangeCreateSource, /<SeedTextInput/);
  assert.match(exchangeCreateSource, /교환 메시지/);
  assert.match(exchangeCreateSource, /추가 설명 \(선택\)/);
  assert.match(exchangeCreateSource, /교환 등록하기/);
  assert.doesNotMatch(exchangeCreateSource, /올릴 상품 선택/);
  assert.doesNotMatch(exchangeCreateSource, /등록하는 동안 이 상품은 교환용으로 안전하게 보관돼요/);
  assert.match(exchangeCreateSource, /등록 가능한 상품이 없어요/);
  assert.match(exchangeCreateSource, /<BalancedParagraphText[\s\S]*?paragraphs=\{\[\s*"가챠로 뽑은 상품만 가능해요\.",\s*"배송을 신청했거나 이미 받은 상품, 포인트 환급·다른 교환에 사용 중인 상품은 표시되지 않아요\.",?\s*\]\}/);
  assert.match(exchangeCreateSource, /accessibilityRole="checkbox"/);
  assert.match(exchangeCreateSource, /선택 \{selectedIds\.length\}\/2개/);
  assert.match(exchangeCreateSource, /title\.trim\(\)/);
  assert.match(exchangeCreateSource, /details\.trim\(\)/);
  assert.match(exchangeApiSource, /export async function fetchExchangeListingInventory[\s\S]*?snapshot\.items\.filter\(isDrawnExchangeInventory\)/);
  assert.doesNotMatch(exchangeApiSource, /직접 뽑은 뒤 배송을 신청하지 않고 보관함에 보관 중/);
  assert.match(exchangeApiSource, /details:\s*""/);
  assert.match(exchangeDetailSource, /item\.details\.trim\(\)[\s\S]*?styles\.details/);
  assert.match(exchangeApiSource, /export async function createExchangeListing[\s\S]*?client\.POST\("\/v1\/exchange\/listings"[\s\S]*?"Idempotency-Key": randomUUID\(\)[\s\S]*?body: input/);
  assert.match(exchangeDetailRouteSource, /ExchangeListingDetailScreen/);
  assert.match(exchangeApiSource, /proposerNickname/);
  assert.match(exchangeApiSource, /\/v1\/auth\/me/);
  assert.match(exchangeApiSource, /offers\/\{offerId\}\/decision/);
  assert.match(exchangeApiSource, /"Idempotency-Key": randomUUID\(\)/);
  assert.match(exchangeDetailSource, /들어온 제안/);
  assert.doesNotMatch(exchangeDetailSource, /B·C·D·E가 각자 직접 뽑은 상품 하나만 골라 제안했어요|제안자는 별도 글을 작성하지 않아요|sectionDescription/);
  assert.match(exchangeDetailSource, /교환하기/);
  assert.doesNotMatch(exchangeDetailSource, /이 제안 선택하기/);
  assert.match(exchangeDetailSource, /거절하기/);
  assert.match(exchangeDetailSource, /교환 신청하기/);
  assert.match(exchangeDetailSource, /\/exchange\/\$\{listingId\}\/offer/);
  assert.doesNotMatch(exchangeDetailSource, /proposal\.message|proposalMessage/);
  assert.match(exchangeDetailSource, /Image\.getSize/);
  assert.match(exchangeDetailSource, /resizeMode="contain"/);
  assert.match(exchangeDetailSource, /\{ aspectRatio: imageAspectRatio \}/);
  assert.match(exchangeDetailSource, /productCardLandscape/);
  assert.doesNotMatch(exchangeDetailSource, /productImageFrame:\s*\{[^}]*aspectRatio:\s*1/);
  assert.match(exchangeOfferRouteSource, /ExchangeOfferScreen/);
  assert.match(exchangeOfferSource, /fetchExchangeOfferInventory/);
  assert.match(exchangeOfferSource, /createExchangeOffer/);
  assert.match(exchangeVisibilitySource, /item\.status === "OWNED"[\s\S]*?item\.sourceType === "GACHA"[\s\S]*?isCustomerProductCategoryEnabledOn\(item\.product\.category, "exchange"\)/);
  assert.doesNotMatch(exchangeVisibilitySource, /item\.sourceType === "KUJI"/);
  assert.match(exchangeApiSource, /isCustomerVisibleExchangeBundle\(exchangeListingInventories\(listing\)\)/);
  assert.match(exchangeApiSource, /export async function fetchMyExchangeActivity[\s\S]*?authored:[\s\S]*?\.filter\(\(listing\) => isCustomerVisibleExchangeBundle\(exchangeListingInventories\(listing\)\)\)[\s\S]*?applied:[\s\S]*?\.filter\(\(listing\) => isCustomerVisibleExchangeBundle\(exchangeListingInventories\(listing\)\)\)/);
  assert.match(exchangeApiSource, /isCustomerVisibleExchangeBundle\(exchangeOfferInventories\(offer\)\)/);
  assert.match(exchangeRoomSource, /areCustomerVisibleExchangeProducts\(item\.products\?\.length \? item\.products : \[item\.product\]\)/);
  assert.match(exchangeCreateSource, /toggleExchangeInventorySelection/);
  assert.match(exchangeOfferSource, /toggleExchangeInventorySelection/);
  assert.match(exchangeOfferSource, /교환 아이템 선택/);
  assert.match(exchangeOfferSource, /fetchExchangeDetail/);
  assert.match(exchangeOfferSource, /accessibilityRole="checkbox"/);
  assert.match(exchangeOfferSource, /가챠로 뽑은 상품만 가능해요/);
  assert.match(exchangeOfferSource, /교환 신청 완료/);
  assert.doesNotMatch(exchangeOfferSource, /AppTextInput|TextInput|Keyboard/);
  assert.doesNotMatch(exchangeDetailSource, /교환 규칙|ruleBox/);
  assert.match(exchangeDetailSource, /productSubjectTitle\(product\.name, ipName\)/);
  assert.doesNotMatch(tabsLayoutSource, /name="exchange\/\[listingId\]"/);
  assert.doesNotMatch(tabsLayoutSource, /name="exchange\/new"/);
});

test("native customer screens omit repeated reference-price disclaimers", () => {
  const customerSource = ["apps/mobile/src", "apps/mobile/app"]
    .flatMap((relativePath) => collectTsxSources(path.join(root, relativePath)))
    .map(([relativePath, source]) => `${relativePath}\n${source}`)
    .join("\n");

  assert.doesNotMatch(customerSource, /(?:가챠샵|앱) 기준가 · 판매가 아님/);
  assert.doesNotMatch(customerSource, /표시 금액은 판매가가 아닌 앱 기준가예요/);
  assert.doesNotMatch(customerSource, /사용자가 정한 판매가가 아니라 앱에 등록된 상품 기준가예요/);
  assert.doesNotMatch(customerSource, /판매 상태와 가챠샵 기준가를 확인/);
  assert.match(profileSectionSource, /예상 환급 포인트 · 구매가의 50%/);
});

test("native gacha and kuji shops coexist with the shared drawn-product storage root", () => {
  assert.match(gachaRouteSource, /<ShopScreen category="gacha" \/>/);
  assert.match(kujiRouteSource, /<ShopScreen category="kuji" \/>/);
  assert.doesNotMatch(`${gachaRouteSource}\n${kujiRouteSource}`, /MigrationScreen/);
  assert.match(productDetailRouteSource, /ProductDetailScreen/);
  assert.match(shopSource, /상품명·작품 검색/);
  assert.match(shopSource, /\/product\//);
  assert.doesNotMatch(shopSource, /<SeedChip|PRODUCT_CATEGORY_OPTIONS|useStorefrontCategoryOptions|selectedCategory|categoryRail/);
  assert.match(shopSource, /export function ShopScreen\(\{ category \}: \{ category: ShopRootCategory \}\)/);
  assert.match(shopSource, /const shopTitle = `\$\{categoryLabel\(category\)\}샵`/);
  assert.doesNotMatch(
    shopSource,
    /가챠와 쿠지를 먼저 만나보세요|피규어와 카드는 차례로 준비하고 있어요|categoryDescription/,
  );
  for (const endpoint of ["/v1/catalog/products", "/v1/catalog/ips", "/draw-odds", "/v1/account/wishlist/"]) {
    assert.match(shopApiSource, new RegExp(endpoint.replaceAll("/", "\\/")));
  }
  assert.doesNotMatch(productDetailSource, /같은 작품 덕룸 보기|수집가들의 진열과 사진/);
  assert.doesNotMatch(
    productDetailSource,
    /productMetadataText\(product, "description"\)|정식 등록 상품입니다|상품 구성과 판매 방식은 아래 안내를 확인해 주세요|styles\.description/,
  );
  assert.match(productDetailSource, /결제 화면에서 포인트와 최종 결제 금액을 확인해 주세요/);
  assert.match(catalogProductRowSource, /productSubjectTitle\(product\.name, ipName\)/);
  assert.match(shopSource, /productSubjectTitle\(product\.name, ipName\)/);
  assert.match(homeSource, /productSubjectTitle\(product\.name, ipName\)/);
  assert.match(profileSectionSource, /productSubjectTitle\(product\.name, ipName\)/);
  assert.doesNotMatch(catalogProductRowSource, /style=\{styles\.name\}>\{product\.name\}/);
  assert.match(exchangeRoomSource, /resizeMode="contain"/);
  assert.match(profileSectionSource, /catalogFrameCategory === "kuji" \? "contain" : "cover"/);
  assert.match(catalogProductRowSource, /product\.category === "kuji" \|\| \(product\.category === "gacha" && !storefrontUri\)/);
  assert.match(homeSource, /<CatalogDiscoveryImage/);
  assert.doesNotMatch(shopSource, /Image\.getSize\(/);
  assert.match(shopSource, /gachaProductImageFrame:\s*\{\s*aspectRatio:\s*8 \/ 7\s*\}/);
  assert.match(shopSource, /kujiProductImageFrame:\s*\{\s*aspectRatio:\s*7 \/ 4\s*\}/);
  assert.doesNotMatch(shopSource, /FIXTURE_CONTENT_ASPECT_RATIOS/);
  assert.doesNotMatch(shopSource, /function displayProductAspectRatio/);
  assert.match(shopSource, /<CatalogDiscoveryImage/);
  assert.match(shopSource, /targetAspectRatio=\{category === "kuji" \? 7 \/ 4 : 8 \/ 7\}/);
  assert.match(shopSource, /<GachaMachineFrame category=\{category\} clean>/);
  assert.match(shopSource, /\.\.\.catalogProductCardSurface/);
  assert.doesNotMatch(productDetailSource, /Image\.getSize\(|setImageAspectRatio/);
  assert.match(productDetailSource, /<CatalogProductImage/);
  assert.match(productDetailSource, /product\.category === "kuji" \? styles\.heroKuji : styles\.heroGacha/);
  assert.match(productDetailSource, /heroGacha:\s*\{[^}]*aspectRatio:\s*4\s*\/\s*3/);
  assert.match(productDetailSource, /heroKuji:\s*\{[^}]*aspectRatio:\s*16\s*\/\s*9/);
  assert.match(productDetailSource, /resizeMode="contain"/);
  assert.match(productDetailSource, /heroContainer:\s*\{[^}]*marginHorizontal:\s*seed\.spacing\.x2/);
  assert.match(productDetailSource, /hero:\s*\{[^}]*width:\s*"100%"/);
  assert.match(homeSource, /\/product\//);
  assert.doesNotMatch(homeSource, /router\.push\("\/events" as Href\)/);
  assert.doesNotMatch(homeSource, /onIpPress|pathname:\s*"\/search"/);

  assert.match(storageRouteSource, /StorageRootScreen/);
  assert.doesNotMatch(storageRouteSource, /DukroomScreen/);
  assert.doesNotMatch(storageRouteSource, /MigrationScreen/);
  assert.match(dukroomDetailRouteSource, /<Redirect href="\/\(tabs\)\/storage"/);
  assert.doesNotMatch(dukroomDetailRouteSource, /DukroomDetailScreen/);
  assert.match(storageRootSource, /<RootCategoryTitle>보관함<\/RootCategoryTitle>/);
  assert.match(storageRootSource, /useProfileSnapshot/);
  assert.match(storageRootSource, /accessibilityLabel="교환방 열기"[\s\S]*?router\.push\("\/exchange"\)/);
  assert.ok(
    storageRootSource.indexOf('accessibilityLabel="교환방 열기"') < storageRootSource.indexOf("{isProfileSessionBlocked"),
    "public exchange browsing entry must stay outside the signed-in storage gate",
  );
  assert.match(storageRootSource, /returnTo="\/\(tabs\)\/storage"/);
  assert.match(storageRootSource, /<StorageHubContent/);
  assert.match(profileHomeSource, /section: "exchange-activity", label: "내 교환 현황"/);
  assert.match(profileHomeSource, /section === "exchange-activity"[\s\S]*?router\.push\("\/exchange\/activity"\)/);
  assert.match(profileSectionSource, /label="보관 중"/);
  assert.match(profileSectionSource, /label="교환 또는 배송 중인 상품"[\s\S]*?wide/);
  assert.match(profileSectionSource, /label="포인트 환급"/);
  assert.match(profileSectionSource, /item\.status === "OWNED"/);
  assert.match(profileSectionSource, /item\.sourceType === "GACHA" \|\| item\.sourceType === "KUJI"/);
  assert.match(rootFloatingTabBarSource, /storage: "보관함"/);
  assert.match(rootFloatingTabBarSource, /<StorageTabIcon color=\{color\} size=\{25\} \/>/);
  assert.doesNotMatch(rootFloatingTabBarSource, /storage: "덕룸"|storage: "grid-outline"/);
  assert.equal(existsSync(path.join(root, "apps/mobile/app/storage.tsx")), false);
  assert.doesNotMatch(tabsLayoutSource, /name="product\/\[productId\]"/);
  assert.doesNotMatch(tabsLayoutSource, /name="dukroom\/\[postId\]"/);
});

test("native Home and fixed-category shop images expose loading, missing, error, and explicit retry states", () => {
  const { catalogProductImageRequestId } = catalogProductImageState;
  const uri = "http://127.0.0.1:4174/assets/dabboba/products/missing.png";

  assert.equal(catalogProductImageRequestId(null, 0), null);
  assert.notEqual(catalogProductImageRequestId(uri, 0), catalogProductImageRequestId(uri, 1));
  assert.match(catalogProductImageSource, /failedRequestIds\.includes\(candidate\.requestId\)/);
  assert.match(catalogProductImageSource, /setFailedRequestIds\(\(current\) => current\.includes\(requestId\) \? current : \[\.\.\.current, requestId\]\)/);
  assert.match(catalogProductImageSource, /fallbackSources/);
  assert.match(catalogProductImageSource, /candidates\.find\(\(candidate\) => !failedRequestIds\.includes\(candidate\.requestId\)\)/);
  assert.match(catalogProductImageSource, /key=\{requestId\}/);
  assert.match(catalogProductImageSource, /이미지 준비 중/);
  assert.match(catalogProductImageSource, /이미지 불러오는 중/);
  assert.match(catalogProductImageSource, /이미지 로딩 실패/);
  assert.match(catalogProductImageSource, /pointerEvents="none"/);
  assert.doesNotMatch(catalogProductImageSource, /Pressable|onPress/);
  for (const source of [homeSource, shopSource]) {
    assert.match(source, /<CatalogDiscoveryImage/);
    assert.match(source, /requestKey=\{imageRequestKey\}/);
    assert.match(source, /setImageRequestKey\(\(current\) => current \+ 1\)/);
  }
  assert.match(catalogDiscoveryImageSource, /<CatalogProductImage/);
  assert.match(catalogDiscoveryImageSource, /fallbackSources=\{fallbackSources\}/);
});

test("native fixed-category shop empty states separate catalog absence, filtered results, and network failure", () => {
  assert.match(shopSource, /const listEmpty = isComingSoon \|\| !catalogEnabled/);
  assert.match(shopSource, /hasSearchConditions \? \([\s\S]*?검색 결과가 없어요[\s\S]*?검색 조건 초기화[\s\S]*?: \([\s\S]*?상품을 준비 중이에요\./);
  assert.match(shopSource, /message \?[\s\S]*?상품을 불러오지 못했어요[\s\S]*?다시 불러오기/);
  assert.match(shopSource, /catch \{[\s\S]*?setMessage\("연결 상태를 확인한 뒤 다시 시도해 주세요\."\)/);
  assert.doesNotMatch(shopSource, /error instanceof Error \? error\.message/);
  assert.match(homeSource, /setMessage\("홈을 불러오지 못했어요\. 연결 상태를 확인해 주세요\."\)/);
  assert.doesNotMatch(homeSource, /setMessage\(error instanceof Error \? error\.message/);
  assert.equal((shopSource.match(/<KoreanPixelTitle variant="section"(?:\s+[^>]*)?>/g) ?? []).length >= 4, true);

  const resetConditionsSource = shopSource.slice(
    shopSource.indexOf("const resetSearchConditions"),
    shopSource.indexOf("const openProduct"),
  );
  assert.match(resetConditionsSource, /setQuery\(""\)/);
  assert.match(resetConditionsSource, /setExcludeSoldOut\(false\)/);
  assert.match(resetConditionsSource, /Keyboard\.dismiss\(\)/);
  assert.match(resetConditionsSource, /setSearchFocused\(false\)/);
  assert.match(resetConditionsSource, /router\.setParams\(\{ ipId: undefined \}\)/);
  assert.doesNotMatch(resetConditionsSource, /setSelectedCategory/);
});

test("Home rails omit redundant whole-view actions while each shop keeps a fixed top-level category", () => {
  assert.doesNotMatch(homeSource, /전체보기|openCatalogCategory|categoryNavigationSequence|onViewAll|onTrailingPress/);
  assert.match(homeSource, /<SectionTitle title=\{section\.title\} subtitle=\{section\.subtitle\} \/>/);
  assert.match(homeSource, /section=\{collection\}/);
  assert.doesNotMatch(homeSource, /group\.label|dynamic \/>/);
  assert.match(homeSource, /sectionHeader:\s*\{[\s\S]*?marginTop:\s*seed\.spacing\.x8[\s\S]*?marginBottom:\s*seed\.spacing\.x4[\s\S]*?paddingHorizontal:\s*seed\.spacing\.globalGutter/);
  assert.doesNotMatch(homeSource, /sectionHeader:\s*\{[^}]*minHeight/);
  assert.doesNotMatch(homeSource, /sectionHeader:\s*\{[^}]*border(?:Top|Bottom)Width/);
  assert.doesNotMatch(homeSource, /sectionHeader:\s*\{[^}]*backgroundColor/);
  assert.doesNotMatch(homeSource, /todayGroupHeader/);
  assert.doesNotMatch(homeSource, /todayGroup:\s*\{|style=\{styles\.todayGroup\}/);
  assert.doesNotMatch(homeSource, /<KoreanPixelTitleAccessory>\{group\.products\.length\}개<\/KoreanPixelTitleAccessory>/);

  assert.match(shopSource, /useLocalSearchParams<\{ ipId\?: string \| string\[\] \}>/);
  assert.match(shopSource, /fetchShopProductPage\(runtime\.apiBaseUrl, \{[\s\S]*?category,[\s\S]*?query,[\s\S]*?ipId: requestedIpId/);
  assert.doesNotMatch(shopSource, /category\?: string \| string\[\]|resetKey|setSelectedCategory|categoryOptions/);
  assert.match(legacyPpobaRouteSource, /category === "kuji" \? "\/\(tabs\)\/kuji" : "\/\(tabs\)\/gacha"/);
  assert.match(legacyPpobaRouteSource, /params: ipId \? \{ ipId \} : \{\}/);
});

test("native customer category surfaces share operator-managed availability and safe defaults", () => {
  assert.match(productCategoriesSource, /DEFAULT_STORE_CATEGORY_SETTINGS:[\s\S]*?category: "gacha"[\s\S]*?category: "kuji"[\s\S]*?category: "figure"[\s\S]*?availability: "hidden"[\s\S]*?category: "tcg"[\s\S]*?availability: "hidden"/);
  assert.match(productCategoriesSource, /applyStorefrontCategorySettings/);
  assert.match(productCategoriesSource, /storefrontCategoryOptions\(surface/);
  assert.match(productCategoriesSource, /isCustomerVisibleProductCategory/);
  assert.match(productCategoriesSource, /function isSupportedCustomerCategory[\s\S]*?category === "gacha" \|\| category === "kuji"/);
  assert.doesNotMatch(productCategoriesSource, /category === "figure" \|\| category === "tcg"/);
  assert.match(shopSource, /useStorefrontCategorySettings\(\)/);
  assert.match(homeSource, /useStorefrontCategorySettings/);
  assert.match(homeSource, /buildConfiguredHomeCollections/);
  assert.match(homeSource, /isCustomerProductCategoryEnabledOn\(product\.category, "home"\)/);
  assert.match(productCategoriesSource, /isCustomerBrowsableCatalogCategory/);
  assert.match(catalogApiSource, /filter\(\(product\) => \([\s\S]*?isCustomerProductCategoryEnabledOn\(product\.category, "home"\)/);
  assert.match(shopApiSource, /filter\(\(product\) => \([\s\S]*?isCustomerBrowsableCatalogCategory\(product\.category\)/);
  assert.match(shopApiSource, /\/v1\/catalog\/products\/\{productId\}[\s\S]*?isCustomerVisibleProductCategory\(productResult\.data\.category\)/);
  assert.match(homeSource, /cached\.products\.filter\(\(product\) => \([\s\S]*?isCustomerProductCategoryEnabledOn\(product\.category, "home"\)/);
  assert.doesNotMatch(shopSource, /\{ label: "전체" \}/);
  assert.match(shopSource, /isCustomerProductCategoryComingSoon\(category\)/);
  assert.match(shopSource, /wide=\{category === "kuji"\}/);
  assert.match(shopSource, /kujiProductCard:\s*\{\s*width:\s*"100%"\s*\}/);
  assert.match(shopSource, /isComingSoon \|\| !catalogEnabled \? \([\s\S]*?<CategoryAvailabilityState category=\{category\}/);
  assert.doesNotMatch(exchangeRoomSource, /isCustomerProductCategoryComingSoon\(selectedCategory\)|CategoryAvailabilityState|selectedCategory/);
  assert.match(productDetailSource, /isCustomerProductCategoryComingSoon\(product\?\.category\)/);
  assert.match(productDetailSource, /productComingSoon[\s\S]*?<CategoryAvailabilityState category=\{product\.category\}/);
  assert.match(checkoutScreenSource, /isCustomerProductCategoryComingSoon\(product\?\.category\)/);
  assert.match(checkoutScreenSource, /productComingSoon[\s\S]*?<CategoryAvailabilityState category=\{product\.category\}/);
  assert.match(checkoutConnectionScreenSource, /isCustomerProductCategoryComingSoon\(product\?\.category\)/);
  assert.match(checkoutConnectionScreenSource, /productComingSoon[\s\S]*?<CategoryAvailabilityState category=\{product\.category\}/);
  assert.doesNotMatch(shopSource, /<KoreanPixelTitle variant="section">상품<\/KoreanPixelTitle>|styles\.sectionCount/);
  assert.match(shopSource, /accessibilityLabel="상품 필터 및 정렬 열기"/);
  assert.match(shopSource, /<ShopFilterDrawer/);
  assert.match(shopSource, /품절 제외/);
  for (const option of ["최신순", "인기순", "가격 높은순", "가격 낮은순"]) {
    assert.match(shopFilterSource, new RegExp(option));
  }
  assert.match(shopSource, /animationType="slide"/);
  assert.match(shopSource, /accessibilityRole="switch"/);
  assert.match(shopSource, /accessibilityRole="radio"/);
});

test("native kuji claims its room before the shared quantity and purchase checkout", () => {
  assert.match(productDetailSource, /product\.category === "kuji"[\s\S]*?buildKujiRoomGatePath\(product\.id\)[\s\S]*?`\/checkout\/\$\{encodeURIComponent\(product\.id\)\}`/);
  assert.match(productDetailSource, /isDrawCategory\(product\.category\) \? "뽑으러 가기" : "구매 준비"/);
  assert.match(productDetailSource, /buildKujiRoomGatePath/);
  assert.doesNotMatch(productDetailSource, /buildGachaPreviewParams|resolveKujiEntryPath|결제 금액 확인/);

  assert.match(checkoutScreenSource, /<Text style=\{styles\.sectionTitle\}>구매 상품<\/Text>[\s\S]*?styles\.quantityRow/);
  assert.match(checkoutScreenSource, /구매 수량/);
  assert.match(checkoutScreenSource, /checkoutNeedsAgreement/);
  assert.match(checkoutScreenSource, /결제 수단 준비 중/);
  assert.match(checkoutScreenSource, /포인트로 구매하기/);
  assert.doesNotMatch(checkoutScreenSource, /buildGachaPreviewParams|openGachaPreview|\/draw\/preview|체험하기/);
  assert.match(checkoutScreenSource, /kujiCheckoutExpiresAt/);
  assert.match(checkoutScreenSource, /결제 남은 시간/);
  assert.match(checkoutScreenSource, /createKujiCheckoutOrder/);
  assert.match(checkoutScreenSource, /kujiRoomEntryId:\s*kujiEntryId/);
  assert.match(checkoutScreenSource, /paidKujiOrderEntitlementIds\(order, quantity\)/);
  assert.match(checkoutScreenSource, /entitlementIds:\s*entitlementIds\.join\(","\)/);
  assert.match(checkoutScreenSource, /`\/kuji\/draw\/\$\{encodeURIComponent\(product\.id\)\}\?\$\{query\.toString\(\)\}`/);
  assert.doesNotMatch(checkoutScreenSource, /resolveKujiEntryPath|LOCAL_KUJI_ROOM_AVAILABILITY/);
  assert.match(checkoutScreenSource, /"구매 금액 확인"/);
  assert.match(checkoutScreenSource, /text: "취소", style: "cancel"/);
  assert.match(checkoutScreenSource, /text: "구매하기", onPress: \(\) => void submitKujiOrder\(\)/);
  assert.match(checkoutScreenSource, /order\.status === "PENDING_PAYMENT"/);
  assert.doesNotMatch(checkoutScreenSource, /openPurchasedDraw|쿠지[^\n]*체험용 뽑기/);
});

test("native purchase Product Detail continues into a server-verified PortOne checkout", () => {
  assert.match(productDetailSource, /결제 화면으로 이동할까요/);
  assert.match(productDetailSource, /결제 화면에서 포인트와 최종 결제 금액을 확인해 주세요/);
  assert.match(productDetailSource, /`\/checkout\/\$\{encodeURIComponent\(product\.id\)\}\?quantity=\$\{quantity\}`/);

  assert.match(checkoutRouteSource, /CheckoutScreen/);
  assert.match(checkoutScreenSource, /useLocalSearchParams/);
  assert.match(checkoutScreenSource, /fetchProductDetail/);
  assert.match(checkoutScreenSource, /fetchCheckoutPointBalance/);
  assert.match(checkoutApiSource, /\/v1\/account\/points/);
  assert.match(checkoutScreenSource, /<DetailPageHeader title="결제"/);
  assert.match(checkoutScreenSource, /구매 상품/);
  assert.match(checkoutScreenSource, /쿠폰 사용/);
  assert.match(checkoutScreenSource, /포인트 사용/);
  assert.match(checkoutScreenSource, /결제 수단/);
  assert.match(checkoutScreenSource, /신용\/체크카드/);
  assert.match(checkoutScreenSource, /KG이니시스 카드 결제/);
  assert.match(checkoutScreenSource, /주문내용 확인 및 결제 동의/);
  assert.match(checkoutScreenSource, /EXPO_PUBLIC_PORTONE_STORE_ID/);
  assert.match(checkoutScreenSource, /결제 수단 준비 중/);
  assert.match(checkoutScreenSource, /포인트로 구매하기/);
  assert.doesNotMatch(checkoutScreenSource, /openConnectionGuide|\/checkout\/connect\//);
  assert.match(checkoutScreenSource, /resizeMode="contain"/);
  assert.match(checkoutScreenSource, /accessibilityRole="radio"/);
  assert.match(checkoutScreenSource, /disabled=\{!paymentMethodsEnabled\}/);
  assert.match(checkoutScreenSource, /accessibilityState=\{\{ disabled: !paymentMethodsEnabled, selected \}\}/);
  assert.match(checkoutScreenSource, /createKujiCheckoutOrder/);
  assert.match(checkoutScreenSource, /checkoutNeedsAgreement/);
  assert.doesNotMatch(tabsLayoutSource, /name="checkout/);

  assert.match(checkoutConnectionRouteSource, /Redirect href="\/"/);
  assert.doesNotMatch(checkoutConnectionRouteSource, /CheckoutConnectionScreen/);
  assert.match(checkoutConnectionScreenSource, /useLocalSearchParams/);
  assert.match(checkoutConnectionScreenSource, /fetchProductDetail/);
  assert.match(checkoutConnectionScreenSource, /결제 연결 안내/);
  assert.match(checkoutConnectionScreenSource, /SeedInlineGuidance/);
  assert.match(checkoutConnectionScreenSource, /결제·주문·추첨권 발급을 진행하지 않아요/);
  assert.doesNotMatch(checkoutConnectionScreenSource, /결제 진행 순서|CheckoutStep/);
  for (const removedStep of ["가격·재고 재확인", "결제 승인", "서버 주문 확정"]) {
    assert.doesNotMatch(checkoutConnectionScreenSource, new RegExp(removedStep));
  }
  assert.doesNotMatch(checkoutConnectionScreenSource, /\/draw\/preview\/|openNextScreen/);
  assert.match(checkoutConnectionScreenSource, /label="결제 준비로 돌아가기"/);
  assert.match(checkoutConnectionScreenSource, /<DetailPageHeader title="결제 연결 안내"/);
  assert.match(checkoutConnectionScreenSource, /<CatalogProductImage/);
  assert.match(checkoutConnectionScreenSource, /resizeMode="contain"/);
  assert.doesNotMatch(checkoutConnectionScreenSource, /submitOrder|createOrder|issueDraw|drawEntitlement/);
});

test("native my-info hub opens every account utility and nested member detail outside root tabs", () => {
  assert.match(profileRouteSource, /ProfileHomeScreen/);
  assert.doesNotMatch(profileRouteSource, /MigrationScreen/);
  assert.match(profileDetailRouteSource, /ProfileSectionScreen/);
  assert.match(profileMemberRouteSource, /ProfileMemberDetailScreen/);
  for (const label of ["상품 기록", "내 찜 목록", "보관함", "내 교환 현황", "배송 신청 내역", "구매 내역", "포인트 내역", "신청방", "고객센터", "사업자 정보", "회원정보 관리", "설정"]) {
    assert.match(profileHomeSource, new RegExp(label));
  }
  assert.match(profileHomeSource, /배송 신청 · 포인트 환급/);
  assert.match(profileHomeSource, /section: "product-history", label: "상품 기록"/);
  assert.match(profileHomeSource, /section === "product-history"[\s\S]*?router\.push\("\/product-history"\)/);
  assert.match(profileHomeSource, /section === "storage"[\s\S]*?router\.navigate\("\/\(tabs\)\/storage"\)/);
  assert.match(profileHomeSource, /section === "exchange-activity"[\s\S]*?router\.push\("\/exchange\/activity"\)/);
  assert.match(profileHomeSource, /section: "shipping", label: "배송 신청 내역"/);
  const profileSummaryIndex = profileHomeSource.indexOf("styles.profileSummaryCard");
  const profileCardIndex = profileHomeSource.indexOf("styles.profileCard");
  const walletCardIndex = profileHomeSource.indexOf("styles.walletCard");
  const statsCardIndex = profileHomeSource.indexOf("styles.statsCard");
  const requestCardIndex = profileHomeSource.indexOf("styles.requestCard");
  const commerceMenuIndex = profileHomeSource.search(/<MenuGroup\s+title="쇼핑"\s+items=\{commerceEnabled/);
  const accountMenuIndex = profileHomeSource.indexOf('<MenuGroup title="계정" items={ACCOUNT_MENU}');
  const supportMenuIndex = profileHomeSource.indexOf('<MenuGroup title="지원" items={SUPPORT_MENU}');
  assert.ok(
    profileSummaryIndex > -1
      && profileCardIndex > profileSummaryIndex
      && walletCardIndex > profileCardIndex
      && statsCardIndex > walletCardIndex
      && requestCardIndex > statsCardIndex
      && commerceMenuIndex > requestCardIndex
      && accountMenuIndex > commerceMenuIndex
      && supportMenuIndex > accountMenuIndex,
  );
  assert.match(profileHomeSource, /<ProfileMetric label="내 포인트" value=\{summary\?\.pointBalanceLabel \?\? "불러오지 못했어요"\}/);
  assert.match(profileHomeSource, /pointBalanceLabel: pointsFailed \|\| snapshot\.pointBalance === null \? null : `\$\{snapshot\.pointBalance\.toLocaleString\("ko-KR"\)\}P`/);
  assert.doesNotMatch(profileHomeSource, /pointBalance \?\? 0/);
  assert.doesNotMatch(profileHomeSource, /내 쿠폰|준비 중/);
  assert.match(profileHomeSource, /const COMMERCE_MENU: ReadonlyArray<ProfileMenuItem> = \[/);
  assert.match(profileHomeSource, /const ACCOUNT_MENU: ReadonlyArray<ProfileMenuItem> = \[/);
  assert.match(profileHomeSource, /const SUPPORT_MENU: ReadonlyArray<ProfileMenuItem> = \[/);
  assert.match(profileHomeSource, /COMMERCE_MENU\.filter\(\(item\) => item\.section !== "exchange-activity"\)/);
  assert.doesNotMatch(profileHomeSource, /PROFILE_MENU/);
  assert.match(profileHomeSource, /menuCard:[\s\S]*?borderWidth:\s*1/);
  assert.match(profileHomeSource, /menuRowDivider:[\s\S]*?marginHorizontal:/);
  for (const endpoint of [
    "/v1/account/profile",
    "/v1/account/basic-info",
    "/v1/account/default-address",
    "/v1/account/wishlist",
    "/v1/account/inventory",
    "/v1/account/orders",
    "/v1/account/points",
    "/v1/account/point-returns",
    "/v1/account/shipping-requests",
    "/v1/wanted-requests",
    "/v1/notices",
    "/v1/inquiries",
    "/v1/account/notification-preferences",
    "/v1/catalog/ips",
  ]) {
    assert.match(profileApiSource, new RegExp(endpoint.replaceAll("/", "\\/")));
  }
  assert.doesNotMatch(profileApiSource, /\/v1\/exchange\/inventory/);
  assert.match(profileHomeSource, /로그인하면 주문·포인트·배송 내역과 나의 수집 기록을 확인할 수 있어요/);
  assert.doesNotMatch(profileSectionSource, /로그인 전 화면 예시/);
  assert.match(profileSectionSource, /배송 신청/);
  assert.match(profileSectionSource, /포인트 환급/);
  assert.match(profileSectionSource, /createPointReturn/);
  assert.match(profileSectionSource, /item\.pointReturnAmount/);
  assert.doesNotMatch(profileSectionSource, /Math\.floor\(item\.product\.price \/ 2\)/);
  assert.match(profileSectionSource, /if \(section === "storage"\)[\s\S]*?<StorageHubContent/);
  assert.match(profileSectionSource, /if \(section === "shipping"\) return <ShippingHistory/);
  assert.match(profileSectionSource, /<StorageModeTab label="보관 중"/);
  assert.match(profileSectionSource, /<StorageModeTab label="교환 또는 배송 중인 상품"[\s\S]*?wide/);
  assert.match(profileSectionSource, /<StorageModeTab label="포인트 환급"/);
  assert.match(profileSectionSource, /inventory\?\.filter\(isExchangeOrShippingInventory\)/);
  assert.match(profileSectionSource, /item\.status === "EXCHANGE_LISTED"[\s\S]*?item\.status === "EXCHANGE_OFFERED"[\s\S]*?item\.status === "SHIPPING"/);
  assert.doesNotMatch(profileHomeSource, /주문·포인트·배송 상태는 내 계정의 최신 내역/);
  for (const detail of ["개인정보", "기본 배송지", "로그인 및 보안", "알림 수신설정", "개인정보·수신 동의", "약관·운영정책", "로그아웃·회원탈퇴"]) {
    assert.match(profileMemberSource, new RegExp(detail));
  }
  assert.match(profileMemberSource, /로그인 정보는 기기에 안전하게 보관/);
  assert.doesNotMatch(profileMemberSource, /준비 중|결제 카드 등록/);
  assert.doesNotMatch(tabsLayoutSource, /name="profile\/\[section\]"/);
});

test("native profile edit stays focused on nickname and introduction", () => {
  const editStart = profileSectionSource.indexOf("function ProfileEdit(");
  const editEnd = profileSectionSource.indexOf("\nfunction Wishlist(", editStart);
  assert.notEqual(editStart, -1);
  assert.notEqual(editEnd, -1);

  const profileEditSource = profileSectionSource.slice(editStart, editEnd);
  assert.match(profileMemberSource, /label="계정 기본정보 수정"[\s\S]*?router\.push\("\/profile\/member\/personal\/edit"/);
  assert.doesNotMatch(profileMemberSource, /label="프로필 닉네임·소개 수정"[\s\S]*?router\.push\("\/profile\/edit"/);
  assert.match(profileSectionSource, /edit:\s*\{ title: "프로필 수정" \}/);
  assert.match(profileEditSource, /<FieldLabel label="닉네임"/);
  assert.match(profileEditSource, /<FieldLabel label="한 줄 소개"/);
  assert.match(profileEditSource, /<PrimaryButton label=\{saving \? "저장 중" : "프로필 저장"\}/);
  assert.match(profileEditSource, /router\.back\(\)/);
  assert.doesNotMatch(profileEditSource, /SectionLead|profilePreview|largeAvatar|previewName|previewBio|MenuLink/);
  for (const source of [profileHomeSource, profileMemberSource]) {
    assert.match(source, /useFocusEffect/);
    assert.match(source, /hasFocusedOnce/);
    assert.match(source, /if \(hasFocusedOnce\.current\) void [\w.]*reload\(\)/);
  }
});

test("storage removes the old lead guidance while shared profile leads keep balanced wrapping", () => {
  const sectionLeadStart = profileSectionSource.indexOf("function SectionLead(");
  const sectionLeadEnd = profileSectionSource.indexOf("\nfunction FieldLabel(", sectionLeadStart);
  assert.notEqual(sectionLeadStart, -1);
  assert.notEqual(sectionLeadEnd, -1);

  const sectionLeadSource = profileSectionSource.slice(sectionLeadStart, sectionLeadEnd);
  assert.doesNotMatch(profileSectionSource, /묶음 배송하거나 가챠에서 뽑은 상품을 포인트로 환급할 수 있어요|직접 뽑아 보관 중인 상품을 묶어 배송받거나 포인트로 환급할 수 있어요/);
  assert.match(sectionLeadSource, /BalancedAppText/);
  assert.doesNotMatch(sectionLeadSource, /numberOfLines|adjustsFontSizeToFit|allowFontScaling|minimumFontScale/);
});

test("native shipping request shows the category-sensitive free-shipping policy", () => {
  assert.match(profileSectionSource, /무료 기준 · 가챠 \{GACHA_ONLY_FREE_SHIPPING_THRESHOLD\.toLocaleString\("ko-KR"\)\}원 · 쿠지 포함 \{KUJI_INCLUDED_FREE_SHIPPING_THRESHOLD\.toLocaleString\("ko-KR"\)\}원/);
  assert.match(profileSectionSource, /!selectedCount \? \(/);
  assert.match(profileSectionSource, /const threshold = quote\?\.freeShippingThreshold/);
  assert.match(profileSectionSource, /const remaining = policy\.hasSelection \? Math\.max\(threshold - subtotal, 0\) : threshold/);
  assert.match(profileSectionSource, /shippingProgressTrack/);
  assert.match(profileSectionSource, /\{quote \? "서버 확인 완료" : "선택"\} \{selectedCount\}개 · 합계 \{subtotal\.toLocaleString\("ko-KR"\)\}원/);
  assert.match(profileSectionSource, /기준 \{threshold\.toLocaleString\("ko-KR"\)\}원 · 배송비 \{shippingFee\.toLocaleString\("ko-KR"\)\}원/);
  assert.match(profileSectionSource, /배송비 \$\{shippingFee\.toLocaleString\("ko-KR"\)\}원 결제 후 신청/);
  assert.match(profileSectionSource, /if \(!shippingQuote \|\| Date\.parse\(shippingQuote\.expiresAt\) <= Date\.now\(\)\)[\s\S]*?createShippingQuote[\s\S]*?setShippingQuote\(quote\)[\s\S]*?createShippingRequest/);
  assert.match(profileSectionSource, /setShippingQuote\(null\);[\s\S]*?snapshot\.defaultAddress\?\.id[\s\S]*?snapshot\.defaultAddress\?\.version/);
  assert.match(profileApiSource, /POST\("\/v1\/account\/shipping-quotes"/);
  assert.match(profileApiSource, /body: \{ quoteId: input\.id, addressVersion: input\.addressVersion \}/);
  assert.match(profileSectionSource, /disabled=\{!selectedCount \|\| submitting\}/);
  assert.match(profileSectionSource, /request\.status === "PAYMENT_PENDING" && request\.paymentOrderId/);
  assert.doesNotMatch(profileSectionSource, /shippingPolicyCard|addressCard|storageGuidance|modeDescription/);
  assert.match(profileSectionSource, /calculateShippingPolicy/);
  assert.match(shippingPolicySource, /GACHA_ONLY_FREE_SHIPPING_THRESHOLD = 24_900/);
  assert.match(shippingPolicySource, /KUJI_INCLUDED_FREE_SHIPPING_THRESHOLD = 54_900/);
  assert.match(shippingPolicySource, /STANDARD_SHIPPING_FEE = 3_000/);
  assert.match(shippingPolicySource, /items\.some\(\(item\) => item\.sourceType === "KUJI"\)/);
});

test("category toggles keep the compact app geometry and expand responsively on wider web containers", () => {
  assert.match(prototypeCss, /\.filter-chip\s*\{[\s\S]*?min-height:\s*36px;[\s\S]*?border:\s*1px solid var\(--db-line\);[\s\S]*?border-radius:\s*8px;[\s\S]*?padding:\s*0 14px;/);
  assert.match(prototypeCss, /@container \(min-width:\s*520px\)\s*\{[\s\S]*?\.category-rail[\s\S]*?width:\s*100%;[\s\S]*?\.category-rail > \.filter-chip[\s\S]*?flex:\s*1 1 0;/);
});

test("native runtime config requires HTTPS in production and derives the Metro host in development", () => {
  const production = runtimeConfig.resolveMobileRuntimeConfig({
    configuredApiUrl: "https://api.dabboba.test",
    configuredAssetBaseUrl: "https://media.dabboba.test",
    platform: "ios",
    development: false,
  });
  assert.deepEqual({ ...production }, {
    apiBaseUrl: "https://api.dabboba.test",
    assetBaseUrl: "https://media.dabboba.test",
    commerceCapability: "PRELAUNCH",
  });

  const supabaseEdge = runtimeConfig.resolveMobileRuntimeConfig({
    configuredApiUrl: "https://yxkmvgfruphgghowzvmo.supabase.co/functions/v1/dabboba-api/",
    platform: "ios",
    development: false,
  });
  assert.equal(
    supabaseEdge.apiBaseUrl,
    "https://yxkmvgfruphgghowzvmo.supabase.co/functions/v1/dabboba-api",
  );

  const development = runtimeConfig.resolveMobileRuntimeConfig({
    metroHostUri: "192.168.219.100:8081",
    platform: "ios",
    development: true,
  });
  assert.equal(development.apiBaseUrl, "http://192.168.219.100:8788");
  assert.equal(development.assetBaseUrl, "http://192.168.219.100:4174");
  assert.equal(
    runtimeConfig.resolveCatalogImageUrl("/assets/item.jpg", "http://192.168.219.100:4174"),
    "http://192.168.219.100:4174/assets/item.jpg",
  );
  assert.equal(
    runtimeConfig.resolveCatalogImageUrl("/assets/item.jpg", "http://192.168.219.100:4174", 3),
    "http://192.168.219.100:4174/assets/item.jpg?v=3",
  );
  assert.equal(runtimeConfig.resolveCatalogImageUrl("/assets/item.jpg", null), null);

  assert.throws(
    () =>
      runtimeConfig.resolveMobileRuntimeConfig({
        configuredApiUrl: "http://api.dabboba.test",
        platform: "android",
        development: false,
      }),
    /HTTPS/,
  );
  for (const configuredApiUrl of [
    "https://api.dabboba.test/functions/v1/dabboba-api?token=unsafe",
    "https://api.dabboba.test/functions%2fv1/dabboba-api",
    "https://user@api.dabboba.test/functions/v1/dabboba-api",
  ]) {
    assert.throws(() => runtimeConfig.resolveMobileRuntimeConfig({
      configuredApiUrl,
      platform: "ios",
      development: false,
    }));
  }
});

test("commerce routes wait for the first LIVE server answer without opening in PRELAUNCH", () => {
  const access = runtimeConfig.resolveCommerceRouteAccess;
  assert.equal(access("PRELAUNCH", null, false), "DENY");
  assert.equal(access("PRELAUNCH", "LIVE", true), "DENY");
  assert.equal(access("LIVE", null, false), "WAIT");
  assert.equal(access("LIVE", "LIVE", false), "WAIT");
  assert.equal(access("LIVE", "LIVE", true), "ALLOW");
  assert.equal(access("LIVE", "PRELAUNCH", true), "DENY");
  assert.equal(access("LIVE", null, true), "DENY");
});

test("legacy WebView compatibility remains bounded while screens migrate", () => {
  assert.equal(mobilePackage.dependencies["react-native-webview"], "13.16.1");
  assert.match(mobileSource, /EXPO_PUBLIC_DABBOBA_WEB_URL/);
  assert.match(mobileSource, /EXPO_PUBLIC_DABBOBA_ALLOWED_ORIGINS/);
  assert.match(mobileSource, /Constants\.expoConfig\?\.hostUri/);
  assert.match(mobileSource, /onShouldStartLoadWithRequest=/);
  assert.match(mobileSource, /onMessage=/);
  assert.match(mobileSource, /Linking\.getInitialURL\(\)/);
  assert.match(mobileSource, /Linking\.addEventListener\("url"/);
  assert.match(mobileSource, /injectedJavaScript=\{APP_READY_INJECTION_SCRIPT\}/);
  assert.match(
    mobileSource,
    /isAllowedWebUrl\(event\.nativeEvent\.url, \[shellConfiguration\.baseOrigin\]\)/,
  );
  assert.doesNotMatch(mobileSource, /originWhitelist=\{\["http:\/\/\*", "https:\/\/\*"\]\}/);
  assert.match(webShellSource, /searchParams\.set\("embed", "1"\)/);
  assert.match(webShellSource, /searchParams\.set\("platform", platform\)/);
});

test("production configuration accepts only exact HTTPS origins", () => {
  const configuration = webShell.resolveShellConfiguration({
    configuredUrl: "https://app.dabboba.test/catalog?source=native",
    configuredAllowedOrigins: "https://auth.dabboba.test/, https://media.dabboba.test",
    platform: "ios",
    development: false,
  });
  const embeddedUrl = new URL(configuration.webUrl);

  assert.equal(configuration.baseOrigin, "https://app.dabboba.test");
  assert.deepEqual(Array.from(configuration.allowedOrigins), [
    "https://app.dabboba.test",
    "https://auth.dabboba.test",
    "https://media.dabboba.test",
  ]);
  assert.equal(embeddedUrl.pathname, "/catalog");
  assert.equal(embeddedUrl.searchParams.get("source"), "native");
  assert.equal(embeddedUrl.searchParams.get("embed"), "1");
  assert.equal(embeddedUrl.searchParams.get("platform"), "ios");

  assert.throws(
    () =>
      webShell.resolveShellConfiguration({
        configuredUrl: "http://app.dabboba.test",
        platform: "ios",
        development: false,
      }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      webShell.resolveShellConfiguration({
        configuredUrl: "https://app.dabboba.test",
        configuredAllowedOrigins: "https://auth.dabboba.test/callback",
        platform: "ios",
        development: false,
      }),
    /origin/,
  );
  assert.throws(
    () =>
      webShell.resolveShellConfiguration({
        configuredUrl: "https://app.dabboba.test",
        configuredAllowedOrigins: "https://*.dabboba.test",
        platform: "ios",
        development: false,
      }),
    /wildcard/,
  );
  assert.throws(
    () =>
      webShell.resolveShellConfiguration({
        platform: "ios",
        development: false,
      }),
    /EXPO_PUBLIC_DABBOBA_WEB_URL/,
  );
});

test("development HTTP is limited to localhost and private LAN hosts", () => {
  const lanConfiguration = webShell.resolveShellConfiguration({
    metroHostUri: "192.168.219.100:8081",
    configuredAllowedOrigins: "http://localhost:4174, https://preview.dabboba.test",
    platform: "ios",
    development: true,
  });
  assert.equal(lanConfiguration.webUrl, "http://192.168.219.100:4174/?embed=1&platform=ios");
  assert.deepEqual(Array.from(lanConfiguration.allowedOrigins), [
    "http://192.168.219.100:4174",
    "http://localhost:4174",
    "https://preview.dabboba.test",
  ]);

  const emulatorConfiguration = webShell.resolveShellConfiguration({
    platform: "android",
    development: true,
  });
  assert.equal(emulatorConfiguration.baseOrigin, "http://10.0.2.2:4174");

  assert.throws(
    () =>
      webShell.resolveShellConfiguration({
        configuredUrl: "http://public.example.com",
        platform: "android",
        development: true,
      }),
    /로컬 개발 주소/,
  );
});

test("navigation policy keeps approved origins, externalizes web URLs, and blocks schemes", () => {
  const allowedOrigins = ["https://app.dabboba.test", "https://auth.dabboba.test"];

  assert.equal(
    webShell.classifyNavigationRequest(
      "https://app.dabboba.test/products/one",
      allowedOrigins,
      allowedOrigins[0],
      "android",
    ).action,
    "allow",
  );
  assert.equal(
    webShell.classifyNavigationRequest(
      "https://auth.dabboba.test/callback",
      allowedOrigins,
      allowedOrigins[0],
      "android",
    ).action,
    "allow",
  );
  assert.equal(
    webShell.classifyNavigationRequest(
      "https://app.dabboba.test.evil.example/",
      allowedOrigins,
      allowedOrigins[0],
      "android",
    ).action,
    "open-external",
  );

  const external = webShell.classifyNavigationRequest(
    "https://outside.example/path",
    allowedOrigins,
    allowedOrigins[0],
    "android",
  );
  assert.equal(external.action, "open-external");
  assert.equal(external.url, "https://outside.example/path");

  for (const blockedUrl of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "tel:+821012345678",
    "https://user:password@outside.example/",
    "dabboba://unknown",
  ]) {
    assert.equal(
      webShell.classifyNavigationRequest(
        blockedUrl,
        allowedOrigins,
        allowedOrigins[0],
        "android",
      ).action,
      "block",
      blockedUrl,
    );
  }
});

test("deep links map only bounded routes onto the approved web origin", () => {
  const target = webShell.parseDabbobaDeepLink(
    "dabboba://request-room",
    "https://app.dabboba.test",
    "ios",
  );
  assert.equal(target.route, "request-room");
  assert.equal(target.url, "https://app.dabboba.test/request-room?embed=1&platform=ios");

  const pathTarget = webShell.parseDabbobaDeepLink(
    "dabboba:/profile",
    "https://app.dabboba.test",
    "android",
  );
  assert.equal(pathTarget.route, "profile");
  assert.equal(pathTarget.url, "https://app.dabboba.test/profile?embed=1&platform=android");

  for (const rejectedUrl of [
    "dabboba://profile/private",
    "dabboba://profile?next=https://outside.example",
    "dabboba://unknown",
    "https://app.dabboba.test/profile",
  ]) {
    assert.equal(
      webShell.parseDabbobaDeepLink(rejectedUrl, "https://app.dabboba.test", "ios"),
      null,
      rejectedUrl,
    );
  }
});

test("versioned bridge accepts exact messages and rejects malformed or oversized input", () => {
  const ready = webShell.parseWebBridgeMessage('{"version":1,"type":"APP_READY"}');
  assert.equal(ready.type, "APP_READY");

  const external = webShell.parseWebBridgeMessage(
    '{"version":1,"type":"OPEN_EXTERNAL_URL","payload":{"url":"https://docs.example/path"}}',
  );
  assert.equal(external.type, "OPEN_EXTERNAL_URL");
  assert.equal(external.payload.url, "https://docs.example/path");

  const navigate = webShell.parseWebBridgeMessage(
    '{"version":1,"type":"NAVIGATE","payload":{"route":"settings"}}',
  );
  assert.equal(navigate.type, "NAVIGATE");
  assert.equal(navigate.payload.route, "settings");

  for (const rejectedMessage of [
    '{"version":2,"type":"APP_READY"}',
    '{"version":1,"type":"APP_READY","extra":true}',
    '{"version":1,"type":"OPEN_EXTERNAL_URL","payload":{"url":"javascript:alert(1)"}}',
    '{"version":1,"type":"OPEN_EXTERNAL_URL","payload":{"url":"https://user:pass@example.com"}}',
    '{"version":1,"type":"NAVIGATE","payload":{"route":"admin"}}',
    '{"version":1,"type":"UNKNOWN"}',
    "가".repeat(webShell.MAX_BRIDGE_MESSAGE_BYTES),
  ]) {
    assert.equal(webShell.parseWebBridgeMessage(rejectedMessage), null);
  }

  const serialized = JSON.parse(
    webShell.serializeDeepLinkMessage({
      route: "home",
      url: "https://app.dabboba.test/?embed=1&platform=ios",
    }),
  );
  assert.deepEqual(serialized, {
    version: 1,
    type: "DEEP_LINK",
    payload: {
      route: "home",
      url: "https://app.dabboba.test/?embed=1&platform=ios",
    },
  });
});

test("web runtime isolates the Expo embed mode from the browser preview", () => {
  assert.match(runtimeSource, /params\.get\("embed"\) === "1"/);
  assert.match(runtimeSource, /<PhoneFrame embedded=\{embedded\}>/);
  assert.match(runtimeSource, /<KeyboardProvider nativeKeyboard=\{embedded\}>/);
  assert.match(runtimeSource, /embedded \? null : <StatusBar/);
  assert.match(runtimeSource, /embedded \? null : <KeyboardDock/);
});
