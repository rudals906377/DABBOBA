CREATE OR REPLACE FUNCTION guard_published_draw_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  pool_count bigint;
  drawable_count bigint;
  has_unlimited boolean;
  finite_remaining bigint;
  stock_on_hand bigint;
  outstanding_entitlements bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Published draw probability versions are immutable' USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'DRAFT' AND NEW.status NOT IN ('DRAFT','ACTIVE') THEN
    RAISE EXCEPTION 'A draft draw probability version can only be published as active' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'ACTIVE' AND NEW.status NOT IN ('ACTIVE','RETIRED') THEN
    RAISE EXCEPTION 'An active draw probability version can only be retired' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'RETIRED' AND NEW.status <> 'RETIRED' THEN
    RAISE EXCEPTION 'Retired draw probability versions are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status IN ('ACTIVE','RETIRED') AND (
    NEW.product_id IS DISTINCT FROM OLD.product_id
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.published_by IS DISTINCT FROM OLD.published_by
    OR NEW.published_at IS DISTINCT FROM OLD.published_at
  ) THEN
    RAISE EXCEPTION 'Published draw probability version metadata is immutable' USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'DRAFT' AND NEW.status = 'ACTIVE' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('draw-capacity:' || OLD.id::text, 0));
    SELECT count(*),
           count(*) FILTER (WHERE remaining_quantity IS NULL OR remaining_quantity > 0),
           COALESCE(bool_or(remaining_quantity IS NULL),false),
           COALESCE(sum(remaining_quantity) FILTER (WHERE remaining_quantity IS NOT NULL),0)
      INTO pool_count, drawable_count, has_unlimited, finite_remaining
      FROM draw_pool_entries
     WHERE probability_version_id = OLD.id;
    IF pool_count = 0 OR drawable_count <> pool_count THEN
      RAISE EXCEPTION 'Every published draw pool entry must have drawable quantity' USING ERRCODE = '23514';
    END IF;
    IF NOT has_unlimited THEN
      SELECT on_hand INTO stock_on_hand FROM product_stock WHERE product_id=OLD.product_id FOR UPDATE;
      SELECT count(*) INTO outstanding_entitlements
        FROM draw_entitlements
       WHERE product_id=OLD.product_id AND probability_version_id=OLD.id AND status='AVAILABLE';
      IF stock_on_hand > finite_remaining - outstanding_entitlements THEN
        RAISE EXCEPTION 'Draw stock exceeds finite prize capacity' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_draw_product_stock_capacity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  active_version_id uuid;
  has_unlimited boolean;
  finite_remaining bigint;
  outstanding_entitlements bigint;
BEGIN
  SELECT id INTO active_version_id
    FROM draw_probability_versions
   WHERE product_id=NEW.product_id AND status='ACTIVE';
  IF active_version_id IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('draw-capacity:' || active_version_id::text, 0));
  SELECT COALESCE(bool_or(remaining_quantity IS NULL),false),
         COALESCE(sum(remaining_quantity) FILTER (WHERE remaining_quantity IS NOT NULL),0)
    INTO has_unlimited, finite_remaining
    FROM draw_pool_entries
   WHERE probability_version_id=active_version_id;
  IF NOT has_unlimited THEN
    SELECT count(*) INTO outstanding_entitlements
      FROM draw_entitlements
     WHERE product_id=NEW.product_id AND probability_version_id=active_version_id AND status='AVAILABLE';
    IF NEW.on_hand > finite_remaining - outstanding_entitlements THEN
      RAISE EXCEPTION 'Draw stock exceeds finite prize capacity' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS product_stock_draw_capacity_guard ON product_stock;
CREATE TRIGGER product_stock_draw_capacity_guard
BEFORE INSERT OR UPDATE OF on_hand ON product_stock
FOR EACH ROW EXECUTE FUNCTION guard_draw_product_stock_capacity();

CREATE OR REPLACE FUNCTION guard_draw_entitlement_capacity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  has_unlimited boolean;
  finite_remaining bigint;
  outstanding_entitlements bigint;
  stock_on_hand bigint;
  version_status text;
BEGIN
  IF NEW.status <> 'AVAILABLE' THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('draw-capacity:' || NEW.probability_version_id::text, 0));
  SELECT COALESCE(bool_or(remaining_quantity IS NULL),false),
         COALESCE(sum(remaining_quantity) FILTER (WHERE remaining_quantity IS NOT NULL),0)
    INTO has_unlimited, finite_remaining
    FROM draw_pool_entries
   WHERE probability_version_id=NEW.probability_version_id;
  IF NOT has_unlimited THEN
    SELECT status INTO version_status FROM draw_probability_versions WHERE id=NEW.probability_version_id;
    SELECT count(*) INTO outstanding_entitlements
      FROM draw_entitlements
     WHERE product_id=NEW.product_id AND probability_version_id=NEW.probability_version_id AND status='AVAILABLE';
    IF outstanding_entitlements + 1 > finite_remaining THEN
      RAISE EXCEPTION 'Draw entitlement exceeds finite prize capacity' USING ERRCODE = '23514';
    END IF;
    IF version_status = 'ACTIVE' THEN
      SELECT on_hand INTO stock_on_hand FROM product_stock WHERE product_id=NEW.product_id FOR UPDATE;
      IF stock_on_hand > finite_remaining - outstanding_entitlements - 1 THEN
        RAISE EXCEPTION 'Draw entitlement exceeds finite prize capacity' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS draw_entitlement_capacity_guard ON draw_entitlements;
CREATE TRIGGER draw_entitlement_capacity_guard
BEFORE INSERT ON draw_entitlements
FOR EACH ROW EXECUTE FUNCTION guard_draw_entitlement_capacity();
