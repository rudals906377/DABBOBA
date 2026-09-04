import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CUSTOMER_BROWSABLE_PRODUCT_CATEGORIES,
  CUSTOMER_VISIBLE_PRODUCT_CATEGORIES,
  CUSTOMER_VISIBLE_PRODUCT_CATEGORY_LABELS,
  PRODUCT_CATEGORIES,
  isCustomerBrowsableProductCategory,
  isCustomerVisibleProductCategory,
} from "../src/domain/catalog.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prototypeSource = readFileSync(path.join(root, "src/Prototype.tsx"), "utf8");

function functionBlock(source, functionName) {
  const declaration = `function ${functionName}`;
  const declarationIndex = source.indexOf(declaration);
  assert.notEqual(declarationIndex, -1, `${functionName} declaration must exist`);

  const openingParenthesis = source.indexOf("(", declarationIndex + declaration.length);
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

  const openingBrace = source.indexOf("{", closingParenthesis + 1);
  let braceDepth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") braceDepth += 1;
    if (source[index] === "}") braceDepth -= 1;
    if (braceDepth === 0) return source.slice(declarationIndex, index + 1);
  }

  assert.fail(`${functionName} function body is not balanced`);
}

test("legacy catalog preserves TCG internally while hiding it from the current customer category list", () => {
  assert.deepEqual(PRODUCT_CATEGORIES.map((category) => category.id), ["gacha", "figure", "kuji", "tcg"]);
  assert.deepEqual(CUSTOMER_VISIBLE_PRODUCT_CATEGORIES.map((category) => category.id), ["gacha", "figure", "kuji"]);
  assert.deepEqual(CUSTOMER_VISIBLE_PRODUCT_CATEGORY_LABELS, ["가챠", "피규어", "쿠지"]);
  assert.deepEqual(CUSTOMER_BROWSABLE_PRODUCT_CATEGORIES.map((category) => category.id), ["gacha", "kuji"]);
  assert.equal(isCustomerVisibleProductCategory("figure"), true);
  assert.equal(isCustomerVisibleProductCategory("tcg"), false);
  assert.equal(isCustomerBrowsableProductCategory("gacha"), true);
  assert.equal(isCustomerBrowsableProductCategory("kuji"), true);
  assert.equal(isCustomerBrowsableProductCategory("figure"), false);
  assert.equal(isCustomerBrowsableProductCategory("tcg"), false);
});

test("legacy customer catalog discovery and IP detail expose only open gacha and kuji products", () => {
  const shopPage = functionBlock(prototypeSource, "ShopPage");
  const catalogPage = functionBlock(prototypeSource, "CatalogPage");
  const popularIpSection = functionBlock(prototypeSource, "PopularIpSection");
  const ipCatalogPage = functionBlock(prototypeSource, "IpCatalogPage");
  const ipDetailPage = functionBlock(prototypeSource, "IpDetailPage");
  const ipTabContent = functionBlock(prototypeSource, "IpTabContent");

  for (const block of [shopPage, catalogPage, ipTabContent]) {
    assert.match(block, /isCustomerBrowsableProductCategory\(product\.categoryId\)/);
  }
  for (const block of [popularIpSection, ipCatalogPage]) {
    assert.match(block, /isCustomerBrowsableProductCategory\(product\.categoryId\)/);
  }
  assert.match(ipDetailPage, /CUSTOMER_VISIBLE_PRODUCT_CATEGORIES\.filter\(\(category\)\s*=>\s*\(\s*ip\.availableCategories\.includes\(category\.id\)\s*\)\)/);
  assert.match(ipTabContent, /CUSTOMER_VISIBLE_PRODUCT_CATEGORIES\.map\(\(category\)\s*=>/);
  assert.match(ipTabContent, /category\.id === "figure"\s*\? "준비중입니다\."/);
  assert.doesNotMatch(shopPage, /가챠, 피규어, 쿠지, 카드/);
});

test("legacy figure category remains visible but renders the exact coming-soon state", () => {
  const shopPage = functionBlock(prototypeSource, "ShopPage");
  const catalogPage = functionBlock(prototypeSource, "CatalogPage");
  const detailFooter = functionBlock(prototypeSource, "DetailFooter");

  for (const block of [shopPage, catalogPage]) {
    assert.match(block, /const isFigureComingSoon = filter === "피규어"/);
    assert.match(block, /isFigureComingSoon \? "준비중입니다\."/);
  }
  assert.match(detailFooter, /if \(!isCustomerBrowsableProductCategory\(product\.categoryId\)\)/);
  assert.match(detailFooter, />준비중입니다\.<\/ActionButton>/);
});

test("legacy customer category selectors use the current visible category list", () => {
  assert.match(prototypeSource, /const filters: CategoryFilter\[\] = \["전체", \.\.\.CUSTOMER_VISIBLE_PRODUCT_CATEGORY_LABELS\]/);
  assert.match(prototypeSource, /const customerVisibleRequestCategoryIds = REQUEST_CATEGORY_IDS\.filter\(isCustomerVisibleProductCategory\)/);
  assert.match(prototypeSource, /CUSTOMER_VISIBLE_PRODUCT_CATEGORIES\.map\(\(category, index\)\s*=>/);
  assert.match(prototypeSource, /customerVisibleRequestCategoryIds\.map\(\(categoryId\)\s*=>/);
  assert.match(prototypeSource, /customerVisibleRequestCategoryIds\.map\(\(categoryId, index\)\s*=>/);
});
