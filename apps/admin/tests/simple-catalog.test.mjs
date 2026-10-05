import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
async function load(path, mocks = {}) {
  const source = await readFile(join(root, path), "utf8");
  const code = require("next/dist/build/swc").transformSync(source, {
    filename: path, jsc: { parser: { syntax: "typescript", tsx: path.endsWith("tsx") }, transform: { react: { runtime: "automatic" } } }, module: { type: "commonjs" },
  }).code;
  const module = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { FormData, URL, URLSearchParams, crypto })((id) => {
    if (id === "react/jsx-runtime") return require(id);
    if (id === "react") return React;
    if (id === "server-only") return {};
    if (id in mocks) return mocks[id];
    throw new Error(`Unexpected import: ${id}`);
  }, module, module.exports);
  return module.exports;
}

const product = {
  id: "product-a", sku: "EXISTING-CODE", category: "gacha", ipId: "work-a", version: 7,
  name: "기존 상품", price: 11000, availableQuantity: 30, isActive: true, isPrizeOnly: false, saleStatus: "COMING_SOON",
  manufacturer: "제조사", releaseDate: null, characterIds: ["character-a"], imageUrl: "https://images.test/primary",
  metadata: { detailGalleryImageUrls: ["https://images.test/1", "https://images.test/2", "https://images.test/3"], rules: { quantityRatio: true } },
};
function form(overrides = {}) {
  const data = new FormData();
  for (const [name, value] of Object.entries({ simpleCatalog: "on", productId: "product-a", expectedVersion: "7", ipId: "work-a", name: "새 상품명", price: "11000", manufacturer: "제조사", releaseDate: "", isActive: "on", saleStatus: "COMING_SOON", reason: "상품명 수정", returnTo: "/catalog/products/product-a", idempotencyKey: "123e4567-e89b-42d3-a456-426614174000", ...overrides })) data.set(name, value);
  return data;
}
async function actions({ current = product, deny = false } = {}) {
  const calls = [];
  const redirects = [];
  const result = await load("lib/actions.ts", {
    "next/cache": { revalidatePath() {} }, "next/navigation": { redirect(path) { redirects.push(path); throw new Error("REDIRECT"); } },
    "./api": { AdminApiError: class extends Error {}, adminApi: async (path, options) => { calls.push({ path, ...options }); return { ...current }; } },
    "./auth": { requireCapability: async () => { if (deny) throw new Error("DENIED"); return { token: "test-admin" }; } },
    "./request-security": { safeInternalPath: (value) => value }, "./product-image-upload": { saveProductImage() {} }, "./draw-version-draft": { buildDrawVersionDraftPayload() {} },
  });
  return { ...result, calls, redirects };
}
test("simple product update preserves server-owned metadata, images, stock, SKU and characters", async () => {
  const run = await actions();
  await assert.rejects(run.updateProduct(form({ metadata: "{}", sku: "TAMPERED", availableQuantity: "0", imageUrl: "https://bad.test", category: "kuji", isPrizeOnly: "on" })), /REDIRECT/);
  assert.equal(run.calls.length, 2);
  const body = run.calls[1].body;
  assert.equal(body.sku, product.sku);
  assert.equal(body.category, "gacha");
  assert.equal(body.isPrizeOnly, false);
  assert.equal(body.availableQuantity, 30);
  assert.equal(body.imageUrl, product.imageUrl);
  assert.deepEqual(JSON.parse(JSON.stringify(body.metadata)), product.metadata);
  assert.deepEqual(JSON.parse(JSON.stringify(body.characterIds)), product.characterIds);
  assert.equal(body.name, "새 상품명");
  assert.equal(body.expectedVersion, 7);
  assert.match(run.redirects.at(-1), /success=/);
});
test("simple product update rejects stale forms before any write", async () => {
  const run = await actions({ current: { ...product, version: 8 } });
  await assert.rejects(run.updateProduct(form()), /REDIRECT/);
  assert.equal(run.calls.length, 1);
  assert.match(new URL(run.redirects.at(-1), "https://admin.test").searchParams.get("error"), /다른 운영자/);
});
test("simple product update checks capability before catalog reads", async () => {
  const run = await actions({ deny: true });
  await assert.rejects(run.updateProduct(form()), /DENIED/);
  assert.equal(run.calls.length, 0);
});
test("new simple products get stable generated codes and safe empty metadata", async () => {
  const run = await actions();
  const data = form({ category: "gacha", availableQuantity: "50", saleStatus: "DRAFT" });
  await assert.rejects(run.createProduct(data), /REDIRECT/);
  assert.equal(run.calls.length, 1);
  assert.equal(run.calls[0].body.sku, "gacha-123e4567-e89b-42d3-a456-426614174000");
  assert.deepEqual(JSON.parse(JSON.stringify(run.calls[0].body.metadata)), {});
});
test("product fields use work names and never require raw codes or JSON", async () => {
  const operations = { ReturnTo: () => null, ReasonField: () => null, safeExternalUrl: () => null };
  const module = await load("components/catalog-forms.tsx", {
    "../lib/actions": { createIp() {}, updateIp() {}, createCharacter() {}, updateCharacter() {}, createProduct() {}, updateProduct() {}, clearGalleryProductImage() {}, clearStorefrontProductImage() {} },
    "./operations": operations, "./image-crop-picker": { ImageCropPicker: () => null },
  });
  const html = renderToStaticMarkup(React.createElement(module.ProductForm, { item: product, ips: [{ id: "work-a", nameKo: "실바니안" }], returnTo: "/catalog/products/product-a" }));
  assert.match(html, /<select name="ipId"/);
  assert.match(html, /실바니안/);
  assert.doesNotMatch(html, /name="(?:metadata|sku|characterIds|imageUrl|availableQuantity)"/);
  assert.doesNotMatch(html, /UUID|JSON|작품 ID/);
});

