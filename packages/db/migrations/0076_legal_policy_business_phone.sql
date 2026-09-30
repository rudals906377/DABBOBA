-- Publish the TERMS and PRIVACY revision that corrects the business
-- representative phone to the registered landline (031-947-9996), matching
-- the in-app business information. Public policy HTML is bound to
-- legal_document_versions by content_sha256, so a content change is a new
-- policy version: the 2026-09-22 rows stay as immutable history and every
-- customer sees exactly one re-consent after this version becomes effective.
-- OPERATIONS is unchanged and keeps its 2026-09-22 version.

DO $$
BEGIN
  IF (
    SELECT count(*)
      FROM public.legal_document_versions
     WHERE superseded_at IS NULL
       AND (
         (policy_key = 'TERMS'
          AND policy_version = '2026-09-22'
          AND content_sha256 = '48b0950d22e7d2716b1824bfa895ed70d86c8ef35e9acbf6778025965b4b9ec6'
          AND public_url = 'https://dabboba.net/terms')
         OR
         (policy_key = 'PRIVACY'
          AND policy_version = '2026-09-22'
          AND content_sha256 = '6c1067c30ca2fd55628f0c443975fbfc243537d1e5c99217011e1d5714d88739'
          AND public_url = 'https://dabboba.net/privacy')
       )
  ) <> 2 THEN
    RAISE EXCEPTION 'Unexpected current TERMS/PRIVACY evidence before business phone revision'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

UPDATE public.legal_document_versions
   SET superseded_at = '2026-09-30T00:00:00+09:00'
 WHERE superseded_at IS NULL
   AND (
     (policy_key = 'TERMS' AND policy_version = '2026-09-22')
     OR (policy_key = 'PRIVACY' AND policy_version = '2026-09-22')
   );

INSERT INTO public.legal_document_versions
  (policy_key,policy_version,content_sha256,public_url,effective_at)
VALUES
  ('TERMS','2026-09-30','213e14a2499ed6a929c81455e736b5aa3d60f0e05f0d59fe5d9fc662e0782f23',
   'https://dabboba.net/terms','2026-09-30T00:00:00+09:00'),
  ('PRIVACY','2026-09-30','6053eb3dd4c02cfe44fb30983910f4a9d7bade3a1f03d8f58a00a490119e89dd',
   'https://dabboba.net/privacy','2026-09-30T00:00:00+09:00');
