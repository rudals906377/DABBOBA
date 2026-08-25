import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  commerceModeForCategory,
  isRandomDrawCategory,
} from "../src/domain/catalog.ts";
import { DEFAULT_MEMBER_SETTINGS } from "../src/data/profileFixtures.ts";
import { CURRENT_USER_ID } from "../src/data/sessionCommerceFixtures.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prototypeSource = readFileSync(path.join(root, "src/Prototype.tsx"), "utf8");
const prototypeStyles = readFileSync(path.join(root, "src/prototype.css"), "utf8");
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
  assert.match(prototypeSource, /id:\s*CURRENT_USER_ID/);
  assert.equal(CURRENT_USER_ID, "user-dabboba-demo-01");
  assert.match(detailPage, /const \{\s*profile,\s*setProfile,\s*setProfileSaveNotice\s*\}\s*=\s*useDabboba\(\)/);
});

test("profile detail uses keyboard-aware fields and saves before returning", () => {
  const detailPage = functionBlock(prototypeSource, "ProfileDetailPage");

  assert.match(detailPage, /<KeyboardInput\b/);
  assert.match(detailPage, /<KeyboardTextarea\b/);
  assert.match(detailPage, /<ActionButton[\s\S]*?type="submit"[\s\S]*?>[\s\S]*?저장하기[\s\S]*?<\/ActionButton>/);
  assert.match(detailPage, /setProfile\(\{[\s\S]*?id:\s*profile\.id,[\s\S]*?nickname:\s*nextNickname,[\s\S]*?bio:[\s\S]*?favoriteIpId,[\s\S]*?\}\)/);

  const hideIndex = detailPage.indexOf("keyboard.hide()");
  const saveIndex = detailPage.indexOf("setProfile({");
  const popIndex = detailPage.indexOf("flow.pop()");
  assert.ok(hideIndex >= 0 && hideIndex < saveIndex, "the keyboard must hide before profile state is saved");
  assert.ok(saveIndex >= 0 && saveIndex < popIndex, "profile state must save before the detail screen pops");
  assert.match(detailPage, /setProfileSaveNotice\("프로필을 저장했어요\."\)/);
  assert.match(prototypeSource, /profileSaveNotice \? <p className="profile-message" role="status">\{profileSaveNotice\}<\/p> : null/);
});

test("profile management opens a footer-free member information hub with dedicated settings pages", () => {
  const profileDetail = functionBlock(prototypeSource, "ProfileDetailPage");
  const memberHub = functionBlock(prototypeSource, "MemberInfoPage");
  const routes = [
    ["createMemberInfoScreen", "profile-member-info", "회원정보 변경", "MemberInfoPage"],
    ["createPersonalInformationScreen", "profile-personal-information", "개인정보", "PersonalInformationPage"],
    ["createPhoneNumberScreen", "profile-phone-number", "휴대폰 번호", "PhoneNumberPage"],
    ["createEmailAddressScreen", "profile-email-address", "이메일", "EmailAddressPage"],
    ["createDefaultAddressScreen", "profile-default-address", "기본 배송지", "DefaultAddressPage"],
    ["createPaymentCardsScreen", "profile-payment-cards", "결제 카드", "PaymentCardsPage"],
    ["createPaymentPreferencesScreen", "profile-payment-preferences", "결제 설정", "PaymentPreferencesPage"],
    ["createLoginSecurityScreen", "profile-login-security", "로그인 및 보안", "LoginSecurityPage"],
    ["createPrivacySettingsScreen", "profile-privacy-settings", "개인정보 및 수신 동의", "PrivacySettingsPage"],
  ];

  assert.match(profileDetail, /aria-label="회원정보 변경 열기"/);
  assert.match(profileDetail, /flow\.push\(createMemberInfoScreen\(\)\)/);
  assert.match(memberHub, /createPersonalInformationScreen/);
  assert.match(memberHub, /createPhoneNumberScreen/);
  assert.match(memberHub, /createEmailAddressScreen/);
  assert.match(memberHub, /createDefaultAddressScreen/);
  assert.match(memberHub, /createPaymentCardsScreen/);
  assert.match(memberHub, /createPaymentPreferencesScreen/);
  assert.match(memberHub, /createLoginSecurityScreen/);
  assert.match(memberHub, /createPrivacySettingsScreen/);

  for (const [functionName, screenId, title, pageName] of routes) {
    const screen = functionBlock(prototypeSource, functionName);
    assert.match(screen, new RegExp(`id:\\s*"${screenId}"`));
    assert.match(screen, new RegExp(`<BackHeader\\s+title="${title}"\\s+onBack=\\{flow\\.pop\\}\\s*\\/>`));
    assert.match(screen, new RegExp(`<${pageName}`));
    assert.doesNotMatch(screen, /RootTabFooter|AppBottomNavigation|\bfooter:/);
  }
});

