-- pgmq.set_vt(text,bigint,integer) delegates to the timestamp overload in
-- pgmq 1.5+. The worker has permission on the public integer entry point,
-- but cannot execute its dependency after the exact ACL sweep in 0031.
-- Keep the dependency private to the worker and leave the API role denied.
DO $$
BEGIN
  IF to_regprocedure('pgmq.set_vt(text,bigint,integer)') IS NULL
    OR to_regprocedure('pgmq.set_vt(text,bigint,timestamp with time zone)') IS NULL
  THEN
    RAISE EXCEPTION 'pgmq set_vt overloads are required for worker visibility renewal';
  END IF;

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
    RAISE EXCEPTION 'pgmq set_vt dependency ACL is not worker-only';
  END IF;
END
$$;
