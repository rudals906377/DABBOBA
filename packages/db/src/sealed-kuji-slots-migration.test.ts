import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = readFile(
  new URL("../migrations/0035_sealed_kuji_slots.sql", import.meta.url),
  "utf8",
);

function normalizeSql(source: string) {
  return source.replace(/\s+/g, " ").trim();
}

test("sealed kuji migration stores one immutable finite assignment per numbered slot", async () => {
  const source = normalizeSql(await migration);

  assert.match(source, /CREATE TABLE public\.kuji_decks/);
  assert.match(source, /total_slots integer NOT NULL CHECK \(total_slots BETWEEN 1 AND 10000\)/);
  assert.match(source, /DEFAULT 'CSPRNG_FISHER_YATES_V1'/);
  assert.match(source, /'LEGACY_SINGLE_TIER_V1'/);
  assert.match(source, /CREATE TABLE public\.kuji_deck_tiers/);
  assert.match(source, /UNIQUE \(probability_version_id, tier_code\)/);
  assert.match(source, /UNIQUE \(probability_version_id, tier_rank\)/);
  assert.match(source, /CREATE TABLE public\.kuji_slot_assignments/);
  assert.match(source, /UNIQUE \(probability_version_id, slot_number\)/);
  assert.match(source, /kuji_slot_assignments_immutable/);
  assert.match(source, /FOR EACH ROW EXECUTE FUNCTION public\.reject_row_mutation\(\)/);
});

test("legacy active kuji conversion is fail-closed and limited to untouched single-tier decks", async () => {
  const source = normalizeSql(await migration);

  assert.match(source, /version\.status = 'ACTIVE'/);
  assert.match(source, /legacy_version\.entry_count <> 1/);
  assert.match(source, /legacy_version\.incompatible_entry_count <> 0/);
  assert.match(source, /entry\.remaining_quantity IS DISTINCT FROM entry\.initial_quantity/);
  assert.match(source, /legacy_version\.reserved <> 0/);
  assert.match(source, /legacy_version\.on_hand <> legacy_version\.total_slots/);
  assert.match(source, /legacy_version\.entitlement_count <> 0/);
  assert.match(source, /legacy_version\.unfinished_order_count <> 0/);
  assert.match(source, /legacy_version\.active_room_entry_count <> 0/);
  assert.match(source, /cannot be safely converted to a sealed deck/);
  assert.match(source, /'LEGACY_SINGLE_TIER'/);
  assert.match(source, /'LEGACY_SINGLE_TIER_V1'/);
  assert.match(source, /generate_series\(1, legacy_version\.total_slots\)/);
  assert.match(source, /saved_assignment_count <> legacy_version\.total_slots/);
  assert.match(source, /saved_distinct_pool_count <> 1/);
  assert.match(source, /failed sealed deck verification/);
  assert.match(source, /Every active kuji version must have a verified sealed deck/);
  assert.match(source, /deck\.probability_version_id IS NULL/);
  assert.match(source, /SET LOCAL lock_timeout = '5s'/);
  assert.match(source, /public\.catalog_products, public\.product_stock/);
  assert.match(source, /IN SHARE ROW EXCLUSIVE MODE NOWAIT/);
  assert.ok(
    source.indexOf("LEGACY_SINGLE_TIER") < source.indexOf("kuji_deck_tiers_insert_guard"),
    "the one-time compatibility insert must run before DRAFT-only guards are installed",
  );
});

test("kuji activation requires exact finite tiers and a complete persisted slot distribution", async () => {
  const source = normalizeSql(await migration);

  assert.match(source, /OLD\.status = 'DRAFT' AND NEW\.status = 'ACTIVE'/);
  assert.match(source, /draw_category = 'kuji'/);
  assert.match(source, /entry\.initial_quantity IS NOT NULL/);
  assert.match(source, /entry\.remaining_quantity = entry\.initial_quantity/);
  assert.match(source, /entry\.weight = 1/);
  assert.match(source, /configured_total <> deck_total/);
  assert.match(source, /assignment_count <> deck_total/);
  assert.match(source, /count\(assignment\.id\) IS DISTINCT FROM entry\.initial_quantity::bigint/);
});

