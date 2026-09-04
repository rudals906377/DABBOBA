-- Keep reconciliation observations durable and fairly scheduled without
-- changing the payment ledger or its user-visible updated_at timestamp.
CREATE TABLE public.worker_payment_reconciliations (
  payment_id uuid PRIMARY KEY REFERENCES public.payments(id) ON DELETE CASCADE,
  payment_version integer NOT NULL CHECK (payment_version > 0),
  attempts integer NOT NULL CHECK (attempts BETWEEN 1 AND 1000000),
  last_outcome text NOT NULL CHECK (last_outcome IN ('UNKNOWN','MANUAL_REVIEW','ERROR')),
  last_observed_state text CHECK (
    last_observed_state IS NULL
    OR last_observed_state IN ('UNKNOWN','PENDING','AUTHORIZED','PAID','FAILED','CANCELLED','REFUNDED')
  ),
  last_error text CHECK (last_error IS NULL OR octet_length(last_error) <= 4096),
  last_attempted_at timestamptz NOT NULL,
  next_attempt_at timestamptz NOT NULL,
  CHECK (next_attempt_at > last_attempted_at),
  CHECK (
    (last_outcome = 'ERROR' AND last_error IS NOT NULL AND last_observed_state IS NULL)
    OR (last_outcome <> 'ERROR' AND last_error IS NULL AND last_observed_state IS NOT NULL)
  )
);

CREATE INDEX worker_payment_reconciliations_due_idx
ON public.worker_payment_reconciliations (next_attempt_at, payment_id);

CREATE INDEX payments_worker_reconciliation_candidates_idx
ON public.payments (updated_at, id)
WHERE status IN ('PENDING','AUTHORIZED','REFUND_REVIEW');

-- One durable alert removes a reconciliation-only reservation from the sweep
-- without relying on process-local memory or a non-atomic NOT EXISTS check.
-- This event type is introduced by this migration. If an operator populated it
-- early, fail with a targeted diagnostic instead of deleting durable evidence.
DO $$
BEGIN
  IF EXISTS (
    SELECT aggregate_id
      FROM public.outbox_events
     WHERE aggregate_type = 'PAYMENT'
       AND event_type = 'payment.reservation_expired_requires_reconciliation'
     GROUP BY aggregate_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'duplicate payment.reservation_expired_requires_reconciliation outbox events must be reconciled before migration 0032';
  END IF;
END
$$;

CREATE UNIQUE INDEX outbox_worker_reservation_reconciliation_idx
ON public.outbox_events (aggregate_id)
WHERE aggregate_type = 'PAYMENT'
  AND event_type = 'payment.reservation_expired_requires_reconciliation';

ALTER TABLE public.worker_payment_reconciliations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.worker_payment_reconciliations FROM PUBLIC;
REVOKE ALL ON TABLE public.worker_payment_reconciliations FROM dabboba_runtime;

DO $$
DECLARE
  api_role record;
BEGIN
  FOR api_role IN
    SELECT rolname FROM pg_roles
     WHERE rolname IN ('anon','authenticated','service_role')
  LOOP
    EXECUTE format(
      'REVOKE ALL ON TABLE public.worker_payment_reconciliations FROM %I',
      api_role.rolname
    );
  END LOOP;
END
$$;

GRANT SELECT, INSERT, UPDATE
ON TABLE public.worker_payment_reconciliations
TO dabboba_worker;

DO $$
DECLARE
  api_role record;
BEGIN
  IF NOT has_table_privilege('dabboba_worker','public.worker_payment_reconciliations','SELECT')
    OR NOT has_table_privilege('dabboba_worker','public.worker_payment_reconciliations','INSERT')
    OR NOT has_table_privilege('dabboba_worker','public.worker_payment_reconciliations','UPDATE')
    OR has_table_privilege('dabboba_worker','public.worker_payment_reconciliations','DELETE')
    OR has_table_privilege('dabboba_worker','public.worker_payment_reconciliations','TRUNCATE')
    OR has_table_privilege('dabboba_worker','public.worker_payment_reconciliations','REFERENCES')
    OR has_table_privilege('dabboba_worker','public.worker_payment_reconciliations','TRIGGER')
  THEN
    RAISE EXCEPTION 'dabboba_worker reconciliation schedule privileges are not the exact allow-list';
  END IF;

  IF has_table_privilege(
    'dabboba_runtime',
    'public.worker_payment_reconciliations',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  ) THEN
    RAISE EXCEPTION 'dabboba_runtime can access the worker reconciliation schedule';
  END IF;

  FOR api_role IN
    SELECT rolname FROM pg_roles
     WHERE rolname IN ('anon','authenticated','service_role')
  LOOP
    IF has_table_privilege(
      api_role.rolname,
      'public.worker_payment_reconciliations',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) THEN
      RAISE EXCEPTION 'role % can access the worker reconciliation schedule', api_role.rolname;
    END IF;
  END LOOP;
END
$$;
