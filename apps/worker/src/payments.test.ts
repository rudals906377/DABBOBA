import assert from "node:assert/strict";
import test from "node:test";
import { requiresManualPaymentAction } from "./payments.js";

test("reconciliation observations never imply an automatic ledger mutation", () => {
  assert.equal(requiresManualPaymentAction("PENDING", "UNKNOWN"), false);
  assert.equal(requiresManualPaymentAction("PENDING", "PENDING"), false);
  assert.equal(requiresManualPaymentAction("PENDING", "PAID"), true);
  assert.equal(requiresManualPaymentAction("REFUND_REVIEW", "REFUNDED"), true);
});
