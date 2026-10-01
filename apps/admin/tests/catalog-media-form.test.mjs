import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const { transformSync } = require("next/dist/build/swc");
const adminRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function loadModule(path, mocks = {}, context = {}) {
  const source = await readFile(path, "utf8");
  const output = transformSync(source, {
    filename: path,
    jsc: { parser: { syntax: "typescript", tsx: path.endsWith(".tsx") }, transform: { react: { runtime: "automatic" } } },
    module: { type: "commonjs" },
  }).code;
  const module = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${output}\n})`, {
    AbortSignal, Blob, Buffer, Error, File, FormData, Headers, Request, Response, URL, URLSearchParams, crypto, process, ...context,
  })((id) => {
    if (id === "server-only") return {};
    if (id === "node:crypto") return require("node:crypto");
    if (id === "react") return React;
    if (id === "react/jsx-runtime") return require("react/jsx-runtime");
    if (id in mocks) return mocks[id];
    throw new Error(`Unexpected import: ${id}`);
  }, module, module.exports);
  return module.exports;
}

async function loadCropPicker() {
  return loadModule(join(adminRoot, "components/image-crop-picker.tsx"), {
    "../lib/actions": { uploadProductImage() {} },
    "../lib/image-crop-geometry": { imageCropRect() { throw new Error("rendering must not crop before selection"); } },
  });
}

function form(file, overrides = {}) {
  const data = new FormData();
  const values = {
    productId: "product-1",
    expectedVersion: "7",
    returnTo: "/catalog/products?q=test",
    reason: "상품 대표 사진 교체",
    idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
    completeIdempotencyKey: "223e4567-e89b-42d3-a456-426614174000",
    attachIdempotencyKey: "323e4567-e89b-42d3-a456-426614174000",
    role: "primary",
    ...overrides,
  };
  for (const [name, value] of Object.entries(values)) data.set(name, value);
  if (file) data.set("image", file);
  return data;
}

async function loadActions({ apiFailure, deny = false } = {}) {
  const uploads = [];
  const apiCalls = [];
  const redirects = [];
  const revalidations = [];
  const helper = await loadModule(join(adminRoot, "lib/catalog-media-upload.ts"), {}, {
    fetch: async (url, init) => {
      uploads.push([String(url), init]);
      return new Response(null, { status: 200 });
    },
  });
  class ApiError extends Error {
    constructor(status) { super("api failure"); this.status = status; this.requestId = null; }
  }
  const mocks = {
    "server-only": {},
    "next/cache": { revalidatePath(path) { revalidations.push(path); } },
    "next/navigation": { redirect(path) { redirects.push(path); throw new Error(`REDIRECT:${path}`); } },
    "./api": {
      AdminApiError: ApiError,
      async adminApi(path, options) {
        apiCalls.push([path, options]);
        if (apiFailure?.path === path) throw new ApiError(apiFailure.status);
        if (path === "/v1/admin/catalog-media/uploads") return {
          mediaId: "123e4567-e89b-42d3-a456-426614174001",
          uploadUrl: "https://storage.example.test/catalog-object",
          method: "PUT",
          bodyEncoding: "raw",
          headers: { "content-type": "image/png", "content-length": "4", "x-upload-token": "signed" },
          expiresAt: "2099-01-01T00:00:00.000Z",
          maxBytes: 4,
        };
        if (path.endsWith("/complete")) return { mediaId: "123e4567-e89b-42d3-a456-426614174001", status: "READY", mimeType: "image/webp" };
        return {
          productId: "product-1",
          imageUrl: "/v1/catalog/media/123/image",
          version: 8,
          mediaId: "123e4567-e89b-42d3-a456-426614174001",
          role: options.body.role,
        };
      },
    },
    "./auth": { requireCapability: async () => { if (deny) throw new Error("DENIED"); return { token: "admin-token" }; } },
    "./request-security": { safeInternalPath: (value) => String(value || "/") },
    "./draw-version-draft": { buildDrawVersionDraftPayload() { throw new Error("unused draw helper"); } },
  };
  mocks["./product-image-upload"] = await loadModule(join(adminRoot, "lib/product-image-upload.ts"), {
    "./api": mocks["./api"], "./catalog-media-upload": helper,
  });
  const actions = await loadModule(join(adminRoot, "lib/actions.ts"), mocks);
  return { actions, apiCalls, uploads, redirects, revalidations, productImages: mocks["./product-image-upload"] };
}

test("product image action uploads, completes, and attaches only the image with fresh idempotency keys", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const file = new File([bytes], "대표 사진.png", { type: "image/png" });
  const run = await loadActions();
  await assert.rejects(() => run.actions.uploadProductImage(form(file)), /REDIRECT/);

  assert.equal(run.apiCalls.length, 3);
  const [intentPath, intentOptions] = run.apiCalls[0];
  assert.equal(intentPath, "/v1/admin/catalog-media/uploads");
  assert.deepEqual(JSON.parse(JSON.stringify(intentOptions.body)), {
    filename: "대표 사진.png", mimeType: "image/png", byteSize: 4,
    checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    acceptedUploadMethods: ["POST", "PUT"],
  });
  assert.equal(intentOptions.body.purpose, undefined);
  assert.equal(intentOptions.headers["idempotency-key"], "123e4567-e89b-42d3-a456-426614174000");
  assert.equal(run.uploads.length, 1);
  assert.equal(run.uploads[0][0], "https://storage.example.test/catalog-object");
  assert.equal(run.uploads[0][1].method, "PUT");
  assert.equal(run.uploads[0][1].body.constructor.name, "Uint8Array");
  assert.deepEqual(Array.from(run.uploads[0][1].body), Array.from(bytes));
  assert.equal(run.uploads[0][1].redirect, "manual");
  assert.equal(run.uploads[0][1].credentials, "omit");

  assert.equal(run.apiCalls[1][0], "/v1/admin/catalog-media/123e4567-e89b-42d3-a456-426614174001/complete");
  assert.equal(run.apiCalls[1][1].headers["idempotency-key"], "223e4567-e89b-42d3-a456-426614174000");
  assert.equal(run.apiCalls[2][0], "/v1/admin/products/product-1/image");
  assert.equal(run.apiCalls[2][1].headers["idempotency-key"], "323e4567-e89b-42d3-a456-426614174000");
  assert.deepEqual(JSON.parse(JSON.stringify(run.apiCalls[2][1].body)), {
    mediaId: "123e4567-e89b-42d3-a456-426614174001", expectedVersion: 7, role: "primary",
  });
  assert.equal(run.revalidations.length, 1);
  assert.match(run.redirects.at(-1), /success=/);
});

test("product image action forwards the storefront role to the atomic attach", async () => {
  const file = new File([new Uint8Array([1, 2, 3, 4])], "목록 사진.png", { type: "image/png" });
  const run = await loadActions();
  await assert.rejects(() => run.actions.uploadProductImage(form(file, { role: "storefront" })), /REDIRECT/);

  assert.equal(run.apiCalls.length, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(run.apiCalls[2][1].body)), {
    mediaId: "123e4567-e89b-42d3-a456-426614174001", expectedVersion: 7, role: "storefront",
  });
});

test("product image action forwards gallery role without replacing the primary image", async () => {
  const file = new File([new Uint8Array([1, 2, 3, 4])], "상세 사진.png", { type: "image/png" });
  const run = await loadActions();
  await assert.rejects(() => run.actions.uploadProductImage(form(file, { role: "gallery" })), /REDIRECT/);
  assert.deepEqual(JSON.parse(JSON.stringify(run.apiCalls[2][1].body)), {
    mediaId: "123e4567-e89b-42d3-a456-426614174001", expectedVersion: 7, role: "gallery",
  });
});

async function loadUploadRoute({ noSession = false, deny = false, apiFailure } = {}) {
  const run = await loadActions({ apiFailure });
  const originHelper = await loadModule(join(adminRoot, "lib/request-origin.ts"));
  const security = await loadModule(join(adminRoot, "lib/request-security.ts"), {
    "@dabboba/config": {}, "next/server": { NextResponse: Response }, "./request-origin": originHelper,
  });
  const bodyHelper = await loadModule(join(adminRoot, "lib/catalog-upload-body.ts"));
  let sessionReads = 0;
  const route = await loadModule(join(adminRoot, "app/api/catalog/images/route.ts"), {
    "next/cache": { revalidatePath(path) { run.revalidations.push(path); } },
    "../../../../lib/auth": { getAdminSession: async () => {
      sessionReads += 1;
      return noSession ? null : { token: "admin-token", actor: { status: "ACTIVE", role: "SUPER_ADMIN", permissions: deny ? [] : ["catalog.read", "catalog.write"] } };
    } },
    "../../../../lib/capabilities": await loadModule(join(adminRoot, "lib/capabilities.ts")),
    "../../../../lib/catalog-upload-body": bodyHelper,
    "../../../../lib/product-image-upload": run.productImages,
    "../../../../lib/request-security": security,
    "../../../../lib/request-origin": originHelper,
  });
  return { ...run, route, bodyHelper, sessionReads: () => sessionReads };
}

function uploadRequest(data, headers = {}) {
  return new Request("https://admin.dabboba.net/api/catalog/images", {
    method: "POST", body: data,
    headers: { host: "admin.dabboba.net", origin: "https://admin.dabboba.net", "sec-fetch-site": "same-origin", ...headers },
  });
}

test("native upload route preserves gallery completion, version, audit reason and 303 redirect", async () => {
  const run = await loadUploadRoute();
  const response = await run.route.POST(uploadRequest(form(new File([new Uint8Array([1, 2, 3, 4])], "3.jpg", { type: "image/jpeg" }), { role: "gallery" })));
  assert.equal(response.status, 303);
  assert.match(response.headers.get("location"), /^\/catalog\/products\?q=test&success=/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(run.apiCalls.length, 3);
  assert.equal(run.apiCalls[2][1].body.role, "gallery");
  assert.equal(run.apiCalls[2][1].body.expectedVersion, 7);
  assert.equal(run.apiCalls[2][1].reason, "상품 대표 사진 교체");
  assert.deepEqual(run.revalidations, ["/catalog/products"]);
});

test("upload route fails closed for cross-origin, absent Origin, missing session and missing capability", async () => {
  for (const headers of [{ origin: "https://attacker.example" }, { origin: "" }, { origin: "null" }, { "sec-fetch-site": "same-site" }, { origin: "http://admin.dabboba.net" }]) {
    const run = await loadUploadRoute();
    const response = await run.route.POST(uploadRequest(form(null), headers));
    assert.equal(response.status, 403);
    assert.equal(run.sessionReads(), 0);
    assert.equal(run.apiCalls.length, 0);
  }
  const anonymous = await loadUploadRoute({ noSession: true });
  const login = await anonymous.route.POST(uploadRequest(form(null)));
  assert.equal(login.status, 303);
  assert.match(login.headers.get("location"), /^\/login\?/);
  assert.equal(anonymous.apiCalls.length, 0);
  const denied = await loadUploadRoute({ deny: true });
  assert.equal((await denied.route.POST(uploadRequest(form(null)))).status, 403);
  assert.equal(denied.apiCalls.length, 0);
});

test("upload rejects invalid file, missing reason, malformed keys and repeated fields before intent", async () => {
  for (const overrides of [{ reason: "x" }, { attachIdempotencyKey: "invalid" }, { expectedVersion: "0" }, { role: "unknown" }]) {
    const run = await loadUploadRoute();
    const response = await run.route.POST(uploadRequest(form(new File(["abcd"], "3.jpg", { type: "image/jpeg" }), overrides)));
    assert.match(response.headers.get("location"), /error=/);
    assert.equal(run.apiCalls.length, 0);
  }
  for (const data of [form(new File(["abcd"], "script.svg", { type: "image/svg+xml" })), form(new File([], "empty.jpg", { type: "image/jpeg" }))]) {
    const run = await loadUploadRoute();
    const response = await run.route.POST(uploadRequest(data));
    assert.match(response.headers.get("location"), /error=/);
    assert.equal(run.apiCalls.length, 0);
  }
  const run = await loadUploadRoute();
  const duplicate = form(new File(["abcd"], "3.jpg", { type: "image/jpeg" }));
  duplicate.append("productId", "other-product");
  assert.match((await run.route.POST(uploadRequest(duplicate))).headers.get("location"), /error=/);
  assert.equal(run.apiCalls.length, 0);
});

test("upload route has no open redirect or false success on stale attachment", async () => {
  const run = await loadUploadRoute({ apiFailure: { path: "/v1/admin/products/product-1/image", status: 409 } });
  const response = await run.route.POST(uploadRequest(form(new File(["abcd"], "3.jpg", { type: "image/jpeg" }), { returnTo: "https://attacker.example" })));
  assert.equal(response.status, 303);
  assert.match(response.headers.get("location"), /^\/catalog\/products\?error=/);
  assert.doesNotMatch(response.headers.get("location"), /success=|attacker/);
  assert.equal(run.revalidations.length, 0);
  assert.equal(run.productImages.productImageError(new Error("secret-storage-url")), "상품 사진을 저장하지 못했습니다.");
});

test("multipart body limit rejects declared and streamed oversize and unsupported bodies", async () => {
  const { bodyHelper } = await loadUploadRoute();
  const size = bodyHelper.MAX_CATALOG_UPLOAD_BODY_BYTES;
  const request = uploadRequest(form(null), { "content-length": String(size + 1) });
  await assert.rejects(() => bodyHelper.catalogUploadForm(request), (error) => error.status === 413);
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(size + 1)); }, cancel() { cancelled = true; } });
  await assert.rejects(() => bodyHelper.catalogUploadForm(new Request("https://admin.dabboba.net/api/catalog/images", {
    method: "POST", body: stream, duplex: "half", headers: { "content-type": "multipart/form-data; boundary=test", "content-length": "1" },
  })), (error) => error.status === 413);
  assert.equal(cancelled, true);
  await assert.rejects(() => bodyHelper.catalogUploadForm(new Request("https://admin.dabboba.net/api/catalog/images", {
    method: "POST", body: "{}", headers: { "content-type": "application/json" },
  })), (error) => error.status === 415);
});

test("gallery image clear action removes one selected slide with confirmation", async () => {
  const run = await loadActions();
  await assert.rejects(() => run.actions.clearGalleryProductImage(form(null, {
    imageUrl: "https://cdn.example.test/gallery-2.webp",
    reason: "잘못 등록한 상세 사진 제거",
    confirmGalleryImageClear: "on",
  })), /REDIRECT/);
  assert.equal(run.apiCalls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(run.apiCalls[0][1].body)), {
    expectedVersion: 7, role: "gallery", imageUrl: "https://cdn.example.test/gallery-2.webp",
  });

  const denied = await loadActions();
  await assert.rejects(() => denied.actions.clearGalleryProductImage(form(null, {
    imageUrl: "https://cdn.example.test/gallery-2.webp",
    reason: "잘못 등록한 상세 사진 제거",
  })), /REDIRECT/);
  assert.equal(denied.apiCalls.length, 0);
});

test("storefront image clear action is confirmed and sends only the protected storefront role", async () => {
  const run = await loadActions();
  await assert.rejects(() => run.actions.clearStorefrontProductImage(form(null, {
    role: "storefront",
    reason: "목록 사진 교체 전 연결 해제",
    confirmStorefrontImageClear: "on",
  })), /REDIRECT/);

  assert.equal(run.apiCalls.length, 1);
  assert.equal(run.apiCalls[0][0], "/v1/admin/products/product-1/image");
  assert.equal(run.apiCalls[0][1].method, "DELETE");
  assert.equal(run.apiCalls[0][1].headers["idempotency-key"], "123e4567-e89b-42d3-a456-426614174000");
  assert.deepEqual(JSON.parse(JSON.stringify(run.apiCalls[0][1].body)), {
    expectedVersion: 7,
    role: "storefront",
  });
  assert.equal(run.revalidations.length, 1);
  assert.match(run.redirects.at(-1), /success=/);

  const unconfirmed = await loadActions();
  await assert.rejects(() => unconfirmed.actions.clearStorefrontProductImage(form(null, {
    role: "storefront",
    reason: "목록 사진 연결 해제",
  })), /REDIRECT/);
  assert.equal(unconfirmed.apiCalls.length, 0);
  assert.equal(unconfirmed.revalidations.length, 0);
  assert.match(unconfirmed.redirects.at(-1), /error=/);

  const primaryRole = await loadActions();
  await assert.rejects(() => primaryRole.actions.clearStorefrontProductImage(form(null, {
    role: "primary",
    reason: "대표 사진은 연결 해제 금지",
    confirmStorefrontImageClear: "on",
  })), /REDIRECT/);
  assert.equal(primaryRole.apiCalls.length, 0);
  assert.equal(primaryRole.revalidations.length, 0);
  assert.match(primaryRole.redirects.at(-1), /error=/);
});

test("catalog image transport follows multipart POST fields and rejects mismatched or invalid files", async () => {
  const uploads = [];
  const helper = await loadModule(join(adminRoot, "lib/catalog-media-upload.ts"), {}, {
    fetch: async (url, init) => { uploads.push([String(url), init]); return new Response(null, { status: 204 }); },
  });
  const file = new File([new Uint8Array([1, 2])], "photo.jpg", { type: "image/jpeg" });
  await helper.uploadCatalogImage({
    mediaId: "123e4567-e89b-42d3-a456-426614174001", uploadUrl: "https://storage.example.test/post",
    method: "POST", fields: { policy: "signed-policy" }, fileFieldName: "file",
    expiresAt: "2099-01-01T00:00:00.000Z", maxBytes: 2,
  }, file);
  assert.equal(uploads[0][1].method, "POST");
  assert.equal(uploads[0][1].redirect, "manual");
  assert.equal(uploads[0][1].body.get("policy"), "signed-policy");
  const postedFile = uploads[0][1].body.get("file");
  assert.equal(postedFile.name, file.name);
  assert.equal(postedFile.size, file.size);
  assert.equal(postedFile.type, file.type);
  await helper.uploadCatalogImage({
    mediaId: "123e4567-e89b-42d3-a456-426614174002", uploadUrl: "https://storage.example.test/put",
    method: "PUT", bodyEncoding: "raw", headers: { "content-length": "2" },
    expiresAt: "2099-01-01T00:00:00.000Z", maxBytes: 2,
  }, file);
  assert.equal(uploads[1][1].method, "PUT");
  assert.equal(uploads[1][1].headers["content-length"], undefined);
  assert.equal(uploads[1][1].body.constructor.name, "Uint8Array");
  assert.deepEqual(Array.from(uploads[1][1].body), [1, 2]);
  assert.throws(() => helper.catalogImageFile(new File([], "empty.png", { type: "image/png" })), /10MB 이하/);
  assert.throws(() => helper.catalogImageFile(new File(["x"], "script.svg", { type: "image/svg+xml" })), /JPG, PNG/);
  await assert.rejects(() => helper.uploadCatalogImage({
    mediaId: "123e4567-e89b-42d3-a456-426614174001", uploadUrl: "https://storage.example.test/put",
    method: "PUT", bodyEncoding: "raw", headers: {}, expiresAt: "2099-01-01T00:00:00.000Z", maxBytes: 3,
  }, file), /파일 정보와 일치/);
});

test("product image action cannot fake success on capability, storage, or stale attach failures", async () => {
  const file = new File([new Uint8Array([1, 2, 3, 4])], "photo.png", { type: "image/png" });
  const denied = await loadActions({ deny: true });
  await assert.rejects(() => denied.actions.uploadProductImage(form(file)), /DENIED/);
  assert.equal(denied.apiCalls.length, 0);
  assert.equal(denied.uploads.length, 0);

  const unavailable = await loadActions({ apiFailure: { path: "/v1/admin/catalog-media/uploads", status: 503 } });
  await assert.rejects(() => unavailable.actions.uploadProductImage(form(file)), /REDIRECT/);
  assert.equal(unavailable.uploads.length, 0);
  assert.equal(unavailable.revalidations.length, 0);
  assert.match(unavailable.redirects.at(-1), /error=.*%EC%83%81%ED%92%88/);
  assert.doesNotMatch(unavailable.redirects.at(-1), /success=/);

  const expired = await loadActions({ apiFailure: { path: "/v1/admin/catalog-media/123e4567-e89b-42d3-a456-426614174001/complete", status: 410 } });
  await assert.rejects(() => expired.actions.uploadProductImage(form(file)), /REDIRECT/);
  assert.equal(expired.revalidations.length, 0);
  assert.match(expired.redirects.at(-1), /error=.*%EB%A7%8C%EB%A3%8C/);

  const stale = await loadActions({ apiFailure: { path: "/v1/admin/products/product-1/image", status: 409 } });
  await assert.rejects(() => stale.actions.uploadProductImage(form(file)), /REDIRECT/);
  assert.equal(stale.apiCalls.length, 3);
  assert.equal(stale.revalidations.length, 0);
  assert.doesNotMatch(stale.redirects.at(-1), /success=/);
});

test("product image form uses a dedicated native multipart upload, not React action serialization", async () => {
  const module = await loadModule(join(adminRoot, "components/catalog-forms.tsx"), {
    "./image-crop-picker": await loadCropPicker(),
    "../lib/actions": {
      clearGalleryProductImage() {}, clearStorefrontProductImage() {}, createCharacter() {}, createIp() {}, createProduct() {}, updateCharacter() {}, updateIp() {}, updateProduct() {}, uploadProductImage() {},
    },
    "./operations": {
      ReturnTo: ({ value }) => React.createElement(React.Fragment, null,
        React.createElement("input", { type: "hidden", name: "returnTo", value, readOnly: true }),
        React.createElement("input", { type: "hidden", name: "idempotencyKey", value: "intent-key", readOnly: true })),
      ReasonField: ({ label }) => React.createElement("label", null, label, React.createElement("textarea", { name: "reason" })),
      safeExternalUrl: (value) => /^https?:\/\//.test(String(value || "")) ? String(value) : null,
    },
  });
  const html = renderToStaticMarkup(React.createElement(module.ProductImageForm, {
    item: {
      id: "product-1",
      version: 7,
      category: "gacha",
      imageUrl: "https://cdn.example.test/primary.webp",
      storefrontImageUrl: "https://cdn.example.test/storefront.webp",
    },
    returnTo: "/catalog/products",
  }));
  assert.equal((html.match(/type="file"/g) || []).length, 3);
  assert.equal((html.match(/action="\/api\/catalog\/images"/g) || []).length, 3);
  assert.equal((html.match(/method="post"/g) || []).length, 3);
  assert.equal((html.match(/encType="multipart\/form-data"/g) || []).length, 3);
  const uploadForms = html.match(/<form class="stack-form catalog-image-form catalog-crop-picker"[\s\S]*?<\/form>/g);
  assert.equal(uploadForms.length, 3);
  for (const uploadForm of uploadForms) assert.doesNotMatch(uploadForm, /\$ACTION_|javascript:throw/);
  assert.match(html, /accept="image\/jpeg,image\/png,image\/webp,image\/gif"/);
  assert.match(html, /name="expectedVersion" value="7"/);
  assert.match(html, /name="role" value="primary"/);
  assert.match(html, /name="role" value="storefront"/);
  assert.match(html, /name="role" value="gallery"/);
  assert.match(html, /정확한 1:1 비율/);
  assert.match(html, /최소 1080×1080px/);
  assert.match(html, /원본 비율로 전체 사진을 유지하거나 6:5·4:3·1:1로 자르기/);
  assert.match(html, /data-crop-confirmed="false"/);
  assert.match(html, /class="primary" disabled=""/);
  assert.match(html, /현재 대표 사진/);
  assert.match(html, /현재 목록 사진/);
  assert.equal((html.match(/data-image-status="populated"/g) || []).length, 2);
  assert.equal((html.match(/<img /g) || []).length, 2);
  assert.match(html, /href="https:\/\/cdn\.example\.test\/storefront\.webp"/);
  assert.match(html, /type="checkbox" required="" name="confirmStorefrontImageClear"/);
  assert.match(html, /목록 카드와의 연결만 해제합니다/);
  assert.match(html, /대표 사진과 업로드된 파일은 삭제되지 않습니다/);
  assert.match(html, /class="danger">목록 사진 연결 해제/);
  assert.doesNotMatch(html, /name="imageUrl"/);
});

test("product image form hides the clear action when no storefront image exists and never links unsafe URLs", async () => {
  const module = await loadModule(join(adminRoot, "components/catalog-forms.tsx"), {
    "./image-crop-picker": await loadCropPicker(),
    "../lib/actions": {
      clearGalleryProductImage() {}, clearStorefrontProductImage() {}, createCharacter() {}, createIp() {}, createProduct() {}, updateCharacter() {}, updateIp() {}, updateProduct() {}, uploadProductImage() {},
    },
    "./operations": {
      ReturnTo: () => null,
      ReasonField: () => null,
      safeExternalUrl: () => null,
    },
  });
  const html = renderToStaticMarkup(React.createElement(module.ProductImageForm, {
    item: {
      id: "product-1",
      version: 7,
      category: "kuji",
      imageUrl: "javascript:alert(1)",
      storefrontImageUrl: null,
    },
    returnTo: "/catalog/products",
  }));

  assert.match(html, /현재 URL은 안전하게 미리 볼 수 없습니다/);
  assert.match(html, /현재 목록 사진<\/strong><p>등록되지 않음/);
  assert.match(html, /정확한 16:9 비율/);
  assert.doesNotMatch(html, /(?:src|href)="javascript:/);
  assert.doesNotMatch(html, /name="confirmStorefrontImageClear"/);
  assert.doesNotMatch(html, /class="danger"/);
});

test("admin form shows an ordered three-photo gallery and per-photo removal", async () => {
  const module = await loadModule(join(adminRoot, "components/catalog-forms.tsx"), {
    "./image-crop-picker": await loadCropPicker(),
    "../lib/actions": {
      clearGalleryProductImage() {}, clearStorefrontProductImage() {}, createCharacter() {}, createIp() {}, createProduct() {}, updateCharacter() {}, updateIp() {}, updateProduct() {}, uploadProductImage() {},
    },
    "./operations": {
      ReturnTo: () => null,
      ReasonField: () => null,
      safeExternalUrl: (value) => /^https?:\/\//.test(String(value || "")) ? String(value) : null,
    },
  });
  const html = renderToStaticMarkup(React.createElement(module.ProductImageForm, {
    item: {
      id: "gacha-sylvanian-adventure",
      version: 7,
      category: "gacha",
      imageUrl: "https://cdn.example.test/primary.webp",
      storefrontImageUrl: null,
      metadata: { detailGalleryImageUrls: ["https://cdn.example.test/1.webp", "https://cdn.example.test/2.webp", "https://cdn.example.test/3.webp"] },
    },
    returnTo: "/catalog/products",
  }));
  assert.match(html, /상세 슬라이드 1/);
  assert.match(html, /상세 슬라이드 2/);
  assert.match(html, /상세 슬라이드 3/);
  assert.equal((html.match(/name="confirmGalleryImageClear"/g) || []).length, 3);
  assert.match(html, /name="role" value="gallery"/);
  assert.equal((html.match(/type="file"/g) || []).length, 3);
});

test("IP form identifies its image as the Home popular-work square artwork", async () => {
  const module = await loadModule(join(adminRoot, "components/catalog-forms.tsx"), {
    "./image-crop-picker": await loadCropPicker(),
    "../lib/actions": {
      clearGalleryProductImage() {}, clearStorefrontProductImage() {}, createCharacter() {}, createIp() {}, createProduct() {}, updateCharacter() {}, updateIp() {}, updateProduct() {}, uploadProductImage() {},
    },
    "./operations": {
      ReturnTo: () => null,
      ReasonField: () => null,
      safeExternalUrl: () => null,
    },
  });
  const html = renderToStaticMarkup(React.createElement(module.IpForm, { returnTo: "/catalog/ips" }));
  assert.match(html, /홈 인기 작품용 1:1 대표 이미지 URL/);
  assert.match(html, /정사각형 IP 이미지/);
  const productHtml = renderToStaticMarkup(React.createElement(module.ProductForm, { returnTo: "/catalog/products" }));
  assert.match(productHtml, /상품 등록 후 ‘사진 관리’에서 직접 잘라/);
  assert.doesNotMatch(productHtml, /name="imageUrl"/);
  const characterHtml = renderToStaticMarkup(React.createElement(module.CharacterForm, { returnTo: "/catalog/characters" }));
  assert.match(characterHtml, /캐릭터 이미지는 외부 URL만 연결할 수 있습니다/);
  assert.doesNotMatch(characterHtml, /상품을 등록한 뒤/);
});

test("crop geometry keeps the selected aspect ratio and shifts within the original image", async () => {
  const { imageCropRect } = await loadModule(join(adminRoot, "lib/image-crop-geometry.ts"));
  assert.deepEqual(JSON.parse(JSON.stringify(imageCropRect(1200, 1000, 6 / 5, 1, 50, 50))), {
    x: 0, y: 0, width: 1200, height: 1000,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(imageCropRect(2000, 1000, 1, 2, 100, 0))), {
    x: 1500, y: 0, width: 500, height: 500,
  });
  const portrait = imageCropRect(1000, 2000, 16 / 9, 1, 50, 100);
  assert.equal(Math.round(portrait.width / portrait.height * 100), Math.round(16 / 9 * 100));
  assert.equal(portrait.y + portrait.height, 2000);
  assert.throws(() => imageCropRect(0, 1000, 1, 1, 50, 50), /올바르지/);
  assert.throws(() => imageCropRect(1000, 1000, 1, 0.5, 50, 50), /올바르지/);
});
