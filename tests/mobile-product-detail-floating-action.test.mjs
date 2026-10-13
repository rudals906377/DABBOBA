import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(
  path.join(root, "apps/mobile/src/features/shop/ProductDetailScreen.tsx"),
  "utf8",
);
const floatingPanelSource = readFileSync(
  path.join(root, "apps/mobile/src/components/FloatingBottomActionPanel.tsx"),
  "utf8",
);
const shopApiSource = readFileSync(
  path.join(root, "apps/mobile/src/features/shop/shop-api.ts"),
  "utf8",
);

test("native Product Detail keeps its commerce action in a floating content overlay", () => {
  assert.match(floatingPanelSource, /useSafeAreaInsets/);
  assert.match(floatingPanelSource, /const insets = useSafeAreaInsets\(\)/);
  assert.match(source, /edges=\{readOnlyReference \|\| productComingSoon \? \["top", "bottom", "left", "right"\] : \["top", "left", "right"\]\}/);
  assert.match(
    source,
    /paddingBottom: readOnlyReference \? seed\.spacing\.screenBottom : floatingBottomInset/,
  );
  assert.match(source, /!readOnlyReference \? <FloatingBottomActionPanel panelStyle=\{styles\.footer\}>/);
  assert.match(floatingPanelSource, /pointerEvents="box-none"/);
  assert.match(
    floatingPanelSource,
    /layer:\s*\{[\s\S]*?position: "absolute"[\s\S]*?zIndex: 100[\s\S]*?backgroundColor: seed\.color\.background\.transparent/,
  );
  assert.match(
    floatingPanelSource,
    /panel:\s*\{[\s\S]*?borderRadius: seed\.radius\.r5_5[\s\S]*?backgroundColor: "rgba\(252, 252, 248, 0\.94\)"[\s\S]*?shadowOpacity: 0\.12[\s\S]*?elevation: 10/,
  );
  assert.doesNotMatch(source, /footerLayer|footer:\s*\{[^}]*borderTopWidth/);
  assert.match(source, /quantityButton:\s*\{ width: seed\.size\.touchTarget/);
  assert.match(source, /commerceEnabled && !isDrawCategory\(product\.category\) \? \(/);
  // The draw action owns one full-width line; the wishlist lives in the header.
  assert.doesNotMatch(source, /wishlistButton|wishlistLabel/);
  assert.match(source, /<DetailPageHeaderAction\s+label=\{!snapshot\?\.wishlistLoaded \? "찜 상태 다시 불러오기" : snapshot\.wishedByViewer \? "찜 해제" : "찜하기"\}\s+disabled=\{wishlistPending \|\| !snapshot\}/);
  assert.match(source, /disabled=\{!commerceEnabled \|\| drawUnavailable\}/);
  assert.match(source, /!commerceEnabled\s*\? "뽑기 오픈 준비 중"/);
  assert.match(source, /isDrawCategory\(product\.category\) \? "뽑으러 가기" : "구매 준비"/);
  assert.match(source, /primaryButtonCentered:\s*\{ justifyContent: "center" \}/);
  assert.match(source, /styles\.quantityButton, pressed && styles\.pressed/);
  assert.match(source, /pressedTranslateY/);
  assert.match(source, /pressedScale/);
});

test("native Product Detail bounds category artwork and leads with prize information", () => {
  assert.match(source, /import \{ CatalogProductImage \} from "@\/components\/CatalogProductImage"/);
  assert.match(source, /onDimensions=\{\(width, height\) =>/);
  assert.match(source, /setMeasured\(\(current\) => current\[imageUri\] === aspectRatio/);
  assert.match(source, /measured\[uri\]/);
  assert.match(source, /\[styles\.hero, \{ aspectRatio: heroAspectRatio \}\]/);
  assert.match(source, /hero:\s*\{ width: "100%", overflow: "hidden" \}/);
  assert.doesNotMatch(source, /heroGacha|heroKuji|aspectRatio:\s*4\s*\/\s*3/);
  assert.match(source, /<CatalogProductImage[\s\S]*?resizeMode="contain"/);

  const detailIndex = source.indexOf("<View style={styles.detailCopy}>");
  const oddsIndex = source.indexOf("<OddsSection snapshot={snapshot} onRetry=");
  const recentIndex = source.indexOf("<RecentDrawSection items={recentDraws}");
  const informationIndex = source.indexOf("<DrawProductInformation snapshot={snapshot} />");
  const noticesIndex = source.indexOf("<DrawProductNotices");
  assert.ok(detailIndex >= 0 && oddsIndex > detailIndex && recentIndex > oddsIndex && informationIndex > recentIndex && noticesIndex > informationIndex);
  assert.doesNotMatch(source, /CommerceGuidance|구매·보관 안내|사전오픈 안내/);
  // No promotional or tutorial cards: guidance is text-only and the near-black surface stays reserved.
  assert.doesNotMatch(source, /중복 상품이 생겼나요|exchangeBanner|계산 예시|highlightRow|backgroundColor: colors\.ink, flexDirection/);
  assert.match(source, /function DrawHighlights[\s\S]*?<SeedInlineGuidance\s+style=\{styles\.highlights\}\s+paragraphs=\{\[/);
  assert.match(source, /확률표 버전 \$\{odds\.version\}/);
});

test("product detail wishlist reads all pages and never treats a failed lookup as not wished", () => {
  assert.match(source, /useFocusEffect\(useCallback\(\(\) => \{\s*void load\(\)/);
  // A refocus refresh keeps the loaded page instead of flashing the full spinner,
  // and a failed background refresh keeps the last verified snapshot.
  assert.match(source, /const refreshing = loadedSnapshotRef\.current\?\.product\.id === productId;\s*if \(!refreshing\) setLoading\(true\);/);
  assert.match(source, /if \(!controller\.signal\.aborted && !refreshing\) setMessage\(/);
  assert.match(shopApiSource, /fetchShopWishlistProductIds\(apiBaseUrl, accessToken, context\.signal\)\.catch\(\(\) => null\)/);
  assert.match(shopApiSource, /wishlistLoaded: !accessToken \|\| wishlistIds !== null/);
  assert.match(shopApiSource, /wishedByViewer:[\s\S]*?wishlistIds\?\.has\(productId\)/);
  assert.match(source, /if \(!snapshot\.wishlistLoaded\) \{[\s\S]*?fetchShopWishlistProductIds\(runtime\.apiBaseUrl, accessToken\)/);
  assert.match(source, /label=\{!snapshot\?\.wishlistLoaded \? "찜 상태 다시 불러오기"/);
});

test("included products center their artwork and names in compact reference-proportioned cards", () => {
  assert.match(source, /<View style=\{styles\.includedImageFrame\}>\s*<View style=\{styles\.includedImageTile\}>\s*<CatalogProductImage/);
  assert.match(source, /includedCard: \{[^}]*\.\.\.catalogProductCardSurface \}/);
  assert.match(source, /includedImageFrame: \{[^}]*height: 92[^}]*alignItems: "center"[^}]*justifyContent: "center"/);
  assert.match(source, /includedImageFrame: \{[^}]*backgroundColor: seed\.color\.layer\.default/);
  assert.match(source, /includedImageTile: \{ width: 56, height: 56 \}/);
  assert.match(source, /includedName: \{[^}]*width: "100%"[^}]*fontSize: 13, lineHeight: 18, fontWeight: "700"[^}]*textAlign: "center"/);
});
