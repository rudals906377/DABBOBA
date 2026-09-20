import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (relativePath) => {
  const absolutePath = path.join(root, relativePath);
  return existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "";
};

const dividerSource = readSource("apps/mobile/src/components/ProductInfoDivider.tsx");
const productSurfaceSources = [
  "apps/mobile/src/components/CatalogProductRow.tsx",
  "apps/mobile/src/features/shop/ProductDetailScreen.tsx",
  "apps/mobile/src/features/checkout/CheckoutScreen.tsx",
  "apps/mobile/src/features/checkout/CheckoutConnectionScreen.tsx",
  "apps/mobile/src/features/exchange/ExchangeRoomScreen.tsx",
  "apps/mobile/src/features/exchange/ExchangeCreateScreen.tsx",
  "apps/mobile/src/features/exchange/ExchangeOfferScreen.tsx",
  "apps/mobile/src/features/exchange/ExchangeListingDetailScreen.tsx",
  "apps/mobile/src/features/profile/ProfileSectionScreen.tsx",
  "apps/mobile/src/features/kuji/KujiDrawScreen.tsx",
  "apps/mobile/src/features/kuji/KujiQueueScreen.tsx",
].map((relativePath) => [relativePath, readSource(relativePath)]);

const discoveryProductSurfaceSources = [
  "apps/mobile/src/features/home/HomeScreen.tsx",
  "apps/mobile/src/features/shop/ShopScreen.tsx",
].map((relativePath) => [relativePath, readSource(relativePath)]);

test("product information dividers use one non-interactive muted physical-pixel rule", () => {
  assert.match(dividerSource, /export function ProductInfoDivider/);
  assert.match(dividerSource, /accessible=\{false\}/);
  assert.match(dividerSource, /pointerEvents="none"/);
  assert.match(dividerSource, /height:\s*StyleSheet\.hairlineWidth/);
  assert.match(dividerSource, /width:\s*StyleSheet\.hairlineWidth/);
  assert.match(dividerSource, /backgroundColor:\s*seed\.color\.stroke\.muted/);
});

test("customer product surfaces separate identity from price and metadata through the shared hairline", () => {
  for (const [relativePath, source] of productSurfaceSources) {
    assert.match(source, /import \{ ProductInfoDivider \} from "@\/components\/ProductInfoDivider"/, relativePath);
    assert.match(source, /<ProductInfoDivider/, relativePath);
  }
});

test("discovery cards use spacing rather than stacking internal rules", () => {
  for (const [relativePath, source] of discoveryProductSurfaceSources) {
    assert.doesNotMatch(source, /import \{ ProductInfoDivider \} from "@\/components\/ProductInfoDivider"/, relativePath);
    assert.doesNotMatch(source, /<ProductInfoDivider/, relativePath);
    assert.doesNotMatch(source, /productCardBody:\s*\{[^}]*borderTopWidth/, relativePath);
  }
});

test("catalog and home product boundaries stay subtle instead of adding heavy boxes", () => {
  const catalogRowSource = readSource("apps/mobile/src/components/CatalogProductRow.tsx");
  const homeSource = readSource("apps/mobile/src/features/home/HomeScreen.tsx");
  const exchangeRoomSource = readSource("apps/mobile/src/features/exchange/ExchangeRoomScreen.tsx");

  assert.match(catalogRowSource, /row:\s*\{[^}]*\.\.\.catalogProductCardSurface/);
  assert.doesNotMatch(catalogRowSource, /row:\s*\{[^}]*borderWidth:/);
  assert.match(homeSource, /collectionCard:\s*\{[^}]*\.\.\.catalogProductCardSurface/);
  assert.match(exchangeRoomSource, /<ProductInfoDivider style=\{styles\.cardHeadingDivider\} \/>/);
  assert.doesNotMatch(exchangeRoomSource, /priceBox:\s*\{[^}]*borderTopWidth:\s*1/);
});
