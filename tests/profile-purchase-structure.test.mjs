import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  commerceModeForCategory,
  isRandomDrawCategory,
} from "../src/domain/catalog.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prototypeSource = readFileSync(path.join(root, "src/Prototype.tsx"), "utf8");
const products = JSON.parse(
  readFileSync(path.join(root, "src/fixtures/product-seed.json"), "utf8"),
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

  let braceDepth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") braceDepth += 1;
    if (source[index] === "}") braceDepth -= 1;
    if (braceDepth === 0) return source.slice(declarationIndex, index + 1);
  }

  assert.fail(`${functionName} function body is not balanced`);
}

test("commerce modes keep gacha and kuji in draw while figure and tcg purchase directly", () => {
  const expectedModes = {
    gacha: "draw",
    kuji: "draw",
    figure: "purchase",
    tcg: "purchase",
  };

  for (const [categoryId, expectedMode] of Object.entries(expectedModes)) {
    assert.equal(commerceModeForCategory(categoryId), expectedMode);
    assert.equal(isRandomDrawCategory(categoryId), expectedMode === "draw");
  }

  const drawProducts = products.filter((product) => isRandomDrawCategory(product.categoryId));
  const purchaseProducts = products.filter((product) => !isRandomDrawCategory(product.categoryId));

  assert.equal(drawProducts.length, 15);
  assert.equal(purchaseProducts.length, 10);
  assert.deepEqual(
    [...new Set(drawProducts.map((product) => product.categoryId))].sort(),
    ["gacha", "kuji"],
  );
  assert.deepEqual(
    [...new Set(purchaseProducts.map((product) => product.categoryId))].sort(),
    ["figure", "tcg"],
  );
});

test("profile root pushes a footer-free detail screen backed by context state", () => {
  const rootScreen = functionBlock(prototypeSource, "createProfileScreen");
  const detailScreen = functionBlock(prototypeSource, "createProfileDetailScreen");
  const profilePage = functionBlock(prototypeSource, "ProfilePage");
  const detailPage = functionBlock(prototypeSource, "ProfileDetailPage");

  assert.match(rootScreen, /render:\s*\(flow\)\s*=>\s*<ProfilePage\s+flow=\{flow\}\s*\/>/);
  assert.match(detailScreen, /id:\s*"profile-detail"/);
  assert.match(detailScreen, /<BackHeader\s+title="프로필 관리"\s+onBack=\{flow\.pop\}\s*\/>/);
  assert.match(detailScreen, /render:\s*\(flow\)\s*=>\s*<ProfileDetailPage\s+flow=\{flow\}\s*\/>/);
  assert.doesNotMatch(detailScreen, /RootTabFooter|AppBottomNavigation/);

  assert.match(profilePage, /aria-label="프로필 상세 보기"/);
  assert.match(profilePage, /flow\.push\(createProfileDetailScreen\(\)\)/);
  assert.match(profilePage, /\{profile\.nickname\}/);
  assert.match(profilePage, /\{profile\.bio\}/);

  assert.match(prototypeSource, /profile:\s*UserProfile;/);
  assert.match(prototypeSource, /setProfile:\s*Dispatch<SetStateAction<UserProfile>>;/);
  assert.match(prototypeSource, /const \[profile, setProfile\]\s*=\s*useState<UserProfile>/);
  assert.match(detailPage, /const \{\s*profile,\s*setProfile,\s*setProfileSaveNotice\s*\}\s*=\s*useDabboba\(\)/);
});

test("profile detail uses keyboard-aware fields and saves before returning", () => {
  const detailPage = functionBlock(prototypeSource, "ProfileDetailPage");

  assert.match(detailPage, /<KeyboardInput\b/);
  assert.match(detailPage, /<KeyboardTextarea\b/);
  assert.match(detailPage, /<ActionButton[\s\S]*?type="submit"[\s\S]*?>[\s\S]*?저장하기[\s\S]*?<\/ActionButton>/);
  assert.match(detailPage, /setProfile\(\{[\s\S]*?nickname:\s*nextNickname,[\s\S]*?bio:[\s\S]*?favoriteIpId,[\s\S]*?\}\)/);

  const hideIndex = detailPage.indexOf("keyboard.hide()");
  const saveIndex = detailPage.indexOf("setProfile({");
  const popIndex = detailPage.indexOf("flow.pop()");
  assert.ok(hideIndex >= 0 && hideIndex < saveIndex, "the keyboard must hide before profile state is saved");
  assert.ok(saveIndex >= 0 && saveIndex < popIndex, "profile state must save before the detail screen pops");
  assert.match(detailPage, /setProfileSaveNotice\("프로필을 저장했어요\."\)/);
  assert.match(prototypeSource, /<p className="profile-message" role="status">\{profileSaveNotice \|\| profileMessage\}<\/p>/);
});

test("checkout confirms payment before an explicit draw or catalog action", () => {
  const checkoutFooter = functionBlock(prototypeSource, "CheckoutFooter");

  assert.match(
    checkoutFooter,
    /const drawMode\s*=\s*isRandomDrawCategory\(product\.categoryId\)/,
  );
  assert.match(
    checkoutFooter,
    /if \(drawMode\) prepareDraw\(quantity\);[\s\S]*?flow\.replace\(createPurchaseCompleteScreen\(product, quantity, total\)\);/,
  );
  assert.doesNotMatch(checkoutFooter, /createDrawScreen/);
});

test("purchase completion exposes the draw CTA only after confirmation and never mounts the root footer", () => {
  const screen = functionBlock(prototypeSource, "createPurchaseCompleteScreen");
  const page = functionBlock(prototypeSource, "PurchaseCompletePage");
  const footer = functionBlock(prototypeSource, "PurchaseCompleteFooter");

  assert.match(screen, /id:\s*`purchase-complete-\$\{product\.id\}`/);
  assert.match(screen, /footer:\s*\(flow\)\s*=>\s*<PurchaseCompleteFooter\s+flow=\{flow\}\s+product=\{product\}\s+quantity=\{quantity\}\s*\/>/);
  assert.match(
    screen,
    /render:\s*\(\)\s*=>\s*<PurchaseCompletePage\s+product=\{product\}\s+quantity=\{quantity\}\s+paidTotal=\{paidTotal\}\s*\/>/,
  );

  assert.match(page, /product\.categoryId === "gacha" \? "가챠하러 가기" : "쿠지 추첨하러 가기"/);
  assert.match(footer, /if \(drawMode\) \{[\s\S]*?flow\.replace\(createDrawScreen\(product, quantity\)\);[\s\S]*?return;/);
  assert.match(footer, /returnToCatalog\(flow\)/);
  assert.match(footer, /\{drawMode \? drawActionLabel : "상품 목록으로"\}/);

  for (const block of [screen, page, footer]) {
    assert.doesNotMatch(block, /RootTabFooter|AppBottomNavigation/);
  }
  assert.doesNotMatch(page, /DrawPage|DrawFooter|createDrawScreen/);
});
