-- Enforce current policy acceptance for active sessions and retain the
-- server-side revocation material required to safely delete Apple accounts.
-- OAuth credentials are encrypted by the API before they reach PostgreSQL.

ALTER TABLE public.user_policy_acceptance_events
DROP CONSTRAINT IF EXISTS user_policy_acceptance_events_source_check;

ALTER TABLE public.user_policy_acceptance_events
ADD CONSTRAINT user_policy_acceptance_events_source_check
CHECK (source IN ('MOBILE_LOGIN','MOBILE_RECONSENT','WEB_ACCOUNT_DELETION','UGC_OPERATION'));

CREATE TABLE public.apple_auth_credentials (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE RESTRICT,
  credential_kind text NOT NULL CHECK (credential_kind = 'REFRESH_TOKEN'),
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 16 AND 16384),
  nonce bytea NOT NULL CHECK (octet_length(nonce) = 12),
  auth_tag bytea NOT NULL CHECK (octet_length(auth_tag) = 16),
  key_version integer NOT NULL CHECK (key_version BETWEEN 1 AND 2147483647),
  captured_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER apple_auth_credentials_set_updated_at
BEFORE UPDATE ON public.apple_auth_credentials
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.apple_auth_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.apple_auth_credentials FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.apple_auth_credentials TO dabboba_runtime;
GRANT SELECT, DELETE ON TABLE public.apple_auth_credentials TO dabboba_worker;

ALTER TABLE public.account_auth_deletion_jobs
ADD COLUMN apple_revoked_at timestamptz;

GRANT UPDATE (apple_revoked_at) ON TABLE public.account_auth_deletion_jobs TO dabboba_worker;

COMMENT ON TABLE public.apple_auth_credentials IS
  'AES-256-GCM encrypted Apple OAuth refresh token used only for account-deletion token revocation.';
COMMENT ON COLUMN public.account_auth_deletion_jobs.apple_revoked_at IS
  'Set only after Apple returns HTTP 200 from its OAuth token revocation endpoint.';
