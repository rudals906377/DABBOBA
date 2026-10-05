import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const require = createRequire(import.meta.url);
const { transformSync } = require("next/dist/build/swc");

function form(values) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const adminRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function loadModule(path, mocks) {
  const picker = path.endsWith("home-section-form.tsx") ? await loadModule(join(adminRoot, "components/home-product-picker.tsx"), {}) : null;
  const source = await readFile(path, "utf8");
  const output = transformSync(source, {
    filename: path,
    jsc: { parser: { syntax: "typescript", tsx: path.endsWith(".tsx") }, transform: { react: { runtime: "automatic" } } },
    module: { type: "commonjs" },
  }).code;
  const module = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${output}\n})`, { crypto, URL, URLSearchParams, FormData, Headers, AbortSignal })(
    (id) => {
      if (id === "react/jsx-runtime") return require("react/jsx-runtime");
      if (id === "react") return React;
      if (id === "./home-product-picker") return picker;
      if (id === "node:crypto") return require("node:crypto");
      if (id === "./draw-version-draft") return { buildDrawVersionDraftPayload() { throw new Error("unused draw draft helper"); } };
      if (id === "./product-image-upload") return { saveProductImage() { throw new Error("unused catalog image helper"); } };
      if (id in mocks) return mocks[id];
      throw new Error(`Unexpected import: ${id}`);
    }, module, module.exports,
  );
  return module.exports;
}

const ip = { id: "spy-family", nameKo: "스파이 패밀리", nameEn: "SPY×FAMILY", isActive: true };
const section = { id: "spy-home", title: "스파이 패밀리", subtitle: "가족 추천", ipId: ip.id, layoutKind: "gacha", sourceKind: "IP", visibleLimit: 8, manualProductIds: [], sortOrder: 2, isActive: true, version: 3, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z" };

test("home section form explains the admin-only rails and forces create inactive", async () => {
  const actions = [];
  const component = await loadModule(join(adminRoot, "components/home-section-form.tsx"), {
    "../lib/actions": { createHomeSection() {}, updateHomeSection() {} },
    "./operations": {
      ReturnTo: ({ value }) => React.createElement("input", { name: "returnTo", value, readOnly: true }),
      ReasonField: () => React.createElement("textarea", { name: "reason" }),
    },
  });
  const html = renderToStaticMarkup(React.createElement(component.HomeSectionForm, { ips: [ip], returnTo: "/catalog/home-sections", configured: false }));
  assert.match(html, /홈 상품 레일은 관리자 섹션으로만 구성됩니다/);
  assert.match(html, /상품 구성 기준, 카드 유형, 노출 수와 순서를 확인한 뒤/);
  assert.doesNotMatch(html, /오늘의 뽀바는 유지됩니다/);
  assert.match(html, /type="checkbox" required="" name="confirmCatalogOverride"/);
  assert.match(html, /name="isActive" value="off"/);
  assert.match(html, /name="layoutKind" required=""/);
  assert.match(html, /value="gacha">가챠/);
  assert.match(html, /value="kuji">쿠지/);
  assert.match(html, /name="sourceKind"/);
  assert.match(html, /value="MANUAL">수동 선택/);
  assert.match(html, /value="POPULAR">최근 30일 인기순/);
  assert.match(html, /name="visibleLimit"/);
  assert.match(html, /name="manualProductIds"/);
  assert.doesNotMatch(html, /name="isActive" type="checkbox"/);
  assert.equal(actions.length, 0);
});

test("legacy home sections require an explicit product type before saving", async () => {
  const component = await loadModule(join(adminRoot, "components/home-section-form.tsx"), {
    "../lib/actions": { createHomeSection() {}, updateHomeSection() {} },
    "./operations": {
      ReturnTo: ({ value }) => React.createElement("input", { name: "returnTo", value, readOnly: true }),
      ReasonField: () => React.createElement("textarea", { name: "reason" }),
    },
  });
  const html = renderToStaticMarkup(React.createElement(component.HomeSectionForm, {
    item: { ...section, layoutKind: null },
    ips: [ip],
    returnTo: "/catalog/home-sections",
    configured: true,
  }));
  assert.match(html, /상품 유형 선택 필요/);
  assert.match(html, /name="layoutKind" required=""/);
  assert.match(html, /가챠 또는 쿠지를 선택해야 변경 내용을 저장할 수 있습니다/);
});

test("home section actions reject missing confirmation and send safe mutation contracts", async () => {
  const apiCalls = [];
  const redirects = [];
  const revalidations = [];
  const actions = await loadModule(join(adminRoot, "lib/actions.ts"), {
    "server-only": {},
    "next/cache": { revalidatePath(path) { revalidations.push(path); } },
    "next/navigation": { redirect(path) { redirects.push(path); throw new Error(`REDIRECT:${path}`); } },
    "./api": { AdminApiError: class extends Error {}, adminApi: async (...args) => apiCalls.push(args) },
    "./auth": { requireCapability: async () => ({ token: "token" }) },
    "./request-security": { safeInternalPath: (value) => String(value || "/") },
  });
  const base = { returnTo: "/catalog/home-sections", idempotencyKey: "123e4567-e89b-42d3-a456-426614174000", sectionId: "spy-home", title: "스파이", subtitle: "가족 추천", ipId: "spy-family", layoutKind: "gacha", sourceKind: "IP", visibleLimit: "8", manualProductIds: "", sortOrder: "4", reason: "운영 구성" };
  await assert.rejects(() => actions.createHomeSection(form(base)), /REDIRECT/);
  assert.equal(apiCalls.length, 0);
  assert.match(redirects.at(-1), /error=.*%ED%99%88/);

  await assert.rejects(() => actions.createHomeSection(form({ ...base, confirmCatalogOverride: "on", isActive: "on" })), /REDIRECT/);
  assert.equal(apiCalls.length, 1);
  const [path, options] = apiCalls[0];
  assert.equal(path, "/v1/admin/home-sections");
  assert.deepEqual(JSON.parse(JSON.stringify(options.body)), { id: "spy-home", title: "스파이", subtitle: "가족 추천", ipId: "spy-family", layoutKind: "gacha", sourceKind: "IP", visibleLimit: 8, manualProductIds: [], sortOrder: 4, isActive: false });
  assert.equal(options.reason, "운영 구성");
  assert.equal(options.headers["idempotency-key"], base.idempotencyKey);
  assert.equal(revalidations.length, 1);
  assert.match(redirects.at(-1), /success=/);

  await assert.rejects(() => actions.updateHomeSection(form({ ...base, expectedVersion: "3", isActive: "on" })), /REDIRECT/);
  assert.equal(apiCalls[1][0], "/v1/admin/home-sections/spy-home");
  assert.deepEqual(JSON.parse(JSON.stringify(apiCalls[1][1].body)), { title: "스파이", subtitle: "가족 추천", ipId: "spy-family", layoutKind: "gacha", sourceKind: "IP", visibleLimit: 8, manualProductIds: [], sortOrder: 4, isActive: true, expectedVersion: 3 });
});

test("home section actions preserve authorization and stale-version failures", async () => {
  class ApiError extends Error { constructor(status) { super("failure"); this.status = status; this.requestId = null; } }
  const redirects = [];
  const apiCalls = [];
  const revalidations = [];
  const mocks = {
    "server-only": {}, "next/cache": { revalidatePath(path) { revalidations.push(path); } },
    "next/navigation": { redirect(path) { redirects.push(path); throw new Error(`REDIRECT:${path}`); } },
    "./api": { AdminApiError: ApiError, adminApi: async (...args) => { apiCalls.push(args); throw new ApiError(409); } },
    "./auth": { requireCapability: async () => ({ token: "token" }) },
    "./request-security": { safeInternalPath: (value) => String(value || "/") },
  };
  const actions = await loadModule(join(adminRoot, "lib/actions.ts"), mocks);
  const valid = { returnTo: "/catalog/home-sections", idempotencyKey: "123e4567-e89b-42d3-a456-426614174000", sectionId: "spy-home", title: "스파이", subtitle: "가족 추천", ipId: "spy-family", layoutKind: "kuji", sourceKind: "IP", visibleLimit: "8", manualProductIds: "", sortOrder: "4", expectedVersion: "3", reason: "운영 변경" };
  await assert.rejects(() => actions.updateHomeSection(form(valid)), /REDIRECT/);
  assert.match(redirects.at(-1), /error=.*%EC%B6%A9%EB%8F%8C/);
  assert.doesNotMatch(redirects.at(-1), /success=/);
  assert.equal(revalidations.length, 0);

  const validationCalls = [];
  const validationActions = await loadModule(join(adminRoot, "lib/actions.ts"), {
    ...mocks,
    "./api": { AdminApiError: ApiError, adminApi: async (...args) => validationCalls.push(args) },
  });

  for (const omitted of ["reason", "idempotencyKey", "expectedVersion", "layoutKind"]) {
    const invalid = { ...valid }; delete invalid[omitted];
    await assert.rejects(() => validationActions.updateHomeSection(form(invalid)), /REDIRECT/);
  }
  assert.equal(validationCalls.length, 0);

  const denied = await loadModule(join(adminRoot, "lib/actions.ts"), {
    ...mocks, "./auth": { requireCapability: async () => { throw new Error("DENIED"); } },
  });
  await assert.rejects(() => denied.updateHomeSection(form(valid)), /DENIED/);
  assert.equal(apiCalls.length, 1);
  assert.equal(revalidations.length, 0);
});

test("home section page loads complete choices and renders empty and missing-IP states", async () => {
  const calls = [];
  const pageModule = await loadModule(join(adminRoot, "app/(admin)/catalog/home-sections/page.tsx"), {
    "next/link": { __esModule: true, default: ({ children, href }) => React.createElement("a", { href }, children) },
    "../../../../components/home-product-picker": { HomeProductChoicesProvider: ({ children }) => React.createElement(React.Fragment, null, children) },
    "../../../../components/home-section-form": { HomeSectionForm: ({ item }) => React.createElement("div", null, item ? `edit:${item.id}` : "create") },
    "../../../../components/operations": {
      PageHeader: ({ title, description }) => React.createElement(React.Fragment, null,
        React.createElement("h1", null, title), React.createElement("p", null, description)), Feedback: () => null,
      FilterBar: ({ children }) => React.createElement("form", null, children),
      NextCursor: ({ nextCursor }) => React.createElement("span", null, `next:${nextCursor}`),
      EmptyState: ({ title }) => React.createElement("div", null, title),
      StatusBadge: ({ value }) => React.createElement("span", null, String(value)),
      first: (value) => Array.isArray(value) ? value[0] : value, formatDate: (value) => value,
    },
    "../../../../lib/api": {
      queryString: (values) => `?${new URLSearchParams(Object.entries(values).filter(([, value]) => value)).toString()}`,
      adminApi: async (path) => { calls.push(path); return path.includes("home-sections") ? { configured: true, items: [section] } : { items: [], nextCursor: "page-3" }; },
    },
    "../../../../lib/auth": { requireCapability: async () => ({ token: "token" }) },
    "../../../../lib/catalog-choices": { catalogIpChoices: async () => { calls.push("all-ip-choices"); return []; }, catalogProductChoices: async () => [] },
  });
  const tree = await pageModule.default({ searchParams: Promise.resolve({ q: "스파이", cursor: "page-2" }) });
  const html = renderToStaticMarkup(tree);
  assert.ok(calls.includes("all-ip-choices"));
  assert.match(html, /현재 연결된 작품/);
  assert.match(html, /가챠/);
  assert.match(html, /수동·IP·신상품·인기 기준과 가챠·쿠지 카드 레이아웃/);
  assert.doesNotMatch(html, /next:page-3/);

  calls.length = 0;
  const emptyModule = await loadModule(join(adminRoot, "app/(admin)/catalog/home-sections/page.tsx"), {
    "next/link": { __esModule: true, default: ({ children }) => React.createElement("a", null, children) },
    "../../../../components/home-product-picker": { HomeProductChoicesProvider: ({ children }) => React.createElement(React.Fragment, null, children) },
    "../../../../components/home-section-form": { HomeSectionForm: () => React.createElement("div") },
    "../../../../components/operations": { PageHeader: () => null, Feedback: () => null, FilterBar: ({ children }) => React.createElement("form", null, children), NextCursor: () => null, EmptyState: ({ title, description }) => React.createElement("div", null, title, description), StatusBadge: () => null, first: (v) => v, formatDate: (v) => v },
    "../../../../lib/api": { queryString: () => "", adminApi: async (path) => path.includes("home-sections") ? { configured: false, items: [] } : { items: [ip], nextCursor: null } },
    "../../../../lib/auth": { requireCapability: async () => ({ token: "token" }) },
    "../../../../lib/catalog-choices": { catalogIpChoices: async () => { calls.push("all-ip-choices"); return []; }, catalogProductChoices: async () => [] },
  });
  const emptyHtml = renderToStaticMarkup(await emptyModule.default({ searchParams: Promise.resolve({}) }));
  assert.match(emptyHtml, /등록된 홈 섹션이 없습니다/);
  assert.match(emptyHtml, /홈 상품 레일을 표시하려면 첫 관리자 섹션을 생성하세요/);
});
