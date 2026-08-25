import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobilePackage = JSON.parse(readFileSync(path.join(root, "apps/mobile/package.json"), "utf8"));
const mobileAppConfig = JSON.parse(readFileSync(path.join(root, "apps/mobile/app.json"), "utf8"));
const mobileSource = readFileSync(path.join(root, "apps/mobile/App.tsx"), "utf8");
const webShellSource = readFileSync(path.join(root, "apps/mobile/webShell.ts"), "utf8");
const runtimeSource = readFileSync(path.join(root, "src/mobile/MobileRuntime.tsx"), "utf8");
const requireFromMobile = createRequire(path.join(root, "apps/mobile/package.json"));
const ts = requireFromMobile("typescript");

function loadWebShellModule() {
  const output = ts.transpileModule(webShellSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "webShell.ts",
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, URL });
  return module.exports;
}

const webShell = loadWebShellModule();

test("Expo Go shell stays TypeScript-only and uses the supported WebView stack", () => {
  assert.equal(mobilePackage.dependencies.expo, "~54.0.37");
  assert.equal(mobilePackage.dependencies["react-native-webview"], "13.15.0");
  assert.equal(mobilePackage.scripts.start, "expo start --go");
  assert.equal(mobilePackage.scripts.test, "node --test ../../tests/expo-shell-structure.test.mjs");
  assert.equal(mobileAppConfig.expo.scheme, "dabboba");
  assert.match(mobileSource, /EXPO_PUBLIC_DABBOBA_WEB_URL/);
  assert.match(mobileSource, /EXPO_PUBLIC_DABBOBA_ALLOWED_ORIGINS/);
  assert.match(mobileSource, /Constants\.expoConfig\?\.hostUri/);
  assert.match(mobileSource, /onShouldStartLoadWithRequest=/);
  assert.match(mobileSource, /onMessage=/);
  assert.match(mobileSource, /Linking\.getInitialURL\(\)/);
  assert.match(mobileSource, /Linking\.addEventListener\("url"/);
  assert.match(mobileSource, /injectedJavaScript=\{APP_READY_INJECTION_SCRIPT\}/);
  assert.match(
    mobileSource,
    /isAllowedWebUrl\(event\.nativeEvent\.url, \[shellConfiguration\.baseOrigin\]\)/,
  );
  assert.doesNotMatch(mobileSource, /originWhitelist=\{\["http:\/\/\*", "https:\/\/\*"\]\}/);
  assert.match(webShellSource, /searchParams\.set\("embed", "1"\)/);
  assert.match(webShellSource, /searchParams\.set\("platform", platform\)/);
});

test("production configuration accepts only exact HTTPS origins", () => {
  const configuration = webShell.resolveShellConfiguration({
    configuredUrl: "https://app.dabboba.test/catalog?source=native",
    configuredAllowedOrigins: "https://auth.dabboba.test/, https://media.dabboba.test",
    platform: "ios",
    development: false,
  });
  const embeddedUrl = new URL(configuration.webUrl);

  assert.equal(configuration.baseOrigin, "https://app.dabboba.test");
  assert.deepEqual(Array.from(configuration.allowedOrigins), [
    "https://app.dabboba.test",
    "https://auth.dabboba.test",
    "https://media.dabboba.test",
  ]);
  assert.equal(embeddedUrl.pathname, "/catalog");
  assert.equal(embeddedUrl.searchParams.get("source"), "native");
  assert.equal(embeddedUrl.searchParams.get("embed"), "1");
  assert.equal(embeddedUrl.searchParams.get("platform"), "ios");

  assert.throws(
    () =>
      webShell.resolveShellConfiguration({
        configuredUrl: "http://app.dabboba.test",
        platform: "ios",
        development: false,
      }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      webShell.resolveShellConfiguration({
        configuredUrl: "https://app.dabboba.test",
        configuredAllowedOrigins: "https://auth.dabboba.test/callback",
        platform: "ios",
        development: false,
      }),
    /origin/,
  );
  assert.throws(
    () =>
      webShell.resolveShellConfiguration({
        configuredUrl: "https://app.dabboba.test",
        configuredAllowedOrigins: "https://*.dabboba.test",
        platform: "ios",
        development: false,
      }),
    /wildcard/,
  );
  assert.throws(
    () =>
      webShell.resolveShellConfiguration({
        platform: "ios",
        development: false,
      }),
    /EXPO_PUBLIC_DABBOBA_WEB_URL/,
  );
});

test("development HTTP is limited to localhost and private LAN hosts", () => {
  const lanConfiguration = webShell.resolveShellConfiguration({
    metroHostUri: "192.168.219.100:8081",
    configuredAllowedOrigins: "http://localhost:4174, https://preview.dabboba.test",
    platform: "ios",
    development: true,
  });
  assert.equal(lanConfiguration.webUrl, "http://192.168.219.100:4174/?embed=1&platform=ios");
  assert.deepEqual(Array.from(lanConfiguration.allowedOrigins), [
    "http://192.168.219.100:4174",
    "http://localhost:4174",
    "https://preview.dabboba.test",
  ]);

  const emulatorConfiguration = webShell.resolveShellConfiguration({
    platform: "android",
    development: true,
  });
  assert.equal(emulatorConfiguration.baseOrigin, "http://10.0.2.2:4174");

  assert.throws(
    () =>
      webShell.resolveShellConfiguration({
        configuredUrl: "http://public.example.com",
        platform: "android",
        development: true,
      }),
    /로컬 개발 주소/,
  );
});

test("navigation policy keeps approved origins, externalizes web URLs, and blocks schemes", () => {
  const allowedOrigins = ["https://app.dabboba.test", "https://auth.dabboba.test"];

  assert.equal(
    webShell.classifyNavigationRequest(
      "https://app.dabboba.test/products/one",
      allowedOrigins,
      allowedOrigins[0],
      "android",
    ).action,
    "allow",
  );
  assert.equal(
    webShell.classifyNavigationRequest(
      "https://auth.dabboba.test/callback",
      allowedOrigins,
      allowedOrigins[0],
      "android",
    ).action,
    "allow",
  );
  assert.equal(
    webShell.classifyNavigationRequest(
      "https://app.dabboba.test.evil.example/",
      allowedOrigins,
      allowedOrigins[0],
      "android",
    ).action,
    "open-external",
  );

  const external = webShell.classifyNavigationRequest(
    "https://outside.example/path",
    allowedOrigins,
    allowedOrigins[0],
    "android",
  );
  assert.equal(external.action, "open-external");
  assert.equal(external.url, "https://outside.example/path");

  for (const blockedUrl of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "tel:+821012345678",
    "https://user:password@outside.example/",
    "dabboba://unknown",
  ]) {
    assert.equal(
      webShell.classifyNavigationRequest(
        blockedUrl,
        allowedOrigins,
        allowedOrigins[0],
        "android",
      ).action,
      "block",
      blockedUrl,
    );
  }
});

test("deep links map only bounded routes onto the approved web origin", () => {
  const target = webShell.parseDabbobaDeepLink(
    "dabboba://request-room",
    "https://app.dabboba.test",
    "ios",
  );
  assert.equal(target.route, "request-room");
  assert.equal(target.url, "https://app.dabboba.test/request-room?embed=1&platform=ios");

  const pathTarget = webShell.parseDabbobaDeepLink(
    "dabboba:/profile",
    "https://app.dabboba.test",
    "android",
  );
  assert.equal(pathTarget.route, "profile");
  assert.equal(pathTarget.url, "https://app.dabboba.test/profile?embed=1&platform=android");

  for (const rejectedUrl of [
    "dabboba://profile/private",
    "dabboba://profile?next=https://outside.example",
    "dabboba://unknown",
    "https://app.dabboba.test/profile",
  ]) {
    assert.equal(
      webShell.parseDabbobaDeepLink(rejectedUrl, "https://app.dabboba.test", "ios"),
      null,
      rejectedUrl,
    );
  }
});

test("versioned bridge accepts exact messages and rejects malformed or oversized input", () => {
  const ready = webShell.parseWebBridgeMessage('{"version":1,"type":"APP_READY"}');
  assert.equal(ready.type, "APP_READY");

  const external = webShell.parseWebBridgeMessage(
    '{"version":1,"type":"OPEN_EXTERNAL_URL","payload":{"url":"https://docs.example/path"}}',
  );
  assert.equal(external.type, "OPEN_EXTERNAL_URL");
  assert.equal(external.payload.url, "https://docs.example/path");

  const navigate = webShell.parseWebBridgeMessage(
    '{"version":1,"type":"NAVIGATE","payload":{"route":"settings"}}',
  );
  assert.equal(navigate.type, "NAVIGATE");
  assert.equal(navigate.payload.route, "settings");

  for (const rejectedMessage of [
    '{"version":2,"type":"APP_READY"}',
    '{"version":1,"type":"APP_READY","extra":true}',
    '{"version":1,"type":"OPEN_EXTERNAL_URL","payload":{"url":"javascript:alert(1)"}}',
    '{"version":1,"type":"OPEN_EXTERNAL_URL","payload":{"url":"https://user:pass@example.com"}}',
    '{"version":1,"type":"NAVIGATE","payload":{"route":"admin"}}',
    '{"version":1,"type":"UNKNOWN"}',
    "가".repeat(webShell.MAX_BRIDGE_MESSAGE_BYTES),
  ]) {
    assert.equal(webShell.parseWebBridgeMessage(rejectedMessage), null);
  }

  const serialized = JSON.parse(
    webShell.serializeDeepLinkMessage({
      route: "home",
      url: "https://app.dabboba.test/?embed=1&platform=ios",
    }),
  );
  assert.deepEqual(serialized, {
    version: 1,
    type: "DEEP_LINK",
    payload: {
      route: "home",
      url: "https://app.dabboba.test/?embed=1&platform=ios",
    },
  });
});

test("web runtime isolates the Expo embed mode from the browser preview", () => {
  assert.match(runtimeSource, /params\.get\("embed"\) === "1"/);
  assert.match(runtimeSource, /<PhoneFrame embedded=\{embedded\}>/);
  assert.match(runtimeSource, /<KeyboardProvider nativeKeyboard=\{embedded\}>/);
  assert.match(runtimeSource, /embedded \? null : <StatusBar/);
  assert.match(runtimeSource, /embedded \? null : <KeyboardDock/);
});
