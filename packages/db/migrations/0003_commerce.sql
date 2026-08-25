CREATE TABLE coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code citext NOT NULL UNIQUE,
  discount_type text NOT NULL CHECK (discount_type IN ('FIXED','PERCENT')),
  discount_value integer NOT NULL CHECK (discount_value > 0),
  maximum_discount integer CHECK (maximum_discount IS NULL OR maximum_discount > 0),
  minimum_order integer NOT NULL DEFAULT 0 CHECK (minimum_order >= 0),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  usage_limit integer CHECK (usage_limit IS NULL OR usage_limit > 0),
  used_count integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE TRIGGER coupons_set_updated_at BEFORE UPDATE ON coupons
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE point_accounts (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  balance integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER point_accounts_set_updated_at BEFORE UPDATE ON point_accounts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'PENDING_PAYMENT' CHECK (status IN ('PENDING_PAYMENT','PAID','FULFILLED','CANCELLED','REFUND_REVIEW','REFUNDED')),
  currency char(3) NOT NULL DEFAULT 'KRW' CHECK (currency = 'KRW'),
  subtotal integer NOT NULL CHECK (subtotal >= 0),
  discount_total integer NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  point_total integer NOT NULL DEFAULT 0 CHECK (point_total >= 0),
  total integer NOT NULL CHECK (total >= 0),
  coupon_id uuid REFERENCES coupons(id) ON DELETE RESTRICT,
  paid_at timestamptz,
  cancelled_at timestamptz,
  refunded_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (subtotal - discount_total - point_total = total)
);
CREATE INDEX orders_user_idx ON orders (user_id, created_at DESC, id DESC);
CREATE TRIGGER orders_set_updated_at BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  product_id text NOT NULL REFERENCES catalog_products(id) ON DELETE RESTRICT,
  product_name_snapshot varchar(240) NOT NULL,
  category_snapshot text NOT NULL CHECK (category_snapshot IN ('gacha','figure','kuji','tcg')),
  probability_version_id uuid,
  unit_price integer NOT NULL CHECK (unit_price >= 0),
  quantity integer NOT NULL CHECK (quantity > 0),
  line_total integer NOT NULL CHECK (line_total >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (unit_price * quantity = line_total)
);
CREATE INDEX order_lines_order_idx ON order_lines (order_id);

CREATE TABLE coupon_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid NOT NULL REFERENCES coupons(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED','COMMITTED','RELEASED','REFUNDED')),
  discount_amount integer NOT NULL CHECK (discount_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER coupon_redemptions_set_updated_at BEFORE UPDATE ON coupon_redemptions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE stock_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  order_line_id uuid NOT NULL REFERENCES order_lines(id) ON DELETE RESTRICT,
  product_id text NOT NULL REFERENCES catalog_products(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','COMMITTED','RELEASED','EXPIRED')),
  expires_at timestamptz NOT NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_line_id)
);
CREATE INDEX stock_reservations_active_idx ON stock_reservations (expires_at) WHERE status = 'ACTIVE';

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  provider varchar(40) NOT NULL,
  provider_payment_id varchar(200),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','AUTHORIZED','PAID','FAILED','CANCELLED','REFUND_REVIEW','REFUNDED')),
  amount integer NOT NULL CHECK (amount >= 0),
  currency char(3) NOT NULL DEFAULT 'KRW' CHECK (currency = 'KRW'),
  failure_code varchar(100),
  paid_at timestamptz,
  refunded_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payments_provider_id_idx ON payments (provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL;
CREATE TRIGGER payments_set_updated_at BEFORE UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE payment_provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider varchar(40) NOT NULL,
  provider_event_id varchar(200) NOT NULL,
  event_type varchar(100) NOT NULL,
  payment_id uuid REFERENCES payments(id) ON DELETE RESTRICT,
  signature_digest text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  processed_at timestamptz,
  processing_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);
CREATE TRIGGER payment_provider_events_immutable
BEFORE UPDATE OR DELETE ON payment_provider_events
FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

CREATE TABLE payment_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  entry_type text NOT NULL CHECK (entry_type IN ('PAYMENT','REFUND','ADJUSTMENT')),
  amount integer NOT NULL,
  currency char(3) NOT NULL DEFAULT 'KRW' CHECK (currency = 'KRW'),
  reference_id text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((entry_type = 'PAYMENT' AND amount > 0) OR (entry_type IN ('REFUND','ADJUSTMENT') AND amount <> 0))
);
CREATE UNIQUE INDEX payment_ledger_reference_idx ON payment_ledger_entries (payment_id, entry_type, reference_id);
CREATE TRIGGER payment_ledger_entries_immutable
BEFORE UPDATE OR DELETE ON payment_ledger_entries
FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

