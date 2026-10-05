-- Keep the 0082 component sweep bounded at production volume and stop a
-- settled payment check from blocking disposal forever. Disposal scope,
-- policy/review/hold evidence, terminal-state and retention-window rules are
-- unchanged, and nothing here approves a policy or enables the worker.
--
-- * One assessment serves both preview and execution. Execution reads the
--   candidate list once and rechecks each locked record on its own, instead of
--   re-running the full preview for every candidate.
-- * The shipping order lookup follows two indexed paths (the shipping-fee
--   order and the orders behind the shipped items) instead of an OR that
--   scanned every order for every request.
-- * A worker payment reconciliation blocks only while unresolved: not when it
--   ended RECONCILED, when the payment later reached a verified PAID/REFUNDED
--   state (a newer payment version), or when an administrator closed that
--   payment's commerce review after the last attempt.

CREATE FUNCTION public.assess_commerce_retention(only_kind text, only_id uuid)
RETURNS TABLE(record_kind text,record_id uuid,policy_id uuid,review_id uuid,
  anchor_at timestamptz,eligible_at timestamptz,blocker text)
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public AS $$
BEGIN
  IF (only_kind IS NULL) <> (only_id IS NULL)
    OR (only_kind IS NOT NULL AND only_kind NOT IN ('SHIPPING_ADDRESS','INQUIRY_CONTENT')) THEN
    RAISE EXCEPTION 'Commerce retention assessment needs both a record kind and ID, or neither' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
  WITH sources AS (
    SELECT 'SHIPPING_ADDRESS'::text AS kind,s.id,s.user_id,
      s.status IN ('DELIVERED','CANCELLED') AS terminal,
      GREATEST(s.requested_at,s.updated_at,s.shipped_at,
        (SELECT max(e.created_at) FROM public.shipping_status_events e WHERE e.shipping_request_id=s.id),
        (SELECT max(GREATEST(o.created_at,o.updated_at,o.paid_at,o.cancelled_at,o.refunded_at,
                            p.created_at,p.updated_at,p.paid_at,p.refunded_at,
                            (SELECT max(l.created_at) FROM public.payment_ledger_entries l WHERE l.payment_id=p.id)))
           FROM public.orders o LEFT JOIN public.payments p ON p.order_id=o.id
          WHERE o.shipping_request_id=s.id),
        (SELECT max(GREATEST(o.created_at,o.updated_at,o.paid_at,o.cancelled_at,o.refunded_at,
                            p.created_at,p.updated_at,p.paid_at,p.refunded_at,
                            (SELECT max(l.created_at) FROM public.payment_ledger_entries l WHERE l.payment_id=p.id)))
           FROM public.shipping_request_items item
           JOIN public.inventory_units unit ON unit.id=item.inventory_unit_id
           LEFT JOIN public.draw_entitlements entitlement ON entitlement.id=unit.source_id AND unit.source_type IN ('GACHA','KUJI')
           JOIN public.order_lines line ON line.id=CASE WHEN unit.source_type='PURCHASE' THEN unit.source_id ELSE entitlement.order_line_id END
           JOIN public.orders o ON o.id=line.order_id
           LEFT JOIN public.payments p ON p.order_id=o.id
          WHERE item.shipping_request_id=s.id)) AS activity,
      false AS has_media,0::bigint AS message_count
      FROM public.shipping_requests s
     WHERE s.address_snapshot IS DISTINCT FROM '{"retentionDisposed":true}'::jsonb
       AND (only_kind IS NULL OR (only_kind='SHIPPING_ADDRESS' AND s.id=only_id))
    UNION ALL
    SELECT 'INQUIRY_CONTENT',i.id,i.user_id,
      i.status='CLOSED' AND i.closed_at IS NOT NULL,
      GREATEST(i.created_at,i.updated_at,i.closed_at,
        (SELECT max(m.created_at) FROM public.inquiry_messages m WHERE m.inquiry_id=i.id)),
      EXISTS (SELECT 1 FROM public.inquiry_messages m JOIN public.inquiry_message_media media ON media.message_id=m.id WHERE m.inquiry_id=i.id),
      (SELECT count(*) FROM public.inquiry_messages m WHERE m.inquiry_id=i.id)
      FROM public.inquiries i
     WHERE (i.title<>'보관기한 만료로 파기된 문의'
        OR EXISTS (SELECT 1 FROM public.inquiry_messages m WHERE m.inquiry_id=i.id AND m.content<>'보관기한 만료로 파기된 내용'))
       AND (only_kind IS NULL OR (only_kind='INQUIRY_CONTENT' AND i.id=only_id))
  ), assessed AS (
  SELECT c.kind,c.id,p.id AS policy_identifier,r.id AS review_identifier,c.activity,
    c.activity+make_interval(months=>p.retention_months) AS expiry,
    CASE
      WHEN p.id IS NULL THEN 'POLICY_MISSING'
      WHEN NOT EXISTS (SELECT 1 FROM public.users a WHERE a.id=p.approved_by_admin_id AND a.role IN ('ADMIN','SUPER_ADMIN') AND a.status='ACTIVE') THEN 'POLICY_REVIEW_REQUIRED'
      WHEN r.id IS NULL OR r.hold_registry_reviewed_at IS NULL OR r.hold_registry_reviewed_at<now()-interval '24 hours'
        OR r.created_at<p.approved_at
        OR NOT EXISTS (SELECT 1 FROM public.users a WHERE a.id=r.reviewed_by_admin_id AND a.role IN ('ADMIN','SUPER_ADMIN') AND a.status='ACTIVE') THEN 'HOLD_REVIEW_REQUIRED'
      WHEN r.external_copies_status<>'CLEARED' OR r.external_copies_reviewed_at IS NULL
        OR r.external_copies_reviewed_at<now()-interval '24 hours' THEN 'EXTERNAL_COPIES_UNVERIFIED'
      WHEN EXISTS (SELECT 1 FROM public.commerce_retention_holds h WHERE h.released_at IS NULL AND (
        h.scope='ALL' OR (h.scope='USER' AND h.user_id=c.user_id)
        OR (h.scope='RECORD' AND h.record_kind=c.kind AND h.record_id=c.id))) THEN 'LEGAL_HOLD'
      WHEN NOT c.terminal THEN 'SERVICE_ACTIVE'
      WHEN c.activity+make_interval(months=>p.retention_months)>now() THEN 'NOT_EXPIRED'
      WHEN EXISTS (SELECT 1 FROM public.admin_commerce_reviews review JOIN public.payments payment ON payment.id=review.payment_id
        JOIN public.orders purchase ON purchase.id=payment.order_id WHERE purchase.user_id=c.user_id AND review.status<>'CLOSED') THEN 'OPEN_COMMERCE_REVIEW'
      WHEN EXISTS (SELECT 1 FROM public.orders purchase LEFT JOIN public.payments payment ON payment.order_id=purchase.id
        WHERE purchase.user_id=c.user_id AND (purchase.status IN ('PENDING_PAYMENT','REFUND_REVIEW')
          OR payment.status IN ('PENDING','AUTHORIZED','REFUND_REVIEW')
          OR EXISTS (SELECT 1 FROM public.worker_payment_reconciliations reconciliation
            WHERE reconciliation.payment_id=payment.id
              AND reconciliation.last_outcome<>'RECONCILED'
              AND NOT (payment.status IN ('PAID','REFUNDED') AND payment.version>reconciliation.payment_version)
              AND NOT EXISTS (SELECT 1 FROM public.admin_commerce_reviews settled
                WHERE settled.payment_id=reconciliation.payment_id AND settled.status='CLOSED'
                  AND settled.closed_at>=reconciliation.last_attempted_at)))) THEN 'PAYMENT_UNRESOLVED'
      WHEN c.has_media THEN 'MEDIA_PRESENT'
      WHEN c.message_count>50 THEN 'MESSAGE_LIMIT'
      ELSE NULL
    END AS denial
    FROM sources c
    LEFT JOIN public.commerce_retention_policies p ON p.record_kind=c.kind AND p.approved_at IS NOT NULL AND p.retired_at IS NULL
    LEFT JOIN LATERAL (
      SELECT reviewed.* FROM public.commerce_retention_reviews reviewed WHERE reviewed.policy_id=p.id
       ORDER BY reviewed.created_at DESC,reviewed.id DESC LIMIT 1
    ) r ON true
  )
  SELECT a.kind,a.id,a.policy_identifier,a.review_identifier,a.activity,a.expiry,a.denial
    FROM assessed a;
