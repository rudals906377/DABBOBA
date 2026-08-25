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
import {
  POPULAR_EXCHANGE_CATALOG_ITEMS,
} from "../src/data/exchangeCatalogFixtures.ts";
import {
  CURRENT_USER_ID,
  createInitialSessionCommerceState,
  eligibleSessionInventoryUnits,
} from "../src/data/sessionCommerceFixtures.ts";

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
  assert.ok(DEFAULT_EXCHANGE_POSTS.every((post) => !post.id.startsWith("exchange-user-")));
  assert.equal(new Set(DEFAULT_PRODUCT_REQUESTS.map((request) => request.id)).size, DEFAULT_PRODUCT_REQUESTS.length);

  for (const post of DEFAULT_EXCHANGE_POSTS) {
    assert.ok(categoryIds.has(post.categoryId), `${post.id} needs a supported category`);
    assert.ok(ipIds.has(post.ipId), `${post.id} needs a catalog IP`);
    for (const value of [
      post.authorId,
      post.author,
      post.title,
      post.offeredInventoryUnitId,
      post.offeredCatalogItemId,
      post.offeredItem,
      post.offeredItemImage,
      post.body,
      post.time,
    ]) {
      assert.ok(value.trim(), `${post.id} has an empty required field`);
    }
    assert.ok(post.appReferenceValue > 0);
    assert.notEqual(post.authorId, CURRENT_USER_ID, `${post.id} must remain a neutral other-user fixture`);
    assert.ok(Number.isInteger(post.applications) && post.applications >= 0);

    const applications = DEFAULT_EXCHANGE_APPLICATIONS[post.id];
    assert.ok(Array.isArray(applications), `${post.id} needs an application fixture entry`);
    assert.equal(new Set(applications.map((application) => application.id)).size, applications.length);
    for (const application of applications) {
      assert.ok(categoryIds.has(application.categoryId));
      assert.ok(ipIds.has(application.ipId));
      for (const value of [
        application.authorId,
        application.author,
        application.offeredInventoryUnitId,
        application.offeredCatalogItemId,
        application.offeredItem,
        application.offeredItemImage,
        application.message,
        application.time,
      ]) {
        assert.ok(value.trim(), `${application.id} has an empty required field`);
      }
      assert.ok(application.appReferenceValue > 0);
    }
  }

  for (const request of DEFAULT_PRODUCT_REQUESTS) {
    assert.ok(categoryIds.has(request.categoryId), `${request.id} needs a supported category`);
    assert.ok(ipIds.has(request.ipId), `${request.id} needs a catalog IP`);
    for (const value of [request.authorId, request.author, request.desiredItem, request.details, request.time]) {
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
  assert.match(exchangeRoomPage, /addExchangePost\(\{[\s\S]*?categoryId:[\s\S]*?ipId:[\s\S]*?title,[\s\S]*?offeredInventoryUnitId:[\s\S]*?offeredCatalogItemId:[\s\S]*?offeredItemImage:[\s\S]*?appReferenceValue:[\s\S]*?body,/);
  assert.match(exchangeRoomPage, /exchangeItemSuggestions\(draftTitle\)/);
  assert.match(exchangeRoomPage, /eligibleSessionInventoryUnits\(sessionCommerce, currentUserId\)/);
  assert.match(exchangeRoomPage, /offeredSuggestionsOpen \? \(\s*<ExchangeSuggestionList/);
  assert.doesNotMatch(exchangeRoomPage, /draftWanted|wantedCatalogItemIds|원하는 교환품/);
  assert.match(exchangeRoomPage, /className="exchange-listing-product"/);
  assert.match(exchangeRoomPage, /post\.authorId === currentUserId/);
  assert.match(exchangeRoomPage, /exchangePriceLabel\(post\.appReferenceValue\)/);
  assert.match(exchangeRoomPage, /<KeyboardInput\b[\s\S]*?<KeyboardInput\b[\s\S]*?<KeyboardTextarea\b/);
});

test("exchange autocomplete fixtures keep registered ids, popularity signals, and owned inventory links", () => {
  const itemIds = new Set(POPULAR_EXCHANGE_CATALOG_ITEMS.map((item) => item.id));
  assert.equal(itemIds.size, POPULAR_EXCHANGE_CATALOG_ITEMS.length);
  const eligibleInventory = eligibleSessionInventoryUnits(createInitialSessionCommerceState());
  assert.ok(eligibleInventory.every((item) => itemIds.has(item.catalogItemId)));

  const pokemonSuggestions = POPULAR_EXCHANGE_CATALOG_ITEMS.filter((item) => item.name.startsWith("포켓몬스터"));
  assert.ok(pokemonSuggestions.length >= 3);
  assert.ok(pokemonSuggestions.some((item) => item.name.includes("피카츄")));
  assert.ok(pokemonSuggestions.some((item) => item.name.includes("파이리")));
  assert.ok(pokemonSuggestions.every((item) => item.searchCount > 0 && item.postCount > 0));
  assert.ok(POPULAR_EXCHANGE_CATALOG_ITEMS.every((item) => Number.isInteger(item.estimatedPrice) && item.estimatedPrice > 0));

  assert.match(prototypeSource, /popularity:\s*item\.postCount \* 10 \+ item\.searchCount/);
  assert.match(prototypeSource, /normalizeCatalogSearch\(item\.name\)/);
  assert.match(prototypeStyles, /\.exchange-suggestion-list/);
  assert.match(prototypeStyles, /\.exchange-selected-inventory/);
  assert.match(prototypeSource, /APP_REFERENCE_VALUE_NOTICE/);
});

test("exchange detail shows one posted item and product-backed proposals with owner decisions", () => {
  const detailPage = functionBlock(prototypeSource, "ExchangeDetailPage");

  assert.match(detailPage, /exchangePosts\.find\(\(item\)\s*=>\s*item\.id\s*===\s*postId\)/);
  assert.match(detailPage, /exchangeApplications\[post\.id\]\s*\?\?\s*\[\]/);
  assert.match(detailPage, /post\.offeredItem/);
  assert.doesNotMatch(detailPage, /post\.wantedItems|원하는 교환품/);
  assert.match(detailPage, /application\.offeredItemImage/);
  assert.match(detailPage, /addExchangeApplication\(post\.id, \{[\s\S]*?offeredInventoryUnitId:[\s\S]*?offeredCatalogItemId:[\s\S]*?ipId:[\s\S]*?categoryId:[\s\S]*?offeredItemImage:[\s\S]*?appReferenceValue:[\s\S]*?message,/);
  assert.match(detailPage, /sessionCommerce\.exchangeApplicationDecisions/);
  assert.match(detailPage, /exchangeDecisionKey\(post\.id, application\.id\)/);
  assert.match(detailPage, /post\.authorId === currentUserId/);
  assert.match(detailPage, /handleDecision\(application\.id, "rejected"\)/);
  assert.match(detailPage, /handleDecision\(application\.id, "accepted"\)/);
  assert.match(detailPage, /decideExchangeApplication\(post\.id, applicationId, decision, key\)/);
  assert.match(detailPage, /<KeyboardInput\b/);
  assert.match(detailPage, /<KeyboardTextarea\b/);
  assert.match(detailPage, /이 상품으로 교환 제안하기/);
  assert.match(detailPage, /role="status">\{submitMessage\}/);
  assert.match(detailPage, /새로고침하면 작성 내용이 초기화됩니다/);
  assert.doesNotMatch(detailPage, /RootTabFooter|AppBottomNavigation/);

  for (const className of [
    ".exchange-detail-page",
    ".exchange-detail-article",
    ".exchange-detail-product",
    ".exchange-application-list",
    ".exchange-application-controls",
    ".exchange-application-form",
  ]) {
    assert.match(prototypeStyles, new RegExp(className.replace(".", "\\.")));
  }
});

test("profile exposes request room directly and keeps customer support separate", () => {
  const profilePage = functionBlock(prototypeSource, "ProfilePage");
  const customerCenterScreen = functionBlock(prototypeSource, "createCustomerCenterScreen");
  const customerCenterPage = functionBlock(prototypeSource, "CustomerCenterPage");
  const requestRoomScreen = functionBlock(prototypeSource, "createRequestRoomScreen");
  const requestRoomPage = functionBlock(prototypeSource, "RequestRoomPage");

  assert.match(prototypeSource, /const PROFILE_MENU_ITEMS = \[[\s\S]*?label: "포인트 내역", createScreen: createPointHistoryScreen[\s\S]*?label: "고객센터", createScreen: createCustomerCenterScreen/);
  assert.doesNotMatch(prototypeSource.match(/const PROFILE_MENU_ITEMS = \[[\s\S]*?\] as const;/)?.[0] ?? "", /label: "신청방"/);
  assert.match(profilePage, /PROFILE_MENU_ITEMS\.map\(\(menu\)\s*=>/);
  assert.match(profilePage, /flow\.push\(menu\.createScreen\(\)\)/);
  assert.match(profilePage, /className="profile-request-room-entry"/);
  assert.match(profilePage, /aria-label="신청방 열기"/);
  assert.match(profilePage, /flow\.push\(createRequestRoomScreen\(\)\)/);
  assert.match(customerCenterScreen, /id:\s*"customer-center"/);
  assert.doesNotMatch(customerCenterScreen, /RootTabFooter|AppBottomNavigation|\bfooter:/);
  assert.match(customerCenterPage, /PROFILE_CUSTOMER_FAQS\.map/);
  assert.match(customerCenterPage, /HELP DESK/);
  assert.doesNotMatch(customerCenterPage, /createRequestRoomScreen|request-room-entry|<strong>신청방<\/strong>/);

  assert.match(requestRoomScreen, /id:\s*"request-room"/);
  assert.match(requestRoomScreen, /<BackHeader\s+title="신청방"\s+onBack=\{flow\.pop\}\s*\/>/);
  assert.doesNotMatch(requestRoomScreen, /RootTabFooter|AppBottomNavigation|\bfooter:/);
  assert.match(requestRoomPage, /productRequests\.filter\(\(request\)\s*=>\s*request\.categoryId\s*===\s*filter\)/);
  assert.match(requestRoomPage, /addProductRequest\(\{[\s\S]*?categoryId:[\s\S]*?ipId:[\s\S]*?desiredItem,[\s\S]*?details,/);
  assert.match(requestRoomPage, /toggleProductRequestLike\(intent\.requestId(?:,\s*pending\.key)?\)/);
  assert.match(requestRoomPage, /setAuthIntent\(intent\)/);
  assert.match(requestRoomPage, /likedProductRequestIds\.has\(request\.id\)/);
  assert.match(requestRoomPage, /<KeyboardInput\b/);
  assert.match(requestRoomPage, /<KeyboardTextarea\b/);
  assert.match(requestRoomPage, /<select\s+value=\{draftIpId\}/);
  assert.match(requestRoomPage, /kind:\s*"request-like",\s*requestId:\s*request\.id/);
  assert.match(requestRoomPage, /!isAuthenticated && \(authIntent\?\.kind === "request-compose" \|\| authIntent\?\.kind === "request-like" \|\| authIntent\?\.kind === "catalog-request"\)[\s\S]*?<GuestAuthPrompt/);

  for (const className of [
    ".customer-center-page",
    ".customer-center-faq",
    ".profile-request-room-entry",
    ".request-room-page",
    ".request-card",
    ".request-compose-form",
  ]) {
    assert.match(prototypeStyles, new RegExp(className.replace(".", "\\.")));
  }
});
