-- Model each side of an exchange as an immutable one-or-two item bundle.
-- The legacy singular columns remain as the position-zero compatibility value,
-- while these normalized item tables are the authoritative bundle membership.
CREATE TABLE public.exchange_listing_items (
  listing_id uuid NOT NULL REFERENCES public.exchange_listings(id) ON DELETE CASCADE,
  inventory_unit_id uuid NOT NULL REFERENCES public.inventory_units(id) ON DELETE RESTRICT,
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (listing_id, inventory_unit_id),
  UNIQUE (listing_id, position)
);

CREATE INDEX exchange_listing_items_inventory_idx
ON public.exchange_listing_items (inventory_unit_id, listing_id);

CREATE TABLE public.exchange_offer_items (
  offer_id uuid NOT NULL REFERENCES public.exchange_offers(id) ON DELETE CASCADE,
  inventory_unit_id uuid NOT NULL REFERENCES public.inventory_units(id) ON DELETE RESTRICT,
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (offer_id, inventory_unit_id),
  UNIQUE (offer_id, position)
);

CREATE INDEX exchange_offer_items_inventory_idx
ON public.exchange_offer_items (inventory_unit_id, offer_id);

INSERT INTO public.exchange_listing_items(listing_id, inventory_unit_id, position)
SELECT id, offered_inventory_unit_id, 0
FROM public.exchange_listings;

INSERT INTO public.exchange_offer_items(offer_id, inventory_unit_id, position)
SELECT id, offered_inventory_unit_id, 0
FROM public.exchange_offers;

-- Keep direct legacy inserts operational during the coordinated API/client
-- rollout. New API writes still add any position-one row explicitly.
CREATE FUNCTION public.seed_exchange_listing_primary_item()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.exchange_listing_items(listing_id, inventory_unit_id, position)
  VALUES (NEW.id, NEW.offered_inventory_unit_id, 0)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END
$$;

CREATE TRIGGER exchange_listings_seed_primary_item
AFTER INSERT ON public.exchange_listings
FOR EACH ROW EXECUTE FUNCTION public.seed_exchange_listing_primary_item();

CREATE FUNCTION public.seed_exchange_offer_primary_item()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.exchange_offer_items(offer_id, inventory_unit_id, position)
  VALUES (NEW.id, NEW.offered_inventory_unit_id, 0)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END
$$;

CREATE TRIGGER exchange_offers_seed_primary_item
AFTER INSERT ON public.exchange_offers
FOR EACH ROW EXECUTE FUNCTION public.seed_exchange_offer_primary_item();

-- Deferred checks let one transaction create the header and both item rows,
-- but never commit an empty, oversized, or singular/table-divergent bundle.
CREATE FUNCTION public.enforce_exchange_listing_bundle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_listing_id uuid;
  legacy_inventory_id uuid;
  primary_inventory_id uuid;
  bundle_count integer;
BEGIN
  IF TG_TABLE_NAME = 'exchange_listings' THEN
    target_listing_id := COALESCE(NEW.id, OLD.id);
  ELSE
    target_listing_id := COALESCE(NEW.listing_id, OLD.listing_id);
  END IF;

  SELECT offered_inventory_unit_id
    INTO legacy_inventory_id
    FROM public.exchange_listings
   WHERE id = target_listing_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT count(*)
    INTO bundle_count
    FROM public.exchange_listing_items
   WHERE listing_id = target_listing_id;
  SELECT inventory_unit_id
    INTO primary_inventory_id
    FROM public.exchange_listing_items
   WHERE listing_id = target_listing_id AND position = 0;

  IF bundle_count NOT BETWEEN 1 AND 2 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'exchange_listing_bundle_size_check',
      MESSAGE = 'exchange listing bundle must contain one or two inventory units';
  END IF;
  IF primary_inventory_id IS DISTINCT FROM legacy_inventory_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'exchange_listing_primary_item_check',
      MESSAGE = 'exchange listing position zero must match the legacy primary inventory unit';
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER exchange_listing_bundle_header_guard
AFTER INSERT OR UPDATE ON public.exchange_listings
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_exchange_listing_bundle();

CREATE CONSTRAINT TRIGGER exchange_listing_bundle_items_guard
AFTER INSERT OR UPDATE OR DELETE ON public.exchange_listing_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_exchange_listing_bundle();

CREATE FUNCTION public.enforce_exchange_offer_bundle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_offer_id uuid;
  legacy_inventory_id uuid;
  primary_inventory_id uuid;
  bundle_count integer;
BEGIN
  IF TG_TABLE_NAME = 'exchange_offers' THEN
    target_offer_id := COALESCE(NEW.id, OLD.id);
  ELSE
    target_offer_id := COALESCE(NEW.offer_id, OLD.offer_id);
  END IF;

  SELECT offered_inventory_unit_id
    INTO legacy_inventory_id
    FROM public.exchange_offers
   WHERE id = target_offer_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT count(*)
    INTO bundle_count
    FROM public.exchange_offer_items
   WHERE offer_id = target_offer_id;
  SELECT inventory_unit_id
    INTO primary_inventory_id
    FROM public.exchange_offer_items
   WHERE offer_id = target_offer_id AND position = 0;

  IF bundle_count NOT BETWEEN 1 AND 2 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'exchange_offer_bundle_size_check',
      MESSAGE = 'exchange offer bundle must contain one or two inventory units';
  END IF;
  IF primary_inventory_id IS DISTINCT FROM legacy_inventory_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'exchange_offer_primary_item_check',
      MESSAGE = 'exchange offer position zero must match the legacy primary inventory unit';
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER exchange_offer_bundle_header_guard
AFTER INSERT OR UPDATE ON public.exchange_offers
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_exchange_offer_bundle();

CREATE CONSTRAINT TRIGGER exchange_offer_bundle_items_guard
AFTER INSERT OR UPDATE OR DELETE ON public.exchange_offer_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_exchange_offer_bundle();

-- One proposer owns one active proposal bundle per listing. A withdrawn or
-- rejected bundle may be replaced later without bypassing the two-item cap.
DO $$
BEGIN
  IF EXISTS (
    SELECT listing_id, proposer_id
      FROM public.exchange_offers
     WHERE status IN ('PENDING', 'ACCEPTED')
     GROUP BY listing_id, proposer_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate active exchange offers must be resolved before migration 0033';
  END IF;
END
$$;

CREATE UNIQUE INDEX exchange_offers_one_active_bundle_per_proposer_idx
ON public.exchange_offers (listing_id, proposer_id)
WHERE status IN ('PENDING', 'ACCEPTED');

ALTER TABLE public.exchange_listing_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_offer_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.exchange_listing_items FROM PUBLIC;
REVOKE ALL ON TABLE public.exchange_offer_items FROM PUBLIC;
REVOKE ALL ON TABLE public.exchange_listing_items FROM dabboba_runtime;
REVOKE ALL ON TABLE public.exchange_offer_items FROM dabboba_runtime;
GRANT SELECT, INSERT ON TABLE
  public.exchange_listing_items,
  public.exchange_offer_items
TO dabboba_runtime;

REVOKE EXECUTE ON FUNCTION public.seed_exchange_listing_primary_item() FROM PUBLIC, dabboba_runtime;
REVOKE EXECUTE ON FUNCTION public.seed_exchange_offer_primary_item() FROM PUBLIC, dabboba_runtime;
REVOKE EXECUTE ON FUNCTION public.enforce_exchange_listing_bundle() FROM PUBLIC, dabboba_runtime;
REVOKE EXECUTE ON FUNCTION public.enforce_exchange_offer_bundle() FROM PUBLIC, dabboba_runtime;
