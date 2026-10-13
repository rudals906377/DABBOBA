import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { isPointReturnEligibleInventory } from "../apps/mobile/src/features/profile/point-return-eligibility.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profileSectionSource = readFileSync(
  path.join(root, "apps/mobile/src/features/profile/ProfileSectionScreen.tsx"),
  "utf8",
);
const profilePolicySource = readFileSync(
  path.join(root, "apps/mobile/src/features/profile/profile-policies.ts"),
  "utf8",
);

function inventory({ sourceType, status = "OWNED", category = "gacha", pointReturnEligible = true, pointReturnAmount = 500 }) {
  return {
    id: `${sourceType}-${status}-${category}`,
    sourceType,
    status,
    pointReturnEligible,
    pointReturnAmount,
    product: { category },
  };
}

test("point return admits only owned inventory whose source is a gacha draw", () => {
  for (const category of ["gacha", "kuji", "figure", "tcg"]) {
    assert.equal(isPointReturnEligibleInventory(inventory({ sourceType: "GACHA", category })), true);
  }

  for (const sourceType of ["KUJI", "PURCHASE", "ADMIN_ADJUSTMENT"]) {
    assert.equal(isPointReturnEligibleInventory(inventory({ sourceType })), false);
  }

  assert.equal(isPointReturnEligibleInventory(inventory({
    sourceType: "GACHA",
    pointReturnEligible: false,
  })), false);
  assert.equal(isPointReturnEligibleInventory(inventory({ sourceType: "GACHA", pointReturnAmount: 0 })), false);
  assert.equal(isPointReturnEligibleInventory(inventory({ sourceType: "GACHA", pointReturnAmount: null })), false);

  for (const status of [
    "EXCHANGE_LISTED",
    "EXCHANGE_OFFERED",
    "SHIPPING",
    "DELIVERED",
    "TRANSFERRED",
    "REFUNDED",
    "POINT_RETURNED",
    "EXPIRED_HOLD",
  ]) {
    assert.equal(isPointReturnEligibleInventory(inventory({ sourceType: "GACHA", status })), false);
  }

});

test("storage includes selected purchases and exchange while point returns stay hidden", () => {
  assert.match(profileSectionSource, /storedDrawItems = useMemo\([\s\S]*?inventory\?\.filter\(isStoredDrawInventory\)/);
  assert.match(profileSectionSource, /<Shipping[^>]*items=\{storedDrawItems\}/);
  assert.match(profileSectionSource, /item\.sourceType === "PURCHASE"/);
  assert.doesNotMatch(profileSectionSource, /<PointReturn[\s>]/);
  assert.doesNotMatch(profileSectionSource, /<StorageModeTab label="포인트 환급"/);
  assert.match(profileSectionSource, /<ExchangeOrShipping[^>]*items=\{exchangeOrShippingItems\}/);
  assert.match(profileSectionSource, /<StorageModeTab label="교환 또는 배송 중인 상품"/);
  assert.match(profilePolicySource, /본인이 구매해 획득하고 현재 보관 중인 적격 상품은 교환방에서 교환/);
  assert.match(profilePolicySource, /포인트로 전환하지 않습니다/);
});
