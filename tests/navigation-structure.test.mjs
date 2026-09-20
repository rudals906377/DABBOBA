import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prototypeSource = readFileSync(path.join(root, "src/Prototype.tsx"), "utf8");
const prototypeStyles = readFileSync(path.join(root, "src/prototype.css"), "utf8");
const navigationSource = readFileSync(path.join(root, "src/domain/navigation.ts"), "utf8");
const bottomNavigationSource = readFileSync(
  path.join(root, "src/components/AppBottomNavigation.tsx"),
  "utf8",
);

function functionBlock(source, functionName) {
  const declaration = `function ${functionName}`;
  const declarationIndex = source.indexOf(declaration);
  assert.notEqual(declarationIndex, -1, `${functionName} declaration must exist`);

  const openingParenthesis = source.indexOf("(", declarationIndex + declaration.length);
  assert.notEqual(openingParenthesis, -1, `${functionName} must declare parameters`);

  let parenthesisDepth = 0;
  let closingParenthesis = -1;
  for (let index = openingParenthesis; index < source.length; index += 1) {
    if (source[index] === "(") parenthesisDepth += 1;
    if (source[index] === ")") parenthesisDepth -= 1;
    if (parenthesisDepth === 0) {
      closingParenthesis = index;
      break;
    }
  }

  assert.notEqual(closingParenthesis, -1, `${functionName} parameter list must be balanced`);
  const openingBrace = source.indexOf("{", closingParenthesis + 1);
  assert.notEqual(openingBrace, -1, `${functionName} must have a function body`);

  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(declarationIndex, index + 1);
  }

  assert.fail(`${functionName} function body is not balanced`);
}

