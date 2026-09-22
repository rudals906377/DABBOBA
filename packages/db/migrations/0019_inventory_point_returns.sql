ALTER TABLE inventory_units
DROP CONSTRAINT inventory_units_status_check;

ALTER TABLE inventory_units
ADD CONSTRAINT inventory_units_status_check
CHECK (status IN (
  'OWNED',
  'EXCHANGE_LISTED',
  'EXCHANGE_OFFERED',
  'SHIPPING',
  'DELIVERED',
  'TRANSFERRED',
  'REFUNDED',
  'POINT_RETURNED'
)) NOT VALID;

ALTER TABLE inventory_units
VALIDATE CONSTRAINT inventory_units_status_check;

CREATE TABLE inventory_point_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  total_point_amount integer NOT NULL CHECK (total_point_amount > 0),
  returned_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_point_returns_user_idx
ON inventory_point_returns (user_id, returned_at DESC, id DESC);
CREATE TRIGGER inventory_point_returns_immutable
BEFORE UPDATE OR DELETE ON inventory_point_returns
FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

CREATE TABLE inventory_point_return_items (
  point_return_id uuid NOT NULL REFERENCES inventory_point_returns(id) ON DELETE RESTRICT,
  inventory_unit_id uuid NOT NULL UNIQUE REFERENCES inventory_units(id) ON DELETE RESTRICT,
  product_id text NOT NULL REFERENCES catalog_products(id) ON DELETE RESTRICT,
  reference_amount integer NOT NULL CHECK (reference_amount > 0),
  point_amount integer NOT NULL CHECK (point_amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (point_return_id, inventory_unit_id),
  CHECK (point_amount = reference_amount / 2)
);
CREATE INDEX inventory_point_return_items_return_idx
ON inventory_point_return_items (point_return_id, inventory_unit_id);
CREATE TRIGGER inventory_point_return_items_immutable
BEFORE UPDATE OR DELETE ON inventory_point_return_items
FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

CREATE OR REPLACE FUNCTION enforce_inventory_point_return_total()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  return_id uuid;
  recorded_total integer;
  item_total bigint;
BEGIN
  IF TG_TABLE_NAME = 'inventory_point_returns' THEN
    return_id := NEW.id;
  ELSE
    return_id := NEW.point_return_id;
  END IF;

  SELECT total_point_amount
    INTO recorded_total
    FROM inventory_point_returns
   WHERE id = return_id;
  SELECT COALESCE(sum(point_amount),0)
    INTO item_total
    FROM inventory_point_return_items
   WHERE point_return_id = return_id;

  IF recorded_total IS NULL OR item_total <> recorded_total THEN
    RAISE EXCEPTION 'Inventory point return total does not match its item ledger'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER inventory_point_returns_total_guard
AFTER INSERT ON inventory_point_returns
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_inventory_point_return_total();

CREATE CONSTRAINT TRIGGER inventory_point_return_items_total_guard
AFTER INSERT ON inventory_point_return_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_inventory_point_return_total();
