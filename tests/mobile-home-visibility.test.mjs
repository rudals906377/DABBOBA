import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireMobile = createRequire(`${root}/apps/mobile/package.json`);
const ts = requireMobile("typescript");
const source = readFileSync(`${root}/apps/mobile/src/features/home/HomeScreen.tsx`, "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;

const nestedValue = new Proxy(() => undefined, {
  get: () => nestedValue,
});
const jsx = (type, props) => ({ type, props: props ?? {} });
const scope = {
  exports: {},
  __DEV__: true,
  process: { env: {} },
  require(name) {
    if (name === "react/jsx-runtime") return { Fragment: "Fragment", jsx, jsxs: jsx };
    if (name === "react-native") {
      return {
        AccessibilityInfo: nestedValue,
        ActivityIndicator: "ActivityIndicator",
        Animated: nestedValue,
        Easing: nestedValue,
        Image: "Image",
        Platform: { OS: "ios" },
        Pressable: "Pressable",
        RefreshControl: "RefreshControl",
        ScrollView: "ScrollView",
        StyleSheet: { create: (styles) => styles, hairlineWidth: 1 },
        View: "View",
        useWindowDimensions: () => ({ width: 390 }),
      };
    }
    if (name === "react") return nestedValue;
    if (name.endsWith("/AnnouncementTicker")) {
      return { AnnouncementTicker: "AnnouncementTicker" };
    }
    if (name.endsWith("/RootCategoryTitle")) {
      return {
        KoreanPixelTitle: "KoreanPixelTitle",
        KoreanPixelTitleAccessory: "KoreanPixelTitleAccessory",
      };
    }
    if (name.endsWith("/Typography")) return { AppText: "Text" };
    if (name.endsWith("/design-system/components")) return { SeedChip: "SeedChip" };
    if (name.endsWith("/GachaMachineFrame")) return { GachaMachineFrame: "GachaMachineFrame" };
    if (name.endsWith("/KujiProductFrame")) return { KujiProductFrame: "KujiProductFrame" };
    if (name.endsWith("/seed")) return { seed: nestedValue };
    if (name.endsWith("/theme")) return { colors: nestedValue };
    if (name.endsWith("/home-feed")) {
      return {
        buildConfiguredHomeCollections: (sections) => sections,
        getHomeProductCardWidth: (layoutKind) => layoutKind === "kuji" ? 228 : 148,
        getHomeProductMediaAspectRatio: (layoutKind) => layoutKind === "kuji" ? 7 / 4 : 8 / 7,
        resolveHomeProductBadge: () => null,
      };
    }
    if (name.endsWith("/product-categories")) {
      return {
        PRODUCT_CATEGORY_OPTIONS: [
          { value: "gacha", label: "가챠" },
          { value: "kuji", label: "쿠지" },
        ],
        productCategoryLabel: (category) => ({ gacha: "가챠", kuji: "쿠지" })[category],
      };
    }
    return nestedValue;
  },
};

runInNewContext(code, scope);
const { HomeAnnouncement } = scope.exports;

test("Home mounts the ticker only when published announcement messages exist", () => {
  const fallback = HomeAnnouncement({ messages: [] });
  assert.equal(fallback.type, "AnnouncementTicker");
  assert.deepEqual(fallback.props.messages, []);
  assert.equal(fallback.props.onPress, undefined);
  assert.match(source, /\{announcementMessages\.length \? \(/);

  const onPress = () => undefined;
  const tree = HomeAnnouncement({
    messages: ["게시 중인 고정 공지"],
    onPress,
  });
  assert.equal(tree.type, "AnnouncementTicker");
  assert.deepEqual(tree.props.messages, ["게시 중인 고정 공지"]);
  assert.equal(tree.props.onPress, onPress);
});

test("Home keeps the fixed editorial order before every operator section", () => {
  const announcementIndex = source.indexOf("<HomeAnnouncement");
  const eventIndex = source.indexOf("<HomeIntroBanner");
  const recentDrawIndex = source.indexOf("<RecentDrawActivityPanel");
  const operatorSectionsIndex = source.indexOf("{homeCollections.map");

  assert.ok(announcementIndex >= 0);
  assert.ok(eventIndex > announcementIndex);
  assert.ok(recentDrawIndex > eventIndex);
  assert.ok(operatorSectionsIndex > recentDrawIndex);
  assert.match(source, /<HomeIntroBanner \/>/);
  assert.match(source, /새 소식을 준비하고 있어요/);
  assert.match(source, /homeCollections\.map\(\(collection\) => \([\s\S]*?<OperatorHomeSection/);
  assert.doesNotMatch(source, /<HomePopularIpSection|<HomeFeaturedProductsSection|todayDrawGroups\.map/);
  assert.doesNotMatch(source, /DEFAULT_HOME_COLLECTION_IP_IDS|buildHomeCollections/);
  assert.match(source, /recentDrawSummaryPopulated:\s*\{\s*minHeight:\s*72\s*\}/);
  assert.doesNotMatch(source, /recentDrawReelCurrent:\s*\{[^}]*borderTopWidth/);
  assert.doesNotMatch(source, /recentDrawReelCurrent:\s*\{[^}]*borderBottomWidth/);
});

test("Home uses plain canvas section headings and a shorter hero", () => {
  assert.match(source, /hero:\s*\{\s*minHeight:\s*seed\.spacing\.x16,/);
  assert.doesNotMatch(source, /hero:\s*\{[^}]*backgroundColor:\s*colors\.black/);
  assert.match(source, /sectionHeader:\s*\{[\s\S]*?marginTop:\s*seed\.spacing\.x8[\s\S]*?marginBottom:\s*seed\.spacing\.x4/);
  assert.doesNotMatch(source, /sectionHeader:\s*\{[^}]*minHeight/);
  assert.doesNotMatch(source, /sectionHeader:\s*\{[^}]*borderTopWidth/);
  assert.doesNotMatch(source, /sectionHeader:\s*\{[^}]*borderBottomWidth/);
  assert.doesNotMatch(source, /sectionHeader:\s*\{[^}]*backgroundColor/);
});
