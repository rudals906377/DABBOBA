import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  HOME_GACHA_PRODUCT_CARD_WIDTH,
  HOME_GACHA_PRODUCT_MEDIA_ASPECT_RATIO,
  HOME_KUJI_PRODUCT_CARD_WIDTH,
  HOME_KUJI_PRODUCT_MEDIA_ASPECT_RATIO,
} from "../apps/mobile/src/features/home/home-feed.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const homeSource = readFileSync(path.join(root, "apps/mobile/src/features/home/HomeScreen.tsx"), "utf8");
const productCardSource = homeSource.slice(
  homeSource.indexOf("function CollectionProductCard"),
  homeSource.indexOf("function homeProductAccessibilityLabel"),
);
const topIndicatorSource = readFileSync(path.join(root, "apps/mobile/src/components/CatalogProductTopIndicator.tsx"), "utf8");
const inventoryMeterSource = readFileSync(path.join(root, "apps/mobile/src/components/RemainingInventoryMeter.tsx"), "utf8");

test("Home gacha cards use a wider, lower profile without shrinking typography", () => {
  assert.equal(HOME_GACHA_PRODUCT_CARD_WIDTH, 172);
  assert.equal(HOME_GACHA_PRODUCT_MEDIA_ASPECT_RATIO, 7 / 5);
  assert.match(homeSource, /const cardWidth = getHomeProductCardWidth\(layoutKind\)/);
  assert.match(homeSource, /const mediaAspectRatio = getHomeProductMediaAspectRatio\(layoutKind\)/);
  assert.match(homeSource, /productCardBody:\s*\{[\s\S]*?paddingHorizontal:\s*seed\.spacing\.x3[\s\S]*?paddingTop:\s*seed\.spacing\.x2_5[\s\S]*?paddingBottom:\s*seed\.spacing\.x2_5/);
  assert.match(homeSource, /productCardBodyGacha:\s*\{[\s\S]*?paddingTop:\s*seed\.spacing\.x2[\s\S]*?paddingBottom:\s*seed\.spacing\.x2/);
  assert.doesNotMatch(homeSource, /productCardBody:\s*\{[^}]*minHeight/);
  assert.doesNotMatch(homeSource, /productCardBody:\s*\{[^}]*borderTopWidth/);
  assert.doesNotMatch(homeSource, /<ProductInfoDivider style=\{styles\.productFieldDivider\} \/>/);
  assert.match(homeSource, /collectionProductName:\s*\{[^}]*minHeight:\s*40[^}]*seed\.typography\.catalogTitle/);
  assert.match(homeSource, /collectionProductName:\s*\{[^}]*marginTop:\s*seed\.spacing\.x1/);
  assert.match(homeSource, /collectionProductNameGacha:\s*\{[^}]*marginTop:\s*0/);
  assert.match(productCardSource, /layoutKind === "kuji" && ipName \? \([\s\S]*?style=\{styles\.collectionProductIp\}/);
  assert.match(productCardSource, /layoutKind === "gacha" \? catalogCardTitle\(product\.name, ipName\) : productSubjectTitle\(product\.name, ipName\)/);
  assert.match(homeSource, /collectionProductPrice:\s*\{[^}]*seed\.typography\.catalogPrice/);
  assert.match(homeSource, /collectionProductPrice:\s*\{[^}]*fontWeight:\s*"500"/);
  assert.match(homeSource, /collectionProductPrice:\s*\{[^}]*marginTop:\s*seed\.spacing\.x1/);
  assert.match(homeSource, /collectionProductPriceGacha:\s*\{[^}]*marginTop:\s*seed\.spacing\.x0_5/);
  assert.match(homeSource, /collectionProductPriceQualifier:\s*\{[^}]*seed\.typography\.catalogMetadata/);
  assert.match(homeSource, /collectionProductPriceAfterQualifier:\s*\{[^}]*marginTop:\s*0/);
  assert.match(homeSource, /collectionProductIp:\s*\{[^}]*seed\.typography\.catalogMetadata/);
  assert.match(homeSource, /productInventory:\s*\{[^}]*marginTop:\s*seed\.spacing\.x1_5/);
  assert.match(homeSource, /productInventoryGacha:\s*\{[^}]*marginTop:\s*seed\.spacing\.x1/);
  assert.match(homeSource, /quantityTextStyle=\{styles\.homeInventoryQuantity\}/);
  assert.match(homeSource, /homeInventoryQuantity:\s*\{\s*fontWeight:\s*"700"\s*\}/);
  assert.match(inventoryMeterSource, /style=\{\[styles\.quantity, dark && styles\.quantityDark, quantityTextStyle\]\}/);
});

test("Home headings and status badges use a clearer restrained hierarchy", () => {
  assert.match(homeSource, /<ReadablePageTitle variant="sectionTitle" numberOfLines=\{2\}>\{title\}<\/ReadablePageTitle>/);
  assert.match(homeSource, /variant="catalogMetadata"[\s\S]*?style=\{\[styles\.homeStatusBadgeLabel/);
  assert.match(homeSource, /homeStatusBadgeLabel:\s*\{[^}]*fontWeight:\s*"700"/);
  assert.doesNotMatch(homeSource, /homeStatusBadgeLabel:\s*\{[^}]*fontWeight:\s*"900"/);
});

test("Home operator cards use a wider title treatment only for kuji", () => {
  assert.doesNotMatch(homeSource, /collectionProductCardBody/);
  assert.match(homeSource, /collectionProductName:\s*\{[^}]*minHeight:\s*40[^}]*seed\.typography\.catalogTitle/);
  assert.match(productCardSource, /variant=\{layoutKind === "kuji" \? "catalogTitleWide" : "catalogTitle"\}/);
  assert.match(homeSource, /collectionProductNameKuji:\s*\{[^}]*seed\.typography\.catalogTitleWide/);
  assert.doesNotMatch(homeSource, /collectionProductMeta/);
  assert.match(productCardSource, /const price = productPriceParts\(product, commerceEnabled\)/);
  assert.match(productCardSource, /layoutKind === "gacha" && price\.qualifier \? \([\s\S]*?variant="catalogMetadata"[\s\S]*?\{price\.qualifier\}/);
  assert.match(productCardSource, /variant="catalogPrice"[\s\S]*?styles\.collectionProductPriceAfterQualifier/);
  assert.ok(productCardSource.includes(String.raw`price.amount.replace(/원$/, "\u2060원")`));
  assert.match(productCardSource, /productPriceLabel\(product, commerceEnabled\)/);
});

test("Home kuji cards use a wider rail card and landscape discovery media", () => {
  assert.equal(HOME_KUJI_PRODUCT_CARD_WIDTH, 228);
  assert.equal(HOME_KUJI_PRODUCT_MEDIA_ASPECT_RATIO, 7 / 4);
  assert.match(homeSource, /layoutKind=\{section\.layoutKind\}/);
  assert.match(homeSource, /const cardWidth = getHomeProductCardWidth\(layoutKind\)/);
  assert.match(homeSource, /const mediaAspectRatio = getHomeProductMediaAspectRatio\(layoutKind\)/);
  assert.match(homeSource, /<CatalogDiscoveryImage/);
  assert.match(homeSource, /storefrontUri=\{storefrontUri\}/);
  assert.match(homeSource, /primaryUri=\{primaryUri\}/);
  assert.match(homeSource, /targetAspectRatio=\{mediaAspectRatio\}/);
  assert.match(homeSource, /\{ aspectRatio: mediaAspectRatio \}/);
  assert.doesNotMatch(productCardSource, /useWindowDimensions/);
});

test("Home renders only ordered operator sections below the event and recent-draw slots", () => {
  assert.match(homeSource, /buildConfiguredHomeCollections\(snapshot\.homeSections\.items\.map/);
  assert.match(homeSource, /homeCollections\.map\(\(collection\) => \([\s\S]*?<OperatorHomeSection/);
  assert.doesNotMatch(homeSource, /HomePopularIpSection|HomeFeaturedProductsSection|TodayDrawGroup/);
});

test("Operator section layoutKind drives the shared card chrome and media", () => {
  assert.match(
    homeSource,
    /productRail:\s*\{[\s\S]*?alignItems:\s*"flex-start"[\s\S]*?paddingHorizontal:\s*seed\.spacing\.globalGutter/,
  );
  assert.equal((homeSource.match(/<CatalogProductTopIndicator category=\{layoutKind\} \/>/g) ?? []).length, 1);
  assert.doesNotMatch(homeSource, /function HomeCardTopIndicator/);
  assert.match(topIndicatorSource, /if \(category !== "gacha" && category !== "kuji"\) return null/);
  assert.doesNotMatch(topIndicatorSource, /Track|track/);
  assert.match(topIndicatorSource, /style=\{\[styles\.indicator, category === "kuji" && styles\.kuji\]\}/);
  assert.match(
    topIndicatorSource,
    /indicator:\s*\{[^\n]*position:\s*"absolute"[^\n]*left:\s*"36%"[^\n]*width:\s*"28%"[^\n]*height:\s*2[^\n]*opacity:\s*0\.68[^\n]*backgroundColor:\s*colors\.brand/,
  );
  assert.match(topIndicatorSource, /kuji:[^\n]*backgroundColor:\s*colors\.kujiOrange/);
  assert.doesNotMatch(homeSource, /KujiSelectionPanel|kujiPanelDecor|kujiPanelLights|kujiPanelSlot/);
  assert.doesNotMatch(homeSource, /kujiProductCardBody|#F7F8F4/);
  assert.doesNotMatch(homeSource, /showBadge/);
  assert.doesNotMatch(homeSource, /styles\.categoryBadge/);
  assert.doesNotMatch(homeSource, /categoryBadge:/);
  assert.match(homeSource, /styles\.homeStatusBadge/);
});
