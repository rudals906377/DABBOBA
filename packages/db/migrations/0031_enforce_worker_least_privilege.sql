-- Normalize a pre-existing worker identity before its login password is
-- provisioned. Table ACLs are the outer boundary because backend-only tables
-- have RLS enabled without worker policies; BYPASSRLS is therefore intentional.
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

-- Supabase's managed postgres role cannot re-ALTER an already hardened
-- BYPASSRLS role. 0029 and 0030 establish this exact state for a fresh role,
-- so avoid a redundant ALTER while still failing closed on a genuinely
-- divergent pre-existing role.
DO $$
DECLARE
  worker_role_state record;
BEGIN
  SELECT rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,
         rolbypassrls,rolcanlogin
    INTO worker_role_state
    FROM pg_roles
   WHERE rolname='dabboba_worker';

  IF worker_role_state IS NULL THEN
    RAISE EXCEPTION 'dabboba_worker role is missing before least-privilege enforcement';
  END IF;

  IF worker_role_state.rolsuper
    OR worker_role_state.rolcreatedb
    OR worker_role_state.rolcreaterole
    OR worker_role_state.rolinherit
    OR worker_role_state.rolreplication
    OR NOT worker_role_state.rolbypassrls
    OR worker_role_state.rolcanlogin
  THEN
    EXECUTE 'ALTER ROLE dabboba_worker WITH NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION BYPASSRLS NOLOGIN';
  END IF;
END
$$;
ALTER ROLE dabboba_worker SET search_path = pg_catalog, public, pgmq, pg_temp;

REVOKE ALL ON SCHEMA public FROM dabboba_worker;
GRANT USAGE ON SCHEMA public TO dabboba_worker;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM dabboba_worker;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM dabboba_worker;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM dabboba_worker;
REVOKE ALL ON SCHEMA extensions FROM dabboba_worker;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions FROM dabboba_worker;

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

REVOKE ALL ON SCHEMA pgmq FROM dabboba_worker;
GRANT USAGE ON SCHEMA pgmq TO dabboba_worker;
REVOKE ALL ON ALL TABLES IN SCHEMA pgmq FROM dabboba_worker;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA pgmq FROM dabboba_worker;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq FROM dabboba_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE pgmq.q_dabboba_worker TO dabboba_worker;
GRANT USAGE ON SEQUENCE pgmq.q_dabboba_worker_msg_id_seq TO dabboba_worker;
GRANT EXECUTE ON FUNCTION pgmq.send(text, jsonb, integer) TO dabboba_worker;
GRANT EXECUTE ON FUNCTION pgmq.send(text, jsonb, jsonb, timestamp with time zone) TO dabboba_worker;
GRANT EXECUTE ON FUNCTION pgmq.format_table_name(text, text) TO dabboba_worker;
GRANT EXECUTE ON FUNCTION pgmq.read(text, integer, integer, jsonb) TO dabboba_worker;
GRANT EXECUTE ON FUNCTION pgmq.delete(text, bigint) TO dabboba_worker;
GRANT EXECUTE ON FUNCTION pgmq.set_vt(text, bigint, integer) TO dabboba_worker;

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

DO $$
DECLARE
  role_state record;
  relation_state record;
  allowed_privileges text[];
  privilege_name text;
  actual_privilege boolean;
  expected_privilege boolean;
  allowed_worker_functions oid[] := ARRAY[
    to_regprocedure('pgmq.send(text,jsonb,integer)')::oid,
    to_regprocedure('pgmq.send(text,jsonb,jsonb,timestamp with time zone)')::oid,
    to_regprocedure('pgmq.format_table_name(text,text)')::oid,
    to_regprocedure('pgmq.read(text,integer,integer,jsonb)')::oid,
    to_regprocedure('pgmq.delete(text,bigint)')::oid,
    to_regprocedure('pgmq.set_vt(text,bigint,integer)')::oid
  ];
