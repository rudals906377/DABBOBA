-- pgmq extension upgrades can add functions after the current ACL sweep. Make
-- the extension owner's future pgmq functions private by default, then restore
-- only the reviewed worker call surface. This is forward-only because earlier
-- migration checksums may already be recorded in schema_migrations.
DO $$
DECLARE
  pgmq_owner name;
BEGIN
  SELECT owner_role.rolname
    INTO pgmq_owner
    FROM pg_extension AS extension
    JOIN pg_roles AS owner_role ON owner_role.oid = extension.extowner
   WHERE extension.extname = 'pgmq';

  IF pgmq_owner IS NULL THEN
    RAISE EXCEPTION 'pgmq extension owner could not be resolved';
  END IF;

  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA pgmq REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
    pgmq_owner
  );
END
$$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq FROM PUBLIC;

-- 0029 used runtime-role inheritance as a bootstrap bridge. Remove every role
-- membership from a possibly pre-existing worker identity before production,
-- then grant only the public relations exercised by the
-- finite worker. BYPASSRLS remains necessary because application tables are
-- backend-only with RLS enabled and no Data API policies; table ACLs remain the
-- outer boundary.
DO $$
DECLARE
  granted_role record;
BEGIN
  FOR granted_role IN
    SELECT role.rolname
      FROM pg_auth_members AS membership
      JOIN pg_roles AS role ON role.oid = membership.roleid
      JOIN pg_roles AS member ON member.oid = membership.member
     WHERE member.rolname = 'dabboba_worker'
  LOOP
    EXECUTE format('REVOKE %I FROM dabboba_worker', granted_role.rolname);
  END LOOP;
END
$$;

ALTER ROLE dabboba_worker NOINHERIT;
ALTER ROLE dabboba_worker SET search_path = pg_catalog, public, pgmq, pg_temp;
GRANT USAGE ON SCHEMA public TO dabboba_worker;
REVOKE CREATE ON SCHEMA public FROM dabboba_worker;
REVOKE ALL ON SCHEMA extensions FROM dabboba_worker;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM dabboba_worker;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM dabboba_worker;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM dabboba_worker;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions FROM dabboba_worker;

DO $$
BEGIN
  IF to_regnamespace('pgmq_public') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON SCHEMA pgmq_public FROM dabboba_worker';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA pgmq_public FROM dabboba_worker';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA pgmq_public FROM dabboba_worker';
    EXECUTE 'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq_public FROM dabboba_worker';
  END IF;
END
$$;

GRANT SELECT, INSERT, UPDATE ON TABLE public.outbox_events TO dabboba_worker;
GRANT SELECT, INSERT ON TABLE public.notifications TO dabboba_worker;
GRANT SELECT ON TABLE public.notification_preferences TO dabboba_worker;
GRANT SELECT, UPDATE ON TABLE public.orders TO dabboba_worker;
GRANT SELECT ON TABLE public.inquiries TO dabboba_worker;
GRANT SELECT ON TABLE public.shipping_requests TO dabboba_worker;
GRANT SELECT, UPDATE ON TABLE public.payments TO dabboba_worker;
GRANT SELECT, UPDATE ON TABLE public.stock_reservations TO dabboba_worker;
GRANT SELECT, UPDATE ON TABLE public.product_stock TO dabboba_worker;
GRANT SELECT, UPDATE ON TABLE public.coupon_redemptions TO dabboba_worker;
GRANT SELECT, UPDATE ON TABLE public.coupons TO dabboba_worker;
GRANT INSERT ON TABLE public.point_ledger_entries TO dabboba_worker;
GRANT SELECT, UPDATE ON TABLE public.point_accounts TO dabboba_worker;
GRANT SELECT, UPDATE ON TABLE public.kuji_room_entries TO dabboba_worker;
GRANT SELECT, UPDATE ON TABLE public.kuji_rooms TO dabboba_worker;
GRANT SELECT ON TABLE public.catalog_products TO dabboba_worker;
GRANT SELECT ON TABLE public.draw_probability_versions TO dabboba_worker;
GRANT SELECT ON TABLE public.draw_pool_entries TO dabboba_worker;
GRANT SELECT, UPDATE ON TABLE public.media_assets TO dabboba_worker;
GRANT INSERT ON TABLE public.worker_dead_letters TO dabboba_worker;

DO $$
DECLARE
  application_role record;
BEGIN
  FOR application_role IN
    SELECT rolname
      FROM pg_roles
     WHERE rolname IN (
       'anon',
       'authenticated',
       'service_role',
       'dabboba_runtime',
       'dabboba_worker'
     )
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq FROM %I',
      application_role.rolname
    );
  END LOOP;
