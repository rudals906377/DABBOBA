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

test("bundled exchange and request fixtures stay empty until server records exist", () => {
  assert.deepEqual(REQUEST_CATEGORY_IDS, ["gacha", "kuji", "figure"]);
  assert.deepEqual(ipCatalog, []);
  assert.deepEqual(DEFAULT_EXCHANGE_POSTS, []);
  assert.deepEqual(DEFAULT_EXCHANGE_APPLICATIONS, {});
  assert.deepEqual(DEFAULT_PRODUCT_REQUESTS, []);
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
  assert.match(exchangeRoomPage, /eligibleDrawExchangeProposalUnits\(sessionCommerce, currentUserId\)/);
  assert.match(exchangeRoomPage, /exchangePosts\.filter\(\(post\) => post\.sourceType === "GACHA"\)/);
  assert.match(exchangeRoomPage, /offeredSuggestionsOpen \? \(\s*<ExchangeSuggestionList/);
  assert.doesNotMatch(exchangeRoomPage, /draftWanted|wantedCatalogItemIds|원하는 교환품/);
  assert.match(exchangeRoomPage, /className="exchange-listing-product"/);
  assert.match(exchangeRoomPage, /post\.authorId === currentUserId/);
  assert.match(exchangeRoomPage, /exchangePriceLabel\(post\.appReferenceValue\)/);
  assert.match(exchangeRoomPage, /<KeyboardInput\b[\s\S]*?<KeyboardInput\b[\s\S]*?<KeyboardTextarea\b/);
});

test("exchange autocomplete starts empty until authenticated catalog and inventory records exist", () => {
  const itemIds = new Set(POPULAR_EXCHANGE_CATALOG_ITEMS.map((item) => item.id));
  assert.equal(itemIds.size, POPULAR_EXCHANGE_CATALOG_ITEMS.length);
  const eligibleInventory = eligibleSessionInventoryUnits(createInitialSessionCommerceState());
  assert.deepEqual(POPULAR_EXCHANGE_CATALOG_ITEMS, []);
  assert.deepEqual(eligibleInventory, []);

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
  assert.match(detailPage, /application\.sourceType === "GACHA"/);
  assert.match(detailPage, /post\.offeredItem/);
  assert.doesNotMatch(detailPage, /post\.wantedItems|원하는 교환품/);
  assert.match(detailPage, /application\.offeredItemImage/);
  assert.match(detailPage, /addExchangeApplication\(post\.id, \{[\s\S]*?offeredInventoryUnitId:[\s\S]*?offeredCatalogItemId:[\s\S]*?ipId:[\s\S]*?categoryId:[\s\S]*?offeredItemImage:[\s\S]*?appReferenceValue:/);
  assert.doesNotMatch(detailPage, /application\.message|draftMessage|message:\s*draft/);
  assert.match(detailPage, /sessionCommerce\.exchangeApplicationDecisions/);
  assert.match(detailPage, /exchangeDecisionKey\(post\.id, application\.id\)/);
  assert.match(detailPage, /post\.authorId === currentUserId/);
  assert.match(detailPage, /handleDecision\(application\.id, "rejected"\)/);
  assert.match(detailPage, /handleDecision\(application\.id, "accepted"\)/);
  assert.match(detailPage, /decideExchangeApplication\(post\.id, applicationId, decision, key\)/);
  assert.match(detailPage, /<KeyboardInput\b/);
  assert.doesNotMatch(detailPage, /<KeyboardTextarea\b/);
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
  assert.match(requestRoomPage, /productRequests\.filter\(\(request\)\s*=>\s*\([\s\S]*?isCustomerVisibleProductCategory\(request\.categoryId\)[\s\S]*?\)\)/);
  assert.match(requestRoomPage, /customerVisibleRequests\.filter\(\(request\)\s*=>\s*request\.categoryId\s*===\s*filter\)/);
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
