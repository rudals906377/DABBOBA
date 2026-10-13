-- Publish and verify matching HTML first. Preserve all historical acceptances.
DO $$ BEGIN
  IF (SELECT count(*) FROM public.legal_document_versions WHERE superseded_at IS NULL AND (
      (policy_key='TERMS' AND policy_version='2026-10-12' AND content_sha256='9a9d1a03e71b9cef647754efcab39b3908a8b28d9b42c3a4823dc42e3e2afbbe') OR
      (policy_key='PRIVACY' AND policy_version='2026-10-12' AND content_sha256='fbfaafefe7a20476955768de27b53ce67f8eeb5500d977d85ba0ef747eec814c') OR
      (policy_key='OPERATIONS' AND policy_version='2026-09-22' AND content_sha256='8c3b1e9d351590a1c978d7d731acf153b6895c5d5c95768f4cc9021b75163792')))<>3 THEN
    RAISE EXCEPTION 'Unexpected current policy evidence before direct purchase revision' USING ERRCODE='55000';
  END IF;
END $$;
UPDATE public.legal_document_versions SET superseded_at='2026-10-13T00:00:00+09:00'
 WHERE policy_key IN ('TERMS','PRIVACY','OPERATIONS') AND superseded_at IS NULL;
INSERT INTO public.legal_document_versions(policy_key,policy_version,content_sha256,public_url,effective_at) VALUES
 ('TERMS','2026-10-13','b902894e7e0df0e406a990124928d8445be85d70ff586d8fd9495aa5dec66ec6','https://dabboba.net/terms','2026-10-13T00:00:00+09:00'),
 ('PRIVACY','2026-10-13','65e228f19fd294c5bbe96b4dae4d892bd56643f38349394b31f643f0172bbca5','https://dabboba.net/privacy','2026-10-13T00:00:00+09:00'),
 ('OPERATIONS','2026-10-13','8e01d461c592e4a55a0151f456aa848b2160dc65e74a5e142e2babb5634a1a5a','https://dabboba.net/community-operations','2026-10-13T00:00:00+09:00');
