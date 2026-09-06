-- A draw result is an immutable commerce ledger row.  Individual foreign keys
-- only prove that referenced rows exist; they do not prove that those rows
-- describe the same entitlement, draw version, prize, and inventory unit.
-- Validate that complete relationship at insert time for both weighted gacha
-- and sealed-slot kuji results.

CREATE OR REPLACE FUNCTION public.guard_kuji_draw_result_binding()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  entitlement_user_id uuid;
  entitlement_product_id text;
  entitlement_version_id uuid;
  entitlement_status text;
  order_user_id uuid;
  order_status text;
  line_product_id text;
  line_version_id uuid;
  line_category text;
  version_product_id text;
  published_version integer;
  draw_category text;
  pool_version_id uuid;
  pool_prize_product_id text;
  inventory_owner_id uuid;
  inventory_product_id text;
  inventory_source_type text;
  inventory_source_id uuid;
  inventory_status text;
  has_sealed_deck boolean;
  binding_state text;
  binding_entitlement_id uuid;
  binding_assignment_id uuid;
  binding_version_id uuid;
  binding_pool_entry_id uuid;
  binding_slot_number integer;
BEGIN
  SELECT entitlement.user_id,
         entitlement.product_id,
         entitlement.probability_version_id,
         entitlement.status,
         customer_order.user_id,
         customer_order.status,
         order_line.product_id,
         order_line.probability_version_id,
         order_line.category_snapshot,
         version.product_id,
         version.version,
         draw_product.category,
         pool_entry.probability_version_id,
         pool_entry.prize_product_id,
         inventory.owner_id,
         inventory.product_id,
         inventory.source_type,
         inventory.source_id,
         inventory.status
    INTO entitlement_user_id,
         entitlement_product_id,
         entitlement_version_id,
         entitlement_status,
         order_user_id,
         order_status,
         line_product_id,
         line_version_id,
         line_category,
         version_product_id,
         published_version,
         draw_category,
         pool_version_id,
         pool_prize_product_id,
         inventory_owner_id,
         inventory_product_id,
         inventory_source_type,
         inventory_source_id,
         inventory_status
    FROM public.draw_entitlements AS entitlement
    JOIN public.order_lines AS order_line
      ON order_line.id = entitlement.order_line_id
    JOIN public.orders AS customer_order
      ON customer_order.id = order_line.order_id
    JOIN public.draw_probability_versions AS version
      ON version.id = entitlement.probability_version_id
    JOIN public.catalog_products AS draw_product
      ON draw_product.id = entitlement.product_id
    JOIN public.draw_pool_entries AS pool_entry
      ON pool_entry.id = NEW.pool_entry_id
    JOIN public.inventory_units AS inventory
      ON inventory.id = NEW.prize_inventory_unit_id
   WHERE entitlement.id = NEW.entitlement_id
   FOR SHARE OF entitlement, order_line, customer_order, version, draw_product, pool_entry, inventory;

  IF NOT FOUND
    OR draw_category NOT IN ('gacha','kuji')
    OR entitlement_status IS DISTINCT FROM 'AVAILABLE'
    OR order_user_id IS DISTINCT FROM entitlement_user_id
    OR order_status NOT IN ('PAID','FULFILLED')
    OR line_product_id IS DISTINCT FROM entitlement_product_id
    OR line_version_id IS DISTINCT FROM entitlement_version_id
    OR line_category IS DISTINCT FROM draw_category
    OR version_product_id IS DISTINCT FROM entitlement_product_id
    OR pool_version_id IS DISTINCT FROM entitlement_version_id
    OR NEW.user_id IS DISTINCT FROM entitlement_user_id
    OR NEW.product_id IS DISTINCT FROM entitlement_product_id
    OR NEW.probability_version IS DISTINCT FROM published_version
    OR NEW.prize_product_id IS DISTINCT FROM pool_prize_product_id
    OR inventory_owner_id IS DISTINCT FROM entitlement_user_id
    OR inventory_product_id IS DISTINCT FROM pool_prize_product_id
    OR inventory_source_type IS DISTINCT FROM upper(draw_category)
    OR inventory_source_id IS DISTINCT FROM NEW.entitlement_id
    OR inventory_status IS DISTINCT FROM 'OWNED'
  THEN
    RAISE EXCEPTION 'Draw result must match its entitlement, version, selected prize, and issued inventory'
      USING ERRCODE = '23514';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.kuji_decks
     WHERE probability_version_id = entitlement_version_id
  ) INTO has_sealed_deck;

  IF draw_category = 'kuji' THEN
    IF NOT has_sealed_deck THEN
      RAISE EXCEPTION 'Kuji results require a sealed slot deck'
        USING ERRCODE = '23514';
    END IF;

    SELECT binding.state,
           binding.entitlement_id,
           assignment.id,
           assignment.probability_version_id,
           assignment.pool_entry_id,
           assignment.slot_number
      INTO binding_state,
           binding_entitlement_id,
           binding_assignment_id,
           binding_version_id,
           binding_pool_entry_id,
           binding_slot_number
      FROM public.kuji_slot_bindings AS binding
      JOIN public.kuji_slot_assignments AS assignment
        ON assignment.id = binding.slot_assignment_id
     WHERE binding.id = NEW.kuji_slot_binding_id
     FOR UPDATE OF binding;

    IF NEW.selection_algorithm IS DISTINCT FROM 'KUJI_SEALED_SLOT_V1'
      OR binding_state IS DISTINCT FROM 'RESERVED'
      OR binding_entitlement_id IS DISTINCT FROM NEW.entitlement_id
      OR binding_version_id IS DISTINCT FROM entitlement_version_id
      OR binding_pool_entry_id IS DISTINCT FROM NEW.pool_entry_id
      OR NEW.selection_snapshot IS DISTINCT FROM jsonb_build_array(
        jsonb_build_object(
          'slotId', binding_assignment_id::text,
          'slotNumber', binding_slot_number
        )
      )
    THEN
      RAISE EXCEPTION 'Sealed kuji results must consume their reserved immutable slot mapping'
        USING ERRCODE = '23514';
    END IF;
  ELSIF has_sealed_deck
    OR NEW.selection_algorithm IS DISTINCT FROM 'SHA256_REJECTION_V1'
    OR NEW.kuji_slot_binding_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'Weighted gacha results cannot reference a sealed kuji slot'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- CREATE OR REPLACE preserves the restrictive ACL from 0035, but repeat the
-- denial explicitly so drift cannot make this trigger helper directly callable
-- by customer-facing Supabase roles.
REVOKE EXECUTE ON FUNCTION public.guard_kuji_draw_result_binding() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON FUNCTION public.guard_kuji_draw_result_binding() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE EXECUTE ON FUNCTION public.guard_kuji_draw_result_binding() FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE EXECUTE ON FUNCTION public.guard_kuji_draw_result_binding() FROM service_role;
  END IF;
END
$$;
