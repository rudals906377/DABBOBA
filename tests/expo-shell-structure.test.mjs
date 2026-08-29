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
const ppobaMachineIconSource = readFileSync(path.join(root, "apps/mobile/src/components/PpobaMachineIcon.tsx"), "utf8");
const homeSource = readFileSync(path.join(root, "apps/mobile/src/features/home/HomeScreen.tsx"), "utf8");
const homeFeedSource = readOptionalSource("apps/mobile/src/features/home/home-feed.ts");
const announcementTickerSource = readOptionalSource("apps/mobile/src/features/home/AnnouncementTicker.tsx");
const exchangeRouteSource = readFileSync(path.join(root, "apps/mobile/app/(tabs)/exchange.tsx"), "utf8");
const exchangeDetailRouteSource = readFileSync(path.join(root, "apps/mobile/app/exchange/[listingId].tsx"), "utf8");
const exchangeCreateRouteSource = readOptionalSource("apps/mobile/app/exchange/new.tsx");
const exchangeOfferRouteSource = readOptionalSource("apps/mobile/app/exchange/[listingId]/offer.tsx");
const exchangeRoomSource = readFileSync(path.join(root, "apps/mobile/src/features/exchange/ExchangeRoomScreen.tsx"), "utf8");
const exchangeDetailSource = readFileSync(path.join(root, "apps/mobile/src/features/exchange/ExchangeListingDetailScreen.tsx"), "utf8");
const exchangeCreateSource = readOptionalSource("apps/mobile/src/features/exchange/ExchangeCreateScreen.tsx");
const exchangeOfferSource = readOptionalSource("apps/mobile/src/features/exchange/ExchangeOfferScreen.tsx");
const exchangeApiSource = readFileSync(path.join(root, "apps/mobile/src/features/exchange/exchange-api.ts"), "utf8");
const ppobaRouteSource = readFileSync(path.join(root, "apps/mobile/app/(tabs)/ppoba.tsx"), "utf8");
const productDetailRouteSource = readFileSync(path.join(root, "apps/mobile/app/product/[productId].tsx"), "utf8");
const checkoutRouteSource = readOptionalSource("apps/mobile/app/checkout/[productId].tsx");
const checkoutConnectionRouteSource = readOptionalSource("apps/mobile/app/checkout/connect/[productId].tsx");
const shopSource = readFileSync(path.join(root, "apps/mobile/src/features/shop/ShopScreen.tsx"), "utf8");
const shopFilterSource = readOptionalSource("apps/mobile/src/features/shop/shop-filter.ts");
const productDetailSource = readFileSync(path.join(root, "apps/mobile/src/features/shop/ProductDetailScreen.tsx"), "utf8");
const shopApiSource = readFileSync(path.join(root, "apps/mobile/src/features/shop/shop-api.ts"), "utf8");
const checkoutScreenSource = readOptionalSource("apps/mobile/src/features/checkout/CheckoutScreen.tsx");
const checkoutConnectionScreenSource = readOptionalSource("apps/mobile/src/features/checkout/CheckoutConnectionScreen.tsx");
const checkoutApiSource = readOptionalSource("apps/mobile/src/features/checkout/checkout-api.ts");
const dukroomRouteSource = readFileSync(path.join(root, "apps/mobile/app/(tabs)/dukroom.tsx"), "utf8");
const storageRootSource = readOptionalSource("apps/mobile/src/features/profile/StorageRootScreen.tsx");
const dukroomDetailRouteSource = readFileSync(path.join(root, "apps/mobile/app/dukroom/[postId].tsx"), "utf8");
const dukroomSource = readFileSync(path.join(root, "apps/mobile/src/features/dukroom/DukroomScreen.tsx"), "utf8");
const dukroomDetailSource = readFileSync(path.join(root, "apps/mobile/src/features/dukroom/DukroomDetailScreen.tsx"), "utf8");
const dukroomApiSource = readFileSync(path.join(root, "apps/mobile/src/features/dukroom/dukroom-api.ts"), "utf8");
const profileRouteSource = readFileSync(path.join(root, "apps/mobile/app/(tabs)/profile.tsx"), "utf8");
const profileDetailRouteSource = readFileSync(path.join(root, "apps/mobile/app/profile/[section].tsx"), "utf8");
const profileMemberRouteSource = readFileSync(path.join(root, "apps/mobile/app/profile/member/[section].tsx"), "utf8");
const profileHomeSource = readFileSync(path.join(root, "apps/mobile/src/features/profile/ProfileHomeScreen.tsx"), "utf8");
const profileSectionSource = readFileSync(path.join(root, "apps/mobile/src/features/profile/ProfileSectionScreen.tsx"), "utf8");
const profileMemberSource = readFileSync(path.join(root, "apps/mobile/src/features/profile/ProfileMemberDetailScreen.tsx"), "utf8");
const profileApiSource = readFileSync(path.join(root, "apps/mobile/src/features/profile/profile-api.ts"), "utf8");
const shippingPolicySource = readFileSync(path.join(root, "apps/mobile/src/features/profile/shipping-policy.ts"), "utf8");
const rootHeaderActionsSource = readOptionalSource("apps/mobile/src/components/RootHeaderActions.tsx");
const rootFloatingTabBarSource = readOptionalSource("apps/mobile/src/components/RootFloatingTabBar.tsx");
const searchRouteSource = readOptionalSource("apps/mobile/app/search.tsx");
const searchScreenSource = readOptionalSource("apps/mobile/src/features/search/ProductSearchScreen.tsx");
const productHistoryRouteSource = readOptionalSource("apps/mobile/app/product-history.tsx");
const productHistoryScreenSource = readOptionalSource("apps/mobile/src/features/history/ProductHistoryScreen.tsx");
const notificationsRouteSource = readOptionalSource("apps/mobile/app/notifications.tsx");
const notificationsScreenSource = readOptionalSource("apps/mobile/src/features/notifications/NotificationsScreen.tsx");
const notificationsApiSource = readOptionalSource("apps/mobile/src/features/notifications/notifications-api.ts");
const prototypeCss = readFileSync(path.join(root, "src/prototype.css"), "utf8");
const catalogApiSource = readFileSync(path.join(root, "apps/mobile/src/features/catalog/catalog-api.ts"), "utf8");
const localDatabaseSource = readFileSync(path.join(root, "apps/mobile/src/lib/local-database.ts"), "utf8");
const sessionStoreSource = readFileSync(path.join(root, "apps/mobile/src/lib/session-store.ts"), "utf8");
const developmentSessionSource = readOptionalSource("apps/mobile/src/lib/development-session.ts");
const rootCategoryTitleSource = readOptionalSource("apps/mobile/src/components/RootCategoryTitle.tsx");
const typographySource = readOptionalSource("apps/mobile/src/components/Typography.tsx");
const catalogProductRowSource = readOptionalSource("apps/mobile/src/components/CatalogProductRow.tsx");
const seedTokensSource = readOptionalSource("apps/mobile/src/design-system/seed.ts");
const seedComponentsSource = readOptionalSource("apps/mobile/src/design-system/components.tsx");
const runtimeConfigSource = readFileSync(path.join(root, "apps/mobile/src/lib/runtime-config.ts"), "utf8");
const runtimeSource = readFileSync(path.join(root, "src/mobile/MobileRuntime.tsx"), "utf8");
const requireFromMobile = createRequire(path.join(root, "apps/mobile/package.json"));
const ts = requireFromMobile("typescript");

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

