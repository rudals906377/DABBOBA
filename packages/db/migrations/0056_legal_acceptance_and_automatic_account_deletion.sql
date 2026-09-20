-- Published policy evidence and fail-safe automated account deletion.
--
-- Account deletion deliberately keeps local identity and PII intact until the
-- server-only worker has confirmed Supabase Auth deletion (HTTP 2xx or 404).
-- This lets a transient provider failure be retried without orphaning the
-- external identity or falsely reporting completion.

CREATE TABLE public.legal_document_versions (
  policy_key text NOT NULL CHECK (policy_key IN ('TERMS','PRIVACY')),
  policy_version text NOT NULL CHECK (policy_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  content_sha256 char(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  public_url text NOT NULL CHECK (public_url ~ '^https://dabboba\.com/(terms|privacy)$'),
  effective_at timestamptz NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (policy_key, policy_version),
  CHECK (superseded_at IS NULL OR superseded_at >= effective_at)
);

CREATE UNIQUE INDEX legal_document_versions_current_idx
ON public.legal_document_versions (policy_key)
WHERE superseded_at IS NULL;

INSERT INTO public.legal_document_versions
  (policy_key,policy_version,content_sha256,public_url,effective_at)
VALUES
  ('TERMS','2026-09-14','b361aa6cb69241b3a857b7d98f67ced24e3bc77fa35cbbf3f78385bc668c3fea',
   'https://dabboba.com/terms','2026-09-14T00:00:00+09:00'),
  ('PRIVACY','2026-09-20','fc528ea5dd54eb11120852ae3b47f50852ffc91bb94927fe31aa8dc384b485e4',
   'https://dabboba.com/privacy','2026-09-20T00:00:00+09:00');

CREATE FUNCTION public.guard_legal_document_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'published legal document versions cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.policy_key IS DISTINCT FROM OLD.policy_key
     OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
     OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256
     OR NEW.public_url IS DISTINCT FROM OLD.public_url
     OR NEW.effective_at IS DISTINCT FROM OLD.effective_at
     OR NEW.published_at IS DISTINCT FROM OLD.published_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR OLD.superseded_at IS NOT NULL
     OR NEW.superseded_at IS NULL THEN
    RAISE EXCEPTION 'published legal document evidence is immutable; only first supersession is allowed'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER legal_document_versions_immutable
BEFORE UPDATE OR DELETE ON public.legal_document_versions
FOR EACH ROW EXECUTE FUNCTION public.guard_legal_document_version_mutation();

CREATE TABLE public.user_policy_acceptance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  policy_key text NOT NULL,
  policy_version text NOT NULL,
  content_sha256 char(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  source text NOT NULL CHECK (source IN ('MOBILE_LOGIN','WEB_ACCOUNT_DELETION')),
  correlation_id text NOT NULL CHECK (char_length(correlation_id) BETWEEN 1 AND 200),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (policy_key,policy_version)
    REFERENCES public.legal_document_versions(policy_key,policy_version) ON DELETE RESTRICT
);

CREATE INDEX user_policy_acceptance_events_user_idx
ON public.user_policy_acceptance_events (user_id,accepted_at DESC,id DESC);

CREATE UNIQUE INDEX user_policy_acceptance_events_document_once_idx
ON public.user_policy_acceptance_events (user_id,policy_key,policy_version);

CREATE TRIGGER user_policy_acceptance_events_immutable
BEFORE UPDATE OR DELETE ON public.user_policy_acceptance_events
FOR EACH ROW EXECUTE FUNCTION public.reject_row_mutation();

ALTER TABLE public.legal_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_policy_acceptance_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.legal_document_versions, public.user_policy_acceptance_events
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.legal_document_versions TO dabboba_runtime;
GRANT SELECT, INSERT ON TABLE public.user_policy_acceptance_events TO dabboba_runtime;

ALTER TABLE public.account_deletion_requests
  ADD COLUMN status_token_digest char(64),
  ADD COLUMN processing_started_at timestamptz;

ALTER TABLE public.account_deletion_requests
  ADD CONSTRAINT account_deletion_requests_status_token_digest_check
  CHECK (status_token_digest IS NULL OR status_token_digest ~ '^[0-9a-f]{64}$') NOT VALID;
ALTER TABLE public.account_deletion_requests
  VALIDATE CONSTRAINT account_deletion_requests_status_token_digest_check;

ALTER TABLE public.account_deletion_requests
  DROP CONSTRAINT IF EXISTS account_deletion_requests_status_check;
ALTER TABLE public.account_deletion_requests
  ADD CONSTRAINT account_deletion_requests_status_check
  CHECK (status IN ('PENDING_REVIEW','BLOCKED','PROCESSING','APPROVED','COMPLETED','REJECTED','CANCELLED'))
  NOT VALID;
ALTER TABLE public.account_deletion_requests
  VALIDATE CONSTRAINT account_deletion_requests_status_check;

ALTER TABLE public.account_deletion_request_events
  DROP CONSTRAINT IF EXISTS account_deletion_request_events_status_check;
ALTER TABLE public.account_deletion_request_events
  ADD CONSTRAINT account_deletion_request_events_status_check
  CHECK (status IN ('PENDING_REVIEW','BLOCKED','PROCESSING','APPROVED','COMPLETED','REJECTED','CANCELLED'))
  NOT VALID;
ALTER TABLE public.account_deletion_request_events
  VALIDATE CONSTRAINT account_deletion_request_events_status_check;

DROP INDEX IF EXISTS public.account_deletion_requests_one_open_idx;
CREATE UNIQUE INDEX account_deletion_requests_one_open_idx
ON public.account_deletion_requests (user_id)
WHERE status IN ('PENDING_REVIEW','BLOCKED','PROCESSING','APPROVED');

ALTER TABLE public.account_deletion_requests
  DROP CONSTRAINT IF EXISTS account_deletion_requests_admin_decision_check;
ALTER TABLE public.account_deletion_requests
  ADD CONSTRAINT account_deletion_requests_admin_decision_check
  CHECK (
    status NOT IN ('APPROVED','REJECTED','COMPLETED')
    OR (
      status = 'COMPLETED'
      AND decided_at IS NOT NULL
      AND decided_by_admin_id IS NULL
      AND decision_reason = 'AUTOMATED_ACCOUNT_DELETION'
    )
    OR (
      decided_at IS NOT NULL
      AND decided_by_admin_id IS NOT NULL
      AND decision_reason IS NOT NULL
      AND char_length(decision_reason) BETWEEN 2 AND 1000
    )
  ) NOT VALID;
ALTER TABLE public.account_deletion_requests
  VALIDATE CONSTRAINT account_deletion_requests_admin_decision_check;

ALTER TABLE public.account_deletion_request_events
  DROP CONSTRAINT IF EXISTS account_deletion_request_events_admin_decision_check;
ALTER TABLE public.account_deletion_request_events
  ADD CONSTRAINT account_deletion_request_events_admin_decision_check
  CHECK (
    event_type <> 'STATUS_CHANGED'
    OR (
      admin_actor_id IS NOT NULL
      AND reason IS NOT NULL
      AND char_length(reason) BETWEEN 2 AND 1000
    )
    OR (
      admin_actor_id IS NULL
      AND reason = 'AUTOMATED_ACCOUNT_DELETION'
    )
  ) NOT VALID;
ALTER TABLE public.account_deletion_request_events
  VALIDATE CONSTRAINT account_deletion_request_events_admin_decision_check;

CREATE OR REPLACE FUNCTION public.enforce_account_deletion_request_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'PENDING_REVIEW' AND NEW.status IN ('BLOCKED','PROCESSING','APPROVED','REJECTED','CANCELLED'))
    OR (OLD.status = 'BLOCKED' AND NEW.status IN ('PENDING_REVIEW','PROCESSING','APPROVED','REJECTED','CANCELLED'))
    OR (OLD.status = 'PROCESSING' AND NEW.status IN ('BLOCKED','COMPLETED'))
    OR (OLD.status = 'APPROVED' AND NEW.status IN ('PROCESSING','COMPLETED'))
  ) THEN
    RAISE EXCEPTION 'Invalid account deletion request transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_approved_account_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('account-mutation:' || NEW.actor_id::text, 0)
  );

  IF EXISTS (
    SELECT 1
      FROM public.account_deletion_requests
     WHERE user_id = NEW.actor_id
       AND status IN ('PROCESSING','APPROVED')
  ) THEN
    RAISE EXCEPTION 'processing account deletion blocks new mutations'
      USING ERRCODE = '23514',
            CONSTRAINT = 'account_deletion_approved_mutation_guard';
  END IF;

  RETURN NEW;
