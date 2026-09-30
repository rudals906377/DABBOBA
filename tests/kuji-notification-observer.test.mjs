import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as entryState from "../apps/mobile/src/features/kuji/kuji-entry-state.ts";
import * as notificationNavigation from "../apps/mobile/src/features/notifications/notification-navigation.ts";

const mobileRequire = createRequire(new URL("../apps/mobile/package.json", import.meta.url));
const ts = mobileRequire("typescript");
const transpile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
const dispatcherCode = transpile("../apps/mobile/src/features/notifications/notification-response.ts");
const kujiObserverCode = transpile("../apps/mobile/src/features/kuji/KujiNotificationObserver.tsx");
const handlerCode = transpile("../apps/mobile/src/features/notifications/notification-handler.ts");

function response(data) {
  return { notification: { request: { content: { data } } } };
}

function load(code, modules) {
  const scope = {
    exports: {},
    Date,
    require: (name) => {
      assert.ok(Object.hasOwn(modules, name), name);
      return modules[name];
    },
  };
  runInNewContext(code, scope);
  return scope.exports;
}

function harness(initialResponse = null) {
  const paths = [];
  let cleared = 0;
  let removed = 0;
  let installed = 0;
  let listener;
  const notifications = {
    getLastNotificationResponse: () => initialResponse,
    clearLastNotificationResponse: () => { cleared += 1; initialResponse = null; },
    addNotificationResponseReceivedListener: (callback) => {
      installed += 1;
      listener = callback;
      return { remove: () => { removed += 1; } };
    },
  };
  const dispatcher = load(dispatcherCode, {
    "expo-notifications": notifications,
    "@/features/kuji/kuji-entry-state": entryState,
    "@/features/notifications/notification-navigation": notificationNavigation,
  });
  const cleanups = [];
  const mountObserver = () => {
    const observer = load(kujiObserverCode, {
      "expo-router": { useRouter: () => ({ push: (path) => paths.push(path) }) },
      react: { useEffect: (effect) => { cleanups.push(effect()); } },
      "@/features/notifications/notification-response": dispatcher,
    });
    assert.equal(observer.KujiNotificationObserver(), null);
  };
  mountObserver();
  return {
    dispatcher,
    paths,
    mountObserver,
    get cleared() { return cleared; },
    get removed() { return removed; },
    get installed() { return installed; },
    receive: (next) => listener(next),
    dispose: () => { for (const cleanup of cleanups.splice(0)) cleanup(); },
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

test("a kuji productId must pass the shared safe notification identifier check", () => {
  const h = harness();
  for (const productId of ["../profile", "a/b", "", "x".repeat(121), "-leading", "has space", "%2e%2e"]) {
    h.receive(response({ kind: "KUJI_TURN", productId }));
  }
  assert.deepEqual(h.paths, []);
  assert.equal(h.cleared, 0);
  const uuid = "5f0c7a52-3a5e-4c1a-9a3b-2b7d8e9f0a1b";
  h.receive(response({ kind: "KUJI_TURN", productId: uuid, entryId: "../x", checkoutExpiresAt: "x", serverNow: "y" }));
  assert.deepEqual(h.paths, [`/kuji/queue/${uuid}`]);
  h.dispose();
});

test("one kind-based dispatcher handles both kinds once regardless of observer mount order", () => {
  const notificationId = "5f0c7a52-3a5e-4c1a-9a3b-2b7d8e9f0a1b";
  const h = harness(response({ kind: "ACCOUNT_NOTIFICATION", notificationId }));
  h.mountObserver();
  assert.equal(h.installed, 1, "a second observer reuses the installed listener");
  assert.deepEqual(h.paths, [`/notifications/${notificationId}`]);
  assert.equal(h.cleared, 1);
  h.receive(response({ kind: "KUJI_TURN", productId: "product-2" }));
  assert.deepEqual(h.paths, [`/notifications/${notificationId}`, "/kuji/queue/product-2"]);
  assert.equal(
    h.dispatcher.resolveNotificationResponsePath({ kind: "ACCOUNT_NOTIFICATION", notificationId: "bad" }, 0),
    null,
  );
  h.dispose();
  assert.equal(h.removed, 1, "the listener is removed once, with the last observer");
});

test("the foreground notification handler is installed once from a single module", () => {
  let calls = 0;
  const handler = load(handlerCode, {
    "expo-notifications": { setNotificationHandler: () => { calls += 1; } },
  });
  handler.ensureForegroundNotificationHandler();
  handler.ensureForegroundNotificationHandler();
  assert.equal(calls, 1);
  for (const file of [
    "../apps/mobile/src/features/notifications/AccountNotificationObserver.tsx",
    "../apps/mobile/src/features/kuji/kuji-notifications.ts",
  ]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /setNotificationHandler/, file);
    assert.match(source, /ensureForegroundNotificationHandler\(\);/, file);
  }
});
