import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("native catalog, storage, and profile roots share the approved readable scale and touch targets", () => {
  const seedSource = readSource("apps/mobile/src/design-system/seed.ts");
  const catalogSurfaceSource = readSource("apps/mobile/src/design-system/catalog.ts");
  const homeSource = readSource("apps/mobile/src/features/home/HomeScreen.tsx");
  const shopSource = readSource("apps/mobile/src/features/shop/ShopScreen.tsx");
  const storageSource = readSource("apps/mobile/src/features/profile/ProfileSectionScreen.tsx");
  const recordDetailSource = readSource("apps/mobile/src/features/profile/ProfileRecordDetailScreen.tsx");
  const profileSource = readSource("apps/mobile/src/features/profile/ProfileHomeScreen.tsx");
  const catalogRowSource = readSource("apps/mobile/src/components/CatalogProductRow.tsx");
  const exchangeProductSources = [
    readSource("apps/mobile/src/features/exchange/ExchangeCreateScreen.tsx"),
    readSource("apps/mobile/src/features/exchange/ExchangeListingDetailScreen.tsx"),
    readSource("apps/mobile/src/features/exchange/ExchangeOfferScreen.tsx"),
  ];

  assert.match(seedSource, /catalogTitle:\s*\{\s*fontSize:\s*15,\s*lineHeight:\s*21,\s*fontWeight:\s*"700"/);
  assert.match(seedSource, /catalogTitleWide:\s*\{\s*fontSize:\s*16,\s*lineHeight:\s*22,\s*fontWeight:\s*"700"/);
  assert.match(seedSource, /button:\s*\{\s*fontSize:\s*16,\s*lineHeight:\s*24,\s*fontWeight:\s*"700"/);
  assert.match(seedSource, /catalogPrice:\s*\{\s*fontSize:\s*18,\s*lineHeight:\s*24,\s*fontWeight:\s*"700"/);
  assert.match(seedSource, /catalogMetadata:\s*\{\s*fontSize:\s*12,\s*lineHeight:\s*16,\s*fontWeight:\s*"400"/);
  assert.match(catalogSurfaceSource, /catalogProductCardSurface[\s\S]*?borderWidth:\s*1,[\s\S]*?borderColor:\s*seed\.color\.stroke\.neutral/);

  for (const source of [homeSource, shopSource, storageSource]) {
    assert.match(source, /seed\.typography\.catalogTitle/);
    assert.match(source, /seed\.typography\.catalogPrice/);
    assert.match(source, /seed\.typography\.catalogMetadata/);
  }
  assert.match(homeSource, /variant=\{layoutKind === "kuji" \? "catalogTitleWide" : "catalogTitle"\}[\s\S]*?variant="catalogPrice"[\s\S]*?styles\.collectionProductPriceGacha/);
  assert.doesNotMatch(homeSource, /style=\{styles\.collectionProductMeta\}/);
  assert.doesNotMatch(homeSource, /productCategoryLabel\(product\.category\)\}\s*·\s*\{product\.price/);
  assert.match(shopSource, /type ShopRootCategory = Extract<ProductCategory, "gacha" \| "kuji">/);
  assert.match(shopSource, /export function ShopScreen\(\{ category \}: \{ category: ShopRootCategory \}\)/);
  assert.match(shopSource, /<RootCategoryTitle>\{shopTitle\}<\/RootCategoryTitle>/);
  assert.doesNotMatch(shopSource, /SeedChip|categoryRail/);
  assert.match(storageSource, /storageTab:\s*\{\s*flex:\s*0\.85,\s*minHeight:\s*54,[^}]*alignItems:\s*"center"[^}]*justifyContent:\s*"center"/);
  assert.match(storageSource, /storageTabWide:\s*\{\s*flex:\s*1\.5\s*\}/);
  assert.match(profileSource, /stat:\s*\{[^}]*minWidth:\s*0/);
  assert.match(profileSource, /statValue:\s*\{[^}]*seed\.typography\.subtitle/);
  assert.match(profileSource, /statLabel:\s*\{[^}]*seed\.typography\.caption/);
  assert.match(profileSource, /metricLabel:\s*\{[^}]*seed\.typography\.caption/);
  assert.match(profileSource, /metricValue:\s*\{[^}]*seed\.typography\.subtitle/);
  assert.match(profileSource, /menuLabel:\s*\{[^}]*seed\.typography\.subheading/);
  assert.match(profileSource, /menuRow:\s*\{[^}]*minHeight:\s*58/);
  assert.match(profileSource, /menuCaption:\s*\{[^}]*seed\.typography\.finePrint/);
  assert.match(catalogRowSource, /name:\s*\{[^}]*seed\.typography\.catalogTitle/);
  assert.match(catalogRowSource, /ipName:\s*\{[^}]*seed\.typography\.catalogMetadata/);
  assert.match(catalogRowSource, /price:\s*\{[^}]*seed\.typography\.catalogPrice/);
  assert.match(catalogRowSource, /caption:\s*\{[^}]*seed\.typography\.finePrint/);
  assert.match(catalogRowSource, /categoryLabel:\s*\{[^}]*seed\.typography\.finePrint/);
  assert.doesNotMatch(catalogRowSource, /row:\s*\{[^}]*borderWidth:/);
  assert.match(storageSource, /productPrice:\s*\{[^}]*color:\s*colors\.ink[^}]*seed\.typography\.catalogPrice/);
  assert.match(storageSource, /orderIp:\s*\{[^}]*seed\.typography\.catalogMetadata/);
  assert.match(storageSource, /orderLine:\s*\{[^}]*seed\.typography\.catalogTitle/);
  assert.match(recordDetailSource, /eyebrow:\s*\{[^}]*seed\.typography\.catalogMetadata/);
  assert.match(recordDetailSource, /productName:\s*\{[^}]*seed\.typography\.catalogTitle/);
  assert.match(recordDetailSource, /shippingProductName:\s*\{[^}]*seed\.typography\.catalogTitle/);
  for (const source of exchangeProductSources) {
    assert.match(source, /productName:\s*\{[^}]*seed\.typography\.catalogTitle/);
    assert.doesNotMatch(source, /productName:\s*\{[^}]*fontSize:\s*15/);
  }
});
