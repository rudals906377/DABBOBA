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
  assert.match(source, /isDrawCategory\(product\.category\) \? \([\s\S]*?styles\.wishlistButton/);
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
  assert.match(source, /setAspectRatio\(Math\.max\(0\.85, Math\.min\(width \/ height, 2\)\)\)/);
  assert.match(source, /<CatalogProductImage[\s\S]*?resizeMode="contain"/);

  const detailIndex = source.indexOf("<View style={styles.detailCopy}>");
  const oddsIndex = source.indexOf("<OddsSection snapshot={snapshot} onRetry=");
  const recentIndex = source.indexOf("<RecentDrawSection items={recentDraws}");
  const informationIndex = source.indexOf("<DrawProductInformation snapshot={snapshot} />");
  const guidanceIndex = source.indexOf("<CommerceGuidance");
  assert.ok(detailIndex >= 0 && oddsIndex > detailIndex && recentIndex > oddsIndex && informationIndex > recentIndex && guidanceIndex > informationIndex);
  assert.match(source, /accessibilityState=\{\{ expanded \}\}/);
});

test("product detail wishlist reads all pages and never treats a failed lookup as not wished", () => {
  assert.match(source, /useFocusEffect\(useCallback\(\(\) => \{\s*void load\(\)/);
  assert.match(shopApiSource, /fetchShopWishlistProductIds\(apiBaseUrl, accessToken, context\.signal\)\.catch\(\(\) => null\)/);
  assert.match(shopApiSource, /wishlistLoaded: !accessToken \|\| wishlistIds !== null/);
  assert.match(shopApiSource, /wishedByViewer:[\s\S]*?wishlistIds\?\.has\(productId\)/);
  assert.match(source, /if \(!snapshot\.wishlistLoaded\) \{[\s\S]*?fetchShopWishlistProductIds\(runtime\.apiBaseUrl, accessToken\)/);
  assert.match(source, /accessibilityLabel=\{!snapshot\.wishlistLoaded \? "찜 상태 다시 불러오기"/);
});

test("included products center their artwork and names in compact reference-proportioned cards", () => {
  assert.match(source, /<View style=\{styles\.includedImageFrame\}>\s*<View style=\{styles\.includedImageTile\}>\s*<CatalogProductImage/);
  assert.match(source, /includedCard: \{[^}]*\.\.\.catalogProductCardSurface \}/);
  assert.match(source, /includedImageFrame: \{[^}]*height: 92[^}]*alignItems: "center"[^}]*justifyContent: "center"/);
  assert.match(source, /includedImageFrame: \{[^}]*backgroundColor: seed\.color\.layer\.default/);
  assert.match(source, /includedImageTile: \{ width: 56, height: 56 \}/);
  assert.match(source, /includedName: \{[^}]*width: "100%"[^}]*fontSize: 13, lineHeight: 18, fontWeight: "700"[^}]*textAlign: "center"/);
});
