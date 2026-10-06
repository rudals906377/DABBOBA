-- Account deletion keeps legally retained shipping and dispute records apart
-- from ordinary member data. When the worker completes a deletion it copies the
-- deleted member's shipping address snapshots and inquiry text into an
-- owner-only table, then blanks them in the service tables. No API, admin or
-- worker role can read the separated copies. A copy is destroyed when the
-- approved commerce retention disposes the same record (0082/0083).
--
-- A customer may also delete an account that still holds points by explicitly
-- forfeiting that exact balance; the acknowledged amount is stored on the
-- request and the worker writes one EXPIRE ledger row for it.

ALTER TABLE public.account_deletion_requests
  ADD COLUMN point_forfeiture_acknowledged integer
    CHECK (point_forfeiture_acknowledged IS NULL OR point_forfeiture_acknowledged > 0);

CREATE TABLE public.deleted_account_retained_records (
  record_kind text NOT NULL CHECK (record_kind IN ('SHIPPING_ADDRESS','INQUIRY_CONTENT')),
  record_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  deletion_request_id uuid NOT NULL REFERENCES public.account_deletion_requests(id) ON DELETE RESTRICT,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  separated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (record_kind, record_id)
);
CREATE INDEX deleted_account_retained_records_user_idx
  ON public.deleted_account_retained_records (user_id);
ALTER TABLE public.deleted_account_retained_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.deleted_account_retained_records
  FROM PUBLIC, anon, authenticated, service_role, dabboba_runtime, dabboba_worker;
COMMENT ON TABLE public.deleted_account_retained_records IS
  'Owner-only copies of a deleted member''s legally retained shipping addresses and inquiry text, separated from service tables at account deletion.';

CREATE FUNCTION public.separate_deleted_account_records(target_request_id uuid, target_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  separated integer := 0;
  moved integer := 0;
BEGIN
  PERFORM 1
     FROM public.account_deletion_requests request
    WHERE request.id = target_request_id
      AND request.user_id = target_user_id
      AND request.status IN ('PROCESSING','APPROVED')
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account deletion request is not ready for record separation' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.deleted_account_retained_records(record_kind, record_id, user_id, deletion_request_id, payload)
  SELECT 'SHIPPING_ADDRESS', shipping.id, shipping.user_id, target_request_id, shipping.address_snapshot
    FROM public.shipping_requests shipping
   WHERE shipping.user_id = target_user_id
     AND jsonb_typeof(shipping.address_snapshot) = 'object'
     AND NOT (shipping.address_snapshot ? 'retentionDisposed')
     AND NOT (shipping.address_snapshot ? 'retainedSeparately')
  ON CONFLICT (record_kind, record_id) DO NOTHING;
  GET DIAGNOSTICS moved = ROW_COUNT;
  separated := separated + moved;

  UPDATE public.shipping_requests shipping
     SET address_snapshot = '{"retainedSeparately":true}'::jsonb, version = version + 1
   WHERE shipping.user_id = target_user_id
     AND NOT (shipping.address_snapshot ? 'retentionDisposed')
     AND NOT (shipping.address_snapshot ? 'retainedSeparately')
     AND EXISTS (
       SELECT 1 FROM public.deleted_account_retained_records copy
        WHERE copy.record_kind = 'SHIPPING_ADDRESS' AND copy.record_id = shipping.id
     );

  INSERT INTO public.deleted_account_retained_records(record_kind, record_id, user_id, deletion_request_id, payload)
  SELECT 'INQUIRY_CONTENT', inquiry.id, inquiry.user_id, target_request_id,
         jsonb_build_object(
           'category', inquiry.category,
           'title', inquiry.title,
           'status', inquiry.status,
           'createdAt', inquiry.created_at,
           'closedAt', inquiry.closed_at,
           'messages', COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'authorRole', message.author_role,
                      'internal', message.is_internal,
                      'content', message.content,
                      'createdAt', message.created_at
                    ) ORDER BY message.created_at, message.id)
               FROM public.inquiry_messages message
              WHERE message.inquiry_id = inquiry.id
           ), '[]'::jsonb)
         )
    FROM public.inquiries inquiry
   WHERE inquiry.user_id = target_user_id
     AND inquiry.title NOT IN ('삭제된 문의', '보관기한 만료로 파기된 문의')
  ON CONFLICT (record_kind, record_id) DO NOTHING;
  GET DIAGNOSTICS moved = ROW_COUNT;
  separated := separated + moved;

  RETURN separated;
END;
$$;
REVOKE ALL ON FUNCTION public.separate_deleted_account_records(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role, dabboba_runtime;
GRANT EXECUTE ON FUNCTION public.separate_deleted_account_records(uuid, uuid) TO dabboba_worker;

CREATE FUNCTION public.purge_separated_record_on_retention_disposal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  DELETE FROM public.deleted_account_retained_records
   WHERE record_kind = NEW.record_kind AND record_id = NEW.record_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.purge_separated_record_on_retention_disposal()
  FROM PUBLIC, anon, authenticated, service_role, dabboba_runtime, dabboba_worker;

CREATE TRIGGER commerce_retention_disposals_purge_separated_copy
  AFTER INSERT ON public.commerce_retention_disposals
  FOR EACH ROW EXECUTE FUNCTION public.purge_separated_record_on_retention_disposal();
