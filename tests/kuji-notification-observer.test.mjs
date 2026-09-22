import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as entryState from "../apps/mobile/src/features/kuji/kuji-entry-state.ts";

const mobileRequire = createRequire(new URL("../apps/mobile/package.json", import.meta.url));
const ts = mobileRequire("typescript");
const source = readFileSync(new URL("../apps/mobile/src/features/kuji/KujiNotificationObserver.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function response(data) {
  return { notification: { request: { content: { data } } } };
}

function harness(initialResponse = null) {
  const paths = [];
  let cleared = 0;
  let removed = 0;
  let listener;
  let cleanup;
  const modules = {
    "expo-router": { useRouter: () => ({ push: (path) => paths.push(path) }) },
    react: { useEffect: (effect) => { cleanup = effect(); } },
    "expo-notifications": {
      getLastNotificationResponse: () => initialResponse,
      clearLastNotificationResponse: () => { cleared += 1; },
      addNotificationResponseReceivedListener: (callback) => {
        listener = callback;
        return { remove: () => { removed += 1; } };
      },
    },
    "@/features/kuji/kuji-entry-state": entryState,
  };
  const scope = {
    exports: {},
    require: (name) => {
      assert.ok(Object.hasOwn(modules, name), name);
      return modules[name];
    },
  };
  runInNewContext(code, scope);
  assert.equal(scope.exports.KujiNotificationObserver(), null);
  return {
    paths,
    get cleared() { return cleared; },
    get removed() { return removed; },
    receive: (next) => listener(next),
    dispose: () => cleanup(),
  };
}

test("SDK 57 notifications without data or with unrelated content never navigate or crash", () => {
  for (const initial of [null, response(undefined), response(null), response({}), response({ kind: "OTHER", productId: "product-1" })]) {
    const h = harness(initial);
    for (const data of [undefined, null, {}, { kind: "KUJI_TURN", productId: 42 }]) {
      assert.doesNotThrow(() => h.receive(response(data)));
    }
    assert.deepEqual(h.paths, []);
    assert.equal(h.cleared, 0);
    h.dispose();
    assert.equal(h.removed, 1);
  }
});

test("a kuji notification missing lease details still enters the authoritative product room gate", () => {
  const h = harness(response({ kind: "KUJI_TURN", productId: "product-1" }));
  assert.deepEqual(h.paths, ["/kuji/queue/product-1"]);
  assert.equal(h.cleared, 1);
  h.dispose();
});

test("a complete kuji turn response preserves room-gate routing and clears the handled notification", () => {
  const h = harness();
  h.receive(response({
    kind: "KUJI_TURN",
    productId: "product-1",
    entryId: "entry-1",
    checkoutExpiresAt: "2099-01-01T00:03:00.000Z",
    serverNow: "2099-01-01T00:00:00.000Z",
  }));
  assert.deepEqual(h.paths, ["/kuji/queue/product-1"]);
  assert.equal(h.cleared, 1);
  h.dispose();
});
