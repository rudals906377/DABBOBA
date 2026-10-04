-- Explicitly approved COMPONENT disposal, not a financial-ledger purge.
-- No policy or permission to execute is seeded. The normal worker is disabled.
-- Shipping tracking/user/order identities and immutable ledgers remain intact.

CREATE TABLE public.commerce_retention_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_kind text NOT NULL CHECK (record_kind IN ('SHIPPING_ADDRESS','INQUIRY_CONTENT')),
  policy_version date NOT NULL,
  retention_months integer NOT NULL CHECK (
    retention_months BETWEEN 36 AND 120
    AND (record_kind <> 'SHIPPING_ADDRESS' OR retention_months >= 60)
  ),
  anchor_rule text NOT NULL DEFAULT 'LATEST_RELEVANT_ACTIVITY'
    CHECK (anchor_rule = 'LATEST_RELEVANT_ACTIVITY'),
  evidence_reference varchar(200) NOT NULL CHECK (length(btrim(evidence_reference)) BETWEEN 3 AND 200),
  approved_by_admin_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  retired_at timestamptz,
  retired_by_admin_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  retirement_evidence_reference varchar(200)
    CHECK (length(btrim(retirement_evidence_reference)) BETWEEN 3 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((approved_by_admin_id IS NULL) = (approved_at IS NULL)),
  CHECK ((retired_at IS NULL) = (retired_by_admin_id IS NULL)),
  CHECK ((retired_at IS NULL) = (retirement_evidence_reference IS NULL)),
  CHECK (retired_at IS NULL OR (approved_at IS NOT NULL AND retired_at >= approved_at)),
  UNIQUE (record_kind,policy_version)
);
CREATE UNIQUE INDEX commerce_retention_one_approved_policy_idx
  ON public.commerce_retention_policies(record_kind)
  WHERE approved_at IS NOT NULL AND retired_at IS NULL;

CREATE TABLE public.commerce_retention_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES public.commerce_retention_policies(id) ON DELETE RESTRICT,
  reviewed_by_admin_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  hold_registry_reviewed_at timestamptz,
  external_copies_reviewed_at timestamptz,
  external_copies_status text NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (external_copies_status IN ('UNVERIFIED','CLEARED')),
  evidence_reference varchar(200) NOT NULL CHECK (length(btrim(evidence_reference)) BETWEEN 3 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (external_copies_status <> 'CLEARED' OR external_copies_reviewed_at IS NOT NULL)
);
CREATE INDEX commerce_retention_reviews_latest_idx
  ON public.commerce_retention_reviews(policy_id,created_at DESC,id DESC);

CREATE TABLE public.commerce_retention_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('ALL','USER','RECORD')),
  record_kind text CHECK (record_kind IN ('SHIPPING_ADDRESS','INQUIRY_CONTENT')),
  record_id uuid,
  user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  case_reference varchar(200) NOT NULL CHECK (length(btrim(case_reference)) BETWEEN 3 AND 200),
  created_by_admin_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  released_by_admin_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  released_at timestamptz,
  CHECK ((released_at IS NULL) = (released_by_admin_id IS NULL)),
  CHECK (released_at IS NULL OR released_at >= created_at),
  CHECK (
    (scope='ALL' AND record_kind IS NULL AND record_id IS NULL AND user_id IS NULL)
    OR (scope='USER' AND record_kind IS NULL AND record_id IS NULL AND user_id IS NOT NULL)
    OR (scope='RECORD' AND record_kind IS NOT NULL AND record_id IS NOT NULL AND user_id IS NULL)
  )
);
CREATE INDEX commerce_retention_active_holds_idx
  ON public.commerce_retention_holds(scope,user_id,record_kind,record_id)
  WHERE released_at IS NULL;

CREATE TABLE public.commerce_retention_disposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_kind text NOT NULL CHECK (record_kind IN ('SHIPPING_ADDRESS','INQUIRY_CONTENT')),
  record_id uuid NOT NULL,
  policy_id uuid NOT NULL REFERENCES public.commerce_retention_policies(id) ON DELETE RESTRICT,
  review_id uuid NOT NULL REFERENCES public.commerce_retention_reviews(id) ON DELETE RESTRICT,
  source_anchor_at timestamptz NOT NULL,
  eligible_at timestamptz NOT NULL,
  message_count integer NOT NULL CHECK (message_count BETWEEN 0 AND 50),
  disposed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (eligible_at <= disposed_at),
  UNIQUE(record_kind,record_id,source_anchor_at)
);

