import assert from "node:assert/strict";
import test from "node:test";
import { reservationExpiryAction } from "./reservations.js";

test("only unpaid pending or already-cancelled orders release expired reservations", () => {
  assert.equal(reservationExpiryAction("PENDING_PAYMENT", "PENDING", true), "release");
  assert.equal(reservationExpiryAction("CANCELLED", "FAILED", true), "release");
  assert.equal(reservationExpiryAction("PENDING_PAYMENT", "PENDING", false), "wait");
});

test("authorized or paid reservations are never released by the expiry sweeper", () => {
  assert.equal(reservationExpiryAction("PENDING_PAYMENT", "AUTHORIZED", true), "reconcile");
  assert.equal(reservationExpiryAction("PAID", "PAID", true), "reconcile");
  assert.equal(reservationExpiryAction("REFUND_REVIEW", "REFUND_REVIEW", true), "reconcile");
});
