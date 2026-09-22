-- Persist the server-authoritative free-shipping decision made when a request is created.
-- Historical requests remain nullable because their original catalog prices cannot be reconstructed safely.
ALTER TABLE public.shipping_requests
ADD COLUMN reference_subtotal integer,
ADD COLUMN free_shipping_threshold integer,
ADD COLUMN qualifies_for_free_shipping boolean,
ADD COLUMN contains_kuji boolean;

ALTER TABLE public.shipping_requests
ADD CONSTRAINT shipping_requests_free_shipping_policy_snapshot
CHECK (
  (
    reference_subtotal IS NULL
    AND free_shipping_threshold IS NULL
    AND qualifies_for_free_shipping IS NULL
    AND contains_kuji IS NULL
  )
  OR
  (
    reference_subtotal IS NOT NULL
    AND free_shipping_threshold IS NOT NULL
    AND qualifies_for_free_shipping IS NOT NULL
    AND contains_kuji IS NOT NULL
    AND reference_subtotal >= 0
    AND free_shipping_threshold = CASE WHEN contains_kuji THEN 54900 ELSE 24900 END
    AND qualifies_for_free_shipping = (reference_subtotal >= free_shipping_threshold)
  )
) NOT VALID;

ALTER TABLE public.shipping_requests
VALIDATE CONSTRAINT shipping_requests_free_shipping_policy_snapshot;

-- New inventory receives sixty days by default. Existing inventory is only extended;
-- a later deadline (including the post-exchange minimum) is never shortened.
ALTER TABLE public.inventory_units
ALTER COLUMN storage_expires_at SET DEFAULT (now() + interval '60 days');

UPDATE public.inventory_units
SET storage_expires_at = GREATEST(
  storage_expires_at,
  acquired_at + interval '60 days'
)
WHERE storage_expires_at < acquired_at + interval '60 days';

ALTER TABLE public.inventory_units
ADD CONSTRAINT inventory_units_storage_minimum_60_days
CHECK (storage_expires_at >= acquired_at + interval '60 days') NOT VALID;

ALTER TABLE public.inventory_units
VALIDATE CONSTRAINT inventory_units_storage_minimum_60_days;
