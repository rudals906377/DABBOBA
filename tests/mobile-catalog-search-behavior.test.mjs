import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";

const mobileRequire = createRequire(new URL("../apps/mobile/package.json", import.meta.url));
const ts = mobileRequire("typescript");

function transpile(path) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
}

function createHookRenderer(code, dependencies, globals = {}) {
  const hookSlots = [];
  let hookIndex = 0;
  const refSlots = [];
  let refIndex = 0;
  const effectDependencies = [];
  let effectIndex = 0;
  const pendingEffects = [];
  const react = {
    useCallback: (callback) => callback,
    useEffect: (effect, dependencies) => {
      const index = effectIndex++;
      const previous = effectDependencies[index];
      const changed = !previous
        || !dependencies
        || dependencies.some((dependency, dependencyIndex) => dependency !== previous[dependencyIndex]);
      effectDependencies[index] = dependencies;
      if (changed) pendingEffects.push(effect);
    },
    useMemo: (factory) => factory(),
    useRef: (initial) => {
      const index = refIndex++;
      if (!refSlots[index]) refSlots[index] = { current: initial };
      return refSlots[index];
    },
    useState: (initial) => {
      const index = hookIndex++;
      if (!(index in hookSlots)) {
        hookSlots[index] = typeof initial === "function" ? initial() : initial;
      }
      return [
        hookSlots[index],
        (next) => {
          hookSlots[index] = typeof next === "function" ? next(hookSlots[index]) : next;
        },
      ];
    },
  };
  const module = {
    exports: {},
    require: (name) => {
      if (name === "react") return react;
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  };
  runInNewContext(code, { module, exports: module.exports, require: module.require, ...globals });

  return {
    render(exportName, props) {
      hookIndex = 0;
      refIndex = 0;
      effectIndex = 0;
      return module.exports[exportName](props);
    },
    async runEffects() {
      for (const effect of pendingEffects.splice(0)) effect();
      await new Promise((resolve) => setTimeout(resolve, 350));
    },
  };
}

function nodes(tree) {
  if (tree == null || typeof tree === "boolean") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree !== "object") return [];
  if (typeof tree.type === "function") return nodes(tree.type(tree.props));
  return [tree, ...nodes(tree.props?.children)];
}

function text(tree) {
  if (tree == null || typeof tree === "boolean") return "";
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join(" ");
  if (typeof tree !== "object") return "";
  if (typeof tree.type === "function") return text(tree.type(tree.props));
  return text(tree.props?.children);
}

const productSearchCode = transpile("../apps/mobile/src/features/search/ProductSearchScreen.tsx");

function createProductSearchRenderer() {
  const snapshot = {
    fetchedAt: "2026-09-13T00:00:00.000Z",
    ips: [
      { id: "ip-a", nameKo: "작품 A" },
      { id: "ip-b", nameKo: "작품 B" },
    ],
    products: [
      { id: "product-a", ipId: "ip-a", category: "GACHA", name: "같은 이름", sku: "A-1", manufacturer: null },
      { id: "product-b", ipId: "ip-b", category: "KUJI", name: "같은 이름", sku: "B-1", manufacturer: null },
    ],
  };
  const styles = {
    hairlineWidth: 1,
    create: (value) => value,
  };
  return createHookRenderer(productSearchCode, {
    "react/jsx-runtime": mobileRequire("react/jsx-runtime"),
    "expo-constants": { default: { expoConfig: { hostUri: "127.0.0.1:8081" } } },
    "expo-router": {
      useLocalSearchParams: () => ({ ipId: "ip-a", query: "작품 A" }),
      useRouter: () => ({ back() {}, canGoBack: () => true, push() {}, replace() {} }),
    },
    "react-native": {
      ActivityIndicator: "ActivityIndicator",
      Keyboard: { dismiss() {} },
      Platform: { OS: "ios" },
      ScrollView: "ScrollView",
      StyleSheet: styles,
      View: "View",
    },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "@/components/CatalogProductRow": { CatalogProductRow: "CatalogProductRow" },
    "@/components/DecorativeIonicon": { DecorativeIonicon: "DecorativeIonicon" },
    "@/components/RootCategoryTitle": {
      KoreanPixelTitle: "KoreanPixelTitle",
      KoreanPixelTitleAccessory: "KoreanPixelTitleAccessory",
    },
    "@/components/Typography": { AppText: "AppText", AppTextInput: "TextInput" },
    "@/design-system/components": {
      SeedActionButton: "SeedActionButton",
      SeedIconButton: "SeedIconButton",
      SeedInputShell: "SeedInputShell",
    },
    "@/design-system/section": { subtleSectionHeaderRule: {} },
    "@/design-system/seed": {
      seed: {
        color: { layer: { basement: "#fff" }, stroke: { neutral: "#ddd" } },
        size: { topNavigation: 52 },
        spacing: { x1: 4, x2_5: 10, x3_5: 14, x4: 16, globalGutter: 20, screenBottom: 40 },
        typography: { subtitle: { fontSize: 18, lineHeight: 24, fontWeight: "700" } },
      },
    },
    "@/features/catalog/StorefrontCategorySettingsProvider": {
      useStorefrontCategorySettings: () => ({ revision: 0 }),
    },
    "@/features/shop/shop-api": {
      fetchShopIps: async () => snapshot.ips,
      fetchCatalogProductPage: async (_apiBaseUrl, input) => ({
        products: snapshot.products.filter((product) => !input.ipId || product.ipId === input.ipId),
        nextCursor: null,
        fetchedAt: snapshot.fetchedAt,
      }),
    },
    "@/lib/runtime-config": {
      resolveMobileRuntimeConfig: () => ({ apiBaseUrl: "https://api.example.test", assetBaseUrl: "https://assets.example.test" }),
    },
    "@/theme": { colors: { ink: "#111", muted: "#777" } },
  }, {
    __DEV__: true,
    process,
    setTimeout,
    clearTimeout,
  });
}

