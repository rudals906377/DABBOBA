-- Add the separately accepted UGC operations policy to the canonical,
-- append-only legal evidence framework introduced in migration 0056.

ALTER TABLE public.legal_document_versions
DROP CONSTRAINT IF EXISTS legal_document_versions_policy_key_check;

ALTER TABLE public.legal_document_versions
ADD CONSTRAINT legal_document_versions_policy_key_check
CHECK (policy_key IN ('TERMS','PRIVACY','OPERATIONS'));

ALTER TABLE public.legal_document_versions
DROP CONSTRAINT IF EXISTS legal_document_versions_public_url_check;

ALTER TABLE public.legal_document_versions
ADD CONSTRAINT legal_document_versions_public_url_check
CHECK (
  (policy_key = 'TERMS' AND public_url = 'https://dabboba.com/terms')
  OR (policy_key = 'PRIVACY' AND public_url = 'https://dabboba.com/privacy')
  OR (policy_key = 'OPERATIONS' AND public_url = 'https://dabboba.com/community-operations')
);

ALTER TABLE public.user_policy_acceptance_events
DROP CONSTRAINT IF EXISTS user_policy_acceptance_events_source_check;

ALTER TABLE public.user_policy_acceptance_events
ADD CONSTRAINT user_policy_acceptance_events_source_check
CHECK (source IN ('MOBILE_LOGIN','WEB_ACCOUNT_DELETION','UGC_OPERATION'));

INSERT INTO public.legal_document_versions
  (policy_key,policy_version,content_sha256,public_url,effective_at)
VALUES
  ('OPERATIONS','2026-09-20','0f489584d8039f6754463956ab154e0f52cc24d401e23c583d7c69ae83b0a848',
   'https://dabboba.com/community-operations','2026-09-20T00:00:00+09:00');

COMMENT ON CONSTRAINT legal_document_versions_policy_key_check ON public.legal_document_versions IS
  'OPERATIONS is separately accepted before the first community, exchange, or wanted-room creation.';
