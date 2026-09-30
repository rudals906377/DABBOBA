import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { allowedReviewTransition, allowedShippingTransition, shippingFeeAllowsDispatch } from "./admin-commerce.js";

test("shipping operations expose only the approved forward and cancellation transitions", () => {
  assert.equal(allowedShippingTransition("REQUESTED", "PROCESSING"), true);
  assert.equal(allowedShippingTransition("REQUESTED", "CANCELLED"), true);
  assert.equal(allowedShippingTransition("PROCESSING", "SHIPPED"), true);
  assert.equal(allowedShippingTransition("PROCESSING", "CANCELLED"), true);
  assert.equal(allowedShippingTransition("SHIPPED", "DELIVERED"), true);

  assert.equal(allowedShippingTransition("REQUESTED", "SHIPPED"), false);
  assert.equal(allowedShippingTransition("PROCESSING", "DELIVERED"), false);
  assert.equal(allowedShippingTransition("SHIPPED", "CANCELLED"), false);
  assert.equal(allowedShippingTransition("DELIVERED", "PROCESSING"), false);
  assert.equal(allowedShippingTransition("CANCELLED", "PROCESSING"), false);
});

test("a shipping request moves forward only while its fee order is settled", () => {
  for (const to of ["PROCESSING", "SHIPPED", "DELIVERED"] as const) {
    assert.equal(shippingFeeAllowsDispatch(null, to), true, "free shipping has no fee order");
    assert.equal(shippingFeeAllowsDispatch("PAID", to), true);
    assert.equal(shippingFeeAllowsDispatch("FULFILLED", to), true);
    for (const unsettled of ["PENDING_PAYMENT", "REFUND_REVIEW", "REFUNDED", "CANCELLED", "EXPIRED"]) {
      assert.equal(shippingFeeAllowsDispatch(unsettled, to), false, `${unsettled} → ${to}`);
    }
  }
  assert.equal(shippingFeeAllowsDispatch("REFUND_REVIEW", "CANCELLED"), true);
});

test("refund review states follow an explicit non-reopenable operations workflow", () => {
  assert.equal(allowedReviewTransition("PENDING", "IN_REVIEW"), true);
  assert.equal(allowedReviewTransition("PENDING", "WAITING_PROVIDER"), false);
  assert.equal(allowedReviewTransition("IN_REVIEW", "WAITING_PROVIDER"), true);
  assert.equal(allowedReviewTransition("WAITING_PROVIDER", "IN_REVIEW"), true);
  assert.equal(allowedReviewTransition("ESCALATED", "WAITING_PROVIDER"), true);
  assert.equal(allowedReviewTransition("IN_REVIEW", "PENDING"), false);
  assert.equal(allowedReviewTransition("CLOSED", "IN_REVIEW"), false);
  assert.equal(allowedReviewTransition("CLOSED", "CLOSED"), true);
});

test("commerce operations migration keeps stock and shipping history append-only", async () => {
  const migration = await readFile(new URL("../../../../packages/db/migrations/0011_admin_commerce_operations.sql", import.meta.url), "utf8");
  assert.match(migration, /product_stock_adjustment_ledger_immutable/);
  assert.match(migration, /shipping_status_events_immutable/);
  assert.match(migration, /DROP INDEX admin_audit_logs_idempotency_idx/);
  assert.doesNotMatch(migration, /UNIQUE \(admin_id, idempotency_key\)/);
  assert.match(migration, /shipping_requests_tracking_state_check[\s\S]*NOT VALID/);
  assert.match(migration, /Invalid shipping request transition/);
  assert.match(migration, /\('ADMIN','shipping\.manage'\)/);
  assert.match(migration, /\('ADMIN','shipping\.destination\.read'\)/);
  assert.doesNotMatch(migration, /\('ADMIN','inventory\.adjust'\)/);
});

test("shipping terminal inventory migration adds delivered state and repairs existing terminal requests", async () => {
  const migration = await readFile(
    new URL("../../../../packages/db/migrations/0013_shipping_inventory_terminal_states.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /inventory_units_status_check/);
  assert.match(migration, /'SHIPPING',[\s\S]*'DELIVERED',[\s\S]*'TRANSFERRED'/);
  assert.match(migration, /WHEN 'CANCELLED' THEN 'OWNED'/);
  assert.match(migration, /WHEN 'DELIVERED' THEN 'DELIVERED'/);
  assert.match(migration, /inventory\.status = 'SHIPPING'/);
  assert.match(migration, /VALIDATE CONSTRAINT inventory_units_status_check/);
});
