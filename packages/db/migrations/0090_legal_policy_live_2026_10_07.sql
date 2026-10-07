-- Publish the LIVE (2026-10-07) TERMS and PRIVACY revision: the sales terms
-- (gacha purchase, draw odds disclosure, storage, shipping fee, point return,
-- refunds and withdrawal) and the privacy policy that names the processors,
-- the Seoul storage region, the 3-month session-record retention and the
-- removal of the personalized-recommendation consent. Public policy HTML is
-- bound to legal_document_versions by content_sha256, so a content change is
-- a new policy version: the 2026-09-30 rows stay as immutable history and
-- every customer sees exactly one re-consent after this version becomes
-- effective. OPERATIONS is unchanged and keeps its 2026-09-22 version.
--
-- Apply only after the matching HTML is live at https://dabboba.net/terms and
-- https://dabboba.net/privacy (docs/live-cutover-runbook.md, 법적 문서 게시).

DO $$
BEGIN
  IF (
    SELECT count(*)
      FROM public.legal_document_versions
     WHERE superseded_at IS NULL
       AND (
         (policy_key = 'TERMS'
          AND policy_version = '2026-09-30'
          AND content_sha256 = '213e14a2499ed6a929c81455e736b5aa3d60f0e05f0d59fe5d9fc662e0782f23'
          AND public_url = 'https://dabboba.net/terms')
         OR
         (policy_key = 'PRIVACY'
          AND policy_version = '2026-09-30'
          AND content_sha256 = '6053eb3dd4c02cfe44fb30983910f4a9d7bade3a1f03d8f58a00a490119e89dd'
          AND public_url = 'https://dabboba.net/privacy')
       )
  ) <> 2 THEN
    RAISE EXCEPTION 'Unexpected current TERMS/PRIVACY evidence before the LIVE 2026-10-07 revision'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

UPDATE public.legal_document_versions
   SET superseded_at = '2026-10-07T00:00:00+09:00'
 WHERE superseded_at IS NULL
   AND (
     (policy_key = 'TERMS' AND policy_version = '2026-09-30')
     OR (policy_key = 'PRIVACY' AND policy_version = '2026-09-30')
   );

INSERT INTO public.legal_document_versions
  (policy_key,policy_version,content_sha256,public_url,effective_at)
VALUES
  ('TERMS','2026-10-07','54e45f9237ea45f6063337976a3ce6beee14fa898916c9bfb59fa814ac7b52d2',
   'https://dabboba.net/terms','2026-10-07T00:00:00+09:00'),
  ('PRIVACY','2026-10-07','a7684326c9d246a7bc2f649c33cc623e7e0eb6f06fb0683decd014c6e501ae06',
   'https://dabboba.net/privacy','2026-10-07T00:00:00+09:00');