CREATE TABLE point_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  entry_type text NOT NULL CHECK (entry_type IN ('EARN','SPEND','REFUND','EXPIRE','ADJUSTMENT')),
  amount integer NOT NULL CHECK (amount <> 0),
  reference_type varchar(100) NOT NULL,
  reference_id text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, entry_type, reference_type, reference_id)
);
CREATE INDEX point_ledger_user_idx ON point_ledger_entries (user_id, created_at DESC, id DESC);
CREATE TRIGGER point_ledger_entries_immutable
BEFORE UPDATE OR DELETE ON point_ledger_entries
FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

CREATE TABLE draw_probability_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id text NOT NULL REFERENCES catalog_products(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
  published_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, version),
  CHECK (
    (status = 'DRAFT' AND published_by IS NULL AND published_at IS NULL)
    OR (status IN ('ACTIVE','RETIRED') AND published_by IS NOT NULL AND published_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX draw_probability_one_active_idx ON draw_probability_versions (product_id) WHERE status = 'ACTIVE';

CREATE OR REPLACE FUNCTION guard_published_draw_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  pool_count bigint;
  drawable_count bigint;
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
    SELECT count(*), count(*) FILTER (WHERE remaining_quantity IS NULL OR remaining_quantity > 0)
      INTO pool_count, drawable_count
      FROM draw_pool_entries
     WHERE probability_version_id = OLD.id;
    IF pool_count = 0 OR drawable_count <> pool_count THEN
      RAISE EXCEPTION 'Every published draw pool entry must have drawable quantity' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TABLE draw_pool_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  probability_version_id uuid NOT NULL REFERENCES draw_probability_versions(id) ON DELETE RESTRICT,
  prize_product_id text NOT NULL REFERENCES catalog_products(id) ON DELETE RESTRICT,
  rarity varchar(40) NOT NULL,
  weight integer NOT NULL CHECK (weight > 0),
  initial_quantity integer CHECK (initial_quantity IS NULL OR initial_quantity > 0),
  remaining_quantity integer CHECK (remaining_quantity IS NULL OR remaining_quantity >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((initial_quantity IS NULL) = (remaining_quantity IS NULL)),
  CHECK (remaining_quantity IS NULL OR remaining_quantity <= initial_quantity)
);
CREATE INDEX draw_pool_entries_version_idx ON draw_pool_entries (probability_version_id);

CREATE OR REPLACE FUNCTION guard_draw_pool_entry_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_version_status text;
  new_version_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO new_version_status
      FROM draw_probability_versions
     WHERE id = NEW.probability_version_id
     FOR UPDATE;
    IF new_version_status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Published draw pool configuration is immutable' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

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

  SELECT status INTO new_version_status
    FROM draw_probability_versions
   WHERE id = NEW.probability_version_id
   FOR UPDATE;

  IF old_version_status = 'DRAFT' AND new_version_status = 'DRAFT' THEN
    RETURN NEW;
  END IF;

  IF old_version_status IN ('ACTIVE','RETIRED')
    AND NEW.id IS NOT DISTINCT FROM OLD.id
    AND NEW.probability_version_id IS NOT DISTINCT FROM OLD.probability_version_id
    AND NEW.prize_product_id IS NOT DISTINCT FROM OLD.prize_product_id
    AND NEW.rarity IS NOT DISTINCT FROM OLD.rarity
    AND NEW.weight IS NOT DISTINCT FROM OLD.weight
    AND NEW.initial_quantity IS NOT DISTINCT FROM OLD.initial_quantity
    AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
    AND OLD.remaining_quantity IS NOT NULL
    AND NEW.remaining_quantity = OLD.remaining_quantity - 1
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Published draw pool configuration is immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER draw_pool_entries_guard_mutation
BEFORE INSERT OR UPDATE OR DELETE ON draw_pool_entries
FOR EACH ROW EXECUTE FUNCTION guard_draw_pool_entry_mutation();

CREATE TRIGGER draw_probability_versions_guard_mutation
BEFORE UPDATE OR DELETE ON draw_probability_versions
FOR EACH ROW EXECUTE FUNCTION guard_published_draw_version_mutation();

ALTER TABLE order_lines
ADD CONSTRAINT order_lines_probability_version_fk
FOREIGN KEY (probability_version_id) REFERENCES draw_probability_versions(id) ON DELETE RESTRICT;

ALTER TABLE order_lines
ADD CONSTRAINT order_lines_draw_version_check
CHECK ((category_snapshot IN ('gacha','kuji')) = (probability_version_id IS NOT NULL));

CREATE TABLE draw_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_line_id uuid NOT NULL REFERENCES order_lines(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  product_id text NOT NULL REFERENCES catalog_products(id) ON DELETE RESTRICT,
  probability_version_id uuid NOT NULL REFERENCES draw_probability_versions(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','CONSUMED','CANCELLED')),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX draw_entitlements_user_idx ON draw_entitlements (user_id, status, created_at DESC);

CREATE TABLE draw_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entitlement_id uuid NOT NULL UNIQUE REFERENCES draw_entitlements(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  product_id text NOT NULL REFERENCES catalog_products(id) ON DELETE RESTRICT,
  pool_entry_id uuid NOT NULL REFERENCES draw_pool_entries(id) ON DELETE RESTRICT,
  prize_product_id text NOT NULL REFERENCES catalog_products(id) ON DELETE RESTRICT,
  prize_inventory_unit_id uuid NOT NULL UNIQUE REFERENCES inventory_units(id) ON DELETE RESTRICT,
  probability_version integer NOT NULL CHECK (probability_version > 0),
  selection_algorithm varchar(40) NOT NULL CHECK (selection_algorithm = 'SHA256_REJECTION_V1'),
  entropy_hex text NOT NULL CHECK (entropy_hex ~ '^[0-9a-f]{64}$'),
  entropy_digest text NOT NULL CHECK (entropy_digest ~ '^[0-9a-f]{64}$'),
  roll_value bigint NOT NULL CHECK (roll_value >= 0),
  total_weight bigint NOT NULL CHECK (total_weight > 0 AND total_weight <= 9007199254740991),
  selection_snapshot jsonb NOT NULL CHECK (jsonb_typeof(selection_snapshot) = 'array'),
  committed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (roll_value < total_weight)
);
CREATE TRIGGER draw_results_immutable
BEFORE UPDATE OR DELETE ON draw_results
FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

CREATE TABLE shipping_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','PROCESSING','SHIPPED','DELIVERED','CANCELLED')),
  address_snapshot jsonb NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  shipped_at timestamptz,
  tracking_carrier varchar(100),
  tracking_number varchar(200),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER shipping_requests_set_updated_at BEFORE UPDATE ON shipping_requests
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE shipping_request_items (
  shipping_request_id uuid NOT NULL REFERENCES shipping_requests(id) ON DELETE RESTRICT,
  inventory_unit_id uuid NOT NULL UNIQUE REFERENCES inventory_units(id) ON DELETE RESTRICT,
  PRIMARY KEY (shipping_request_id, inventory_unit_id)
);