test("bottom navigation keeps the requested order and accessible current-page contract", () => {
  const tabs = [...navigationSource.matchAll(
    /\{\s*id:\s*"([^"]+)",\s*label:\s*"([^"]+)"\s*\}/g,
  )].map((match) => ({ id: match[1], label: match[2] }));

  assert.deepEqual(tabs, [
    { id: "community", label: "교환방" },
    { id: "shop", label: "뽀바" },
    { id: "home", label: "홈" },
    { id: "duckroom", label: "덕룸" },
    { id: "profile", label: "프로필" },
  ]);

  assert.match(
    bottomNavigationSource,
    /<nav\b[^>]*className="app-bottom-navigation"[^>]*aria-label="주요 메뉴"/s,
  );
  assert.match(bottomNavigationSource, /\{ROOT_TABS\.map\(\(tab\)\s*=>/);
  assert.match(
    bottomNavigationSource,
    /aria-current=\{selected\s*\?\s*"page"\s*:\s*undefined\}/,
  );
  assert.match(bottomNavigationSource, /<span>\{tab\.label\}<\/span>/);
  assert.match(bottomNavigationSource, /"aria-hidden":\s*true/);
  assert.doesNotMatch(bottomNavigationSource, /Icon\w+Fill/);
  assert.doesNotMatch(bottomNavigationSource, /function CapsuleMachineIcon|<svg/);
  assert.match(bottomNavigationSource, /className="app-bottom-navigation-machine-icon"/);
  assert.match(bottomNavigationSource, /<NavigationIcon\s+id=\{tab\.id\}\s*\/>/);
});

test("뽀바 combines category filters with normalized product and IP search", () => {
  const shopBlock = functionBlock(prototypeSource, "ShopPage");

  assert.match(prototypeSource, /title="뽀바"/);
  assert.match(shopBlock, /aria-label="DABBOBA 뽀바"/);
  assert.match(shopBlock, /<KeyboardInput[\s\S]*?type="search"[\s\S]*?aria-label="뽀바 상품 검색"/);
  assert.match(shopBlock, /placeholder="상품명·작품 IP 검색"/);
  assert.match(shopBlock, /filter === "전체" \|\| product\.category === filter/);
  assert.match(shopBlock, /productSearchIndex\.get\(product\.id\)\?\.includes\(normalizedQuery\)/);
  assert.match(shopBlock, /찾는 상품이 없어요/);
});

test("all five root screens own the shared bottom navigation footer", () => {
  const rootScreens = [
    ["createExchangeRoomScreen", "root-community"],
    ["createShopScreen", "root-shop"],
    ["createCatalogScreen", "root-home"],
    ["createDuckroomScreen", "root-duckroom"],
    ["createProfileScreen", "root-profile"],
  ];

  for (const [functionName, screenId] of rootScreens) {
    const block = functionBlock(prototypeSource, functionName);
    assert.match(block, new RegExp(`id:\\s*"${screenId}"`));
    assert.match(
      block,
      /footer:\s*\(flow\)\s*=>\s*<RootTabFooter\s+flow=\{flow\}\s*\/>/,
    );
    assert.match(block, /footerHeight:\s*70/);
  }

  const rootFooterAssignments = prototypeSource.match(
    /footer:\s*\(flow\)\s*=>\s*<RootTabFooter\s+flow=\{flow\}\s*\/>/g,
  ) ?? [];
  assert.equal(rootFooterAssignments.length, 5);

  const footerBlock = functionBlock(prototypeSource, "RootTabFooter");
  assert.match(
    footerBlock,
    /<AppBottomNavigation\s+activeTab=\{activeRootTab\}\s+onSelect=\{selectTab\}\s*\/>/,
  );
  assert.match(footerBlock, /flow\.replace\(createRootScreen\(tab\)\)/);
  assert.match(prototypeSource, /useState<RootTabId>\("home"\)/);
});

test("root navigation collapses with scroll hysteresis while preserving access and layout", () => {
  const footerBlock = functionBlock(prototypeSource, "RootTabFooter");

  assert.match(prototypeSource, /const ROOT_NAVIGATION_TOP_THRESHOLD = 12/);
  assert.match(prototypeSource, /const ROOT_NAVIGATION_COLLAPSE_THRESHOLD = 18/);
  assert.match(prototypeSource, /const ROOT_NAVIGATION_EXPAND_THRESHOLD = 10/);
  assert.match(footerBlock, /data-navigation-state=\{navigationState\}/);
  assert.match(footerBlock, /scrollTarget\.scrollHeight <= scrollTarget\.clientHeight \+ 2/);
  assert.match(footerBlock, /lastScrollTopRef\.current = Math\.max\(0, activeScrollTarget\?\.scrollTop \?\? 0\)/);
  assert.match(footerBlock, /Math\.max\(0, directionDistanceRef\.current \+ delta\)/);
  assert.match(footerBlock, /Math\.min\(0, directionDistanceRef\.current \+ delta\)/);
  assert.match(footerBlock, /window\.requestAnimationFrame\(updateNavigation\)/);
  assert.match(
    footerBlock,
    /document\.addEventListener\("scroll", handleScroll, \{ capture: true, passive: true \}\)/,
  );
  assert.match(footerBlock, /updateNavigationState\("expanded"\);[\s\S]*?flow\.replace\(createRootScreen\(tab\)\)/);
  assert.doesNotMatch(footerBlock, /"hidden"/);

  assert.match(prototypeStyles, /\.app-bottom-navigation > button \{[\s\S]*?min-height: 44px/);
  assert.match(prototypeStyles, /\.app-bottom-navigation \{[\s\S]*?background:\s*rgba\(252, 252, 248, 0\.7\)[\s\S]*?backdrop-filter:\s*blur\(12px\)/);
  assert.match(prototypeStyles, /\.app-bottom-navigation > button\[data-selected="true"\] > svg,[\s\S]*?\.app-bottom-navigation > button\[data-selected="true"\] > \.app-bottom-navigation-machine-icon \{[\s\S]*?background:\s*transparent;[\s\S]*?color:\s*var\(--db-green-ink\)/);
  assert.match(prototypeStyles, /mask:\s*url\("\/assets\/dabboba\/icons\/capsule-machine-nav\.png"\)/);
  assert.match(
    prototypeStyles,
    /\.root-tab-footer\[data-navigation-state="compact"\] \.app-bottom-navigation \{[\s\S]*?max\(220px,[\s\S]*?height: 52px/,
  );
  assert.match(
    prototypeStyles,
    /\.root-tab-footer\[data-navigation-state="compact"\] \.app-bottom-navigation > button > span \{[\s\S]*?max-height: 0;[\s\S]*?opacity: 0/,
  );
  assert.match(prototypeStyles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("detail, checkout, and draw screens keep their action footers without the root nav", () => {
  const transactionalScreens = [
    ["createDetailScreen", "DetailFooter"],
    ["createCheckoutScreen", "CheckoutFooter"],
    ["createDrawScreen", "DrawFooter"],
  ];

  for (const [functionName, footerName] of transactionalScreens) {
    const block = functionBlock(prototypeSource, functionName);
    assert.match(
      block,
      new RegExp(`footer:\\s*\\(flow\\)\\s*=>\\s*<${footerName}\\b`),
    );
    assert.doesNotMatch(block, /RootTabFooter|AppBottomNavigation/);
  }
});
