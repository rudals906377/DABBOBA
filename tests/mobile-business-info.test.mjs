import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), "../apps/admin/package.json"));
const { transformSync } = require("next/dist/build/swc");
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function loadScreen(path, mocks) {
  const source = await readFile(path, "utf8");
  const output = transformSync(source, {
    filename: path,
    jsc: { parser: { syntax: "typescript", tsx: true }, transform: { react: { runtime: "automatic" } } },
    module: { type: "commonjs" },
  }).code;
  const module = { exports: {} };
  vm.runInNewContext("(function(require,module,exports){" + output + "\n})", {})((
    id) => {
      if (id === "react/jsx-runtime") return require("react/jsx-runtime");
      if (id in mocks) return mocks[id];
      throw new Error("Unexpected import: " + id);
    }, module, module.exports,
  );
  return module.exports;
}

const host = (tag) => ({ children, style: _style, contentContainerStyle: _content, selectable: _selectable, ...props }) => React.createElement(tag, props, children);
const reactNative = {
  Pressable: ({ children, style: _style, accessibilityRole: _role, accessibilityLabel: _label, hitSlop: _hitSlop, ...props }) => React.createElement("button", props, typeof children === "function" ? children({ pressed: false }) : children),
  ScrollView: host("main"), View: host("div"),
  StyleSheet: { create: (styles) => styles, hairlineWidth: 1 },
};

test("business information keeps the six approved values in one typed source", async () => {
  const { BUSINESS_INFORMATION: info } = await import(pathToFileURL(join(repoRoot, "apps/mobile/src/features/profile/business-information.ts")).href);
  assert.deepEqual({ ...info }, {
    businessName: "다뽀바",
    representativeName: "김정미",
    businessRegistrationNumber: "508-33-01724",
    businessAddress: "경기도 파주시 한빛로 67, 208-501",
    representativePhone: "031-947-9996",
    mailOrderRegistrationNumber: "2026-경기파주-3579",
  });
});

test("public business screen renders every labeled value without auth or API dependencies", async () => {
  const screenPath = join(repoRoot, "apps/mobile/src/features/profile/BusinessInfoScreen.tsx");
  const source = await readFile(screenPath, "utf8");
  assert.doesNotMatch(source, /useProfileSnapshot|profile-api|SecureStore|accessToken|fetch\(/);
  assert.match(source, /router\.canGoBack\(\)[\s\S]*router\.back\(\)[\s\S]*router\.replace\("\/\(tabs\)\/profile"\)/);
  assert.match(source, /<DetailPageHeader title="사업자 정보" titleMode="pixel" onBack=\{goBack\} \/>/);
  const { BUSINESS_INFORMATION } = await import(pathToFileURL(join(repoRoot, "apps/mobile/src/features/profile/business-information.ts")).href);
  const pressHandlers = [];
  const replaced = [];
  const screen = await loadScreen(screenPath, {
    "@expo/vector-icons": { Ionicons: host("i") },
    "expo-router": { router: { canGoBack: () => false, back() {}, replace(path) { replaced.push(path); } } },
    "react-native": { ...reactNative, Pressable: ({ children, onPress, style: _style, accessibilityRole: _role, accessibilityLabel: _label, hitSlop: _hitSlop, ...props }) => { pressHandlers.push(onPress); return React.createElement("button", props, typeof children === "function" ? children({ pressed: false }) : children); } },
    "react-native-safe-area-context": { SafeAreaView: host("section") },
    "@/components/DetailPageHeader": { DetailPageHeader: ({ title, onBack }) => { pressHandlers.push(onBack); return React.createElement("header", null, React.createElement("button", { onClick: onBack }, "뒤로 가기"), React.createElement("h1", null, title)); } },
    "@/components/RootCategoryTitle": { KoreanPixelTitle: host("h1") },
    "@/components/Typography": { AppText: host("span") },
    "@/design-system/seed": { seed: { color: { layer: { basement: "white" }, stroke: { neutral: "gray" } }, size: { topNavigation: 52, touchTarget: 44 }, spacing: { globalGutter: 12, x1_5: 6, x3: 12, x4: 16, screenBottom: 40 }, typography: { caption: {}, bodyStrong: {} }, state: { pressedOpacity: 0.7 } } },
    "@/features/profile/business-information": { BUSINESS_INFORMATION },
    "@/theme": { colors: { ink: "black", muted: "gray" } },
  });
  const html = renderToStaticMarkup(React.createElement(screen.BusinessInfoScreen));
  for (const value of ["상호", "다뽀바", "대표자명", "김정미", "사업자등록번호", "508-33-01724", "사업장 주소", "경기도 파주시 한빛로 67, 208-501", "대표전화", "031-947-9996", "통신판매업 신고번호", "2026-경기파주-3579"]) assert.ok(html.includes(value), "missing " + value);
  assert.doesNotMatch(html, /유선전화|전화번호/);
  pressHandlers[0]();
  assert.deepEqual(replaced, ["/(tabs)/profile"]);
});

test("profile, settings, and support expose the static business route", async () => {
  const [home, sections, route] = await Promise.all([
    readFile(join(repoRoot, "apps/mobile/src/features/profile/ProfileHomeScreen.tsx"), "utf8"),
    readFile(join(repoRoot, "apps/mobile/src/features/profile/ProfileSectionScreen.tsx"), "utf8"),
    readFile(join(repoRoot, "apps/mobile/app/profile/business.tsx"), "utf8"),
  ]);
  assert.match(home, /const SUPPORT_MENU:[\s\S]*?section: "business", label: "사업자 정보"/);
  assert.match(home, /<MenuGroup title="지원" items=\{SUPPORT_MENU\}/);
  assert.ok(home.indexOf("<MenuGroup title=\"지원\"") > home.lastIndexOf("{snapshot ? ("));
  assert.equal(sections.match(/href="\/profile\/business"/g)?.length, 2);
  assert.match(route, /<BusinessInfoScreen \/>/);
});
