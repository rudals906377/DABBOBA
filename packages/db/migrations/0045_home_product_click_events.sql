-- Anonymous, idempotent Home product click evidence.
-- No user, session, device, network, or other personal identifier is retained.
CREATE TABLE public.home_product_click_events (
  id uuid PRIMARY KEY,
  product_id text NOT NULL REFERENCES public.catalog_products(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX home_product_click_events_product_idx
ON public.home_product_click_events (product_id, created_at DESC, id DESC);

CREATE TRIGGER home_product_click_events_immutable
BEFORE UPDATE OR DELETE ON public.home_product_click_events
FOR EACH ROW EXECUTE FUNCTION public.reject_row_mutation();

ALTER TABLE public.home_product_click_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.home_product_click_events FROM PUBLIC;
DO $$
DECLARE
  app_role text;
BEGIN
  FOR app_role IN
    SELECT rolname FROM pg_roles
    WHERE rolname IN ('anon', 'authenticated', 'service_role')
  LOOP
    EXECUTE format(
      'REVOKE ALL ON TABLE public.home_product_click_events FROM %I',
      app_role
    );
  END LOOP;
END
$$;

REVOKE ALL ON TABLE public.home_product_click_events FROM dabboba_runtime;
GRANT SELECT, INSERT ON TABLE public.home_product_click_events TO dabboba_runtime;
