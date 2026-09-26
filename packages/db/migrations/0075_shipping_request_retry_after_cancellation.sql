-- A cancelled fee payment restores inventory to OWNED. Its historical
-- shipping_request_items row must remain immutable, but must not prevent a
-- new shipping request for the same item. Replace lifetime uniqueness with
-- serialization on the inventory row and an active-request check.
ALTER TABLE public.shipping_request_items
DROP CONSTRAINT shipping_request_items_inventory_unit_id_key;

CREATE INDEX shipping_request_items_inventory_lookup_idx
ON public.shipping_request_items (inventory_unit_id, shipping_request_id);

CREATE FUNCTION public.guard_active_shipping_request_item()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  inventory_owner uuid;
  inventory_status text;
  request_owner uuid;
  request_status text;
BEGIN
  -- Serializes competing inserts even when they refer to different request
  -- rows. The API also locks this row before creating a request.
  SELECT owner_id,status INTO inventory_owner,inventory_status
  FROM public.inventory_units WHERE id=NEW.inventory_unit_id FOR UPDATE;
  SELECT user_id,status INTO request_owner,request_status
  FROM public.shipping_requests WHERE id=NEW.shipping_request_id;

  IF inventory_owner IS NULL OR request_owner IS NULL
    OR inventory_owner IS DISTINCT FROM request_owner
    OR inventory_status IS DISTINCT FROM 'OWNED'
    OR request_status NOT IN ('PAYMENT_PENDING','REQUESTED')
  THEN
    RAISE EXCEPTION 'Inventory is not eligible for this shipping request'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.shipping_request_items item
    JOIN public.shipping_requests shipping ON shipping.id=item.shipping_request_id
    WHERE item.inventory_unit_id=NEW.inventory_unit_id
      AND shipping.status<>'CANCELLED'
  ) THEN
    RAISE EXCEPTION 'Inventory already has an active shipping request'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER shipping_request_items_active_guard
BEFORE INSERT ON public.shipping_request_items
FOR EACH ROW EXECUTE FUNCTION public.guard_active_shipping_request_item();

REVOKE EXECUTE ON FUNCTION public.guard_active_shipping_request_item() FROM PUBLIC;
