-- Move the canonical public policy origin to dabboba.net without rewriting
-- previously published evidence. The former .com rows remain immutable history;
-- the new domain is published as a new policy version and therefore requires
-- one fresh acceptance after it becomes effective.

DO $$
BEGIN
  IF (
    SELECT count(*)
      FROM public.legal_document_versions
     WHERE superseded_at IS NULL
       AND (
         (policy_key = 'TERMS'
          AND policy_version = '2026-09-14'
          AND content_sha256 = 'b361aa6cb69241b3a857b7d98f67ced24e3bc77fa35cbbf3f78385bc668c3fea'
          AND public_url = 'https://dabboba.com/terms')
         OR
         (policy_key = 'PRIVACY'
          AND policy_version = '2026-09-20'
          AND content_sha256 = 'fc528ea5dd54eb11120852ae3b47f50852ffc91bb94927fe31aa8dc384b485e4'
          AND public_url = 'https://dabboba.com/privacy')
         OR
         (policy_key = 'OPERATIONS'
          AND policy_version = '2026-09-20'
          AND content_sha256 = '0f489584d8039f6754463956ab154e0f52cc24d401e23c583d7c69ae83b0a848'
          AND public_url = 'https://dabboba.com/community-operations')
       )
  ) <> 3 THEN
    RAISE EXCEPTION 'Unexpected current policy evidence before dabboba.net publication'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

ALTER TABLE public.legal_document_versions
DROP CONSTRAINT IF EXISTS legal_document_versions_public_url_check;

ALTER TABLE public.legal_document_versions
ADD CONSTRAINT legal_document_versions_public_url_check
CHECK (
  (policy_key = 'TERMS' AND public_url IN (
    'https://dabboba.com/terms',
    'https://dabboba.net/terms'
  ))
  OR (policy_key = 'PRIVACY' AND public_url IN (
    'https://dabboba.com/privacy',
    'https://dabboba.net/privacy'
  ))
  OR (policy_key = 'OPERATIONS' AND public_url IN (
    'https://dabboba.com/community-operations',
    'https://dabboba.net/community-operations'
  ))
);

UPDATE public.legal_document_versions
   SET superseded_at = '2026-09-22T00:00:00+09:00'
 WHERE superseded_at IS NULL
   AND (
     (policy_key = 'TERMS' AND policy_version = '2026-09-14')
     OR (policy_key = 'PRIVACY' AND policy_version = '2026-09-20')
     OR (policy_key = 'OPERATIONS' AND policy_version = '2026-09-20')
   );

INSERT INTO public.legal_document_versions
  (policy_key,policy_version,content_sha256,public_url,effective_at)
VALUES
  ('TERMS','2026-09-22','fc59d9bb090dd11474fdee337662a1d227ef98004337dcb5e3bed22269d418a0',
   'https://dabboba.net/terms','2026-09-22T00:00:00+09:00'),
  ('PRIVACY','2026-09-22','0c668094006c6eee3a73d2d8cdb51838abf53f9e0dba6884f47f8c67cd6c3863',
   'https://dabboba.net/privacy','2026-09-22T00:00:00+09:00'),
  ('OPERATIONS','2026-09-22','95d97d5d00a55d553ee8bb6a1a99ae43325880ee5c9ef56356cc29ab5dfd23cf',
   'https://dabboba.net/community-operations','2026-09-22T00:00:00+09:00');

COMMENT ON CONSTRAINT legal_document_versions_public_url_check ON public.legal_document_versions IS
  'Historical dabboba.com evidence is retained while current policy documents use dabboba.net.';