test("slot binding uniqueness, ownership, paid order, consume, and cancellation release are database enforced", async () => {
  const source = normalizeSql(await migration);

  assert.match(source, /CREATE UNIQUE INDEX kuji_slot_bindings_live_slot_idx .* WHERE state IN \('RESERVED','CONSUMED'\)/);
  assert.match(source, /CREATE UNIQUE INDEX kuji_slot_bindings_live_entitlement_idx .* WHERE state IN \('RESERVED','CONSUMED'\)/);
  assert.match(source, /entitlement_state IS DISTINCT FROM 'AVAILABLE'/);
  assert.match(source, /order_state NOT IN \('PAID','FULFILLED'\)/);
  assert.match(source, /room_user_id IS DISTINCT FROM entitlement_user_id/);
  assert.match(source, /room_product_id IS DISTINCT FROM entitlement_product_id/);
  assert.match(source, /room_order_id IS DISTINCT FROM entitlement_order_id/);
  assert.match(source, /room_state NOT IN \('DRAWING','EXPIRED'\)/);
  assert.match(source, /Sealed kuji results must consume their reserved immutable slot mapping/);
  assert.match(source, /SET state = 'CONSUMED', consumed_at = NEW\.committed_at/);
  assert.match(source, /OLD\.status = 'AVAILABLE' AND NEW\.status = 'CANCELLED'/);
  assert.match(source, /SET state = 'RELEASED'.*release_reason = 'ENTITLEMENT_CANCELLED'/);
});

test("draw result evidence separates weighted randomness from committed sealed-slot selection", async () => {
  const source = normalizeSql(await migration);

  assert.match(source, /selection_algorithm = 'SHA256_REJECTION_V1' AND kuji_slot_binding_id IS NULL/);
  assert.match(source, /selection_algorithm = 'KUJI_SEALED_SLOT_V1' AND kuji_slot_binding_id IS NOT NULL/);
  assert.match(source, /entropy_hex IS NULL AND entropy_digest IS NULL AND roll_value IS NULL AND total_weight IS NULL/);
  assert.match(source, /jsonb_array_length\(selection_snapshot\) = 1/);
  assert.match(source, /binding_pool_entry_id IS DISTINCT FROM NEW\.pool_entry_id/);
});

test("sealed kuji tables remain backend-only with the exact minimum runtime allow-list", async () => {
  const source = normalizeSql(await migration);
  const tables = ["kuji_deck_tiers", "kuji_decks", "kuji_slot_assignments", "kuji_slot_bindings"];

  for (const table of tables) {
    assert.match(source, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
  }
  assert.match(source, /REVOKE ALL ON TABLE public\.kuji_deck_tiers, public\.kuji_decks, public\.kuji_slot_assignments, public\.kuji_slot_bindings FROM PUBLIC/);
  assert.match(source, /GRANT SELECT ON TABLE public\.kuji_deck_tiers, public\.kuji_decks, public\.kuji_slot_assignments, public\.kuji_slot_bindings TO dabboba_runtime/);
  assert.match(source, /GRANT INSERT ON TABLE public\.kuji_deck_tiers, public\.kuji_decks, public\.kuji_slot_assignments, public\.kuji_slot_bindings TO dabboba_runtime/);
  assert.match(source, /GRANT UPDATE ON TABLE public\.kuji_slot_bindings TO dabboba_runtime/);
  assert.match(source, /GRANT SELECT ON TABLE public\.kuji_decks TO dabboba_worker/);
  assert.doesNotMatch(source, /GRANT[^;]*(?:kuji_deck_tiers|kuji_slot_assignments|kuji_slot_bindings)[^;]*TO dabboba_worker/i);
  assert.doesNotMatch(source, /GRANT (?:ALL|DELETE|TRUNCATE|REFERENCES|TRIGGER)[^;]*kuji_/i);
  assert.doesNotMatch(source, /EXECUTE\s+format|PASSWORD|DATABASE_URL/i);
  assert.equal(
    (source.match(/RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS \$\$/g) ?? []).length,
    8,
  );
});
