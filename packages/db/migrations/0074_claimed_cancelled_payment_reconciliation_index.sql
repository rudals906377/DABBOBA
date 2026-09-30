-- Reservation expiry can cancel an order after the customer opened the PG
-- window. Keep those payments cheap to revisit until PortOne confirms that
-- no charge happened or reports a late charge for refund review.
CREATE INDEX payments_worker_claimed_cancelled_reconciliation_idx
ON public.payments (updated_at, id)
WHERE status = 'CANCELLED'
  AND provider = 'PORTONE_V2_INICIS'
  AND pg_attempt_started_at IS NOT NULL;
