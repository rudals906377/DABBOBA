-- Provider cancellation is an irreversible external action. Keep one durable
-- attempt per payment so a timeout, process crash, or repeated admin click
-- cannot issue a second cancellation without a separate reconciliation.
INSERT INTO admin_permissions (code, description) VALUES
  ('refunds.cancel', 'Request one full PortOne refund for an unfulfilled late payment')
ON CONFLICT DO NOTHING;

INSERT INTO admin_role_permissions (role, permission_code)
VALUES ('SUPER_ADMIN', 'refunds.cancel')
ON CONFLICT DO NOTHING;

CREATE TABLE public.portone_refund_cancellation_attempts (
  payment_id uuid PRIMARY KEY REFERENCES public.payments(id) ON DELETE RESTRICT,
  admin_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  idempotency_key varchar(200) NOT NULL,
  request_hash char(64) NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 2 AND 500),
  status text NOT NULL DEFAULT 'PRECHECK'
    CHECK (status IN ('PRECHECK','PRECHECK_FAILED','CALLING','PROVIDER_PENDING','INDETERMINATE','RECONCILED','REVIEW_REQUIRED')),
  provider_cancellation_id varchar(200),
  provider_status varchar(40),
  last_error_code varchar(80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER portone_refund_cancellation_attempts_set_updated_at
BEFORE UPDATE ON public.portone_refund_cancellation_attempts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

REVOKE ALL ON TABLE public.portone_refund_cancellation_attempts FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.portone_refund_cancellation_attempts FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.portone_refund_cancellation_attempts FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON TABLE public.portone_refund_cancellation_attempts FROM service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dabboba_worker') THEN
    REVOKE ALL ON TABLE public.portone_refund_cancellation_attempts FROM dabboba_worker;
  END IF;
END
$$;
GRANT SELECT, INSERT, UPDATE ON TABLE public.portone_refund_cancellation_attempts TO dabboba_runtime;
ALTER TABLE public.portone_refund_cancellation_attempts ENABLE ROW LEVEL SECURITY;
