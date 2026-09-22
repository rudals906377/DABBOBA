-- Add a separately provisioned worker login and remove the queue surface from
-- the API login. No legacy Cloud Run worker exists, so the first worker deploy
-- must use this role rather than preserving a shared-credential transition.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dabboba_worker') THEN
    CREATE ROLE dabboba_worker;
  END IF;
END
$$;

ALTER ROLE dabboba_worker WITH
  NOLOGIN
  NOCREATEDB
  NOCREATEROLE
  INHERIT
  NOREPLICATION
  BYPASSRLS;
ALTER ROLE dabboba_worker SET search_path = pg_catalog, public, extensions, pgmq, pg_temp;

-- The worker inherits the reviewed application DML surface, but cannot SET
-- ROLE to or administer dabboba_runtime. PostgreSQL 17 records these membership
-- options per grant.
GRANT dabboba_runtime TO dabboba_worker
  WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;
REVOKE dabboba_worker FROM dabboba_runtime;

-- Direct grants make the queue boundary explicit.
REVOKE ALL ON SCHEMA pgmq FROM dabboba_worker;
REVOKE ALL ON ALL TABLES IN SCHEMA pgmq FROM dabboba_worker;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA pgmq FROM dabboba_worker;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq FROM dabboba_worker;
REVOKE ALL ON TABLE public.worker_dead_letters FROM dabboba_worker;

GRANT USAGE ON SCHEMA pgmq TO dabboba_worker;
GRANT EXECUTE ON FUNCTION pgmq.send(text, jsonb, integer)
TO dabboba_worker;
GRANT EXECUTE ON FUNCTION pgmq.send(text, jsonb, jsonb, timestamp with time zone)
TO dabboba_worker;
GRANT EXECUTE ON FUNCTION pgmq.format_table_name(text, text)
TO dabboba_worker;
GRANT EXECUTE ON FUNCTION pgmq.read(text, integer, integer, jsonb)
TO dabboba_worker;
GRANT EXECUTE ON FUNCTION pgmq.delete(text, bigint)
TO dabboba_worker;
GRANT EXECUTE ON FUNCTION pgmq.set_vt(text, bigint, integer)
TO dabboba_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE pgmq.q_dabboba_worker TO dabboba_worker;
GRANT USAGE ON SEQUENCE pgmq.q_dabboba_worker_msg_id_seq TO dabboba_worker;
GRANT INSERT ON TABLE public.worker_dead_letters TO dabboba_worker;

-- 0027 temporarily granted queue access to the shared runtime role. There is no
-- deployed legacy worker to preserve, so the production-ready boundary removes
-- every queue/dead-letter privilege from the API role in this forward migration.
REVOKE ALL ON SCHEMA pgmq FROM dabboba_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA pgmq FROM dabboba_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA pgmq FROM dabboba_runtime;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq FROM dabboba_runtime;
REVOKE ALL ON TABLE public.worker_dead_letters FROM dabboba_runtime;

DO $$
DECLARE
  queue_relation regclass := 'pgmq.q_dabboba_worker'::regclass;
  queue_sequence regclass := 'pgmq.q_dabboba_worker_msg_id_seq'::regclass;
  pgmq_public_schema oid := to_regnamespace('pgmq_public');
BEGIN
  -- 0028 predates this role. Keep Supabase's PostgREST-facing wrappers outside
  -- the worker path even when the optional pgmq_public schema is installed.
  IF pgmq_public_schema IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON SCHEMA pgmq_public FROM dabboba_worker';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA pgmq_public FROM dabboba_worker';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA pgmq_public FROM dabboba_worker';
    EXECUTE 'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq_public FROM dabboba_worker';

    IF has_schema_privilege('dabboba_worker', pgmq_public_schema, 'USAGE')
      OR EXISTS (
        SELECT 1 FROM pg_proc AS routine
        WHERE routine.pronamespace = pgmq_public_schema
          AND has_function_privilege('dabboba_worker', routine.oid, 'EXECUTE')
      )
      OR EXISTS (
        SELECT 1 FROM pg_class AS relation
        WHERE relation.relnamespace = pgmq_public_schema
          AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND has_table_privilege('dabboba_worker', relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      )
      OR EXISTS (
        SELECT 1 FROM pg_class AS sequence
        WHERE sequence.relnamespace = pgmq_public_schema
          AND sequence.relkind = 'S'
          AND has_sequence_privilege('dabboba_worker', sequence.oid, 'USAGE,SELECT,UPDATE')
      )
    THEN
      RAISE EXCEPTION 'pgmq_public remains accessible to dabboba_worker';
    END IF;
  END IF;

  IF has_schema_privilege('dabboba_runtime', 'pgmq', 'USAGE')
    OR has_table_privilege('dabboba_runtime', queue_relation, 'SELECT,INSERT,UPDATE,DELETE')
    OR has_sequence_privilege('dabboba_runtime', queue_sequence, 'USAGE')
    OR has_table_privilege('dabboba_runtime', 'public.worker_dead_letters', 'INSERT')
    OR has_function_privilege('dabboba_runtime', 'pgmq.send(text,jsonb,integer)', 'EXECUTE')
    OR has_function_privilege('dabboba_runtime', 'pgmq.send(text,jsonb,jsonb,timestamp with time zone)', 'EXECUTE')
    OR has_function_privilege('dabboba_runtime', 'pgmq.format_table_name(text,text)', 'EXECUTE')
    OR has_function_privilege('dabboba_runtime', 'pgmq.read(text,integer,integer,jsonb)', 'EXECUTE')
    OR has_function_privilege('dabboba_runtime', 'pgmq.delete(text,bigint)', 'EXECUTE')
    OR has_function_privilege('dabboba_runtime', 'pgmq.set_vt(text,bigint,integer)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'dabboba_runtime retains worker queue privileges';
  END IF;

  IF NOT has_schema_privilege('dabboba_worker', 'pgmq', 'USAGE')
    OR NOT has_table_privilege('dabboba_worker', queue_relation, 'SELECT')
    OR NOT has_table_privilege('dabboba_worker', queue_relation, 'INSERT')
    OR NOT has_table_privilege('dabboba_worker', queue_relation, 'UPDATE')
    OR NOT has_table_privilege('dabboba_worker', queue_relation, 'DELETE')
    OR NOT has_sequence_privilege('dabboba_worker', queue_sequence, 'USAGE')
    OR NOT has_table_privilege('dabboba_worker', 'public.worker_dead_letters', 'INSERT')
    OR NOT has_function_privilege('dabboba_worker', 'pgmq.send(text,jsonb,integer)', 'EXECUTE')
    OR NOT has_function_privilege('dabboba_worker', 'pgmq.send(text,jsonb,jsonb,timestamp with time zone)', 'EXECUTE')
    OR NOT has_function_privilege('dabboba_worker', 'pgmq.format_table_name(text,text)', 'EXECUTE')
    OR NOT has_function_privilege('dabboba_worker', 'pgmq.read(text,integer,integer,jsonb)', 'EXECUTE')
    OR NOT has_function_privilege('dabboba_worker', 'pgmq.delete(text,bigint)', 'EXECUTE')
    OR NOT has_function_privilege('dabboba_worker', 'pgmq.set_vt(text,bigint,integer)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'dabboba_worker queue privileges are incomplete';
  END IF;
END
$$;
