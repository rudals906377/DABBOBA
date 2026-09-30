import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const requireFromMobile = createRequire(new URL("../apps/mobile/package.json", import.meta.url));
const ts = requireFromMobile("typescript");

test("a stalled shop or search catalog request stops loading and remains retryable", async () => {
  const source = await readFile(new URL("../apps/mobile/src/features/shop/shop-api.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: "shop-api.ts",
  }).outputText;
  const module = { exports: {} };
  const timers = [];
  const requests = [];
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    AbortController,
    Date,
    setTimeout(callback, duration) {
      const timer = { callback, duration, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) { timer.cleared = true; },
    require(specifier) {
      if (specifier === "expo-crypto") return { randomUUID: () => "request-id" };
      if (specifier === "@dabboba/api-client") return { errorMessage: () => "상품을 불러오지 못했습니다." };
      if (specifier === "@/features/catalog/product-categories") return {
        isCustomerBrowsableCatalogCategory: () => true,
        isCustomerVisibleProductCategory: () => true,
        productCategoryLabel: () => "가챠",
      };
      if (specifier === "@/features/catalog/remaining-inventory") return { catalogQuantityLabel: () => "" };
      if (specifier === "@/lib/mobile-api-client") return {
        createMobileDabbobaClient: () => ({
          GET(_path, options) {
            requests.push(options);
            if (requests.length > 1) return Promise.resolve({ data: { items: [{ id: "product-a", category: "gacha" }], nextCursor: null } });
            return new Promise((_resolve, reject) => {
              options.signal?.addEventListener("abort", () => reject(new Error("network aborted")));
            });
          },
        }),
      };
      throw new Error(`Unexpected dependency: ${specifier}`);
    },
  });

  const first = module.exports.fetchCatalogProductPage("https://api.example", { category: "gacha" });
  assert.equal(requests.length, 1);
  assert.ok(requests[0].signal instanceof AbortSignal);
  assert.equal(timers[0].duration, 8_000);
  timers[0].callback();
  await assert.rejects(first, /시간이 초과/);
  assert.equal(timers[0].cleared, true);

  const second = await module.exports.fetchCatalogProductPage("https://api.example", { category: "gacha" });
  assert.equal(second.products[0].id, "product-a");
  assert.equal(timers[1].cleared, true);
});
