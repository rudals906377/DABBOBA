import assert from "node:assert/strict";
import test from "node:test";
import { normalizedPaymentCustomerName } from "../apps/mobile/src/features/checkout/payment-customer.ts";

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
