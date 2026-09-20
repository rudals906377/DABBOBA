-- Keep customer shipping history stable even when catalog metadata changes.
ALTER TABLE public.shipping_request_items
ADD COLUMN product_snapshot jsonb;

UPDATE public.shipping_request_items AS item
SET product_snapshot = jsonb_build_object(
  'productId', product.id,
  'productName', product.name,
  'ipId', product.ip_id,
  'ipNameKo', ip.name_ko,
  'category', product.category,
  'imageUrl', product.image_url,
  'productVersion', product.version
)
FROM public.inventory_units AS inventory
JOIN public.catalog_products AS product ON product.id = inventory.product_id
JOIN public.catalog_ips AS ip ON ip.id = product.ip_id
WHERE inventory.id = item.inventory_unit_id;

ALTER TABLE public.shipping_request_items
ALTER COLUMN product_snapshot SET NOT NULL;

ALTER TABLE public.shipping_request_items
ADD CONSTRAINT shipping_request_items_product_snapshot_object
CHECK (jsonb_typeof(product_snapshot) = 'object');

-- The API derives this value from the catalog in the same transaction as the
-- shipping request.  Enforce that derivation in PostgreSQL as well so a future
-- caller cannot insert arbitrary product history or rewrite a dispute record.
CREATE FUNCTION public.guard_shipping_request_item_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  expected_snapshot jsonb;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Shipping request item snapshots are immutable'
      USING ERRCODE = '55000';
  END IF;

  SELECT jsonb_build_object(
    'productId', product.id,
    'productName', product.name,
    'ipId', product.ip_id,
    'ipNameKo', ip.name_ko,
    'category', product.category,
    'imageUrl', product.image_url,
    'productVersion', product.version
  )
  INTO expected_snapshot
  FROM public.inventory_units AS inventory
  JOIN public.catalog_products AS product ON product.id = inventory.product_id
  JOIN public.catalog_ips AS ip ON ip.id = product.ip_id
  WHERE inventory.id = NEW.inventory_unit_id;

  IF expected_snapshot IS NULL
    OR NEW.product_snapshot IS DISTINCT FROM expected_snapshot
  THEN
    RAISE EXCEPTION 'Shipping request item snapshot does not match the current catalog record'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER shipping_request_items_snapshot_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.shipping_request_items
FOR EACH ROW EXECUTE FUNCTION public.guard_shipping_request_item_snapshot();

REVOKE EXECUTE ON FUNCTION public.guard_shipping_request_item_snapshot() FROM PUBLIC;
