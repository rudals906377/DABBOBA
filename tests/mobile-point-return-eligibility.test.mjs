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

test("storage keeps kuji for shipping while point return receives only the gacha subset", () => {
  assert.match(
    profileSectionSource,
    /storedDrawItems = useMemo\([\s\S]*?inventory\?\.filter\(isStoredDrawInventory\)/,
  );
  assert.match(
    profileSectionSource,
    /pointReturnItems = useMemo\([\s\S]*?inventory\?\.filter\(isPointReturnEligibleInventory\)/,
  );
  assert.match(
    profileSectionSource,
    /<Shipping[^>]*items=\{storedDrawItems\}/,
  );
  assert.match(
    profileSectionSource,
    /<PointReturn[^>]*items=\{pointReturnItems\}/,
  );
  assert.match(profileSectionSource, /<StorageModeTab label="포인트 환급" count=\{pointReturnItems\?\.length \?\? null\}/);
  assert.match(profileSectionSource, /<ExchangeOrShipping[^>]*items=\{exchangeOrShippingItems\}/);
  assert.match(profileSectionSource, /<StorageModeTab label="교환 또는 배송 중인 상품" count=\{exchangeOrShippingItems\?\.length \?\? null\}/);
  assert.doesNotMatch(profileSectionSource, /AvailabilityPill|storageAvailabilityRow/);
  assert.match(profileSectionSource, /<PointReturn[^>]*items=\{pointReturnItems\}/);
  assert.match(
    profileSectionSource,
    /교환으로 받은 상품은 포인트 환급 대상이 아니며, 본인이 가챠에서 직접 뽑아 보관 중인 상품만 가능해요/,
  );
  assert.match(
    profileSectionSource,
    /createPointReturn\([\s\S]*?selectedInventoryUnitIds/,
  );
  assert.match(
    profilePolicySource,
    /교환으로 받은 상품은 포인트 환급 대상이 아니며, 포인트 환급은 본인이 가챠에서 직접 뽑아 현재 보관 중인 상품만 가능합니다\. 쿠지 추첨 상품과 피규어 등 일반 구매 상품도 대상이 아닙니다/,
  );
  assert.match(
    profilePolicySource,
    /교환 등록과 제안에는 본인이 가챠에서 직접 뽑아 현재 보관 중인 상품만 각각 한두 개까지 사용할 수 있습니다/,
  );
});
