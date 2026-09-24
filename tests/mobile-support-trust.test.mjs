import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const supportSource = readFileSync(new URL("../apps/mobile/src/features/profile/ProfileSectionScreen.tsx", import.meta.url), "utf8");

test("customer support does not promise unconfirmed operating hours or prelaunch shipping", () => {
  assert.doesNotMatch(supportSource, /평일 10:00–17:00/);
  assert.match(supportSource, /function Support[\s\S]*?useCommerceCapability\(\)/);
  assert.match(supportSource, /commerceEnabled\s*\?\s*"보관함에 보관 중인 상품을 선택해 배송 신청할 수 있어요\."/);
  assert.match(supportSource, /"사전오픈 기간에는 배송 신청을 이용할 수 없어요\."/);
  assert.match(supportSource, /commerceEnabled\s*\?\s*<Faq title="교환 중인 상품도 배송할 수 있나요\?"/);
});
