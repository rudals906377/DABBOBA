-- Supports the privacy-minimized global Home activity query without changing
-- the append-only draw result or prize snapshot records.
CREATE INDEX draw_results_committed_idx
ON public.draw_results (committed_at DESC, id DESC);
