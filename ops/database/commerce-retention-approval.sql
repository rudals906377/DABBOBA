-- Commerce retention policy approval for the LIVE launch (2026-10-07 decision).
--
-- Periods follow the published privacy policy (docs/legal-drafts/review-questionnaire.md B7):
--   SHIPPING_ADDRESS  60 months  (계약·대금결제·재화 공급 기록 5년)
--   INQUIRY_CONTENT   36 months  (소비자 불만·분쟁 처리 기록 3년)
-- Procedure and limits: docs/commerce-retention-components.md.
--
-- Run as the migration owner in a private operator session, one step at a time:
--   psql "$DATABASE_MIGRATION_URL" -v step=approve -v admin_id=<ACTIVE ADMIN id> \
--        -v evidence=<private evidence code> -f ops/database/commerce-retention-approval.sql
--   psql ... -v step=review  -v admin_id=<reviewer id> -v evidence=<code> \
--        -v holds_reviewed=yes -v copies_status=UNVERIFIED|CLEARED -f ...
--   psql ... -v step=preview -f ...
--
-- This script never executes disposal. EXECUTE stays a separate, reviewed worker
-- run (WORKER_COMMERCE_RETENTION_MODE=EXECUTE, then back to DISABLED).
-- Never put customer content, secrets or real case details in -v evidence;
-- use a private reference code that points to the operator's own records.

\set ON_ERROR_STOP on
\if :{?step}
\else
  \echo 'Pass -v step=approve|review|preview'
  \quit
\endif

SELECT :'step' = 'approve' AS step_approve,
       :'step' = 'review' AS step_review,
       :'step' = 'preview' AS step_preview \gset

\if :step_approve
  \if :{?admin_id}
  \else
    \echo 'approve needs -v admin_id=<ACTIVE ADMIN or SUPER_ADMIN user id>'
    \quit
  \endif
  \if :{?evidence}
  \else
    \echo 'approve needs -v evidence=<private evidence code, 3-200 chars>'
    \quit
  \endif
  BEGIN;
  SELECT set_config('dabboba.retention_admin', :'admin_id', true) AS retention_admin \gset
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM public.users
       WHERE id = current_setting('dabboba.retention_admin')::uuid
         AND role IN ('ADMIN','SUPER_ADMIN') AND status = 'ACTIVE'
    ) THEN
      RAISE EXCEPTION 'admin_id is not an ACTIVE ADMIN or SUPER_ADMIN' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.commerce_retention_policies
       WHERE approved_at IS NOT NULL AND retired_at IS NULL AND policy_version <> DATE '2026-10-07'
    ) THEN
      RAISE EXCEPTION 'Another approved policy is current; retire it with its own evidence first'
        USING ERRCODE = '55000';
    END IF;
  END;
  $$;
  INSERT INTO public.commerce_retention_policies
    (record_kind, policy_version, retention_months, evidence_reference)
  VALUES
    ('SHIPPING_ADDRESS', DATE '2026-10-07', 60, :'evidence'),
    ('INQUIRY_CONTENT',  DATE '2026-10-07', 36, :'evidence')
  ON CONFLICT (record_kind, policy_version) DO NOTHING;
  UPDATE public.commerce_retention_policies
     SET approved_at = now(), approved_by_admin_id = :'admin_id'::uuid
   WHERE policy_version = DATE '2026-10-07' AND approved_at IS NULL;
  SELECT record_kind, retention_months, anchor_rule, approved_at IS NOT NULL AS approved
    FROM public.commerce_retention_policies
   WHERE policy_version = DATE '2026-10-07'
   ORDER BY record_kind;
  COMMIT;
\endif

\if :step_review
  \if :{?admin_id}
  \else
    \echo 'review needs -v admin_id=<reviewer: ACTIVE ADMIN or SUPER_ADMIN user id>'
    \quit
  \endif
  \if :{?evidence}
  \else
    \echo 'review needs -v evidence=<private reviewed-scope evidence code>'
    \quit
  \endif
  \if :{?holds_reviewed}
  \else
    \echo 'review needs -v holds_reviewed=yes after the full dispute list is in commerce_retention_holds'
    \quit
  \endif
  \if :{?copies_status}
  \else
    \echo 'review needs -v copies_status=UNVERIFIED or CLEARED (CLEARED only with actual copy-review evidence)'
    \quit
  \endif
  SELECT :'holds_reviewed' = 'yes' AS holds_ok,
         :'copies_status' IN ('UNVERIFIED','CLEARED') AS copies_ok \gset
  \if :holds_ok
  \else
    \echo 'holds_reviewed must be exactly yes'
    \quit
  \endif
  \if :copies_ok
  \else
    \echo 'copies_status must be UNVERIFIED or CLEARED'
    \quit
  \endif
  BEGIN;
  -- A review is valid for 24 hours and only the newest row counts; add a new
  -- row for every run instead of editing an old one.
  INSERT INTO public.commerce_retention_reviews
    (policy_id, reviewed_by_admin_id, hold_registry_reviewed_at,
     external_copies_reviewed_at, external_copies_status, evidence_reference)
  SELECT policy.id, :'admin_id'::uuid, now(),
         CASE WHEN :'copies_status' = 'CLEARED' THEN now() END,
         :'copies_status', :'evidence'
    FROM public.commerce_retention_policies policy
   WHERE policy.approved_at IS NOT NULL AND policy.retired_at IS NULL;
  SELECT policy.record_kind, review.external_copies_status, review.created_at
    FROM public.commerce_retention_reviews review
    JOIN public.commerce_retention_policies policy ON policy.id = review.policy_id
   WHERE review.created_at = now()
   ORDER BY policy.record_kind;
  COMMIT;
\endif

\if :step_preview
  -- Read-only: counts what one EXECUTE batch could dispose of and why the rest is blocked.
  BEGIN READ ONLY;
  SELECT record_kind, coalesce(blocker, 'ELIGIBLE') AS outcome, count(*) AS records
    FROM public.preview_commerce_retention(100)
   GROUP BY record_kind, coalesce(blocker, 'ELIGIBLE')
   ORDER BY record_kind, outcome;
  ROLLBACK;
\endif
