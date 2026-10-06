import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ts = createRequire(path.join(root, "apps/mobile/package.json"))("typescript");
const modules = new Map();
function load(relativePath) {
  if (modules.has(relativePath)) return modules.get(relativePath);
  const source = readFileSync(path.join(root, relativePath), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const require = (specifier) => {
    assert.equal(specifier, "@/features/checkout/checkout-reference-notices");
    return load("apps/mobile/src/features/checkout/checkout-reference-notices.ts");
  };
  vm.runInNewContext(code, { module, exports: module.exports, require });
  modules.set(relativePath, module.exports);
  return module.exports;
}
const notices = load("apps/mobile/src/features/checkout/checkout-reference-notices.ts");
const policies = load("apps/mobile/src/features/profile/profile-policies.ts");

test("approved 2–5 business-day delivery notice is shared by detail, checkout and settings policies", () => {
  assert.match(notices.deliveryPeriodNotice, /배송 신청 접수 후 배송 완료까지 영업일 기준 2~5일/);
  assert.match(notices.deliveryPeriodNotice, /주말·공휴일/);
  for (const category of ["gacha", "kuji"]) {
    assert.ok(JSON.stringify(notices.checkoutNoticeSections(category)).includes(notices.deliveryPeriodNotice));
  }
  assert.ok(JSON.stringify(policies.findProfilePolicy("shipping-storage")).includes(notices.deliveryPeriodNotice));
  const detail = readFileSync(path.join(root, "apps/mobile/src/features/shop/ProductDetailScreen.tsx"), "utf8");
  const checkout = readFileSync(path.join(root, "apps/mobile/src/features/checkout/CheckoutNoticeSections.tsx"), "utf8");
  assert.match(detail, /checkoutNoticeSections\(category\)/);
  assert.match(checkout, /checkoutNoticeSections\(category\)/);
});

test("gacha and kuji purchase notices explain cancellation and refund separately from point return", () => {
  for (const category of ["gacha", "kuji"]) {
    const sections = notices.checkoutNoticeSections(category);
    const copy = JSON.stringify(sections);
    assert.match(copy, /취소·환불 규정/);
    assert.match(copy, /뽑기 권리를 사용하지 않은 주문은 고객센터로 취소를 요청하면 전액 취소합니다/);
    assert.match(copy, /기존 결제 수단/);
    assert.match(copy, /주문에 사용한 포인트는 포인트로 되돌려 드립니다/);
    assert.match(copy, /7일 이내/);
    assert.match(copy, /3영업일 이내/);
    assert.match(copy, /법령상 청약철회/);
    assert.match(copy, /하자·파손·오배송/);
    assert.match(copy, /고객센터/);
    assert.match(copy, /경품 상품의 기준금액/);
    assert.doesNotMatch(copy, /구매 당시 1회 판매가 50%/);
  }
});

test("profile exposes the same cancellation and post-delivery policy without blanket refund denial", () => {
  const policy = policies.findProfilePolicy("purchase-cancellation");
  assert.ok(policy);
  const copy = JSON.stringify(policy.sections);
  for (const item of [...notices.cancellationRefundNotices, ...notices.postShippingNotices]) {
    assert.ok(copy.includes(item.text));
  }
  const shipping = policies.findProfilePolicy("shipping-storage");
  assert.doesNotMatch(JSON.stringify(shipping), /수령한 상품은 교환, 환불 또는 포인트 환급 대상이 아닙니다/);
  assert.match(JSON.stringify(shipping), /하자·파손·오배송/);
  assert.match(JSON.stringify(shipping), /60일/);
  const memberScreen = readFileSync(path.join(root, "apps/mobile/src/features/profile/ProfileMemberDetailScreen.tsx"), "utf8");
  assert.match(memberScreen, /policyId="purchase-cancellation"/);
});