BEGIN
  SELECT rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls,
         rolcanlogin,rolconfig
    INTO role_state
    FROM pg_roles
   WHERE rolname='dabboba_worker';
  IF role_state IS NULL
    OR role_state.rolsuper
    OR role_state.rolcreatedb
    OR role_state.rolcreaterole
    OR role_state.rolinherit
    OR role_state.rolreplication
    OR NOT role_state.rolbypassrls
    OR role_state.rolcanlogin
    OR NOT COALESCE(
      role_state.rolconfig @> ARRAY['search_path=pg_catalog, public, pgmq, pg_temp'],
      false
    )
  THEN
    RAISE EXCEPTION 'dabboba_worker role attributes are not the reviewed pre-provisioning state';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_auth_members AS membership
      JOIN pg_roles AS member ON member.oid=membership.member
     WHERE member.rolname='dabboba_worker'
  ) THEN
    RAISE EXCEPTION 'dabboba_worker retains a role membership';
  END IF;

  FOR relation_state IN
    SELECT relation.oid,relation.relname
      FROM pg_class AS relation
     WHERE relation.relnamespace=to_regnamespace('public')
       AND relation.relkind IN ('r','p','v','m','f')
  LOOP
    SELECT expected.privileges
      INTO allowed_privileges
      FROM (VALUES
        ('outbox_events', ARRAY['SELECT','INSERT','UPDATE']),
        ('notifications', ARRAY['SELECT','INSERT']),
        ('notification_preferences', ARRAY['SELECT']),
        ('orders', ARRAY['SELECT','UPDATE']),
        ('inquiries', ARRAY['SELECT']),
        ('shipping_requests', ARRAY['SELECT']),
        ('payments', ARRAY['SELECT','UPDATE']),
        ('stock_reservations', ARRAY['SELECT','UPDATE']),
        ('product_stock', ARRAY['SELECT','UPDATE']),
        ('coupon_redemptions', ARRAY['SELECT','UPDATE']),
        ('coupons', ARRAY['SELECT','UPDATE']),
        ('point_ledger_entries', ARRAY['INSERT']),
        ('point_accounts', ARRAY['SELECT','UPDATE']),
        ('kuji_room_entries', ARRAY['SELECT','UPDATE']),
        ('kuji_rooms', ARRAY['SELECT','UPDATE']),
        ('catalog_products', ARRAY['SELECT']),
        ('draw_probability_versions', ARRAY['SELECT']),
        ('draw_pool_entries', ARRAY['SELECT']),
        ('media_assets', ARRAY['SELECT','UPDATE']),
        ('worker_dead_letters', ARRAY['INSERT'])
      ) AS expected(relation_name,privileges)
     WHERE expected.relation_name=relation_state.relname;
    allowed_privileges := COALESCE(allowed_privileges, ARRAY[]::text[]);

    FOREACH privilege_name IN ARRAY ARRAY[
      'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
    ]
    LOOP
      actual_privilege := has_table_privilege(
        'dabboba_worker',relation_state.oid,privilege_name
      );
      expected_privilege := privilege_name=ANY(allowed_privileges);
      IF actual_privilege IS DISTINCT FROM expected_privilege THEN
        RAISE EXCEPTION 'unexpected dabboba_worker %.% privilege: actual %, expected %',
          relation_state.relname,privilege_name,actual_privilege,expected_privilege;
      END IF;
    END LOOP;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM pg_class AS sequence
     WHERE sequence.relnamespace=to_regnamespace('public')
       AND sequence.relkind='S'
       AND CASE WHEN sequence.relkind='S' THEN
         has_sequence_privilege('dabboba_worker',sequence.oid,'USAGE,SELECT,UPDATE')
       ELSE false END
  ) THEN
    RAISE EXCEPTION 'dabboba_worker can access an unexpected public sequence';
  END IF;

  IF NOT has_schema_privilege('dabboba_worker','public','USAGE')
    OR has_schema_privilege('dabboba_worker','public','CREATE')
    OR NOT has_schema_privilege('dabboba_worker','pgmq','USAGE')
    OR has_schema_privilege('dabboba_worker','pgmq','CREATE')
    OR has_schema_privilege('dabboba_worker','extensions','USAGE')
    OR has_schema_privilege('dabboba_worker','extensions','CREATE')
  THEN
    RAISE EXCEPTION 'dabboba_worker schema privileges are not the exact allow-list';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_proc AS routine
     WHERE routine.pronamespace IN (to_regnamespace('public'),to_regnamespace('extensions'))
       AND has_schema_privilege('dabboba_worker',routine.pronamespace,'USAGE')
       AND has_function_privilege('dabboba_worker',routine.oid,'EXECUTE')
  ) OR EXISTS (
    SELECT 1
      FROM pg_proc AS routine
     WHERE routine.pronamespace=to_regnamespace('pgmq')
       AND has_function_privilege('dabboba_worker',routine.oid,'EXECUTE')
       AND NOT (routine.oid=ANY(allowed_worker_functions))
  ) OR EXISTS (
    SELECT 1
      FROM unnest(allowed_worker_functions) AS required_function(oid)
     WHERE NOT has_function_privilege('dabboba_worker',required_function.oid,'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'dabboba_worker function privileges are not the exact allow-list';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_class AS relation
     WHERE relation.relnamespace=to_regnamespace('pgmq')
       AND relation.relkind IN ('r','p','v','m','f')
       AND relation.oid <> 'pgmq.q_dabboba_worker'::regclass
       AND has_table_privilege(
         'dabboba_worker',relation.oid,
         'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
       )
  ) OR NOT has_table_privilege(
    'dabboba_worker','pgmq.q_dabboba_worker','SELECT,INSERT,UPDATE,DELETE'
  ) OR has_table_privilege(
    'dabboba_worker','pgmq.q_dabboba_worker','TRUNCATE,REFERENCES,TRIGGER'
  ) THEN
    RAISE EXCEPTION 'dabboba_worker pgmq relation privileges are not the exact allow-list';
  END IF;

  IF NOT has_sequence_privilege(
    'dabboba_worker','pgmq.q_dabboba_worker_msg_id_seq','USAGE'
  ) OR has_sequence_privilege(
    'dabboba_worker','pgmq.q_dabboba_worker_msg_id_seq','SELECT,UPDATE'
  ) OR EXISTS (
    SELECT 1
      FROM pg_class AS sequence
     WHERE sequence.relnamespace=to_regnamespace('pgmq')
       AND sequence.relkind='S'
       AND sequence.oid <> 'pgmq.q_dabboba_worker_msg_id_seq'::regclass
       AND CASE WHEN sequence.relkind='S' THEN
         has_sequence_privilege('dabboba_worker',sequence.oid,'USAGE,SELECT,UPDATE')
       ELSE false END
  ) THEN
    RAISE EXCEPTION 'dabboba_worker pgmq sequence privileges are not the exact allow-list';
  END IF;

  IF to_regnamespace('pgmq_public') IS NOT NULL AND (
    has_schema_privilege('dabboba_worker','pgmq_public','USAGE')
    OR has_schema_privilege('dabboba_worker','pgmq_public','CREATE')
    OR EXISTS (
      SELECT 1 FROM pg_proc AS routine
       WHERE routine.pronamespace=to_regnamespace('pgmq_public')
         AND has_function_privilege('dabboba_worker',routine.oid,'EXECUTE')
    )
  ) THEN
    RAISE EXCEPTION 'pgmq_public is accessible to dabboba_worker';
  END IF;
END
$$;
