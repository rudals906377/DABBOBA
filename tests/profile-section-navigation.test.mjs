import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";

const mobileRequire = createRequire(new URL("../apps/mobile/package.json", import.meta.url));
const ts = mobileRequire("typescript");
const source = readFileSync(new URL("../apps/mobile/src/features/profile/ProfileSectionScreen.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("ProfileSectionScreen.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const header = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "DetailHeader");
assert.ok(header, "exercise the real rendered profile header, not a duplicate navigation helper");
const code = ts.transpileModule(header.getText(parsed), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function renderHeader(hasHistory) {
  const calls = [];
  const scope = {
    exports: {},
    require: (name) => {
      assert.equal(name, "react/jsx-runtime");
      return mobileRequire(name);
    },
    router: {
      canGoBack: () => hasHistory(),
      back: () => calls.push("back"),
      replace: (path) => calls.push(["replace", path]),
    },
    DetailPageHeader: "DetailPageHeader",
    View: "View", Pressable: "Pressable", Ionicons: "Ionicons", KoreanPixelTitle: "KoreanPixelTitle",
    styles: {}, colors: { ink: "#000000" },
  };
  runInNewContext(code, scope);
  const element = scope.exports.DetailHeader({ title: "구매 내역" });
  assert.equal(element.type, "DetailPageHeader");
  assert.equal(element.props.title, "구매 내역");
  assert.equal(element.props.titleMode, "pixel");
  assert.equal(typeof element.props.onBack, "function");
  return { press: element.props.onBack, calls };
}

test("initial profile deep link returns to the native profile tab without GO_BACK", () => {
  const header = renderHeader(() => false);
  header.press();
  assert.deepEqual(header.calls, [["replace", "/(tabs)/profile"]]);
});

test("ordinary profile navigation preserves the existing stack back action", () => {
  const header = renderHeader(() => true);
  header.press();
  assert.deepEqual(header.calls, ["back"]);
});

test("the header checks current navigation history when pressed", () => {
  let hasHistory = true;
  const header = renderHeader(() => hasHistory);
  hasHistory = false;
  header.press();
  hasHistory = true;
  header.press();
  assert.deepEqual(header.calls, [["replace", "/(tabs)/profile"], "back"]);
});
