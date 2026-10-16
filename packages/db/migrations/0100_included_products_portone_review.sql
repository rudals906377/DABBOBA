-- Same-day revisions receive an explicit suffix; old dated versions remain valid.
ALTER TABLE public.legal_document_versions DROP CONSTRAINT legal_document_versions_policy_version_check;
ALTER TABLE public.legal_document_versions ADD CONSTRAINT legal_document_versions_policy_version_check CHECK (policy_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(-r[1-9][0-9]*)?$');
ALTER TABLE public.user_policy_acceptances DROP CONSTRAINT user_policy_acceptances_policy_version_check;
ALTER TABLE public.user_policy_acceptances ADD CONSTRAINT user_policy_acceptances_policy_version_check CHECK (policy_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(-r[1-9][0-9]*)?$');

-- New purchases return to published included-product draws. Preserve DIRECT
-- inventory, reservations, historical lines and migration checksums.
UPDATE public.catalog_products SET is_active=false, sale_status='PAUSED', version=version+1
WHERE metadata->>'purchaseMode'='DIRECT' AND (is_active OR sale_status<>'PAUSED');

-- Add the NICE V2 rail without rewriting historical providers/channel bindings.
ALTER TABLE public.payments DROP CONSTRAINT payments_portone_binding_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_portone_binding_check CHECK (
  (portone_channel_binding IS NULL AND provider NOT IN ('PORTONE_V2_KCP','PORTONE_V2_NICE','PORTONE_V2_KICC')) OR
  (portone_channel_binding IS NOT NULL
   AND jsonb_typeof(portone_channel_binding) = 'object'
   AND provider IN ('PORTONE_V2_INICIS','PORTONE_V2_KCP','PORTONE_V2_NICE','PORTONE_V2_KICC')
   AND portone_channel_binding->>'provider' = provider
   AND portone_channel_binding->>'pgProvider' = CASE provider
     WHEN 'PORTONE_V2_INICIS' THEN 'INICIS_V2'
     WHEN 'PORTONE_V2_KCP' THEN 'KCP_V2'
     WHEN 'PORTONE_V2_NICE' THEN 'NICE_V2' ELSE 'KICC_V2' END
   AND portone_channel_binding->>'channelEnvironment' IN ('TEST','LIVE')
   AND COALESCE(length(portone_channel_binding->>'merchantId'),0) BETWEEN 1 AND 200
   AND COALESCE(length(portone_channel_binding->>'storeId'),0) BETWEEN 1 AND 200
   AND COALESCE(length(portone_channel_binding->>'channelKey'),0) BETWEEN 1 AND 200
   AND jsonb_typeof(portone_channel_binding->'provider')='string'
   AND jsonb_typeof(portone_channel_binding->'pgProvider')='string'
   AND jsonb_typeof(portone_channel_binding->'channelEnvironment')='string'
   AND jsonb_typeof(portone_channel_binding->'merchantId')='string'
   AND jsonb_typeof(portone_channel_binding->'storeId')='string'
   AND jsonb_typeof(portone_channel_binding->'channelKey')='string'
   AND portone_channel_binding ?& ARRAY['provider','pgProvider','merchantId','storeId','channelKey','channelEnvironment'])
);

CREATE INDEX payments_kicc_claimed_cancelled_reconciliation_idx ON public.payments(updated_at,id)
WHERE status='CANCELLED' AND provider='PORTONE_V2_KICC' AND pg_attempt_started_at IS NOT NULL;

DO $$ BEGIN
 IF (SELECT count(*) FROM public.legal_document_versions WHERE superseded_at IS NULL AND ((policy_key='TERMS' AND policy_version='2026-10-13' AND content_sha256='b902894e7e0df0e406a990124928d8445be85d70ff586d8fd9495aa5dec66ec6') OR
(policy_key='PRIVACY' AND policy_version='2026-10-13' AND content_sha256='65e228f19fd294c5bbe96b4dae4d892bd56643f38349394b31f643f0172bbca5') OR
(policy_key='OPERATIONS' AND policy_version='2026-10-13' AND content_sha256='8e01d461c592e4a55a0151f456aa848b2160dc65e74a5e142e2babb5634a1a5a'))) <> 3 THEN
 RAISE EXCEPTION 'Unexpected current direct policy evidence before included-product revision' USING ERRCODE='55000';
 END IF;
END $$;
UPDATE public.legal_document_versions SET superseded_at=now() WHERE policy_key IN ('TERMS','PRIVACY','OPERATIONS') AND superseded_at IS NULL;
INSERT INTO public.legal_document_versions(policy_key,policy_version,content_sha256,public_url,effective_at) VALUES
('TERMS','2026-10-13-r2','1db7ee7b7a44120bcc7e5766f52f00f1d1ad0c7d53b16c04ec9ca5308a002fde','https://dabboba.net/terms',now()),
('PRIVACY','2026-10-13-r2','f43207e6a3bc654ec7dcbf81bfcb24d561c8be8b71a6cf40b60b1b9ea64174c4','https://dabboba.net/privacy',now()),
('OPERATIONS','2026-10-13-r2','03b0dd9483d4d0dbcfadd264c387b4eab6fd9e93a8e205700cb68ad27ec3e7fb','https://dabboba.net/community-operations',now());
