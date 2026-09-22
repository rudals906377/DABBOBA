import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { sampleGachaRevealLighting } from "../apps/mobile/src/features/draw/gacha-reveal-timeline.ts";
import { productSubjectTitle } from "../apps/mobile/src/features/shop/product-title.ts";

const mobileRequire = createRequire(new URL("../apps/mobile/package.json", import.meta.url));
const ts = mobileRequire("typescript");
const transpile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const componentCode = transpile("../apps/mobile/src/features/draw/GachaPrizeReveal.tsx");

// Native rendering and hooks are the boundary; execute the actual component,
// product-title formatter, timeline, and design tokens rather than reimplementing them.
function loadTokens() {
  const theme = { exports: {} };
  runInNewContext(transpile("../apps/mobile/src/theme.ts"), theme);
  const brandAccent = {
    exports: {},
    require: (name) => {
      assert.equal(name, "@/theme");
      return theme.exports;
    },
  };
  runInNewContext(transpile("../apps/mobile/src/design-system/brand-accent.ts"), brandAccent);
  const tokens = {
    exports: {},
    require: (name) => {
      if (name === "@/theme") return theme.exports;
      if (name === "@/design-system/brand-accent") return brandAccent.exports;
      throw new Error(`Unexpected token dependency: ${name}`);
    },
  };
  runInNewContext(transpile("../apps/mobile/src/design-system/seed.ts"), tokens);
  return tokens.exports;
}
const tokens = loadTokens();

function createRenderer() {
  const hookSlots = [];
  let hookIndex = 0;
  const dependencies = {
    "react/jsx-runtime": mobileRequire("react/jsx-runtime"),
    react: {
      useState: (initial) => {
        const index = hookIndex++;
        if (!(index in hookSlots)) hookSlots[index] = initial;
        return [hookSlots[index], (value) => { hookSlots[index] = value; }];
      },
      useRef: (initial) => {
        const index = hookIndex++;
        if (!(index in hookSlots)) hookSlots[index] = { current: initial };
        return hookSlots[index];
      },
    },
    "react-native": {
      Image: "Image", View: "View",
      StyleSheet: { absoluteFillObject: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }, create: (styles) => styles },
    },
    "react-native-reanimated": { default: { View: "AnimatedView" }, useAnimatedStyle: (sample) => sample() },
    "@expo/vector-icons": { Ionicons: "Ionicons" },
    "@/components/DecorativeIonicon": { DecorativeIonicon: "DecorativeIonicon" },
    "@/components/RootCategoryTitle": { KoreanPixelTitle: "KoreanPixelTitle" },
    "@/components/Typography": { AppText: "AppText", BalancedAppText: "BalancedAppText" },
    "@/design-system/seed": tokens,
    "@/features/draw/gacha-reveal-timeline": { sampleGachaRevealLighting },
    "@/features/shop/product-title": { productSubjectTitle },
  };
  const module = {
    exports: {},
    require: (name) => {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  };
  runInNewContext(componentCode, module);
  return (props) => {
    hookIndex = 0;
    return module.exports.GachaPrizeReveal(props);
  };
}

function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (typeof tree === "string") return tree;
  if (!tree || typeof tree !== "object") return "";
  if (Array.isArray(tree)) return tree.map(text).join(" ");
  return text(tree.props?.children);
}
const images = (tree) => nodes(tree).filter((node) => node.type === "Image");
const opacity = (tree) => tree.props.style[1].opacity;
const result = { id: "committed-a", prizeName: "스파이 패밀리 · 캡슐 마스코트 2", rarity: "DO_NOT_DISPLAY" };
const base = { result, imageUri: "https://example.test/committed-a.png", ipName: "스파이 패밀리", progress: { value: 0 }, reduceMotion: false };

test("the committed image is mounted while concealed and only the server prize is presented", () => {
  const render = createRenderer();
  const hidden = render(base);
  assert.equal(opacity(hidden), 0);
  assert.equal(images(hidden).length, 1);
  assert.equal(images(hidden)[0].props.source.uri, base.imageUri);
  assert.equal(images(hidden)[0].props.resizeMode, "contain");
  assert.equal(images(hidden)[0].props.fadeDuration, 0);
  assert.match(text(hidden), /상품 이미지를 불러오는 중이에요/);
  assert.match(text(hidden), /스파이 패밀리/);
  assert.match(text(hidden), /캡슐 마스코트 2/);
  assert.doesNotMatch(text(hidden), /DO_NOT_DISPLAY|RESULT/);
  assert.equal(hidden.props.accessibilityElementsHidden, true);

  const entering = render({ ...base, progress: { value: 0.94 } });
  assert.ok(opacity(entering) > 0 && opacity(entering) < 1);
  assert.deepEqual(images(entering)[0].props.source, images(hidden)[0].props.source);
});