-- Registry changes serialize with execution. Approved policy details are
-- immutable; retirement and one-time hold release keep the prior evidence.
CREATE FUNCTION public.guard_commerce_retention_registry()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE approver uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(7922024082400083::bigint);
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Commerce retention registry evidence is append-only' USING ERRCODE='55000';
  END IF;
  IF TG_TABLE_NAME='commerce_retention_policies' THEN
    IF TG_OP='UPDATE' AND OLD.approved_at IS NOT NULL THEN
      IF to_jsonb(OLD)-'retired_at'-'retired_by_admin_id'-'retirement_evidence_reference'
        IS DISTINCT FROM to_jsonb(NEW)-'retired_at'-'retired_by_admin_id'-'retirement_evidence_reference'
        OR OLD.retired_at IS NOT NULL OR NEW.retired_at IS NULL THEN
        RAISE EXCEPTION 'Approved commerce retention policy is immutable; publish a new version' USING ERRCODE='55000';
      END IF;
      -- Preserve the historical approver even if they are no longer active.
      -- A separate current administrator must approve this one-time retirement.
      approver:=NEW.retired_by_admin_id;
    ELSE
      IF NEW.retired_at IS NOT NULL THEN
        RAISE EXCEPTION 'Approve a commerce retention policy before retiring it' USING ERRCODE='23514';
      END IF;
      approver:=NEW.approved_by_admin_id;
    END IF;
    IF NEW.approved_at > now() OR NEW.retired_at > now() THEN
      RAISE EXCEPTION 'Commerce retention approval or retirement cannot be in the future' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='commerce_retention_reviews' THEN
    IF TG_OP<>'INSERT' THEN
      RAISE EXCEPTION 'Commerce retention review evidence is append-only' USING ERRCODE='55000';
    END IF;
    IF NEW.created_at > now() OR NEW.hold_registry_reviewed_at > now() OR NEW.external_copies_reviewed_at > now() THEN
      RAISE EXCEPTION 'Commerce retention review cannot be in the future' USING ERRCODE='23514';
    END IF;
    approver:=NEW.reviewed_by_admin_id;
  ELSE
    IF TG_OP='UPDATE' AND (
      to_jsonb(OLD)-'released_at'-'released_by_admin_id' IS DISTINCT FROM to_jsonb(NEW)-'released_at'-'released_by_admin_id'
      OR OLD.released_at IS NOT NULL OR NEW.released_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Commerce retention hold permits only one approved release' USING ERRCODE='55000';
    END IF;
    approver:=CASE WHEN TG_OP='UPDATE' THEN NEW.released_by_admin_id ELSE NEW.created_by_admin_id END;
    IF NEW.released_at > now() THEN
      RAISE EXCEPTION 'Commerce retention hold release cannot be in the future' USING ERRCODE='23514';
    END IF;
  END IF;
  IF approver IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.users WHERE id=approver AND role IN ('ADMIN','SUPER_ADMIN') AND status='ACTIVE'
  ) THEN
    RAISE EXCEPTION 'Commerce retention approval requires an active administrator' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER commerce_retention_policies_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.commerce_retention_policies
  FOR EACH ROW EXECUTE FUNCTION public.guard_commerce_retention_registry();
CREATE TRIGGER commerce_retention_reviews_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.commerce_retention_reviews
  FOR EACH ROW EXECUTE FUNCTION public.guard_commerce_retention_registry();
CREATE TRIGGER commerce_retention_holds_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.commerce_retention_holds
  FOR EACH ROW EXECUTE FUNCTION public.guard_commerce_retention_registry();
CREATE TRIGGER commerce_retention_disposals_immutable
  BEFORE UPDATE OR DELETE ON public.commerce_retention_disposals
  FOR EACH ROW EXECUTE FUNCTION public.reject_row_mutation();

