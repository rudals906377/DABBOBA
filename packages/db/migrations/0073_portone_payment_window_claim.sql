-- One server-owned native PG window claim per payable order. A lost client
-- callback must be reconciled with PortOne instead of opening another window
-- from a different installation using the same paymentId.
ALTER TABLE public.payments
ADD COLUMN pg_attempt_started_at timestamptz;

COMMENT ON COLUMN public.payments.pg_attempt_started_at IS
  'First authenticated PortOne SDK window claim. Never clear without a separately verified provider/payment transition.';
