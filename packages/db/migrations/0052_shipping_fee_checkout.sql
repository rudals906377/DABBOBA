-- Paid delivery requests are created in a non-operational state until the
-- verified provider event promotes them to REQUESTED. A failed or expired
-- payment cancels the request and releases its inventory back to OWNED.
ALTER TABLE public.shipping_requests
DROP CONSTRAINT shipping_requests_status_check;

ALTER TABLE public.shipping_requests
ADD CONSTRAINT shipping_requests_status_check
CHECK (status IN ('PAYMENT_PENDING','REQUESTED','PROCESSING','SHIPPED','DELIVERED','CANCELLED'))
NOT VALID;

ALTER TABLE public.shipping_requests
VALIDATE CONSTRAINT shipping_requests_status_check;

ALTER TABLE public.shipping_requests
DROP CONSTRAINT shipping_requests_tracking_state_check;

ALTER TABLE public.shipping_requests
ADD CONSTRAINT shipping_requests_tracking_state_check
CHECK (
  (status IN ('SHIPPED','DELIVERED')
    AND shipped_at IS NOT NULL
    AND tracking_carrier IS NOT NULL
    AND tracking_number IS NOT NULL)
  OR
  (status IN ('PAYMENT_PENDING','REQUESTED','PROCESSING','CANCELLED')
    AND shipped_at IS NULL
    AND tracking_carrier IS NULL
    AND tracking_number IS NULL)
) NOT VALID;

ALTER TABLE public.shipping_requests
VALIDATE CONSTRAINT shipping_requests_tracking_state_check;

CREATE OR REPLACE FUNCTION public.enforce_shipping_request_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.status = NEW.status THEN
    IF NEW.tracking_carrier IS DISTINCT FROM OLD.tracking_carrier
      OR NEW.tracking_number IS DISTINCT FROM OLD.tracking_number
      OR NEW.shipped_at IS DISTINCT FROM OLD.shipped_at
    THEN
      RAISE EXCEPTION 'Shipping metadata can only change with a state transition' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'PAYMENT_PENDING' AND NEW.status IN ('REQUESTED','CANCELLED'))
    OR (OLD.status = 'REQUESTED' AND NEW.status IN ('PROCESSING','CANCELLED'))
    OR (OLD.status = 'PROCESSING' AND NEW.status IN ('SHIPPED','CANCELLED'))
    OR (OLD.status = 'SHIPPED' AND NEW.status = 'DELIVERED')
  ) THEN
    RAISE EXCEPTION 'Invalid shipping request transition: % -> %', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'DELIVERED' AND (
    NEW.tracking_carrier IS DISTINCT FROM OLD.tracking_carrier
    OR NEW.tracking_number IS DISTINCT FROM OLD.tracking_number
    OR NEW.shipped_at IS DISTINCT FROM OLD.shipped_at
  ) THEN
    RAISE EXCEPTION 'Delivered shipping metadata must match the shipped state' USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

ALTER TABLE public.orders
ADD COLUMN order_kind text NOT NULL DEFAULT 'PRODUCT';

ALTER TABLE public.orders
ADD COLUMN shipping_request_id uuid REFERENCES public.shipping_requests(id) ON DELETE RESTRICT;

ALTER TABLE public.orders
ADD CONSTRAINT orders_kind_check
CHECK (order_kind IN ('PRODUCT','SHIPPING_FEE')) NOT VALID;

ALTER TABLE public.orders
VALIDATE CONSTRAINT orders_kind_check;

ALTER TABLE public.orders
ADD CONSTRAINT orders_shipping_fee_contract
CHECK (
  (order_kind = 'PRODUCT' AND shipping_request_id IS NULL)
  OR
  (
    order_kind = 'SHIPPING_FEE'
    AND shipping_request_id IS NOT NULL
    AND subtotal = 3000
    AND discount_total = 0
    AND point_total = 0
    AND total = 3000
    AND coupon_id IS NULL
  )
) NOT VALID;

ALTER TABLE public.orders
VALIDATE CONSTRAINT orders_shipping_fee_contract;

CREATE UNIQUE INDEX orders_shipping_request_payment_idx
ON public.orders (shipping_request_id)
WHERE shipping_request_id IS NOT NULL;
