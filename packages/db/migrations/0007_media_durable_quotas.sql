-- Durable per-account upload budgets read all recent and READY media rows while
-- the active-intent quota remains covered by 0006's partial index.
CREATE INDEX media_assets_owner_created_budget_idx
ON media_assets (owner_id, created_at DESC)
INCLUDE (status, byte_size);

CREATE INDEX media_assets_owner_ready_budget_idx
ON media_assets (owner_id)
INCLUDE (byte_size)
WHERE status='READY';
