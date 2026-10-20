-- Approved 2026-10-12: 60 days, D-7/D-3 reminders, automatic GACHA 50% /
-- KUJI 15% points. No retroactive conversion of inventory acquired under the
-- former hold-only terms. Deploy the matching legal revision before enabling
-- WORKER_INVENTORY_STORAGE_EXPIRY_MODE; this migration never starts a worker.
ALTER TABLE public.inventory_units
  ADD COLUMN storage_return_reference_amount integer,
  ADD COLUMN storage_return_rate integer,
  ADD CONSTRAINT inventory_storage_return_snapshot_check CHECK (
    (storage_return_reference_amount IS NULL AND storage_return_rate IS NULL)
    OR (storage_return_reference_amount IS NOT NULL AND storage_return_rate IS NOT NULL
        AND storage_return_reference_amount > 0 AND
        ((source_type='GACHA' AND storage_return_rate=50)
         OR (source_type='KUJI' AND storage_return_rate=15)))
  );

CREATE FUNCTION public.snapshot_inventory_storage_return()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.storage_return_reference_amount IS DISTINCT FROM OLD.storage_return_reference_amount
       OR NEW.storage_return_rate IS DISTINCT FROM OLD.storage_return_rate THEN
      RAISE EXCEPTION 'Storage return price and rate snapshots are immutable' USING ERRCODE='55000';
    END IF;
    RETURN NEW;
  END IF;
  -- Ignore caller-supplied amounts. Only newly awarded prizes after consent
  -- receive an immutable price snapshot; historical inventory is not backfilled.
  NEW.storage_return_reference_amount := NULL;
  NEW.storage_return_rate := NULL;
  IF NEW.source_type IN ('GACHA','KUJI') AND EXISTS (
    SELECT 1 FROM public.user_policy_acceptance_events acceptance
     WHERE acceptance.user_id=NEW.owner_id AND acceptance.policy_key='TERMS'
       AND acceptance.policy_version>='2026-10-12'
       AND acceptance.accepted_at<=NEW.acquired_at
  ) THEN
    SELECT price INTO NEW.storage_return_reference_amount
      FROM public.catalog_products WHERE id=NEW.product_id AND price>0;
    IF NEW.storage_return_reference_amount IS NOT NULL THEN
      NEW.storage_return_rate := CASE WHEN NEW.source_type='GACHA' THEN 50 ELSE 15 END;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.snapshot_inventory_storage_return() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_inventory_storage_return() TO dabboba_runtime, dabboba_worker;
CREATE TRIGGER inventory_storage_return_snapshot
BEFORE INSERT OR UPDATE ON public.inventory_units
FOR EACH ROW EXECUTE FUNCTION public.snapshot_inventory_storage_return();

ALTER TABLE public.inventory_storage_expiry_events
  DROP CONSTRAINT inventory_storage_expiry_events_event_kind_check;
ALTER TABLE public.inventory_storage_expiry_events
  ADD CONSTRAINT inventory_storage_expiry_events_event_kind_check CHECK (event_kind IN (
    'REMINDER_14D','REMINDER_7D','REMINDER_3D','REMINDER_1D','EXPIRED_HOLD','POINT_RETURNED'
  ));

CREATE TABLE public.inventory_storage_point_returns (
  inventory_unit_id uuid PRIMARY KEY REFERENCES public.inventory_units(id) ON DELETE RESTRICT,
  expiry_event_id uuid NOT NULL UNIQUE REFERENCES public.inventory_storage_expiry_events(id) ON DELETE RESTRICT,
  owner_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  source_type text NOT NULL CHECK (source_type IN ('GACHA','KUJI')),
  reference_amount integer NOT NULL CHECK (reference_amount>0),
  rate integer NOT NULL,
  point_amount integer NOT NULL CHECK (point_amount>0),
  credited_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((source_type='GACHA' AND rate=50) OR (source_type='KUJI' AND rate=15)),
  CHECK (point_amount=floor(reference_amount::numeric*rate/100)::integer)
);
CREATE TRIGGER inventory_storage_point_returns_immutable
BEFORE UPDATE OR DELETE ON public.inventory_storage_point_returns
FOR EACH ROW EXECUTE FUNCTION public.reject_row_mutation();
ALTER TABLE public.inventory_storage_point_returns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.inventory_storage_point_returns FROM PUBLIC, anon, authenticated, dabboba_runtime, dabboba_worker;
GRANT SELECT, INSERT ON TABLE public.inventory_storage_point_returns TO dabboba_worker;
-- Reuse the existing balance UPDATE and immutable ledger INSERT grants. No
-- inventory DELETE, owner mutation, or general point-ledger reads are granted.
GRANT INSERT ON TABLE public.point_accounts TO dabboba_worker;
GRANT SELECT (id, prize_inventory_unit_id, entitlement_id) ON public.draw_results TO dabboba_worker;
GRANT SELECT (id, order_line_id) ON public.draw_entitlements TO dabboba_worker;
GRANT SELECT (id, order_id) ON public.order_lines TO dabboba_worker;
COMMENT ON TABLE public.inventory_storage_point_returns IS
  'Immutable one-credit-per-unit expiry ledger. Former-policy units remain on non-destructive hold.';
