import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("../migrations/0044_exchange_customer_lifecycle_runtime.sql", import.meta.url),
  "utf8",
);

test("exchange lifecycle constraints are validated and transfer reads stay least-privilege", () => {
  assert.match(sql, /VALIDATE CONSTRAINT exchange_listings_expiry_after_creation_check/);
  assert.match(sql, /VALIDATE CONSTRAINT inventory_units_storage_expiry_after_acquisition_check/);
  assert.match(sql, /GRANT SELECT ON TABLE public\.inventory_ownership_transfers TO dabboba_runtime/);
  assert.doesNotMatch(sql, /GRANT (?:INSERT|UPDATE|DELETE|ALL)/);
});
