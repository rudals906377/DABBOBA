-- Partial refund of the unused draws of a partly used gacha order (owner
-- decision 2026-10-06). One row per payment records the operator request, the
-- exact entitlements and the fixed amounts before any provider call:
--   refund value = floor((card paid + points used) * unused / total draws)
--   card part    = floor(card paid * unused / total draws), cancelled on the card
--   point part   = refund value - card part, returned as points
-- Coupon discounts are not returned. The canonical payment handler applies the
-- row only when a verified provider read shows exactly the planned card
-- cancellation; a points-only plan is applied in the request transaction.

CREATE TABLE public.partial_unused_draw_refunds (
  payment_id uuid PRIMARY KEY REFERENCES public.payments(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  admin_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  idempotency_key varchar(200) NOT NULL,
  request_hash char(64) NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 2 AND 500),
  status text NOT NULL
    CHECK (status IN ('CALLING','PROVIDER_PENDING','INDETERMINATE','REVIEW_REQUIRED','APPLIED','RELEASED')),
  total_draw_units integer NOT NULL CHECK (total_draw_units >= 2),
  unused_draw_units integer NOT NULL CHECK (unused_draw_units >= 1 AND unused_draw_units < total_draw_units),
  entitlement_ids uuid[] NOT NULL CHECK (cardinality(entitlement_ids) = unused_draw_units),
  paid_card_amount integer NOT NULL CHECK (paid_card_amount >= 0),
  paid_point_amount integer NOT NULL CHECK (paid_point_amount >= 0),
  card_refund_amount integer NOT NULL
    CHECK (card_refund_amount >= 0 AND card_refund_amount <= paid_card_amount),
  point_refund_amount integer NOT NULL
    CHECK (point_refund_amount >= 0 AND point_refund_amount <= paid_point_amount),
  provider_cancellation_id varchar(200),
  provider_status varchar(40),
  last_error_code varchar(80),
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (card_refund_amount + point_refund_amount > 0),
  CHECK ((status = 'APPLIED') = (applied_at IS NOT NULL))
);
CREATE INDEX partial_unused_draw_refunds_order_idx ON public.partial_unused_draw_refunds(order_id);
CREATE TRIGGER partial_unused_draw_refunds_set_updated_at
BEFORE UPDATE ON public.partial_unused_draw_refunds
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.partial_unused_draw_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.partial_unused_draw_refunds
  FROM PUBLIC, anon, authenticated, service_role, dabboba_worker;
GRANT SELECT, INSERT, UPDATE ON TABLE public.partial_unused_draw_refunds TO dabboba_runtime;
COMMENT ON TABLE public.partial_unused_draw_refunds IS
  'Operator partial refunds of unused gacha draws: fixed entitlements and card/point amounts, applied only after a verified matching provider cancellation.';
