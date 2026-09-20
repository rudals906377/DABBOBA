-- Customer Auth inserts linked identities with an idempotent conflict update.
-- Keep the runtime role unable to reassign identity ownership or subjects.
GRANT UPDATE (verified_at)
ON TABLE public.auth_identities
TO dabboba_runtime;
