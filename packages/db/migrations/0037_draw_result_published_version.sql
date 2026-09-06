-- Results may be created from a retired version for entitlements purchased
-- before a newer version was published, but never from an unpublished draft.
-- Keep this check in a forward migration because 0036 is already immutable in
-- the production migration ledger.

CREATE OR REPLACE FUNCTION public.guard_draw_result_published_version()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  probability_version_status text;
  probability_version_published_at timestamptz;
BEGIN
  SELECT version.status, version.published_at
    INTO probability_version_status, probability_version_published_at
    FROM public.draw_entitlements AS entitlement
    JOIN public.draw_probability_versions AS version
      ON version.id = entitlement.probability_version_id
   WHERE entitlement.id = NEW.entitlement_id
   FOR SHARE OF version;

  IF NOT FOUND
    OR probability_version_status NOT IN ('ACTIVE','RETIRED')
    OR probability_version_published_at IS NULL
  THEN
    RAISE EXCEPTION 'Draw results require a published probability version'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER draw_results_published_version_guard
BEFORE INSERT ON public.draw_results
FOR EACH ROW EXECUTE FUNCTION public.guard_draw_result_published_version();

REVOKE EXECUTE ON FUNCTION public.guard_draw_result_published_version() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON FUNCTION public.guard_draw_result_published_version() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE EXECUTE ON FUNCTION public.guard_draw_result_published_version() FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE EXECUTE ON FUNCTION public.guard_draw_result_published_version() FROM service_role;
  END IF;
END
$$;
