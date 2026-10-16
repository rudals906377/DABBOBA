import assert from "node:assert/strict";
import test from "node:test";
import { normalizedPaymentCustomerName, normalizedPaymentOrderName } from "../apps/mobile/src/features/checkout/payment-customer.ts";

test("KG INICIS purchaser name is explicit and normalized, never invented", () => {
  assert.equal(normalizedPaymentCustomerName("  오   경민  "), "오 경민");
  assert.equal(normalizedPaymentCustomerName("Jane Doe"), "Jane Doe");
  assert.equal(normalizedPaymentCustomerName(" \n\t "), null);
  assert.equal(normalizedPaymentCustomerName("A".repeat(30)), "A".repeat(30));
  assert.equal(normalizedPaymentCustomerName("A".repeat(31)), null);
  assert.equal(normalizedPaymentCustomerName("가".repeat(10)), "가".repeat(10));
  assert.equal(normalizedPaymentCustomerName("가".repeat(11)), null);
  assert.equal(normalizedPaymentCustomerName("A".repeat(29) + "가"), null);
  assert.equal(normalizedPaymentCustomerName("홍길동\u0000"), null);
});

test("EasyPay never silently truncates buyer identity at its smaller byte limit", () => {
  assert.equal(normalizedPaymentCustomerName("A".repeat(20), "KICC_V2"), "A".repeat(20));
  assert.equal(normalizedPaymentCustomerName("A".repeat(21), "KICC_V2"), null);
  assert.equal(normalizedPaymentCustomerName("홍길동", "KICC_V2"), "홍길동");
  assert.equal(normalizedPaymentCustomerName("가".repeat(10), "NICE_V2"), "가".repeat(10));
});

test("native order names obey NICE and EasyPay byte limits without splitting Unicode", () => {
  for (const [pg, limit] of [["NICE_V2", 40], ["KICC_V2", 50]]) {
    const name = normalizedPaymentOrderName("귀멸의 칼날 피규어 😀".repeat(10), pg);
    assert.ok(Buffer.byteLength(name, "utf8") <= limit);
    assert.ok(name.startsWith("귀멸의 칼날"));
    assert.equal(/\p{Surrogate}/u.test(name), false);
  }
  assert.equal(normalizedPaymentOrderName("상품%&|$-+=[]\n이름", "NICE_V2"), "상품 이름");
  assert.equal(normalizedPaymentOrderName("%&|$-+=[]", "NICE_V2"), "다뽀바 상품");
  assert.equal(normalizedPaymentOrderName("다뽀바 배송비", "KICC_V2"), "다뽀바 배송비");
});
