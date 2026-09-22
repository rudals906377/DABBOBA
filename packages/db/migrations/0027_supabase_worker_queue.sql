-- Keep the worker queue inside PostgreSQL without exposing it through the
-- Supabase Data API. Extension upgrades remain an explicit operator action.
CREATE EXTENSION IF NOT EXISTS pgmq;

DO $$
DECLARE
  installed_version text;
  version_parts text[];
  major_version integer;
  minor_version integer;
BEGIN
  SELECT extension.extversion
  INTO installed_version
  FROM pg_extension AS extension
  WHERE extension.extname = 'pgmq';

  IF installed_version IS NULL THEN
    RAISE EXCEPTION 'pgmq extension installation did not complete';
  END IF;

  version_parts := regexp_match(installed_version, '^([0-9]+)\.([0-9]+)');
  IF version_parts IS NULL THEN
    RAISE EXCEPTION 'Cannot validate pgmq extension version %', installed_version;
  END IF;

  major_version := version_parts[1]::integer;
  minor_version := version_parts[2]::integer;
  IF major_version < 1 OR (major_version = 1 AND minor_version < 5) THEN
    RAISE EXCEPTION 'pgmq 1.5 or newer is required; installed version is %', installed_version;
  END IF;

  IF to_regprocedure('pgmq.send(text,jsonb,integer)') IS NULL
    OR to_regprocedure('pgmq.send(text,jsonb,jsonb,timestamp with time zone)') IS NULL
    OR to_regprocedure('pgmq.read(text,integer,integer,jsonb)') IS NULL
    OR to_regprocedure('pgmq.delete(text,bigint)') IS NULL
    OR to_regprocedure('pgmq.set_vt(text,bigint,integer)') IS NULL
    OR to_regprocedure('pgmq.format_table_name(text,text)') IS NULL
  THEN
    RAISE EXCEPTION 'Installed pgmq version % does not provide the required typed worker API', installed_version;
  END IF;
END
$$;

-- pgmq.create is idempotent and creates the durable, non-partitioned queue
-- tables plus their identity sequence.
SELECT pgmq.create('dabboba_worker'::text);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pgmq.meta
    WHERE queue_name = 'dabboba_worker'::text
      AND is_partitioned = false
      AND is_unlogged = false
  ) THEN
    RAISE EXCEPTION 'dabboba_worker must be a basic logged pgmq queue';
  END IF;

  IF to_regclass('pgmq.q_dabboba_worker') IS NULL
    OR to_regclass('pgmq.a_dabboba_worker') IS NULL
    OR EXISTS (
      SELECT 1
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'pgmq'
        AND relation.relname IN ('q_dabboba_worker', 'a_dabboba_worker')
        AND relation.relpersistence <> 'p'
    )
  THEN
    RAISE EXCEPTION 'dabboba_worker queue relations must be logged';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.worker_dead_letters (
  queue_name text NOT NULL,
  message_id bigint NOT NULL,
  read_count integer NOT NULL,
  job_payload jsonb NOT NULL,
  error_message text NOT NULL,
  failed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT worker_dead_letters_pkey PRIMARY KEY (queue_name, message_id),
  CONSTRAINT worker_dead_letters_queue_name_check CHECK (
    char_length(queue_name) BETWEEN 1 AND 47
    AND queue_name ~ '^[a-z0-9_-]+$'
  ),
  CONSTRAINT worker_dead_letters_message_id_check CHECK (message_id > 0),
  CONSTRAINT worker_dead_letters_read_count_check CHECK (
    read_count BETWEEN 1 AND 1000000
  ),
  CONSTRAINT worker_dead_letters_payload_size_check CHECK (
    octet_length(job_payload::text) <= 1048576
  ),
  CONSTRAINT worker_dead_letters_error_size_check CHECK (
    octet_length(error_message) <= 4096
  )
);

ALTER TABLE pgmq.q_dabboba_worker ENABLE ROW LEVEL SECURITY;
ALTER TABLE pgmq.a_dabboba_worker ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_dead_letters ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA pgmq FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA pgmq FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA pgmq FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq FROM PUBLIC;
REVOKE ALL ON TABLE public.worker_dead_letters FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA pgmq REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA pgmq REVOKE ALL ON SEQUENCES FROM PUBLIC;

DO $$
DECLARE
  api_role record;
BEGIN
  FOR api_role IN
    SELECT rolname
    FROM pg_roles
    WHERE rolname IN ('anon', 'authenticated', 'service_role')
  LOOP
    EXECUTE format('REVOKE ALL ON SCHEMA pgmq FROM %I', api_role.rolname);
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA pgmq FROM %I', api_role.rolname);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA pgmq FROM %I', api_role.rolname);
    EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq FROM %I', api_role.rolname);
    EXECUTE format(
      'REVOKE ALL ON TABLE public.worker_dead_letters FROM %I',
      api_role.rolname
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA pgmq REVOKE ALL ON TABLES FROM %I',
      api_role.rolname
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA pgmq REVOKE ALL ON SEQUENCES FROM %I',
      api_role.rolname
    );
  END LOOP;
END
$$;

REVOKE ALL ON SCHEMA pgmq FROM dabboba_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA pgmq FROM dabboba_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA pgmq FROM dabboba_runtime;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq FROM dabboba_runtime;
REVOKE ALL ON TABLE public.worker_dead_letters FROM dabboba_runtime;

GRANT USAGE ON SCHEMA pgmq TO dabboba_runtime;
GRANT EXECUTE ON FUNCTION pgmq.send(text, jsonb, integer)
TO dabboba_runtime;
-- pgmq 1.5 implements the typed integer overload through this four-argument
-- function; both it and the identifier validator are required transitive calls.
GRANT EXECUTE ON FUNCTION pgmq.send(text, jsonb, jsonb, timestamp with time zone)
TO dabboba_runtime;
GRANT EXECUTE ON FUNCTION pgmq.format_table_name(text, text)
TO dabboba_runtime;
GRANT EXECUTE ON FUNCTION pgmq.read(text, integer, integer, jsonb)
TO dabboba_runtime;
GRANT EXECUTE ON FUNCTION pgmq.delete(text, bigint)
TO dabboba_runtime;
GRANT EXECUTE ON FUNCTION pgmq.set_vt(text, bigint, integer)
TO dabboba_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE pgmq.q_dabboba_worker TO dabboba_runtime;
GRANT USAGE ON SEQUENCE pgmq.q_dabboba_worker_msg_id_seq TO dabboba_runtime;
GRANT INSERT ON TABLE public.worker_dead_letters TO dabboba_runtime;
