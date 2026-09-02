CREATE TABLE kuji_rooms (
  product_id text PRIMARY KEY REFERENCES catalog_products(id) ON DELETE RESTRICT,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER kuji_rooms_set_updated_at
BEFORE UPDATE ON kuji_rooms
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE kuji_room_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id text NOT NULL REFERENCES kuji_rooms(product_id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  order_id uuid UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state IN (
    'WAITING','CHECKOUT_PENDING','DRAWING','COMPLETED','CANCELLED','EXPIRED'
  )),
  queue_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  checkout_started_at timestamptz,
  checkout_expires_at timestamptz,
  drawing_started_at timestamptz,
  drawing_expires_at timestamptz,
  completed_at timestamptz,
  resolved_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((checkout_started_at IS NULL) = (checkout_expires_at IS NULL)),
  CHECK (
    checkout_started_at IS NULL
    OR checkout_expires_at = checkout_started_at + interval '3 minutes'
  ),
  CHECK ((drawing_started_at IS NULL) = (drawing_expires_at IS NULL)),
  CHECK (
    drawing_started_at IS NULL
    OR drawing_expires_at = drawing_started_at + interval '5 minutes'
  ),
  CHECK ((state IN ('WAITING','CHECKOUT_PENDING','DRAWING')) = (resolved_at IS NULL)),
  CHECK ((state = 'COMPLETED') = (completed_at IS NOT NULL)),
  CONSTRAINT kuji_room_entries_state_order_ck CHECK (
    (state = 'WAITING' AND order_id IS NULL)
    OR state = 'CHECKOUT_PENDING'
    OR (state IN ('DRAWING','COMPLETED') AND order_id IS NOT NULL)
    OR state IN ('CANCELLED','EXPIRED')
  ),
  CHECK (
    (state = 'WAITING'
      AND checkout_started_at IS NULL
      AND drawing_started_at IS NULL)
    OR (state = 'CHECKOUT_PENDING'
      AND checkout_started_at IS NOT NULL
      AND drawing_started_at IS NULL)
    OR (state = 'DRAWING'
      AND checkout_started_at IS NOT NULL
      AND drawing_started_at IS NOT NULL)
    OR state IN ('COMPLETED','CANCELLED','EXPIRED')
  )
);

CREATE UNIQUE INDEX kuji_room_entries_product_occupancy_idx
ON kuji_room_entries(product_id)
WHERE state IN ('CHECKOUT_PENDING','DRAWING');

CREATE UNIQUE INDEX kuji_room_entries_user_active_idx
ON kuji_room_entries(user_id)
WHERE state IN ('WAITING','CHECKOUT_PENDING','DRAWING');

CREATE INDEX kuji_room_entries_product_fifo_idx
ON kuji_room_entries(product_id,state,queue_sequence)
WHERE state = 'WAITING';

CREATE INDEX kuji_room_entries_user_history_idx
ON kuji_room_entries(user_id,joined_at DESC,id DESC);

CREATE INDEX draw_results_product_committed_idx
ON draw_results(product_id,committed_at DESC,id DESC);

CREATE TRIGGER kuji_room_entries_set_updated_at
BEFORE UPDATE ON kuji_room_entries
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION guard_kuji_room_entry_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Kuji room entry history is append-only' USING ERRCODE = '55000';
  END IF;

  IF OLD.product_id IS DISTINCT FROM NEW.product_id
    OR OLD.user_id IS DISTINCT FROM NEW.user_id
    OR OLD.queue_sequence IS DISTINCT FROM NEW.queue_sequence
    OR OLD.joined_at IS DISTINCT FROM NEW.joined_at
  THEN
    RAISE EXCEPTION 'Kuji room entry identity is immutable' USING ERRCODE = '55000';
  END IF;

  IF OLD.order_id IS NOT NULL
    AND OLD.order_id IS DISTINCT FROM NEW.order_id
  THEN
    RAISE EXCEPTION 'Kuji room entry order linkage is immutable' USING ERRCODE = '55000';
  END IF;

  IF OLD.state = 'CHECKOUT_PENDING'
    AND NEW.state = 'CHECKOUT_PENDING'
    AND (
      OLD.checkout_started_at IS DISTINCT FROM NEW.checkout_started_at
      OR OLD.checkout_expires_at IS DISTINCT FROM NEW.checkout_expires_at
    )
  THEN
    RAISE EXCEPTION 'Kuji checkout lease is non-renewing' USING ERRCODE = '55000';
  END IF;

  IF OLD.state = 'DRAWING'
    AND NEW.state = 'DRAWING'
    AND (
      OLD.drawing_started_at IS DISTINCT FROM NEW.drawing_started_at
      OR OLD.drawing_expires_at IS DISTINCT FROM NEW.drawing_expires_at
    )
  THEN
    RAISE EXCEPTION 'Kuji drawing lease is non-renewing' USING ERRCODE = '55000';
  END IF;

  IF OLD.state IN ('COMPLETED','CANCELLED','EXPIRED') THEN
    RAISE EXCEPTION 'Terminal kuji room entries are immutable' USING ERRCODE = '55000';
  END IF;

  IF (OLD.state = 'WAITING' AND NEW.state NOT IN ('WAITING','CHECKOUT_PENDING','CANCELLED'))
    OR (OLD.state = 'CHECKOUT_PENDING' AND NEW.state NOT IN ('CHECKOUT_PENDING','DRAWING','CANCELLED','EXPIRED'))
    OR (OLD.state = 'DRAWING' AND NEW.state NOT IN ('DRAWING','COMPLETED','CANCELLED','EXPIRED'))
  THEN
    RAISE EXCEPTION 'Invalid kuji room entry state transition: % -> %', OLD.state, NEW.state
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER kuji_room_entries_guard_transition
BEFORE UPDATE OR DELETE ON kuji_room_entries
FOR EACH ROW EXECUTE FUNCTION guard_kuji_room_entry_transition();
