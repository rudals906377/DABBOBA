INSERT INTO admin_permissions (code, description) VALUES
  ('orders.read', 'Read orders and fulfillment state'),
  ('payments.read', 'Read payment and provider reconciliation state'),
  ('refunds.read', 'Read refund review queues and notes'),
  ('refunds.review', 'Record refund review state and operational notes without executing provider refunds'),
  ('inventory.read', 'Read product stock, reservations, and adjustment history'),
  ('inventory.adjust', 'Append a manual product stock adjustment'),
  ('shipping.read', 'Read shipping request queues and status'),
  ('shipping.destination.read', 'Read a shipping request destination on its detail view'),
  ('shipping.manage', 'Advance shipping requests through approved fulfillment states')
ON CONFLICT DO NOTHING;

INSERT INTO admin_role_permissions (role, permission_code)
SELECT 'SUPER_ADMIN', code
FROM admin_permissions
WHERE code IN (
  'orders.read','payments.read','refunds.read','refunds.review',
  'inventory.read','inventory.adjust','shipping.read','shipping.destination.read','shipping.manage'
)
ON CONFLICT DO NOTHING;

INSERT INTO admin_role_permissions (role, permission_code) VALUES
  ('ADMIN','orders.read'),
  ('ADMIN','payments.read'),
  ('ADMIN','refunds.read'),
  ('ADMIN','refunds.review'),
  ('ADMIN','inventory.read'),
  ('ADMIN','shipping.read'),
  ('ADMIN','shipping.destination.read'),
  ('ADMIN','shipping.manage')
ON CONFLICT DO NOTHING;

-- Idempotency responses expire after 24 hours. Audit lookup therefore cannot
-- impose a permanent uniqueness rule on a key that is intentionally reusable.
DROP INDEX admin_audit_logs_idempotency_idx;
CREATE INDEX admin_audit_logs_idempotency_idx
ON admin_audit_logs (admin_id, idempotency_key, created_at DESC);

CREATE TABLE admin_commerce_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL UNIQUE REFERENCES payments(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','IN_REVIEW','WAITING_PROVIDER','ESCALATED','CLOSED')),
  assigned_admin_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  closed_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL))
);
CREATE INDEX admin_commerce_reviews_queue_idx
ON admin_commerce_reviews (status, updated_at DESC, id DESC);
CREATE OR REPLACE FUNCTION enforce_admin_commerce_review_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  IF NOT (
    (OLD.status = 'PENDING' AND NEW.status IN ('IN_REVIEW','ESCALATED','CLOSED'))
    OR (OLD.status = 'IN_REVIEW' AND NEW.status IN ('WAITING_PROVIDER','ESCALATED','CLOSED'))
    OR (OLD.status = 'WAITING_PROVIDER' AND NEW.status IN ('IN_REVIEW','ESCALATED','CLOSED'))
    OR (OLD.status = 'ESCALATED' AND NEW.status IN ('IN_REVIEW','WAITING_PROVIDER','CLOSED'))
  ) THEN
    RAISE EXCEPTION 'Invalid commerce review transition: % -> %', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER admin_commerce_reviews_transition_guard
BEFORE UPDATE OF status ON admin_commerce_reviews
FOR EACH ROW EXECUTE FUNCTION enforce_admin_commerce_review_transition();
CREATE TRIGGER admin_commerce_reviews_set_updated_at
BEFORE UPDATE ON admin_commerce_reviews
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE admin_commerce_review_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES admin_commerce_reviews(id) ON DELETE RESTRICT,
  admin_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status_snapshot text NOT NULL
    CHECK (status_snapshot IN ('PENDING','IN_REVIEW','WAITING_PROVIDER','ESCALATED','CLOSED')),
  note text NOT NULL CHECK (char_length(note) BETWEEN 2 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_commerce_review_notes_review_idx
ON admin_commerce_review_notes (review_id, created_at DESC, id DESC);
CREATE TRIGGER admin_commerce_review_notes_immutable
BEFORE UPDATE OR DELETE ON admin_commerce_review_notes
FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

CREATE TABLE product_stock_adjustment_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id text NOT NULL REFERENCES catalog_products(id) ON DELETE RESTRICT,
  admin_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  delta_on_hand integer NOT NULL CHECK (delta_on_hand <> 0),
  before_on_hand integer NOT NULL CHECK (before_on_hand >= 0),
  after_on_hand integer NOT NULL CHECK (after_on_hand >= 0),
  before_reserved integer NOT NULL CHECK (before_reserved >= 0),
  after_reserved integer NOT NULL CHECK (after_reserved >= 0),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 2 AND 1000),
  request_id text NOT NULL,
  idempotency_key varchar(200) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (after_on_hand = before_on_hand + delta_on_hand),
  CHECK (after_reserved = before_reserved),
  CHECK (after_reserved <= after_on_hand)
);
CREATE INDEX product_stock_adjustment_product_idx
ON product_stock_adjustment_ledger (product_id, created_at DESC, id DESC);
CREATE INDEX product_stock_adjustment_idempotency_idx
ON product_stock_adjustment_ledger (admin_id, idempotency_key, created_at DESC);
CREATE TRIGGER product_stock_adjustment_ledger_immutable
BEFORE UPDATE OR DELETE ON product_stock_adjustment_ledger
FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

