import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const source = readFileSync(
  fileURLToPath(new URL("../migrations/0043_exchange_customer_lifecycle.sql", import.meta.url)),
  "utf8",
);

test("exchange listings expire seven days after creation", () => {
  assert.match(source, /expires_at = created_at \+ interval '7 days'/);
  assert.match(source, /WHERE status = 'OPEN'/);
});

test("inventory has a durable storage deadline", () => {
  assert.match(source, /storage_expires_at = acquired_at \+ interval '45 days'/);
  assert.match(source, /inventory_units_storage_expiry_idx/);
});