test("an IP entry keeps exact-IP results visible after its prefilled query is cleared", async () => {
  const renderer = createProductSearchRenderer();
  renderer.render("ProductSearchScreen");
  await renderer.runEffects();

  const initial = renderer.render("ProductSearchScreen");
  assert.deepEqual(
    nodes(initial).filter((node) => node.type === "CatalogProductRow").map((node) => node.props.product.id),
    ["product-a"],
  );

  const input = nodes(initial).find((node) => node.type === "TextInput");
  assert.ok(input, "the search input must render");
  input.props.onChangeText("");

  renderer.render("ProductSearchScreen");
  await renderer.runEffects();
  const cleared = renderer.render("ProductSearchScreen");
  assert.deepEqual(
    nodes(cleared).filter((node) => node.type === "CatalogProductRow").map((node) => node.props.product.id),
    ["product-a"],
  );
  assert.doesNotMatch(text(cleared), /무엇을 찾고 있나요/);
});

const catalogProductImageStateCode = transpile("../apps/mobile/src/components/catalog-product-image-state.ts");
const catalogProductImageStateModule = { exports: {} };
runInNewContext(catalogProductImageStateCode, {
  module: catalogProductImageStateModule,
  exports: catalogProductImageStateModule.exports,
  JSON,
});
const catalogProductImageCode = transpile("../apps/mobile/src/components/CatalogProductImage.tsx");

function createCatalogProductImageRenderer() {
  return createHookRenderer(catalogProductImageCode, {
    "react/jsx-runtime": mobileRequire("react/jsx-runtime"),
    "react-native": {
      Image: "Image",
      StyleSheet: { create: (value) => value },
      View: "View",
    },
    "@/components/Typography": { AppText: "AppText" },
    "@/components/catalog-product-image-state": catalogProductImageStateModule.exports,
    "@/design-system/seed": {
      seed: {
        color: { background: { neutralWeak: "#eee" } },
        spacing: { x3_5: 14 },
        typography: { caption: { fontSize: 12 } },
      },
    },
    "@/theme": { colors: { muted: "#777" } },
  });
}

function imageNode(tree) {
  return nodes(tree).find((node) => node.type === "Image");
}

test("catalog images advance through fallbacks and restart from the primary source on retry", () => {
  const renderer = createCatalogProductImageRenderer();
  const dimensions = [];
  const base = {
    uri: "https://assets.example.test/primary.png",
    requestKey: 0,
    resizeMode: "cover",
    style: { width: 120, height: 120 },
    fallbackSources: [{ uri: "https://assets.example.test/fallback.png", resizeMode: "contain" }],
    onDimensions: (width, height) => dimensions.push([width, height]),
  };

  const primary = renderer.render("CatalogProductImage", base);
  assert.equal(imageNode(primary).props.source.uri, base.uri);
  assert.equal(imageNode(primary).props.resizeMode, "cover");
  assert.match(text(primary), /이미지 불러오는 중/);

  imageNode(primary).props.onError();
  const fallback = renderer.render("CatalogProductImage", base);
  assert.equal(imageNode(fallback).props.source.uri, base.fallbackSources[0].uri);
  assert.equal(imageNode(fallback).props.resizeMode, "contain");
  assert.match(text(fallback), /이미지 불러오는 중/);

  imageNode(fallback).props.onLoad({ nativeEvent: { source: { width: 800, height: 600 } } });
  const loadedFallback = renderer.render("CatalogProductImage", base);
  assert.doesNotMatch(text(loadedFallback), /이미지 불러오는 중/);
  assert.deepEqual(dimensions, [[800, 600]]);

  const retry = renderer.render("CatalogProductImage", { ...base, requestKey: 1 });
  assert.equal(imageNode(retry).props.source.uri, base.uri);
  assert.equal(imageNode(retry).props.resizeMode, "cover");
  assert.match(text(retry), /이미지 불러오는 중/);

  const failureRenderer = createCatalogProductImageRenderer();
  const failedPrimary = failureRenderer.render("CatalogProductImage", base);
  imageNode(failedPrimary).props.onError();
  const failedFallback = failureRenderer.render("CatalogProductImage", base);
  imageNode(failedFallback).props.onError();
  const exhausted = failureRenderer.render("CatalogProductImage", base);
  assert.equal(imageNode(exhausted), undefined);
  assert.match(text(exhausted), /이미지 로딩 실패/);
});
