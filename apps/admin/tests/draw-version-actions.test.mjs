import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { transformSync } = require("next/dist/build/swc");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const jsxRuntime = require("react/jsx-runtime");
const adminRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function form(values) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

async function loadModule(path, mocks = {}) {
  const source = await readFile(path, "utf8");
  const output = transformSync(source, {
    filename: path,
    jsc: { parser: { syntax: "typescript", tsx: path.endsWith(".tsx") }, transform: { react: { runtime: "automatic" } } },
    module: { type: "commonjs" },
  }).code;
  const module = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${output}\n})`, { crypto, URL, URLSearchParams, FormData, Headers, AbortSignal })(
    (id) => {
      if (id === "node:crypto") return require("node:crypto");
      if (id in mocks) return mocks[id];
      throw new Error(`Unexpected import: ${id}`);
    }, module, module.exports,
  );
  return module.exports;
}

async function loadActions({ productCategory = "kuji", deny = false } = {}) {
  const apiCalls = [];
  const redirects = [];
  const revalidations = [];
  let drawDraftModule = {};
  try {
    drawDraftModule = await loadModule(join(adminRoot, "lib/draw-version-draft.ts"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  class ApiError extends Error {
    constructor(status, message = "failure") {
      super(message);
      this.status = status;
      this.requestId = null;
    }
  }
  const actions = await loadModule(join(adminRoot, "lib/actions.ts"), {
    "server-only": {},
    "next/cache": { revalidatePath(path) { revalidations.push(path); } },
    "next/navigation": { redirect(path) { redirects.push(path); throw new Error(`REDIRECT:${path}`); } },
    "./api": {
      AdminApiError: ApiError,
      async adminApi(path, options) {
        apiCalls.push([path, options]);
        if (path === "/v1/admin/products" && options?.method === "POST") {
          return { id: "new-kuji", category: productCategory, isPrizeOnly: false };
        }
        if (options?.method === "POST") return { id: "draft-1" };
        return { id: "draw-product", category: productCategory };
      },
    },
    "./auth": {
      requireCapability: async () => {
        if (deny) throw new Error("DENIED");
        return { token: "admin-token" };
      },
    },
    "./request-security": { safeInternalPath: (value) => String(value || "/") },
    "./product-image-upload": { saveProductImage() { throw new Error("unused catalog image helper"); } },
    "./draw-version-draft": drawDraftModule,
  });
  return { actions, apiCalls, redirects, revalidations };
}

const base = {
  productId: "draw-product",
  returnTo: "/catalog/products/draw-product/draws",
  idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
  reason: "실물 구성 검수",
};

test("kuji action re-reads authoritative category and sends the finite sealed-deck contract", async () => {
  const { actions, apiCalls, redirects, revalidations } = await loadActions({ productCategory: "kuji" });
  const entries = [{ prizeProductId: "prize-a", rarity: "A상", quantity: 1, tierCode: "A", tierRank: 0 }];
  await assert.rejects(() => actions.createDrawVersion(form({
    ...base,
    category: "gacha",
    totalSlots: "1",
    entries: JSON.stringify(entries),
  })), /REDIRECT/);

  assert.equal(apiCalls.length, 2);
  assert.equal(apiCalls[0][0], "/v1/admin/products/draw-product");
  assert.equal(apiCalls[0][1].method, undefined);
  assert.equal(apiCalls[1][0], "/v1/admin/products/draw-product/draw-versions");
  assert.deepEqual(JSON.parse(JSON.stringify(apiCalls[1][1].body)), { totalSlots: 1, entries });
  assert.equal(apiCalls[1][1].headers["idempotency-key"], base.idempotencyKey);
  assert.equal(apiCalls[1][1].reason, base.reason);
  assert.equal(revalidations.length, 1);
  assert.match(redirects.at(-1), /success=/);
});

test("new sellable kuji continues directly to its tier configuration", async () => {
  const { actions, apiCalls, redirects } = await loadActions({ productCategory: "kuji" });
  await assert.rejects(() => actions.createProduct(form({
    returnTo: "/catalog/products",
    idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
    reason: "신규 쿠지 등록",
    sku: "KUJI-NEW",
    ipId: "ip-1",
    category: "kuji",
    name: "신규 쿠지",
    price: "9000",
    availableQuantity: "80",
    metadata: "{}",
    isActive: "on",
    saleStatus: "DRAFT",
  })), /REDIRECT/);

  assert.equal(apiCalls[0][0], "/v1/admin/products");
  assert.equal(apiCalls[0][1].body.category, "kuji");
  assert.match(redirects.at(-1), /^\/catalog\/products\/new-kuji\/draws\?/);
  assert.match(redirects.at(-1), /success=/);
});

test("draw draft helper fixes gacha weights to one and enforces finite-deck totals", async () => {
  const helper = await loadModule(join(adminRoot, "lib/draw-version-draft.ts"));
  const gacha = helper.buildDrawVersionDraftPayload("gacha", [
    { prizeProductId: "prize-a", rarity: "A", quantity: 3 },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(gacha)), {
    entries: [{ prizeProductId: "prize-a", rarity: "A", weight: 1, quantity: 3 }],
  });
  assert.throws(() => helper.buildDrawVersionDraftPayload("gacha", [
    { prizeProductId: "prize-a", rarity: "A", weight: 2, quantity: 3 },
  ]), /가중치는 1이어야/);
  assert.throws(() => helper.buildDrawVersionDraftPayload("gacha", [
    { prizeProductId: "prize-a", rarity: "A", quantity: 3, tierCode: "A", tierRank: 0 },
  ]), /tierCode/);

  const kujiEntries = [
    { prizeProductId: "prize-a", rarity: "A상", quantity: 1, tierCode: "A", tierRank: 0 },
    { prizeProductId: "prize-b", rarity: "B상", quantity: 4, tierCode: "B", tierRank: 1 },
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(helper.buildDrawVersionDraftPayload("kuji", kujiEntries, 5))), {
    totalSlots: 5,
    entries: kujiEntries,
  });
  assert.throws(() => helper.buildDrawVersionDraftPayload("kuji", kujiEntries, 6), /정확히 같아야/);
  assert.throws(() => helper.buildDrawVersionDraftPayload("kuji", [kujiEntries[0], { ...kujiEntries[1], tierCode: "A" }], 5), /tierCode가 중복/);
  assert.throws(() => helper.buildDrawVersionDraftPayload("kuji", [kujiEntries[0], { ...kujiEntries[1], tierRank: 0 }], 5), /tierRank가 중복/);
  assert.throws(() => helper.buildDrawVersionDraftPayload("kuji", [{ ...kujiEntries[0], weight: 1 }], 1), /가중치를 사용하지 않습니다/);
  assert.throws(() => helper.buildDrawVersionDraftPayload("kuji", [{ ...kujiEntries[0], tierRank: "" }], 1), /tierRank/);
  assert.throws(() => helper.buildDrawVersionDraftPayload("kuji", [{ ...kujiEntries[0], tierRank: null }], 1), /tierRank/);
  assert.throws(() => helper.buildDrawVersionDraftPayload("kuji", [{ ...kujiEntries[0], tierRank: false }], 1), /tierRank/);
  assert.throws(() => helper.buildDrawVersionDraftPayload("kuji", [{ ...kujiEntries[0], weight: 99 }], 1), /가중치를 사용하지 않습니다/);
  assert.throws(() => helper.buildDrawVersionDraftPayload("gacha", [{ prizeProductId: "prize-a", rarity: "A", quantity: 3, tierRank: 1 }]), /tierRank/);
  assert.throws(() => helper.buildDrawVersionDraftPayload("gacha", [{ prizeProductId: "prize-a", rarity: "A", quantity: 3 }], 10), /전체 장수/);
});

test("gacha action ignores browser category and preserves finite quantity entries", async () => {
  const { actions, apiCalls } = await loadActions({ productCategory: "gacha" });
  const entries = [{ prizeProductId: "prize-a", rarity: "A", weight: 1, quantity: 2 }];
  await assert.rejects(() => actions.createDrawVersion(form({
    ...base,
    category: "kuji",
    entries: JSON.stringify(entries),
  })), /REDIRECT/);
  assert.equal(apiCalls.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(apiCalls[1][1].body)), { entries });
});

test("invalid kuji totals and denied capability cannot create a draft", async () => {
  const invalid = await loadActions({ productCategory: "kuji" });
  await assert.rejects(() => invalid.actions.createDrawVersion(form({
    ...base,
    totalSlots: "2",
    entries: JSON.stringify([{ prizeProductId: "prize-a", rarity: "A상", quantity: 1, tierCode: "A", tierRank: 0 }]),
  })), /REDIRECT/);
  assert.equal(invalid.apiCalls.length, 1);
  assert.equal(invalid.apiCalls[0][0], "/v1/admin/products/draw-product");
  assert.equal(invalid.revalidations.length, 0);
  assert.doesNotMatch(invalid.redirects.at(-1), /success=/);

  const denied = await loadActions({ deny: true });
  await assert.rejects(() => denied.actions.createDrawVersion(form({
    ...base,
    totalSlots: "1",
    entries: JSON.stringify([{ prizeProductId: "prize-a", rarity: "A상", quantity: 1, tierCode: "A", tierRank: 0 }]),
  })), /DENIED/);
  assert.equal(denied.apiCalls.length, 0);
});

test("draw form renderer exposes only the fields for the authoritative product category", async () => {
  const helper = await loadModule(join(adminRoot, "lib/draw-version-draft.ts"));
  const module = await loadModule(join(adminRoot, "components/draw-version-form.tsx"), {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "../lib/actions": { createDrawVersion() {} },
    "../lib/draw-version-draft": helper,
  });
  const baseProduct = {
    id: "draw-product", sku: "DRAW-1", name: "운영 테스트", category: "kuji", ipId: "ip-1",
    imageUrl: null, availableQuantity: 5,
  };
  const prizeProducts = [{
    ...baseProduct, id: "prize-a", sku: "PRIZE-A", name: "A상", isPrizeOnly: true, category: "figure",
  }];
  const render = (category) => renderToStaticMarkup(React.createElement(module.DrawVersionForm, {
    product: { ...baseProduct, category },
    prizeProducts,
    returnTo: "/catalog/products/draw-product/draws",
    idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
  }));

  const kuji = render("kuji");
  assert.match(kuji, /name="totalSlots"/);
  assert.match(kuji, /상 이름 \(고객 카드 표시\)/);
  assert.match(kuji, /등급 코드 \(tierCode\)/);
  assert.match(kuji, /등급 순서 \(tierRank, 0부터\)/);
  assert.doesNotMatch(kuji, /기본 가중치/);

  const gacha = render("gacha");
  assert.match(gacha, />등급</);
  assert.doesNotMatch(gacha, /name="totalSlots"/);
  assert.doesNotMatch(gacha, /등급 코드 \(tierCode\)/);
  assert.doesNotMatch(gacha, /등급 순서 \(tierRank, 0부터\)/);
  assert.doesNotMatch(gacha, /기본 가중치/);
  assert.match(gacha, /확률 계산용 전체 수량/);
});
