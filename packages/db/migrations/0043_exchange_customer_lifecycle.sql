-- Customer exchange lifecycle policy:
-- - open listings are visible for seven days;
-- - every stored item has an explicit 45-day storage deadline;
-- - a completed exchange gives the receiver at least 14 days to request shipping.

ALTER TABLE public.exchange_listings
ADD COLUMN expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days');

ALTER TABLE public.exchange_listings
ADD CONSTRAINT exchange_listings_expiry_after_creation_check
CHECK (expires_at = created_at + interval '7 days') NOT VALID;

CREATE INDEX exchange_listings_open_expiry_idx
ON public.exchange_listings (expires_at, id)
WHERE status = 'OPEN';

UPDATE public.exchange_listings
SET expires_at = created_at + interval '7 days'
WHERE expires_at <> created_at + interval '7 days';

ALTER TABLE public.inventory_units
ADD COLUMN storage_expires_at timestamptz NOT NULL DEFAULT (now() + interval '45 days');

ALTER TABLE public.inventory_units
ADD CONSTRAINT inventory_units_storage_expiry_after_acquisition_check
CHECK (storage_expires_at >= acquired_at) NOT VALID;

CREATE INDEX inventory_units_storage_expiry_idx
ON public.inventory_units (storage_expires_at, id)
WHERE status IN ('OWNED','EXCHANGE_LISTED','EXCHANGE_OFFERED');

UPDATE public.inventory_units
SET storage_expires_at = acquired_at + interval '45 days'
WHERE storage_expires_at <> acquired_at + interval '45 days';
