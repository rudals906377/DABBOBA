CREATE OR REPLACE FUNCTION lock_active_draw_prize_catalog_state()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('active-draw-prize-catalog-state', 0));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS draw_probability_versions_catalog_state_lock ON draw_probability_versions;
CREATE TRIGGER draw_probability_versions_catalog_state_lock
BEFORE UPDATE OF status ON draw_probability_versions
FOR EACH STATEMENT EXECUTE FUNCTION lock_active_draw_prize_catalog_state();

DROP TRIGGER IF EXISTS catalog_products_active_draw_prize_lock ON catalog_products;
CREATE TRIGGER catalog_products_active_draw_prize_lock
BEFORE UPDATE OF is_active ON catalog_products
FOR EACH STATEMENT EXECUTE FUNCTION lock_active_draw_prize_catalog_state();

CREATE OR REPLACE FUNCTION guard_draw_version_activation_catalog_state()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  catalog_state record;
  pool_count integer := 0;
BEGIN
  IF OLD.status = 'DRAFT' AND NEW.status = 'ACTIVE' THEN
    FOR catalog_state IN
      SELECT
        draw_product.is_active AS draw_is_active,
        draw_product.is_prize_only AS draw_is_prize_only,
        draw_product.category AS draw_category,
        draw_product.ip_id AS draw_ip_id,
        prize_product.is_active AS prize_is_active,
        prize_product.is_prize_only AS prize_is_prize_only,
        prize_product.name AS prize_name,
        prize_product.image_url AS prize_image_url,
        prize_product.sku AS prize_sku,
        prize_product.ip_id AS prize_ip_id,
        prize_product.category AS prize_category,
        entry.prize_name_snapshot,
        entry.prize_image_url_snapshot,
        entry.prize_sku_snapshot,
        entry.prize_ip_id_snapshot,
        entry.prize_category_snapshot
      FROM draw_pool_entries AS entry
      JOIN catalog_products AS prize_product ON prize_product.id = entry.prize_product_id
      JOIN catalog_products AS draw_product ON draw_product.id = NEW.product_id
      WHERE entry.probability_version_id = NEW.id
      ORDER BY prize_product.id
      FOR SHARE OF prize_product, draw_product
    LOOP
      pool_count := pool_count + 1;
      IF NOT catalog_state.draw_is_active
        OR catalog_state.draw_is_prize_only
        OR catalog_state.draw_category NOT IN ('gacha','kuji')
        OR NOT catalog_state.prize_is_active
        OR NOT catalog_state.prize_is_prize_only
        OR catalog_state.prize_ip_id IS DISTINCT FROM catalog_state.draw_ip_id
        OR catalog_state.prize_name_snapshot IS DISTINCT FROM catalog_state.prize_name
        OR catalog_state.prize_image_url_snapshot IS DISTINCT FROM catalog_state.prize_image_url
        OR catalog_state.prize_sku_snapshot IS DISTINCT FROM catalog_state.prize_sku
        OR catalog_state.prize_ip_id_snapshot IS DISTINCT FROM catalog_state.prize_ip_id
        OR catalog_state.prize_category_snapshot IS DISTINCT FROM catalog_state.prize_category
      THEN
        RAISE EXCEPTION 'Draw version catalog state changed after the draft was created'
          USING ERRCODE = '23514';
      END IF;
    END LOOP;
    IF pool_count = 0 THEN
      RAISE EXCEPTION 'A draw version cannot be activated without prize entries'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_active_draw_prize_deactivation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  version_state record;
BEGIN
  IF OLD.is_active AND NOT NEW.is_active THEN
    FOR version_state IN
      SELECT version.status
      FROM draw_pool_entries AS entry
      JOIN draw_probability_versions AS version ON version.id = entry.probability_version_id
      WHERE entry.prize_product_id = OLD.id
      ORDER BY version.id
      FOR SHARE OF version
    LOOP
      IF version_state.status = 'ACTIVE' THEN
        RAISE EXCEPTION 'A prize used by an active draw version cannot be deactivated; publish a replacement version first'
          USING ERRCODE = '23514';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
