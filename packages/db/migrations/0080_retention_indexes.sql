-- dabboba:no-transaction
-- Range indexes for the bounded worker retention sweep (0079). Built
-- concurrently so live outbox publication, session rotation and Home click
-- recording are never blocked while the indexes are created.

CREATE INDEX CONCURRENTLY IF NOT EXISTS outbox_events_published_retention_idx
ON public.outbox_events (published_at, id)
WHERE published_at IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS sessions_expiry_retention_idx
ON public.sessions (expires_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS sessions_revoked_retention_idx
ON public.sessions (revoked_at)
WHERE revoked_at IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS home_product_click_events_created_idx
ON public.home_product_click_events (created_at, id);