-- The limited preview reads canonical records, never owner-entered historical
-- target lists. It returns no text, address, tracking, token or provider payload.
-- Window floors reflect the repository's published 5y/3y promise, not a legal
-- determination. The owner must approve the anchor rule and component scope.
CREATE FUNCTION public.preview_commerce_retention(batch_size integer)
RETURNS TABLE(record_kind text,record_id uuid,policy_id uuid,review_id uuid,
  anchor_at timestamptz,eligible_at timestamptz,blocker text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF batch_size IS NULL OR batch_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Commerce retention batch must be between 1 and 100' USING ERRCODE='22023';
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
          WHERE o.shipping_request_id=s.id OR o.id IN (
            SELECT line.order_id FROM public.shipping_request_items item
              JOIN public.inventory_units unit ON unit.id=item.inventory_unit_id
              LEFT JOIN public.draw_entitlements entitlement ON entitlement.id=unit.source_id AND unit.source_type IN ('GACHA','KUJI')
              JOIN public.order_lines line ON line.id=CASE WHEN unit.source_type='PURCHASE' THEN unit.source_id ELSE entitlement.order_line_id END
             WHERE item.shipping_request_id=s.id
          ))) AS activity,
      false AS has_media,0::bigint AS message_count
      FROM public.shipping_requests s
     WHERE s.address_snapshot IS DISTINCT FROM '{"retentionDisposed":true}'::jsonb
    UNION ALL
    SELECT 'INQUIRY_CONTENT',i.id,i.user_id,
      i.status='CLOSED' AND i.closed_at IS NOT NULL,
      GREATEST(i.created_at,i.updated_at,i.closed_at,
        (SELECT max(m.created_at) FROM public.inquiry_messages m WHERE m.inquiry_id=i.id)),
      EXISTS (SELECT 1 FROM public.inquiry_messages m JOIN public.inquiry_message_media media ON media.message_id=m.id WHERE m.inquiry_id=i.id),
      (SELECT count(*) FROM public.inquiry_messages m WHERE m.inquiry_id=i.id)
      FROM public.inquiries i
     WHERE i.title<>'보관기한 만료로 파기된 문의'
        OR EXISTS (SELECT 1 FROM public.inquiry_messages m WHERE m.inquiry_id=i.id AND m.content<>'보관기한 만료로 파기된 내용')
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
          OR EXISTS (SELECT 1 FROM public.worker_payment_reconciliations reconciliation WHERE reconciliation.payment_id=payment.id))) THEN 'PAYMENT_UNRESOLVED'
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
    FROM assessed a
    -- Held/unreviewed old rows must not starve later approved expired rows.
    ORDER BY (a.denial IS NOT NULL),a.activity,a.kind,a.id LIMIT batch_size;
END;
$$;

CREATE FUNCTION public.execute_commerce_retention(batch_size integer)
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
  FOR candidate IN SELECT * FROM public.preview_commerce_retention(100) plan
    WHERE plan.blocker IS NULL ORDER BY plan.anchor_at,plan.record_kind,plan.record_id LIMIT batch_size
  LOOP
    IF candidate.record_kind='SHIPPING_ADDRESS' THEN
      PERFORM 1 FROM public.shipping_requests s WHERE s.id=candidate.record_id FOR UPDATE;
    ELSE
      PERFORM 1 FROM public.inquiries i WHERE i.id=candidate.record_id FOR UPDATE;
      PERFORM 1 FROM public.inquiry_messages m WHERE m.inquiry_id=candidate.record_id ORDER BY m.id FOR UPDATE;
    END IF;
    -- Re-evaluate after locks; serializable conflicts abort the entire bounded
    -- transaction. No irreversible external operation occurs in this function.
    SELECT * INTO rechecked FROM public.preview_commerce_retention(100) plan
      WHERE plan.record_kind=candidate.record_kind AND plan.record_id=candidate.record_id;
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

ALTER TABLE public.commerce_retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_retention_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_retention_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_retention_disposals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.commerce_retention_policies,public.commerce_retention_reviews,
  public.commerce_retention_holds,public.commerce_retention_disposals
  FROM PUBLIC,anon,authenticated,service_role,dabboba_runtime,dabboba_worker;
REVOKE ALL ON FUNCTION public.guard_commerce_retention_registry(),
  public.preview_commerce_retention(integer),public.execute_commerce_retention(integer)
  FROM PUBLIC,anon,authenticated,service_role,dabboba_runtime,dabboba_worker;
GRANT EXECUTE ON FUNCTION public.preview_commerce_retention(integer),public.execute_commerce_retention(integer)
  TO dabboba_worker;

COMMENT ON TABLE public.commerce_retention_policies IS
  'Owner-approved component scope and conservative anchor/window. No policy is approved by migration; not a full statutory erasure policy.';
COMMENT ON TABLE public.commerce_retention_reviews IS
  'Append-only owner evidence for complete hold-registry and external-copy review; both expire after 24 hours.';
COMMENT ON TABLE public.commerce_retention_holds IS
  'Global, user or exact-record legal hold. Only explicit approved release permits future component disposal.';
COMMENT ON TABLE public.commerce_retention_disposals IS
  'Append-only component-disposal counts and policy/hold/copy evidence without copied address or inquiry text; excludes financial/tracking/storage/backup erasure claims.';
