-- Narrow the deletion/push worker's session visibility. Migration 0056 used
-- table-wide SELECT alongside column-scoped UPDATE, which also exposed opaque
-- session digests and request metadata that neither worker flow needs.

REVOKE SELECT ON TABLE public.sessions FROM dabboba_worker;

GRANT SELECT (id,user_id,session_kind,revoked_at,expires_at)
ON TABLE public.sessions TO dabboba_worker;

DO $$
DECLARE
  visible_columns text[];
BEGIN
  SELECT array_agg(column_name ORDER BY column_name)
    INTO visible_columns
    FROM information_schema.column_privileges
   WHERE grantee='dabboba_worker'
     AND table_schema='public'
     AND table_name='sessions'
     AND privilege_type='SELECT';

  IF visible_columns IS DISTINCT FROM ARRAY[
    'expires_at','id','revoked_at','session_kind','user_id'
  ]::text[] THEN
    RAISE EXCEPTION 'dabboba_worker session visibility is not the exact allow-list';
  END IF;
END
$$;
