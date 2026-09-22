-- Supabase Queues can install PostgREST-facing wrappers in pgmq_public. The
-- DABBOBA worker uses pgmq directly over the restricted PostgreSQL connection,
-- so those wrappers must not remain callable through Data API roles. Keep this
-- separate from 0027 because migration checksums are immutable once applied.
DO $$
DECLARE
  api_role record;
  pgmq_public_schema oid := to_regnamespace('pgmq_public');
BEGIN
  IF pgmq_public_schema IS NULL THEN
    RETURN;
  END IF;

  EXECUTE 'REVOKE ALL ON SCHEMA pgmq_public FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA pgmq_public FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA pgmq_public FROM PUBLIC';
  EXECUTE 'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq_public FROM PUBLIC';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA pgmq_public REVOKE ALL ON TABLES FROM PUBLIC';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA pgmq_public REVOKE ALL ON SEQUENCES FROM PUBLIC';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA pgmq_public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC';

  FOR api_role IN
    SELECT rolname
    FROM pg_roles
    WHERE rolname IN ('anon', 'authenticated', 'service_role', 'dabboba_runtime')
  LOOP
    EXECUTE format('REVOKE ALL ON SCHEMA pgmq_public FROM %I', api_role.rolname);
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA pgmq_public FROM %I', api_role.rolname);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA pgmq_public FROM %I', api_role.rolname);
    EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq_public FROM %I', api_role.rolname);
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA pgmq_public REVOKE ALL ON TABLES FROM %I',
      api_role.rolname
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA pgmq_public REVOKE ALL ON SEQUENCES FROM %I',
      api_role.rolname
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA pgmq_public REVOKE EXECUTE ON FUNCTIONS FROM %I',
      api_role.rolname
    );
  END LOOP;

  -- Verify direct PUBLIC ACL entries, including the default EXECUTE privilege
  -- PostgreSQL otherwise supplies when a function ACL is null.
  IF EXISTS (
    SELECT 1
    FROM pg_namespace AS namespace
    CROSS JOIN LATERAL aclexplode(
      COALESCE(namespace.nspacl, acldefault('n', namespace.nspowner))
    ) AS privilege
    WHERE namespace.oid = pgmq_public_schema
      AND privilege.grantee = 0
  ) OR EXISTS (
    SELECT 1
    FROM pg_proc AS routine
    CROSS JOIN LATERAL aclexplode(
      COALESCE(routine.proacl, acldefault('f', routine.proowner))
    ) AS privilege
    WHERE routine.pronamespace = pgmq_public_schema
      AND privilege.grantee = 0
  ) OR EXISTS (
    SELECT 1
    FROM pg_class AS relation
    CROSS JOIN LATERAL aclexplode(
      COALESCE(
        relation.relacl,
        acldefault(
          CASE WHEN relation.relkind = 'S' THEN 's'::"char" ELSE 'r'::"char" END,
          relation.relowner
        )
      )
    ) AS privilege
    WHERE relation.relnamespace = pgmq_public_schema
      AND relation.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
      AND privilege.grantee = 0
  ) THEN
    RAISE EXCEPTION 'pgmq_public still exposes schema objects to PUBLIC';
  END IF;

  -- has_*_privilege includes inherited membership and PUBLIC grants. A direct
  -- REVOKE that is defeated by an upstream role membership therefore fails the
  -- migration instead of leaving a callable PostgREST path behind.
  FOR api_role IN
    SELECT rolname
    FROM pg_roles
    WHERE rolname IN ('anon', 'authenticated', 'service_role', 'dabboba_runtime')
  LOOP
    IF has_schema_privilege(api_role.rolname, pgmq_public_schema, 'USAGE')
      OR has_schema_privilege(api_role.rolname, pgmq_public_schema, 'CREATE')
      OR EXISTS (
        SELECT 1
        FROM pg_proc AS routine
        WHERE routine.pronamespace = pgmq_public_schema
          AND has_function_privilege(api_role.rolname, routine.oid, 'EXECUTE')
      )
      OR EXISTS (
        SELECT 1
        FROM pg_class AS relation
        WHERE relation.relnamespace = pgmq_public_schema
          AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND (
            has_table_privilege(api_role.rolname, relation.oid, 'SELECT')
            OR has_table_privilege(api_role.rolname, relation.oid, 'INSERT')
            OR has_table_privilege(api_role.rolname, relation.oid, 'UPDATE')
            OR has_table_privilege(api_role.rolname, relation.oid, 'DELETE')
            OR has_table_privilege(api_role.rolname, relation.oid, 'TRUNCATE')
            OR has_table_privilege(api_role.rolname, relation.oid, 'REFERENCES')
            OR has_table_privilege(api_role.rolname, relation.oid, 'TRIGGER')
          )
      )
      OR EXISTS (
        SELECT 1
        FROM pg_class AS sequence
        WHERE sequence.relnamespace = pgmq_public_schema
          AND sequence.relkind = 'S'
          AND (
            has_sequence_privilege(api_role.rolname, sequence.oid, 'USAGE')
            OR has_sequence_privilege(api_role.rolname, sequence.oid, 'SELECT')
            OR has_sequence_privilege(api_role.rolname, sequence.oid, 'UPDATE')
          )
      )
    THEN
      RAISE EXCEPTION 'pgmq_public remains accessible to role % through direct, inherited, or PUBLIC privileges',
        api_role.rolname;
    END IF;
  END LOOP;
END
$$;
