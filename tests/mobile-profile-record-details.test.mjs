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
  const source = read("src/features/profile/profile-detail-api.ts");

  assert.match(source, /\/v1\/account\/shipping-requests\/\{shippingRequestId\}/);
  assert.match(source, /token:\s*\(\)\s*=>\s*accessToken/);
  assert.match(source, /path:\s*\{\s*shippingRequestId\s*\}/);
});
