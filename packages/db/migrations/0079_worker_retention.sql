-- Bounded data retention for the finite worker (apps/worker/src/retention.ts).
--
-- * Published outbox events older than the retention window are deleted,
--   except durable one-per-payment reconciliation alerts and events still
--   referenced by the inventory storage-expiry ledger.
-- * Expired idempotency keys are deleted, except CREATE_ORDER keys, which are
--   durable purchase identities.
-- * Revoked/expired sessions older than the retention window are deleted when
--   no newer session names them as a rotation parent.
-- * Raw anonymous Home click events past the API's 30-day popularity window
--   are folded into a per-product daily aggregate and then deleted.
--
-- The worker receives only the DELETE and column reads each statement needs.
-- Session token digests, request metadata and idempotency response bodies
-- remain unreadable to the worker.

CREATE TABLE IF NOT EXISTS public.home_product_click_daily (
  product_id text NOT NULL REFERENCES public.catalog_products(id) ON DELETE RESTRICT,
  click_date date NOT NULL,
  click_count bigint NOT NULL CHECK (click_count > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, click_date)
);

COMMENT ON TABLE public.home_product_click_daily IS
  'Anonymous per-product daily Home click totals (Asia/Seoul business day) rolled up from home_product_click_events after the 30-day popularity window.';

ALTER TABLE public.home_product_click_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.home_product_click_daily FROM PUBLIC;
REVOKE ALL ON TABLE public.home_product_click_daily FROM dabboba_runtime;

-- Raw click events stay immutable to every ordinary path. A DELETE is admitted
-- only inside the worker's explicitly flagged rollup transaction and only for
-- events already outside the API's 30-day popularity window (plus one day).
CREATE OR REPLACE FUNCTION public.guard_home_product_click_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('dabboba.home_click_rollup', true) = 'on'
     AND OLD.created_at < now() - interval '31 days' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'home_product_click_events rows are immutable outside the retention rollup'
    USING ERRCODE = '55000';
END
$$;

REVOKE EXECUTE ON FUNCTION public.guard_home_product_click_event_mutation() FROM PUBLIC;

DROP TRIGGER IF EXISTS home_product_click_events_immutable ON public.home_product_click_events;
CREATE TRIGGER home_product_click_events_immutable
BEFORE UPDATE OR DELETE ON public.home_product_click_events
FOR EACH ROW EXECUTE FUNCTION public.guard_home_product_click_event_mutation();

-- Worker retention privileges.
GRANT DELETE ON TABLE public.outbox_events TO dabboba_worker;

GRANT SELECT (id, scope, expires_at) ON TABLE public.idempotency_keys TO dabboba_worker;
GRANT DELETE ON TABLE public.idempotency_keys TO dabboba_worker;

GRANT SELECT (rotated_from_session_id) ON TABLE public.sessions TO dabboba_worker;
GRANT DELETE ON TABLE public.sessions TO dabboba_worker;

GRANT SELECT, DELETE ON TABLE public.home_product_click_events TO dabboba_worker;
GRANT SELECT, INSERT, UPDATE ON TABLE public.home_product_click_daily TO dabboba_worker;

-- Supabase's service_role bypasses RLS through the Data API. DABBOBA reaches
-- public tables only through the reviewed API and worker roles, so remove any
-- drifted service_role table or sequence grant, including on the new table.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM service_role;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM service_role;
  END IF;
END
$$;

-- Self-attest the exact retention allow-list.
DO $$
DECLARE
  expected record;
  privilege_name text;
  api_role record;
BEGIN
  FOR expected IN
    SELECT * FROM (VALUES
      ('public.outbox_events', ARRAY['SELECT','INSERT','UPDATE','DELETE']),
      ('public.idempotency_keys', ARRAY['DELETE']),
      ('public.home_product_click_events', ARRAY['SELECT','DELETE']),
      ('public.home_product_click_daily', ARRAY['SELECT','INSERT','UPDATE'])
    ) AS allow_list(relation_name, privileges)
  LOOP
    FOREACH privilege_name IN ARRAY ARRAY[
      'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
    ]
    LOOP
      IF has_table_privilege('dabboba_worker', expected.relation_name, privilege_name)
         IS DISTINCT FROM (privilege_name = ANY(expected.privileges)) THEN
        RAISE EXCEPTION 'unexpected dabboba_worker % privilege on %',
          privilege_name, expected.relation_name;
      END IF;
    END LOOP;
  END LOOP;

  -- sessions: DELETE plus column reads only; never token digests or metadata.
  IF NOT has_table_privilege('dabboba_worker','public.sessions','DELETE')
     OR has_table_privilege('dabboba_worker','public.sessions','SELECT')
     OR has_table_privilege('dabboba_worker','public.sessions','INSERT')
     OR has_table_privilege('dabboba_worker','public.sessions','TRUNCATE')
     OR has_column_privilege('dabboba_worker','public.sessions','token_digest','SELECT')
     OR has_column_privilege('dabboba_worker','public.sessions','ip_address','SELECT')
     OR has_column_privilege('dabboba_worker','public.sessions','user_agent','SELECT') THEN
    RAISE EXCEPTION 'dabboba_worker session retention privileges are not the exact allow-list';
  END IF;

  -- idempotency_keys: only the columns the retention predicate reads.
  IF NOT has_column_privilege('dabboba_worker','public.idempotency_keys','expires_at','SELECT')
     OR has_column_privilege('dabboba_worker','public.idempotency_keys','response_body','SELECT')
     OR has_column_privilege('dabboba_worker','public.idempotency_keys','request_hash','SELECT')
     OR has_column_privilege('dabboba_worker','public.idempotency_keys','idempotency_key','SELECT') THEN
    RAISE EXCEPTION 'dabboba_worker idempotency retention privileges are not the exact allow-list';
  END IF;

  IF has_table_privilege(
    'dabboba_runtime',
    'public.home_product_click_daily',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  ) OR has_table_privilege('dabboba_runtime','public.home_product_click_events','DELETE')
    OR has_table_privilege('dabboba_runtime','public.home_product_click_events','UPDATE') THEN
    RAISE EXCEPTION 'dabboba_runtime gained Home click retention privileges';
  END IF;

  FOR api_role IN
    SELECT rolname FROM pg_roles
     WHERE rolname IN ('anon','authenticated','service_role')
  LOOP
    IF EXISTS (
      SELECT 1
        FROM pg_class relation
       WHERE relation.relnamespace = 'public'::regnamespace
         AND relation.relkind IN ('r','p','v','m','f')
         AND has_table_privilege(
           api_role.rolname, relation.oid,
           'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
         )
    ) THEN
      RAISE EXCEPTION 'role % retains a public table grant', api_role.rolname;
    END IF;
  END LOOP;
END
$$;
