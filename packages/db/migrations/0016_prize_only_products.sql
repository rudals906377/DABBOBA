ALTER TABLE catalog_products
ADD COLUMN is_prize_only boolean NOT NULL DEFAULT false;

UPDATE catalog_products AS product
SET is_prize_only = true
FROM (
  SELECT DISTINCT prize_product_id
  FROM draw_pool_entries
) AS referenced_prize
WHERE product.id = referenced_prize.prize_product_id
  AND product.is_prize_only = false;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM draw_pool_entries AS entry
    JOIN draw_probability_versions AS version ON version.id = entry.probability_version_id
    JOIN catalog_products AS draw_product ON draw_product.id = version.product_id
    JOIN catalog_products AS prize_product ON prize_product.id = entry.prize_product_id
    WHERE draw_product.is_prize_only
       OR draw_product.category NOT IN ('gacha','kuji')
       OR prize_product.ip_id IS DISTINCT FROM draw_product.ip_id
  ) THEN
    RAISE EXCEPTION 'Existing draw pools require a saleable gacha or kuji product and same-IP prizes'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE draw_pool_entries
ADD COLUMN prize_name_snapshot varchar(240),
ADD COLUMN prize_image_url_snapshot text,
ADD COLUMN prize_sku_snapshot varchar(80),
ADD COLUMN prize_ip_id_snapshot text,
ADD COLUMN prize_category_snapshot text;

DROP TRIGGER draw_pool_entries_guard_mutation ON draw_pool_entries;

UPDATE draw_pool_entries AS entry
SET prize_name_snapshot = product.name,
    prize_image_url_snapshot = product.image_url,
    prize_sku_snapshot = product.sku,
    prize_ip_id_snapshot = product.ip_id,
    prize_category_snapshot = product.category
FROM catalog_products AS product
WHERE product.id = entry.prize_product_id;

ALTER TABLE draw_pool_entries
ALTER COLUMN prize_name_snapshot SET NOT NULL,
ALTER COLUMN prize_sku_snapshot SET NOT NULL,
ALTER COLUMN prize_ip_id_snapshot SET NOT NULL,
ALTER COLUMN prize_category_snapshot SET NOT NULL;

CREATE OR REPLACE FUNCTION guard_catalog_product_prize_only_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_prize_only IS DISTINCT FROM OLD.is_prize_only THEN
    RAISE EXCEPTION 'Prize-only catalog role is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER catalog_products_prize_only_immutable
BEFORE UPDATE OF is_prize_only ON catalog_products
FOR EACH ROW EXECUTE FUNCTION guard_catalog_product_prize_only_mutation();

CREATE OR REPLACE FUNCTION guard_draw_pool_entry_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_version_status text;
  new_version_status text;
  new_draw_ip_id text;
  new_draw_category text;
  new_draw_is_active boolean;
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
    SELECT version.status, product.ip_id, product.category, product.is_active, product.is_prize_only
      INTO new_version_status, new_draw_ip_id, new_draw_category, new_draw_is_active, new_draw_is_prize_only
      FROM draw_probability_versions AS version
      JOIN catalog_products AS product ON product.id = version.product_id
     WHERE version.id = NEW.probability_version_id
     FOR UPDATE OF version;
    IF new_version_status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Published draw pool configuration is immutable' USING ERRCODE = '55000';
    END IF;
    IF NOT new_draw_is_active OR new_draw_is_prize_only OR new_draw_category NOT IN ('gacha','kuji') THEN
      RAISE EXCEPTION 'Draw pools require an active saleable gacha or kuji product' USING ERRCODE = '23514';
    END IF;
    validate_new := true;
  ELSE
    SELECT status INTO old_version_status
      FROM draw_probability_versions
     WHERE id = OLD.probability_version_id
     FOR UPDATE;

    IF TG_OP = 'DELETE' THEN
      IF old_version_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Published draw pool configuration is immutable' USING ERRCODE = '55000';
      END IF;
      RETURN OLD;
    END IF;

    SELECT version.status, product.ip_id, product.category, product.is_active, product.is_prize_only
      INTO new_version_status, new_draw_ip_id, new_draw_category, new_draw_is_active, new_draw_is_prize_only
      FROM draw_probability_versions AS version
      JOIN catalog_products AS product ON product.id = version.product_id
     WHERE version.id = NEW.probability_version_id
     FOR UPDATE OF version;

    IF old_version_status = 'DRAFT' AND new_version_status = 'DRAFT' THEN
      IF NOT new_draw_is_active OR new_draw_is_prize_only OR new_draw_category NOT IN ('gacha','kuji') THEN
        RAISE EXCEPTION 'Draw pools require an active saleable gacha or kuji product' USING ERRCODE = '23514';
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
      FROM catalog_products
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

CREATE TRIGGER draw_pool_entries_guard_mutation
BEFORE INSERT OR UPDATE OR DELETE ON draw_pool_entries
FOR EACH ROW EXECUTE FUNCTION guard_draw_pool_entry_mutation();
