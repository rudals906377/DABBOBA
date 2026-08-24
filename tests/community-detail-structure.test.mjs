import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_EXCHANGE_APPLICATIONS,
  DEFAULT_EXCHANGE_POSTS,
  DEFAULT_PRODUCT_REQUESTS,
  REQUEST_CATEGORY_IDS,
} from "../src/data/exchangeRequestFixtures.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ipCatalog = JSON.parse(readFileSync(path.join(root, "src/fixtures/ip-seed.json"), "utf8"));
const prototypeSource = readFileSync(path.join(root, "src/Prototype.tsx"), "utf8");
const prototypeStyles = readFileSync(path.join(root, "src/prototype.css"), "utf8");

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
  assert.notEqual(openingBrace, -1, `${functionName} must have a body`);

  let braceDepth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") braceDepth += 1;
    if (source[index] === "}") braceDepth -= 1;
    if (braceDepth === 0) return source.slice(declarationIndex, index + 1);
  }

  assert.fail(`${functionName} function body is not balanced`);
}

test("seeded exchange listings, applications, and product requests keep complete domain fields", () => {
  const ipIds = new Set(ipCatalog.map((ip) => ip.id));
  const categoryIds = new Set(["gacha", "figure", "kuji", "tcg"]);

  assert.deepEqual(REQUEST_CATEGORY_IDS, ["gacha", "tcg", "figure", "kuji"]);
  assert.equal(new Set(DEFAULT_EXCHANGE_POSTS.map((post) => post.id)).size, DEFAULT_EXCHANGE_POSTS.length);
  assert.equal(new Set(DEFAULT_PRODUCT_REQUESTS.map((request) => request.id)).size, DEFAULT_PRODUCT_REQUESTS.length);

  for (const post of DEFAULT_EXCHANGE_POSTS) {
    assert.ok(categoryIds.has(post.categoryId), `${post.id} needs a supported category`);
    assert.ok(ipIds.has(post.ipId), `${post.id} needs a catalog IP`);
    for (const value of [post.author, post.title, post.offeredItem, post.wantedItem, post.body, post.time]) {
      assert.ok(value.trim(), `${post.id} has an empty required field`);
    }
    assert.ok(Number.isInteger(post.applications) && post.applications >= 0);

    const applications = DEFAULT_EXCHANGE_APPLICATIONS[post.id];
    assert.ok(Array.isArray(applications), `${post.id} needs an application fixture entry`);
    assert.equal(new Set(applications.map((application) => application.id)).size, applications.length);
    for (const application of applications) {
      for (const value of [application.author, application.offeredItem, application.message, application.time]) {
        assert.ok(value.trim(), `${application.id} has an empty required field`);
      }
    }
  }

  for (const request of DEFAULT_PRODUCT_REQUESTS) {
    assert.ok(categoryIds.has(request.categoryId), `${request.id} needs a supported category`);
    assert.ok(ipIds.has(request.ipId), `${request.id} needs a catalog IP`);
    for (const value of [request.author, request.desiredItem, request.details, request.time]) {
      assert.ok(value.trim(), `${request.id} has an empty required field`);
    }
    assert.ok(Number.isInteger(request.likes) && request.likes >= 0);
  }
});