END
$$;

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

DO $$
DECLARE
  pgmq_namespace oid := to_regnamespace('pgmq');
  pgmq_owner oid;
  allowed_worker_functions oid[] := ARRAY[
    to_regprocedure('pgmq.send(text,jsonb,integer)')::oid,
    to_regprocedure('pgmq.send(text,jsonb,jsonb,timestamp with time zone)')::oid,
    to_regprocedure('pgmq.format_table_name(text,text)')::oid,
    to_regprocedure('pgmq.read(text,integer,integer,jsonb)')::oid,
    to_regprocedure('pgmq.delete(text,bigint)')::oid,
    to_regprocedure('pgmq.set_vt(text,bigint,integer)')::oid
  ];
  application_role record;
  unexpected_table text;
  missing_privilege text;
BEGIN
  SELECT extowner
    INTO pgmq_owner
    FROM pg_extension
   WHERE extname = 'pgmq';

  IF pgmq_namespace IS NULL OR pgmq_owner IS NULL
    OR array_position(allowed_worker_functions, NULL) IS NOT NULL
  THEN
    RAISE EXCEPTION 'pgmq function ACL attestation cannot resolve its required objects';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_proc AS routine
      CROSS JOIN LATERAL aclexplode(
        COALESCE(routine.proacl, acldefault('f', routine.proowner))
      ) AS privilege
     WHERE routine.pronamespace = pgmq_namespace
       AND privilege.grantee = 0
       AND privilege.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'pgmq still exposes a function to PUBLIC';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_default_acl AS defaults
      CROSS JOIN LATERAL aclexplode(
        COALESCE(defaults.defaclacl, '{}'::aclitem[])
      ) AS privilege
     WHERE defaults.defaclrole = pgmq_owner
       AND defaults.defaclnamespace = pgmq_namespace
       AND defaults.defaclobjtype = 'f'
       AND privilege.grantee = 0
       AND privilege.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'pgmq extension-owner defaults still grant function execution to PUBLIC';
  END IF;

  FOR application_role IN
    SELECT rolname
      FROM pg_roles
     WHERE rolname IN ('anon', 'authenticated', 'service_role', 'dabboba_runtime')
  LOOP
    IF EXISTS (
      SELECT 1
        FROM pg_proc AS routine
       WHERE routine.pronamespace = pgmq_namespace
         AND has_function_privilege(application_role.rolname, routine.oid, 'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'role % retains a callable pgmq function', application_role.rolname;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM pg_proc AS routine
     WHERE routine.pronamespace = pgmq_namespace
       AND has_function_privilege('dabboba_worker', routine.oid, 'EXECUTE')
       AND NOT (routine.oid = ANY(allowed_worker_functions))
  ) OR EXISTS (
    SELECT 1
      FROM unnest(allowed_worker_functions) AS required_function(oid)
     WHERE NOT has_function_privilege('dabboba_worker', required_function.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'dabboba_worker pgmq function privileges are not the exact allow-list';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_auth_members AS membership
      JOIN pg_roles AS member_role ON member_role.oid = membership.member
     WHERE member_role.rolname = 'dabboba_worker'
  ) OR (SELECT rolinherit FROM pg_roles WHERE rolname = 'dabboba_worker') THEN
    RAISE EXCEPTION 'dabboba_worker retains a role membership or INHERIT attribute';
  END IF;

  IF NOT has_schema_privilege('dabboba_worker', 'public', 'USAGE')
    OR has_schema_privilege('dabboba_worker', 'public', 'CREATE')
    OR NOT has_schema_privilege('dabboba_worker', 'pgmq', 'USAGE')
    OR has_schema_privilege('dabboba_worker', 'pgmq', 'CREATE')
    OR has_schema_privilege('dabboba_worker', 'extensions', 'USAGE')
    OR has_schema_privilege('dabboba_worker', 'extensions', 'CREATE')
  THEN
    RAISE EXCEPTION 'dabboba_worker schema privileges are not the exact allow-list';
  END IF;

  IF to_regnamespace('pgmq_public') IS NOT NULL AND (
    has_schema_privilege('dabboba_worker', 'pgmq_public', 'USAGE')
    OR has_schema_privilege('dabboba_worker', 'pgmq_public', 'CREATE')
    OR EXISTS (
      SELECT 1 FROM pg_proc AS routine
       WHERE routine.pronamespace = to_regnamespace('pgmq_public')
         AND has_function_privilege('dabboba_worker', routine.oid, 'EXECUTE')
    )
  ) THEN
    RAISE EXCEPTION 'pgmq_public became accessible to dabboba_worker';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_proc AS routine
     WHERE routine.pronamespace IN (to_regnamespace('public'), to_regnamespace('extensions'))
       -- has_function_privilege includes grants inherited from PUBLIC even when
       -- the role cannot resolve anything in the containing schema. Supabase
       -- intentionally leaves extension routines executable by PUBLIC, so
       -- attest the effective callable surface without rewriting provider ACLs.
       AND has_schema_privilege('dabboba_worker', routine.pronamespace, 'USAGE')
       AND has_function_privilege('dabboba_worker', routine.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'dabboba_worker can resolve and execute an unreviewed public or extension function';
  END IF;

  SELECT relation.oid::regclass::text
    INTO unexpected_table
    FROM pg_class AS relation
   WHERE relation.relnamespace = to_regnamespace('public')
     AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
     AND has_table_privilege(
       'dabboba_worker',
       relation.oid,
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     AND NOT (
       relation.oid = ANY(ARRAY[
         'public.outbox_events'::regclass,
         'public.notifications'::regclass,
         'public.notification_preferences'::regclass,
         'public.orders'::regclass,
         'public.inquiries'::regclass,
         'public.shipping_requests'::regclass,
         'public.payments'::regclass,
         'public.stock_reservations'::regclass,
         'public.product_stock'::regclass,
         'public.coupon_redemptions'::regclass,
         'public.coupons'::regclass,
         'public.point_ledger_entries'::regclass,
         'public.point_accounts'::regclass,
         'public.kuji_room_entries'::regclass,
         'public.kuji_rooms'::regclass,
         'public.catalog_products'::regclass,
         'public.draw_probability_versions'::regclass,
         'public.draw_pool_entries'::regclass,
         'public.media_assets'::regclass,
         'public.worker_dead_letters'::regclass
       ])
     )
   LIMIT 1;
  IF unexpected_table IS NOT NULL THEN
    RAISE EXCEPTION 'dabboba_worker can access unexpected public relation %', unexpected_table;
  END IF;

  SELECT required.relation_name || ':' || required.privilege_name
    INTO missing_privilege
    FROM (VALUES
      ('outbox_events', 'SELECT'), ('outbox_events', 'INSERT'), ('outbox_events', 'UPDATE'),
      ('notifications', 'SELECT'), ('notifications', 'INSERT'),
      ('notification_preferences', 'SELECT'),
      ('orders', 'SELECT'), ('orders', 'UPDATE'),
      ('inquiries', 'SELECT'), ('shipping_requests', 'SELECT'),
      ('payments', 'SELECT'), ('payments', 'UPDATE'),
      ('stock_reservations', 'SELECT'), ('stock_reservations', 'UPDATE'),
      ('product_stock', 'SELECT'), ('product_stock', 'UPDATE'),
      ('coupon_redemptions', 'SELECT'), ('coupon_redemptions', 'UPDATE'),
      ('coupons', 'SELECT'), ('coupons', 'UPDATE'),
      ('point_ledger_entries', 'INSERT'),
      ('point_accounts', 'SELECT'), ('point_accounts', 'UPDATE'),
      ('kuji_room_entries', 'SELECT'), ('kuji_room_entries', 'UPDATE'),
      ('kuji_rooms', 'SELECT'), ('kuji_rooms', 'UPDATE'),
      ('catalog_products', 'SELECT'),
      ('draw_probability_versions', 'SELECT'), ('draw_pool_entries', 'SELECT'),
      ('media_assets', 'SELECT'), ('media_assets', 'UPDATE'),
      ('worker_dead_letters', 'INSERT')
    ) AS required(relation_name, privilege_name)
   WHERE NOT has_table_privilege(
     'dabboba_worker',
     to_regclass('public.' || required.relation_name),
     required.privilege_name
   )
   LIMIT 1;
  IF missing_privilege IS NOT NULL THEN
    RAISE EXCEPTION 'dabboba_worker is missing required table privilege %', missing_privilege;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_class AS relation
     WHERE relation.relnamespace = to_regnamespace('public')
       AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND has_table_privilege(
         'dabboba_worker',
         relation.oid,
         'DELETE,TRUNCATE,REFERENCES,TRIGGER'
       )
  ) OR EXISTS (
    SELECT 1
      FROM pg_class AS sequence
     WHERE sequence.relnamespace = to_regnamespace('public')
       AND sequence.relkind = 'S'
       AND CASE WHEN sequence.relkind = 'S' THEN
         has_sequence_privilege('dabboba_worker', sequence.oid, 'USAGE,SELECT,UPDATE')
       ELSE false END
  ) THEN
    RAISE EXCEPTION 'dabboba_worker retains an unreviewed mutation or sequence privilege';
  END IF;
END
$$;
