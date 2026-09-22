-- Complete the lifecycle rollout in a fresh transaction after the legacy-row
-- backfill, then expose only the transfer ledger read needed by customer
-- inventory and point-return eligibility checks.

ALTER TABLE public.exchange_listings
VALIDATE CONSTRAINT exchange_listings_expiry_after_creation_check;

ALTER TABLE public.inventory_units
VALIDATE CONSTRAINT inventory_units_storage_expiry_after_acquisition_check;

GRANT SELECT ON TABLE public.inventory_ownership_transfers TO dabboba_runtime;
