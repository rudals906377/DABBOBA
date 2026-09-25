-- Account deletion must preserve an existing session revocation reason while
-- clearing personal metadata. The worker needs to read only that one extra
-- session column; migration 0060 intentionally removed table-wide SELECT.
GRANT SELECT (revoke_reason)
ON TABLE public.sessions TO dabboba_worker;

-- ON CONFLICT (deletion_request_id,idempotency_key) DO NOTHING still reads
-- the arbiter columns. Keep the append-only event table otherwise unreadable
-- to the worker instead of broadening the role to table-wide SELECT.
GRANT SELECT (deletion_request_id,idempotency_key)
ON TABLE public.account_deletion_request_events TO dabboba_worker;

DO $$
BEGIN
  IF has_table_privilege('dabboba_worker','public.sessions','SELECT')
     OR has_table_privilege('dabboba_worker','public.account_deletion_request_events','SELECT')
     OR has_column_privilege('dabboba_worker','public.sessions','token_digest','SELECT') THEN
    RAISE EXCEPTION 'Deletion worker gained broad or sensitive read access';
  END IF;
END
$$;
