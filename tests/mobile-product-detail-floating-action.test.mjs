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
  assert.match(
    source,
    /!isDrawCategory\(product\.category\) \? \([\s\S]*?styles\.quantityBox[\s\S]*?\) : null/,
  );
  assert.match(source, /isDrawCategory\(product\.category\) \? null : <Text style=\{styles\.primaryButtonMeta\}>/);
  assert.match(source, /isDrawCategory\(product\.category\) \? "뽑으러 가기" : "구매 준비"/);
  assert.match(source, /primaryButtonCentered:\s*\{ justifyContent: "center" \}/);
  assert.match(source, /style=\{\(\{ pressed \}\) => \[styles\.quantityButton, pressed && styles\.pressed\]\}/);
  assert.match(source, /pressedTranslateY/);
  assert.match(source, /pressedScale/);
});

test("native Product Detail bounds category artwork and leads with prize information", () => {
  assert.match(source, /import \{ CatalogProductImage \} from "@\/components\/CatalogProductImage"/);
  assert.match(source, /onDimensions=\{\(width, height\) => setMeasured\(/);
  assert.match(source, /\[styles\.hero, \{ aspectRatio: heroAspectRatio \}\]/);
  assert.match(source, /hero:\s*\{ width: "100%", overflow: "hidden" \}/);
  assert.doesNotMatch(source, /heroGacha|heroKuji|aspectRatio:\s*4\s*\/\s*3/);
  assert.match(source, /<CatalogProductImage[\s\S]*?resizeMode="contain"/);
  assert.doesNotMatch(source, /Image\.getSize|setImageAspectRatio/);

  const detailIndex = source.indexOf("<View style={styles.detailCopy}>");
  const oddsIndex = source.indexOf("<OddsSection snapshot={snapshot} />");
  assert.ok(detailIndex >= 0 && oddsIndex > detailIndex);
  assert.doesNotMatch(source, /CommerceGuidance|구매·보관 안내|사전오픈 안내/);
  assert.match(source, /<SeedInlineGuidance[\s\S]*?확률표 버전 \$\{odds\.version\}[\s\S]*?확률은 남은 수량에 따라 실시간으로 바뀌어요/);
  assert.doesNotMatch(source, /서버 가중치를 기준으로 계산됩니다/);
});
