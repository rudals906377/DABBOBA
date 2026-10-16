-- Category labels describe merchandise, not fulfillment. Existing order lines
-- and their probability bindings remain unchanged. No sale is activated here.
ALTER TABLE public.order_lines DROP CONSTRAINT order_lines_draw_version_check;
ALTER TABLE public.order_lines ADD CONSTRAINT order_lines_draw_version_check
  CHECK (probability_version_id IS NULL OR category_snapshot IN ('gacha','kuji'));

-- Preserve prize-only and parent identities. Register new, independently stocked
-- exact-product SKUs at the same approved parent price; never split parent stock.
INSERT INTO public.catalog_products
  (id,sku,ip_id,category,name,manufacturer,release_date,price,currency,image_url,metadata,is_active,is_prize_only,sale_status)
SELECT 'direct-' || prize.id, 'DIRECT-' || prize.sku, prize.ip_id, prize.category,
  parent.name || ' · ' || prize.name, prize.manufacturer, prize.release_date,
  parent.price, prize.currency, prize.image_url,
  (prize.metadata - 'reward') || jsonb_build_object(
    'purchaseMode','DIRECT','sourcePrizeProductId',prize.id,'parentProductId',parent.id),
  prize.is_active, false, 'COMING_SOON'
FROM public.catalog_products prize
JOIN public.catalog_products parent ON parent.id=prize.metadata->>'parentProductId'
WHERE prize.is_prize_only AND parent.category='gacha' AND NOT parent.is_prize_only
  AND length('direct-' || prize.id)<=120 AND length('DIRECT-' || prize.sku)<=80
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.product_stock(product_id,on_hand,reserved)
-- Owner confirmed 20 units per exact first-launch choice on 2026-10-13.
-- This initializes only new rows; retries never overwrite stock or reservations.
SELECT id,CASE WHEN id IN (
    'direct-gacha-chiikawa-monitor-cupcake-prize-01',
    'direct-gacha-chiikawa-monitor-cupcake-prize-02',
    'direct-gacha-chiikawa-monitor-cupcake-prize-03',
    'direct-gacha-chiikawa-monitor-cupcake-prize-04',
    'direct-gacha-chiikawa-monitor-cupcake-prize-05',
    'direct-gacha-chiikawa-monitor-cupcake-prize-06',
    'direct-gacha-chiikawa-monitor-cupcake-prize-07',
    'direct-gacha-death-note-collection-rich-prize-01',
    'direct-gacha-death-note-collection-rich-prize-02',
    'direct-gacha-death-note-collection-rich-prize-03',
    'direct-gacha-death-note-collection-rich-prize-04',
    'direct-gacha-death-note-collection-rich-prize-05',
    'direct-gacha-demon-slayer-onemutan-13-prize-01',
    'direct-gacha-demon-slayer-onemutan-13-prize-02',
    'direct-gacha-demon-slayer-onemutan-13-prize-03',
    'direct-gacha-demon-slayer-onemutan-13-prize-04',
    'direct-gacha-demon-slayer-onemutan-13-prize-05',
    'direct-gacha-demon-slayer-petatto-2-prize-01',
    'direct-gacha-demon-slayer-petatto-2-prize-02',
    'direct-gacha-demon-slayer-petatto-2-prize-03',
    'direct-gacha-demon-slayer-petatto-2-prize-04',
    'direct-gacha-demon-slayer-petatto-2-prize-05',
    'direct-gacha-demon-slayer-petatto-3-prize-01',
    'direct-gacha-demon-slayer-petatto-3-prize-02',
    'direct-gacha-demon-slayer-petatto-3-prize-03',
    'direct-gacha-demon-slayer-petatto-3-prize-04',
    'direct-gacha-demon-slayer-petatto-3-prize-05',
    'direct-gacha-hatsune-miku-petadoll-prize-01',
    'direct-gacha-hatsune-miku-petadoll-prize-02',
    'direct-gacha-hatsune-miku-petadoll-prize-03',
    'direct-gacha-hatsune-miku-petadoll-prize-04',
    'direct-gacha-hatsune-miku-petadoll-prize-05',
    'direct-gacha-hatsune-miku-petadoll-prize-06',
    'direct-gacha-sanrio-can-figures-prize-01',
    'direct-gacha-sanrio-can-figures-prize-02',
    'direct-gacha-sanrio-can-figures-prize-03',
    'direct-gacha-sanrio-can-figures-prize-04',
    'direct-gacha-sanrio-can-figures-prize-05',
    'direct-gacha-sylvanian-adventure-prize-01',
    'direct-gacha-sylvanian-adventure-prize-02',
    'direct-gacha-sylvanian-adventure-prize-03',
    'direct-gacha-sylvanian-adventure-prize-04',
    'direct-gacha-sylvanian-adventure-prize-05',
    'direct-gacha-sylvanian-adventure-prize-06',
    'direct-gacha-sylvanian-adventure-prize-07',
    'direct-gacha-sylvanian-adventure-prize-08'
  ) THEN 20 ELSE 0 END,0
FROM public.catalog_products WHERE metadata->>'purchaseMode'='DIRECT'
ON CONFLICT (product_id) DO NOTHING;

-- Retain operator-curated manual discovery sections, expanding the old series
-- into its real choices. Only the 46 owner-confirmed launch choices receive initial stock; sales stay off.
INSERT INTO public.home_catalog_section_products(section_id,product_id,sort_order)
SELECT section.section_id,choice.id,section.sort_order
FROM public.home_catalog_section_products section
JOIN public.catalog_products choice ON choice.metadata->>'parentProductId'=section.product_id
WHERE choice.metadata->>'purchaseMode'='DIRECT'
ON CONFLICT (section_id,product_id) DO NOTHING;

-- Preserve positive-stock readiness; DIRECT products do not have a draw configuration.
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

  IF NEW.category IN ('gacha','kuji') AND COALESCE(NEW.metadata->>'purchaseMode','') <> 'DIRECT' THEN
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


REVOKE EXECUTE ON FUNCTION public.guard_catalog_product_on_sale_transition() FROM PUBLIC;
