-- Record a verified API recovery separately from manual review. The worker's
-- existing reservation-expiry writes are constrained by the next migration;
-- it must not synthesize a successful payment from a provider observation.
ALTER TABLE public.worker_payment_reconciliations
  DROP CONSTRAINT worker_payment_reconciliations_last_outcome_check;
ALTER TABLE public.worker_payment_reconciliations
  ADD CONSTRAINT worker_payment_reconciliations_last_outcome_check
  CHECK (last_outcome IN ('UNKNOWN','MANUAL_REVIEW','RECONCILED','ERROR'));
