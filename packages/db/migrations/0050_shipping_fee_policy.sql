-- Snapshot the server-authoritative delivery fee without rewriting unknown legacy history.
-- A request below its free-shipping threshold owes the approved flat 3,000 KRW fee.
ALTER TABLE public.shipping_requests
ADD COLUMN shipping_fee integer;

CREATE OR REPLACE FUNCTION public.fill_shipping_request_shipping_fee()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.qualifies_for_free_shipping IS NOT NULL AND NEW.shipping_fee IS NULL THEN
    NEW.shipping_fee := CASE
      WHEN NEW.qualifies_for_free_shipping THEN 0
      ELSE 3000
    END;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER shipping_requests_fill_shipping_fee
BEFORE INSERT ON public.shipping_requests
FOR EACH ROW
EXECUTE FUNCTION public.fill_shipping_request_shipping_fee();

REVOKE EXECUTE ON FUNCTION public.fill_shipping_request_shipping_fee() FROM PUBLIC;

UPDATE public.shipping_requests
SET shipping_fee = CASE
  WHEN qualifies_for_free_shipping THEN 0
  ELSE 3000
END
WHERE qualifies_for_free_shipping IS NOT NULL;

ALTER TABLE public.shipping_requests
ADD CONSTRAINT shipping_requests_shipping_fee_policy_snapshot
CHECK (
  (
    qualifies_for_free_shipping IS NULL
    AND shipping_fee IS NULL
  )
  OR
  (
    qualifies_for_free_shipping IS NOT NULL
    AND shipping_fee IS NOT NULL
    AND shipping_fee = CASE
      WHEN qualifies_for_free_shipping THEN 0
      ELSE 3000
    END
  )
) NOT VALID;

ALTER TABLE public.shipping_requests
VALIDATE CONSTRAINT shipping_requests_shipping_fee_policy_snapshot;

CREATE OR REPLACE FUNCTION public.guard_shipping_request_policy_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF ROW(
    OLD.reference_subtotal,
    OLD.free_shipping_threshold,
    OLD.qualifies_for_free_shipping,
    OLD.contains_kuji,
    OLD.shipping_fee
  ) IS DISTINCT FROM ROW(
    NEW.reference_subtotal,
    NEW.free_shipping_threshold,
    NEW.qualifies_for_free_shipping,
    NEW.contains_kuji,
    NEW.shipping_fee
  ) THEN
    RAISE EXCEPTION 'Shipping policy snapshots are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER shipping_requests_guard_policy_snapshot
BEFORE UPDATE ON public.shipping_requests
FOR EACH ROW
EXECUTE FUNCTION public.guard_shipping_request_policy_snapshot();

REVOKE EXECUTE ON FUNCTION public.guard_shipping_request_policy_snapshot() FROM PUBLIC;
