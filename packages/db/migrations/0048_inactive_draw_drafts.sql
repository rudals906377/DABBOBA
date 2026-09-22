-- Operators may prepare an immutable draw draft while its sale product is
-- inactive. Customer exposure still requires activation, and publication is
-- rejected at the database boundary until the sale product is active.

CREATE OR REPLACE FUNCTION public.guard_draw_pool_entry_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  old_version_status text;
  new_version_status text;
  new_draw_ip_id text;
  new_draw_category text;
  new_draw_is_prize_only boolean;
  canonical_name varchar(240);
  canonical_image_url text;
  canonical_sku varchar(80);
  canonical_ip_id text;
  canonical_category text;
  canonical_is_active boolean;
  canonical_is_prize_only boolean;
  validate_new boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT version.status, product.ip_id, product.category, product.is_prize_only
      INTO new_version_status, new_draw_ip_id, new_draw_category, new_draw_is_prize_only
      FROM public.draw_probability_versions AS version
      JOIN public.catalog_products AS product ON product.id = version.product_id
     WHERE version.id = NEW.probability_version_id
     FOR UPDATE OF version;
    IF new_version_status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Published draw pool configuration is immutable' USING ERRCODE = '55000';
    END IF;
    IF new_draw_is_prize_only OR new_draw_category NOT IN ('gacha','kuji') THEN
      RAISE EXCEPTION 'Draw pools require a saleable gacha or kuji product' USING ERRCODE = '23514';
    END IF;
    validate_new := true;
  ELSE
    SELECT status INTO old_version_status
      FROM public.draw_probability_versions
     WHERE id = OLD.probability_version_id
     FOR UPDATE;

    IF TG_OP = 'DELETE' THEN
      IF old_version_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Published draw pool configuration is immutable' USING ERRCODE = '55000';
      END IF;
      RETURN OLD;
    END IF;

    SELECT version.status, product.ip_id, product.category, product.is_prize_only
      INTO new_version_status, new_draw_ip_id, new_draw_category, new_draw_is_prize_only
      FROM public.draw_probability_versions AS version
      JOIN public.catalog_products AS product ON product.id = version.product_id
     WHERE version.id = NEW.probability_version_id
     FOR UPDATE OF version;

    IF old_version_status = 'DRAFT' AND new_version_status = 'DRAFT' THEN
      IF new_draw_is_prize_only OR new_draw_category NOT IN ('gacha','kuji') THEN
        RAISE EXCEPTION 'Draw pools require a saleable gacha or kuji product' USING ERRCODE = '23514';
      END IF;
      validate_new := true;
    ELSIF old_version_status IN ('ACTIVE','RETIRED')
      AND NEW.id IS NOT DISTINCT FROM OLD.id
      AND NEW.probability_version_id IS NOT DISTINCT FROM OLD.probability_version_id
      AND NEW.prize_product_id IS NOT DISTINCT FROM OLD.prize_product_id
      AND NEW.prize_name_snapshot IS NOT DISTINCT FROM OLD.prize_name_snapshot
      AND NEW.prize_image_url_snapshot IS NOT DISTINCT FROM OLD.prize_image_url_snapshot
      AND NEW.prize_sku_snapshot IS NOT DISTINCT FROM OLD.prize_sku_snapshot
      AND NEW.prize_ip_id_snapshot IS NOT DISTINCT FROM OLD.prize_ip_id_snapshot
      AND NEW.prize_category_snapshot IS NOT DISTINCT FROM OLD.prize_category_snapshot
      AND NEW.rarity IS NOT DISTINCT FROM OLD.rarity
      AND NEW.weight IS NOT DISTINCT FROM OLD.weight
      AND NEW.initial_quantity IS NOT DISTINCT FROM OLD.initial_quantity
      AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
      AND OLD.remaining_quantity IS NOT NULL
      AND NEW.remaining_quantity = OLD.remaining_quantity - 1
    THEN
      RETURN NEW;
    ELSE
      RAISE EXCEPTION 'Published draw pool configuration is immutable' USING ERRCODE = '55000';
    END IF;
  END IF;

  IF validate_new THEN
    SELECT name, image_url, sku, ip_id, category, is_active, is_prize_only
      INTO canonical_name, canonical_image_url, canonical_sku, canonical_ip_id,
           canonical_category, canonical_is_active, canonical_is_prize_only
      FROM public.catalog_products
     WHERE id = NEW.prize_product_id
     FOR SHARE;
    IF NOT FOUND OR NOT canonical_is_active OR NOT canonical_is_prize_only THEN
      RAISE EXCEPTION 'Draw pool prizes must reference active prize-only products' USING ERRCODE = '23514';
    END IF;
    IF canonical_ip_id IS DISTINCT FROM new_draw_ip_id THEN
      RAISE EXCEPTION 'Draw pool prizes must belong to the draw product IP' USING ERRCODE = '23514';
    END IF;
    IF NEW.prize_name_snapshot IS DISTINCT FROM canonical_name
      OR NEW.prize_image_url_snapshot IS DISTINCT FROM canonical_image_url
      OR NEW.prize_sku_snapshot IS DISTINCT FROM canonical_sku
      OR NEW.prize_ip_id_snapshot IS DISTINCT FROM canonical_ip_id
      OR NEW.prize_category_snapshot IS DISTINCT FROM canonical_category
    THEN
      RAISE EXCEPTION 'Draw pool prize snapshot does not match the prize product' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Published draw pool configuration is immutable' USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_draw_version_active_saleable_product()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  draw_is_active boolean;
  draw_is_prize_only boolean;
  draw_category text;
BEGIN
  IF OLD.status = 'DRAFT' AND NEW.status = 'ACTIVE' THEN
    SELECT product.is_active, product.is_prize_only, product.category
      INTO draw_is_active, draw_is_prize_only, draw_category
      FROM public.catalog_products AS product
     WHERE product.id = NEW.product_id
     FOR SHARE;

    IF NOT FOUND
      OR NOT draw_is_active
      OR draw_is_prize_only
      OR draw_category NOT IN ('gacha','kuji')
    THEN
      RAISE EXCEPTION 'Only active saleable gacha or kuji products can publish a draw version'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER draw_probability_versions_active_product_guard
BEFORE UPDATE OF status ON public.draw_probability_versions
FOR EACH ROW EXECUTE FUNCTION public.guard_draw_version_active_saleable_product();
