import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const roomSource = source("../apps/mobile/src/features/exchange/ExchangeRoomScreen.tsx");
const detailSource = source("../apps/mobile/src/features/exchange/ExchangeListingDetailScreen.tsx");
const createSource = source("../apps/mobile/src/features/exchange/ExchangeCreateScreen.tsx");
const offerSource = source("../apps/mobile/src/features/exchange/ExchangeOfferScreen.tsx");
const activitySource = source("../apps/mobile/src/features/exchange/ExchangeActivityScreen.tsx");

test("a two-product exchange listing renders every registered product image on discovery cards", () => {
  assert.match(roomSource, /productDetails\.map\(\(\{ product \}, index\) =>/);
  assert.match(roomSource, /resolveCatalogImageUrl\(product\.imageUrl, assetBaseUrl, product\.version\)/);
  assert.match(roomSource, /등록 상품 \$\{index \+ 1\}\/\$\{products\.length\}/);
  assert.doesNotMatch(roomSource, /const uri = resolveCatalogImageUrl\(item\.product\.imageUrl/);
});

test("exchange discovery never restores preview listings from the customer cache", () => {
  assert.match(roomSource, /\.filter\(\(item\) => !item\.isExample\)/);
  assert.doesNotMatch(roomSource, /__DEV__ \|\| !item\.isExample/);
});

test("exchange discovery exposes IP, name, category, and value for every bundled product", () => {
  assert.match(roomSource, /ipNames=\{snapshot\?\.ipNames \?\? \{\}\}/);
  assert.match(roomSource, /const productDetails = products\.map\(\(product\) => \(\{/);
  assert.match(roomSource, /ipName: ipNames\[product\.ipId\] \?\? "작품 정보 없음"/);
  assert.match(roomSource, /productDetails\.map\(\(\{ product, ipName: productIpName \}, index\) =>/);
  assert.match(roomSource, /productSubjectTitle\(product\.name, productIpName\)/);
  assert.match(roomSource, /categoryLabel\(product\.category\)/);
  assert.match(roomSource, /catalogPriceLabel\(product\.price\)/);
  assert.match(roomSource, /accessibilityLabel=\{listingAccessibilityLabel\}/);
  assert.doesNotMatch(roomSource, /productSubjectTitle\(item\.product\.name, ipName\)/);
});

test("exchange detail renders every product summary in the registered bundle", () => {
  assert.match(detailSource, /item\.products\.map\(\(product, index\) =>/);
  assert.match(detailSource, /<ProductSummary/);
  assert.match(detailSource, /label=\{`등록 상품 \$\{index \+ 1\}\/\$\{item\.products\.length\}`\}/);
});

test("exchange application and activity screens render every registered product image", () => {
  assert.match(offerSource, /detail\.item\.products\.length \? detail\.item\.products/);
  assert.match(offerSource, /products\.map\(\(product, index\) =>/);
  assert.match(offerSource, /resolveCatalogImageUrl\(product\.imageUrl, assetBaseUrl, product\.version\)/);
  assert.doesNotMatch(offerSource, /resolveCatalogImageUrl\(detail\.item\.product\.imageUrl/);

  assert.match(activitySource, /item\.products\.length \? item\.products/);
  assert.match(activitySource, /productDetails\.map\(\(\{ product, ipName \}, index\) =>/);
  assert.match(activitySource, /resolveCatalogImageUrl\(product\.imageUrl, assetBaseUrl, product\.version\)/);
  assert.match(activitySource, /accessibilityRole="button"/);
  assert.match(activitySource, /accessibilityLabel=\{accessibilityLabel\}/);
  assert.doesNotMatch(activitySource, /const uri = resolveCatalogImageUrl\(item\.product\.imageUrl/);
});

test("exchange application identifies every target product visually and accessibly", () => {
  assert.match(offerSource, /const productIpName = detail\.ipNames\[product\.ipId\] \?\? "작품 정보 없음"/);
  assert.match(offerSource, /accessibilityLabel=\{`등록 상품 \$\{index \+ 1\}\/\$\{products\.length\}: \$\{productIpName\}, \$\{product\.name\}, \$\{categoryLabel\(product\.category\)\}, \$\{catalogPriceLabel\(product\.price\)\}`\}/);
  assert.match(offerSource, /<Text numberOfLines=\{1\} style=\{styles\.targetIpName\}>\{productIpName\}<\/Text>/);
  assert.match(offerSource, /<ProductInfoDivider style=\{styles\.targetProductDivider\} \/>/);
  assert.match(offerSource, /targetIpName:\s*\{[^}]*seed\.typography\.catalogMetadata/);
  assert.match(offerSource, /targetProductName:\s*\{[^}]*seed\.typography\.catalogTitle/);
  assert.match(offerSource, /targetMeta:\s*\{[^}]*seed\.typography\.catalogPrice/);
});

test("exchange create and offer keep every supported one-or-two item ratio visible", () => {
  assert.match(createSource, /returnTo="\/exchange\/new"/);
  assert.match(createSource, /가능 비율 1:1 · 1:2/);
  assert.match(createSource, /가능 비율 2:1 · 2:2/);
  assert.match(offerSource, /const targetProductCount = detail[\s\S]*?detail\.item\.products\.length \|\| 1/);
  assert.match(offerSource, /`교환 비율 \$\{targetProductCount\}:\$\{selected\.length\}`/);
});
