import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobile = path.join(root, "apps/mobile");
const read = (relativePath) => readFileSync(path.join(mobile, relativePath), "utf8");

const ROUTES = [
  "app/profile/orders/[orderId].tsx",
  "app/profile/shipping/[shippingRequestId].tsx",
  "app/profile/notices/[noticeId].tsx",
];

test("order, shipping, and notice records have native detail routes", () => {
  for (const route of ROUTES) {
    assert.equal(existsSync(path.join(mobile, route)), true, `${route} is missing`);
  }

  assert.match(read(ROUTES[0]), /ProfileOrderDetailScreen/);
  assert.match(read(ROUTES[1]), /ProfileShippingDetailScreen/);
  assert.match(read(ROUTES[2]), /ProfileNoticeDetailScreen/);
});

test("profile record details preserve native framing and list-backed fallback data", () => {
  const source = read("src/features/profile/ProfileRecordDetailScreen.tsx");

  assert.match(source, /KoreanPixelTitle/);
  assert.match(source, /seed\.spacing\.globalGutter/);
  assert.match(source, /edges=\{\["top", "bottom", "left", "right"\]\}/);
  assert.match(source, /snapshot\?\.orders\.find/);
  assert.match(source, /snapshot\?\.shippingRequests\.find/);
  assert.match(source, /snapshot\?\.notices\.find/);
  assert.match(source, /notice\.content/);
  assert.doesNotMatch(source, /RootFloatingTabBar/);
});

test("authenticated shipping detail uses the owned-request endpoint", () => {
  const apiSource = read("src/features/profile/profile-detail-api.ts");
  const screenSource = read("src/features/profile/ProfileRecordDetailScreen.tsx");

  assert.match(apiSource, /\/v1\/account\/shipping-requests\/\{shippingRequestId\}/);
  assert.match(apiSource, /token:\s*\(\)\s*=>\s*accessToken/);
  assert.match(apiSource, /path:\s*\{\s*shippingRequestId\s*\}/);
  assert.match(apiSource, /new ProfileApiError\(/);
  assert.match(screenSource, /profileState\.status === "authenticated"/);
  assert.match(screenSource, /currentTokens\?\.accessToken !== requestedAccessToken/);
  assert.match(screenSource, /generation !== detailGeneration\.current/);
  assert.match(screenSource, /setDetailExpired\(true\)/);
  assert.match(screenSource, /profileState\.publicLoading \|\| \(!snapshot && !profileState\.message\)/);
  assert.match(screenSource, /!profileState\.message && !profileState\.publicLoading/);
});

test("record product summaries keep category-safe artwork and the shared catalog text scale", () => {
  const source = read("src/features/profile/ProfileRecordDetailScreen.tsx");

  assert.match(source, /resizeMode=\{item\.category === "kuji" \? "contain" : "cover"\}/);
  assert.match(source, /eyebrow:\s*\{[^}]*seed\.typography\.catalogMetadata/);
  assert.match(source, /productName:\s*\{[^}]*seed\.typography\.catalogTitle/);
  assert.match(source, /shippingProductName:\s*\{[^}]*seed\.typography\.catalogTitle/);
});

test("order and shipping history expose customer-safe status and address semantics", () => {
  const sectionSource = read("src/features/profile/ProfileSectionScreen.tsx");
  const detailSource = read("src/features/profile/ProfileRecordDetailScreen.tsx");

  assert.match(sectionSource, /status === "PAID" \|\| status === "FULFILLED"\) return styles\.statusBadgeSuccess/);
  assert.match(sectionSource, /status === "CANCELLED"\) return styles\.statusBadgeCritical/);
  assert.match(sectionSource, /status === "REFUND_REVIEW" \|\| status === "REFUNDED"\) return styles\.statusBadgeRefund/);
  assert.match(sectionSource, /compactShippingDestination\(request\.destination\.addressLine1\)/);
  assert.match(sectionSource, /상세주소 숨김/);
  assert.doesNotMatch(sectionSource, /작품 정보 확인 중/);

  assert.match(detailSource, /fullShippingDestination\(/);
  assert.match(detailSource, /\[\$\{postalCode\}\] \$\{primary\}/);
  assert.match(detailSource, /배송지 정보를 확인해 주세요/);
  assert.doesNotMatch(detailSource, /작품 정보 확인 중/);
});
