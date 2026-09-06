-- Run standalone with psql -X -qAt -v ON_ERROR_STOP=1 -f this-file.sql.
-- Counts and ages only; no application rows or queue payloads are returned.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL row_security = off;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';

-- Do not replace missing relations/permissions with zeroes. Direct references
-- and row_security=off make unavailable or policy-filtered input fail visibly.
-- Queue visibility is inspected directly; no pgmq function is invoked.
WITH metrics(metric, item_count, oldest_at) AS (
  SELECT 'outbox_pending', count(*), min(created_at)
    FROM public.outbox_events WHERE published_at IS NULL
  UNION ALL
  SELECT 'outbox_due', count(*), min(available_at)
    FROM public.outbox_events
   WHERE published_at IS NULL AND available_at <= now()
  UNION ALL
  SELECT 'outbox_retry_pending', count(*), min(created_at)
    FROM public.outbox_events WHERE published_at IS NULL AND attempts > 0
  UNION ALL
  SELECT 'queue_total', count(*), min(enqueued_at)
    FROM pgmq.q_dabboba_worker
  UNION ALL
  SELECT 'queue_visible', count(*), min(enqueued_at)
    FROM pgmq.q_dabboba_worker WHERE vt <= now()
  UNION ALL
  SELECT 'queue_not_visible', count(*), min(enqueued_at)
    FROM pgmq.q_dabboba_worker WHERE vt > now()
  UNION ALL
  SELECT 'queue_read_more_than_once', count(*), min(enqueued_at)
    FROM pgmq.q_dabboba_worker WHERE read_ct > 1
  UNION ALL
  SELECT 'worker_dead_letters', count(*), min(failed_at)
    FROM public.worker_dead_letters WHERE queue_name = 'dabboba_worker'
  UNION ALL
  SELECT 'reservations_active', count(*), min(created_at)
    FROM public.stock_reservations WHERE status = 'ACTIVE'
  UNION ALL
  SELECT 'reservations_expired_active', count(*), min(expires_at)
    FROM public.stock_reservations WHERE status = 'ACTIVE' AND expires_at <= now()
  UNION ALL
  SELECT 'payments_pending', count(*), min(updated_at)
    FROM public.payments WHERE status = 'PENDING'
  UNION ALL
  SELECT 'payments_authorized', count(*), min(updated_at)
    FROM public.payments WHERE status = 'AUTHORIZED'
  UNION ALL
  SELECT 'payments_refund_review', count(*), min(updated_at)
    FROM public.payments WHERE status = 'REFUND_REVIEW'
  UNION ALL
  SELECT 'payment_reconciliation_schedule_due', count(*), min(reconciliation.next_attempt_at)
    FROM public.worker_payment_reconciliations AS reconciliation
    JOIN public.payments AS payment ON payment.id = reconciliation.payment_id
   WHERE payment.status IN ('PENDING', 'AUTHORIZED', 'REFUND_REVIEW')
     AND reconciliation.payment_version = payment.version
     AND reconciliation.next_attempt_at <= now()
  UNION ALL
  SELECT 'payments_without_current_reconciliation_schedule', count(*), min(payment.updated_at)
    FROM public.payments AS payment
    LEFT JOIN public.worker_payment_reconciliations AS reconciliation
      ON reconciliation.payment_id = payment.id
   WHERE payment.status IN ('PENDING', 'AUTHORIZED', 'REFUND_REVIEW')
     AND (reconciliation.payment_id IS NULL OR reconciliation.payment_version <> payment.version)
  UNION ALL
  SELECT 'draw_consumed_without_result', count(*), min(COALESCE(entitlement.consumed_at, entitlement.created_at))
    FROM public.draw_entitlements AS entitlement
    LEFT JOIN public.draw_results AS result ON result.entitlement_id = entitlement.id
   WHERE entitlement.status = 'CONSUMED' AND result.id IS NULL
  UNION ALL
  SELECT 'draw_results_without_consumed_entitlement', count(*), min(result.committed_at)
    FROM public.draw_results AS result
    LEFT JOIN public.draw_entitlements AS entitlement ON entitlement.id = result.entitlement_id
   WHERE entitlement.id IS NULL
      OR entitlement.status IS DISTINCT FROM 'CONSUMED'
      OR entitlement.consumed_at IS NULL
  UNION ALL
  SELECT 'draw_result_identity_or_version_mismatch', count(*), min(result.committed_at)
    FROM public.draw_results AS result
    LEFT JOIN public.draw_entitlements AS entitlement ON entitlement.id = result.entitlement_id
    LEFT JOIN public.draw_probability_versions AS version ON version.id = entitlement.probability_version_id
    LEFT JOIN public.draw_pool_entries AS pool_entry ON pool_entry.id = result.pool_entry_id
   WHERE entitlement.id IS NULL
      OR version.id IS NULL
      OR pool_entry.id IS NULL
      OR result.user_id IS DISTINCT FROM entitlement.user_id
      OR result.product_id IS DISTINCT FROM entitlement.product_id
      OR result.probability_version IS DISTINCT FROM version.version
      OR version.product_id IS DISTINCT FROM entitlement.product_id
      OR pool_entry.probability_version_id IS DISTINCT FROM entitlement.probability_version_id
      OR result.prize_product_id IS DISTINCT FROM pool_entry.prize_product_id
      OR version.published_at IS NULL
      OR version.status NOT IN ('ACTIVE', 'RETIRED')
  UNION ALL
  SELECT 'draw_available_on_unpaid_order', count(*), min(entitlement.created_at)
    FROM public.draw_entitlements AS entitlement
    LEFT JOIN public.order_lines AS order_line ON order_line.id = entitlement.order_line_id
    LEFT JOIN public.orders AS customer_order ON customer_order.id = order_line.order_id
   WHERE entitlement.status = 'AVAILABLE'
     AND (customer_order.id IS NULL OR customer_order.status NOT IN ('PAID', 'FULFILLED'))
)
SELECT jsonb_build_object(
  'schema_version', 1,
  'metrics', jsonb_object_agg(metric, jsonb_build_object(
    'count', item_count,
    'oldest_age_seconds', CASE WHEN item_count = 0 THEN NULL
      ELSE greatest(0, floor(extract(epoch FROM (now() - oldest_at))))::bigint END
  ))
)
FROM metrics;

COMMIT;
