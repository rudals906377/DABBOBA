import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

const seedSource = readSource("apps/mobile/src/design-system/seed.ts");
const rootNavigationSource = readSource("apps/mobile/src/components/RootFloatingTabBar.tsx");
const floatingBottomActionSource = readSource("apps/mobile/src/components/FloatingBottomActionPanel.tsx");
const productDetailSource = readSource("apps/mobile/src/features/shop/ProductDetailScreen.tsx");
const checkoutSource = readSource("apps/mobile/src/features/checkout/CheckoutScreen.tsx");
const checkoutConnectionSource = readSource("apps/mobile/src/features/checkout/CheckoutConnectionScreen.tsx");
const kujiDrawSource = readSource("apps/mobile/src/features/kuji/KujiDrawScreen.tsx");
const kujiQueueSource = readSource("apps/mobile/src/features/kuji/KujiQueueScreen.tsx");
const exchangeCreateSource = readSource("apps/mobile/src/features/exchange/ExchangeCreateScreen.tsx");
const exchangeOfferSource = readSource("apps/mobile/src/features/exchange/ExchangeOfferScreen.tsx");
const exchangeDetailSource = readSource("apps/mobile/src/features/exchange/ExchangeListingDetailScreen.tsx");
const dukroomDetailSource = readSource("apps/mobile/src/features/dukroom/DukroomDetailScreen.tsx");
const homeSource = readSource("apps/mobile/src/features/home/HomeScreen.tsx");
const shopSource = readSource("apps/mobile/src/features/shop/ShopScreen.tsx");
const dukroomSource = readSource("apps/mobile/src/features/dukroom/DukroomScreen.tsx");
const exchangeRoomSource = readSource("apps/mobile/src/features/exchange/ExchangeRoomScreen.tsx");

test("native content keeps the shared gutter while root navigation uses the full viewport", () => {
  assert.match(seedSource, /globalGutter:\s*20/);
  assert.match(rootNavigationSource, /bar:\s*\{[^}]*flex:\s*1[^}]*flexDirection:\s*"row"/);
  assert.match(rootNavigationSource, /tab:\s*\{[^}]*flex:\s*1/);
  assert.doesNotMatch(rootNavigationSource, /tabWidth|useWindowDimensions/);
  assert.match(rootNavigationSource, /right: 0,[\s\S]*?left: 0,[\s\S]*?borderTopWidth: StyleSheet\.hairlineWidth/);
  assert.match(
    floatingBottomActionSource,
    /layer:\s*\{[\s\S]*?position: "absolute"[\s\S]*?paddingHorizontal: seed\.spacing\.globalGutter[\s\S]*?backgroundColor: seed\.color\.background\.transparent/,
  );
  assert.match(
    checkoutSource,
    /content:\s*\{ paddingHorizontal: seed\.spacing\.globalGutter/,
  );
  assert.match(
    checkoutConnectionSource,
    /content:\s*\{ paddingHorizontal: seed\.spacing\.globalGutter/,
  );
});

test("every route-owned fixed action uses the shared floating frame", () => {
  assert.match(floatingBottomActionSource, /export function FloatingBottomActionPanel/);
  assert.match(floatingBottomActionSource, /export function useFloatingBottomActionContentInset/);
  assert.match(
    floatingBottomActionSource,
    /panel:\s*\{[\s\S]*?maxWidth: 520[\s\S]*?minHeight: 70[\s\S]*?borderRadius: seed\.radius\.r5_5[\s\S]*?backgroundColor: "rgba\(252, 252, 248, 0\.94\)"[\s\S]*?shadowOpacity: 0\.12[\s\S]*?elevation: 10/,
  );

  for (const source of [
    checkoutSource,
    checkoutConnectionSource,
    kujiDrawSource,
    exchangeCreateSource,
    exchangeOfferSource,
    exchangeDetailSource,
  ]) {
    assert.match(source, /<FloatingBottomActionPanel/);
    assert.match(source, /useFloatingBottomActionContentInset\(\)/);
    assert.match(source, /edges=\{\["top", "left", "right"\]\}/);
    assert.doesNotMatch(source, /(footer|bottomBar):\s*\{[^}]*borderTopWidth/);
  }

  assert.match(productDetailSource, /<FloatingBottomActionPanel/);
  assert.match(productDetailSource, /useFloatingBottomActionContentInset\(\)/);
  assert.match(
    productDetailSource,
    /edges=\{readOnlyReference \|\| productComingSoon \? \["top", "bottom", "left", "right"\] : \["top", "left", "right"\]\}/,
  );
  assert.doesNotMatch(productDetailSource, /(footer|bottomBar):\s*\{[^}]*borderTopWidth/);
});

test("loading and error states keep the same global outer frame", () => {
  for (const source of [checkoutSource, checkoutConnectionSource, kujiDrawSource, kujiQueueSource]) {
    assert.match(source, /state:\s*\{[^}]*paddingHorizontal: seed\.spacing\.globalGutter/);
  }
  for (const source of [dukroomDetailSource, productDetailSource]) {
    assert.match(source, /center:\s*\{[^}]*paddingHorizontal: seed\.spacing\.globalGutter[^}]*paddingVertical: 28/);
  }
  assert.match(homeSource, /<RootPageScaffold header=\{<HomeHeader \/>\}>/);
  for (const stateStyle of ["connectionNotice", "hero", "recentDrawSummary", "sectionEmpty"]) {
    assert.match(
      homeSource,
      new RegExp(`${stateStyle}:\\s*\\{[^}]*marginHorizontal: seed\\.spacing\\.globalGutter`),
    );
  }
  for (const source of [shopSource, dukroomSource, exchangeRoomSource]) {
    assert.match(source, /loading:\s*\{[^}]*paddingHorizontal: seed\.spacing\.globalGutter/);
  }
});
