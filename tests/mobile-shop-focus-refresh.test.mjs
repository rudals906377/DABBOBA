import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  SHOP_FOCUS_REFRESH_STALE_MS,
  mergeRefreshedFirstPage,
  shouldRefreshShopOnFocus,
} from "../apps/mobile/src/features/shop/shop-refresh.ts";

const shopSource = readFileSync(new URL("../apps/mobile/src/features/shop/ShopScreen.tsx", import.meta.url), "utf8");
const item = (id, version = 1) => ({ id, version });

test("a shop refocus only refreshes after the last successful load is at least 60 seconds old", () => {
  assert.equal(SHOP_FOCUS_REFRESH_STALE_MS, 60_000);
  assert.equal(shouldRefreshShopOnFocus(null, 1_000_000), false);
  assert.equal(shouldRefreshShopOnFocus(1_000_000, 1_000_000 + 59_999), false);
  assert.equal(shouldRefreshShopOnFocus(1_000_000, 1_000_000 + 60_000), true);
});

test("an in-place refresh of a single loaded page adopts the fresh page and cursor", () => {
  const merged = mergeRefreshedFirstPage(
    { items: [item("a"), item("b")], nextCursor: "old" },
    { items: [item("c"), item("a", 2)], nextCursor: "fresh" },
    2,
  );
  assert.deepEqual(merged.items, [item("c"), item("a", 2)]);
  assert.equal(merged.nextCursor, "fresh");
});

test("an in-place refresh keeps already loaded later pages and their continuation cursor", () => {
  const merged = mergeRefreshedFirstPage(
    { items: [item("a"), item("b"), item("c"), item("d")], nextCursor: "page-3" },
    { items: [item("x"), item("c", 2)], nextCursor: "page-2" },
    2,
  );
  assert.deepEqual(merged.items, [item("x"), item("c", 2), item("d")]);
  assert.equal(merged.nextCursor, "page-3");
});

test("ShopScreen keeps items on focus, resets on condition changes and on pull-to-refresh", () => {
  const focusEffect = shopSource.match(/useFocusEffect\(useCallback\(\(\) => \{[\s\S]*?\}, \[loadIps\]\)\);/)?.[0] ?? "";
  assert.ok(focusEffect);
  assert.doesNotMatch(focusEffect, /setProducts|setNextCursor/);
  assert.match(focusEffect, /loadProductsRef\.current\(\{ inPlace: true \}\)/);
  assert.match(shopSource, /\} else if \(!inPlace\) \{\s*setLoading\(true\);\s*setProducts\(\[\]\);/);
  assert.match(shopSource, /const refresh = async \(\) => \{[\s\S]*?await loadProducts\(\{ manual: true \}\);/);
  assert.match(shopSource, /useEffect\(\(\) => \{\s*const timer = setTimeout\(\(\) => \{\s*void loadProducts\(\);[\s\S]*?\}, \[loadProducts\]\);/);
});
