import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const apiRequire = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { transform } = apiRequire("esbuild");

// Execute the real registration code. Only the generated application boundary
// is replaced; no server, cloud credentials, or image sanitizer is invoked.
async function registerEntry(surface, result) {
  const source = await readFile(new URL(`../supabase/functions/dabboba-${surface}/index.ts`, import.meta.url), "utf8");
  const compiled = await transform(source, { loader: "ts", format: "cjs" });
  let callback;
  let options;
  let received;
  vm.runInNewContext(compiled.code, {
    Request,
    Response,
    Deno: {
      env: { toObject: () => ({ NODE_ENV: "test" }) },
      serve: (handler) => { callback = handler; },
    },
    require: (specifier) => {
      assert.equal(specifier, "./api.generated.js");
      return {
        createSupabaseEdgeApiHandler: (input) => {
          options = input;
          return async (request, info) => {
            received = { request, info };
            return result;
          };
        },
      };
    },
  });
  assert.equal(typeof callback, "function");
  return { callback, options, received: () => received };
}

for (const surface of ["api", "admin-api"]) {
  test(`${surface} entry preserves a normal response and remote address`, async () => {
    const expected = new Response("unchanged", { status: 202, headers: { "x-entry-test": "retained" } });
    const entry = await registerEntry(surface, expected);
    const request = new Request("https://example.invalid/health");
    const response = await entry.callback(request, { remoteAddr: { hostname: "127.0.0.1" } });
    assert.equal(response, expected);
    assert.equal(entry.received().request, request);
    assert.equal(entry.received().info.remoteAddr.hostname, "127.0.0.1");
    assert.equal(entry.options.surface, surface === "admin-api" ? "admin" : undefined);
    assert.equal(response.headers.get("x-entry-test"), "retained");
  });

  test(`${surface} entry supplies an uncached 503 when the handler returns no response`, async () => {
    const entry = await registerEntry(surface, undefined);
    const response = await entry.callback(new Request("https://example.invalid/health"), { remoteAddr: {} });
    assert.ok(response instanceof Response);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-type"), /^application\/json/);
    assert.equal((await response.json()).error.code, "API_UNAVAILABLE");
  });
}
