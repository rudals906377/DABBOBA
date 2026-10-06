-- Persist the order's selected PG channel, never a mutable global channel choice.
ALTER TABLE public.payments ADD COLUMN portone_channel_binding jsonb;
ALTER TABLE public.payments ADD CONSTRAINT payments_portone_binding_check CHECK (
  (portone_channel_binding IS NULL AND provider <> 'PORTONE_V2_KCP') OR
  (portone_channel_binding IS NOT NULL
   AND jsonb_typeof(portone_channel_binding) = 'object'
   AND provider IN ('PORTONE_V2_INICIS','PORTONE_V2_KCP')
   AND portone_channel_binding->>'provider' = provider
   AND portone_channel_binding->>'pgProvider' = CASE provider WHEN 'PORTONE_V2_INICIS' THEN 'INICIS_V2' ELSE 'KCP_V2' END
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
CREATE FUNCTION public.preserve_payment_card_channel() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.provider IS DISTINCT FROM OLD.provider OR NEW.portone_channel_binding IS DISTINCT FROM OLD.portone_channel_binding THEN
    RAISE EXCEPTION 'Payment provider and card channel binding are immutable';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.preserve_payment_card_channel() FROM PUBLIC;
CREATE TRIGGER payments_preserve_card_channel BEFORE UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.preserve_payment_card_channel();
CREATE INDEX payments_kcp_claimed_cancelled_reconciliation_idx ON public.payments(updated_at,id)
WHERE status='CANCELLED' AND provider='PORTONE_V2_KCP' AND pg_attempt_started_at IS NOT NULL;
