import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const migration = readFileSync(
  fileURLToPath(new URL("../migrations/0052_shipping_fee_checkout.sql", import.meta.url)),
  "utf8",
);

test("shipping fee checkout stays non-operational until verified payment", () => {
  assert.match(migration, /'PAYMENT_PENDING','REQUESTED','PROCESSING','SHIPPED','DELIVERED','CANCELLED'/);
  assert.match(migration, /OLD\.status = 'PAYMENT_PENDING' AND NEW\.status IN \('REQUESTED','CANCELLED'\)/);
  assert.match(migration, /order_kind IN \('PRODUCT','SHIPPING_FEE'\)/);
  assert.match(migration, /order_kind = 'SHIPPING_FEE'[\s\S]*shipping_request_id IS NOT NULL[\s\S]*total = 3000/);
  assert.match(migration, /CREATE UNIQUE INDEX orders_shipping_request_payment_idx/);
});
