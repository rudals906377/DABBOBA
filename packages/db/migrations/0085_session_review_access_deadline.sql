-- A payment-review session stores its absolute review deadline on the session
-- itself, independent of the API's current configuration. Refresh copies the
-- deadline and never issues a longer ordinary customer session, even after the
-- review login is disabled or its settings are removed.
ALTER TABLE public.sessions ADD COLUMN review_access_expires_at timestamptz;
ALTER TABLE public.sessions ADD CONSTRAINT sessions_review_access_check CHECK (
  review_access_expires_at IS NULL
  OR (session_kind = 'USER' AND scope = 'FULL' AND expires_at <= review_access_expires_at)
);
