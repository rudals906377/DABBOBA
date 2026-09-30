-- Scope customer sessions. FULL is every ordinary customer or administrator
-- session. ACCOUNT_DELETION is the short-lived session issued by the public
-- account-deletion re-authentication; the API accepts it only on the deletion
-- preview/request/status and logout routes and answers every other route with
-- 403 SESSION_SCOPE_FORBIDDEN. Existing rows become FULL.
--
-- The API runtime role already holds table-wide privileges on sessions
-- (0026), so the new column needs no additional grant. The worker keeps its
-- exact column-scoped allow-list from 0060/0068 and does not read scope.
ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'FULL';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.sessions'::regclass
       AND conname = 'sessions_scope_check'
  ) THEN
    ALTER TABLE public.sessions
    ADD CONSTRAINT sessions_scope_check
    CHECK (scope IN ('FULL','ACCOUNT_DELETION'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.sessions'::regclass
       AND conname = 'sessions_scope_kind_check'
  ) THEN
    ALTER TABLE public.sessions
    ADD CONSTRAINT sessions_scope_kind_check
    CHECK (scope = 'FULL' OR session_kind = 'USER');
  END IF;
END
$$;
