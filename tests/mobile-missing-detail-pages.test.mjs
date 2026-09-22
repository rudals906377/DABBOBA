import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobile = path.join(root, "apps/mobile");
const read = (relativePath) => readFileSync(path.join(mobile, relativePath), "utf8");

const REQUIRED_DETAIL_ROUTES = [
  "app/notifications/[notificationId].tsx",
  "app/profile/orders/[orderId].tsx",
  "app/profile/shipping/[shippingRequestId].tsx",
  "app/profile/requests/[requestId].tsx",
  "app/profile/requests/new.tsx",
  "app/profile/notices/[noticeId].tsx",
  "app/profile/inquiries/[inquiryId].tsx",
  "app/profile/inquiries/new.tsx",
  "app/profile/member/legal/[policyId].tsx",
  "app/profile/member/address/edit.tsx",
  "app/profile/member/personal/edit.tsx",
];

test("every visible truncated record or unfinished profile action has a native route", () => {
  for (const relativePath of REQUIRED_DETAIL_ROUTES) {
    assert.equal(existsSync(path.join(mobile, relativePath)), true, `${relativePath} is missing`);
  }
});

test("profile lists and actions navigate to their completed detail flows", () => {
  const sections = read("src/features/profile/ProfileSectionScreen.tsx");
  assert.match(sections, /\/profile\/orders\/\$\{encodeURIComponent\(order\.id\)\}/);
  assert.match(sections, /\/profile\/shipping\/\$\{encodeURIComponent\(request\.id\)\}/);
  assert.match(sections, /\/profile\/requests\/new/);
  assert.match(sections, /\/profile\/requests\/\$\{encodeURIComponent\(request\.id\)\}/);
  assert.match(sections, /\/profile\/notices\/\$\{encodeURIComponent\(notice\.id\)\}/);
  assert.match(sections, /\/profile\/inquiries\/new/);
  assert.match(sections, /\/profile\/inquiries\/\$\{encodeURIComponent\(inquiry\.id\)\}/);
  assert.doesNotMatch(sections, /신청 작성 준비 중|문의 기능을 준비/);
});

test("member actions open the account, address, and policy editors", () => {
  const member = read("src/features/profile/ProfileMemberDetailScreen.tsx");
  assert.match(member, /\/profile\/member\/personal\/edit/);
  assert.match(member, /\/profile\/member\/address\/edit/);
  assert.match(member, /\/profile\/member\/legal\/\$\{policyId\}/);
  assert.doesNotMatch(member, /배송지 등록을 준비하고 있어요/);
});
