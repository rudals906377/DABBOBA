-- Account deletion must not restart a retention clock. The separation of a
-- deleted member's shipping addresses and inquiry text (0086) and the worker's
-- anonymization both UPDATE service rows, and every updated_at trigger would
-- stamp now() on them, pushing the commerce-retention anchor (which reads
-- updated_at) out to the deletion day. A transaction-local setting lets those
-- two steps, and only those, keep the row's previous updated_at.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('dabboba.preserve_updated_at', true) = 'on' THEN
    NEW.updated_at = OLD.updated_at;
    RETURN NEW;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION set_updated_at() IS
  'Stamps updated_at on UPDATE. The account-deletion worker sets dabboba.preserve_updated_at=on for its anonymization transaction so disposal clocks keep the last customer activity.';

CREATE OR REPLACE FUNCTION public.separate_deleted_account_records(target_request_id uuid, target_user_id uuid)
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

  -- Separation is not customer activity: keep the rows' retention anchors.
  PERFORM set_config('dabboba.preserve_updated_at', 'on', true);

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