ALTER TABLE shipping_requests
ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);

ALTER TABLE shipping_requests
ADD CONSTRAINT shipping_requests_tracking_pair_check
CHECK ((tracking_carrier IS NULL) = (tracking_number IS NULL)) NOT VALID;

ALTER TABLE shipping_requests
ADD CONSTRAINT shipping_requests_tracking_state_check
CHECK (
  (status IN ('SHIPPED','DELIVERED')
    AND shipped_at IS NOT NULL
    AND tracking_carrier IS NOT NULL
    AND tracking_number IS NOT NULL)
  OR
  (status IN ('REQUESTED','PROCESSING','CANCELLED')
    AND shipped_at IS NULL
    AND tracking_carrier IS NULL
    AND tracking_number IS NULL)
) NOT VALID;

CREATE OR REPLACE FUNCTION enforce_shipping_request_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = NEW.status THEN
    IF NEW.tracking_carrier IS DISTINCT FROM OLD.tracking_carrier
      OR NEW.tracking_number IS DISTINCT FROM OLD.tracking_number
      OR NEW.shipped_at IS DISTINCT FROM OLD.shipped_at
    THEN
      RAISE EXCEPTION 'Shipping metadata can only change with a state transition' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'REQUESTED' AND NEW.status IN ('PROCESSING','CANCELLED'))
    OR (OLD.status = 'PROCESSING' AND NEW.status IN ('SHIPPED','CANCELLED'))
    OR (OLD.status = 'SHIPPED' AND NEW.status = 'DELIVERED')
  ) THEN
    RAISE EXCEPTION 'Invalid shipping request transition: % -> %', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'DELIVERED' AND (
    NEW.tracking_carrier IS DISTINCT FROM OLD.tracking_carrier
    OR NEW.tracking_number IS DISTINCT FROM OLD.tracking_number
    OR NEW.shipped_at IS DISTINCT FROM OLD.shipped_at
  ) THEN
    RAISE EXCEPTION 'Delivered shipping metadata must match the shipped state' USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER shipping_requests_transition_guard
BEFORE UPDATE OF status, tracking_carrier, tracking_number, shipped_at ON shipping_requests
FOR EACH ROW EXECUTE FUNCTION enforce_shipping_request_transition();

CREATE TABLE shipping_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipping_request_id uuid NOT NULL REFERENCES shipping_requests(id) ON DELETE RESTRICT,
  admin_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  from_status text NOT NULL
    CHECK (from_status IN ('REQUESTED','PROCESSING','SHIPPED','DELIVERED','CANCELLED')),
  to_status text NOT NULL
    CHECK (to_status IN ('PROCESSING','SHIPPED','DELIVERED','CANCELLED')),
  tracking_carrier varchar(100),
  tracking_number varchar(200),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 2 AND 1000),
  request_id text NOT NULL,
  idempotency_key varchar(200) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((tracking_carrier IS NULL) = (tracking_number IS NULL))
);
CREATE INDEX shipping_status_events_request_idx
ON shipping_status_events (shipping_request_id, created_at DESC, id DESC);
CREATE INDEX shipping_status_events_idempotency_idx
ON shipping_status_events (admin_id, idempotency_key, created_at DESC);
CREATE TRIGGER shipping_status_events_immutable
BEFORE UPDATE OR DELETE ON shipping_status_events
FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

CREATE INDEX orders_admin_queue_idx ON orders (status, created_at DESC, id DESC);
CREATE INDEX payments_admin_queue_idx ON payments (status, created_at DESC, id DESC);
CREATE INDEX shipping_requests_admin_queue_idx ON shipping_requests (status, requested_at DESC, id DESC);
