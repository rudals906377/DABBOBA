DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM draw_probability_versions AS version
    JOIN draw_pool_entries AS entry ON entry.probability_version_id = version.id
    JOIN catalog_products AS prize_product ON prize_product.id = entry.prize_product_id
    WHERE version.status = 'ACTIVE'
      AND (NOT prize_product.is_active OR NOT prize_product.is_prize_only)
  ) THEN
    RAISE EXCEPTION 'Active draw versions must reference active prize-only products; retire the affected version before migrating'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION guard_draw_version_activation_catalog_state()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'DRAFT' AND NEW.status = 'ACTIVE' AND EXISTS (
    SELECT 1
    FROM draw_pool_entries AS entry
    JOIN catalog_products AS prize_product ON prize_product.id = entry.prize_product_id
    JOIN catalog_products AS draw_product ON draw_product.id = NEW.product_id
    WHERE entry.probability_version_id = NEW.id
      AND (
        NOT draw_product.is_active
        OR draw_product.is_prize_only
        OR draw_product.category NOT IN ('gacha','kuji')
        OR NOT prize_product.is_active
        OR NOT prize_product.is_prize_only
        OR prize_product.ip_id IS DISTINCT FROM draw_product.ip_id
        OR entry.prize_name_snapshot IS DISTINCT FROM prize_product.name
        OR entry.prize_image_url_snapshot IS DISTINCT FROM prize_product.image_url
        OR entry.prize_sku_snapshot IS DISTINCT FROM prize_product.sku
        OR entry.prize_ip_id_snapshot IS DISTINCT FROM prize_product.ip_id
        OR entry.prize_category_snapshot IS DISTINCT FROM prize_product.category
      )
  ) THEN
    RAISE EXCEPTION 'Draw version catalog state changed after the draft was created'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS draw_probability_versions_catalog_state_guard ON draw_probability_versions;
CREATE TRIGGER draw_probability_versions_catalog_state_guard
BEFORE UPDATE OF status ON draw_probability_versions
FOR EACH ROW EXECUTE FUNCTION guard_draw_version_activation_catalog_state();

CREATE OR REPLACE FUNCTION guard_active_draw_prize_deactivation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.is_active AND NOT NEW.is_active AND EXISTS (
    SELECT 1
    FROM draw_pool_entries AS entry
    JOIN draw_probability_versions AS version ON version.id = entry.probability_version_id
    WHERE entry.prize_product_id = OLD.id
      AND version.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'A prize used by an active draw version cannot be deactivated; publish a replacement version first'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS catalog_products_active_draw_prize_guard ON catalog_products;
CREATE TRIGGER catalog_products_active_draw_prize_guard
BEFORE UPDATE OF is_active ON catalog_products
FOR EACH ROW EXECUTE FUNCTION guard_active_draw_prize_deactivation();
