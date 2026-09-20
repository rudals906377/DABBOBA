-- Release account controls: durable login-policy evidence and eventual deletion
-- of the corresponding Supabase Auth user. Customer clients never receive
-- access to either table.

CREATE TABLE user_policy_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  policy_key text NOT NULL CHECK (policy_key IN ('TERMS','PRIVACY')),
  policy_version text NOT NULL CHECK (policy_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('MOBILE_LOGIN')),
  ip_address inet,
  user_agent text CHECK (user_agent IS NULL OR length(user_agent) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, policy_key, policy_version)
);

CREATE INDEX user_policy_acceptances_user_idx
ON user_policy_acceptances (user_id, accepted_at DESC, id DESC);

ALTER TABLE user_policy_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE user_policy_acceptances FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE user_policy_acceptances TO dabboba_runtime;
GRANT UPDATE (ip_address, user_agent) ON TABLE user_policy_acceptances TO dabboba_runtime;

ALTER TABLE account_deletion_requests
ADD COLUMN auth_deletion_status text NOT NULL DEFAULT 'NOT_REQUIRED'
  CHECK (auth_deletion_status IN ('NOT_REQUIRED','PENDING','COMPLETED')),
ADD COLUMN auth_deleted_at timestamptz;

ALTER TABLE account_deletion_requests
ADD CONSTRAINT account_deletion_requests_auth_deletion_state
CHECK (
  (auth_deletion_status = 'COMPLETED' AND auth_deleted_at IS NOT NULL)
  OR (auth_deletion_status <> 'COMPLETED' AND auth_deleted_at IS NULL)
) NOT VALID;

ALTER TABLE account_deletion_requests
VALIDATE CONSTRAINT account_deletion_requests_auth_deletion_state;

CREATE TABLE account_auth_deletion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deletion_request_id uuid NOT NULL UNIQUE REFERENCES account_deletion_requests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  supabase_user_id uuid NOT NULL,
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

CREATE INDEX account_auth_deletion_jobs_ready_idx
ON account_auth_deletion_jobs (available_at, created_at, id);

ALTER TABLE account_auth_deletion_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE account_auth_deletion_jobs FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT ON TABLE account_auth_deletion_jobs TO dabboba_runtime;
GRANT SELECT, UPDATE, DELETE ON TABLE account_auth_deletion_jobs TO dabboba_worker;
GRANT UPDATE (auth_deletion_status, auth_deleted_at) ON TABLE account_deletion_requests TO dabboba_worker;

COMMENT ON TABLE user_policy_acceptances IS
  'Immutable evidence of the exact required policy versions accepted during customer login.';
COMMENT ON TABLE account_auth_deletion_jobs IS
  'Server-only transient queue. The Supabase user identifier is deleted with the row after Auth deletion succeeds.';
