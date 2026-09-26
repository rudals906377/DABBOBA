-- Reservation expiry legitimately cancels an unpaid payment. A compromised
-- worker must not be able to turn that broad historical UPDATE grant into a
-- synthetic PAID or REFUNDED payment without a verified provider event.
CREATE FUNCTION public.guard_worker_payment_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_user = 'dabboba_worker' AND NOT (
    OLD.status = 'PENDING'
    AND NEW.status = 'CANCELLED'
    AND NEW.version = OLD.version + 1
    AND (to_jsonb(NEW) - ARRAY['status','version','updated_at'])
        = (to_jsonb(OLD) - ARRAY['status','version','updated_at'])
  ) THEN
    RAISE EXCEPTION 'worker cannot perform this payment transition'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger names run alphabetically. This follows payments_set_updated_at.
CREATE TRIGGER zz_guard_worker_payment_transition
BEFORE UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.guard_worker_payment_transition();

REVOKE ALL ON FUNCTION public.guard_worker_payment_transition() FROM PUBLIC;
