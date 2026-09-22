-- Operator-configurable Home rails. The linked catalog IP remains the source of
-- product truth; this table controls only the rail label, order, and visibility.
CREATE TABLE public.home_catalog_sections (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(id) <= 120),
  title varchar(120) NOT NULL CHECK (btrim(title) <> ''),
  ip_id text NOT NULL UNIQUE REFERENCES public.catalog_ips(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  is_active boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX home_catalog_sections_active_order_idx
ON public.home_catalog_sections (sort_order, id)
WHERE is_active;

CREATE TRIGGER home_catalog_sections_set_updated_at
BEFORE UPDATE ON public.home_catalog_sections
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.home_catalog_sections ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.home_catalog_sections FROM PUBLIC;
DO $$
DECLARE
  app_role text;
BEGIN
  FOR app_role IN
    SELECT rolname FROM pg_roles
    WHERE rolname IN ('anon', 'authenticated', 'service_role')
  LOOP
    EXECUTE format(
      'REVOKE ALL ON TABLE public.home_catalog_sections FROM %I',
      app_role
    );
  END LOOP;
END
$$;

-- API mutations are append/update-only. Operators hide a rail instead of
-- deleting its durable configuration and audit history.
REVOKE ALL ON TABLE public.home_catalog_sections FROM dabboba_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE public.home_catalog_sections TO dabboba_runtime;