test("exchange room keeps the compatible root id and pushes a footer-free exchange detail", () => {
  const rootScreen = functionBlock(prototypeSource, "createExchangeRoomScreen");
  const detailScreen = functionBlock(prototypeSource, "createExchangeDetailScreen");
  const exchangeRoomPage = functionBlock(prototypeSource, "ExchangeRoomPage");

  assert.match(rootScreen, /id:\s*"root-community"/);
  assert.match(rootScreen, /<RootTabHeader\s+title="교환방"/);
  assert.match(rootScreen, /render:\s*\(flow\)\s*=>\s*<ExchangeRoomPage\s+flow=\{flow\}\s*\/>/);
  assert.match(detailScreen, /id:\s*`exchange-post-\$\{postId\}`/);
  assert.match(detailScreen, /<BackHeader\s+title="교환 상세"\s+onBack=\{flow\.pop\}\s*\/>/);
  assert.match(detailScreen, /<ExchangeDetailPage\s+postId=\{postId\}\s*\/>/);
  assert.doesNotMatch(detailScreen, /RootTabFooter|AppBottomNavigation|\bfooter:/);
  assert.match(exchangeRoomPage, /flow\.push\(createExchangeDetailScreen\(intent\.postId\)\)/);
  assert.match(exchangeRoomPage, /setAuthIntent\(intent\)/);
  assert.match(exchangeRoomPage, /!isAuthenticated && authIntent[\s\S]*?<GuestAuthPrompt/);
  assert.match(exchangeRoomPage, /aria-label=\{`\$\{post\.title\} 교환 상세 보기`\}/);
  assert.match(exchangeRoomPage, /addExchangePost\(\{[\s\S]*?categoryId:[\s\S]*?ipId:[\s\S]*?title,[\s\S]*?offeredItem,[\s\S]*?wantedItem,[\s\S]*?body,/);
  assert.match(exchangeRoomPage, /<KeyboardInput\b[\s\S]*?<KeyboardInput\b[\s\S]*?<KeyboardInput\b[\s\S]*?<KeyboardTextarea\b/);
});

test("exchange detail shows offered and wanted items, applications, and a keyboard-aware application form", () => {
  const detailPage = functionBlock(prototypeSource, "ExchangeDetailPage");

  assert.match(detailPage, /exchangePosts\.find\(\(item\)\s*=>\s*item\.id\s*===\s*postId\)/);
  assert.match(detailPage, /exchangeApplications\[post\.id\]\s*\?\?\s*\[\]/);
  assert.match(detailPage, /post\.offeredItem/);
  assert.match(detailPage, /post\.wantedItem/);
  assert.match(detailPage, /addExchangeApplication\(post\.id, \{ offeredItem, message \}\)/);
  assert.match(detailPage, /<KeyboardInput\b/);
  assert.match(detailPage, /<KeyboardTextarea\b/);
  assert.match(detailPage, /교환 신청하기/);
  assert.match(detailPage, /role="status">\{submitMessage\}/);
  assert.match(detailPage, /새로고침하면 작성 내용이 초기화됩니다/);
  assert.doesNotMatch(detailPage, /RootTabFooter|AppBottomNavigation/);

  for (const className of [
    ".exchange-detail-page",
    ".exchange-detail-article",
    ".exchange-application-list",
    ".exchange-application-form",
  ]) {
    assert.match(prototypeStyles, new RegExp(className.replace(".", "\\.")));
  }
});

test("profile customer center opens a footer-free request room with category, IP, details, and shared likes", () => {
  const profilePage = functionBlock(prototypeSource, "ProfilePage");
  const customerCenterScreen = functionBlock(prototypeSource, "createCustomerCenterScreen");
  const customerCenterPage = functionBlock(prototypeSource, "CustomerCenterPage");
  const requestRoomScreen = functionBlock(prototypeSource, "createRequestRoomScreen");
  const requestRoomPage = functionBlock(prototypeSource, "RequestRoomPage");

  assert.match(profilePage, /if \(menu === "고객센터"\)[\s\S]*?flow\.push\(createCustomerCenterScreen\(\)\)/);
  assert.match(customerCenterScreen, /id:\s*"customer-center"/);
  assert.doesNotMatch(customerCenterScreen, /RootTabFooter|AppBottomNavigation|\bfooter:/);
  assert.match(customerCenterPage, /flow\.push\(createRequestRoomScreen\(\)\)/);
  assert.match(customerCenterPage, /<strong>신청방<\/strong>/);

  assert.match(requestRoomScreen, /id:\s*"request-room"/);
  assert.match(requestRoomScreen, /<BackHeader\s+title="신청방"\s+onBack=\{flow\.pop\}\s*\/>/);
  assert.doesNotMatch(requestRoomScreen, /RootTabFooter|AppBottomNavigation|\bfooter:/);
  assert.match(requestRoomPage, /productRequests\.filter\(\(request\)\s*=>\s*request\.categoryId\s*===\s*filter\)/);
  assert.match(requestRoomPage, /addProductRequest\(\{[\s\S]*?categoryId:[\s\S]*?ipId:[\s\S]*?desiredItem,[\s\S]*?details,/);
  assert.match(requestRoomPage, /toggleProductRequestLike\(intent\.requestId\)/);
  assert.match(requestRoomPage, /setAuthIntent\(intent\)/);
  assert.match(requestRoomPage, /likedProductRequestIds\.has\(request\.id\)/);
  assert.match(requestRoomPage, /<KeyboardInput\b/);
  assert.match(requestRoomPage, /<KeyboardTextarea\b/);
  assert.match(requestRoomPage, /<select\s+value=\{draftIpId\}/);
  assert.match(requestRoomPage, /kind:\s*"request-like",\s*requestId:\s*request\.id/);
  assert.match(requestRoomPage, /!isAuthenticated && \(authIntent\?\.kind === "request-compose" \|\| authIntent\?\.kind === "request-like"\)[\s\S]*?<GuestAuthPrompt/);

  for (const className of [
    ".customer-center-page",
    ".request-room-page",
    ".request-card",
    ".request-compose-form",
  ]) {
    assert.match(prototypeStyles, new RegExp(className.replace(".", "\\.")));
  }
});
