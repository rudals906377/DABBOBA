-- DABBOBA application data is reachable only through the trusted Fastify API.
-- Remove Data API privileges before any application tables are created.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;
-- Function default privileges are global for the creating role; PostgreSQL does
-- not support removing the hard-wired PUBLIC EXECUTE default per schema.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DO $$
DECLARE
  api_role record;
BEGIN
  FOR api_role IN
    SELECT rolname
    FROM pg_roles
    WHERE rolname IN ('anon', 'authenticated', 'service_role')
  LOOP
    EXECUTE format('REVOKE ALL ON SCHEMA public FROM %I', api_role.rolname);
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', api_role.rolname);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', api_role.rolname);
    EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM %I', api_role.rolname);
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I',
      api_role.rolname
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I',
      api_role.rolname
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM %I',
      api_role.rolname
    );
  END LOOP;
END
$$;

ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
