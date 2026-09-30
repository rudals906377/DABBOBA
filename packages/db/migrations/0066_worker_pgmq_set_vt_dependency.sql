-- Some pgmq installations implement the integer entry point directly, while
-- others delegate it to a timestamp overload. The worker must retain access
-- to the integer entry point in either case; grant the optional dependency
-- only when it exists, without widening API-role or PUBLIC access.
DO $$
BEGIN
  IF to_regprocedure('pgmq.set_vt(text,bigint,integer)') IS NULL THEN
    RAISE EXCEPTION 'pgmq integer set_vt entry point is required for worker visibility renewal';
  END IF;

  IF NOT has_function_privilege(
      'dabboba_worker',
      'pgmq.set_vt(text,bigint,integer)',
      'EXECUTE'
    )
    OR EXISTS (
      SELECT 1
        FROM pg_roles
       WHERE rolname IN ('anon','authenticated','service_role','dabboba_runtime')
         AND has_function_privilege(
           rolname,
           'pgmq.set_vt(text,bigint,integer)',
           'EXECUTE'
         )
    )
  THEN
    RAISE EXCEPTION 'pgmq integer set_vt ACL is not worker-only';
  END IF;

  IF to_regprocedure('pgmq.set_vt(text,bigint,timestamp with time zone)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION pgmq.set_vt(text,bigint,timestamp with time zone)
      FROM PUBLIC, anon, authenticated, service_role, dabboba_runtime;

    GRANT EXECUTE ON FUNCTION pgmq.set_vt(text,bigint,timestamp with time zone)
      TO dabboba_worker;

    IF NOT has_function_privilege(
        'dabboba_worker',
        'pgmq.set_vt(text,bigint,timestamp with time zone)',
        'EXECUTE'
      )
      OR EXISTS (
        SELECT 1
          FROM pg_roles
         WHERE rolname IN ('anon','authenticated','service_role','dabboba_runtime')
           AND has_function_privilege(
             rolname,
             'pgmq.set_vt(text,bigint,timestamp with time zone)',
             'EXECUTE'
           )
      )
    THEN
      RAISE EXCEPTION 'pgmq timestamp set_vt dependency ACL is not worker-only';
    END IF;
  END IF;
END
$$;
