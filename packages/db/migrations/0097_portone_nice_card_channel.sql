-- Add the NICE V2 rail without rewriting historical providers/channel bindings.
ALTER TABLE public.payments DROP CONSTRAINT payments_portone_binding_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_portone_binding_check CHECK (
  (portone_channel_binding IS NULL AND provider NOT IN ('PORTONE_V2_KCP','PORTONE_V2_NICE')) OR
  (portone_channel_binding IS NOT NULL
   AND jsonb_typeof(portone_channel_binding) = 'object'
   AND provider IN ('PORTONE_V2_INICIS','PORTONE_V2_KCP','PORTONE_V2_NICE')
   AND portone_channel_binding->>'provider' = provider
   AND portone_channel_binding->>'pgProvider' = CASE provider
     WHEN 'PORTONE_V2_INICIS' THEN 'INICIS_V2'
     WHEN 'PORTONE_V2_KCP' THEN 'KCP_V2' ELSE 'NICE_V2' END
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
CREATE INDEX payments_nice_claimed_cancelled_reconciliation_idx ON public.payments(updated_at,id)
WHERE status='CANCELLED' AND provider='PORTONE_V2_NICE' AND pg_attempt_started_at IS NOT NULL;
