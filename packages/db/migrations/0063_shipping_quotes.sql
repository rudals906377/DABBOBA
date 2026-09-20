-- Customer shipping requests must be based on a short-lived, server-priced
-- quote. The quote binds the selected inventory and current default-address
-- version for ten minutes, then is consumed exactly once by the request
-- transaction.

CREATE TABLE public.shipping_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  address_id uuid NOT NULL REFERENCES public.default_shipping_addresses(id) ON DELETE CASCADE,
  address_version integer NOT NULL CHECK (address_version > 0),
  inventory_unit_ids uuid[] NOT NULL,
  item_count integer NOT NULL CHECK (item_count BETWEEN 1 AND 20),
  reference_subtotal integer NOT NULL CHECK (reference_subtotal >= 0),
  contains_kuji boolean NOT NULL,
  free_shipping_threshold integer NOT NULL,
  shipping_fee integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  consumed_at timestamptz,
  shipping_request_id uuid UNIQUE REFERENCES public.shipping_requests(id) ON DELETE RESTRICT,
  CONSTRAINT shipping_quotes_inventory_count_check
    CHECK (cardinality(inventory_unit_ids) = item_count),
  CONSTRAINT shipping_quotes_policy_check
    CHECK (
      free_shipping_threshold = CASE WHEN contains_kuji THEN 54900 ELSE 24900 END
      AND shipping_fee = CASE
        WHEN reference_subtotal >= free_shipping_threshold THEN 0
        ELSE 3000
      END
    ),
  CONSTRAINT shipping_quotes_ten_minute_expiry_check
    CHECK (expires_at = created_at + interval '10 minutes'),
  CONSTRAINT shipping_quotes_consumption_pair_check
    CHECK ((consumed_at IS NULL) = (shipping_request_id IS NULL))
);

CREATE INDEX shipping_quotes_user_expiry_idx
ON public.shipping_quotes (user_id, expires_at DESC, id DESC);

CREATE INDEX shipping_quotes_expired_unconsumed_idx
ON public.shipping_quotes (expires_at, id)
WHERE consumed_at IS NULL;

CREATE OR REPLACE FUNCTION public.guard_shipping_quote_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF ROW(
    OLD.user_id,
    OLD.address_id,
    OLD.address_version,
    OLD.inventory_unit_ids,
    OLD.item_count,
    OLD.reference_subtotal,
    OLD.contains_kuji,
    OLD.free_shipping_threshold,
    OLD.shipping_fee,
    OLD.created_at,
    OLD.expires_at
  ) IS DISTINCT FROM ROW(
    NEW.user_id,
    NEW.address_id,
    NEW.address_version,
    NEW.inventory_unit_ids,
    NEW.item_count,
    NEW.reference_subtotal,
    NEW.contains_kuji,
    NEW.free_shipping_threshold,
    NEW.shipping_fee,
    NEW.created_at,
    NEW.expires_at
  ) THEN
    RAISE EXCEPTION 'Shipping quote snapshots are immutable' USING ERRCODE = '55000';
  END IF;

  IF OLD.consumed_at IS NOT NULL
    OR OLD.shipping_request_id IS NOT NULL
    OR NEW.consumed_at IS NULL
    OR NEW.shipping_request_id IS NULL
  THEN
    RAISE EXCEPTION 'Shipping quotes may only be consumed once' USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER shipping_quotes_guard_mutation
BEFORE UPDATE ON public.shipping_quotes
FOR EACH ROW EXECUTE FUNCTION public.guard_shipping_quote_mutation();

REVOKE EXECUTE ON FUNCTION public.guard_shipping_quote_mutation() FROM PUBLIC;

ALTER TABLE public.shipping_quotes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.shipping_quotes
FROM PUBLIC, anon, authenticated, dabboba_runtime, dabboba_worker;

GRANT SELECT, INSERT ON TABLE public.shipping_quotes TO dabboba_runtime;
GRANT UPDATE (consumed_at, shipping_request_id)
ON TABLE public.shipping_quotes TO dabboba_runtime;

COMMENT ON TABLE public.shipping_quotes IS
  'Ten-minute immutable server shipping-policy snapshots consumed atomically by one shipping request.';
