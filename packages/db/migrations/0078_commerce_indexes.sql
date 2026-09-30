-- dabboba:no-transaction
-- Commerce and account-lifecycle lookup indexes for hot worker and API paths.
-- Built concurrently so live checkout, draw and exchange writes are never
-- blocked by a table-wide SHARE lock. migrate.ts runs this file one statement
-- at a time outside a transaction, drops an INVALID leftover from an
-- interrupted build before retrying, and records the checksum only after
-- every index is valid.

-- Draw consumption and kuji/gacha availability lookups by product and fixed
-- probability version.
CREATE INDEX CONCURRENTLY IF NOT EXISTS draw_entitlements_available_version_idx
ON public.draw_entitlements (product_id, probability_version_id)
WHERE status = 'AVAILABLE';

-- Order recovery, refund and reservation-expiry reads by order.
CREATE INDEX CONCURRENTLY IF NOT EXISTS stock_reservations_order_status_idx
ON public.stock_reservations (order_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS draw_entitlements_order_line_status_idx
ON public.draw_entitlements (order_line_id, status);

-- The worker reservation sweep scans pending shipping-fee orders by age.
CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_pending_shipping_fee_created_idx
ON public.orders (created_at)
WHERE order_kind = 'SHIPPING_FEE' AND status = 'PENDING_PAYMENT';

-- Foreign-key and ownership lookups used by account deletion, exchange
-- history, request rooms and prize provenance.
CREATE INDEX CONCURRENTLY IF NOT EXISTS inventory_units_source_idx
ON public.inventory_units (source_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS exchange_offers_proposer_idx
ON public.exchange_offers (proposer_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS inventory_ownership_transfers_unit_idx
ON public.inventory_ownership_transfers (inventory_unit_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS catalog_requests_user_idx
ON public.catalog_requests (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS wanted_requests_user_idx
ON public.wanted_requests (user_id);
