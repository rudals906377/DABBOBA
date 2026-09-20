-- Explicit storefront lifecycle. A product can be browsed before its price is
-- final, but only a fully configured ON_SALE row can enter checkout.

ALTER TABLE public.catalog_products
ADD COLUMN sale_status text NOT NULL DEFAULT 'DRAFT';

UPDATE public.catalog_products
SET sale_status = 'COMING_SOON'
WHERE is_active = true
  AND is_prize_only = false;

ALTER TABLE public.catalog_products
ADD CONSTRAINT catalog_products_sale_status_check
CHECK (sale_status IN ('DRAFT','COMING_SOON','ON_SALE','PAUSED')) NOT VALID;

ALTER TABLE public.catalog_products
VALIDATE CONSTRAINT catalog_products_sale_status_check;

ALTER TABLE public.catalog_products
ADD CONSTRAINT catalog_products_on_sale_configuration_check
CHECK (
  sale_status <> 'ON_SALE'
  OR (
    is_active = true
    AND is_prize_only = false
    AND price > 0
    AND COALESCE(NULLIF(btrim(storefront_image_url), ''), NULLIF(btrim(image_url), '')) IS NOT NULL
  )
) NOT VALID;

ALTER TABLE public.catalog_products
VALIDATE CONSTRAINT catalog_products_on_sale_configuration_check;

CREATE INDEX catalog_products_storefront_sale_idx
ON public.catalog_products (sale_status, category, created_at DESC, id DESC)
WHERE is_active = true AND is_prize_only = false;

CREATE OR REPLACE FUNCTION public.guard_catalog_product_on_sale_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  available_stock integer;
  active_draw_version_exists boolean;
BEGIN
  IF NEW.sale_status <> 'ON_SALE'
     OR (TG_OP = 'UPDATE' AND OLD.sale_status = 'ON_SALE') THEN
    RETURN NEW;
  END IF;

  SELECT stock.on_hand - stock.reserved
    INTO available_stock
    FROM public.product_stock AS stock
   WHERE stock.product_id = NEW.id;

  IF available_stock IS NULL OR available_stock <= 0 THEN
    RAISE EXCEPTION 'ON_SALE products require positive available stock'
      USING ERRCODE = '23514', CONSTRAINT = 'catalog_products_on_sale_readiness';
  END IF;

  IF NEW.category IN ('gacha','kuji') THEN
    SELECT EXISTS (
      SELECT 1
        FROM public.draw_probability_versions AS version
       WHERE version.product_id = NEW.id
         AND version.status = 'ACTIVE'
         AND (
           NEW.category <> 'kuji'
           OR EXISTS (
             SELECT 1
               FROM public.kuji_decks AS deck
              WHERE deck.probability_version_id = version.id
           )
         )
    ) INTO active_draw_version_exists;

    IF NOT active_draw_version_exists THEN
      RAISE EXCEPTION 'ON_SALE draw products require an active published configuration'
        USING ERRCODE = '23514', CONSTRAINT = 'catalog_products_on_sale_readiness';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS catalog_products_on_sale_transition_guard
ON public.catalog_products;

CREATE TRIGGER catalog_products_on_sale_transition_guard
BEFORE INSERT OR UPDATE OF sale_status
ON public.catalog_products
FOR EACH ROW
EXECUTE FUNCTION public.guard_catalog_product_on_sale_transition();

REVOKE EXECUTE ON FUNCTION public.guard_catalog_product_on_sale_transition() FROM PUBLIC;

COMMENT ON COLUMN public.catalog_products.sale_status IS
  'Storefront lifecycle. Only ON_SALE rows may enter checkout; COMING_SOON remains browseable.';
