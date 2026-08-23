import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prototypeSource = readFileSync(path.join(root, "src/Prototype.tsx"), "utf8");
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
    { id: "community", label: "커뮤니티" },
    { id: "shop", label: "샵" },
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
});

test("all five root screens own the shared bottom navigation footer", () => {
  const rootScreens = [
    ["createCommunityScreen", "root-community"],
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