test("member settings keep complete local account data and avoid storing payment or password secrets", () => {
  assert.match(prototypeSource, /memberSettings:\s*MemberSettings;/);
  assert.match(
    prototypeSource,
    /const \[memberSettings, setMemberSettings\]\s*=\s*useState<MemberSettings>\(\(\) => \([\s\S]*?apiRuntime\.client\.remoteEnabled \? EMPTY_REMOTE_MEMBER_SETTINGS : DEFAULT_MEMBER_SETTINGS[\s\S]*?\)\)/,
  );
  assert.match(prototypeSource, /const EMPTY_REMOTE_MEMBER_SETTINGS: MemberSettings = \{[\s\S]*?personal: \{ legalName: "", email: "", phone: "", birthDate: "" \}[\s\S]*?paymentCard: null/);
  assert.equal(DEFAULT_MEMBER_SETTINGS.personal.phone.length, 11);
  assert.equal(DEFAULT_MEMBER_SETTINGS.defaultAddress.postalCode.length, 5);
  assert.match(DEFAULT_MEMBER_SETTINGS.paymentCard?.last4 ?? "", /^\d{4}$/);

  const personalPage = functionBlock(prototypeSource, "PersonalInformationPage");
  const addressPage = functionBlock(prototypeSource, "DefaultAddressPage");
  const cardPage = functionBlock(prototypeSource, "PaymentCardsPage");
  const securityPage = functionBlock(prototypeSource, "LoginSecurityPage");
  const privacyPage = functionBlock(prototypeSource, "PrivacySettingsPage");

  assert.match(personalPage, /<KeyboardInput/g);
  assert.match(addressPage, /<KeyboardInput/g);
  assert.match(cardPage, /last4/);
  assert.doesNotMatch(cardPage, /setCardNumber|setCvc|name="cvc"/i);
  assert.match(securityPage, /setNewPassword\(""\)/);
  assert.match(securityPage, /setConfirmPassword\(""\)/);
  assert.doesNotMatch(securityPage, /security:\s*\{[^}]*password:/);
  assert.match(privacyPage, /role="switch"/);

  for (const className of [
    ".member-info-entry",
    ".member-settings-page",
    ".member-settings-list",
    ".member-settings-form",
    ".member-switch-row",
  ]) {
    assert.match(prototypeStyles, new RegExp(className.replace(".", "\\.")));
  }
});

test("every profile utility item opens a dedicated footer-free screen", () => {
  const profilePage = functionBlock(prototypeSource, "ProfilePage");
  const screens = [
    ["createWishlistScreen", "profile-wishlist", "내 찜 목록", "WishlistPage"],
    ["createStorageScreen", "profile-storage", "보관함", "StoragePage"],
    ["createShippingRequestScreen", "profile-shipping-request", "배송 신청", "ShippingRequestPage"],
    ["createPurchaseHistoryScreen", "profile-purchase-history", "구매 내역", "PurchaseHistoryPage"],
    ["createPointHistoryScreen", "profile-point-history", "포인트 내역", "PointHistoryPage"],
  ];

  assert.match(profilePage, /PROFILE_MENU_ITEMS\.map\(\(menu\)\s*=>/);
  assert.match(profilePage, /flow\.push\(menu\.createScreen\(\)\)/);

  for (const [functionName, screenId, title, pageName] of screens) {
    const screen = functionBlock(prototypeSource, functionName);
    assert.match(screen, new RegExp(`id:\\s*"${screenId}"`));
    assert.match(screen, new RegExp(`<BackHeader\\s+title="${title}"\\s+onBack=\\{flow\\.pop\\}\\s*\\/>`));
    assert.match(screen, new RegExp(`<${pageName}`));
    assert.doesNotMatch(screen, /RootTabFooter|AppBottomNavigation|\bfooter:/);
  }

  const wishlistPage = functionBlock(prototypeSource, "WishlistPage");
  const storagePage = functionBlock(prototypeSource, "StoragePage");
  const shippingPage = functionBlock(prototypeSource, "ShippingRequestPage");
  const purchasePage = functionBlock(prototypeSource, "PurchaseHistoryPage");
  const pointPage = functionBlock(prototypeSource, "PointHistoryPage");

  assert.match(wishlistPage, /sessionCommerce\.wishlistProductIds/);
  assert.match(wishlistPage, /<ProductGrid\s+flow=\{flow\}\s+items=\{favoriteProducts\}\s*\/>/);
  assert.match(storagePage, /sessionCommerce\.inventoryUnits\.filter/);
  assert.match(storagePage, /flow\.push\(createDetailScreen\(product\)\)/);
  assert.match(shippingPage, /role="checkbox"/);
  assert.match(shippingPage, /requestShipping\(\{/);
  assert.match(shippingPage, /배송 신청하기/);
  assert.match(purchasePage, /sessionCommerce\.orders\.map/);
  assert.match(pointPage, /sessionCommerce\.pointLedger\.map/);

  for (const className of [
    ".profile-subpage",
    ".profile-storage-card",
    ".profile-shipping-item",
    ".profile-order-card",
    ".profile-point-row",
  ]) {
    assert.match(prototypeStyles, new RegExp(className.replace(".", "\\.")));
  }
});

test("checkout confirms payment before an explicit draw or catalog action", () => {
  const checkoutFooter = functionBlock(prototypeSource, "CheckoutFooter");

  assert.match(
    checkoutFooter,
    /const drawMode\s*=\s*isRandomDrawCategory\(product\.categoryId\)/,
  );
  assert.match(
    checkoutFooter,
    /recordOrder\(\{[\s\S]*?id:\s*orderId,[\s\S]*?pointsUsed:\s*points,[\s\S]*?status:\s*drawMode \? "결제 완료" : "배송 신청 전"[\s\S]*?if \(!drawMode\)[\s\S]*?recordInventoryUnit\([\s\S]*?if \(drawMode\) prepareDraw\(quantity\);[\s\S]*?flow\.replace\(createPurchaseCompleteScreen\(product, quantity, total, orderId\)\);/,
  );
  assert.doesNotMatch(checkoutFooter, /createDrawScreen/);
});

test("purchase completion exposes the draw CTA only after confirmation and never mounts the root footer", () => {
  const screen = functionBlock(prototypeSource, "createPurchaseCompleteScreen");
  const page = functionBlock(prototypeSource, "PurchaseCompletePage");
  const footer = functionBlock(prototypeSource, "PurchaseCompleteFooter");

  assert.match(screen, /id:\s*`purchase-complete-\$\{product\.id\}`/);
  assert.match(screen, /footer:\s*\(flow\)\s*=>\s*<PurchaseCompleteFooter\s+flow=\{flow\}\s+product=\{product\}\s+quantity=\{quantity\}\s+orderId=\{orderId\}\s+drawEntitlementIds=\{drawEntitlementIds\}\s*\/>/);
  assert.match(
    screen,
    /render:\s*\(\)\s*=>\s*<PurchaseCompletePage\s+product=\{product\}\s+quantity=\{quantity\}\s+paidTotal=\{paidTotal\}\s+orderId=\{orderId\}\s*\/>/,
  );

  assert.match(page, /product\.categoryId === "gacha" \? "가챠하러 가기" : "쿠지 추첨하러 가기"/);
  assert.match(footer, /if \(drawMode\) \{[\s\S]*?flow\.replace\(createDrawScreen\(product, quantity, orderId, drawEntitlementIds\)\);[\s\S]*?return;/);
  assert.match(footer, /returnToCatalog\(flow\)/);
  assert.match(footer, /\{drawMode \? drawActionLabel : "상품 목록으로"\}/);

  for (const block of [screen, page, footer]) {
    assert.doesNotMatch(block, /RootTabFooter|AppBottomNavigation/);
  }
  assert.doesNotMatch(page, /DrawPage|DrawFooter|createDrawScreen/);
});

test("each draw result records one exact inventory unit and completes its existing order", () => {
  const drawScreen = functionBlock(prototypeSource, "createDrawScreen");
  const drawFooter = functionBlock(prototypeSource, "DrawFooter");

  assert.match(drawScreen, /<DrawFooter\s+flow=\{flow\}\s+product=\{product\}\s+quantity=\{quantity\}\s+orderId=\{orderId\}/);
  assert.match(drawFooter, /const grade = serverResult\?\.rarity \?\? rollPrizeGrade\(\)/);
  assert.match(drawFooter, /id:\s*serverResult\?\.prizeInventoryUnitId \?\? `\$\{orderId\}-draw-\$\{drawNumber\}`/);
  assert.match(drawFooter, /itemName:\s*prizeProduct\?\.title \?\? \(serverResult \? `\$\{grade\} · \$\{serverResult\.prizeProductId\}` : `\$\{grade\}상 · \$\{rewardForGrade\(product, grade as PrizeGrade\)\}`\)/);
  assert.match(drawFooter, /itemImage:\s*prizeProduct\?\.asset \?\? product\.asset/);
  assert.match(drawFooter, /recordInventoryUnit\(\{/);
  assert.match(drawFooter, /if \(apiMode === "prototype" && drawRemaining <= 1\) updateOrderStatus\(orderId, "뽑기 완료"\)/);
  assert.match(drawFooter, /consumeDrawEntitlement\(entitlementId, `draw-entitlement-\$\{entitlementId\}`\)/);
});