END;
$$;

CREATE OR REPLACE FUNCTION public.preview_commerce_retention(batch_size integer)
RETURNS TABLE(record_kind text,record_id uuid,policy_id uuid,review_id uuid,
  anchor_at timestamptz,eligible_at timestamptz,blocker text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF batch_size IS NULL OR batch_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Commerce retention batch must be between 1 and 100' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
  SELECT a.record_kind,a.record_id,a.policy_id,a.review_id,a.anchor_at,a.eligible_at,a.blocker
    FROM public.assess_commerce_retention(NULL,NULL) a
    -- Held/unreviewed old rows must not starve later approved expired rows.
    ORDER BY (a.blocker IS NOT NULL),a.anchor_at,a.record_kind,a.record_id LIMIT batch_size;
END;
$$;

CREATE OR REPLACE FUNCTION public.execute_commerce_retention(batch_size integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE candidate record; rechecked record; disposed_count integer:=0; message_count integer:=0;
BEGIN
  IF current_setting('dabboba.commerce_retention_execute',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Commerce retention requires explicit execution configuration' USING ERRCODE='55000';
  END IF;
  IF current_setting('transaction_isolation')<>'serializable' THEN
    RAISE EXCEPTION 'Commerce retention requires a serializable transaction' USING ERRCODE='55000';
  END IF;
  IF batch_size IS NULL OR batch_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Commerce retention batch must be between 1 and 100' USING ERRCODE='22023';
  END IF;
  IF NOT pg_try_advisory_xact_lock(7922024082400083::bigint) THEN RETURN 0; END IF;
  FOR candidate IN SELECT * FROM public.assess_commerce_retention(NULL,NULL) plan
    WHERE plan.blocker IS NULL ORDER BY plan.anchor_at,plan.record_kind,plan.record_id LIMIT batch_size
  LOOP
    IF candidate.record_kind='SHIPPING_ADDRESS' THEN
      PERFORM 1 FROM public.shipping_requests s WHERE s.id=candidate.record_id FOR UPDATE;
    ELSE
      PERFORM 1 FROM public.inquiries i WHERE i.id=candidate.record_id FOR UPDATE;
      PERFORM 1 FROM public.inquiry_messages m WHERE m.inquiry_id=candidate.record_id ORDER BY m.id FOR UPDATE;
    END IF;
    -- Re-evaluate only this record after its locks; serializable conflicts abort
    -- the entire bounded transaction. No irreversible external operation occurs.
    SELECT * INTO rechecked FROM public.assess_commerce_retention(candidate.record_kind,candidate.record_id) plan;
    IF NOT FOUND OR rechecked.blocker IS NOT NULL THEN CONTINUE; END IF;
    message_count:=0;
    IF candidate.record_kind='SHIPPING_ADDRESS' THEN
      UPDATE public.shipping_requests SET address_snapshot='{"retentionDisposed":true}'::jsonb,version=version+1
       WHERE id=candidate.record_id;
    ELSE
      UPDATE public.inquiry_messages SET content='보관기한 만료로 파기된 내용' WHERE inquiry_id=candidate.record_id;
      GET DIAGNOSTICS message_count=ROW_COUNT;
      UPDATE public.inquiries SET title='보관기한 만료로 파기된 문의' WHERE id=candidate.record_id;
    END IF;
    INSERT INTO public.commerce_retention_disposals(record_kind,record_id,policy_id,review_id,source_anchor_at,eligible_at,message_count)
      VALUES(rechecked.record_kind,rechecked.record_id,rechecked.policy_id,rechecked.review_id,rechecked.anchor_at,rechecked.eligible_at,message_count);
    disposed_count:=disposed_count+1;
  END LOOP;
  RETURN disposed_count;
END;
$$;

-- The assessment runs only inside the two owner-defined functions above.
REVOKE ALL ON FUNCTION public.assess_commerce_retention(text,uuid)
  FROM PUBLIC,anon,authenticated,service_role,dabboba_runtime,dabboba_worker;
