import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profileHomeSource = readFileSync(
  path.join(root, "apps/mobile/src/features/profile/ProfileHomeScreen.tsx"),
  "utf8",
);
const profileSectionSource = readFileSync(
  path.join(root, "apps/mobile/src/features/profile/ProfileSectionScreen.tsx"),
  "utf8",
);

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source boundary: ${start}`);
  assert.notEqual(endIndex, -1, `missing source boundary: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("shipping history moves from the storage task into a dedicated My Info entry", () => {
  assert.match(
    profileHomeSource,
    /section: "shipping", label: "배송 신청 내역"/,
  );
  assert.match(profileSectionSource, /shipping: \{ title: "배송 신청 내역" \}/);
  assert.match(profileSectionSource, /if \(section === "storage"\)[\s\S]*?<StorageHubContent/);
  assert.match(profileSectionSource, /if \(section === "shipping"\) return <ShippingHistory/);

  const shippingTask = sourceBetween(
    profileSectionSource,
    "function Shipping({",
    "function ShippingHistory({",
  );
  assert.doesNotMatch(shippingTask, /최근 배송 신청|배송 신청 내역이 없어요/);

  const shippingHistory = sourceBetween(
    profileSectionSource,
    "function ShippingHistory({",
    "function PointReturn({",
  );
  assert.match(shippingHistory, /\/profile\/shipping\/\$\{encodeURIComponent\(request\.id\)\}/);
  // The loaded history renders through the virtualized profile list.
  const shippingList = sourceBetween(
    profileSectionSource,
    'if (section === "shipping") {',
    'if (section === "orders") {',
  );
  assert.match(shippingList, /snapshot\.shippingRequests/);
  assert.match(shippingList, /<ShippingHistoryRow request=\{request\} \/>/);
  assert.match(shippingList, /배송 신청 내역이 없어요/);
});
