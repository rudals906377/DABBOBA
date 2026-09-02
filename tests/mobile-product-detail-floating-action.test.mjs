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
  assert.match(source, /edges=\{\["top", "left", "right"\]\}/);
  assert.match(
    source,
    /contentContainerStyle=\{\[styles\.content, \{ paddingBottom: floatingBottomInset \}\]\}/,
  );
  assert.match(source, /<FloatingBottomActionPanel panelStyle=\{styles\.footer\}>/);
  assert.match(floatingPanelSource, /pointerEvents="box-none"/);
  assert.match(
    floatingPanelSource,
    /layer:\s*\{[\s\S]*?position: "absolute"[\s\S]*?zIndex: 100[\s\S]*?backgroundColor: seed\.color\.background\.transparent/,
  );
  assert.match(
    floatingPanelSource,
    /panel:\s*\{[\s\S]*?borderRadius: 22[\s\S]*?backgroundColor: "rgba\(252, 252, 248, 0\.94\)"[\s\S]*?shadowOpacity: 0\.12[\s\S]*?elevation: 10/,
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
});
