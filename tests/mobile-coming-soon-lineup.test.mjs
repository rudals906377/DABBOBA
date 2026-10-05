import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const requireFromMobile = createRequire(new URL("../apps/mobile/package.json", import.meta.url));
const ts = requireFromMobile("typescript");
const source = await readFile(new URL("../apps/mobile/src/features/shop/shop-api.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: "shop-api.ts",
}).outputText;

function apiHarness({ saleStatus = "COMING_SOON", included, lineup, odds, oddsErrorCode = "COMMERCE_NOT_AVAILABLE" } = {}) {
  const calls = [];
  const signal = new AbortController().signal;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module, exports: module.exports, Date, AbortController, setTimeout, clearTimeout,
    require(specifier) {
      if (specifier === "expo-crypto") return { randomUUID: () => "request-id" };
      if (specifier === "@dabboba/api-client") return { errorMessage: () => "request failed" };
      if (specifier === "@/features/catalog/product-categories") return {
        isCustomerBrowsableCatalogCategory: () => true,
        isCustomerVisibleProductCategory: () => true,
        productCategoryLabel: () => "가챠",
      };
      if (specifier === "@/features/catalog/remaining-inventory") return { catalogQuantityLabel: () => "" };
      if (specifier === "@/lib/mobile-api-client") return {
        createMobileDabbobaClient: () => ({ async GET(route, options) {
          calls.push({ route, options });
          if (route === "/v1/catalog/products/{productId}") return { data: { id: "sylvanian", category: "gacha", saleStatus, ipId: "ip" } };
          if (route === "/v1/catalog/ips") return { data: { items: [{ id: "ip" }] } };
          if (route.endsWith("/draw-odds")) return odds ? { data: odds } : { error: { error: { code: oddsErrorCode } } };
          if (route.endsWith("/prize-lineup")) return lineup ? { data: lineup } : { error: { error: { code: "NOT_FOUND" } } };
          if (route.endsWith("/included-products")) return included === undefined ? { error: { error: { code: "UNAVAILABLE" } } } : { data: { items: included } };
          throw new Error(`Unexpected request: ${route}`);
        } }),
      };
      throw new Error(`Unexpected dependency: ${specifier}`);
    },
  });
  return { calls, signal, load: () => module.exports.fetchProductDetail("https://api.example", "sylvanian", undefined, { signal }) };
}

test("COMING_SOON without an active draw set loads actual public artwork and preserves cancellation", async () => {
  const included = [{ id: "cat", name: "아기 고양이", imageUrl: null }];
  const harness = apiHarness({ included });
  const snapshot = await harness.load();
  assert.equal(snapshot.includedProductsLoaded, true);
  assert.deepEqual(snapshot.includedProducts, included);
  assert.equal(snapshot.drawOdds, null);
  assert.equal(snapshot.prizeLineup, null);
  const call = harness.calls.find(({ route }) => route.endsWith("/included-products"));
  assert.equal(call.options.signal, harness.signal);
  assert.equal(call.options.params.path.productId, "sylvanian");
});

test("a failed public list is unavailable, while a successful empty list is genuinely empty", async () => {
  const failed = await apiHarness().load();
  assert.equal(failed.includedProductsLoaded, false);
  const empty = await apiHarness({ included: [] }).load();
  assert.equal(empty.includedProductsLoaded, true);
  assert.equal(empty.includedProducts.length, 0);
});

test("ON_SALE never substitutes editable prelaunch artwork for missing published draw information", async () => {
  const harness = apiHarness({ saleStatus: "ON_SALE", included: [{ id: "draft" }] });
  const snapshot = await harness.load();
  assert.equal(snapshot.includedProductsLoaded, false);
  assert.equal(harness.calls.some(({ route }) => route.endsWith("/included-products")), false);
});

test("published draw entries remain authoritative and need no registered-product fallback", async () => {
  for (const field of ["lineup", "odds"]) {
    const harness = apiHarness({ [field]: { entries: [{ prizeProductId: "published", prizeName: "확정 구성", prizeImageUrl: null }] }, included: [{ id: "draft" }] });
    const snapshot = await harness.load();
    assert.equal(snapshot.includedProductsLoaded, true);
    assert.equal(snapshot.includedProducts[0].id, "published");
    assert.equal(harness.calls.some(({ route }) => route.endsWith("/included-products")), false);
  }
});

test("an on-sale product falls back to the lineup only while the server withholds odds", async () => {
  const lineup = { entries: [{ prizeProductId: "published", prizeName: "확정 구성", prizeImageUrl: null }] };
  const prelaunch = apiHarness({ saleStatus: "ON_SALE", lineup });
  const withheld = await prelaunch.load();
  assert.equal(withheld.includedProductsLoaded, true);
  assert.equal(withheld.drawOdds, null);
  assert.equal(withheld.prizeLineup, lineup);

  for (const oddsErrorCode of ["INTERNAL_ERROR", "CONFLICT", "RATE_LIMITED", null]) {
    const live = apiHarness({ saleStatus: "ON_SALE", lineup, oddsErrorCode });
    const snapshot = await live.load();
    assert.equal(snapshot.includedProductsLoaded, false, `odds error ${oddsErrorCode}`);
    assert.equal(snapshot.prizeLineup, null);
    assert.equal(live.calls.some(({ route }) => route.endsWith("/prize-lineup")), false);
  }
});
