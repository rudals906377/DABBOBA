-- A web account-deletion proof (OAuth or OTP through the Supabase broker) can
-- create a Supabase Auth user that no DABBOBA account is linked to, for
-- example when the person picked a provider they never used with DABBOBA.
-- The API, which holds no Auth admin key, records that user here; the worker
-- deletes it with the same Admin endpoint it uses for completed deletions.

CREATE TABLE public.supabase_auth_orphan_cleanups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_user_id uuid NOT NULL UNIQUE,
  reason text NOT NULL CHECK (reason IN ('ACCOUNT_DELETION_PROOF_UNLINKED')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'PENDING' AND lease_expires_at IS NULL)
    OR (status = 'PROCESSING' AND lease_expires_at IS NOT NULL)
  )
);

CREATE INDEX supabase_auth_orphan_cleanups_ready_idx
ON public.supabase_auth_orphan_cleanups (available_at, created_at, id);

ALTER TABLE public.supabase_auth_orphan_cleanups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.supabase_auth_orphan_cleanups FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.supabase_auth_orphan_cleanups TO dabboba_runtime;
GRANT SELECT, UPDATE, DELETE ON TABLE public.supabase_auth_orphan_cleanups TO dabboba_worker;

COMMENT ON TABLE public.supabase_auth_orphan_cleanups IS
  'Supabase Auth users created by a web account-deletion proof that matched no DABBOBA account; the worker deletes them.';
