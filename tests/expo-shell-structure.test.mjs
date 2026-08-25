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
const rootLayoutSource = readFileSync(path.join(root, "apps/mobile/app/_layout.tsx"), "utf8");
const tabsLayoutSource = readFileSync(path.join(root, "apps/mobile/app/(tabs)/_layout.tsx"), "utf8");
const homeSource = readFileSync(path.join(root, "apps/mobile/src/features/home/HomeScreen.tsx"), "utf8");
const prototypeCss = readFileSync(path.join(root, "src/prototype.css"), "utf8");
const catalogApiSource = readFileSync(path.join(root, "apps/mobile/src/features/catalog/catalog-api.ts"), "utf8");
const localDatabaseSource = readFileSync(path.join(root, "apps/mobile/src/lib/local-database.ts"), "utf8");
const sessionStoreSource = readFileSync(path.join(root, "apps/mobile/src/lib/session-store.ts"), "utf8");
const runtimeConfigSource = readFileSync(path.join(root, "apps/mobile/src/lib/runtime-config.ts"), "utf8");
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

function loadRuntimeConfigModule() {
  const output = ts.transpileModule(runtimeConfigSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "runtime-config.ts",
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, URL });
  return module.exports;
}

const runtimeConfig = loadRuntimeConfigModule();

test("Expo entry is native-first with typed routes, API contracts, secure tokens, and disposable cache", () => {
  assert.equal(mobilePackage.dependencies.expo, "~54.0.37");
  assert.equal(mobilePackage.main, "expo-router/entry");
  assert.equal(mobilePackage.dependencies["@dabboba/api-client"], "workspace:*");
  assert.equal(mobilePackage.dependencies["expo-secure-store"], "~15.0.8");
  assert.equal(mobilePackage.dependencies["expo-sqlite"], "~16.0.10");
  assert.equal(mobilePackage.scripts.start, "expo start --go");
  assert.equal(mobilePackage.scripts.test, "node --test ../../tests/expo-shell-structure.test.mjs");
  assert.equal(mobileAppConfig.expo.scheme, "dabboba");
  assert.equal(mobileAppConfig.expo.experiments.typedRoutes, true);
  assert.deepEqual(Array.from(mobileAppConfig.expo.plugins), [
    "expo-router",
    "expo-secure-store",
    "expo-sqlite",
    "expo-font",
  ]);
  assert.match(rootLayoutSource, /SQLiteProvider/);
  assert.match(tabsLayoutSource, /name="exchange"/);
  assert.match(tabsLayoutSource, /name="ppoba"/);
  assert.match(tabsLayoutSource, /name="index"/);
  assert.match(tabsLayoutSource, /name="dukroom"/);
  assert.match(tabsLayoutSource, /name="profile"/);
  assert.match(catalogApiSource, /createDabbobaClient/);
  assert.match(homeSource, /fetchHomeCatalog/);
  assert.match(homeSource, /readHomeCatalogCache/);
  assert.match(homeSource, /header:\s*\{[\s\S]*?minHeight:\s*60,[\s\S]*?paddingHorizontal:\s*22,/);
  assert.match(homeSource, /wordmark:\s*\{\s*width:\s*136,\s*height:\s*20\s*\}/);
  assert.match(homeSource, /categoryChip:\s*\{\s*minHeight:\s*36,\s*paddingHorizontal:\s*14,\s*borderRadius:\s*8,[\s\S]*?borderWidth:\s*1,/);
  assert.match(localDatabaseSource, /CREATE TABLE IF NOT EXISTS catalog_cache/);
  assert.match(localDatabaseSource, /CREATE TABLE IF NOT EXISTS recent_searches/);
  assert.match(localDatabaseSource, /CREATE TABLE IF NOT EXISTS post_drafts/);
  assert.match(localDatabaseSource, /CREATE TABLE IF NOT EXISTS upload_queue/);
  assert.match(localDatabaseSource, /CREATE TABLE IF NOT EXISTS sync_state/);
  assert.doesNotMatch(localDatabaseSource, /orders|payments|points|draw_results/i);
  assert.match(sessionStoreSource, /SecureStore\.setItemAsync/);
  assert.match(sessionStoreSource, /access-token/);
  assert.match(sessionStoreSource, /refresh-token/);
  assert.doesNotMatch(`${rootLayoutSource}\n${tabsLayoutSource}\n${homeSource}`, /WebView/);
});

test("category toggles keep the compact app geometry and expand responsively on wider web containers", () => {
  assert.match(prototypeCss, /\.filter-chip\s*\{[\s\S]*?min-height:\s*36px;[\s\S]*?border:\s*1px solid var\(--db-line\);[\s\S]*?border-radius:\s*8px;[\s\S]*?padding:\s*0 14px;/);
  assert.match(prototypeCss, /@container \(min-width:\s*520px\)\s*\{[\s\S]*?\.category-rail[\s\S]*?width:\s*100%;[\s\S]*?\.category-rail > \.filter-chip[\s\S]*?flex:\s*1 1 0;/);
});

test("native runtime config requires HTTPS in production and derives the Metro host in development", () => {
  const production = runtimeConfig.resolveMobileRuntimeConfig({
    configuredApiUrl: "https://api.dabboba.test",
    configuredAssetBaseUrl: "https://media.dabboba.test",
    platform: "ios",
    development: false,
  });
  assert.deepEqual({ ...production }, {
    apiBaseUrl: "https://api.dabboba.test",
    assetBaseUrl: "https://media.dabboba.test",
  });

  const development = runtimeConfig.resolveMobileRuntimeConfig({
    metroHostUri: "192.168.219.100:8081",
    platform: "ios",
    development: true,
  });
  assert.equal(development.apiBaseUrl, "http://192.168.219.100:8788");
  assert.equal(development.assetBaseUrl, null);
  assert.equal(
    runtimeConfig.resolveCatalogImageUrl("/assets/item.jpg", "http://192.168.219.100:4174"),
    "http://192.168.219.100:4174/assets/item.jpg",
  );
  assert.equal(runtimeConfig.resolveCatalogImageUrl("/assets/item.jpg", null), null);

  assert.throws(
    () =>
      runtimeConfig.resolveMobileRuntimeConfig({
        configuredApiUrl: "http://api.dabboba.test",
        platform: "android",
        development: false,
      }),
    /HTTPS/,
  );
});

test("legacy WebView compatibility remains bounded while screens migrate", () => {
  assert.equal(mobilePackage.dependencies["react-native-webview"], "13.15.0");
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
