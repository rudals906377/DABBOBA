-- Keep extension objects out of the API-facing public schema.
CREATE SCHEMA IF NOT EXISTS extensions;

DO $$
DECLARE
  extension_record record;
BEGIN
  FOR extension_record IN
    SELECT extension.extname
    FROM pg_extension AS extension
    JOIN pg_namespace AS namespace ON namespace.oid = extension.extnamespace
    WHERE extension.extname IN ('citext', 'pg_trgm', 'pgcrypto')
      AND namespace.nspname = 'public'
  LOOP
    EXECUTE format('ALTER EXTENSION %I SET SCHEMA extensions', extension_record.extname);
  END LOOP;
END
$$;

-- All DABBOBA functions are invoker-rights functions, but an explicit trusted
-- search path also prevents object shadowing and satisfies the Supabase advisor.
DO $$
DECLARE
  function_record record;
  hardened_count integer := 0;
BEGIN
  FOR function_record IN
    SELECT
      namespace.nspname AS schema_name,
      function.proname AS function_name,
      pg_get_function_identity_arguments(function.oid) AS identity_arguments
    FROM pg_proc AS function
    JOIN pg_namespace AS namespace ON namespace.oid = function.pronamespace
    WHERE namespace.nspname = 'public'
      AND function.proname = ANY (ARRAY[
        'create_default_user_profile',
        'guard_published_draw_version_mutation',
        'set_updated_at',
        'reject_row_mutation',
        'enforce_exchange_listing_transition',
        'enforce_exchange_offer_transition',
        'guard_draw_product_stock_capacity',
        'guard_draw_entitlement_capacity',
        'enforce_admin_commerce_review_transition',
        'enforce_shipping_request_transition',
        'enforce_account_deletion_request_transition',
        'guard_approved_account_mutation',
        'default_notification_preference_state',
        'create_default_notification_preferences',
        'guard_catalog_product_prize_only_mutation',
        'guard_draw_pool_entry_mutation',
        'lock_active_draw_prize_catalog_state',
        'guard_draw_version_activation_catalog_state',
        'guard_active_draw_prize_deactivation',
        'enforce_inventory_point_return_total',
        'guard_kuji_room_entry_transition'
      ]::text[])
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) SET search_path = public, extensions, pg_temp',
      function_record.schema_name,
      function_record.function_name,
      function_record.identity_arguments
    );
    hardened_count := hardened_count + 1;
  END LOOP;

  IF hardened_count <> 21 THEN
    RAISE EXCEPTION 'Expected to harden 21 DABBOBA functions, hardened %', hardened_count;
  END IF;
END
$$;
