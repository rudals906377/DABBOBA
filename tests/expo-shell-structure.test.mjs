import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobilePackage = JSON.parse(readFileSync(path.join(root, "apps/mobile/package.json"), "utf8"));
const mobileSource = readFileSync(path.join(root, "apps/mobile/App.tsx"), "utf8");
const runtimeSource = readFileSync(path.join(root, "src/mobile/MobileRuntime.tsx"), "utf8");

test("Expo Go shell stays TypeScript-only and uses the supported WebView stack", () => {
  assert.equal(mobilePackage.dependencies.expo, "~54.0.37");
  assert.equal(mobilePackage.dependencies["react-native-webview"], "13.15.0");
  assert.equal(mobilePackage.scripts.start, "expo start --go");
  assert.match(mobileSource, /EXPO_PUBLIC_DABBOBA_WEB_URL/);
  assert.match(mobileSource, /embed=1&platform=\$\{Platform\.OS\}/);
  assert.match(mobileSource, /Constants\.expoConfig\?\.hostUri/);
});

test("web runtime isolates the Expo embed mode from the browser preview", () => {
  assert.match(runtimeSource, /params\.get\("embed"\) === "1"/);
  assert.match(runtimeSource, /<PhoneFrame embedded=\{embedded\}>/);
  assert.match(runtimeSource, /<KeyboardProvider nativeKeyboard=\{embedded\}>/);
  assert.match(runtimeSource, /embedded \? null : <StatusBar/);
  assert.match(runtimeSource, /embedded \? null : <KeyboardDock/);
});
