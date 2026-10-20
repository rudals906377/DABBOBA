-- Direct Toss TEST review only. Durable intent must commit before any confirm
-- call, so an uncertain network response can never be mistaken for no charge.
CREATE TABLE public.toss_review_confirm_attempts (
 payment_id uuid PRIMARY KEY REFERENCES public.payments(id) ON DELETE RESTRICT,
 payment_key text NOT NULL UNIQUE CHECK (length(payment_key) BETWEEN 6 AND 200),
 merchant_id text NOT NULL CHECK (length(merchant_id) BETWEEN 1 AND 100),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.toss_review_confirm_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.toss_review_confirm_attempts FROM PUBLIC, anon, authenticated, dabboba_runtime, dabboba_worker;
GRANT SELECT, INSERT ON TABLE public.toss_review_confirm_attempts TO dabboba_runtime;
CREATE TRIGGER toss_review_confirm_attempts_immutable BEFORE UPDATE OR DELETE ON public.toss_review_confirm_attempts
 FOR EACH ROW EXECUTE FUNCTION public.reject_row_mutation();