test("Expo entry is native-first with typed routes, API contracts, secure tokens, and disposable cache", () => {
  assert.equal(mobilePackage.dependencies.expo, "~54.0.37");
  assert.equal(mobilePackage.main, "expo-router/entry");
  assert.equal(mobilePackage.dependencies["@dabboba/api-client"], "workspace:*");
  assert.equal(mobilePackage.dependencies["expo-secure-store"], "~15.0.8");
  assert.equal(mobilePackage.dependencies["expo-sqlite"], "~16.0.10");
  assert.equal(mobilePackage.dependencies["expo-notifications"], "~0.32.17");
  assert.equal(mobilePackage.scripts.start, "expo start --go");
  assert.equal(mobilePackage.scripts.test, "node --test ../../tests/expo-shell-structure.test.mjs");
  assert.equal(mobileAppConfig.expo.scheme, "dabboba");
  assert.equal(mobileAppConfig.expo.experiments.typedRoutes, true);
  assert.deepEqual(Array.from(mobileAppConfig.expo.plugins), [
    "expo-router",
    "expo-secure-store",
    "expo-sqlite",
    "expo-font",
    "expo-notifications",
  ]);
  assert.match(rootLayoutSource, /SQLiteProvider/);
  assert.match(tabsLayoutSource, /name="exchange"/);
  assert.match(tabsLayoutSource, /name="ppoba"/);
  assert.match(tabsLayoutSource, /tabBarIcon:\s*PpobaMachineIcon/);
  assert.doesNotMatch(tabsLayoutSource, /tabIcon\("storefront-outline"\)/);
  for (const part of ["cabinet", "displayTop", "displayBottom", "controlSlot", "capsuleDial", "dispensingChute"]) {
    assert.match(ppobaMachineIconSource, new RegExp(part));
  }
  assert.match(ppobaMachineIconSource, /width:\s*25\.2,/);
  assert.match(ppobaMachineIconSource, /left:\s*1\.4,/);
  assert.match(ppobaMachineIconSource, /width:\s*20\.8,/);
  assert.match(tabsLayoutSource, /name="index"/);
  assert.match(tabsLayoutSource, /name="dukroom"/);
  assert.match(tabsLayoutSource, /name="dukroom"[\s\S]*?title: "보관함"[\s\S]*?cube-outline/);
  assert.doesNotMatch(tabsLayoutSource, /title: "덕룸"/);
  assert.match(tabsLayoutSource, /name="profile"/);
  assert.match(catalogApiSource, /createDabbobaClient/);
  assert.match(homeSource, /fetchHomeCatalog/);
  assert.match(homeSource, /readHomeCatalogCache/);
  assert.match(homeSource, /header:\s*\{[\s\S]*?minHeight:\s*48,[\s\S]*?paddingHorizontal:\s*seed\.spacing\.globalGutter,/);
  assert.match(homeSource, /wordmark:\s*\{\s*width:\s*116,\s*height:\s*17\s*\}/);
  assert.match(homeSource, /<SeedChip/);
  assert.match(seedComponentsSource, /minHeight:\s*seed\.size\.chip,[\s\S]*?paddingHorizontal:\s*14,[\s\S]*?borderWidth:\s*1,[\s\S]*?borderRadius:\s*seed\.radius\.r2,/);
  assert.match(localDatabaseSource, /CREATE TABLE IF NOT EXISTS catalog_cache/);
  assert.match(localDatabaseSource, /CREATE TABLE IF NOT EXISTS exchange_listing_cache/);
  assert.match(localDatabaseSource, /CREATE TABLE IF NOT EXISTS recent_searches/);
  assert.match(localDatabaseSource, /CREATE TABLE IF NOT EXISTS post_drafts/);
  assert.match(localDatabaseSource, /CREATE TABLE IF NOT EXISTS upload_queue/);
  assert.match(localDatabaseSource, /CREATE TABLE IF NOT EXISTS sync_state/);
  assert.doesNotMatch(localDatabaseSource, /orders|payments|points|draw_results/i);
  assert.match(sessionStoreSource, /SecureStore\.setItemAsync/);
  assert.match(sessionStoreSource, /access-token/);
  assert.match(sessionStoreSource, /refresh-token/);
  assert.match(rootLayoutSource, /DevelopmentSessionBootstrap enabled=\{__DEV__\}/);
  assert.match(developmentSessionSource, /\/v1\/auth\/me/);
  assert.match(developmentSessionSource, /\/v1\/auth\/dev-session/);
  assert.match(developmentSessionSource, /mobile-test@dabboba\.local/);
  assert.match(developmentSessionSource, /writeAuthTokens/);
  assert.doesNotMatch(`${rootLayoutSource}\n${tabsLayoutSource}\n${homeSource}`, /WebView/);
});

test("native home follows the compact announcement, draw activity, today, collections, and event order", () => {
  assert.doesNotMatch(homeSource, /원하는 거 다 뽑아|첫 네이티브 홈이 API 카탈로그와 연결됐어요/);
  const tickerIndex = homeSource.indexOf("<AnnouncementTicker");
  const drawActivityIndex = homeSource.indexOf("<DrawActivityPanel");
  const todayIndex = homeSource.indexOf('title="오늘의 뽀바"');
  const collectionsIndex = homeSource.indexOf("homeCollections.map");
  const eventIndex = homeSource.indexOf("<EventNoticeCard");
  assert.ok(tickerIndex > -1 && drawActivityIndex > tickerIndex && todayIndex > drawActivityIndex && collectionsIndex > todayIndex && eventIndex > collectionsIndex);
  assert.match(homeSource, /const todayProducts = visibleProducts\.slice\(0, 4\)/);
  assert.doesNotMatch(homeSource, /다뽀바 인기 작품|다뽀바 덕룸|fetchDukroomHomePreview/);
  assert.match(homeSource, /buildHomeCollections/);
  assert.match(homeFeedSource, /orderedIpIds\.flatMap/);
  assert.match(homeFeedSource, /`\$\{ip\.nameKo\} 컬렉션`/);
  assert.match(announcementTickerSource, /Animated\.timing\(translateX/);
  assert.match(announcementTickerSource, /Animated\.timing\(translateY/);
  assert.match(announcementTickerSource, /AccessibilityInfo\.isReduceMotionEnabled/);
  assert.match(homeSource, /화면 예시/);
  assert.match(homeSource, /styles\.activityPerson[\s\S]*?item\.personName/);
  assert.match(homeSource, /styles\.activityProduct[\s\S]*?item\.productName/);
  assert.match(homeSource, /activityPerson:\s*\{[^}]*fontWeight:\s*"900"/);
  assert.match(homeSource, /activityProduct:\s*\{[^}]*color:\s*seed\.color\.foreground\.brand/);
  assert.match(homeSource, /buildDrawActivityExamples\(snapshot\?\.products \?\? \[\], snapshot\?\.ips \?\? \[\], productSubjectTitle\)/);
  assert.match(homeFeedSource, /productNameForActivity\(product\.name, ipNameById\.get\(product\.ipId\)\)/);
  assert.match(homeSource, /getTickerOverflowDistance/);
  assert.match(homeSource, /Animated\.loop/);
  assert.match(homeSource, /AccessibilityInfo\.isReduceMotionEnabled/);
});

test("only Home keeps the DABBOBA wordmark while category roots use compact Korean headers", () => {
  assert.match(homeSource, /accessibilityLabel="DABBOBA"/);

  for (const [source, title] of [
    [exchangeRoomSource, "교환방"],
    [shopSource, "뽀바"],
    [storageRootSource, "보관함"],
    [profileHomeSource, "내정보"],
  ]) {
    assert.match(source, /RootCategoryTitle/);
    assert.match(source, new RegExp(`<RootCategoryTitle>${title}<\\/RootCategoryTitle>`));
    assert.doesNotMatch(source, /accessibilityLabel="DABBOBA"|const WORDMARK|styles\.wordmark/);
    assert.doesNotMatch(source, /styles\.eyebrow|styles\.pageTitle|styles\.title/);
  }

  assert.equal(mobilePackage.dependencies.galmuri, "2.40.3");
  assert.match(rootLayoutSource, /useFonts\(\{\s*Galmuri11:\s*require\("galmuri\/dist\/Galmuri11-Bold\.ttf"\)/);
  assert.match(rootCategoryTitleSource, /accessibilityRole="header"/);
  assert.match(rootCategoryTitleSource, /fontFamily:\s*"Galmuri11"/);
  assert.match(rootCategoryTitleSource, /fontWeight:\s*"400"/);
  assert.match(rootCategoryTitleSource, /fontSize:\s*22/);
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

  assert.match(rootCategoryTitleSource, /fontFamily:\s*"Galmuri11"/);
  assert.doesNotMatch(rootHeaderActionsSource, /<Text\b|fontFamily:/);
});

test("app-authored title blocks use one Korean pixel title instead of stacked English eyebrows", () => {
  assert.match(rootCategoryTitleSource, /export function KoreanPixelTitle/);
  assert.match(rootCategoryTitleSource, /fontFamily:\s*"Galmuri11"/);

  for (const source of [
    homeSource,
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
    assert.match(source, /KoreanPixelTitle|RootCategoryTitle/);
    assert.doesNotMatch(
      source,
      /NATIVE APP|IP SELECT|AVAILABLE NOW|OPEN LISTINGS|OFFERS TO A|MY OFFER|PURCHASE GUIDE|LIVE ODDS|SHOWCASE|WISH BOARD|PROFILE EDIT|MY WISHLIST|MY STORAGE|MEMBER INFO|PAYMENT SETTINGS|>PRODUCT<|>DUKROOM<|IP FILTER|IP ROOM|DEFAULT ADDRESS/,
    );
  }

  assert.doesNotMatch(profileSectionSource, /eyebrow:/);
  assert.doesNotMatch(profileMemberSource, /eyebrow:/);
});

test("Expo app applies a native SEED-compatible design layer without web-only packages", () => {
  assert.equal(mobilePackage.dependencies["@seed-design/react"], undefined);
  assert.equal(mobilePackage.dependencies["@seed-design/css"], undefined);
  assert.match(seedTokensSource, /export const seed/);
  assert.match(seedTokensSource, /globalGutter:\s*16/);
  assert.match(seedTokensSource, /componentDefault:\s*12/);
  assert.match(seedTokensSource, /betweenChips:\s*8/);
  assert.match(seedTokensSource, /screenTitle:\s*\{\s*fontSize:\s*26,\s*lineHeight:\s*35,\s*fontWeight:\s*"700"/);
  assert.match(seedTokensSource, /articleBody:\s*\{\s*fontSize:\s*16,\s*lineHeight:\s*24,\s*fontWeight:\s*"400"/);
  assert.match(seedTokensSource, /touchTarget:\s*44/);
  assert.match(seedTokensSource, /chip:\s*36/);
  assert.match(seedTokensSource, /input:\s*52/);

  for (const component of ["SeedActionButton", "SeedCard", "SeedChip", "SeedIconButton", "SeedInputShell"]) {
    assert.match(seedComponentsSource, new RegExp(`export function ${component}`));
  }
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

test("root headers replace points with search, product history, and account notifications", () => {
  for (const source of [homeSource, exchangeRoomSource, shopSource, storageRootSource, profileHomeSource]) {
    assert.match(source, /RootHeaderActions/);
    assert.doesNotMatch(source, /pointsPill|pointsLabel|>0P</);
  }

  for (const label of ["검색", "상품 기록", "알림함"]) {
    assert.match(rootHeaderActionsSource, new RegExp(`label: "${label}`));
  }
  assert.match(rootHeaderActionsSource, /검색 열기[\s\S]*알림함 열기[\s\S]*상품 기록 열기/);
  assert.match(rootHeaderActionsSource, /label=\{action\.label\}/);
  for (const route of ["/search", "/product-history", "/notifications"]) {
    assert.match(rootHeaderActionsSource, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.match(rootHeaderActionsSource, /function ProductHistoryCapsuleIcon/);
  assert.match(rootHeaderActionsSource, /product-history-capsule\.png/);
  assert.match(rootHeaderActionsSource, /CAPSULE_OUTLINE_OFFSETS/);
  assert.match(rootHeaderActionsSource, /capsuleFrame:\s*\{\s*width:\s*25,\s*height:\s*25/);
  assert.match(rootHeaderActionsSource, /capsuleImage:\s*\{\s*width:\s*25,\s*height:\s*25/);
  assert.match(rootHeaderActionsSource, /tintColor:\s*seed\.color\.foreground\.neutral/);
  assert.match(rootHeaderActionsSource, /rotate:\s*"15deg"/);
  assert.doesNotMatch(rootHeaderActionsSource, />DABBOBA<\/Text>|capsuleWordmark/);
  assert.doesNotMatch(rootHeaderActionsSource, /function CapsuleIcon|capsuleHalf|capsuleDivider/);

  assert.match(searchRouteSource, /ProductSearchScreen/);
  assert.match(searchScreenSource, /fetchShopSnapshot/);
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
});

test("native root navigation floats, compacts on downward scroll, and glides selection", () => {
  assert.match(tabsLayoutSource, /RootNavigationMotionProvider/);
  assert.match(tabsLayoutSource, /tabBar=\{\(props\) => <RootFloatingTabBar \{\.\.\.props\} \/>\}/);

  for (const source of [homeSource, exchangeRoomSource, shopSource, storageRootSource, profileHomeSource]) {
    assert.match(source, /useRootNavigationScroll/);
    assert.match(source, /ROOT_NAVIGATION_CONTENT_INSET/);
    assert.match(source, /<ScrollView\s+\{\.\.\.rootNavigationScroll\}/);
    assert.match(source, /paddingBottom: ROOT_NAVIGATION_CONTENT_INSET/);
  }

  assert.match(rootFloatingTabBarSource, /const ROOT_NAVIGATION_TOP_THRESHOLD = 12/);
  assert.match(rootFloatingTabBarSource, /const ROOT_NAVIGATION_COLLAPSE_THRESHOLD = 18/);
  assert.match(rootFloatingTabBarSource, /const ROOT_NAVIGATION_EXPAND_THRESHOLD = 10/);
  assert.match(rootFloatingTabBarSource, /contentSize\.height <= layoutMeasurement\.height \+ 2/);
  assert.match(rootFloatingTabBarSource, /progress\.stopAnimation\(\)/);
  assert.match(rootFloatingTabBarSource, /Animated\.spring\(progress/);
  assert.match(rootFloatingTabBarSource, /damping: 25/);
  assert.match(rootFloatingTabBarSource, /stiffness: 175/);
  assert.match(rootFloatingTabBarSource, /overshootClamping: true/);
  assert.match(rootFloatingTabBarSource, /height: motion\.progress\.interpolate\(\{ inputRange: \[0, 0\.78, 1\], outputRange: \[17, 6, 0\] \}\)/);
  assert.match(rootFloatingTabBarSource, /Animated\.spring\(selection/);
  assert.match(rootFloatingTabBarSource, /damping: 23/);
  assert.match(rootFloatingTabBarSource, /selectionTrack/);
  assert.match(rootFloatingTabBarSource, /const animatedTabWidth = motion\.progress\.interpolate/);
  assert.match(rootFloatingTabBarSource, /const animatedTrackWidth = motion\.progress\.interpolate/);
  assert.match(rootFloatingTabBarSource, /Animated\.multiply\(selection, animatedTabWidth\)/);
  assert.match(rootFloatingTabBarSource, /backgroundColor: "rgba\(252, 252, 248, 0\.94\)"/);
  assert.match(rootFloatingTabBarSource, /position: "absolute"/);
  assert.match(rootFloatingTabBarSource, /backgroundColor: seed\.color\.background\.transparent/);
  assert.match(rootFloatingTabBarSource, /ROOT_NAVIGATION_CONTENT_INSET = seed\.size\.bottomNavigation \+ seed\.spacing\.screenBottom/);
  assert.match(rootFloatingTabBarSource, /minWidth: seed\.size\.touchTarget/);
  assert.match(rootFloatingTabBarSource, /minHeight: seed\.size\.touchTarget/);
  assert.match(rootFloatingTabBarSource, /AccessibilityInfo\.isReduceMotionEnabled/);
  assert.doesNotMatch(rootFloatingTabBarSource, /display:\s*"none"|height:\s*0\s*[,}]/);
});

test("native exchange room shows API-backed examples for every category and opens a tab-free detail", () => {
  assert.match(exchangeRouteSource, /ExchangeRoomScreen/);
  assert.doesNotMatch(exchangeRouteSource, /MigrationScreen/);
  assert.match(exchangeApiSource, /createDabbobaClient/);
  assert.match(exchangeApiSource, /\/v1\/exchange\/listings/);
  assert.match(exchangeApiSource, /\/v1\/catalog\/products/);
  assert.match(exchangeApiSource, /\["gacha", "figure", "kuji", "tcg"\]/);
  assert.match(exchangeApiSource, /EXAMPLE_PREFIX/);
  assert.match(exchangeRoomSource, /fetchExchangeRoom/);
  assert.match(exchangeRoomSource, /readExchangeListingCache/);
  assert.match(exchangeRoomSource, /writeExchangeListingCache/);
  assert.match(exchangeRoomSource, /화면 구성을 확인할 수 있는 예시 글이에요/);
  assert.match(exchangeRoomSource, /가챠샵 기준가 · 판매가 아님/);
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
  assert.match(localDatabaseSource, /exchange\.rules\.dismissed\.v1/);
  assert.match(exchangeRoomSource, /직접 뽑은 가챠·쿠지 상품 중 현재 보관함에 보관 중인 상품만/);
  assert.match(exchangeRoomSource, /배송 신청이 접수되었거나 배송이 완료된 상품은 환불·교환·포인트 환급을 신청할 수 없어요/);
  assert.match(exchangeRoomSource, /표시 금액은 판매가가 아닌 앱 기준가예요/);
  assert.doesNotMatch(exchangeRoomSource, /<ExchangeRuleCard/);
  assert.doesNotMatch(exchangeRoomSource, /가챠샵에서 구매해 보관함에 등록된 상품만 올릴 수 있어요/);
  assert.match(exchangeRoomSource, /<SeedChip/);
  assert.match(exchangeRoomSource, /<SeedInputShell/);
  assert.match(exchangeRoomSource, /placeholder="상품명·작품 검색"/);
  assert.match(exchangeRoomSource, /accessibilityLabel="교환방 상품 검색"/);
  assert.match(exchangeRoomSource, /keyboardShouldPersistTaps="handled"/);
  assert.match(exchangeRoomSource, /검색 결과가 없어요/);
  assert.match(exchangeRoomSource, /검색어 지우기/);
  assert.match(exchangeRoomSource, /fetchExchangeRoom\(runtime\.apiBaseUrl, selectedCategory, debouncedQuery\)/);
  assert.match(exchangeApiSource, /query:\s*\{\s*limit:\s*30,\s*category,\s*q:\s*search\s*\}/);
  assert.match(exchangeRoomSource, /router\.push\("\/exchange\/new"\)/);
  assert.match(exchangeRoomSource, /label="교환 상품 올리기"/);
  assert.doesNotMatch(exchangeRoomSource, /등록 화면은 다음 단계예요|이어(?:서)? 만들 예정/);
  assert.match(exchangeRoomSource, /productSubjectTitle\(item\.product\.name, ipName\)/);
  assert.match(exchangeCreateRouteSource, /ExchangeCreateScreen/);
  assert.match(exchangeCreateSource, /fetchExchangeListingInventory/);
  assert.match(exchangeCreateSource, /createExchangeListing/);
  assert.match(exchangeCreateSource, /<AppTextInput/);
  assert.match(exchangeCreateSource, /교환글 제목/);
  assert.match(exchangeCreateSource, /상품 설명/);
  assert.match(exchangeCreateSource, /교환 상품 올리기/);
  assert.match(exchangeCreateSource, /가챠·쿠지에서 직접 뽑아 현재 보관 중인 상품 1개/);
  assert.match(exchangeCreateSource, /배송을 신청했거나 이미 받은 상품은 표시되지 않아요/);
  assert.match(exchangeCreateSource, /accessibilityRole="radio"/);
  assert.match(exchangeCreateSource, /title\.trim\(\)/);
  assert.match(exchangeCreateSource, /details\.trim\(\)/);
  assert.match(exchangeApiSource, /export async function fetchExchangeListingInventory[\s\S]*?snapshot\.items\.filter\(isDrawnExchangeInventory\)/);
  assert.match(exchangeApiSource, /직접 뽑은 뒤 배송을 신청하지 않고 보관함에 보관 중/);
  assert.match(exchangeApiSource, /export async function createExchangeListing[\s\S]*?client\.POST\("\/v1\/exchange\/listings"[\s\S]*?"Idempotency-Key": randomUUID\(\)[\s\S]*?body: input/);
  assert.match(exchangeDetailRouteSource, /ExchangeListingDetailScreen/);
  assert.match(exchangeApiSource, /proposerNickname/);
  assert.match(exchangeApiSource, /\/v1\/auth\/me/);
  assert.match(exchangeApiSource, /offers\/\{offerId\}\/decision/);
  assert.match(exchangeApiSource, /"Idempotency-Key": randomUUID\(\)/);
  assert.match(exchangeDetailSource, /들어온 제안/);
  assert.match(exchangeDetailSource, /B·C·D·E가 각자 직접 뽑은 상품 하나만 골라 제안했어요/);
  assert.match(exchangeDetailSource, /교환하기/);
  assert.doesNotMatch(exchangeDetailSource, /이 제안 선택하기/);
  assert.match(exchangeDetailSource, /거절하기/);
  assert.match(exchangeDetailSource, /교환 신청하기/);
  assert.match(exchangeDetailSource, /\/exchange\/\$\{listingId\}\/offer/);
  assert.doesNotMatch(exchangeDetailSource, /proposal\.message|proposalMessage/);
  assert.match(exchangeOfferRouteSource, /ExchangeOfferScreen/);
  assert.match(exchangeOfferSource, /fetchExchangeOfferInventory/);
  assert.match(exchangeOfferSource, /createExchangeOffer/);
  assert.match(exchangeApiSource, /sourceType === "GACHA" \|\| item\.sourceType === "KUJI"/);
  assert.match(exchangeOfferSource, /가챠·쿠지에서 직접 뽑아 현재 보관 중인 상품 1개만 선택/);
  assert.match(exchangeOfferSource, /포인트 환급·다른 교환에 사용하지 않은 직접 뽑은 상품만 신청/);
  assert.match(exchangeOfferSource, /교환 신청 완료/);
  assert.doesNotMatch(exchangeOfferSource, /AppTextInput|TextInput|Keyboard/);
  assert.doesNotMatch(exchangeDetailSource, /교환 규칙|ruleBox/);
  assert.match(exchangeDetailSource, /productSubjectTitle\(product\.name, ipName\)/);
  assert.doesNotMatch(tabsLayoutSource, /name="exchange\/\[listingId\]"/);
  assert.doesNotMatch(tabsLayoutSource, /name="exchange\/new"/);
});

test("native ppoba catalog and product detail coexist with the shared drawn-product storage root", () => {
  assert.match(ppobaRouteSource, /ShopScreen/);
  assert.doesNotMatch(ppobaRouteSource, /MigrationScreen/);
  assert.match(productDetailRouteSource, /ProductDetailScreen/);
  assert.match(shopSource, /상품명·작품 검색/);
  assert.match(shopSource, /\/product\//);
  assert.match(shopSource, /<SeedChip/);
  for (const endpoint of ["/v1/catalog/products", "/v1/catalog/ips", "/draw-odds", "/v1/account/wishlist/"]) {
    assert.match(shopApiSource, new RegExp(endpoint.replaceAll("/", "\\/")));
  }
  assert.doesNotMatch(productDetailSource, /같은 작품 덕룸 보기|수집가들의 진열과 사진/);
  assert.match(productDetailSource, /현재 로컬 앱에서는 실제 결제를 진행하지 않습니다/);
  assert.match(catalogProductRowSource, /productSubjectTitle\(product\.name, ipName\)/);
  assert.match(shopSource, /productSubjectTitle\(product\.name, ipName\)/);
  assert.match(homeSource, /productSubjectTitle\(product\.name, ipName\)/);
  assert.match(profileSectionSource, /productSubjectTitle\(product\.name, ipName\)/);
  assert.doesNotMatch(catalogProductRowSource, /style=\{styles\.name\}>\{product\.name\}/);
  for (const source of [homeSource, exchangeRoomSource, exchangeDetailSource, profileSectionSource, catalogProductRowSource]) {
    assert.match(source, /resizeMode="cover"/);
  }
  assert.doesNotMatch(`${homeSource}\n${exchangeRoomSource}\n${exchangeDetailSource}\n${profileSectionSource}\n${catalogProductRowSource}`, /productImage[^\n]*resizeMode="contain"|resizeMode="contain"[^\n]*(?:productImage|thumbImage|styles\.image)/);
  assert.match(shopSource, /Image\.getSize\(/);
  assert.match(shopSource, /setImageAspectRatio\(1\)/);
  assert.match(shopSource, /let active = true/);
  assert.match(shopSource, /width > 0 && height > 0/);
  assert.match(shopSource, /setImageAspectRatio\(width \/ height\)/);
  assert.match(shopSource, /return \(\) => \{ active = false; \}/);
  assert.match(shopSource, /\}, \[uri\]\);/);
  assert.match(shopSource, /aspectRatio:\s*imageAspectRatio/);
  assert.match(shopSource, /resizeMode="contain"/);
  assert.match(shopSource, /onLoad=\{\(\{ nativeEvent \}\) =>/);
  assert.doesNotMatch(shopSource, /productImageFrame:\s*\{[^}]*aspectRatio:\s*1/);
  assert.match(productDetailSource, /Image\.getSize\(/);
  assert.match(productDetailSource, /aspectRatio:\s*imageAspectRatio/);
  assert.match(productDetailSource, /resizeMode="contain"/);
  assert.match(productDetailSource, /heroContainer:\s*\{[^}]*marginHorizontal:\s*seed\.spacing\.x2/);
  assert.match(productDetailSource, /hero:\s*\{[^}]*width:\s*"100%"/);
  assert.doesNotMatch(productDetailSource, /hero:\s*\{[^}]*aspectRatio:\s*1/);
  assert.doesNotMatch(productDetailSource, /hero:\s*\{[^}]*(?:borderWidth|borderColor|backgroundColor)/);
  assert.match(homeSource, /\/product\//);
  assert.match(homeSource, /pathname:\s*"\/\(tabs\)\/ppoba"/);

  assert.match(dukroomRouteSource, /StorageRootScreen/);
  assert.doesNotMatch(dukroomRouteSource, /DukroomScreen/);
  assert.doesNotMatch(dukroomRouteSource, /MigrationScreen/);
  assert.match(dukroomDetailRouteSource, /<Redirect href="\/\(tabs\)\/dukroom"/);
  assert.doesNotMatch(dukroomDetailRouteSource, /DukroomDetailScreen/);
  assert.match(storageRootSource, /<RootCategoryTitle>보관함<\/RootCategoryTitle>/);
  assert.match(storageRootSource, /useProfileSnapshot/);
  assert.match(storageRootSource, /<StorageHubContent/);
  assert.match(profileSectionSource, /label="배송 신청"/);
  assert.match(profileSectionSource, /label="포인트 환급"/);
  assert.match(profileSectionSource, /item\.status === "OWNED"/);
  assert.match(profileSectionSource, /item\.sourceType === "GACHA" \|\| item\.sourceType === "KUJI"/);
  assert.match(rootFloatingTabBarSource, /dukroom: "보관함"/);
  assert.match(rootFloatingTabBarSource, /dukroom: "cube-outline"/);
  assert.doesNotMatch(rootFloatingTabBarSource, /dukroom: "덕룸"|dukroom: "grid-outline"/);
  assert.doesNotMatch(tabsLayoutSource, /name="product\/\[productId\]"/);
  assert.doesNotMatch(tabsLayoutSource, /name="dukroom\/\[postId\]"/);
});

test("native ppoba opens gacha and kuji while figure and card stay in a pixel coming-soon state", () => {
  assert.match(
    shopSource,
    /const CATEGORIES:[\s\S]*?\{ label: "가챠", value: "gacha" \}[\s\S]*?\{ label: "쿠지", value: "kuji" \}[\s\S]*?\{ label: "피규어", value: "figure" \}[\s\S]*?\{ label: "카드", value: "tcg" \}/,
  );
  assert.doesNotMatch(shopSource, /\{ label: "전체" \}/);
  assert.match(shopSource, /useState<ProductCategory>\("gacha"\)/);
  assert.match(shopSource, /const isComingSoon = selectedCategory === "figure" \|\| selectedCategory === "tcg"/);
  assert.match(shopSource, /wide=\{selectedCategory === "kuji"\}/);
  assert.match(shopSource, /kujiProductCard:\s*\{\s*width:\s*"100%"\s*\}/);
  assert.match(shopSource, /isComingSoon \? \([\s\S]*?<KoreanPixelTitle variant="hero">준비중입니다\.<\/KoreanPixelTitle>/);
  assert.match(shopSource, /\{categoryLabel\(selectedCategory\)\} 상품을 준비하고 있어요\./);
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

test("native Product Detail continues through the approved copy into a footer-free checkout preparation screen", () => {
  assert.match(productDetailSource, /뽑기 주문 준비 완료/);
  assert.match(productDetailSource, /현재 로컬 앱에서는 실제 결제를 진행하지 않습니다/);
  assert.match(productDetailSource, /`\/checkout\/\$\{encodeURIComponent\(product\.id\)\}\?quantity=\$\{quantity\}`/);

  assert.match(checkoutRouteSource, /CheckoutScreen/);
  assert.match(checkoutScreenSource, /useLocalSearchParams/);
  assert.match(checkoutScreenSource, /fetchProductDetail/);
  assert.match(checkoutScreenSource, /fetchCheckoutPointBalance/);
  assert.match(checkoutApiSource, /\/v1\/account\/points/);
  assert.match(checkoutScreenSource, /결제 준비/);
  assert.match(checkoutScreenSource, /주문 상품/);
  assert.match(checkoutScreenSource, /할인·포인트/);
  assert.match(checkoutScreenSource, /결제 수단/);
  assert.match(checkoutScreenSource, /간편카드/);
  assert.match(checkoutScreenSource, /카카오페이/);
  assert.match(checkoutScreenSource, /네이버페이/);
  assert.match(checkoutScreenSource, /결제 준비 완료/);
  assert.match(checkoutScreenSource, /PG 결제와 주문 생성은 진행되지 않습니다/);
  assert.match(checkoutScreenSource, /결제 준비가 끝났어요/);
  assert.match(checkoutScreenSource, /onPress:\s*openConnectionGuide/);
  assert.match(checkoutScreenSource, /`\/checkout\/connect\/\$\{encodeURIComponent\(product\.id\)\}\?\$\{query\.toString\(\)\}`/);
  assert.match(checkoutScreenSource, /resizeMode="cover"/);
  assert.doesNotMatch(checkoutScreenSource, /submitOrder|createOrder|drawEntitlement|결제 완료/);
  assert.doesNotMatch(tabsLayoutSource, /name="checkout/);

  assert.match(checkoutConnectionRouteSource, /CheckoutConnectionScreen/);
  assert.match(checkoutConnectionScreenSource, /useLocalSearchParams/);
  assert.match(checkoutConnectionScreenSource, /fetchProductDetail/);
  assert.match(checkoutConnectionScreenSource, /결제 연결 안내/);
  assert.match(checkoutConnectionScreenSource, /현재 상태/);
  assert.match(checkoutConnectionScreenSource, /결제 전/);
  for (const step of ["가격·재고 재확인", "PG 결제 승인", "서버 주문 확정", "추첨권 발급"]) {
    assert.match(checkoutConnectionScreenSource, new RegExp(step));
  }
  assert.match(checkoutConnectionScreenSource, /현재 로컬 앱에서는 PG 결제 요청을 보내지 않습니다/);
  assert.match(checkoutConnectionScreenSource, /따라서 결제 완료, 주문 번호, 추첨권도 생성되지 않아요/);
  assert.match(checkoutConnectionScreenSource, /router\.replace\("\/\(tabs\)\/ppoba"\)/);
  assert.doesNotMatch(checkoutConnectionScreenSource, /submitOrder|createOrder|issueDraw|drawEntitlement/);
});

test("native my-info hub opens every account utility and nested member detail outside root tabs", () => {
  assert.match(profileRouteSource, /ProfileHomeScreen/);
  assert.doesNotMatch(profileRouteSource, /MigrationScreen/);
  assert.match(profileDetailRouteSource, /ProfileSectionScreen/);
  assert.match(profileMemberRouteSource, /ProfileMemberDetailScreen/);
  for (const label of ["내 찜 목록", "보관함", "구매 내역", "포인트 내역", "신청방", "고객센터", "회원정보 관리", "설정"]) {
    assert.match(profileHomeSource, new RegExp(label));
  }
  assert.match(profileHomeSource, /배송 신청 · 포인트 환급/);
  assert.doesNotMatch(profileHomeSource, /section: "shipping", label: "배송 신청"/);
  for (const endpoint of [
    "/v1/account/profile",
    "/v1/account/default-address",
    "/v1/account/wishlist",
    "/v1/exchange/inventory",
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
  assert.match(profileSectionSource, /로그인 전 화면 예시/);
  assert.match(profileSectionSource, /배송 신청/);
  assert.match(profileSectionSource, /포인트 환급/);
  assert.match(profileSectionSource, /createPointReturn/);
  assert.match(profileSectionSource, /Math\.floor\(item\.product\.price \/ 2\)/);
  assert.match(profileSectionSource, /section === "storage" \|\| section === "shipping"/);
  assert.match(profileSectionSource, /배송·교환·환급이 진행 중이거나 이미 배송받은 상품은 표시되지 않아요/);
  assert.match(profileHomeSource, /주문·포인트·배송 상태는 서버/);
  for (const detail of ["개인정보", "기본 배송지", "결제 카드", "결제 설정", "로그인 및 보안", "알림 수신설정", "개인정보·수신 동의", "약관·운영정책", "로그아웃·회원탈퇴"]) {
    assert.match(profileMemberSource, new RegExp(detail));
  }
  assert.match(profileMemberSource, /SecureStore/);
  assert.match(profileMemberSource, /전체 카드번호, CVC, 비밀번호/);
  assert.doesNotMatch(tabsLayoutSource, /name="profile\/\[section\]"/);
});

test("native shipping request shows the category-sensitive free-shipping policy", () => {
  assert.match(profileSectionSource, /가챠 상품만 주문하면 30,000원 이상/);
  assert.match(profileSectionSource, /쿠지·피규어·카드가 하나라도 포함되면 50,000원 이상 무료배송/);
  assert.match(profileSectionSource, /calculateShippingPolicy/);
  assert.match(shippingPolicySource, /GACHA_ONLY_FREE_SHIPPING_THRESHOLD = 30_000/);
  assert.match(shippingPolicySource, /MIXED_CATEGORY_FREE_SHIPPING_THRESHOLD = 50_000/);
  assert.match(shippingPolicySource, /items\.every\(\(item\) => item\.category === "gacha"\)/);
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
  });

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
});

test("legacy WebView compatibility remains bounded while screens migrate", () => {
  assert.equal(mobilePackage.dependencies["react-native-webview"], "13.15.0");
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