test("home product choices preserve saved order with named reorder and removal buttons", async () => {
  const { HomeProductPicker } = await load("components/home-product-picker.tsx");
  const html = renderToStaticMarkup(React.createElement(HomeProductPicker, { products: [{ id: "a", name: "상품 A" }, { id: "b", name: "상품 B" }], initialIds: ["b", "a"] }));
  assert.ok(html.indexOf("상품 B") < html.indexOf("상품 A"));
  assert.match(html, /name="manualProductIds" value="b\na"/);
  assert.doesNotMatch(html, /<textarea|상품 ID/);
  assert.match(html, /상품 위로/);
  assert.match(html, /상품 아래로/);
});
test("home product choices are sent once and narrowed to the section's layout and work", async () => {
  const { HomeProductChoicesProvider, HomeProductPicker } = await load("components/home-product-picker.tsx");
  const products = [{ id: "g", name: "가챠 상품", category: "gacha", ipId: "ip-a" }, { id: "k", name: "쿠지 상품", category: "kuji", ipId: "ip-b" }];
  const html = renderToStaticMarkup(React.createElement(HomeProductChoicesProvider, { products },
    React.createElement(HomeProductPicker, { initialIds: ["g"] })));
  assert.match(html, /\[가챠\] 가챠 상품/);
  assert.match(html, /<option value="k">\[쿠지\] 쿠지 상품<\/option>/);
  const [picker, form, page] = await Promise.all([
    readFile(join(root, "components/home-product-picker.tsx"), "utf8"),
    readFile(join(root, "components/home-section-form.tsx"), "utf8"),
    readFile(join(root, "app/(admin)/catalog/home-sections/page.tsx"), "utf8"),
  ]);
  assert.match(picker, /product\.category === filter\.layoutKind/);
  assert.match(picker, /product\.ipId === filter\.ipId/);
  assert.match(picker, /선택한 상품 유형·작품과 맞지 않아요/);
  assert.doesNotMatch(form, /products=/);
  assert.equal(page.match(/products=\{productChoices\}/g)?.length, 1);
});
test("catalog choices fetch beyond the first page and fail on a repeated cursor", async () => {
  const calls = [];
  const module = await load("lib/catalog-choices.ts", { "./api": {
    queryString: (values) => `?${new URLSearchParams(Object.entries(values).filter(([,v]) => v)).toString()}`,
    adminApi: async (path) => { calls.push(path); return calls.length === 1 ? {items:[{id:"b",nameKo:"나"}],nextCursor:"next"} : {items:[{id:"a",nameKo:"가"}],nextCursor:null}; },
  } });
  assert.deepEqual(JSON.parse(JSON.stringify(await module.catalogIpChoices("test"))).map((ip) => ip.id), ["a", "b"]);
  assert.equal(calls.length, 2);
  assert.match(calls[1], /cursor=next/);
  const loop = await load("lib/catalog-choices.ts", { "./api": { queryString: () => "", adminApi: async () => ({ items: [], nextCursor: "repeated" }) } });
  await assert.rejects(loop.catalogIpChoices("test"), /목록을 불러오지 못/);
});
test("navigation groups retain all permitted routes and daily refund and deletion access", async () => {
  const { ADMIN_NAVIGATION, isDailyMenu } = await load("lib/navigation.ts");
  const daily = ADMIN_NAVIGATION.filter(isDailyMenu);
  const secondary = ADMIN_NAVIGATION.filter((item) => !isDailyMenu(item));
  assert.equal(daily.length, 12);
  assert.equal(new Set([...daily,...secondary].map((item) => item.href)).size, 22);
  assert.ok(daily.some((item) => item.href === "/account-deletions"));
  assert.ok(daily.some((item) => item.href === "/commerce/refunds"));
});
test("translated status badges retain machine status for CSS", async () => {
  const module = await load("components/operations.tsx", { "next/link": { default: () => null } });
  assert.match(renderToStaticMarkup(React.createElement(module.StatusBadge, {value:"PAID"})), /data-status="paid">결제 완료/);
  assert.equal(module.statusLabel("SUPER_ADMIN"), "최고 관리자");
});
