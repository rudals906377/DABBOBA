-- Withdraw the personalized-recommendation (맞춤 추천) consent.
--
-- The 2026-10-07 privacy policy no longer lists 맞춤 추천 because the app never
-- built the feature: the app drops the toggle and the consent row, the API
-- ignores the legacy input field and always stores false, and every stored
-- true value is withdrawn here with append-only evidence. The column stays
-- for history and for the worker's external-delivery gate (no
-- PERSONALIZED_RECOMMENDATION_* notification is ever produced).

-- 1. Allow a system-recorded withdrawal event (no acting user, but still an
--    idempotency key and a request id so the evidence names its origin). The
--    customer UPDATED branch now also requires a non-null actor: with a NULL
--    actor the 0015 comparison evaluated to NULL, which a CHECK accepts.
--    The two CHECK constraints carry the names PostgreSQL gave them in
--    migration 0015 (one unnamed table-level CHECK, one column CHECK); the
--    guard stops the migration if a database differs from that history.
DO $$
BEGIN
  IF (
    SELECT count(*)
      FROM pg_constraint
     WHERE conrelid = 'public.notification_preference_events'::regclass
       AND contype = 'c'
       AND conname IN (
         'notification_preference_events_check',
         'notification_preference_events_event_type_check'
       )
  ) <> 2 THEN
    RAISE EXCEPTION 'Unexpected notification_preference_events CHECK constraints before the personalized-recommendation withdrawal'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

ALTER TABLE public.notification_preference_events
  DROP CONSTRAINT notification_preference_events_check,
  DROP CONSTRAINT notification_preference_events_event_type_check,
  ADD CONSTRAINT notification_preference_events_event_type_check
    CHECK (event_type IN ('INITIALIZED','UPDATED','SYSTEM_WITHDRAWN')),
  ADD CONSTRAINT notification_preference_events_evidence_check CHECK (
    (event_type = 'INITIALIZED'
      AND before_state IS NULL
      AND actor_user_id IS NULL
      AND idempotency_key IS NULL
      AND request_id IS NULL)
    OR
    (event_type = 'UPDATED'
      AND before_state IS NOT NULL
      AND actor_user_id IS NOT NULL
      AND actor_user_id = user_id
      AND idempotency_key IS NOT NULL
      AND request_id IS NOT NULL)
    OR
    (event_type = 'SYSTEM_WITHDRAWN'
      AND before_state IS NOT NULL
      AND actor_user_id IS NULL
      AND idempotency_key IS NOT NULL
      AND request_id IS NOT NULL)
  );

-- 2. Withdraw every stored consent. The preference version advances exactly
--    like a customer update so concurrent app saves with a stale
--    expectedVersion are rejected instead of silently re-enabling the flag.
WITH withdrawn AS (
  UPDATE public.notification_preferences AS preference
     SET personalized_recommendations = false,
         version = preference.version + 1
   WHERE preference.personalized_recommendations = true
  RETURNING
    preference.user_id,
    preference.version,
    preference.exchange_updates,
    preference.request_updates,
    preference.restock_updates,
    preference.marketing_sms,
    preference.marketing_email,
    preference.marketing_push
)
INSERT INTO public.notification_preference_events
  (user_id,event_type,before_state,after_state,version,actor_user_id,idempotency_key,request_id)
SELECT
  withdrawn.user_id,
  'SYSTEM_WITHDRAWN',
  jsonb_build_object(
    'orderUpdates', true,
    'exchangeUpdates', withdrawn.exchange_updates,
    'requestUpdates', withdrawn.request_updates,
    'restockUpdates', withdrawn.restock_updates,
    'marketingSms', withdrawn.marketing_sms,
    'marketingEmail', withdrawn.marketing_email,
    'marketingPush', withdrawn.marketing_push,
    'personalizedRecommendations', true,
    'version', withdrawn.version - 1
  ),
  jsonb_build_object(
    'orderUpdates', true,
    'exchangeUpdates', withdrawn.exchange_updates,
    'requestUpdates', withdrawn.request_updates,
    'restockUpdates', withdrawn.restock_updates,
    'marketingSms', withdrawn.marketing_sms,
    'marketingEmail', withdrawn.marketing_email,
    'marketingPush', withdrawn.marketing_push,
    'personalizedRecommendations', false,
    'version', withdrawn.version
  ),
  withdrawn.version,
  NULL,
  'policy-2026-10-07:personalized-recommendations-withdrawn',
  'migration:0091_personalized_recommendation_consent_withdrawal'
FROM withdrawn;
