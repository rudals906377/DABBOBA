-- Prepared only: publish the matching HTML and deploy 0093 + the worker before
-- enabling expiry. No worker/Cron switch is changed here. Preserve historical
-- policy evidence and require re-consent; old inventory is never backfilled.
DO $$
BEGIN
  IF (SELECT count(*) FROM public.legal_document_versions
       WHERE superseded_at IS NULL AND policy_version='2026-10-07'
         AND ((policy_key='TERMS' AND content_sha256='54e45f9237ea45f6063337976a3ce6beee14fa898916c9bfb59fa814ac7b52d2')
           OR (policy_key='PRIVACY' AND content_sha256='a7684326c9d246a7bc2f649c33cc623e7e0eb6f06fb0683decd014c6e501ae06')))<>2 THEN
    RAISE EXCEPTION 'Unexpected current policy evidence before storage revision' USING ERRCODE='55000';
  END IF;
END;
$$;
UPDATE public.legal_document_versions SET superseded_at='2026-10-12T00:00:00+09:00'
 WHERE superseded_at IS NULL AND policy_key IN ('TERMS','PRIVACY') AND policy_version='2026-10-07';
INSERT INTO public.legal_document_versions(policy_key,policy_version,content_sha256,public_url,effective_at)
VALUES
 ('TERMS','2026-10-12','9a9d1a03e71b9cef647754efcab39b3908a8b28d9b42c3a4823dc42e3e2afbbe','https://dabboba.net/terms','2026-10-12T00:00:00+09:00'),
 ('PRIVACY','2026-10-12','fbfaafefe7a20476955768de27b53ce67f8eeb5500d977d85ba0ef747eec814c','https://dabboba.net/privacy','2026-10-12T00:00:00+09:00');
