import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const requireFromMobile = createRequire(new URL("../apps/mobile/package.json", import.meta.url));
const ts = requireFromMobile("typescript");

test("stalled server draw consumption aborts and can be retried with the same entitlement key", async () => {
  const source = await read("apps/mobile/src/features/draw/draw-reveal-api.ts");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: "draw-reveal-api.ts",
  }).outputText;
  const module = { exports: {} };
  const timers = [];
  const calls = [];
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    AbortController,
    setTimeout(callback, duration) {
      const timer = { callback, duration, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) { timer.cleared = true; },
    require(specifier) {
      if (specifier === "expo-crypto") return { randomUUID: () => "request-id" };
      if (specifier === "@dabboba/api-client") return { errorMessage: () => "server error" };
      if (specifier === "@/lib/mobile-api-client") return {
        createMobileDabbobaClient: () => ({
          POST(_path, options) {
            calls.push(options);
            if (calls.length > 1) return Promise.resolve({ data: { id: "committed-result" } });
            return new Promise((_resolve, reject) => {
              options.signal?.addEventListener("abort", () => reject(new Error("aborted")));
            });
          },
        }),
      };
      throw new Error(`Unexpected dependency: ${specifier}`);
    },
  });

  const first = module.exports.consumeDrawEntitlement("https://api.example", "token", "entitlement-a");
  for (let step = 0; step < 10 && calls.length === 0; step += 1) await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.ok(calls[0].signal instanceof AbortSignal);
  assert.equal(timers[0].duration, 15_000);
  timers[0].callback();
  await assert.rejects(first, /확정된 결과를 다시 확인/);
  assert.equal(timers[0].cleared, true);

  const second = await module.exports.consumeDrawEntitlement("https://api.example", "token", "entitlement-a");
  assert.equal(second.id, "committed-result");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].params.header["Idempotency-Key"], calls[1].params.header["Idempotency-Key"]);
  assert.equal(timers[1].cleared, true);
});

test("post-commit catalog lookup has a deadline and cannot wait forever before result display", async () => {
  const [screen, shop, snapshotSource] = await Promise.all([
    read("apps/mobile/src/features/draw/DrawRevealScreen.tsx"),
    read("apps/mobile/src/features/shop/shop-api.ts"),
    read("apps/mobile/src/features/draw/draw-product-snapshot.ts"),
  ]);
  const single = screen.slice(screen.indexOf("  const openProduct = async () => {"), screen.indexOf("  const handleRevealSettled = () => {"));
  const batch = screen.slice(screen.indexOf("  const openAllProducts = async () => {"), screen.indexOf("  const openProduct = async () => {"));
  assert.match(single, /await fetchCommittedDrawProductSnapshot\(/);
  assert.match(batch, /await fetchCommittedDrawProductSnapshot\(/);
  assert.match(snapshotSource, /setTimeout\(\(\) => controller\.abort\(\), 4_000\)/);
  assert.match(shop, /signal\?: AbortSignal/);

  const output = ts.transpileModule(snapshotSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: "draw-product-snapshot.ts",
  }).outputText;
  const module = { exports: {} };
  const timers = [];
  let signal;
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    AbortController,
    setTimeout(callback, duration) {
      const timer = { callback, duration, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) { timer.cleared = true; },
    require(specifier) {
      if (specifier === "@/features/shop/shop-api") return {
        fetchProductDetail(_apiBaseUrl, _productId, _accessToken, context) {
          signal = context.signal;
          return new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("aborted")));
          });
        },
      };
      throw new Error(`Unexpected dependency: ${specifier}`);
    },
  });
  const pending = module.exports.fetchCommittedDrawProductSnapshot("https://api.example", "product-a", "token");
  assert.ok(signal instanceof AbortSignal);
  assert.equal(timers[0].duration, 4_000);
  timers[0].callback();
  await assert.rejects(pending, /aborted/);
  assert.equal(signal.aborted, true);
  assert.equal(timers[0].cleared, true);
});
