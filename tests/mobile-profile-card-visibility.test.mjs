import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profileApiSource = readFileSync(
  path.join(root, "apps/mobile/src/features/profile/profile-api.ts"),
  "utf8",
);
const profileSectionSource = readFileSync(
  path.join(root, "apps/mobile/src/features/profile/ProfileSectionScreen.tsx"),
  "utf8",
);
const profilePolicySource = readFileSync(
  path.join(root, "apps/mobile/src/features/profile/profile-policies.ts"),
  "utf8",
);

test("profile discovery hides card products without deleting owned or historical records", () => {
  assert.match(
    profileApiSource,
    /wishlist:\s*\(wishlistResult\.data\?\.items \?\? \[\]\)\.filter\(\(item\) => \([\s\S]*?isCustomerBrowsableCatalogCategory\(item\.product\.category\)/,
  );
  assert.match(
    profileApiSource,
    /attachWantedMediaUrls\([\s\S]*?\(wantedResult\.data\?\.items \?\? \[\]\)\.filter\(\(request\) => \([\s\S]*?isCustomerVisibleProductCategory\(request\.category\)/,
  );
  assert.match(
    profileApiSource,
    /const browsableProducts = products\.filter\([\s\S]*?isCustomerBrowsableCatalogCategory\(product\.category\)/,
  );
  assert.match(
    profileApiSource,
    /wantedFallbackProduct = products\.find\([\s\S]*?isCustomerVisibleProductCategory\(product\.category\)/,
  );

  assert.match(profileApiSource, /catalogProducts: products/);
  assert.match(profileApiSource, /inventory: inventoryResult\.data\?\.items \?\? \[\]/);
  assert.match(profileApiSource, /orders: ordersResult\.data\?\.items \?\? \[\]/);
  assert.match(profileApiSource, /return "카드"/);
});

test("current profile product copy omits the hidden card category", () => {
  const customerProductCopy = `${profileSectionSource}\n${profilePolicySource}`;

  assert.doesNotMatch(customerProductCopy, /피규어·카드|쿠지·피규어·카드/);
  assert.match(customerProductCopy, /쿠지 추첨과 피규어 등 일반 구매 상품/);
  assert.match(customerProductCopy, /쿠지·피규어 등 다른 상품/);
});