END;
$$;

ALTER TABLE public.account_auth_deletion_jobs
  ALTER COLUMN supabase_user_id DROP NOT NULL;
ALTER TABLE public.account_auth_deletion_jobs
  ADD COLUMN external_deleted_at timestamptz;

GRANT SELECT, UPDATE (status,blocker_snapshot,request_count,last_requested_at,
  decided_at,completed_at,decision_reason,decided_by_admin_id,version,auth_deletion_status,auth_deleted_at,
  status_token_digest,processing_started_at)
ON TABLE public.account_deletion_requests TO dabboba_worker;
GRANT INSERT ON TABLE public.account_deletion_request_events TO dabboba_worker;
GRANT SELECT, UPDATE (email,phone_e164,nickname,status,deleted_at,suspended_until,suspension_reason)
ON TABLE public.users TO dabboba_worker;
GRANT SELECT, UPDATE (bio,favorite_ip_id,birth_date,version)
ON TABLE public.user_profiles TO dabboba_worker;
GRANT SELECT, UPDATE (revoked_at,revoke_reason,ip_address,user_agent)
ON TABLE public.sessions TO dabboba_worker;
GRANT SELECT, DELETE ON TABLE public.auth_identities TO dabboba_worker;
GRANT SELECT, DELETE ON TABLE public.default_shipping_addresses TO dabboba_worker;
GRANT SELECT, DELETE ON TABLE public.wishlist_items TO dabboba_worker;
GRANT SELECT, DELETE ON TABLE public.community_post_likes TO dabboba_worker;
GRANT SELECT, DELETE ON TABLE public.wanted_request_likes TO dabboba_worker;
GRANT SELECT, DELETE ON TABLE public.user_blocks TO dabboba_worker;
GRANT SELECT, DELETE ON TABLE public.notifications TO dabboba_worker;
GRANT SELECT, DELETE ON TABLE public.notification_preferences TO dabboba_worker;
GRANT SELECT, DELETE ON TABLE public.community_post_media TO dabboba_worker;
GRANT SELECT, DELETE ON TABLE public.inquiry_message_media TO dabboba_worker;
GRANT SELECT, UPDATE (title) ON TABLE public.inquiries TO dabboba_worker;
GRANT SELECT, UPDATE (content) ON TABLE public.inquiry_messages TO dabboba_worker;
GRANT SELECT, UPDATE (status,ip_name_ko,desired_item,details,media_id,version)
ON TABLE public.wanted_requests TO dabboba_worker;
GRANT SELECT, UPDATE (status,content,hidden_reason,deleted_at)
ON TABLE public.community_comments TO dabboba_worker;
GRANT SELECT, UPDATE (status,title,content,hidden_reason,deleted_at,version)
ON TABLE public.community_posts TO dabboba_worker;
GRANT SELECT, UPDATE (status,metadata) ON TABLE public.media_assets TO dabboba_worker;
GRANT SELECT, UPDATE (details) ON TABLE public.content_reports TO dabboba_worker;
GRANT SELECT, UPDATE (ip_address,user_agent) ON TABLE public.user_policy_acceptances TO dabboba_worker;
GRANT SELECT ON TABLE public.draw_entitlements, public.inventory_units,
  public.exchange_listings, public.exchange_offers TO dabboba_worker;

COMMENT ON TABLE public.legal_document_versions IS
  'Canonical published legal document versions and immutable content digests used by API and clients.';
COMMENT ON TABLE public.user_policy_acceptance_events IS
  'Append-only evidence of explicit policy acceptance. It intentionally stores no raw IP address or user-agent.';
COMMENT ON COLUMN public.account_deletion_requests.status_token_digest IS
  'SHA-256 digest of the one-time receipt token used to read deletion status after all sessions are revoked.';
