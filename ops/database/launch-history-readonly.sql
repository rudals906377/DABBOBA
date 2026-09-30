-- Run only after the dashboard project reference has been checked:
-- friend-owned dabboba-production, rconfxsykttfvznakile.
-- SQL current_database() alone does not attest the Supabase project identity.
-- No passwords, tokens, customer identifiers, or database writes are requested.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';

SELECT current_database() AS database_name,
       current_user AS inspection_role,
       current_setting('transaction_read_only') AS transaction_read_only;

SELECT version, checksum
FROM public.schema_migrations
ORDER BY version;

SELECT index_class.relname AS index_name,
       index_state.indisvalid AS is_valid,
       index_state.indisready AS is_ready
FROM pg_catalog.pg_index index_state
JOIN pg_catalog.pg_class index_class ON index_class.oid = index_state.indexrelid
JOIN pg_catalog.pg_namespace namespace ON namespace.oid = index_class.relnamespace
WHERE namespace.nspname = 'public'
  AND (NOT index_state.indisvalid OR NOT index_state.indisready)
ORDER BY index_class.relname;

COMMIT;
