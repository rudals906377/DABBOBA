-- Restore the search_path pin on set_updated_at().
--
-- 0025 pinned every DABBOBA trigger function to `public, extensions, pg_temp`
-- (Supabase advisor: function_search_path_mutable). 0088 recreated
-- set_updated_at() with CREATE OR REPLACE and no SET clause, which drops the
-- function's configuration, so the pin was lost. The function body is
-- unchanged; only the pin returns.

ALTER FUNCTION public.set_updated_at() SET search_path = public, extensions, pg_temp;
