import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { transformSync } = require("next/dist/build/swc");
const adminRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function loadApi(fetch, apiBaseUrl = "https://api.example.test", sign = () => ({})) {
  const path = join(adminRoot, "lib/api.ts");
  const source = await readFile(path, "utf8");
  const output = transformSync(source, {
    filename: path,
    jsc: { parser: { syntax: "typescript" } },
    module: { type: "commonjs" },
  }).code;
  const module = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${output}\n})`, {
    AbortSignal, Headers, URL, URLSearchParams, crypto, fetch,
    process: { env: { DABBOBA_ADMIN_SERVICE_SECRET: "fixture-admin-service-secret-1234567890" } },
  })((id) => {
    if (id === "server-only") return {};
    if (id === "@dabboba/api-client") return { errorMessage: () => "error" };
    if (id === "@dabboba/config") return { signAdminServiceRequest: sign };
    if (id === "./config") return { getAdminConfig: () => ({ apiBaseUrl }) };
    throw new Error(`Unexpected import: ${id}`);
  }, module, module.exports);
  return module.exports;
}

function okResponse() {
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
}

test("admin API percent-encodes Korean reasons while preserving legacy ASCII headers", async () => {
  const requests = [];
  const api = await loadApi(async (_url, init) => {
    requests.push(init);
    return okResponse();
  });

  const korean = "상품 가격 수정 사유";
  await api.adminApi("/v1/admin/products/product-1", { reason: korean });
  assert.equal(requests[0].headers.get("x-admin-reason"), encodeURIComponent(korean));
  assert.equal(requests[0].headers.get("x-admin-reason-encoding"), "utf-8-percent");
  assert.match(requests[0].headers.get("x-admin-reason"), /^[\x20-\x7e]+$/);

  await api.adminApi("/v1/admin/products/product-1", { reason: "catalog price correction" });
  assert.equal(requests[1].headers.get("x-admin-reason"), "catalog price correction");
  assert.equal(requests[1].headers.get("x-admin-reason-encoding"), null);
});

test("admin API safely transports control characters for server-side rejection", async () => {
  const requests = [];
  const api = await loadApi(async (_url, init) => {
    requests.push(init);
    return okResponse();
  });
  await api.adminApi("/v1/admin/products/product-1", { reason: "줄바꿈\n거절" });
  assert.equal(requests[0].headers.get("x-admin-reason"), encodeURIComponent("줄바꿈\n거절"));
  assert.equal(requests[0].headers.get("x-admin-reason-encoding"), "utf-8-percent");
});

test("admin API preserves configured function path prefixes and origin-only compatibility", async () => {
  const urls = [];
  const prefixed = await loadApi(async (url) => {
    urls.push(String(url));
    return okResponse();
  }, "https://project.supabase.co/functions/v1/dabboba-admin");
  await prefixed.adminApi("/v1/admin/products/product-1");
  assert.equal(urls[0], "https://project.supabase.co/functions/v1/dabboba-admin/v1/admin/products/product-1");

  const origin = await loadApi(async (url) => {
    urls.push(String(url));
    return okResponse();
  }, "https://api.example.test");
  await origin.adminApi("/v1/admin/products/product-1");
  assert.equal(urls[1], "https://api.example.test/v1/admin/products/product-1");
});

test("admin API signs the canonical route and rejects redirects without following them", async () => {
  const signatures = [];
  const requests = [];
  const api = await loadApi(async (_url, init) => {
    requests.push(init);
    return new Response(null, { status: 302, headers: { location: "https://unexpected.example.test/" } });
  }, "https://project.supabase.co/functions/v1/dabboba-admin-api", (input) => {
    signatures.push(input);
    return {};
  });
  await assert.rejects(api.adminApi("/v1/admin/products?limit=30"), (error) => error.status === 502);
  assert.equal(requests[0].redirect, "manual");
  assert.equal(signatures[0].path, "/v1/admin/products?limit=30");
});
