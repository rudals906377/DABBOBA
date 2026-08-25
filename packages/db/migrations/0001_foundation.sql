CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION reject_row_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  nickname varchar(40) NOT NULL,
  role text NOT NULL DEFAULT 'USER' CHECK (role IN ('USER','ADMIN','SUPER_ADMIN')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','BANNED','DELETED')),
  suspended_until timestamptz,
  suspension_reason text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'DELETED') = (deleted_at IS NOT NULL))
);

CREATE INDEX users_nickname_trgm_idx ON users USING gin (nickname gin_trgm_ops);
CREATE INDEX users_created_cursor_idx ON users (created_at DESC, id DESC);
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE auth_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('PHONE','GOOGLE','KAKAO','LOCAL_ADMIN','DEV')),
  provider_subject text NOT NULL,
  verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subject)
);
CREATE INDEX auth_identities_user_idx ON auth_identities (user_id);

CREATE TABLE admin_credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  password_hash text NOT NULL,
  password_salt text NOT NULL,
  scrypt_cost integer NOT NULL,
  scrypt_block_size integer NOT NULL,
  scrypt_parallelization integer NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER admin_credentials_set_updated_at BEFORE UPDATE ON admin_credentials
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  session_kind text NOT NULL CHECK (session_kind IN ('USER','ADMIN')),
  token_digest text NOT NULL UNIQUE,
  ip_address inet,
  user_agent varchar(500),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX sessions_active_token_idx ON sessions (token_digest) WHERE revoked_at IS NULL;
CREATE INDEX sessions_user_idx ON sessions (user_id, created_at DESC);

CREATE TABLE admin_login_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  attempted_email_hash text NOT NULL,
  succeeded boolean NOT NULL,
  failure_code text,
  ip_address inet,
  user_agent varchar(500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_login_events_email_time_idx ON admin_login_events (attempted_email_hash, created_at DESC);
CREATE TRIGGER admin_login_events_immutable
BEFORE UPDATE OR DELETE ON admin_login_events
FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

CREATE TABLE admin_permissions (
  code text PRIMARY KEY,
  description text NOT NULL
);

CREATE TABLE admin_role_permissions (
  role text NOT NULL CHECK (role IN ('ADMIN','SUPER_ADMIN')),
  permission_code text NOT NULL REFERENCES admin_permissions(code) ON DELETE RESTRICT,
  PRIMARY KEY (role, permission_code)
);

INSERT INTO admin_permissions (code, description) VALUES
  ('dashboard.read', 'Read operational dashboard'),
  ('notices.read', 'Read notices'),
  ('notices.write', 'Create and edit notices'),
  ('inquiries.read', 'Read user inquiries'),
  ('inquiries.reply', 'Reply to user inquiries'),
  ('moderation.read', 'Read moderated content'),
  ('moderation.action', 'Hide, restore, or soft-delete content'),
  ('reports.read', 'Read reports'),
  ('reports.resolve', 'Resolve reports'),
  ('users.read', 'Read minimized user profiles'),
  ('users.suspend', 'Suspend and reactivate users'),
  ('catalog.read', 'Read inactive catalog records'),
  ('catalog.write', 'Create and edit catalog records'),
  ('audit.read', 'Read admin audit logs'),
  ('roles.manage', 'Manage administrator accounts and roles')
ON CONFLICT DO NOTHING;

INSERT INTO admin_role_permissions (role, permission_code)
SELECT 'SUPER_ADMIN', code FROM admin_permissions
ON CONFLICT DO NOTHING;

INSERT INTO admin_role_permissions (role, permission_code) VALUES
  ('ADMIN','dashboard.read'), ('ADMIN','notices.read'), ('ADMIN','notices.write'),
  ('ADMIN','inquiries.read'), ('ADMIN','inquiries.reply'), ('ADMIN','moderation.read'),
  ('ADMIN','moderation.action'), ('ADMIN','reports.read'), ('ADMIN','reports.resolve'),
  ('ADMIN','users.read'), ('ADMIN','users.suspend'), ('ADMIN','catalog.read'),
  ('ADMIN','catalog.write'), ('ADMIN','audit.read')
ON CONFLICT DO NOTHING;

CREATE TABLE idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  scope varchar(100) NOT NULL,
  idempotency_key varchar(200) NOT NULL,
  request_hash text NOT NULL,
  state text NOT NULL DEFAULT 'PROCESSING' CHECK (state IN ('PROCESSING','COMPLETED','FAILED')),
  response_status integer,
  response_body jsonb,
  resource_type text,
  resource_id text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_id, scope, idempotency_key)
);
CREATE INDEX idempotency_keys_expiry_idx ON idempotency_keys (expires_at);
CREATE TRIGGER idempotency_keys_set_updated_at BEFORE UPDATE ON idempotency_keys
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action varchar(100) NOT NULL,
  target_type varchar(100) NOT NULL,
  target_id text NOT NULL,
  reason text NOT NULL,
  request_id text NOT NULL,
  idempotency_key varchar(200) NOT NULL,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address inet,
  user_agent varchar(500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_logs_cursor_idx ON admin_audit_logs (created_at DESC, id DESC);
CREATE INDEX admin_audit_logs_target_idx ON admin_audit_logs (target_type, target_id, created_at DESC);
CREATE UNIQUE INDEX admin_audit_logs_idempotency_idx ON admin_audit_logs (admin_id, idempotency_key);
CREATE TRIGGER admin_audit_logs_immutable
BEFORE UPDATE OR DELETE ON admin_audit_logs
FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type varchar(100) NOT NULL,
  aggregate_id text NOT NULL,
  event_type varchar(160) NOT NULL,
  payload jsonb NOT NULL,
  correlation_id text NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_events_pending_idx ON outbox_events (available_at, created_at)
WHERE published_at IS NULL;