test("cinematic completion and settled rendering have exactly the same prize layout", () => {
  const render = createRenderer();
  images(render(base))[0].props.onLoad();
  const cinematicEnd = render({ ...base, progress: { value: 1 } });
  const settled = render({ ...base, settled: true });
  assert.equal(opacity(cinematicEnd), 1);
  assert.equal(opacity(settled), 1);
  assert.deepEqual(cinematicEnd.props.style[0], settled.props.style[0]);
  // Event callbacks are deliberately omitted; every native layout/text/image prop must match.
  assert.equal(JSON.stringify(cinematicEnd.props.children), JSON.stringify(settled.props.children));
  assert.equal(settled.props.accessibilityElementsHidden, false);
  assert.doesNotMatch(text(settled), /불러오는 중/);
});

test("slow images retain an explicit placeholder until load and stale callbacks cannot alter the next prize", () => {
  const render = createRenderer();
  const loading = render({ ...base, settled: true });
  const firstImage = images(loading)[0];
  assert.match(text(loading), /상품 이미지를 불러오는 중이에요/);
  assert.equal(firstImage.props.style[1].opacity, 0);
  firstImage.props.onLoad();
  const loaded = render({ ...base, settled: true });
  assert.equal(images(loaded)[0].props.style[1].opacity, 1);
  assert.doesNotMatch(text(loaded), /불러오는 중/);

  // A new prize using the same URI must still receive its own native load event.
  const next = { ...base, result: { id: "committed-b", prizeName: "다음 상품" }, settled: true };
  const nextLoading = render(next);
  const nextImage = images(nextLoading)[0];
  assert.notEqual(nextImage.key, firstImage.key);
  assert.match(text(nextLoading), /불러오는 중/);
  nextImage.props.onLoad();
  firstImage.props.onLoad();
  firstImage.props.onError();
  const nextLoaded = render(next);
  assert.equal(images(nextLoaded)[0].props.style[1].opacity, 1);
  assert.doesNotMatch(text(nextLoaded), /불러오는 중|불러오지 못/);
});

test("an unavailable image leaves the committed name visible and does not poison the next prize", () => {
  const render = createRenderer();
  const first = render({ ...base, settled: true });
  const staleError = images(first)[0].props.onError;
  staleError();
  const failed = render({ ...base, settled: true });
  assert.equal(images(failed).length, 0);
  assert.match(text(failed), /상품 이미지를 불러오지 못했어요/);
  assert.match(text(failed), /캡슐 마스코트 2/);

  const next = { ...base, result: { id: "committed-b", prizeName: "서버가 정한 다음 상품" }, imageUri: "https://example.test/committed-b.png" };
  assert.equal(images(render(next)).length, 1);
  staleError();
  assert.equal(images(render(next)).length, 1);
  assert.equal(images(render({ ...next, imageUri: null })).length, 0);
  assert.match(text(render({ ...next, imageUri: null })), /서버가 정한 다음 상품/);
});

test("preview never invents a prize and reduced motion remains stable until completion", () => {
  const render = createRenderer();
  const preview = render({ ...base, result: null, previewLabel: "가짜 A상 당첨", settled: true });
  assert.equal(images(preview).length, 0);
  assert.equal(text(preview).trim(), "RESULT 01");
  assert.equal(text(render({ ...base, result: null, previewLabel: "RESULT 02", settled: true })).trim(), "RESULT 02");
  for (const progress of [0, 0.5, 0.94, 0.999]) {
    assert.equal(opacity(render({ ...base, progress: { value: progress }, reduceMotion: true })), 0);
  }
  assert.equal(opacity(render({ ...base, progress: { value: 1 }, reduceMotion: true })), 1);
  assert.equal(opacity(render({ ...base, reduceMotion: true, settled: true })), 1);
});
