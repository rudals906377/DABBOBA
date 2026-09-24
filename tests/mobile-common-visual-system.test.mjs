import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("shared controls expose readable semantics, dark focus, and 44 point interactions", () => {
  const seedSource = readSource("apps/mobile/src/design-system/seed.ts");
  const componentSource = readSource("apps/mobile/src/design-system/components.tsx");
  const typographySource = readSource("apps/mobile/src/components/Typography.tsx");

  assert.match(seedSource, /focus:\s*colors\.greenInk/);
  assert.match(seedSource, /actionButton:\s*\{[\s\S]*?small:\s*44/);
  assert.match(seedSource, /pressedTranslateY:\s*1/);
  assert.match(seedSource, /pressedScale:\s*0\.995/);
  assert.match(componentSource, /inputSearch:\s*\{\s*borderColor:\s*seed\.color\.stroke\.neutral\s*\}/);
  assert.match(componentSource, /inputFocused:\s*\{\s*borderColor:\s*seed\.color\.stroke\.focus,\s*borderWidth:\s*2\s*\}/);
  assert.match(componentSource, /hitSlop = 4/);
  assert.match(componentSource, /variant="button"/);
  assert.match(componentSource, /variant="chip"/);
  assert.match(componentSource, /pressed && selected && styles\.chipSelectedPressed/);
  for (const role of ["bodyStrong", "button", "chip", "catalogTitle", "catalogTitleWide", "subheading"]) {
    assert.match(typographySource, new RegExp(`\\| "${role}"`));
    assert.match(typographySource, new RegExp(`${role}: seed\\.typography\\.${role}`));
  }
});

test("root and detail headers provide fixed placement without clipping dynamic titles", () => {
  const rootHeaderSource = readSource("apps/mobile/src/components/RootPageHeader.tsx");
  const detailHeaderSource = readSource("apps/mobile/src/components/DetailPageHeader.tsx");
  const titleSource = readSource("apps/mobile/src/components/RootCategoryTitle.tsx");
  const homeSource = readSource("apps/mobile/src/features/home/HomeScreen.tsx");
  const shopSource = readSource("apps/mobile/src/features/shop/ShopScreen.tsx");

  assert.match(rootHeaderSource, /export function RootPageScaffold/);
  assert.match(rootHeaderSource, /\{header\}[\s\S]*?<View style=\{\[styles\.body, bodyStyle\]\}>\{children\}<\/View>/);
  assert.match(homeSource, /<RootPageScaffold header=\{<HomeHeader \/>\}>/);
  assert.match(shopSource, /<RootPageScaffold[\s\S]*?header=\{\([\s\S]*?<RootPageHeader>/);

  assert.match(detailHeaderSource, /minHeight:\s*seed\.size\.topNavigation/);
  assert.equal((detailHeaderSource.match(/seed\.size\.touchTarget/g) ?? []).length >= 2, true);
  assert.match(detailHeaderSource, /titleMode === "readable" \? 2 : 1/);
  assert.match(detailHeaderSource, /export function DetailPageHeaderAction/);
  assert.match(titleSource, /export function ReadablePageTitle/);
  const readableTitleBody = titleSource.slice(titleSource.indexOf("export function ReadablePageTitle"), titleSource.indexOf("export function RootCategoryTitle"));
  assert.match(readableTitleBody, /numberOfLines = 2/);
  assert.doesNotMatch(readableTitleBody, /maxFontSizeMultiplier/);
});

test("Home uses open canvas rhythm for the server-ordered operator feed", () => {
  const source = readSource("apps/mobile/src/features/home/HomeScreen.tsx");

  assert.match(source, /sectionHeader:\s*\{[\s\S]*?marginTop:\s*seed\.spacing\.x8[\s\S]*?marginBottom:\s*seed\.spacing\.x4[\s\S]*?paddingHorizontal:\s*seed\.spacing\.globalGutter/);
  assert.doesNotMatch(source, /sectionHeader:\s*\{[^}]*minHeight/);
  assert.doesNotMatch(source, /sectionHeader:\s*\{[^}]*border(?:Top|Bottom)Width/);
  assert.doesNotMatch(source, /sectionHeader:\s*\{[^}]*backgroundColor/);
  assert.match(source, /buildConfiguredHomeCollections\(snapshot\.homeSections\.items\.map/);
  assert.match(source, /homeCollections\.map\(\(collection\) => \([\s\S]*?<OperatorHomeSection/);
  assert.doesNotMatch(source, /seenProductIds|todayDrawGroups|homeCollectionCandidates/);
  assert.doesNotMatch(source, /productCardBody:\s*\{[^}]*minHeight/);
  assert.doesNotMatch(source, /collectionProductCardBody/);
  assert.match(source, /const mediaAspectRatio = getHomeProductMediaAspectRatio\(layoutKind\)/);
  assert.match(source, /<CatalogDiscoveryImage/);
  assert.match(source, /targetAspectRatio=\{mediaAspectRatio\}/);
});

test("Home ticker pauses automatic movement and fully respects Reduce Motion", () => {
  const source = readSource("apps/mobile/src/features/home/AnnouncementTicker.tsx");

  assert.match(source, /const TICKER_ROW_HEIGHT = 44/);
  assert.match(source, /const \[paused, setPaused\] = useState\(false\)/);
  assert.match(source, /if \(reduceMotion \|\| paused\) return undefined/);
  assert.match(source, /공지 자동 전환 일시 정지/);
  assert.match(source, /공지 자동 전환 재생/);
  assert.match(source, /onPress\(currentMessage, index % safeMessages\.length\)/);
  assert.match(source, /width:\s*seed\.size\.touchTarget[\s\S]*?height:\s*seed\.size\.touchTarget/);
});

test("fixed root navigation and Home reel preserve labels at accessibility sizes", () => {
  const navigationSource = readSource("apps/mobile/src/components/RootFloatingTabBar.tsx");
  const homeSource = readSource("apps/mobile/src/features/home/HomeScreen.tsx");

  assert.match(navigationSource, /ROOT_TAB_LABEL_MAX_FONT_SIZE_MULTIPLIER = 2/);
  assert.match(navigationSource, /accessibilityRole="tab"[\s\S]*?accessibilityLabel=\{options\.tabBarAccessibilityLabel \?\? label\}[\s\S]*?accessibilityState=\{\{ selected \}\}/);
  assert.match(navigationSource, /maxFontSizeMultiplier=\{ROOT_TAB_LABEL_MAX_FONT_SIZE_MULTIPLIER\}[\s\S]*?numberOfLines=\{1\}/);
  assert.doesNotMatch(navigationSource, /allowFontScaling=\{false\}/);
  for (const [routeName, label] of [
    ["gacha", "가챠샵"],
    ["kuji", "쿠지샵"],
    ["index", "홈"],
    ["storage", "보관함"],
    ["profile", "내정보"],
  ]) {
    assert.match(navigationSource, new RegExp(`${routeName}: "${label}"`));
  }
  assert.match(navigationSource, /minWidth:\s*seed\.size\.touchTarget[\s\S]*?minHeight:\s*seed\.size\.touchTarget/);

  assert.match(homeSource, /const expanded = shouldExpandHomeRecentDraw\(fontScale\)/);
  assert.doesNotMatch(homeSource, /reel\.previous|position="previous"|recentDrawReelPrevious/);
  assert.match(homeSource, /!expanded && reel\.next/);
  assert.match(homeSource, /expanded \? styles\.recentDrawReelRowLargeText : styles\.recentDrawReelRow/);
  assert.match(homeSource, /recentDrawSummaryLargeText:\s*\{[\s\S]*?flexDirection:\s*"column"[\s\S]*?alignItems:\s*"stretch"/);
  assert.match(homeSource, /recentDrawReelRowLargeText:\s*\{[^}]*minHeight:\s*seed\.size\.touchTarget[^}]*flexDirection:\s*"row"/);
  assert.match(homeSource, /expanded && styles\.recentDrawEmptyLargeText/g);
  assert.match(homeSource, /accessibilityLabel=\{current \? `\$\{activity\.rarity\} 등급, \$\{activity\.prizeName\} 당첨` : undefined\}/);
});

test("fixed discovery cards cap visible copy while retaining complete accessibility labels", () => {
  const catalogSource = readSource("apps/mobile/src/design-system/catalog.ts");
  const homeSource = readSource("apps/mobile/src/features/home/HomeScreen.tsx");
  const shopSource = readSource("apps/mobile/src/features/shop/ShopScreen.tsx");
  const kujiTierSource = readSource("apps/mobile/src/components/KujiPrizeTierRow.tsx");

  assert.match(catalogSource, /CATALOG_CARD_TEXT_MAX_FONT_SIZE_MULTIPLIER = 2/);
  assert.equal((homeSource.match(/maxFontSizeMultiplier=\{CATALOG_CARD_TEXT_MAX_FONT_SIZE_MULTIPLIER\}/g) ?? []).length >= 4, true);
  assert.equal((shopSource.match(/maxFontSizeMultiplier=\{CATALOG_CARD_TEXT_MAX_FONT_SIZE_MULTIPLIER\}/g) ?? []).length, 4);
  assert.equal((kujiTierSource.match(/maxFontSizeMultiplier=\{CATALOG_CARD_TEXT_MAX_FONT_SIZE_MULTIPLIER\}/g) ?? []).length, 4);
  assert.match(homeSource, /accessibilityLabel=\{homeProductAccessibilityLabel\(product, ipName, badge, commerceEnabled\)\}/);
  assert.match(shopSource, /accessibilityLabel=\{\[[\s\S]*?remainingInventoryLabel\(product\.category\)[\s\S]*?\.join\(", "\)\}/);
  assert.match(kujiTierSource, /accessibilityLabel=\{summary\.accessibilityLabel\}/);
});

test("Home hero and dense account chrome avoid extra-large clipping without changing base geometry", () => {
  const homeSource = readSource("apps/mobile/src/features/home/HomeScreen.tsx");
  const storageRootSource = readSource("apps/mobile/src/features/profile/StorageRootScreen.tsx");
  const profileHomeSource = readSource("apps/mobile/src/features/profile/ProfileHomeScreen.tsx");
  const profileSectionSource = readSource("apps/mobile/src/features/profile/ProfileSectionScreen.tsx");

  assert.match(homeSource, /const expanded = shouldExpandHomeHero\(fontScale\)/);
  assert.match(homeSource, /numberOfLines=\{expanded \? 3 : 2\}/);
  assert.match(homeSource, /heroLargeText:\s*\{\s*minHeight:\s*220\s*\}/);
  assert.match(homeSource, /brandTagline[\s\S]*?maxFontSizeMultiplier=\{2\}|maxFontSizeMultiplier=\{2\}[\s\S]*?brandTagline/);

  assert.match(storageRootSource, /accessibilityHint="보관 상품을 서로 교환해요\."/);
  assert.doesNotMatch(storageRootSource, /<Text numberOfLines=\{1\} style=\{styles\.exchangeEntryCaption\}>/);
  assert.match(profileHomeSource, /maxFontSizeMultiplier=\{2\} style=\{styles\.bio\}/);
  assert.doesNotMatch(profileHomeSource, /<Text numberOfLines=\{2\} style=\{styles\.menuCaption\}>/);
  assert.match(profileSectionSource, /const largeText = Number\.isFinite\(fontScale\) && fontScale > 1\.3/);
  assert.match(profileSectionSource, /maxFontSizeMultiplier=\{2\} numberOfLines=\{largeText \? undefined : 2\} style=\{\[styles\.storageTabLabel/);
  assert.match(profileSectionSource, /storageTabLargeText:\s*\{[^}]*paddingVertical:/);
  assert.match(profileSectionSource, /storageListHeaderLargeText:\s*\{[^}]*flexDirection:\s*"column"[^}]*alignItems:\s*"stretch"/);
  assert.match(profileSectionSource, /storageListActionsLargeText:\s*\{[^}]*width:\s*"100%"[^}]*flexWrap:\s*"wrap"/);
  assert.match(profileSectionSource, /\{largeText \? footer : null\}[\s\S]*?\{largeText \? null : footer\}/);
  assert.equal((profileSectionSource.match(/maxFontSizeMultiplier=\{2\}/g) ?? []).length >= 7, true);
});

test("Home and ppoba functional copy avoids sub-11 point text and excess card body height", () => {
  const source = [
    readSource("apps/mobile/src/features/home/HomeScreen.tsx"),
    readSource("apps/mobile/src/features/home/AnnouncementTicker.tsx"),
    readSource("apps/mobile/src/features/shop/ShopScreen.tsx"),
  ].join("\n");

  assert.doesNotMatch(source, /fontSize:\s*(?:7|8|9|10)(?:\D|$)/);
  assert.match(source, /"catalogTitleWide" : "catalogTitle"/);
  assert.match(source, /variant="catalogPrice"/);
  assert.match(source, /variant="catalogMetadata"/);

  const shopSource = readSource("apps/mobile/src/features/shop/ShopScreen.tsx");
  assert.doesNotMatch(shopSource, /productCardBody:\s*\{[^}]*minHeight/);
  assert.match(shopSource, /productName:\s*\{[^}]*minHeight:\s*40[^}]*seed\.typography\.catalogTitle/);
  assert.match(
    shopSource,
    /<View style=\{styles\.searchToolbar\}>[\s\S]*?<SeedInputShell[\s\S]*?style=\{styles\.searchBox\}>[\s\S]*?<Pressable[\s\S]*?styles\.filterButton[\s\S]*?<\/Pressable>[\s\S]*?<\/View>/,
  );
  assert.match(shopSource, /searchToolbar:\s*\{[^}]*flexDirection:\s*"row"[^}]*alignItems:\s*"center"[^}]*gap:\s*seed\.spacing\.x2/);
  assert.match(shopSource, /searchBox:\s*\{[^}]*flex:\s*1[^}]*minWidth:\s*0/);
  assert.match(shopSource, /filterButton:\s*\{[^}]*width:\s*seed\.size\.input[^}]*height:\s*seed\.size\.input[^}]*minHeight:\s*seed\.size\.touchTarget/);
  assert.doesNotMatch(shopSource, /categoryToolbar/);
  assert.match(shopSource, /retryButton:\s*\{[^}]*minHeight:\s*seed\.size\.touchTarget/);
});
