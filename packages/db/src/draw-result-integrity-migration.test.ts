import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = readFile(
  new URL("../migrations/0036_draw_result_integrity.sql", import.meta.url),
  "utf8",
);

function normalizeSql(source: string) {
  return source.replace(/\s+/g, " ").trim();
}

test("draw result integrity migration binds every immutable result field to authoritative rows", async () => {
  const source = normalizeSql(await migration);

  assert.match(source, /CREATE OR REPLACE FUNCTION public\.guard_kuji_draw_result_binding\(\)/);
  assert.match(source, /SET search_path = pg_catalog, public/);
  assert.match(
    source,
    /FOR SHARE OF entitlement, order_line, customer_order, version, draw_product, pool_entry, inventory/,
  );
  assert.match(source, /entitlement_status IS DISTINCT FROM 'AVAILABLE'/);
  assert.match(source, /order_user_id IS DISTINCT FROM entitlement_user_id/);
  assert.match(source, /order_status NOT IN \('PAID','FULFILLED'\)/);
  assert.match(source, /line_product_id IS DISTINCT FROM entitlement_product_id/);
  assert.match(source, /line_version_id IS DISTINCT FROM entitlement_version_id/);
  assert.match(source, /line_category IS DISTINCT FROM draw_category/);
  assert.match(source, /version_product_id IS DISTINCT FROM entitlement_product_id/);
  assert.match(source, /pool_version_id IS DISTINCT FROM entitlement_version_id/);
  assert.match(source, /NEW\.user_id IS DISTINCT FROM entitlement_user_id/);
  assert.match(source, /NEW\.product_id IS DISTINCT FROM entitlement_product_id/);
  assert.match(source, /NEW\.probability_version IS DISTINCT FROM published_version/);
  assert.match(source, /NEW\.prize_product_id IS DISTINCT FROM pool_prize_product_id/);
  assert.match(source, /inventory_owner_id IS DISTINCT FROM entitlement_user_id/);
  assert.match(source, /inventory_product_id IS DISTINCT FROM pool_prize_product_id/);
  assert.match(source, /inventory_source_type IS DISTINCT FROM upper\(draw_category\)/);
  assert.match(source, /inventory_source_id IS DISTINCT FROM NEW\.entitlement_id/);
  assert.match(source, /inventory_status IS DISTINCT FROM 'OWNED'/);
});

test("sealed kuji result snapshot must identify the exact reserved assignment", async () => {
  const source = normalizeSql(await migration);

  assert.match(source, /draw_category = 'kuji'/);
  assert.match(source, /IF NOT has_sealed_deck/);
  assert.match(source, /binding_state IS DISTINCT FROM 'RESERVED'/);
  assert.match(source, /binding_entitlement_id IS DISTINCT FROM NEW\.entitlement_id/);
  assert.match(source, /binding_version_id IS DISTINCT FROM entitlement_version_id/);
  assert.match(source, /binding_pool_entry_id IS DISTINCT FROM NEW\.pool_entry_id/);
  assert.match(
    source,
    /NEW\.selection_snapshot IS DISTINCT FROM jsonb_build_array\( jsonb_build_object\( 'slotId', binding_assignment_id::text, 'slotNumber', binding_slot_number \) \)/,
  );
});

test("weighted gacha remains separate and the replacement trigger helper stays private", async () => {
  const source = normalizeSql(await migration);

  assert.match(source, /draw_category NOT IN \('gacha','kuji'\)/);
  assert.match(source, /NEW\.selection_algorithm IS DISTINCT FROM 'SHA256_REJECTION_V1'/);
  assert.match(source, /NEW\.kuji_slot_binding_id IS NOT NULL/);
  assert.match(
    source,
    /REVOKE EXECUTE ON FUNCTION public\.guard_kuji_draw_result_binding\(\) FROM PUBLIC/,
  );
  for (const role of ["anon", "authenticated", "service_role"]) {
    assert.match(source, new RegExp(`rolname = '${role}'`));
  }
  assert.doesNotMatch(source, /PASSWORD|DATABASE_URL|SECURITY DEFINER|EXECUTE\s+format/i);
});
