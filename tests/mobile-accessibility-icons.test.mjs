import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

const decorativeIconPath = "apps/mobile/src/components/DecorativeIonicon.tsx";
const sourceExtensions = new Set([".js", ".jsx", ".ts", ".tsx"]);

function collectSourcePaths(relativeDirectory) {
  return readdirSync(path.join(root, relativeDirectory), { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) return collectSourcePaths(relativePath);
      return sourceExtensions.has(path.extname(entry.name)) ? [relativePath] : [];
    });
}

const mobileSourcePaths = [
  "apps/mobile/App.tsx",
  ...collectSourcePaths("apps/mobile/app"),
  ...collectSourcePaths("apps/mobile/src"),
];
const mobileSourcesExceptWrapper = mobileSourcePaths
  .filter((relativePath) => relativePath !== decorativeIconPath)
  .map((relativePath) => ({ relativePath, source: readSource(relativePath) }));

test("decorative icon fonts stay out of the screen-reader tree", () => {
  const decorativeIcon = readSource(decorativeIconPath);
  const seedComponents = readSource("apps/mobile/src/design-system/components.tsx");

  assert.match(decorativeIcon, /accessible=\{false\}/);
  assert.match(decorativeIcon, /accessibilityElementsHidden/);
  assert.match(decorativeIcon, /importantForAccessibility="no-hide-descendants"/);
  for (const { relativePath, source } of mobileSourcesExceptWrapper) {
    assert.doesNotMatch(
      source,
      /import\s*\{[^}]*\bIonicons\b[^}]*\}\s*from\s*["']@expo\/vector-icons["']/,
      `${relativePath} must use DecorativeIonicon instead of importing Ionicons directly`,
    );
    assert.doesNotMatch(
      source,
      /<Ionicons\b/,
      `${relativePath} must render DecorativeIonicon instead of Ionicons`,
    );
  }
  assert.match(seedComponents, /accessibilityElementsHidden importantForAccessibility="no-hide-descendants"/);
});

test("root actions, product controls, storage actions, and legal actions own explicit semantics", () => {
  const tabs = readSource("apps/mobile/src/components/RootFloatingTabBar.tsx");
  const shop = readSource("apps/mobile/src/features/shop/ShopScreen.tsx");
  const product = readSource("apps/mobile/src/features/shop/ProductDetailScreen.tsx");
  const storage = readSource("apps/mobile/src/features/profile/ProfileSectionScreen.tsx");
  const legal = readSource("apps/mobile/src/features/profile/ProfileMemberDetailScreen.tsx");

  assert.match(tabs, /accessibilityRole="tab"[\s\S]*?accessibilityLabel=[\s\S]*?accessibilityState=\{\{ selected \}\}/);
  assert.match(shop, /accessibilityRole="switch"[\s\S]*?accessibilityLabel="품절 상품 제외"[\s\S]*?accessibilityState=\{\{ checked: draftExcludeSoldOut \}\}/);
  assert.match(product, /accessibilityLabel=\{!commerceEnabled[\s\S]*?accessibilityState=\{\{ disabled:[\s\S]*?busy: wishlistPending \}\}/);
  assert.match(storage, /accessibilityLabel=\{submitLabel\}[\s\S]*?accessibilityState=\{\{ disabled: !selectedCount \|\| submitting, busy: submitting \}\}/);
  assert.match(legal, /accessibilityLabel="회원탈퇴 요청"[\s\S]*?accessibilityState=\{\{ disabled: deletionPending, busy: deletionPending \}\}/);
});

test("visible mobile text permits the approved 200 percent accessibility scale", () => {
  for (const { relativePath, source } of mobileSourcesExceptWrapper) {
    assert.doesNotMatch(
      source,
      /allowFontScaling=\{false\}/,
      `${relativePath} must not disable the user's text scale`,
    );
    for (const match of source.matchAll(/maxFontSizeMultiplier=\{(\d+(?:\.\d+)?)\}/g)) {
      assert.ok(
        Number(match[1]) >= 2,
        `${relativePath} caps text below 200 percent at ${match[1]}`,
      );
    }
  }
});

test("root headers and tab labels reserve their 200 percent text layout", () => {
  const rootHeader = readSource("apps/mobile/src/components/RootPageHeader.tsx");
  const tabs = readSource("apps/mobile/src/components/RootFloatingTabBar.tsx");

  assert.match(rootHeader, /titleSlot:\s*\{[^}]*minWidth:\s*0[^}]*flex:\s*1/);
  assert.doesNotMatch(rootHeader, /titleSlot:\s*\{[^}]*flexShrink:\s*1/);
  assert.match(tabs, /labelClip:\s*\{[^}]*minHeight:\s*32/);
  assert.doesNotMatch(tabs, /labelClip:\s*\{[^}]*overflow:\s*"hidden"/);
});
