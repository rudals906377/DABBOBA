import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isNoTransactionMigration, splitSqlStatements } from "./migrate.js";

const read = (file: string) => readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8");

test("0078 builds the reviewed commerce indexes concurrently outside a transaction", async () => {
  const source = await read("0078_commerce_indexes.sql");
  assert.equal(isNoTransactionMigration(source), true);
  const statements = splitSqlStatements(source);
  assert.deepEqual(statements, [
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS draw_entitlements_available_version_idx ON public.draw_entitlements (product_id, probability_version_id) WHERE status = 'AVAILABLE'",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS stock_reservations_order_status_idx ON public.stock_reservations (order_id, status)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS draw_entitlements_order_line_status_idx ON public.draw_entitlements (order_line_id, status)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_pending_shipping_fee_created_idx ON public.orders (created_at) WHERE order_kind = 'SHIPPING_FEE' AND status = 'PENDING_PAYMENT'",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS inventory_units_source_idx ON public.inventory_units (source_id)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS exchange_offers_proposer_idx ON public.exchange_offers (proposer_id)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS inventory_ownership_transfers_unit_idx ON public.inventory_ownership_transfers (inventory_unit_id)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS catalog_requests_user_idx ON public.catalog_requests (user_id)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS wanted_requests_user_idx ON public.wanted_requests (user_id)",
  ]);
});

test("0079 grants only bounded retention privileges and adds an RLS-protected daily rollup", async () => {
  const source = await read("0079_worker_retention.sql");
  assert.equal(isNoTransactionMigration(source), false);
  assert.match(source, /CREATE TABLE IF NOT EXISTS public\.home_product_click_daily/);
  assert.match(source, /ALTER TABLE public\.home_product_click_daily ENABLE ROW LEVEL SECURITY/);
  assert.match(source, /REVOKE ALL ON TABLE public\.home_product_click_daily FROM dabboba_runtime/);
  assert.match(source, /current_setting\('dabboba\.home_click_rollup', true\) = 'on'/);
  assert.match(source, /OLD\.created_at < now\(\) - interval '31 days'/);
  assert.match(source, /GRANT DELETE ON TABLE public\.outbox_events TO dabboba_worker/);
  assert.match(source, /GRANT SELECT \(id, scope, expires_at\) ON TABLE public\.idempotency_keys TO dabboba_worker/);
  assert.match(source, /GRANT SELECT \(rotated_from_session_id\) ON TABLE public\.sessions TO dabboba_worker/);
  assert.match(source, /GRANT SELECT, DELETE ON TABLE public\.home_product_click_events TO dabboba_worker/);
  assert.match(source, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.home_product_click_daily TO dabboba_worker/);
  assert.match(source, /REVOKE ALL ON ALL TABLES IN SCHEMA public FROM service_role/);
  assert.match(source, /role % retains a public table grant/);
  assert.doesNotMatch(source, /GRANT[^;]*(?:token_digest|response_body|request_hash)/i);
  assert.doesNotMatch(source, /GRANT[^;]*TO\s+(?:anon|authenticated|service_role|dabboba_runtime)\b/i);
});

test("0080 adds retention range indexes concurrently", async () => {
  const source = await read("0080_retention_indexes.sql");
  assert.equal(isNoTransactionMigration(source), true);
  assert.deepEqual(splitSqlStatements(source).map((statement) => statement.split(" ")[6]), [
    "outbox_events_published_retention_idx",
    "sessions_expiry_retention_idx",
    "sessions_revoked_retention_idx",
    "home_product_click_events_created_idx",
  ]);
});
