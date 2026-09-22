import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolveTwoColumnProductCardWidth } from "../apps/mobile/src/features/shop/shop-layout.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

const seedSource = readSource("apps/mobile/src/design-system/seed.ts");
const typographySource = readSource("apps/mobile/src/components/Typography.tsx");
const meterSource = readSource("apps/mobile/src/components/RemainingInventoryMeter.tsx");
const catalogRowSource = readSource("apps/mobile/src/components/CatalogProductRow.tsx");
const shopSource = readSource("apps/mobile/src/features/shop/ShopScreen.tsx");
const topIndicatorSource = readSource("apps/mobile/src/components/CatalogProductTopIndicator.tsx");

test("catalog cards use the shared readable type scale", () => {
  assert.match(seedSource, /catalogTitle:\s*\{\s*fontSize:\s*15,\s*lineHeight:\s*21/);
  assert.match(seedSource, /catalogTitleWide:\s*\{\s*fontSize:\s*16,\s*lineHeight:\s*22/);
  assert.match(seedSource, /catalogPrice:\s*\{\s*fontSize:\s*18,\s*lineHeight:\s*24/);
  assert.match(typographySource, /\| "catalogTitleWide"/);
  assert.match(typographySource, /catalogTitleWide:\s*seed\.typography\.catalogTitleWide/);
  assert.match(shopSource, /variant=\{wide \? "catalogTitleWide" : "catalogTitle"\}/);
  assert.match(meterSource, /variant="catalogMetadata"/g);
  assert.doesNotMatch(meterSource, /seed\.typography\.finePrint/);
});

test("compact catalog rows share image states and use gacha storefront artwork without cropping kuji", () => {
  assert.match(catalogRowSource, /const uri = product\.category === "gacha" \? storefrontUri \?\? primaryUri : primaryUri/);
  assert.match(catalogRowSource, /<CatalogProductImage/);
  assert.match(catalogRowSource, /product\.category === "kuji" \|\| \(product\.category === "gacha" && !storefrontUri\)/);
  assert.match(catalogRowSource, /fallbackSources=\{product\.category === "gacha" && storefrontUri \? \[\{ uri: primaryUri, resizeMode: "contain" \}\] : \[\]\}/);
  assert.match(catalogRowSource, /product\.category === "kuji" && styles\.categoryBadgeKuji/);
  assert.match(catalogRowSource, /categoryBadgeKuji:[^\n]*backgroundColor:\s*colors\.kujiOrange/);
  assert.doesNotMatch(catalogRowSource, />이미지 없음<\/Text>/);
});

test("shop media prefers storefront art without distorting category layouts", () => {
  assert.match(shopSource, /product\.storefrontImageUrl/);
  assert.match(shopSource, /<CatalogDiscoveryImage/);
  assert.match(shopSource, /storefrontUri=\{storefrontUri\}/);
  assert.match(shopSource, /primaryUri=\{primaryUri\}/);
  assert.match(shopSource, /targetAspectRatio=\{category === "kuji" \? 7 \/ 4 : 8 \/ 7\}/);
  assert.doesNotMatch(shopSource, /categoryBadge/);
  assert.match(shopSource, /resolveTwoColumnProductCardWidth\(\{/);
  assert.match(shopSource, /horizontalSafeArea:\s*safeAreaInsets\.left \+ safeAreaInsets\.right/);
  assert.match(shopSource, /horizontalGutter:\s*seed\.spacing\.globalGutter/);
  assert.match(shopSource, /columnGap:\s*seed\.spacing\.componentDefault/);
  assert.match(shopSource, /wide \? styles\.kujiProductCard : \{ width: cardWidth \}/);
  assert.doesNotMatch(shopSource, /width:\s*"48%"/);
  assert.match(shopSource, /kujiProductCard:\s*\{\s*width:\s*"100%"\s*\}/);
  assert.match(shopSource, /gachaProductImageFrame:\s*\{\s*aspectRatio:\s*8 \/ 7\s*\}/);
  assert.match(shopSource, /kujiProductImageFrame:\s*\{\s*aspectRatio:\s*7 \/ 4\s*\}/);
  assert.match(shopSource, /productCardBody:\s*\{[\s\S]*?paddingHorizontal:\s*seed\.spacing\.x3[\s\S]*?paddingTop:\s*seed\.spacing\.x2_5[\s\S]*?paddingBottom:\s*seed\.spacing\.x3/);
  assert.match(shopSource, /kujiProductCardBody:\s*\{[^}]*paddingHorizontal:\s*seed\.spacing\.x3/);
  assert.match(shopSource, /productName:\s*\{[^}]*marginTop:\s*seed\.spacing\.x1/);
  assert.match(shopSource, /gachaProductName:\s*\{[^}]*marginTop:\s*0/);
  assert.match(shopSource, /\{wide \? \([\s\S]*?style=\{styles\.productIp\}/);
  assert.match(shopSource, /wide \? productSubjectTitle\(product\.name, ipName\) : catalogCardTitle\(product\.name, ipName\)/);
  assert.match(shopSource, /productMeta:\s*\{[^}]*marginTop:\s*seed\.spacing\.x2/);
  assert.match(shopSource, /productInventory:\s*\{\s*marginTop:\s*seed\.spacing\.x1_5\s*\}/);
  assert.doesNotMatch(shopSource, /ProductInfoDivider/);
  assert.doesNotMatch(shopSource, /borderTopWidth/);
  assert.match(shopSource, /gachaProductGrid:\s*\{\s*rowGap:\s*seed\.spacing\.x3\s*\}/);
  assert.match(shopSource, /kujiProductGrid:\s*\{\s*rowGap:\s*seed\.spacing\.x4_5\s*\}/);
});

test("shop gacha columns exactly fit compact viewports and safe-area insets", () => {
  const compactCardWidth = resolveTwoColumnProductCardWidth({
    viewportWidth: 320,
    horizontalSafeArea: 0,
    horizontalGutter: 20,
    columnGap: 12,
  });
  assert.equal(compactCardWidth, 134);
  assert.equal((compactCardWidth * 2) + 12 + (20 * 2), 320);

  const insetCardWidth = resolveTwoColumnProductCardWidth({
    viewportWidth: 320,
    horizontalSafeArea: 16,
    horizontalGutter: 20,
    columnGap: 12,
  });
  assert.equal(insetCardWidth, 126);
  assert.equal((insetCardWidth * 2) + 12 + (20 * 2) + 16, 320);

  assert.equal(resolveTwoColumnProductCardWidth({
    viewportWidth: 375,
    horizontalGutter: 20,
    columnGap: 12,
  }), 161.5);
  assert.equal(resolveTwoColumnProductCardWidth({
    viewportWidth: 40,
    horizontalGutter: 20,
    columnGap: 12,
  }), 0);
  assert.equal(resolveTwoColumnProductCardWidth({
    viewportWidth: Number.NaN,
    horizontalGutter: 20,
    columnGap: 12,
  }), 0);
});

test("every dedicated-shop product card uses the shared proportional category indicator", () => {
  assert.match(shopSource, /<CatalogProductTopIndicator category=\{product\.category\} \/>/);
  assert.match(topIndicatorSource, /left:\s*"36%"/);
  assert.match(topIndicatorSource, /width:\s*"28%"/);
  assert.match(topIndicatorSource, /height:\s*2/);
  assert.match(topIndicatorSource, /backgroundColor:\s*colors\.brand/);
  assert.match(topIndicatorSource, /kuji:[^\n]*backgroundColor:\s*colors\.kujiOrange/);
  assert.match(shopSource, /kujiProductCard:\s*\{\s*width:\s*"100%"\s*\}/);
});
