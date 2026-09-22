-- Finite kuji decks are published as an immutable, server-shuffled slot map.
-- Customer-facing queries must project only slot availability and aggregate
-- tier counts; the slot-to-prize mapping remains backend-only until consume.

CREATE TABLE public.kuji_deck_tiers (
  probability_version_id uuid NOT NULL REFERENCES public.draw_probability_versions(id) ON DELETE RESTRICT,
  pool_entry_id uuid NOT NULL PRIMARY KEY REFERENCES public.draw_pool_entries(id) ON DELETE RESTRICT,
  tier_code varchar(40) NOT NULL CHECK (tier_code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$'),
  tier_rank integer NOT NULL CHECK (tier_rank >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (probability_version_id, tier_code),
  UNIQUE (probability_version_id, tier_rank)
);

CREATE TABLE public.kuji_decks (
  probability_version_id uuid PRIMARY KEY REFERENCES public.draw_probability_versions(id) ON DELETE RESTRICT,
  total_slots integer NOT NULL CHECK (total_slots BETWEEN 1 AND 10000),
  assignment_algorithm varchar(40) NOT NULL DEFAULT 'CSPRNG_FISHER_YATES_V1'
    CHECK (assignment_algorithm IN ('CSPRNG_FISHER_YATES_V1','LEGACY_SINGLE_TIER_V1')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.kuji_slot_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  probability_version_id uuid NOT NULL REFERENCES public.kuji_decks(probability_version_id) ON DELETE RESTRICT,
  slot_number integer NOT NULL CHECK (slot_number > 0),
  pool_entry_id uuid NOT NULL REFERENCES public.kuji_deck_tiers(pool_entry_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (probability_version_id, slot_number)
);

CREATE INDEX kuji_slot_assignments_pool_entry_idx
ON public.kuji_slot_assignments (pool_entry_id);

CREATE TABLE public.kuji_slot_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_assignment_id uuid NOT NULL REFERENCES public.kuji_slot_assignments(id) ON DELETE RESTRICT,
  entitlement_id uuid NOT NULL REFERENCES public.draw_entitlements(id) ON DELETE RESTRICT,
  room_entry_id uuid NOT NULL REFERENCES public.kuji_room_entries(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'RESERVED' CHECK (state IN ('RESERVED','CONSUMED','RELEASED')),
  selected_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  released_at timestamptz,
  release_reason varchar(120),
  CHECK (
    (state = 'RESERVED' AND consumed_at IS NULL AND released_at IS NULL AND release_reason IS NULL)
    OR (state = 'CONSUMED' AND consumed_at IS NOT NULL AND released_at IS NULL AND release_reason IS NULL)
    OR (state = 'RELEASED' AND consumed_at IS NULL AND released_at IS NOT NULL AND release_reason IS NOT NULL)
  )
);

CREATE UNIQUE INDEX kuji_slot_bindings_live_slot_idx
ON public.kuji_slot_bindings (slot_assignment_id)
WHERE state IN ('RESERVED','CONSUMED');

CREATE UNIQUE INDEX kuji_slot_bindings_live_entitlement_idx
ON public.kuji_slot_bindings (entitlement_id)
WHERE state IN ('RESERVED','CONSUMED');

CREATE INDEX kuji_slot_bindings_room_idx
ON public.kuji_slot_bindings (room_entry_id, selected_at, id);

-- Compatibility transition for the small legacy KUJI fixtures that may
-- already be ACTIVE when this migration is installed.  We only backfill an
-- untouched, single-tier deck because its slot-to-prize mapping is identical
-- for every slot.  Any multi-tier, partially sold, reserved, or otherwise
-- ambiguous legacy version aborts the whole migration and must be replaced by
-- a newly published sealed DRAFT through the admin API.  This block runs
-- before the DRAFT-only insert guards and immutability triggers are installed.
SET LOCAL lock_timeout = '5s';

LOCK TABLE
  public.catalog_products,
  public.product_stock,
  public.draw_probability_versions,
  public.draw_pool_entries,
  public.orders,
  public.order_lines,
  public.draw_entitlements,
  public.kuji_room_entries
IN SHARE ROW EXCLUSIVE MODE NOWAIT;

DO $$
DECLARE
  legacy_version record;
  legacy_entry record;
  saved_assignment_count integer;
  saved_distinct_slot_count integer;
  saved_distinct_pool_count integer;
  saved_min_slot integer;
  saved_max_slot integer;
BEGIN
  FOR legacy_version IN
    SELECT version.id,
           version.product_id,
           stock.on_hand,
           stock.reserved,
           count(entry.id)::integer AS entry_count,
           count(*) FILTER (
             WHERE entry.initial_quantity IS NULL
                OR entry.remaining_quantity IS DISTINCT FROM entry.initial_quantity
                OR entry.weight <> 1
           )::integer AS incompatible_entry_count,
           COALESCE(sum(entry.initial_quantity), 0)::integer AS total_slots,
           (
             SELECT count(*)::integer
               FROM public.draw_entitlements AS entitlement
              WHERE entitlement.probability_version_id = version.id
           ) AS entitlement_count,
           (
             SELECT count(*)::integer
               FROM public.order_lines AS line
               JOIN public.orders AS orders ON orders.id = line.order_id
              WHERE line.probability_version_id = version.id
                AND orders.status IN ('PENDING_PAYMENT','PAID','REFUND_REVIEW')
           ) AS unfinished_order_count,
           (
             SELECT count(*)::integer
               FROM public.kuji_room_entries AS room_entry
              WHERE room_entry.product_id = version.product_id
                AND room_entry.state IN ('WAITING','CHECKOUT_PENDING','DRAWING')
           ) AS active_room_entry_count
      FROM public.draw_probability_versions AS version
      JOIN public.catalog_products AS product ON product.id = version.product_id
      JOIN public.product_stock AS stock ON stock.product_id = version.product_id
      LEFT JOIN public.draw_pool_entries AS entry ON entry.probability_version_id = version.id
     WHERE product.category = 'kuji'
       AND version.status = 'ACTIVE'
     GROUP BY version.id, version.product_id, stock.on_hand, stock.reserved
  LOOP
    IF legacy_version.entry_count <> 1
      OR legacy_version.incompatible_entry_count <> 0
      OR legacy_version.total_slots NOT BETWEEN 1 AND 10000
      OR legacy_version.reserved <> 0
      OR legacy_version.on_hand <> legacy_version.total_slots
      OR legacy_version.entitlement_count <> 0
      OR legacy_version.unfinished_order_count <> 0
      OR legacy_version.active_room_entry_count <> 0
    THEN
      RAISE EXCEPTION
        'Active legacy kuji version % for product % cannot be safely converted to a sealed deck',
        legacy_version.id,
        legacy_version.product_id
        USING ERRCODE = '23514';
    END IF;

    SELECT id, initial_quantity
      INTO STRICT legacy_entry
      FROM public.draw_pool_entries
     WHERE probability_version_id = legacy_version.id;

    INSERT INTO public.kuji_decks(
      probability_version_id,
      total_slots,
      assignment_algorithm
    ) VALUES(
      legacy_version.id,
      legacy_version.total_slots,
      'LEGACY_SINGLE_TIER_V1'
    );

    INSERT INTO public.kuji_deck_tiers(
      probability_version_id,
      pool_entry_id,
      tier_code,
      tier_rank
    ) VALUES(
      legacy_version.id,
      legacy_entry.id,
      'LEGACY_SINGLE_TIER',
      0
    );

    INSERT INTO public.kuji_slot_assignments(
      probability_version_id,
      slot_number,
      pool_entry_id
    )
    SELECT legacy_version.id, slot_number, legacy_entry.id
      FROM generate_series(1, legacy_version.total_slots) AS generated(slot_number);

    SELECT count(*)::integer,
           count(DISTINCT slot_number)::integer,
           count(DISTINCT pool_entry_id)::integer,
           min(slot_number),
           max(slot_number)
      INTO saved_assignment_count,
           saved_distinct_slot_count,
           saved_distinct_pool_count,
           saved_min_slot,
           saved_max_slot
      FROM public.kuji_slot_assignments
     WHERE probability_version_id = legacy_version.id;

    IF saved_assignment_count <> legacy_version.total_slots
      OR saved_distinct_slot_count <> legacy_version.total_slots
      OR saved_distinct_pool_count <> 1
      OR saved_min_slot <> 1
      OR saved_max_slot <> legacy_version.total_slots
    THEN
      RAISE EXCEPTION
        'Active legacy kuji version % failed sealed deck verification',
        legacy_version.id
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM public.draw_probability_versions AS version
      JOIN public.catalog_products AS product ON product.id = version.product_id
      LEFT JOIN public.kuji_decks AS deck ON deck.probability_version_id = version.id
     WHERE product.category = 'kuji'
       AND version.status = 'ACTIVE'
       AND deck.probability_version_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Every active kuji version must have a verified sealed deck'
      USING ERRCODE = '23514';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.guard_kuji_deck_tier_insert()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  version_status text;
  draw_category text;
  actual_version_id uuid;
BEGIN
  SELECT version.status, product.category
    INTO version_status, draw_category
    FROM public.draw_probability_versions AS version
    JOIN public.catalog_products AS product ON product.id = version.product_id
   WHERE version.id = NEW.probability_version_id
   FOR SHARE OF version, product;

  SELECT probability_version_id
    INTO actual_version_id
    FROM public.draw_pool_entries
   WHERE id = NEW.pool_entry_id
   FOR SHARE;

  IF version_status IS DISTINCT FROM 'DRAFT'
    OR draw_category IS DISTINCT FROM 'kuji'
    OR actual_version_id IS DISTINCT FROM NEW.probability_version_id
  THEN
    RAISE EXCEPTION 'Kuji tiers require a matching draft kuji draw version'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER kuji_deck_tiers_insert_guard
BEFORE INSERT ON public.kuji_deck_tiers
FOR EACH ROW EXECUTE FUNCTION public.guard_kuji_deck_tier_insert();

CREATE TRIGGER kuji_deck_tiers_immutable
BEFORE UPDATE OR DELETE ON public.kuji_deck_tiers
FOR EACH ROW EXECUTE FUNCTION public.reject_row_mutation();

CREATE OR REPLACE FUNCTION public.guard_kuji_deck_insert()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  version_status text;
  draw_category text;
BEGIN
  SELECT version.status, product.category
    INTO version_status, draw_category
    FROM public.draw_probability_versions AS version
    JOIN public.catalog_products AS product ON product.id = version.product_id
   WHERE version.id = NEW.probability_version_id
   FOR SHARE OF version, product;

  IF version_status IS DISTINCT FROM 'DRAFT' OR draw_category IS DISTINCT FROM 'kuji' THEN
    RAISE EXCEPTION 'Sealed kuji decks require a draft kuji draw version'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER kuji_decks_insert_guard
BEFORE INSERT ON public.kuji_decks
FOR EACH ROW EXECUTE FUNCTION public.guard_kuji_deck_insert();

CREATE TRIGGER kuji_decks_immutable
BEFORE UPDATE OR DELETE ON public.kuji_decks
FOR EACH ROW EXECUTE FUNCTION public.reject_row_mutation();

CREATE OR REPLACE FUNCTION public.guard_kuji_slot_assignment_insert()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  deck_total integer;
  version_status text;
  tier_version_id uuid;
BEGIN
  SELECT deck.total_slots, version.status
    INTO deck_total, version_status
   FROM public.kuji_decks AS deck
    JOIN public.draw_probability_versions AS version ON version.id = deck.probability_version_id
   WHERE deck.probability_version_id = NEW.probability_version_id
   FOR SHARE OF version;

  SELECT probability_version_id
    INTO tier_version_id
    FROM public.kuji_deck_tiers
   WHERE pool_entry_id = NEW.pool_entry_id;

  IF version_status IS DISTINCT FROM 'DRAFT'
    OR tier_version_id IS DISTINCT FROM NEW.probability_version_id
    OR NEW.slot_number > deck_total
  THEN
    RAISE EXCEPTION 'Kuji slot assignment does not match its draft deck'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER kuji_slot_assignments_insert_guard
BEFORE INSERT ON public.kuji_slot_assignments
FOR EACH ROW EXECUTE FUNCTION public.guard_kuji_slot_assignment_insert();

CREATE TRIGGER kuji_slot_assignments_immutable
BEFORE UPDATE OR DELETE ON public.kuji_slot_assignments
FOR EACH ROW EXECUTE FUNCTION public.reject_row_mutation();

CREATE OR REPLACE FUNCTION public.guard_sealed_kuji_activation()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  draw_category text;
  deck_total integer;
  pool_count bigint;
  tier_count bigint;
  configured_total bigint;
  assignment_count bigint;
  mismatched_pool_count bigint;
BEGIN
  IF OLD.status = 'DRAFT' AND NEW.status = 'ACTIVE' THEN
    SELECT category INTO draw_category
      FROM public.catalog_products
     WHERE id = NEW.product_id
     FOR SHARE;

    IF draw_category = 'kuji' THEN
      SELECT total_slots INTO deck_total
        FROM public.kuji_decks
       WHERE probability_version_id = NEW.id;
      IF deck_total IS NULL THEN
        RAISE EXCEPTION 'A kuji draw version requires one sealed slot deck before activation'
          USING ERRCODE = '23514';
      END IF;

      SELECT count(*),
             count(tier.pool_entry_id),
             COALESCE(sum(entry.initial_quantity), 0)
        INTO pool_count, tier_count, configured_total
        FROM public.draw_pool_entries AS entry
        LEFT JOIN public.kuji_deck_tiers AS tier
          ON tier.pool_entry_id = entry.id
         AND tier.probability_version_id = entry.probability_version_id
       WHERE entry.probability_version_id = NEW.id
         AND entry.initial_quantity IS NOT NULL
         AND entry.remaining_quantity = entry.initial_quantity
         AND entry.weight = 1;

      SELECT count(*) INTO assignment_count
        FROM public.kuji_slot_assignments
       WHERE probability_version_id = NEW.id;

      SELECT count(*) INTO mismatched_pool_count
        FROM (
          SELECT entry.id
            FROM public.draw_pool_entries AS entry
            LEFT JOIN public.kuji_slot_assignments AS assignment
              ON assignment.pool_entry_id = entry.id
           WHERE entry.probability_version_id = NEW.id
           GROUP BY entry.id, entry.initial_quantity
          HAVING count(assignment.id) IS DISTINCT FROM entry.initial_quantity::bigint
        ) AS mismatch;

      IF pool_count = 0
        OR tier_count <> pool_count
        OR configured_total <> deck_total
        OR assignment_count <> deck_total
        OR mismatched_pool_count <> 0
      THEN
        RAISE EXCEPTION 'Kuji deck tiers and immutable slot assignments must exactly match finite pool quantities'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER draw_probability_versions_sealed_kuji_guard
BEFORE UPDATE OF status ON public.draw_probability_versions
FOR EACH ROW EXECUTE FUNCTION public.guard_sealed_kuji_activation();

CREATE OR REPLACE FUNCTION public.guard_kuji_slot_binding_mutation()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  assignment_version_id uuid;
  entitlement_state text;
  entitlement_version_id uuid;
  entitlement_user_id uuid;
  entitlement_product_id text;
  entitlement_order_id uuid;
  order_state text;
  room_user_id uuid;
  room_product_id text;
  room_order_id uuid;
  room_state text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Kuji slot binding history is append-only' USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.slot_assignment_id IS DISTINCT FROM NEW.slot_assignment_id
      OR OLD.entitlement_id IS DISTINCT FROM NEW.entitlement_id
      OR OLD.room_entry_id IS DISTINCT FROM NEW.room_entry_id
      OR OLD.selected_at IS DISTINCT FROM NEW.selected_at
    THEN
      RAISE EXCEPTION 'Kuji slot binding identity is immutable' USING ERRCODE = '55000';
    END IF;

    IF OLD.state <> 'RESERVED' OR NEW.state NOT IN ('CONSUMED','RELEASED') THEN
      RAISE EXCEPTION 'Invalid kuji slot binding state transition: % -> %', OLD.state, NEW.state
        USING ERRCODE = '23514';
    END IF;

    IF NEW.state = 'CONSUMED' AND NOT EXISTS (
      SELECT 1 FROM public.draw_results
       WHERE kuji_slot_binding_id = NEW.id
         AND entitlement_id = NEW.entitlement_id
    ) THEN
      RAISE EXCEPTION 'A kuji slot can be consumed only by its committed draw result'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.state = 'RELEASED' AND NOT EXISTS (
      SELECT 1 FROM public.draw_entitlements
       WHERE id = NEW.entitlement_id AND status = 'CANCELLED'
    ) THEN
      RAISE EXCEPTION 'A kuji slot can be released only after entitlement cancellation'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.state <> 'RESERVED' THEN
    RAISE EXCEPTION 'New kuji slot bindings must start reserved' USING ERRCODE = '23514';
  END IF;

  SELECT probability_version_id INTO assignment_version_id
    FROM public.kuji_slot_assignments
   WHERE id = NEW.slot_assignment_id;

  SELECT entitlement.status, entitlement.probability_version_id, entitlement.user_id,
         entitlement.product_id, line.order_id, orders.status
    INTO entitlement_state, entitlement_version_id, entitlement_user_id,
         entitlement_product_id, entitlement_order_id, order_state
    FROM public.draw_entitlements AS entitlement
    JOIN public.order_lines AS line ON line.id = entitlement.order_line_id
    JOIN public.orders AS orders ON orders.id = line.order_id
   WHERE entitlement.id = NEW.entitlement_id
   FOR UPDATE OF entitlement, orders;

  SELECT user_id, product_id, order_id, state
    INTO room_user_id, room_product_id, room_order_id, room_state
    FROM public.kuji_room_entries
   WHERE id = NEW.room_entry_id
   FOR UPDATE;

  IF assignment_version_id IS DISTINCT FROM entitlement_version_id
    OR entitlement_state IS DISTINCT FROM 'AVAILABLE'
    OR order_state NOT IN ('PAID','FULFILLED')
    OR room_user_id IS DISTINCT FROM entitlement_user_id
    OR room_product_id IS DISTINCT FROM entitlement_product_id
    OR room_order_id IS DISTINCT FROM entitlement_order_id
    OR room_state NOT IN ('DRAWING','EXPIRED')
  THEN
    RAISE EXCEPTION 'Kuji slot binding must match one paid entitlement and its owned drawing room'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER kuji_slot_bindings_guard_mutation
BEFORE INSERT OR UPDATE OR DELETE ON public.kuji_slot_bindings
FOR EACH ROW EXECUTE FUNCTION public.guard_kuji_slot_binding_mutation();

ALTER TABLE public.draw_results
  ADD COLUMN kuji_slot_binding_id uuid UNIQUE REFERENCES public.kuji_slot_bindings(id) ON DELETE RESTRICT;

ALTER TABLE public.draw_results
  DROP CONSTRAINT IF EXISTS draw_results_selection_algorithm_check,
  DROP CONSTRAINT IF EXISTS draw_results_entropy_hex_check,
  DROP CONSTRAINT IF EXISTS draw_results_entropy_digest_check,
  DROP CONSTRAINT IF EXISTS draw_results_roll_value_check,
  DROP CONSTRAINT IF EXISTS draw_results_total_weight_check,
  DROP CONSTRAINT IF EXISTS draw_results_check;

ALTER TABLE public.draw_results
  ALTER COLUMN entropy_hex DROP NOT NULL,
  ALTER COLUMN entropy_digest DROP NOT NULL,
  ALTER COLUMN roll_value DROP NOT NULL,
  ALTER COLUMN total_weight DROP NOT NULL;

ALTER TABLE public.draw_results
  ADD CONSTRAINT draw_results_selection_evidence_ck CHECK (
    (
      selection_algorithm = 'SHA256_REJECTION_V1'
      AND kuji_slot_binding_id IS NULL
      AND entropy_hex ~ '^[0-9a-f]{64}$'
      AND entropy_digest ~ '^[0-9a-f]{64}$'
      AND roll_value >= 0
      AND total_weight > 0
      AND total_weight <= 9007199254740991
      AND roll_value < total_weight
    )
    OR (
      selection_algorithm = 'KUJI_SEALED_SLOT_V1'
      AND kuji_slot_binding_id IS NOT NULL
      AND entropy_hex IS NULL
      AND entropy_digest IS NULL
      AND roll_value IS NULL
      AND total_weight IS NULL
      AND jsonb_array_length(selection_snapshot) = 1
    )
  );

CREATE OR REPLACE FUNCTION public.guard_kuji_draw_result_binding()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  entitlement_version_id uuid;
  has_sealed_deck boolean;
  binding_state text;
  binding_entitlement_id uuid;
  binding_pool_entry_id uuid;
BEGIN
  SELECT probability_version_id INTO entitlement_version_id
    FROM public.draw_entitlements
   WHERE id = NEW.entitlement_id
   FOR SHARE;

  SELECT EXISTS (
    SELECT 1 FROM public.kuji_decks
     WHERE probability_version_id = entitlement_version_id
  ) INTO has_sealed_deck;

  IF has_sealed_deck THEN
    SELECT binding.state, binding.entitlement_id, assignment.pool_entry_id
      INTO binding_state, binding_entitlement_id, binding_pool_entry_id
      FROM public.kuji_slot_bindings AS binding
      JOIN public.kuji_slot_assignments AS assignment ON assignment.id = binding.slot_assignment_id
     WHERE binding.id = NEW.kuji_slot_binding_id
     FOR UPDATE OF binding;

    IF NEW.selection_algorithm IS DISTINCT FROM 'KUJI_SEALED_SLOT_V1'
      OR binding_state IS DISTINCT FROM 'RESERVED'
      OR binding_entitlement_id IS DISTINCT FROM NEW.entitlement_id
      OR binding_pool_entry_id IS DISTINCT FROM NEW.pool_entry_id
    THEN
      RAISE EXCEPTION 'Sealed kuji results must consume their reserved immutable slot mapping'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.selection_algorithm IS DISTINCT FROM 'SHA256_REJECTION_V1'
    OR NEW.kuji_slot_binding_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'Weighted draw results cannot reference a sealed kuji slot'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER draw_results_kuji_binding_guard
BEFORE INSERT ON public.draw_results
FOR EACH ROW EXECUTE FUNCTION public.guard_kuji_draw_result_binding();

CREATE OR REPLACE FUNCTION public.consume_kuji_slot_binding_after_result()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.kuji_slot_binding_id IS NOT NULL THEN
    UPDATE public.kuji_slot_bindings
       SET state = 'CONSUMED', consumed_at = NEW.committed_at
     WHERE id = NEW.kuji_slot_binding_id
       AND state = 'RESERVED';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Reserved kuji slot binding changed before result commit'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER draw_results_consume_kuji_binding
AFTER INSERT ON public.draw_results
FOR EACH ROW EXECUTE FUNCTION public.consume_kuji_slot_binding_after_result();

CREATE OR REPLACE FUNCTION public.release_cancelled_kuji_slot_binding()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.status = 'AVAILABLE' AND NEW.status = 'CANCELLED' THEN
    UPDATE public.kuji_slot_bindings
       SET state = 'RELEASED', released_at = now(), release_reason = 'ENTITLEMENT_CANCELLED'
     WHERE entitlement_id = NEW.id
       AND state = 'RESERVED';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER draw_entitlements_release_kuji_slot
AFTER UPDATE OF status ON public.draw_entitlements
FOR EACH ROW EXECUTE FUNCTION public.release_cancelled_kuji_slot_binding();

ALTER TABLE public.kuji_deck_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kuji_decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kuji_slot_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kuji_slot_bindings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.kuji_deck_tiers,
  public.kuji_decks,
  public.kuji_slot_assignments,
  public.kuji_slot_bindings
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.kuji_deck_tiers, public.kuji_decks,
      public.kuji_slot_assignments, public.kuji_slot_bindings FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.kuji_deck_tiers, public.kuji_decks,
      public.kuji_slot_assignments, public.kuji_slot_bindings FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON TABLE public.kuji_deck_tiers, public.kuji_decks,
      public.kuji_slot_assignments, public.kuji_slot_bindings FROM service_role;
  END IF;
END
$$;

REVOKE EXECUTE ON FUNCTION
  public.guard_kuji_deck_tier_insert(),
  public.guard_kuji_deck_insert(),
  public.guard_kuji_slot_assignment_insert(),
  public.guard_sealed_kuji_activation(),
  public.guard_kuji_slot_binding_mutation(),
  public.guard_kuji_draw_result_binding(),
  public.consume_kuji_slot_binding_after_result(),
  public.release_cancelled_kuji_slot_binding()
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON FUNCTION
      public.guard_kuji_deck_tier_insert(),
      public.guard_kuji_deck_insert(),
      public.guard_kuji_slot_assignment_insert(),
      public.guard_sealed_kuji_activation(),
      public.guard_kuji_slot_binding_mutation(),
      public.guard_kuji_draw_result_binding(),
      public.consume_kuji_slot_binding_after_result(),
      public.release_cancelled_kuji_slot_binding()
    FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE EXECUTE ON FUNCTION
      public.guard_kuji_deck_tier_insert(),
      public.guard_kuji_deck_insert(),
      public.guard_kuji_slot_assignment_insert(),
      public.guard_sealed_kuji_activation(),
      public.guard_kuji_slot_binding_mutation(),
      public.guard_kuji_draw_result_binding(),
      public.consume_kuji_slot_binding_after_result(),
      public.release_cancelled_kuji_slot_binding()
    FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE EXECUTE ON FUNCTION
      public.guard_kuji_deck_tier_insert(),
      public.guard_kuji_deck_insert(),
      public.guard_kuji_slot_assignment_insert(),
      public.guard_sealed_kuji_activation(),
      public.guard_kuji_slot_binding_mutation(),
      public.guard_kuji_draw_result_binding(),
      public.consume_kuji_slot_binding_after_result(),
      public.release_cancelled_kuji_slot_binding()
    FROM service_role;
  END IF;
END
$$;

REVOKE ALL ON TABLE
  public.kuji_deck_tiers,
  public.kuji_decks,
  public.kuji_slot_assignments,
  public.kuji_slot_bindings
FROM dabboba_runtime;

GRANT SELECT ON TABLE
  public.kuji_deck_tiers,
  public.kuji_decks,
  public.kuji_slot_assignments,
  public.kuji_slot_bindings
TO dabboba_runtime;

GRANT INSERT ON TABLE
  public.kuji_deck_tiers,
  public.kuji_decks,
  public.kuji_slot_assignments,
  public.kuji_slot_bindings
TO dabboba_runtime;

GRANT UPDATE ON TABLE public.kuji_slot_bindings TO dabboba_runtime;

-- The reservation worker promotes the next room entry only when the currently
-- active kuji version has a published sealed deck. It does not need the hidden
-- slot mapping, tier metadata, or customer bindings for that eligibility check.
GRANT SELECT ON TABLE public.kuji_decks TO dabboba_worker;
